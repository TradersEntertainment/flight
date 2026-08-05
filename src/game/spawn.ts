/**
 * Spawn points and shareable URL state.
 *
 * The URL carries where you are, what you are driving and which way you face,
 * so a link drops someone into the same place — the cheapest multiplayer there
 * is.
 */

export interface SpawnPoint {
  lon: number;
  lat: number;
  name?: string;
  /** Heading in degrees from north. */
  heading?: number;
  /** Metres above ground for an airborne spawn. */
  altitude?: number;
}

/** Istanbul Airport, runway 34L — the default first flight. */
export const DEFAULT_SPAWN: SpawnPoint = {
  lon: 28.7519,
  lat: 41.2619,
  name: 'İstanbul Havalimanı',
  heading: 355,
  altitude: 0,
};

export interface UrlState extends SpawnPoint {
  vehicle?: string;
  time?: string;
}

export function readSpawnFromUrl(): UrlState {
  if (typeof location === 'undefined') return { ...DEFAULT_SPAWN };
  const params = new URLSearchParams(location.search);
  const lon = Number(params.get('lon'));
  const lat = Number(params.get('lat'));
  const state: UrlState = { ...DEFAULT_SPAWN };
  if (Number.isFinite(lon) && Number.isFinite(lat) && (lon !== 0 || lat !== 0)) {
    state.lon = Math.max(-180, Math.min(180, lon));
    state.lat = Math.max(-85, Math.min(85, lat));
    state.name = params.get('name') ?? undefined;
    state.altitude = numberOr(params.get('alt'), 600);
    state.heading = numberOr(params.get('hdg'), 0);
  }
  const vehicle = params.get('veh');
  if (vehicle) state.vehicle = vehicle;
  const time = params.get('time');
  if (time) state.time = time;
  return state;
}

/** Rewrites the address bar without adding history entries. */
export function writeUrlState(state: UrlState): void {
  if (typeof history === 'undefined') return;
  const params = new URLSearchParams(location.search);
  params.set('lon', state.lon.toFixed(5));
  params.set('lat', state.lat.toFixed(5));
  if (state.vehicle) params.set('veh', state.vehicle);
  if (state.heading !== undefined) params.set('hdg', Math.round(state.heading).toString());
  if (state.altitude !== undefined) params.set('alt', Math.round(state.altitude).toString());
  if (state.time) params.set('time', state.time);
  history.replaceState(null, '', `${location.pathname}?${params.toString()}`);
}

function numberOr(value: string | null, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
