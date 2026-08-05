/**
 * Minimap drawn from the elevation the game already has in memory.
 *
 * No second map library and no extra tile traffic: the same height sampler that
 * the vehicles drive on is rendered as shaded relief. Sampling is spread over
 * several frames — a full 96×96 pass in one go would cost more than the frame
 * budget allows — and the overlay redraws every frame so the player marker never
 * lags.
 */

import type { World } from '../game/world';
import type { VehicleKind } from '../vehicles/types';

const GRID = 96;
const ROWS_PER_FRAME = 8;

/** Half-width of the visible area per vehicle, in metres. */
const RADIUS: Record<VehicleKind, number> = {
  plane: 9000,
  car: 1100,
  boat: 3400,
};

export interface MinimapMarker {
  x: number;
  z: number;
  colour: string;
  /** Draws a ring instead of a dot. */
  ring?: boolean;
}

export class Minimap {
  readonly root = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly relief = document.createElement('canvas');
  private readonly reliefCtx: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private readonly heights = new Float32Array(GRID * GRID);
  private readonly scaleLabel = document.createElement('span');
  private row = 0;
  private scanCentre = { x: 0, z: 0 };
  private scanRadius = RADIUS.plane;
  private radius = RADIUS.plane;
  private night = 0;

  constructor(parent: HTMLElement) {
    this.root.className = 'minimap panel';
    const size = 190 * Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = size;
    this.canvas.height = size;
    this.relief.width = GRID;
    this.relief.height = GRID;
    this.ctx = this.canvas.getContext('2d')!;
    this.reliefCtx = this.relief.getContext('2d')!;
    this.image = this.reliefCtx.createImageData(GRID, GRID);
    this.scaleLabel.className = 'scale';
    this.root.appendChild(this.canvas);
    this.root.appendChild(this.scaleLabel);
    parent.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? '' : 'none';
  }

  setNight(night: number): void {
    this.night = night;
  }

  /**
   * Scans a slice of the map and redraws it.
   *
   * `centre` is the player position in world metres and `heading` their facing;
   * the map is north-up, which is what makes it readable as a map.
   */
  update(
    world: World,
    centre: { x: number; z: number },
    heading: number,
    kind: VehicleKind,
    markers: MinimapMarker[] = [],
  ): void {
    const radius = RADIUS[kind];
    const moved = Math.hypot(centre.x - this.scanCentre.x, centre.z - this.scanCentre.z);
    if (radius !== this.scanRadius || moved > radius * 0.08) {
      this.scanCentre = { x: centre.x, z: centre.z };
      this.scanRadius = radius;
      this.row = 0;
    }
    this.radius = radius;

    for (let i = 0; i < ROWS_PER_FRAME && this.row < GRID; i++, this.row++) {
      this.scanRow(world, this.row);
    }
    if (this.row >= GRID) {
      this.colourise();
      this.row = GRID; // stay finished until the view moves
    }

    this.draw(centre, heading, markers);
  }

  private scanRow(world: World, row: number): void {
    const step = (this.scanRadius * 2) / GRID;
    const z = this.scanCentre.z - this.scanRadius + row * step;
    for (let col = 0; col < GRID; col++) {
      const x = this.scanCentre.x - this.scanRadius + col * step;
      this.heights[row * GRID + col] = world.heightAt(x, z);
    }
  }

  /** Turns the height grid into shaded relief. */
  private colourise(): void {
    const data = this.image.data;
    const step = (this.scanRadius * 2) / GRID;
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        const i = row * GRID + col;
        const h = this.heights[i];
        const west = this.heights[row * GRID + Math.max(0, col - 1)];
        const east = this.heights[row * GRID + Math.min(GRID - 1, col + 1)];
        const north = this.heights[Math.max(0, row - 1) * GRID + col];
        const south = this.heights[Math.min(GRID - 1, row + 1) * GRID + col];
        const slope = ((east - west) / (2 * step)) * 0.7 + ((south - north) / (2 * step)) * 0.7;
        const shade = clamp(0.72 + slope * 26, 0.35, 1.35);

        let r: number;
        let g: number;
        let b: number;
        if (h <= 0) {
          // Water: darker as it deepens.
          const depth = clamp(-h / 900, 0, 1);
          r = 24 - depth * 14;
          g = 74 - depth * 40;
          b = 116 - depth * 50;
        } else {
          const t = clamp(h / 2600, 0, 1);
          r = (96 + t * 150) * shade;
          g = (112 + t * 120) * shade;
          b = (78 + t * 130) * shade;
        }
        const night = this.night * 0.62;
        const p = i * 4;
        data[p] = r * (1 - night);
        data[p + 1] = g * (1 - night);
        data[p + 2] = b * (1 - night) + night * 18;
        data[p + 3] = 255;
      }
    }
    this.reliefCtx.putImageData(this.image, 0, 0);
  }

  private draw(centre: { x: number; z: number }, heading: number, markers: MinimapMarker[]): void {
    const ctx = this.ctx;
    const size = this.canvas.width;
    ctx.clearRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = true;

    // The relief was scanned around scanCentre; offset it so the player stays
    // in the middle even between scans.
    const pixelsPerMetre = size / (this.radius * 2);
    const dx = (this.scanCentre.x - centre.x) * pixelsPerMetre;
    const dz = (this.scanCentre.z - centre.z) * pixelsPerMetre;
    ctx.drawImage(this.relief, dx, dz, size, size);

    const toScreen = (x: number, z: number): [number, number] => [
      size / 2 + (x - centre.x) * pixelsPerMetre,
      size / 2 + (z - centre.z) * pixelsPerMetre,
    ];

    for (const marker of markers) {
      const [mx, my] = toScreen(marker.x, marker.z);
      ctx.beginPath();
      ctx.arc(mx, my, marker.ring ? 7 : 4, 0, Math.PI * 2);
      if (marker.ring) {
        ctx.strokeStyle = marker.colour;
        ctx.lineWidth = 2.5;
        ctx.stroke();
      } else {
        ctx.fillStyle = marker.colour;
        ctx.fill();
      }
    }

    // Player arrow, pointing along the heading.
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(heading);
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(7, 9);
    ctx.lineTo(0, 5);
    ctx.lineTo(-7, 9);
    ctx.closePath();
    ctx.fillStyle = '#6fe3c4';
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.lineWidth = 1.6;
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // North marker.
    ctx.fillStyle = 'rgba(232,238,248,0.75)';
    ctx.font = `${Math.round(size * 0.062)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('K', size / 2, size * 0.085);

    const span = this.radius * 2;
    this.scaleLabel.textContent = span >= 2000 ? `${Math.round(span / 1000)} km` : `${Math.round(span)} m`;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
