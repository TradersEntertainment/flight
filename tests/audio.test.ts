import { describe, expect, it } from 'vitest';
import {
  CAR_GEARBOX,
  engineNote,
  marineNote,
  propellerNote,
  windLevel,
} from '../src/audio/engine';

describe('engine note', () => {
  it('idles at rest', () => {
    const note = engineNote(0, 0);
    expect(note.frequency).toBeCloseTo(CAR_GEARBOX.idleHz, 5);
    expect(note.gear).toBe(0);
  });

  it('climbs through a gear then drops on the change', () => {
    // Just before and just after the first ratio.
    const before = engineNote(CAR_GEARBOX.ratios[0] - 0.5, 1);
    const after = engineNote(CAR_GEARBOX.ratios[0] + 0.5, 1);
    expect(after.gear).toBe(before.gear + 1);
    expect(after.frequency).toBeLessThan(before.frequency);
    // The drop is what makes acceleration audible; it should be substantial.
    expect(before.frequency - after.frequency).toBeGreaterThan(40);
  });

  it('rises within every gear', () => {
    for (let gear = 0; gear < CAR_GEARBOX.ratios.length; gear++) {
      const low = gear === 0 ? 1 : CAR_GEARBOX.ratios[gear - 1] + 1;
      const high = CAR_GEARBOX.ratios[gear] - 0.5;
      expect(engineNote(high, 0.5).frequency).toBeGreaterThan(engineNote(low, 0.5).frequency);
    }
  });

  it('stays inside the rev range at any speed', () => {
    for (let speed = -40; speed <= 400; speed += 3) {
      const note = engineNote(speed, 1);
      expect(note.frequency).toBeGreaterThanOrEqual(CAR_GEARBOX.idleHz - 1e-6);
      expect(note.frequency).toBeLessThanOrEqual(CAR_GEARBOX.redlineHz + 1e-6);
    }
  });

  it('revs the same in reverse as forwards', () => {
    expect(engineNote(-15, 0.5).frequency).toBeCloseTo(engineNote(15, 0.5).frequency, 9);
  });

  it('lifts the note under throttle at a steady speed', () => {
    expect(engineNote(20, 1).frequency).toBeGreaterThan(engineNote(20, 0).frequency);
  });
});

describe('other vehicles', () => {
  it('spins the propeller up with throttle', () => {
    expect(propellerNote(1, 0)).toBeGreaterThan(propellerNote(0, 0));
    // Idle is audible, not silent.
    expect(propellerNote(0, 0)).toBeGreaterThan(10);
    // A dive windmills the propeller a little faster, but not without limit.
    expect(propellerNote(0.5, 400)).toBeLessThan(propellerNote(1, 400) + 1);
    expect(propellerNote(1, 5000)).toBeLessThan(200);
  });

  it('keeps the marine engine low and slow', () => {
    expect(marineNote(1, 30)).toBeLessThan(propellerNote(1, 30));
    expect(marineNote(0, 0)).toBeGreaterThan(20);
  });
});

describe('wind', () => {
  it('grows with the square of speed and saturates', () => {
    expect(windLevel(0)).toBe(0);
    const half = windLevel(45, 90);
    expect(half).toBeCloseTo(0.25, 6); // quadratic, not linear
    expect(windLevel(90, 90)).toBeCloseTo(1, 6);
    expect(windLevel(900, 90)).toBe(1);
  });

  it('ignores direction', () => {
    expect(windLevel(-50)).toBeCloseTo(windLevel(50), 9);
  });
});
