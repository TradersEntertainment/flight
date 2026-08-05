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
  /** Vehicle to start in. */
  vehicle?: string;
}

/**
 * Mecidiyeköy, on Büyükdere Caddesi — Istanbul's tower district.
 *
 * Starting in the car rather than the aeroplane: this is a place to look up at,
 * and the first thing a new player should see is the world they know.
 */
export const DEFAULT_SPAWN: SpawnPoint = {
  lon: 28.9944,
  lat: 41.0678,
  name: 'Mecidiyeköy',
  // Up Büyükdere Caddesi toward Levent, which is where the towers are.
  heading: 20,
  altitude: 0,
  vehicle: 'car',
};

export interface UrlState extends SpawnPoint {
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
    // A shared link without a name is a place we cannot name; do not keep the
    // default spawn's label, which would be plainly wrong.
    state.name = params.get('name') ?? 'Seçilen konum';
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
