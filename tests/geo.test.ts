import { describe, expect, it } from 'vitest';
import {
  bearing,
  haversine,
  latToMercatorY,
  lonToMercatorX,
  mercatorXToLon,
  mercatorYToLat,
  metersPerPixel,
  wrapLongitude,
} from '../src/geo/mercator';
import {
  tileAt,
  tileBounds,
  tileCenterLonLat,
  tileChildren,
  tileGroundSize,
  tileParent,
  uvInAncestor,
} from '../src/geo/tilemath';
import { Anchor } from '../src/geo/anchor';

const ISTANBUL = { lon: 28.9784, lat: 41.0082 };
const ANTALYA = { lon: 30.7133, lat: 36.8969 };

describe('mercator', () => {
  it('round-trips lon/lat through mercator metres', () => {
    for (const p of [ISTANBUL, ANTALYA, { lon: -122.4, lat: 37.77 }, { lon: 0, lat: 0 }]) {
      const x = lonToMercatorX(p.lon);
      const y = latToMercatorY(p.lat);
      expect(mercatorXToLon(x)).toBeCloseTo(p.lon, 9);
      expect(mercatorYToLat(y)).toBeCloseTo(p.lat, 9);
    }
  });

  it('places the origin at null island', () => {
    expect(lonToMercatorX(0)).toBe(0);
    expect(latToMercatorY(0)).toBeCloseTo(0, 6);
  });

  it('wraps longitude into [-180, 180)', () => {
    expect(wrapLongitude(190)).toBeCloseTo(-170, 9);
    expect(wrapLongitude(-190)).toBeCloseTo(170, 9);
    expect(wrapLongitude(45)).toBeCloseTo(45, 9);
  });

  it('shrinks metres-per-pixel with latitude and zoom', () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(156543.03, 1);
    expect(metersPerPixel(0, 10)).toBeLessThan(metersPerPixel(0, 9));
    expect(metersPerPixel(60, 10)).toBeCloseTo(metersPerPixel(0, 10) * 0.5, 1);
  });

  it('measures known distances', () => {
    // Istanbul to Antalya is roughly 480 km great-circle.
    const d = haversine(ISTANBUL.lon, ISTANBUL.lat, ANTALYA.lon, ANTALYA.lat);
    expect(d / 1000).toBeGreaterThan(460);
    expect(d / 1000).toBeLessThan(500);
  });

  it('computes bearings', () => {
    expect(bearing(0, 0, 0, 1)).toBeCloseTo(0, 6); // due north
    expect(bearing(0, 0, 1, 0)).toBeCloseTo(90, 6); // due east
  });
});

describe('tilemath', () => {
  it('finds the tile containing a point', () => {
    // Istanbul at z10 is tile 594/383 in the XYZ scheme.
    expect(tileAt(ISTANBUL.lon, ISTANBUL.lat, 10)).toEqual({ z: 10, x: 594, y: 383 });
    expect(tileAt(0, 0, 1)).toEqual({ z: 1, x: 1, y: 1 });
  });

  it('keeps a point inside its own tile bounds', () => {
    const t = tileAt(ANTALYA.lon, ANTALYA.lat, 12);
    const b = tileBounds(t);
    expect(ANTALYA.lon).toBeGreaterThanOrEqual(b.west);
    expect(ANTALYA.lon).toBeLessThanOrEqual(b.east);
    expect(ANTALYA.lat).toBeGreaterThanOrEqual(b.south);
    expect(ANTALYA.lat).toBeLessThanOrEqual(b.north);
  });

  it('relates parents and children', () => {
    const t = tileAt(ISTANBUL.lon, ISTANBUL.lat, 12);
    for (const c of tileChildren(t)) expect(tileParent(c)).toEqual(t);
    const centre = tileCenterLonLat(t);
    expect(tileAt(centre.lon, centre.lat, 12)).toEqual(t);
  });

  it('maps a tile into an ancestor texture', () => {
    const parent = { z: 10, x: 595, y: 384 };
    const child = { z: 11, x: 1191, y: 769 }; // south-east quadrant
    const uv = uvInAncestor(child, parent);
    expect(uv.scale).toBeCloseTo(0.5, 9);
    expect(uv.offsetX).toBeCloseTo(0.5, 9);
    expect(uv.offsetY).toBeCloseTo(0.5, 9); // v runs north to south
    // The north-west child sits at the texture origin.
    const nw = uvInAncestor({ z: 11, x: 1190, y: 768 }, parent);
    expect(nw.offsetX).toBeCloseTo(0, 9);
    expect(nw.offsetY).toBeCloseTo(0, 9);
    // Two levels down keeps the mapping consistent.
    const deep = uvInAncestor({ z: 12, x: 2383, y: 1539 }, parent);
    expect(deep.scale).toBeCloseTo(0.25, 9);
    expect(deep.offsetX).toBeCloseTo(0.75, 9);
    expect(deep.offsetY).toBeCloseTo(0.75, 9);
  });

  it('reports plausible ground sizes', () => {
    // A z15 tile near 41N is a bit over 900 m across.
    const size = tileGroundSize(tileAt(ISTANBUL.lon, ISTANBUL.lat, 15));
    expect(size).toBeGreaterThan(800);
    expect(size).toBeLessThan(1000);
  });
});

describe('anchor', () => {
  it('puts the anchor at the world origin', () => {
    const a = new Anchor(ISTANBUL.lon, ISTANBUL.lat);
    const w = a.worldFromLonLat(ISTANBUL.lon, ISTANBUL.lat);
    expect(w.x).toBeCloseTo(0, 6);
    expect(w.z).toBeCloseTo(0, 6);
  });

  it('orients east as +x and north as -z', () => {
    const a = new Anchor(ISTANBUL.lon, ISTANBUL.lat);
    const east = a.worldFromLonLat(ISTANBUL.lon + 0.01, ISTANBUL.lat);
    const north = a.worldFromLonLat(ISTANBUL.lon, ISTANBUL.lat + 0.01);
    expect(east.x).toBeGreaterThan(0);
    expect(north.z).toBeLessThan(0);
  });

  it('measures true metres near the anchor', () => {
    const a = new Anchor(ANTALYA.lon, ANTALYA.lat);
    const p = { lon: ANTALYA.lon + 0.2, lat: ANTALYA.lat + 0.15 };
    const w = a.worldFromLonLat(p.lon, p.lat);
    const expected = haversine(ANTALYA.lon, ANTALYA.lat, p.lon, p.lat);
    expect(Math.hypot(w.x, w.z)).toBeGreaterThan(expected * 0.99);
    expect(Math.hypot(w.x, w.z)).toBeLessThan(expected * 1.01);
  });

  it('round-trips world coordinates back to lon/lat', () => {
    const a = new Anchor(ISTANBUL.lon, ISTANBUL.lat);
    const p = { lon: 29.1, lat: 41.2 };
    const w = a.worldFromLonLat(p.lon, p.lat);
    const back = a.lonLatFromWorld(w.x, w.z);
    expect(back.lon).toBeCloseTo(p.lon, 9);
    expect(back.lat).toBeCloseTo(p.lat, 9);
  });

  it('reports the shift needed when re-anchoring', () => {
    const a = new Anchor(ISTANBUL.lon, ISTANBUL.lat);
    const target = { lon: 29.5, lat: 41.3 };
    const before = a.worldFromLonLat(target.lon, target.lat);
    const delta = a.moveTo(target.lon, target.lat);
    // The new anchor lands exactly on the world origin.
    expect(delta.x).toBeCloseTo(-before.x, 6);
    expect(delta.z).toBeCloseTo(-before.z, 6);
    const at = a.worldFromLonLat(target.lon, target.lat);
    expect(Math.hypot(at.x, at.z)).toBeCloseTo(0, 6);
  });

  it('re-anchors without deforming the scene', () => {
    // The cos(lat0) scale changes slightly on re-anchor, so translating old
    // world coordinates by the delta is an approximation; recomputing from
    // lon/lat is exact. Anything that must stay put keeps its lon/lat.
    const a = new Anchor(ISTANBUL.lon, ISTANBUL.lat);
    const p = { lon: 29.2, lat: 41.1 };
    const q = { lon: 29.25, lat: 41.15 };
    const pBefore = a.worldFromLonLat(p.lon, p.lat);
    const qBefore = a.worldFromLonLat(q.lon, q.lat);
    const delta = a.moveTo(29.5, 41.3);
    const pAfter = a.worldFromLonLat(p.lon, p.lat);
    const qAfter = a.worldFromLonLat(q.lon, q.lat);
    // Recomputed positions stay within a fraction of a percent of a plain shift.
    const shiftError = Math.hypot(pAfter.x - (pBefore.x + delta.x), pAfter.z - (pBefore.z + delta.z));
    expect(shiftError).toBeLessThan(0.01 * Math.hypot(pBefore.x, pBefore.z));
    // Distances between two fixed points survive the re-anchor up to the
    // cos(lat0) scale change — 0.3 degrees of anchor latitude is ~0.5 %.
    const dBefore = Math.hypot(pBefore.x - qBefore.x, pBefore.z - qBefore.z);
    const dAfter = Math.hypot(pAfter.x - qAfter.x, pAfter.z - qAfter.z);
    expect(Math.abs(dAfter - dBefore) / dBefore).toBeLessThan(0.01);
  });
});
