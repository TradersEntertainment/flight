/**
 * Road geometry from OpenStreetMap, via Overpass.
 *
 * Parsing is separated from fetching so the shape of the data can be tested
 * without touching the network. Requests are cell-based and cached; the public
 * Overpass endpoint is a shared resource and this stays well inside its usage
 * policy (one request at a time, results reused for the session).
 */

export type RoadClass = 'motorway' | 'trunk' | 'primary' | 'secondary' | 'minor';

export interface RoadWay {
  id: number;
  name: string | null;
  roadClass: RoadClass;
  /** Longitude/latitude pairs along the way. */
  points: Array<{ lon: number; lat: number }>;
  lit: boolean;
}

export interface OverpassElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
}

export interface OverpassResponse {
  elements?: OverpassElement[];
}

const CLASS_OF: Record<string, RoadClass> = {
  motorway: 'motorway',
  motorway_link: 'motorway',
  trunk: 'trunk',
  trunk_link: 'trunk',
  primary: 'primary',
  primary_link: 'primary',
  secondary: 'secondary',
  secondary_link: 'secondary',
  tertiary: 'minor',
  unclassified: 'minor',
  residential: 'minor',
};

/** Lane width per class, in metres. */
export const ROAD_WIDTH: Record<RoadClass, number> = {
  motorway: 15,
  trunk: 12,
  primary: 9.5,
  secondary: 8,
  minor: 6,
};

/** Spacing of street lamps per class, in metres; null means unlit by default. */
export const LAMP_SPACING: Record<RoadClass, number | null> = {
  motorway: 45,
  trunk: 45,
  primary: 38,
  secondary: 34,
  minor: null,
};

export function parseOverpass(response: OverpassResponse): RoadWay[] {
  const ways: RoadWay[] = [];
  for (const element of response.elements ?? []) {
    if (element.type !== 'way' || !element.geometry || element.geometry.length < 2) continue;
    const highway = element.tags?.highway;
    if (!highway) continue;
    const roadClass = CLASS_OF[highway];
    if (!roadClass) continue;
    ways.push({
      id: element.id,
      name: element.tags?.name ?? element.tags?.ref ?? null,
      roadClass,
      lit: element.tags?.lit === 'yes',
      points: element.geometry.map((p) => ({ lon: p.lon, lat: p.lat })),
    });
  }
  return ways;
}

export interface Bbox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export function buildQuery(bbox: Bbox): string {
  const box = `${bbox.south.toFixed(5)},${bbox.west.toFixed(5)},${bbox.north.toFixed(5)},${bbox.east.toFixed(5)}`;
  return `[out:json][timeout:25];
way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential)(_link)?$"](${box});
out geom;`;
}

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/**
 * Fetches roads for a bounding box.
 *
 * Endpoints are tried in order; a failure at every endpoint resolves to an
 * empty list rather than rejecting, because roads are decoration — the game
 * must keep running without them.
 */
export async function fetchRoads(bbox: Bbox, signal?: AbortSignal): Promise<RoadWay[]> {
  const body = buildQuery(bbox);
  for (const endpoint of ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        body: `data=${encodeURIComponent(body)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal,
      });
      if (!response.ok) continue;
      return parseOverpass((await response.json()) as OverpassResponse);
    } catch {
      if (signal?.aborted) return [];
    }
  }
  return [];
}
