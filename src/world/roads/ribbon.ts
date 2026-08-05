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

/**
 * Resamples a polyline at a fixed spacing.
 *
 * OpenStreetMap puts a point wherever the geometry bends, which can be 200 m
 * apart on a motorway. Draping such a line over the terrain would cut straight
 * through hills, so it is resampled before the heights are read.
 */
export function resamplePolyline(points: RibbonPoint[], spacing: number): RibbonPoint[] {
  if (points.length < 2 || spacing <= 0) return points.slice();
  const out: RibbonPoint[] = [points[0]];
  let carry = spacing;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const segment = Math.hypot(dx, dz);
    if (segment < 1e-6) continue;
    let travelled = carry;
    while (travelled < segment) {
      const t = travelled / segment;
      out.push({ x: a.x + dx * t, y: a.y + (b.y - a.y) * t, z: a.z + dz * t });
      travelled += spacing;
    }
    carry = travelled - segment;
    // Always keep the original vertex: it is where the road actually bends.
    out.push(b);
    carry = spacing;
  }
  return out;
}

/**
 * Smooths the height profile of a polyline in place.
 *
 * A road surface is engineered flat; the terrain under it is a 30 m grid with
 * its own noise. Averaging the sampled heights over a few points stops the
 * ribbon rippling while still letting it climb a real hill.
 */
export function smoothHeights(points: RibbonPoint[], window = 2): void {
  if (points.length < 3) return;
  const source = points.map((p) => p.y);
  for (let i = 0; i < points.length; i++) {
    let sum = 0;
    let count = 0;
    for (let k = -window; k <= window; k++) {
      const index = i + k;
      if (index < 0 || index >= source.length) continue;
      sum += source[index];
      count++;
    }
    points[i].y = sum / count;
  }
}

/**
 * Lays a bridge deck between its abutments.
 *
 * A bridge is the one road that must not follow the ground: draping the
 * Bosphorus crossing on the terrain would paint it flat across the water. The
 * deck runs straight from one end to the other — which is what a span does —
 * and is then lifted clear of anything that pokes through in between.
 *
 * `ground` is the terrain height at each point, in order.
 */
export function bridgeDeck(
  points: RibbonPoint[],
  ground: number[],
  clearance: number,
  minimumOverWater: number,
): void {
  if (points.length < 2) return;
  const start = ground[0];
  const end = ground[ground.length - 1];
  const total = polylineLength(points);
  if (total <= 0) return;

  let travelled = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      travelled += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    }
    const t = travelled / total;
    const deck = start + (end - start) * t;
    const below = ground[i];
    // Clearance tapers away at the ends: mid-span the deck must stand clear of
    // what it crosses, but at the abutments it has to meet the road it joins.
    const edge = Math.min(1, Math.min(t, 1 - t) / 0.12);
    points[i].y = Math.max(
      deck,
      below + clearance * edge,
      below <= 0 ? minimumOverWater * edge : -Infinity,
    );
  }
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
