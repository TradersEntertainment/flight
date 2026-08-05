/**
 * Terrain texture cache.
 *
 * Resolves the best texture available for a tile: its own satellite imagery if
 * downloaded, otherwise the nearest loaded ancestor (which is what makes zooming
 * in look progressive rather than blank), otherwise the stylised texture
 * generated from elevation — so a tile is never untextured.
 */

import { LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace, Texture } from 'three';
import { idKey, tileParent, uvInAncestor, type TileId } from '../../geo/tilemath';
import type { ElevationStore } from '../elevation';
import type { TileFetcher } from '../tiles/fetcher';
import type { ImageryProvider } from '../imagery/providers';

export interface ResolvedTexture {
  texture: Texture;
  scale: number;
  offsetX: number;
  offsetY: number;
  /** Zoom of the texture actually used; equal to tile.z when exact. */
  z: number;
}

interface Entry {
  texture: Texture;
  lastUsed: number;
}

/** Consecutive failures before the satellite provider is abandoned. */
const FAILURE_LIMIT = 8;

export class TerrainTextures {
  private readonly satellite = new Map<string, Entry>();
  private readonly stylised = new Map<string, Entry>();
  private readonly requested = new Set<string>();
  private frame = 0;
  private failures = 0;
  private successes = 0;
  /** Set once the satellite provider has failed enough to be given up on. */
  degraded = false;
  onDegrade: ((reason: string) => void) | null = null;

  constructor(
    private readonly elevation: ElevationStore,
    private readonly fetcher: TileFetcher,
    private provider: ImageryProvider,
    private budget = 320,
  ) {}

  setProvider(provider: ImageryProvider): void {
    if (provider.id === this.provider.id) return;
    this.provider = provider;
    this.failures = 0;
    this.successes = 0;
    this.degraded = false;
    for (const entry of this.satellite.values()) disposeTexture(entry.texture);
    this.satellite.clear();
    this.requested.clear();
  }

  setBudget(n: number): void {
    this.budget = n;
  }

  get imageryZoomLimit(): number {
    return this.usesSatellite ? this.provider.maxZoom : 15;
  }

  get usesSatellite(): boolean {
    return this.provider.url !== null && !this.degraded;
  }

  get attribution(): string {
    return this.usesSatellite ? this.provider.attribution : '';
  }

  tick(): void {
    this.frame++;
  }

  /** Queues the satellite image for a tile; stylised textures need no request. */
  request(id: TileId, priority: number): void {
    if (!this.usesSatellite) return;
    const z = Math.min(id.z, this.provider.maxZoom);
    if (z !== id.z) return;
    const key = idKey(id);
    if (this.requested.has(key) || this.satellite.has(key)) return;
    // Until one tile has arrived, keep only a few requests in flight. Without
    // this an unreachable provider produces hundreds of failures before the
    // fallback trips, on exactly the connections that can least afford it.
    if (this.successes === 0 && this.requested.size >= FAILURE_LIMIT) return;
    const url = this.provider.url!(id.z, id.x, id.y);
    if (!url) return;
    this.requested.add(key);
    this.fetcher
      .request(url, priority)
      .then(async (buffer) => {
        const bitmap = await createImageBitmap(new Blob([buffer]));
        const texture = makeTexture(bitmap);
        this.satellite.set(key, { texture, lastUsed: this.frame });
        this.successes++;
        this.failures = 0;
        this.trim(this.satellite);
      })
      .catch(() => {
        this.requested.delete(key);
        this.failures++;
        if (!this.degraded && this.failures >= FAILURE_LIMIT && this.successes === 0) {
          this.degraded = true;
          this.onDegrade?.(
            `${this.provider.label} erişilemedi — stilize arazi dokusuna geçildi.`,
          );
        }
      });
  }

  /** Best available texture for a tile, walking up ancestors as needed. */
  resolve(id: TileId): ResolvedTexture | null {
    if (this.usesSatellite) {
      const found = this.walk(id, this.provider.maxZoom, (key) => this.satellite.get(key));
      if (found) return found;
    }
    return this.walk(id, 15, (key, tile) => this.stylisedFor(key, tile));
  }

  private walk(
    id: TileId,
    maxZoom: number,
    lookup: (key: string, tile: TileId) => Entry | null | undefined,
  ): ResolvedTexture | null {
    let cursor: TileId | null = { ...id };
    while (cursor && cursor.z > maxZoom) cursor = tileParent(cursor);
    while (cursor) {
      const entry = lookup(idKey(cursor), cursor);
      if (entry) {
        entry.lastUsed = this.frame;
        const uv = uvInAncestor(id, cursor);
        return { texture: entry.texture, ...uv, z: cursor.z };
      }
      cursor = tileParent(cursor);
    }
    return null;
  }

  /** Uploads the stylised bitmap for a tile the first time it is needed. */
  private stylisedFor(key: string, tile: TileId): Entry | null {
    const existing = this.stylised.get(key);
    if (existing) return existing;
    const bitmap = this.elevation.takeBitmap(tile);
    if (!bitmap) return null;
    const entry: Entry = { texture: makeTexture(bitmap), lastUsed: this.frame };
    this.stylised.set(key, entry);
    this.trim(this.stylised);
    return entry;
  }

  private trim(map: Map<string, Entry>): void {
    if (map.size <= this.budget) return;
    const sorted = [...map.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    const excess = map.size - this.budget;
    for (let i = 0; i < excess; i++) {
      const [key, entry] = sorted[i];
      // Never drop a texture used this frame: a tile would flash.
      if (entry.lastUsed >= this.frame - 1) continue;
      disposeTexture(entry.texture);
      map.delete(key);
    }
  }

  get stats() {
    return { satellite: this.satellite.size, stylised: this.stylised.size };
  }

  dispose(): void {
    for (const entry of this.satellite.values()) disposeTexture(entry.texture);
    for (const entry of this.stylised.values()) disposeTexture(entry.texture);
    this.satellite.clear();
    this.stylised.clear();
  }
}

/** Frees the GPU texture and the ImageBitmap backing it. */
function disposeTexture(texture: Texture): void {
  texture.dispose();
  const image = texture.image as ImageBitmap | undefined;
  image?.close?.();
}

function makeTexture(bitmap: ImageBitmap): Texture {
  const texture = new Texture(bitmap);
  // v runs north to south to match the tile scheme (see uvInAncestor).
  texture.flipY = false;
  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}
