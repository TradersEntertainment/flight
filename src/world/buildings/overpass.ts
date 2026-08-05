/**
 * Building footprints from OpenStreetMap.
 *
 * Only closed ways are used. Multipolygon relations (buildings with courtyards,
 * and a handful of large complexes) are skipped: they need hole-aware
 * triangulation for a small fraction of the skyline.
 */

import type { Bbox, OverpassResponse } from '../roads/overpass';

export interface Building {
  id: number;
  /** Longitude/latitude ring, not closed. */
  points: Array<{ lon: number; lat: number }>;
  /** Roof height above ground, metres. */
  height: number;
  /** OSM building value, e.g. house, apartments, industrial. */
  kind: string;
}

/**
 * Storey height by building type, metres.
 *
 * Most buildings carry `building:levels` and nothing else, so this multiplier
 * decides the skyline. Offices and hotels have taller floors than flats, and
 * getting that wrong makes a tower district look like a housing estate.
 */
const FLOOR_HEIGHT: Record<string, number> = {
  office: 3.9,
  commercial: 3.9,
  retail: 4.2,
  hotel: 3.4,
  industrial: 5.5,
  warehouse: 6,
  hospital: 3.8,
  church: 6,
  mosque: 6,
  train_station: 5,
  parking: 2.9,
};
const DEFAULT_FLOOR_HEIGHT = 3.1;

/** Fallback heights by building type, metres. */
const DEFAULT_HEIGHT: Record<string, number> = {
  house: 6.5,
  detached: 6.5,
  bungalow: 4,
  hut: 3,
  garage: 3,
  garages: 3,
  shed: 3,
  apartments: 16,
  residential: 12,
  commercial: 12,
  retail: 8,
  office: 22,
  industrial: 9,
  warehouse: 9,
  hotel: 20,
  church: 14,
  mosque: 14,
  school: 9,
  hospital: 20,
  university: 14,
  train_station: 12,
  roof: 4,
};

const GENERIC_HEIGHT = 8.5;

/** Parses a tagged height, which may carry units. */
export function parseHeight(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(-?\d+(?:\.\d+)?)\s*(m|meters?|metres?|ft|feet|')?$/i.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = (match[2] ?? '').toLowerCase();
  return unit === "'" || unit === 'ft' || unit === 'feet' ? amount * 0.3048 : amount;
}

/** Height for a building, from the most reliable tag available. */
export function buildingHeight(tags: Record<string, string>): number {
  const kind = (tags.building === 'yes' ? tags['building:use'] : tags.building) ?? '';

  const tagged = parseHeight(tags.height);
  if (tagged !== null) return clampHeight(tagged);

  const levels = Number(tags['building:levels']);
  if (Number.isFinite(levels) && levels > 0) {
    const perFloor = FLOOR_HEIGHT[kind] ?? DEFAULT_FLOOR_HEIGHT;
    // Roof storeys and a tagged roof height both add on top of the floors.
    const roofLevels = Number(tags['roof:levels']);
    const roof =
      parseHeight(tags['roof:height']) ??
      (Number.isFinite(roofLevels) && roofLevels > 0 ? roofLevels * perFloor : 0);
    // A ground floor is taller than the ones above it in almost every building.
    return clampHeight((levels - 1) * perFloor + perFloor * 1.35 + roof);
  }

  return DEFAULT_HEIGHT[kind] ?? GENERIC_HEIGHT;
}

function clampHeight(height: number): number {
  // Burj Khalifa is 828 m; anything past that is a tagging error.
  return Math.max(2, Math.min(830, height));
}

export function parseBuildings(response: OverpassResponse): Building[] {
  const buildings: Building[] = [];
  for (const element of response.elements ?? []) {
    if (element.type !== 'way' || !element.geometry) continue;
    const tags = element.tags ?? {};
    if (!tags.building && !tags['building:part']) continue;
    if (tags.building === 'no') continue;
    const ring = element.geometry;
    // A footprint must be a closed ring of at least three distinct corners.
    if (ring.length < 4) continue;
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (Math.abs(first.lat - last.lat) > 1e-9 || Math.abs(first.lon - last.lon) > 1e-9) continue;

    buildings.push({
      id: element.id,
      points: ring.slice(0, -1).map((p) => ({ lon: p.lon, lat: p.lat })),
      height: buildingHeight(tags),
      kind: tags.building === 'yes' ? (tags['building:use'] ?? 'yes') : (tags.building ?? 'yes'),
    });
  }
  return buildings;
}

export function buildBuildingQuery(bbox: Bbox): string {
  const box = `${bbox.south.toFixed(5)},${bbox.west.toFixed(5)},${bbox.north.toFixed(5)},${bbox.east.toFixed(5)}`;
  return `[out:json][timeout:25];way["building"](${box});out geom;`;
}

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/** Fetches buildings for a bbox; an unreachable service yields an empty list. */
export async function fetchBuildings(bbox: Bbox, signal?: AbortSignal): Promise<Building[]> {
  const body = buildBuildingQuery(bbox);
  for (const endpoint of ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        body: `data=${encodeURIComponent(body)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal,
      });
      if (!response.ok) continue;
      return parseBuildings((await response.json()) as OverpassResponse);
    } catch {
      if (signal?.aborted) return [];
    }
  }
  return [];
}
