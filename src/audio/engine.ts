/**
 * Engine note maths.
 *
 * Kept apart from the audio graph so the part that decides *what* the engine
 * should sound like can be tested without a browser. A real engine's pitch does
 * not track road speed: it climbs through a gear, drops on the change, and
 * climbs again. That saw-tooth is most of what makes acceleration audible.
 */

export interface GearboxConfig {
  /** Road speed each gear tops out at, m/s. */
  ratios: number[];
  /** Engine note at idle and at the redline, Hz. */
  idleHz: number;
  redlineHz: number;
}

export const CAR_GEARBOX: GearboxConfig = {
  ratios: [11, 20, 31, 44, 58, 78],
  idleHz: 42,
  redlineHz: 172,
};

export interface EngineNote {
  /** Fundamental frequency of the engine note, Hz. */
  frequency: number;
  /** 0..1 through the current gear, for filter movement. */
  load: number;
  gear: number;
}

/**
 * Engine note for a road speed.
 *
 * `throttle` lifts the note a little even when the speed is not changing, so
 * holding the accelerator against a hill is audible.
 */
export function engineNote(
  speed: number,
  throttle: number,
  config: GearboxConfig = CAR_GEARBOX,
): EngineNote {
  const magnitude = Math.abs(speed);
  let gear = 0;
  while (gear < config.ratios.length - 1 && magnitude > config.ratios[gear]) gear++;
  const floorSpeed = gear === 0 ? 0 : config.ratios[gear - 1];
  const span = Math.max(1, config.ratios[gear] - floorSpeed);
  // Past the last ratio the note stays at the redline rather than wrapping.
  const through = Math.min(1, (magnitude - floorSpeed) / span);
  const load = Math.max(0, Math.min(1, through * 0.85 + throttle * 0.15));
  const frequency = config.idleHz + (config.redlineHz - config.idleHz) * load;
  return { frequency, load, gear };
}

/** Propeller blade-pass frequency, Hz. */
export function propellerNote(throttle: number, airspeed: number): number {
  // Idles audibly, and windmills a little faster as the aircraft speeds up.
  return 18 + throttle * 74 + Math.min(20, airspeed * 0.12);
}

/** Marine engine note, Hz: slow-revving and much lower than a car. */
export function marineNote(throttle: number, speed: number): number {
  return 26 + throttle * 34 + Math.min(14, Math.abs(speed) * 0.5);
}

/**
 * Wind level for a speed, 0..1.
 *
 * Quadratic, because wind noise grows with the square of speed, and clamped so
 * a fast aeroplane does not drown out everything else.
 */
export function windLevel(speed: number, reference = 90): number {
  const t = Math.abs(speed) / reference;
  return Math.min(1, t * t);
}
