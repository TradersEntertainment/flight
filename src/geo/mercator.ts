/**
 * Spherical Web Mercator (EPSG:3857) conversions.
 *
 * Mercator metres are inflated by 1/cos(latitude); the world anchor (see
 * anchor.ts) multiplies by cos(lat0) to bring the local scene back to true
 * metres around the player.
 */

export const EARTH_RADIUS = 6378137; // WGS84 semi-major axis, metres
export const MERCATOR_EXTENT = Math.PI * EARTH_RADIUS; // half world width
export const MAX_LATITUDE = 85.0511287798; // where Mercator becomes square

export const toRad = (deg: number): number => (deg * Math.PI) / 180;
export const toDeg = (rad: number): number => (rad * 180) / Math.PI;

export function clampLatitude(lat: number): number {
  return Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat));
}

/** Wraps longitude into [-180, 180). */
export function wrapLongitude(lon: number): number {
  let l = (lon + 180) % 360;
  if (l < 0) l += 360;
  return l - 180;
}

export function lonToMercatorX(lon: number): number {
  return EARTH_RADIUS * toRad(lon);
}

export function latToMercatorY(lat: number): number {
  const phi = toRad(clampLatitude(lat));
  return EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + phi / 2));
}

export function mercatorXToLon(x: number): number {
  return toDeg(x / EARTH_RADIUS);
}

export function mercatorYToLat(y: number): number {
  return toDeg(2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2);
}

/** Ground metres per Mercator metre at a given latitude. */
export function mercatorScale(lat: number): number {
  return Math.cos(toRad(clampLatitude(lat)));
}

/** Ground metres per pixel for a 256 px tile at zoom z. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (2 * MERCATOR_EXTENT * mercatorScale(lat)) / (256 * 2 ** zoom);
}

/** Great-circle distance in metres (haversine). */
export function haversine(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing in degrees from north, 0..360. */
export function bearing(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dl = toRad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
