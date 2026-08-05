/**
 * Satellite imagery providers, built from the shared tile-source table.
 *
 * Every provider is optional: when one is unreachable (offline, blocked, out of
 * quota) the renderer falls back to the stylised texture generated from
 * elevation, so the world is never blank. `auto` prefers a keyed provider when a
 * key is available, then Esri.
 */

import { TILE_SOURCES, keyFor, sourceAvailable, tileUrl, type TileSource } from '../tileSources';

export interface ImageryProvider {
  id: string;
  label: string;
  maxZoom: number;
  attribution: string;
  /** Null means "no network tiles" — the stylised elevation texture is used. */
  url: ((z: number, x: number, y: number) => string) | null;
}

export const STYLIZED: ImageryProvider = {
  id: 'stylized',
  label: 'Stilize kabartma',
  maxZoom: 15,
  attribution: '',
  url: null,
};

function fromSource(source: TileSource): ImageryProvider {
  return {
    id: source.id,
    label: source.label,
    maxZoom: source.maxZoom,
    attribution: source.attribution,
    url: (z, x, y) => tileUrl(source, z, x, y),
  };
}

const IMAGERY_SOURCES = Object.values(TILE_SOURCES).filter((s) => s.kind === 'imagery');

export const PROVIDERS: ImageryProvider[] = [STYLIZED, ...IMAGERY_SOURCES.map(fromSource)];

export function providerById(id: string): ImageryProvider {
  return PROVIDERS.find((p) => p.id === id) ?? STYLIZED;
}

/** Providers the current page can actually use (keyed ones need their key). */
export function availableProviders(): ImageryProvider[] {
  return PROVIDERS.filter((p) => {
    const source = TILE_SOURCES[p.id];
    return !source || sourceAvailable(source);
  });
}

/**
 * Resolves the `auto` setting: a keyed provider when its key is present (the
 * proxy counts as present), otherwise Esri.
 */
export function resolveProvider(setting: string): ImageryProvider {
  if (setting !== 'auto') {
    const chosen = providerById(setting);
    const source = TILE_SOURCES[chosen.id];
    return !source || sourceAvailable(source) ? chosen : STYLIZED;
  }
  // A keyed provider is only chosen when the page itself holds the key. Behind
  // the proxy the key lives server-side and we cannot tell whether it is
  // configured, so Esri stays the default and the stylised fallback covers the
  // case where it is unreachable.
  const clientKeyed = IMAGERY_SOURCES.find((s) => s.keyParam && keyFor(s.keyParam));
  if (clientKeyed) return fromSource(clientKeyed);
  return providerById('esri');
}
