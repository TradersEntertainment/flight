/**
 * Tile proxy.
 *
 * Serves `/tiles/{source}/{z}/{x}/{y}` from the upstream services listed in
 * src/world/tileSources.ts. It exists for three reasons:
 *
 *  - API keys stay server-side (`MAPTILER_KEY` and friends),
 *  - responses can be cached hard, so repeat play costs the upstream nothing,
 *  - environments whose browsers cannot reach the internet directly (CI, locked
 *    down networks) can still run the game.
 *
 * Mounted into Vite's dev and preview servers; the same handler shape works as a
 * Cloudflare Worker or a small Node service in production.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { TILE_SOURCES, fillTemplate } from '../src/world/tileSources';

const MAX_ZOOM_GUARD = 22;
const CACHE_SECONDS = 60 * 60 * 24 * 30;

interface CacheEntry {
  status: number;
  body: Buffer;
  contentType: string;
}

/** Small in-process cache so a reload does not re-fetch the same tiles. */
const memory = new Map<string, CacheEntry>();
const MEMORY_LIMIT = 1500;

export interface TileProxyOptions {
  prefix?: string;
  /** Reads a key by env var name; defaults to process.env. */
  keyLookup?: (envName: string) => string | undefined;
}

export function createTileProxy(options: TileProxyOptions = {}) {
  const prefix = options.prefix ?? '/tiles';
  const keyLookup = options.keyLookup ?? ((name: string) => process.env[name]);

  return async function tileProxy(
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ): Promise<void> {
    const url = req.url ?? '';
    if (!url.startsWith(`${prefix}/`)) return next();

    const path = url.slice(prefix.length + 1).split('?')[0];
    const parts = path.split('/');
    if (parts.length !== 4) return fail(res, 400, 'expected {source}/{z}/{x}/{y}');

    const [sourceId, zRaw, xRaw, yRaw] = parts;
    const source = TILE_SOURCES[sourceId];
    if (!source) return fail(res, 404, `unknown source ${sourceId}`);

    const z = Number(zRaw);
    const x = Number(xRaw);
    const y = Number(yRaw);
    if (![z, x, y].every(Number.isInteger) || z < 0 || z > MAX_ZOOM_GUARD) {
      return fail(res, 400, 'bad tile coordinates');
    }
    const limit = 2 ** z;
    if (x < 0 || x >= limit || y < 0 || y >= limit || z > source.maxZoom) {
      return fail(res, 404, 'tile outside source range');
    }

    const cacheKey = `${sourceId}/${z}/${x}/${y}`;
    const hit = memory.get(cacheKey);
    if (hit) return send(res, hit, 'HIT');

    const key = source.keyEnv ? keyLookup(source.keyEnv) : undefined;
    if (source.keyEnv && !key) return fail(res, 503, `${source.keyEnv} is not configured`);

    try {
      const upstream = await fetch(fillTemplate(source.template, z, x, y, key), {
        headers: { 'User-Agent': 'flight-game/0.1 (tile proxy)' },
      });
      const body = Buffer.from(await upstream.arrayBuffer());
      const entry: CacheEntry = {
        status: upstream.status,
        body,
        contentType: upstream.headers.get('content-type') ?? 'application/octet-stream',
      };
      if (upstream.ok) {
        if (memory.size >= MEMORY_LIMIT) {
          // Cheap eviction: drop the oldest quarter.
          const drop = Math.floor(MEMORY_LIMIT / 4);
          let i = 0;
          for (const k of memory.keys()) {
            memory.delete(k);
            if (++i >= drop) break;
          }
        }
        memory.set(cacheKey, entry);
      }
      send(res, entry, 'MISS');
    } catch (err) {
      fail(res, 502, err instanceof Error ? err.message : 'upstream failed');
    }
  };
}

function send(res: ServerResponse, entry: CacheEntry, cacheState: string): void {
  res.statusCode = entry.status;
  res.setHeader('Content-Type', entry.contentType);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', `public, max-age=${CACHE_SECONDS}, immutable`);
  res.setHeader('X-Tile-Cache', cacheState);
  res.end(entry.body);
}

function fail(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(message);
}
