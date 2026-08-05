/**
 * XYZ tile scheme helpers (y counts from the north edge — not TMS).
 */

import {
  MERCATOR_EXTENT,
  clampLatitude,
  latToMercatorY,
  lonToMercatorX,
  mercatorXToLon,
  mercatorYToLat,
  toRad,
} from './mercator';

export interface TileId {
  z: number;
  x: number;
  y: number;
}

export const tileKey = (z: number, x: number, y: number): string => `${z}/${x}/${y}`;
export const idKey = (t: TileId): string => tileKey(t.z, t.x, t.y);

export function parseKey(key: string): TileId {
  const [z, x, y] = key.split('/').map(Number);
  return { z, x, y };
}

/** Number of tiles per axis at a zoom level. */
export const tilesPerAxis = (z: number): number => 2 ** z;

/** Tile edge length in Mercator metres. */
export const tileSpan = (z: number): number => (2 * MERCATOR_EXTENT) / tilesPerAxis(z);

export function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * tilesPerAxis(z);
}

export function latToTileY(lat: number, z: number): number {
  const phi = toRad(clampLatitude(lat));
  return ((1 - Math.asinh(Math.tan(phi)) / Math.PI) / 2) * tilesPerAxis(z);
}

export function tileXToLon(x: number, z: number): number {
  return (x / tilesPerAxis(z)) * 360 - 180;
}

export function tileYToLat(y: number, z: number): number {
  const n = Math.PI * (1 - (2 * y) / tilesPerAxis(z));
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

export function tileAt(lon: number, lat: number, z: number): TileId {
  const n = tilesPerAxis(z);
  const x = Math.min(n - 1, Math.max(0, Math.floor(lonToTileX(lon, z))));
  const y = Math.min(n - 1, Math.max(0, Math.floor(latToTileY(lat, z))));
  return { z, x, y };
}

/** Wraps x around the antimeridian, clamps y at the poles. */
export function normalizeTile(t: TileId): TileId | null {
  const n = tilesPerAxis(t.z);
  if (t.y < 0 || t.y >= n) return null;
  let x = t.x % n;
  if (x < 0) x += n;
  return { z: t.z, x, y: t.y };
}

export interface TileBounds {
  west: number;
  east: number;
  south: number;
  north: number;
  /** Mercator metre bounds. */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function tileBounds(t: TileId): TileBounds {
  const west = tileXToLon(t.x, t.z);
  const east = tileXToLon(t.x + 1, t.z);
  const north = tileYToLat(t.y, t.z);
  const south = tileYToLat(t.y + 1, t.z);
  return {
    west,
    east,
    south,
    north,
    minX: lonToMercatorX(west),
    maxX: lonToMercatorX(east),
    minY: latToMercatorY(south),
    maxY: latToMercatorY(north),
  };
}

/** Mercator centre of a tile. */
export function tileCenterMercator(t: TileId): { x: number; y: number } {
  const span = tileSpan(t.z);
  return {
    x: -MERCATOR_EXTENT + (t.x + 0.5) * span,
    y: MERCATOR_EXTENT - (t.y + 0.5) * span,
  };
}

export function tileCenterLonLat(t: TileId): { lon: number; lat: number } {
  const c = tileCenterMercator(t);
  return { lon: mercatorXToLon(c.x), lat: mercatorYToLat(c.y) };
}

export function tileChildren(t: TileId): TileId[] {
  const z = t.z + 1;
  const x = t.x * 2;
  const y = t.y * 2;
  return [
    { z, x, y },
    { z, x: x + 1, y },
    { z, x, y: y + 1 },
    { z, x: x + 1, y: y + 1 },
  ];
}

export function tileParent(t: TileId): TileId | null {
  if (t.z === 0) return null;
  return { z: t.z - 1, x: t.x >> 1, y: t.y >> 1 };
}

/**
 * Sub-rectangle of `ancestor` covered by `tile`, as uv scale/offset for
 * sampling a coarser texture while the exact one is still loading.
 *
 * Terrain textures are uploaded with flipY = false, so v runs north to south
 * exactly like tile y — no flip is needed here.
 */
export function uvInAncestor(
  tile: TileId,
  ancestor: TileId,
): { scale: number; offsetX: number; offsetY: number } {
  const levels = tile.z - ancestor.z;
  const span = 2 ** levels;
  const scale = 1 / span;
  return {
    scale,
    offsetX: (tile.x - ancestor.x * span) * scale,
    offsetY: (tile.y - ancestor.y * span) * scale,
  };
}

/** True ground size of a tile edge in metres, at the tile's centre latitude. */
export function tileGroundSize(t: TileId): number {
  const { lat } = tileCenterLonLat(t);
  return tileSpan(t.z) * Math.cos(toRad(clampLatitude(lat)));
}
