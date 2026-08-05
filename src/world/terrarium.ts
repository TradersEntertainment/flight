/**
 * Terrarium elevation tiles: elevation is packed into RGB as
 *
 *   height = (R * 256 + G + B / 256) - 32768   metres
 *
 * Pure functions here so they can be unit-tested outside a worker.
 */

export const TILE_PIXELS = 256;

/** Height in metres for one packed pixel. */
export function decodeTerrariumPixel(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/** Mapbox Terrain-RGB packing, kept for the alternate elevation provider. */
export function decodeTerrainRgbPixel(r: number, g: number, b: number): number {
  return -10000 + (r * 65536 + g * 256 + b) * 0.1;
}

export type ElevationEncoding = 'terrarium' | 'terrainrgb';

/** Decodes a full RGBA buffer into metres. */
export function decodeElevation(
  rgba: Uint8ClampedArray | Uint8Array,
  encoding: ElevationEncoding = 'terrarium',
  out?: Float32Array,
): Float32Array {
  const count = rgba.length / 4;
  const heights = out ?? new Float32Array(count);
  const decode = encoding === 'terrarium' ? decodeTerrariumPixel : decodeTerrainRgbPixel;
  for (let i = 0, p = 0; i < count; i++, p += 4) {
    heights[i] = decode(rgba[p], rgba[p + 1], rgba[p + 2]);
  }
  return heights;
}

export interface HeightStats {
  min: number;
  max: number;
}

export function heightStats(heights: Float32Array): HeightStats {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i];
    if (h < min) min = h;
    if (h > max) max = h;
  }
  return { min, max };
}

/** Sea level in metres; anything at or below counts as water (see KNOWN_ISSUES). */
export const SEA_LEVEL = 0;
