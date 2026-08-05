/**
 * Place search and teleport.
 *
 * Built-in places answer instantly and work offline; the online geocoder fills
 * in everything else and is debounced and cached to stay inside Nominatim's
 * usage policy.
 */

import { placeIcon, searchPlaces, type Place } from '../data/places';

const GEOCODER = 'https://nominatim.openstreetmap.org/search';
const DEBOUNCE_MS = 420;

export interface SearchResult extends Place {
  /** True when the entry came from the online geocoder. */
  remote?: boolean;
}

export class SearchPanel {
  readonly root = document.createElement('div');
  private readonly input = document.createElement('input');
  private readonly list = document.createElement('ul');
  private readonly hint = document.createElement('div');
  private results: SearchResult[] = [];
  private activeIndex = 0;
  private timer: number | null = null;
  private readonly cache = new Map<string, SearchResult[]>();
  private lastRemoteAt = 0;

  onPick: ((place: SearchResult) => void) | null = null;
  onClose: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root.className = 'search panel';
    this.root.style.display = 'none';
    this.input.type = 'text';
    this.input.placeholder = 'Dünyada bir yer ara — “Antalya”, “Everest”, “SFO”…';
    this.input.autocomplete = 'off';
    this.hint.className = 'hint';
    this.hint.textContent = 'Enter ile ışınlan · Esc ile kapat';
    this.root.appendChild(this.input);
    this.root.appendChild(this.list);
    this.root.appendChild(this.hint);
    parent.appendChild(this.root);

    this.input.addEventListener('input', () => this.onInput());
    this.input.addEventListener('keydown', (e) => this.onKeyDown(e));
    this.list.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest('li');
      if (!item) return;
      const index = Number(item.dataset.index);
      if (Number.isInteger(index)) this.pick(index);
    });
  }

  get isOpen(): boolean {
    return this.root.style.display !== 'none';
  }

  open(): void {
    this.root.style.display = '';
    this.input.value = '';
    this.results = [];
    this.render();
    this.input.focus();
  }

  close(): void {
    this.root.style.display = 'none';
    this.input.blur();
    this.onClose?.();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      this.activeIndex = Math.max(0, Math.min(this.results.length - 1, this.activeIndex + delta));
      this.render();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      this.pick(this.activeIndex);
    }
    e.stopPropagation();
  }

  private onInput(): void {
    const query = this.input.value.trim();
    this.results = searchPlaces(query);
    this.activeIndex = 0;
    this.render();

    if (this.timer !== null) clearTimeout(this.timer);
    if (query.length < 3) return;
    this.timer = window.setTimeout(() => void this.searchRemote(query), DEBOUNCE_MS);
  }

  /** Queries the geocoder, at most one request per second. */
  private async searchRemote(query: string): Promise<void> {
    const cached = this.cache.get(query);
    if (cached) {
      this.merge(cached);
      return;
    }
    const wait = Math.max(0, 1000 - (Date.now() - this.lastRemoteAt));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRemoteAt = Date.now();

    try {
      const url = `${GEOCODER}?q=${encodeURIComponent(query)}&format=jsonv2&limit=5&accept-language=tr`;
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      const rows = (await response.json()) as Array<{
        display_name: string;
        lat: string;
        lon: string;
        type?: string;
      }>;
      const found: SearchResult[] = rows.map((row) => {
        const parts = row.display_name.split(',');
        return {
          name: parts[0].trim(),
          region: parts.slice(1, 3).join(',').trim(),
          lat: Number(row.lat),
          lon: Number(row.lon),
          kind: 'city',
          remote: true,
        };
      });
      this.cache.set(query, found);
      if (this.input.value.trim() === query) this.merge(found);
    } catch {
      // Offline or blocked: the built-in list is still there.
    }
  }

  private merge(remote: SearchResult[]): void {
    const seen = new Set(this.results.map((r) => `${r.lat.toFixed(3)},${r.lon.toFixed(3)}`));
    for (const entry of remote) {
      const key = `${entry.lat.toFixed(3)},${entry.lon.toFixed(3)}`;
      if (!seen.has(key)) {
        this.results.push(entry);
        seen.add(key);
      }
    }
    this.render();
  }

  private pick(index: number): void {
    const place = this.results[index];
    if (!place) return;
    this.close();
    this.onPick?.(place);
  }

  private render(): void {
    this.list.innerHTML = '';
    this.results.forEach((place, index) => {
      const item = document.createElement('li');
      item.dataset.index = String(index);
      if (index === this.activeIndex) item.className = 'active';
      const label = document.createElement('span');
      label.textContent = `${placeIcon(place.kind)}  ${place.name}`;
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = place.code
        ? `${place.code} · ${place.region ?? ''}`
        : (place.region ?? `${place.lat.toFixed(2)}, ${place.lon.toFixed(2)}`);
      item.appendChild(label);
      item.appendChild(meta);
      this.list.appendChild(item);
    });
    this.hint.textContent = this.results.length
      ? 'Enter ile ışınlan · ↑↓ ile seç · Esc ile kapat'
      : 'Bir yer adı yazın — yerleşik liste anında, diğerleri OpenStreetMap üzerinden.';
  }
}
