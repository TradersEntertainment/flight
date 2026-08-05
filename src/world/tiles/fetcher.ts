/**
 * Priority-ordered tile downloader with an IndexedDB byte cache.
 *
 * Requests carry a priority (lower = sooner, driven by camera distance) and can
 * be cancelled when a tile leaves the view before its turn comes up.
 */

interface Pending {
  url: string;
  priority: number;
  resolve: (v: ArrayBuffer) => void;
  reject: (e: Error) => void;
  controller: AbortController;
  cancelled: boolean;
}

const DB_NAME = 'flight-tiles';
const STORE = 'bytes';
const DB_VERSION = 1;
/** Cached tiles are dropped after this many days. */
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;

class ByteCache {
  private db: IDBDatabase | null = null;
  private ready: Promise<void>;
  private writes = 0;

  constructor() {
    this.ready = this.open();
  }

  private open(): Promise<void> {
    return new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') return resolve();
      let req: IDBOpenDBRequest;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch {
        return resolve();
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => {
        this.db = req.result;
        resolve();
      };
      req.onerror = () => resolve(); // private mode or quota — run without a cache
    });
  }

  async get(url: string): Promise<ArrayBuffer | null> {
    await this.ready;
    if (!this.db) return null;
    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(url);
        req.onsuccess = () => {
          const row = req.result as { at: number; bytes: ArrayBuffer } | undefined;
          if (!row || Date.now() - row.at > MAX_AGE_MS) return resolve(null);
          resolve(row.bytes);
        };
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async put(url: string, bytes: ArrayBuffer): Promise<void> {
    await this.ready;
    if (!this.db) return;
    try {
      const tx = this.db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ at: Date.now(), bytes }, url);
      if (++this.writes % 400 === 0) void this.trim();
    } catch {
      /* quota exceeded — the cache is best-effort */
    }
  }

  /** Drops the oldest half once the store grows past a few thousand tiles. */
  private async trim(): Promise<void> {
    if (!this.db) return;
    try {
      const tx = this.db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const countReq = store.count();
      countReq.onsuccess = () => {
        const excess = countReq.result - 3000;
        if (excess <= 0) return;
        let removed = 0;
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor || removed >= excess) return;
          cursor.delete();
          removed++;
          cursor.continue();
        };
      };
    } catch {
      /* ignore */
    }
  }
}

export class TileFetcher {
  private queue: Pending[] = [];
  private active = 0;
  private readonly inflight = new Map<string, Pending>();
  private readonly cache = new ByteCache();
  /** Requests that completed from the byte cache rather than the network. */
  stats = { network: 0, cached: 0, failed: 0 };

  constructor(private concurrency = 8) {}

  setConcurrency(n: number): void {
    this.concurrency = Math.max(1, n);
    this.pump();
  }

  get pendingCount(): number {
    return this.queue.length + this.active;
  }

  request(url: string, priority: number): Promise<ArrayBuffer> {
    const existing = this.inflight.get(url);
    if (existing) {
      existing.priority = Math.min(existing.priority, priority);
      return new Promise((resolve, reject) => {
        const chain = existing;
        const prevResolve = chain.resolve;
        const prevReject = chain.reject;
        chain.resolve = (v) => {
          prevResolve(v);
          resolve(v);
        };
        chain.reject = (e) => {
          prevReject(e);
          reject(e);
        };
      });
    }
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const pending: Pending = {
        url,
        priority,
        resolve,
        reject,
        controller: new AbortController(),
        cancelled: false,
      };
      this.inflight.set(url, pending);
      this.queue.push(pending);
      this.pump();
    });
  }

  /** Cancels a queued or in-flight request; resolved ones are unaffected. */
  cancel(url: string): void {
    const pending = this.inflight.get(url);
    if (!pending) return;
    pending.cancelled = true;
    pending.controller.abort();
    const i = this.queue.indexOf(pending);
    if (i >= 0) {
      this.queue.splice(i, 1);
      this.inflight.delete(url);
      pending.reject(new Error('cancelled'));
    }
  }

  reprioritize(url: string, priority: number): void {
    const pending = this.inflight.get(url);
    if (pending) pending.priority = priority;
  }

  private pump(): void {
    while (this.active < this.concurrency && this.queue.length > 0) {
      let best = 0;
      for (let i = 1; i < this.queue.length; i++) {
        if (this.queue[i].priority < this.queue[best].priority) best = i;
      }
      const pending = this.queue.splice(best, 1)[0];
      this.active++;
      void this.run(pending);
    }
  }

  private async run(pending: Pending): Promise<void> {
    try {
      const cached = await this.cache.get(pending.url);
      if (cached) {
        this.stats.cached++;
        if (!pending.cancelled) pending.resolve(cached);
        return;
      }
      const bytes = await this.download(pending);
      this.stats.network++;
      void this.cache.put(pending.url, bytes.slice(0));
      if (!pending.cancelled) pending.resolve(bytes);
    } catch (err) {
      this.stats.failed++;
      if (!pending.cancelled) {
        pending.reject(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      this.active--;
      this.inflight.delete(pending.url);
      this.pump();
    }
  }

  private async download(pending: Pending, attempt = 0): Promise<ArrayBuffer> {
    try {
      const res = await fetch(pending.url, {
        signal: pending.controller.signal,
        mode: 'cors',
        credentials: 'omit',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.arrayBuffer();
    } catch (err) {
      if (pending.cancelled) throw err;
      // 404 means the tile genuinely does not exist; retrying wastes the slot.
      const message = err instanceof Error ? err.message : '';
      if (attempt >= 1 || message.includes('404')) throw err;
      await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
      return this.download(pending, attempt + 1);
    }
  }
}
