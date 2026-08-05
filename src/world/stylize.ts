/**
 * Stylised imagery generated from elevation.
 *
 * Used as the fallback when a satellite provider is unavailable (offline, blocked
 * or out of quota) and as a deliberate art style. Hypsometric tint plus hillshade
 * produces a readable, game-like surface with no imagery quota at all.
 */

export interface StylizeOptions {
  /** Ground metres between adjacent samples, for correct slope. */
  metersPerSample: number;
  size: number;
}

interface Stop {
  h: number;
  r: number;
  g: number;
  b: number;
}

// Deep water through to snow. Values are picked to read well under the night grade.
const RAMP: Stop[] = [
  { h: -6000, r: 6, g: 18, b: 44 },
  { h: -200, r: 12, g: 46, b: 92 },
  { h: -10, r: 26, g: 84, b: 132 },
  { h: 0, r: 206, g: 192, b: 154 }, // beach
  { h: 30, r: 104, g: 116, b: 76 },
  { h: 250, r: 112, g: 118, b: 74 },
  { h: 700, r: 124, g: 114, b: 78 },
  { h: 1400, r: 118, g: 100, b: 80 },
  { h: 2200, r: 128, g: 116, b: 108 },
  { h: 3000, r: 176, g: 176, b: 178 },
  { h: 3800, r: 236, g: 240, b: 244 },
  { h: 8900, r: 255, g: 255, b: 255 },
];

function ramp(h: number, out: [number, number, number]): void {
  let i = 1;
  while (i < RAMP.length - 1 && h > RAMP[i].h) i++;
  const a = RAMP[i - 1];
  const b = RAMP[i];
  const t = Math.max(0, Math.min(1, (h - a.h) / (b.h - a.h)));
  out[0] = a.r + (b.r - a.r) * t;
  out[1] = a.g + (b.g - a.g) * t;
  out[2] = a.b + (b.b - a.b) * t;
}

/** Cheap deterministic value noise so flat terrain is not flat colour. */
function hashNoise(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Renders elevation into an RGBA buffer.
 *
 * `heights` is a size×size grid in metres, row-major from the tile's north edge.
 */
export function stylizeElevation(
  heights: Float32Array,
  opts: StylizeOptions,
  out?: Uint8ClampedArray<ArrayBuffer>,
): Uint8ClampedArray<ArrayBuffer> {
  const { size, metersPerSample } = opts;
  const rgba = out ?? new Uint8ClampedArray(new ArrayBuffer(size * size * 4));
  const colour: [number, number, number] = [0, 0, 0];
  // Sun from the north-west, the cartographic convention.
  const lx = -0.6;
  const ly = 0.6;
  const lz = 0.53;

  for (let y = 0; y < size; y++) {
    const yn = Math.max(0, y - 1);
    const ys = Math.min(size - 1, y + 1);
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const xw = Math.max(0, x - 1);
      const xe = Math.min(size - 1, x + 1);
      const h = heights[i];

      // Slope in metres per metre; scaled by the true sample spacing.
      const dzdx = (heights[y * size + xe] - heights[y * size + xw]) / (2 * metersPerSample);
      const dzdy = (heights[ys * size + x] - heights[yn * size + x]) / (2 * metersPerSample);
      const inv = 1 / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
      const nx = -dzdx * inv;
      const ny = dzdy * inv;
      const nz = inv;
      let shade = nx * lx + ny * ly + nz * lz;
      shade = 0.55 + 0.65 * Math.max(0, shade);

      ramp(h, colour);
      const water = h <= 0;
      if (water) shade = 0.85 + 0.15 * shade; // water is not lit by slope

      // Slope-driven rock, so cliffs read as rock even at low altitude.
      const steep = Math.min(1, Math.hypot(dzdx, dzdy) * 1.6);
      if (!water && steep > 0) {
        colour[0] += (124 - colour[0]) * steep * 0.55;
        colour[1] += (112 - colour[1]) * steep * 0.55;
        colour[2] += (100 - colour[2]) * steep * 0.55;
      }

      const n = (hashNoise(x * 0.37, y * 0.37) - 0.5) * (water ? 4 : 14);
      const p = i * 4;
      rgba[p] = colour[0] * shade + n;
      rgba[p + 1] = colour[1] * shade + n;
      rgba[p + 2] = colour[2] * shade + n;
      rgba[p + 3] = 255;
    }
  }
  return rgba;
}
