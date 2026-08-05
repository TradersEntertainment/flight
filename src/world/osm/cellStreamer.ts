/**
 * Streams OpenStreetMap data in geographic cells around the player.
 *
 * Roads and buildings both need the same thing: fetch a bounding box once, build
 * scene geometry from it, keep it positioned as the world anchor moves, and drop
 * it when the player leaves. Sharing this also shares the request gate, so the
 * two layers queue through one slot instead of both hammering a public service.
 */

import { Group } from 'three';
import type { Anchor } from '../../geo/anchor';
import { latToMercatorY, lonToMercatorX } from '../../geo/mercator';
import type { Bbox } from '../roads/overpass';

/**
 * One request at a time across every layer.
 *
 * Overpass is a shared volunteer-run service; a game that fans out ten parallel
 * queries per second is the reason such services end up rate limiting.
 */
class RequestGate {
  private queue: Array<() => void> = [];
  private active = 0;

  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }

  get pending(): number {
    return this.queue.length + this.active;
  }
}

const GATE = new RequestGate(1);

export interface CellContext {
  bbox: Bbox;
  /** Mercator centre of the cell. */
  merc: { x: number; y: number };
  /** World position of the cell centre at build time. */
  centre: { x: number; z: number };
  anchor: Anchor;
}

export interface BuiltCell<D> {
  group: Group;
  /** Anything the caller wants to keep for queries, e.g. road segments. */
  data?: D;
}

interface Cell<D> {
  key: string;
  merc: { x: number; y: number };
  group: Group;
  builtScale: number;
  state: 'loading' | 'ready' | 'empty';
  lastUsed: number;
  abort: AbortController | null;
  data?: D;
}

export interface StreamerOptions<T, D> {
  name: string;
  /** Cell size in degrees. */
  cellDegrees: number;
  /** Cells kept around the player, as a radius in cells. */
  radius: number;
  maxCells: number;
  fetch: (bbox: Bbox, signal?: AbortSignal) => Promise<T[]>;
  build: (items: T[], context: CellContext) => BuiltCell<D> | null;
  /** Frees geometry owned by a cell. */
  disposeCell: (group: Group) => void;
}

export class CellStreamer<T, D = unknown> {
  readonly group = new Group();
  private readonly cells = new Map<string, Cell<D>>();
  private frame = 0;
  private anchorEpoch = -1;
  private readyList: Array<{ data: D; group: Group }> = [];
  enabled = true;
  /** Set once a fetch has returned data, so the UI can credit the source. */
  hasData = false;

  constructor(private readonly options: StreamerOptions<T, D>) {
    this.group.name = options.name;
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  update(anchor: Anchor, lon: number, lat: number): void {
    if (!this.enabled) return;
    this.frame++;

    if (anchor.epoch !== this.anchorEpoch) {
      this.anchorEpoch = anchor.epoch;
      for (const cell of this.cells.values()) this.position(cell, anchor);
    }

    const size = this.options.cellDegrees;
    const cellX = Math.floor(lon / size);
    const cellY = Math.floor(lat / size);
    const radius = this.options.radius;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        this.ensureCell(cellX + dx, cellY + dy, anchor);
      }
    }
    this.evict();
  }

  /**
   * Cells that currently hold data, for spatial queries.
   *
   * A cached array rather than a generator: the car asks about the road under
   * it several times per physics step, and allocating an iterator each time
   * showed up in the profile.
   */
  get ready(): ReadonlyArray<{ data: D; group: Group }> {
    return this.readyList;
  }

  private refreshReady(): void {
    this.readyList = [];
    for (const cell of this.cells.values()) {
      if (cell.state === 'ready' && cell.data !== undefined) {
        this.readyList.push({ data: cell.data, group: cell.group });
      }
    }
  }

  private ensureCell(cellX: number, cellY: number, anchor: Anchor): void {
    const key = `${cellX}/${cellY}`;
    const existing = this.cells.get(key);
    if (existing) {
      existing.lastUsed = this.frame;
      return;
    }

    const size = this.options.cellDegrees;
    const bbox: Bbox = {
      west: cellX * size,
      south: cellY * size,
      east: (cellX + 1) * size,
      north: (cellY + 1) * size,
    };
    const centreLon = (bbox.west + bbox.east) / 2;
    const centreLat = (bbox.south + bbox.north) / 2;
    const cell: Cell<D> = {
      key,
      merc: { x: lonToMercatorX(centreLon), y: latToMercatorY(centreLat) },
      group: new Group(),
      builtScale: anchor.scale,
      state: 'loading',
      lastUsed: this.frame,
      abort: new AbortController(),
    };
    this.cells.set(key, cell);

    void GATE.run(() => this.options.fetch(bbox, cell.abort?.signal))
      .then((items) => {
        cell.abort = null;
        if (!this.cells.has(key)) return;
        if (items.length === 0) {
          cell.state = 'empty';
          return;
        }
        this.hasData = true;
        this.ingest(cell, items, bbox, anchor);
      })
      .catch(() => {
        cell.state = 'empty';
      });
  }

  private ingest(cell: Cell<D>, items: T[], bbox: Bbox, anchor: Anchor): void {
    const centre = anchor.worldFromMercator(cell.merc.x, cell.merc.y);
    const built = this.options.build(items, { bbox, merc: cell.merc, centre, anchor });
    if (!built) {
      cell.state = 'empty';
      return;
    }
    cell.group = built.group;
    cell.data = built.data;
    cell.builtScale = anchor.scale;
    cell.state = 'ready';
    this.position(cell, anchor);
    this.group.add(cell.group);
    this.refreshReady();
  }

  /**
   * Feeds a cell directly, bypassing the network.
   *
   * Used by the screenshot harness and by tests to exercise the geometry path
   * without a live Overpass service.
   */
  ingestDirect(lon: number, lat: number, items: T[], anchor: Anchor): void {
    const size = this.options.cellDegrees;
    const cellX = Math.floor(lon / size);
    const cellY = Math.floor(lat / size);
    const key = `${cellX}/${cellY}`;
    const previous = this.cells.get(key);
    if (previous) {
      this.disposeCell(previous);
      this.cells.delete(key);
    }
    const bbox: Bbox = {
      west: cellX * size,
      south: cellY * size,
      east: (cellX + 1) * size,
      north: (cellY + 1) * size,
    };
    const cell: Cell<D> = {
      key,
      merc: {
        x: lonToMercatorX((bbox.west + bbox.east) / 2),
        y: latToMercatorY((bbox.south + bbox.north) / 2),
      },
      group: new Group(),
      builtScale: anchor.scale,
      state: 'loading',
      lastUsed: this.frame,
      abort: null,
    };
    this.cells.set(key, cell);
    this.hasData = true;
    this.ingest(cell, items, bbox, anchor);
  }

  private position(cell: Cell<D>, anchor: Anchor): void {
    const world = anchor.worldFromMercator(cell.merc.x, cell.merc.y);
    cell.group.position.set(world.x, 0, world.z);
    // Local offsets were baked with the anchor scale of the build; correct for
    // the new one rather than rebuilding the geometry.
    const scale = anchor.scale / cell.builtScale;
    cell.group.scale.set(scale, 1, scale);
  }

  private evict(): void {
    if (this.cells.size <= this.options.maxCells) return;
    const sorted = [...this.cells.values()].sort((a, b) => a.lastUsed - b.lastUsed);
    const excess = this.cells.size - this.options.maxCells;
    for (let i = 0; i < excess; i++) {
      const cell = sorted[i];
      if (cell.lastUsed >= this.frame - 1) continue;
      this.disposeCell(cell);
      this.cells.delete(cell.key);
    }
    this.refreshReady();
  }

  private disposeCell(cell: Cell<D>): void {
    cell.abort?.abort();
    this.group.remove(cell.group);
    this.options.disposeCell(cell.group);
  }

  clear(): void {
    for (const cell of this.cells.values()) this.disposeCell(cell);
    this.cells.clear();
    this.readyList = [];
  }

  get stats(): { cells: number; ready: number; pending: number } {
    let ready = 0;
    for (const cell of this.cells.values()) if (cell.state === 'ready') ready++;
    return { cells: this.cells.size, ready, pending: GATE.pending };
  }
}
