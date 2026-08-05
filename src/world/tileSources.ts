/**
 * Upstream tile services, in one table shared by the client and the dev/edge
 * tile proxy (server/tileProxy.ts).
 *
 * The client can address a source directly or through the proxy; the proxy uses
 * the same table to build the upstream URL, so the two can never drift apart.
 * Routing through a proxy is what keeps API keys off the client and lets a CDN
 * absorb repeat traffic.
 */

export type SourceKind = 'elevation' | 'imagery';

export interface TileSource {
  id: string;
  kind: SourceKind;
  label: string;
  /** `{z}`, `{x}`, `{y}` and optionally `{key}` are substituted. */
  template: string;
  minZoom: number;
  maxZoom: number;
  attribution: string;
  /** Name of the key: `?<param>=` on the client, `<ENV>` on the proxy. */
  keyParam?: string;
  keyEnv?: string;
}

export const TILE_SOURCES: Record<string, TileSource> = {
  terrarium: {
    id: 'terrarium',
    kind: 'elevation',
    label: 'Terrarium (AWS Open Data)',
    template: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    minZoom: 0,
    maxZoom: 15,
    attribution: 'Terrain: Mapzen / AWS Open Data',
  },
  esri: {
    id: 'esri',
    kind: 'imagery',
    label: 'Esri World Imagery',
    // Row-major service: y comes before x.
    template:
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    minZoom: 0,
    maxZoom: 19,
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
  },
  eox: {
    id: 'eox',
    kind: 'imagery',
    label: 'Sentinel-2 cloudless',
    template:
      'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg',
    minZoom: 0,
    maxZoom: 14,
    attribution: 'Sentinel-2 cloudless © EOX IT Services, contains Copernicus data',
  },
  maptiler: {
    id: 'maptiler',
    kind: 'imagery',
    label: 'MapTiler Satellite',
    template: 'https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key={key}',
    minZoom: 0,
    maxZoom: 20,
    attribution: 'Imagery © MapTiler © OpenStreetMap contributors',
    keyParam: 'maptiler',
    keyEnv: 'MAPTILER_KEY',
  },
};

export function fillTemplate(
  template: string,
  z: number,
  x: number,
  y: number,
  key?: string,
): string {
  return template
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
    .replace('{key}', key ?? '');
}

/**
 * Where tile requests go.
 *
 * `?tiles=proxy` routes through the local/edge proxy, `?tiles=direct` forces
 * direct requests. The default is direct, so a static deploy needs no server.
 */
export function tileBase(): string | null {
  if (typeof location === 'undefined') return null;
  const mode = new URLSearchParams(location.search).get('tiles');
  if (mode === 'proxy') return '/tiles';
  if (mode === 'direct') return null;
  return null;
}

/** Client-side URL for a tile, honouring the routing mode. */
export function tileUrl(source: TileSource, z: number, x: number, y: number): string {
  const base = tileBase();
  if (base) return `${base}/${source.id}/${z}/${x}/${y}`;
  const key = source.keyParam ? keyFor(source.keyParam) : undefined;
  return fillTemplate(source.template, z, x, y, key ?? undefined);
}

export function keyFor(param: string): string | null {
  if (typeof location === 'undefined') return null;
  return new URLSearchParams(location.search).get(param);
}

/** True when a source can be used: keyed sources need their key present. */
export function sourceAvailable(source: TileSource): boolean {
  if (!source.keyParam) return true;
  if (tileBase()) return true; // the proxy supplies the key
  return keyFor(source.keyParam) !== null;
}
