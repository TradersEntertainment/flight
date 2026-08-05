/**
 * Elevation store and height sampler.
 *
 * Owns decoded elevation tiles, answers "how high is the ground here" for the
 * whole game (vehicles, camera, water test, minimap) and hands the stylised
 * fallback texture to the terrain renderer.
 *
 * Sampling is bilinear in global pixel space, so neighbouring render tiles that
 * share an edge read exactly the same height and meet without a crack.
 */

import { TILE_PIXELS, type ElevationEncoding } from './terrarium';
import { latToTileY, lonToTileX, tileAt, tileKey, type TileId } from '../geo/tilemath';
import { metersPerPixel } from '../geo/mercator';
import { TileFetcher } from './tiles/fetcher';
import { TILE_SOURCES, tileUrl } from './tileSources';
import type { DecodeError, DecodeRequest, DecodeResponse } from './tiles/elevation.worker';

export const ELEVATION_MAX_ZOOM = 15;
export const ELEVATION_MIN_ZOOM = 4;

export interface ElevationSource {
  id: string;
  url: (z: number, x: number, y: number) => string;
  encoding: ElevationEncoding;
  maxZoom: number;
  attribution: string;
}

export const TERRARIUM: ElevationSource = {
  id: 'terrarium',
  url: (z, x, y) => tileUrl(TILE_SOURCES.terrarium, z, x, y),
  encoding: 'terrarium',
  maxZoom: ELEVATION_MAX_ZOOM,
  attribution: TILE_SOURCES.terrarium.attribution,
};

type TileState = 'loading' | 'ready' | 'failed';

interface ElevationTile {
  id: TileId;
  key: string;
  state: TileState;
  heights: Float32Array | null;
  size: number;
  min: number;
  max: number;
  /** Stylised imagery generated alongside the heights; consumed by terrain. */
  bitmap: ImageBitmap | null;
  lastUsed: number;
}

export type TileReadyListener = (id: TileId) => void;

export class ElevationStore {
  private readonly tiles = new Map<string, ElevationTile>();
  private readonly zoomsLoaded = new Set<number>();
  private readonly workers: Worker[] = [];
  private readonly listeners = new Set<TileReadyListener>();
  private nextWorker = 0;
  private frame = 0;
  /** Tiles kept in memory; each is ~256 KB of Float32 plus a bitmap. */
  budget = 260;

  constructor(
    private readonly fetcher: TileFetcher,
    private readonly source: ElevationSource = TERRARIUM,
    workerCount = Math.max(1, Math.min(3, (navigator.hardwareConcurrency ?? 4) - 1)),
  ) {
    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(new URL('./tiles/elevation.worker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = (e: MessageEvent<DecodeResponse | DecodeError>) => this.onDecoded(e.data);
      this.workers.push(worker);
    }
  }

  onTileReady(fn: TileReadyListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get stats() {
    return {
      tiles: this.tiles.size,
      loading: [...this.tiles.values()].filter((t) => t.state === 'loading').length,
    };
  }

  /** Advances the internal clock used for LRU eviction. */
  tick(): void {
    this.frame++;
  }

  isLoaded(id: TileId): boolean {
    return this.tiles.get(tileKey(id.z, id.x, id.y))?.state === 'ready';
  }

  /**
   * Hands the stylised texture for a tile to the renderer.
   *
   * Ownership transfers: the store drops its reference without closing the
   * bitmap, because the GPU upload happens later, on first draw. Closing it here
   * would detach the pixels and produce an empty texture. The caller closes it
   * when it disposes the texture.
   */
  takeBitmap(id: TileId): ImageBitmap | null {
    const tile = this.tiles.get(tileKey(id.z, id.x, id.y));
    if (tile?.state !== 'ready' || !tile.bitmap) return null;
    const bitmap = tile.bitmap;
    tile.bitmap = null;
    return bitmap;
  }

  request(id: TileId, priority = 0): void {
    const z = Math.min(id.z, this.source.maxZoom);
    if (z !== id.z) return; // callers must clamp; nothing exists above maxZoom
    const key = tileKey(z, id.x, id.y);
    const existing = this.tiles.get(key);
    if (existing) {
      existing.lastUsed = this.frame;
      return;
    }
    const tile: ElevationTile = {
      id: { z, x: id.x, y: id.y },
      key,
      state: 'loading',
      heights: null,
      size: TILE_PIXELS,
      min: 0,
      max: 0,
      bitmap: null,
      lastUsed: this.frame,
    };
    this.tiles.set(key, tile);
    const url = this.source.url(z, id.x, id.y);
    this.fetcher
      .request(url, priority)
      .then((buffer) => this.decode(tile, buffer))
      .catch(() => {
        tile.state = 'failed';
        // A failed tile is dropped so a later pass can retry it.
        setTimeout(() => {
          if (this.tiles.get(key)?.state === 'failed') this.tiles.delete(key);
        }, 5000);
      });
  }

  private decode(tile: ElevationTile, buffer: ArrayBuffer): void {
    const worker = this.workers[this.nextWorker++ % this.workers.length];
    const req: DecodeRequest = {
      type: 'decode',
      key: tile.key,
      buffer,
      encoding: this.source.encoding,
      metersPerSample: this.metersPerSample(tile.id),
      wantTexture: true,
    };
    worker.postMessage(req, [buffer]);
  }

  private metersPerSample(id: TileId): number {
    const lat = tileLatitude(id);
    return metersPerPixel(lat, id.z);
  }

  private onDecoded(msg: DecodeResponse | DecodeError): void {
    const tile = this.tiles.get(msg.key);
    if (!tile) return;
    if (msg.type === 'error') {
      tile.state = 'failed';
      return;
    }
    tile.heights = msg.heights;
    tile.size = msg.size;
    tile.min = msg.min;
    tile.max = msg.max;
    tile.bitmap = msg.texture ?? null;
    tile.state = 'ready';
    this.zoomsLoaded.add(tile.id.z);
    for (const fn of this.listeners) fn(tile.id);
    this.evict();
  }

  private evict(): void {
    if (this.tiles.size <= this.budget) return;
    const ready = [...this.tiles.values()]
      .filter((t) => t.state === 'ready')
      .sort((a, b) => a.lastUsed - b.lastUsed);
    let excess = this.tiles.size - this.budget;
    for (const tile of ready) {
      if (excess <= 0) break;
      // Keep the coarse tiles: they are the safety net for the height sampler.
      if (tile.id.z <= 8) continue;
      tile.bitmap?.close();
      this.tiles.delete(tile.key);
      excess--;
    }
  }

  /** Highest zoom whose data covers a point, or null when nothing is loaded. */
  bestZoomAt(lon: number, lat: number): number | null {
    for (let z = this.source.maxZoom; z >= ELEVATION_MIN_ZOOM; z--) {
      if (!this.zoomsLoaded.has(z)) continue;
      const id = tileAt(lon, lat, z);
      const tile = this.tiles.get(tileKey(z, id.x, id.y));
      if (tile?.state === 'ready') return z;
    }
    return null;
  }

  /**
   * Ground height in metres. Returns sea level when no tile covering the point
   * has loaded yet, so callers never see NaN; use `bestZoomAt` to detect that.
   */
  sample(lon: number, lat: number): number {
    const z = this.bestZoomAt(lon, lat);
    if (z === null) return 0;
    return this.sampleAtZoom(lon, lat, z) ?? 0;
  }

  /** Height range of a decoded tile, for bounding volumes. */
  statsFor(id: TileId): { min: number; max: number } | null {
    const tile = this.tiles.get(tileKey(id.z, id.x, id.y));
    return tile?.state === 'ready' ? { min: tile.min, max: tile.max } : null;
  }

  /**
   * Samples at a fixed level of detail, falling back to coarser data only.
   *
   * Terrain meshes use this rather than `sample` so every vertex of a tile comes
   * from one resolution: mixing levels within a mesh makes it change shape as
   * finer neighbours stream in.
   */
  sampleAtZoomOrCoarser(lon: number, lat: number, z: number): number {
    for (let level = Math.min(z, this.source.maxZoom); level >= ELEVATION_MIN_ZOOM; level--) {
      const h = this.sampleAtZoom(lon, lat, level);
      if (h !== null) return h;
    }
    return 0;
  }

  /** Bilinear sample at an explicit zoom; null when the tile is missing. */
  sampleAtZoom(lon: number, lat: number, z: number): number | null {
    const primaryId = tileAt(lon, lat, z);
    const primary = this.tiles.get(tileKey(z, primaryId.x, primaryId.y));
    if (!primary || primary.state !== 'ready' || !primary.heights) return null;
    primary.lastUsed = this.frame;

    const size = primary.size;
    const gx = lonToTileX(lon, z) * size - 0.5;
    const gy = latToTileY(lat, z) * size - 0.5;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;

    const h00 = this.readPixel(z, x0, y0, primary);
    const h10 = this.readPixel(z, x0 + 1, y0, primary);
    const h01 = this.readPixel(z, x0, y0 + 1, primary);
    const h11 = this.readPixel(z, x0 + 1, y0 + 1, primary);
    const top = h00 + (h10 - h00) * fx;
    const bottom = h01 + (h11 - h01) * fx;
    return top + (bottom - top) * fy;
  }

  /**
   * One elevation sample in global pixel coordinates. Samples that fall in a
   * neighbouring tile use it when loaded, otherwise clamp into `primary` — the
   * error is confined to a single sample at the tile border.
   */
  private readPixel(z: number, gx: number, gy: number, primary: ElevationTile): number {
    const size = primary.size;
    const world = size * 2 ** z;
    const cx = Math.max(0, Math.min(world - 1, gx));
    const cy = Math.max(0, Math.min(world - 1, gy));
    const tx = Math.floor(cx / size);
    const ty = Math.floor(cy / size);
    let tile = primary;
    if (tx !== primary.id.x || ty !== primary.id.y) {
      const neighbour = this.tiles.get(tileKey(z, tx, ty));
      if (neighbour?.state === 'ready' && neighbour.heights) {
        neighbour.lastUsed = this.frame;
        tile = neighbour;
      } else {
        // Clamp into the primary tile.
        const lx = Math.max(0, Math.min(size - 1, cx - primary.id.x * size));
        const ly = Math.max(0, Math.min(size - 1, cy - primary.id.y * size));
        return primary.heights![Math.floor(ly) * size + Math.floor(lx)];
      }
    }
    const lx = Math.floor(cx - tile.id.x * size);
    const ly = Math.floor(cy - tile.id.y * size);
    return tile.heights![ly * size + lx];
  }

  /** True when the point is at or below sea level (see KNOWN_ISSUES.md). */
  isWater(lon: number, lat: number): boolean {
    return this.sample(lon, lat) <= 0;
  }

  /** Loads the tiles needed to sample a point at full detail. */
  ensureAt(lon: number, lat: number, zoom = this.source.maxZoom, priority = 0): void {
    const z = Math.min(zoom, this.source.maxZoom);
    const id = tileAt(lon, lat, z);
    this.request(id, priority);
  }

  dispose(): void {
    for (const worker of this.workers) worker.terminate();
    for (const tile of this.tiles.values()) tile.bitmap?.close();
    this.tiles.clear();
  }
}

function tileLatitude(id: TileId): number {
  const n = 2 ** id.z;
  const yc = (id.y + 0.5) / n;
  const rad = Math.atan(Math.sinh(Math.PI * (1 - 2 * yc)));
  return (rad * 180) / Math.PI;
}
