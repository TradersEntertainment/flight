/**
 * Turns building footprints into solid geometry.
 *
 * Pure maths, no scene objects, so the tricky part — triangulating an arbitrary
 * polygon — can be tested directly. Footprints come from OpenStreetMap and are
 * simple closed rings; holes (courtyards, which only appear on multipolygon
 * relations) are not handled and those buildings are skipped upstream.
 */

export interface Point2 {
  x: number;
  z: number;
}

export interface ExtrudedGeometry {
  positions: Float32Array;
  normals: Float32Array;
  /** u runs along the wall in metres, v runs up in floors. */
  uvs: Float32Array;
  indices: Uint32Array;
}

/** Twice the signed area; positive when the ring winds counter-clockwise. */
export function signedArea(ring: Point2[]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j].x - ring[i].x) * (ring[j].z + ring[i].z);
  }
  return sum / 2;
}

export function polygonArea(ring: Point2[]): number {
  return Math.abs(signedArea(ring));
}

/** Removes a repeated closing point and collapses duplicate neighbours. */
export function cleanRing(ring: Point2[]): Point2[] {
  const out: Point2[] = [];
  for (const point of ring) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - point.x) < 1e-6 && Math.abs(last.z - point.z) < 1e-6) continue;
    out.push(point);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first && last && Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.z - last.z) < 1e-6) {
    out.pop();
  }
  return out;
}

function isConvex(a: Point2, b: Point2, c: Point2): boolean {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x) < 0;
}

function pointInTriangle(p: Point2, a: Point2, b: Point2, c: Point2): boolean {
  const d1 = (p.x - b.x) * (a.z - b.z) - (a.x - b.x) * (p.z - b.z);
  const d2 = (p.x - c.x) * (b.z - c.z) - (b.x - c.x) * (p.z - c.z);
  const d3 = (p.x - a.x) * (c.z - a.z) - (c.x - a.x) * (p.z - a.z);
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNegative && hasPositive);
}

/**
 * Ear-clipping triangulation of a simple polygon.
 *
 * Returns index triples into the input ring. Robust enough for building
 * outlines: it bails out on self-intersecting input rather than looping, and
 * OSM footprints that fail are simply not drawn.
 */
export function triangulate(ring: Point2[]): number[] {
  const n = ring.length;
  if (n < 3) return [];

  // Work on a counter-clockwise copy so the ear test has one orientation.
  const indices = [...Array(n).keys()];
  if (signedArea(ring) > 0) indices.reverse();

  const triangles: number[] = [];
  let guard = n * n;
  while (indices.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < indices.length; i++) {
      const prev = indices[(i - 1 + indices.length) % indices.length];
      const current = indices[i];
      const next = indices[(i + 1) % indices.length];
      const a = ring[prev];
      const b = ring[current];
      const c = ring[next];
      if (!isConvex(a, b, c)) continue;

      let containsOther = false;
      for (const index of indices) {
        if (index === prev || index === current || index === next) continue;
        if (pointInTriangle(ring[index], a, b, c)) {
          containsOther = true;
          break;
        }
      }
      if (containsOther) continue;

      triangles.push(prev, current, next);
      indices.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) return triangles.length > 0 ? triangles : []; // degenerate input
  }
  if (indices.length === 3) triangles.push(indices[0], indices[1], indices[2]);
  return triangles;
}

export interface ExtrudeOptions {
  /** Ground height the walls start from, metres. */
  base: number;
  /** Roof height, metres above sea level. */
  top: number;
  /** Metres per floor, for the window pattern in the shader. */
  floorHeight?: number;
  /**
   * Shifts the wall u coordinate, in metres.
   *
   * The window shader keys its lit/unlit pattern off the u coordinate, so a
   * per-building offset is what stops every building on a street showing the
   * same windows lit. It has to be baked in here: a per-vertex seed would be
   * interpolated across the facade and turn the pattern into noise.
   */
  uOffset?: number;
}

/**
 * Builds walls and a flat roof for one footprint.
 *
 * Walls are two triangles per edge with an outward normal; the roof is the
 * triangulated footprint at `top`. No floor: nothing can see under a building.
 */
export function extrudeFootprint(
  footprint: Point2[],
  options: ExtrudeOptions,
): ExtrudedGeometry | null {
  const ring = cleanRing(footprint);
  if (ring.length < 3) return null;
  const { base, top } = options;
  if (!(top > base)) return null;
  const floorHeight = options.floorHeight ?? 3.2;
  const height = top - base;

  const roofTriangles = triangulate(ring);
  if (roofTriangles.length === 0) return null;

  const wallVertices = ring.length * 4;
  const roofVertices = ring.length;
  const total = wallVertices + roofVertices;

  const positions = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);
  const uvs = new Float32Array(total * 2);
  const indices = new Uint32Array(ring.length * 6 + roofTriangles.length);

  // Outward is to the right of the walking direction for a clockwise ring.
  const outwardSign = signedArea(ring) > 0 ? 1 : -1;

  let vertex = 0;
  let index = 0;
  let distance = options.uOffset ?? 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz) || 1;
    const nx = (dz / length) * outwardSign;
    const nz = (-dx / length) * outwardSign;

    const corners: Array<[Point2, number, number, number]> = [
      [a, base, distance, 0],
      [b, base, distance + length, 0],
      [b, top, distance + length, height / floorHeight],
      [a, top, distance, height / floorHeight],
    ];
    const first = vertex;
    for (const [point, y, u, v] of corners) {
      positions[vertex * 3] = point.x;
      positions[vertex * 3 + 1] = y;
      positions[vertex * 3 + 2] = point.z;
      normals[vertex * 3] = nx;
      normals[vertex * 3 + 1] = 0;
      normals[vertex * 3 + 2] = nz;
      uvs[vertex * 2] = u;
      uvs[vertex * 2 + 1] = v;
      vertex++;
    }
    indices[index++] = first;
    indices[index++] = first + 1;
    indices[index++] = first + 2;
    indices[index++] = first;
    indices[index++] = first + 2;
    indices[index++] = first + 3;
    distance += length;
  }

  const roofStart = vertex;
  for (const point of ring) {
    positions[vertex * 3] = point.x;
    positions[vertex * 3 + 1] = top;
    positions[vertex * 3 + 2] = point.z;
    normals[vertex * 3] = 0;
    normals[vertex * 3 + 1] = 1;
    normals[vertex * 3 + 2] = 0;
    // Negative v marks the roof, so the shader can skip the window pattern.
    uvs[vertex * 2] = point.x * 0.25;
    uvs[vertex * 2 + 1] = -1;
    vertex++;
  }
  for (const triangle of roofTriangles) indices[index++] = roofStart + triangle;

  return { positions, normals, uvs, indices: indices.subarray(0, index) };
}
