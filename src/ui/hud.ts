/**
 * Heads-up display, vehicle switcher, notices and attribution.
 *
 * Plain DOM rather than canvas: crisp at any pixel ratio, styleable in CSS, and
 * it costs the render loop nothing.
 */

import type { HudReading, VehicleKind } from '../vehicles/types';

const VEHICLE_LABEL: Record<VehicleKind, { icon: string; key: string; name: string }> = {
  plane: { icon: '✈', key: '1', name: 'Uçak' },
  car: { icon: '🚗', key: '2', name: 'Araba' },
  boat: { icon: '⛵', key: '3', name: 'Gemi' },
};

const COMPASS = ['K', 'KD', 'D', 'GD', 'G', 'GB', 'B', 'KB'];

export function compassLabel(headingRad: number): string {
  const degrees = ((headingRad * 180) / Math.PI + 360) % 360;
  return COMPASS[Math.round(degrees / 45) % 8];
}

export function headingDegrees(headingRad: number): number {
  return Math.round(((headingRad * 180) / Math.PI + 360) % 360);
}

export class Hud {
  readonly root = document.createElement('div');
  private readonly speedValue: HTMLElement;
  private readonly speedLabel: HTMLElement;
  private readonly altItem: HTMLElement;
  private readonly altValue: HTMLElement;
  private readonly aglItem: HTMLElement;
  private readonly aglValue: HTMLElement;
  private readonly varioItem: HTMLElement;
  private readonly varioValue: HTMLElement;
  private readonly headingValue: HTMLElement;
  private readonly throttleBar: HTMLElement;
  private readonly warning: HTMLElement;
  private readonly switcher = document.createElement('div');
  private readonly buttons = new Map<VehicleKind, HTMLButtonElement>();

  onSelectVehicle: ((kind: VehicleKind) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root.className = 'hud panel';
    this.root.innerHTML = `
      <div class="hud-item"><span class="value" data-speed>0</span><span class="label" data-speed-unit>km/h</span></div>
      <div class="hud-sep"></div>
      <div class="hud-item" data-alt-item><span class="value" data-alt>0</span><span class="label">irtifa m</span></div>
      <div class="hud-item" data-agl-item><span class="value" data-agl>0</span><span class="label">yerden m</span></div>
      <div class="hud-item" data-vario-item><span class="value" data-vario>0</span><span class="label">tırmanış m/s</span></div>
      <div class="hud-sep"></div>
      <div class="hud-item"><span class="value" data-heading>K 000</span><span class="label">yön</span>
        <span class="hud-throttle"><i data-throttle></i></span>
      </div>
      <div class="hud-item" data-warning-item style="display:none">
        <span class="value hud-warn" data-warning></span><span class="label">uyarı</span>
      </div>`;

    const q = <T extends HTMLElement>(selector: string): T =>
      this.root.querySelector(selector) as T;
    this.speedValue = q('[data-speed]');
    this.speedLabel = q('[data-speed-unit]');
    this.altItem = q('[data-alt-item]');
    this.altValue = q('[data-alt]');
    this.aglItem = q('[data-agl-item]');
    this.aglValue = q('[data-agl]');
    this.varioItem = q('[data-vario-item]');
    this.varioValue = q('[data-vario]');
    this.headingValue = q('[data-heading]');
    this.throttleBar = q('[data-throttle]');
    this.warning = q('[data-warning]');

    this.switcher.className = 'vehicles panel';
    for (const kind of ['plane', 'car', 'boat'] as VehicleKind[]) {
      const meta = VEHICLE_LABEL[kind];
      const button = document.createElement('button');
      button.type = 'button';
      button.title = `${meta.name} (${meta.key})`;
      button.innerHTML = `${meta.icon}<span class="key">${meta.key}</span>`;
      button.addEventListener('click', () => this.onSelectVehicle?.(kind));
      this.switcher.appendChild(button);
      this.buttons.set(kind, button);
    }

    parent.appendChild(this.switcher);
    parent.appendChild(this.root);
  }

  setVehicle(kind: VehicleKind): void {
    for (const [key, button] of this.buttons) button.classList.toggle('active', key === kind);
  }

  update(reading: HudReading): void {
    this.speedValue.textContent = Math.round(reading.speed).toString();
    this.speedLabel.textContent = reading.speedUnit;

    setField(this.altItem, this.altValue, reading.altitude, (v) => Math.round(v).toString());
    setField(this.aglItem, this.aglValue, reading.agl, (v) => Math.round(Math.max(0, v)).toString());
    setField(this.varioItem, this.varioValue, reading.vario, (v) => {
      const rounded = Math.round(v * 10) / 10;
      return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}`;
    });

    this.headingValue.textContent = `${compassLabel(reading.heading)} ${headingDegrees(reading.heading)
      .toString()
      .padStart(3, '0')}`;
    this.throttleBar.style.width = `${Math.round(reading.throttle * 100)}%`;

    const warningItem = this.warning.parentElement as HTMLElement;
    if (reading.warning) {
      warningItem.style.display = '';
      this.warning.textContent = reading.warning;
    } else {
      warningItem.style.display = 'none';
    }
  }
}

function setField(
  item: HTMLElement,
  value: HTMLElement,
  reading: number | null,
  format: (v: number) => string,
): void {
  if (reading === null) {
    item.style.display = 'none';
    return;
  }
  item.style.display = '';
  value.textContent = format(reading);
}

/** Transient messages: vehicle relocations, provider fallbacks, race results. */
export class Toasts {
  private readonly root = document.createElement('div');

  constructor(parent: HTMLElement) {
    this.root.className = 'toasts';
    parent.appendChild(this.root);
  }

  show(message: string, durationMs = 3800): void {
    const toast = document.createElement('div');
    toast.className = 'toast panel';
    toast.textContent = message;
    this.root.appendChild(toast);
    setTimeout(() => {
      toast.style.transition = 'opacity .4s ease';
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 420);
    }, durationMs);
  }
}

/** Data attribution, required by every provider we use. */
export class Attribution {
  private readonly root = document.createElement('div');

  constructor(parent: HTMLElement) {
    this.root.className = 'attribution';
    parent.appendChild(this.root);
  }

  set(text: string): void {
    this.root.textContent = text;
  }
}

/** The place name and coordinates shown in the top-right corner. */
export class PlaceBadge {
  private readonly root = document.createElement('div');
  private readonly name = document.createElement('span');
  private readonly coords = document.createElement('span');

  constructor(parent: HTMLElement) {
    this.root.className = 'place-badge panel';
    this.coords.className = 'coords';
    this.root.appendChild(this.name);
    this.root.appendChild(this.coords);
    parent.appendChild(this.root);
  }

  set(name: string, lon: number, lat: number): void {
    this.name.textContent = name;
    this.coords.textContent = `${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;
  }
}

/**
 * Says so while the ground under the player is still coming in.
 *
 * Terrain streams, so there is a window where the world is a coarse blur or
 * missing entirely. Without a word on screen that reads as a broken game
 * rather than a loading one.
 */
export class LoadingBadge {
  private readonly root = document.createElement('div');
  private current: string | null = null;

  constructor(parent: HTMLElement) {
    this.root.className = 'loading-badge panel';
    this.root.style.display = 'none';
    parent.appendChild(this.root);
  }

  set(label: string | null): void {
    if (label === this.current) return;
    this.current = label;
    if (!label) {
      this.root.style.display = 'none';
      return;
    }
    this.root.textContent = label;
    this.root.style.display = '';
  }
}

/**
 * The three things a lost player needs: get back, find somewhere, share here.
 *
 * These are buttons rather than keyboard-only actions because someone who has
 * just opened the game does not yet know the keys.
 */
export class ActionChips {
  private readonly root = document.createElement('div');
  onHome: (() => void) | null = null;
  onSearch: (() => void) | null = null;
  onShare: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root.className = 'action-chips';
    this.root.append(
      this.chip('⌂', 'Başlangıca dön', () => this.onHome?.()),
      this.chip('⌕', 'Yer ara', () => this.onSearch?.(), 'T'),
      this.chip('⧉', 'Bağlantıyı kopyala', () => this.onShare?.()),
    );
    parent.appendChild(this.root);
  }

  private chip(icon: string, label: string, action: () => void, key?: string): HTMLElement {
    const button = document.createElement('button');
    button.className = 'chip';
    button.type = 'button';
    button.title = label;
    button.innerHTML = `<span aria-hidden="true">${icon}</span>${label}${key ? `<kbd>${key}</kbd>` : ''}`;
    button.addEventListener('click', action);
    return button;
  }
}

/**
 * The name of the road being driven.
 *
 * Sits by the minimap and only appears when there is a road under the wheels —
 * the small detail that turns "driving over terrain" into "driving somewhere".
 */
export class RoadLabel {
  private readonly root = document.createElement('div');
  private current: string | null = null;

  constructor(parent: HTMLElement) {
    this.root.className = 'road-label panel';
    this.root.style.display = 'none';
    parent.appendChild(this.root);
  }

  set(name: string | null | undefined): void {
    const next = name ?? null;
    if (next === this.current) return;
    this.current = next;
    if (!next) {
      this.root.style.display = 'none';
      return;
    }
    this.root.textContent = next;
    this.root.style.display = '';
  }
}
