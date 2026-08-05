/**
 * Turns a polyline into a flat ribbon of triangles.
 *
 * Corners use the mitre of the two adjacent segment normals so the surface does
 * not pinch or gap on a bend; the mitre length is clamped, otherwise a hairpin
 * produces a spike that shoots across the map.
 */

export interface RibbonPoint {
  x: number;
  y: number;
  z: number;
}

export interface RibbonGeometry {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

const MAX_MITRE = 3;

export function buildRibbon(points: RibbonPoint[], width: number): RibbonGeometry | null {
  if (points.length < 2) return null;
  const half = width / 2;
  const count = points.length;
  const positions = new Float32Array(count * 2 * 3);
  const uvs = new Float32Array(count * 2 * 2);
  const indices = new Uint32Array((count - 1) * 6);

  let distance = 0;
  for (let i = 0; i < count; i++) {
    const previous = points[Math.max(0, i - 1)];
    const next = points[Math.min(count - 1, i + 1)];

    // Direction along the line at this vertex, averaged across the corner.
    let dx = next.x - previous.x;
    let dz = next.z - previous.z;
    const length = Math.hypot(dx, dz) || 1;
    dx /= length;
    dz /= length;

    // Left-hand normal in the xz plane.
    let nx = -dz;
    let nz = dx;

    // Mitre: widen the corner so the outer edge stays continuous.
    let scale = 1;
    if (i > 0 && i < count - 1) {
      const inX = points[i].x - previous.x;
      const inZ = points[i].z - previous.z;
      const inLength = Math.hypot(inX, inZ) || 1;
      const cos = (inX / inLength) * dx + (inZ / inLength) * dz;
      scale = Math.min(MAX_MITRE, 1 / Math.max(0.25, Math.sqrt((1 + cos) / 2)));
    }
    nx *= half * scale;
    nz *= half * scale;

    if (i > 0) {
      distance += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    }

    const p = i * 6;
    positions[p] = points[i].x + nx;
    positions[p + 1] = points[i].y;
    positions[p + 2] = points[i].z + nz;
    positions[p + 3] = points[i].x - nx;
    positions[p + 4] = points[i].y;
    positions[p + 5] = points[i].z - nz;

    const q = i * 4;
    // v runs along the road so the centre line repeats at a fixed pitch.
    uvs[q] = 0;
    uvs[q + 1] = distance / width;
    uvs[q + 2] = 1;
    uvs[q + 3] = distance / width;

    if (i < count - 1) {
      const base = i * 2;
      const k = i * 6;
      indices[k] = base;
      indices[k + 1] = base + 2;
      indices[k + 2] = base + 1;
      indices[k + 3] = base + 1;
      indices[k + 4] = base + 2;
      indices[k + 5] = base + 3;
    }
  }

  return { positions, uvs, indices };
}

/** Total ground length of a polyline, in metres. */
export function polylineLength(points: RibbonPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  }
  return total;
}

export interface LampSite {
  x: number;
  y: number;
  z: number;
  /** Unit vector pointing to the side of the road the lamp stands on. */
  offsetX: number;
  offsetZ: number;
}

/**
 * Positions lamp posts along a polyline at a fixed spacing, alternating sides.
 *
 * Walking by arc length rather than by vertex keeps the spacing even whether the
 * source geometry has a point every 5 m or every 500 m.
 */
export function lampSites(points: RibbonPoint[], spacing: number, offset: number): LampSite[] {
  const sites: LampSite[] = [];
  if (points.length < 2 || spacing <= 0) return sites;

  let carry = spacing / 2;
  let side = 1;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const segment = Math.hypot(dx, dz);
    if (segment < 1e-3) continue;
    const ux = dx / segment;
    const uz = dz / segment;

    let travelled = carry;
    while (travelled <= segment) {
      const t = travelled / segment;
      sites.push({
        x: a.x + dx * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + dz * t,
        offsetX: -uz * side * offset,
        offsetZ: ux * side * offset,
      });
      side = -side;
      travelled += spacing;
    }
    carry = travelled - segment;
  }
  return sites;
}
