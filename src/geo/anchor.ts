/**
 * World anchor: the bridge between geographic coordinates and the Three.js
 * scene.
 *
 * The scene is a local tangent plane in true metres around an anchor point:
 *
 *   world.x =  (mercX - anchorMercX) * cos(anchorLat)      // east
 *   world.z = -(mercY - anchorMercY) * cos(anchorLat)      // north is -z
 *   world.y =  elevation in metres above sea level
 *
 * Keeping the anchor near the player bounds float32 error and the cos(lat0)
 * approximation error. Re-anchoring emits an event so every system can shift
 * its objects.
 *
 * The single cos(lat0) factor means a re-anchor is not a pure translation: the
 * local metre scale changes by cos(newLat)/cos(oldLat) — about 0.5 % for 0.3
 * degrees of latitude. Anything that must stay geographically put therefore
 * keeps its lon/lat and recomputes its world position (exact); the delta
 * returned by moveTo is only for transient objects near the player, where the
 * error is negligible.
 */

import {
  latToMercatorY,
  lonToMercatorX,
  mercatorScale,
  mercatorXToLon,
  mercatorYToLat,
} from './mercator';

/** Re-anchor once the player is this far from the anchor (metres). */
export const REANCHOR_DISTANCE = 40_000;

export interface LonLat {
  lon: number;
  lat: number;
}

export type AnchorListener = (anchor: Anchor, delta: { x: number; z: number }) => void;

export class Anchor {
  lon = 0;
  lat = 0;
  mercX = 0;
  mercY = 0;
  scale = 1;
  /** Incremented on every re-anchor; systems can compare to detect staleness. */
  epoch = 0;
  private readonly listeners = new Set<AnchorListener>();

  constructor(lon = 0, lat = 0) {
    this.set(lon, lat);
  }

  private set(lon: number, lat: number): void {
    this.lon = lon;
    this.lat = lat;
    this.mercX = lonToMercatorX(lon);
    this.mercY = latToMercatorY(lat);
    this.scale = mercatorScale(lat);
  }

  onChange(fn: AnchorListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Moves the anchor. Returns the world-space offset that previously-computed
   * positions must be shifted by (old world position + delta = new position).
   */
  moveTo(lon: number, lat: number): { x: number; z: number } {
    const before = this.worldFromLonLat(lon, lat);
    this.set(lon, lat);
    // The new anchor is world origin, so everything shifts by -before.
    const delta = { x: -before.x, z: -before.z };
    this.epoch++;
    for (const fn of this.listeners) fn(this, delta);
    return delta;
  }

  worldFromMercator(mx: number, my: number): { x: number; z: number } {
    return {
      x: (mx - this.mercX) * this.scale,
      z: -(my - this.mercY) * this.scale,
    };
  }

  worldFromLonLat(lon: number, lat: number): { x: number; z: number } {
    return this.worldFromMercator(lonToMercatorX(lon), latToMercatorY(lat));
  }

  mercatorFromWorld(x: number, z: number): { x: number; y: number } {
    return {
      x: x / this.scale + this.mercX,
      y: -z / this.scale + this.mercY,
    };
  }

  lonLatFromWorld(x: number, z: number): LonLat {
    const m = this.mercatorFromWorld(x, z);
    return { lon: mercatorXToLon(m.x), lat: mercatorYToLat(m.y) };
  }

  /** Distance from the anchor in metres, used to decide when to re-anchor. */
  distanceFromOrigin(x: number, z: number): number {
    return Math.hypot(x, z);
  }
}
