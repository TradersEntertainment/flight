/** Quality presets and persisted user preferences. */

export type QualityName = 'low' | 'medium' | 'high';

export interface Quality {
  /** Quads per tile edge in the terrain mesh. */
  meshSegments: number;
  /** Screen pixels a tile may cover before it is split. */
  splitPixels: number;
  /** Maximum simultaneously resident render tiles. */
  tileBudget: number;
  /** Maximum concurrent network requests for tiles. */
  concurrency: number;
  postFx: boolean;
  bloom: boolean;
  waterDetail: number;
  maxPixelRatio: number;
  /** Roads and street lamps streamed from OpenStreetMap. */
  vectors: boolean;
}

export const QUALITY: Record<QualityName, Quality> = {
  low: {
    meshSegments: 32,
    splitPixels: 620,
    tileBudget: 180,
    concurrency: 6,
    postFx: false,
    bloom: false,
    waterDetail: 64,
    maxPixelRatio: 1,
    // Roads and buildings stay on even here. They are most of what makes a
    // place recognisable, they cost one merged mesh per cell, and silently
    // switching them off left players looking at an empty city with no way to
    // tell that a setting had done it.
    vectors: true,
  },
  medium: {
    meshSegments: 48,
    splitPixels: 480,
    tileBudget: 320,
    concurrency: 8,
    postFx: true,
    bloom: true,
    waterDetail: 128,
    maxPixelRatio: 1.5,
    vectors: true,
  },
  high: {
    meshSegments: 72,
    splitPixels: 380,
    tileBudget: 480,
    concurrency: 10,
    postFx: true,
    bloom: true,
    waterDetail: 192,
    maxPixelRatio: 2,
    vectors: true,
  },
};

export interface Settings {
  quality: QualityName;
  imagery: string;
  invertPitch: boolean;
  audio: boolean;
  language: 'tr' | 'en';
  showMinimap: boolean;
}

const DEFAULTS: Settings = {
  quality: 'medium',
  imagery: 'auto',
  invertPitch: false,
  audio: true,
  language: 'tr',
  showMinimap: true,
};

const KEY = 'flight.settings.v1';

function detectDefaults(): Settings {
  const s = { ...DEFAULTS };
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const cores = navigator.hardwareConcurrency ?? 4;
  if (mobile || cores <= 4) s.quality = 'low';
  else if (cores >= 12) s.quality = 'high';
  if (!navigator.language.startsWith('tr')) s.language = 'en';
  return s;
}

export function loadSettings(): Settings {
  const base = detectDefaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...base, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* storage unavailable — fall back to detected defaults */
  }
  return base;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

export function quality(s: Settings): Quality {
  return QUALITY[s.quality];
}
