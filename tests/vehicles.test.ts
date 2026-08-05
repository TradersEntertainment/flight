import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { approach, fitHull } from '../src/vehicles/buoyancy';
import { surfaceNormal } from '../src/vehicles/car';
import { findGround, isLand, isWater } from '../src/vehicles/manager';
import { waveHeight, waveNormal } from '../src/world/water';
import type { World } from '../src/game/world';

/** Minimal stand-in for the world: only the height sampler is exercised. */
function fakeWorld(height: (x: number, z: number) => number): World {
  return { heightAt: height } as unknown as World;
}

describe('buoyancy', () => {
  const hull = { halfLength: 5, halfBeam: 1.5 };

  it('sits level on flat water', () => {
    const fit = fitHull(hull, 1, 1, 1, 1);
    expect(fit.heave).toBe(1);
    expect(fit.pitch).toBe(0);
    expect(fit.roll).toBe(0);
  });

  it('pitches up when the bow rides a crest', () => {
    const fit = fitHull(hull, 2, 0, 1, 1);
    expect(fit.pitch).toBeGreaterThan(0);
    expect(fit.heave).toBeCloseTo(1, 6);
  });

  it('rolls toward the lower beam', () => {
    const starboardDown = fitHull(hull, 0, 0, 1, -1);
    expect(starboardDown.roll).toBeLessThan(0);
    const portDown = fitHull(hull, 0, 0, -1, 1);
    expect(portDown.roll).toBeGreaterThan(0);
  });

  it('eases toward a target without overshooting', () => {
    let value = 0;
    for (let i = 0; i < 200; i++) value = approach(value, 10, 4, 1 / 60);
    expect(value).toBeGreaterThan(9.9);
    expect(value).toBeLessThanOrEqual(10);
  });

  it('approach is stable with a large timestep', () => {
    // rate * dt > 1 must not overshoot into oscillation.
    const value = approach(0, 10, 40, 0.5);
    expect(value).toBe(10);
  });
});

describe('waves', () => {
  it('is deterministic and bounded', () => {
    for (let i = 0; i < 50; i++) {
      const h = waveHeight(i * 13.7, i * -7.1, i * 0.31);
      expect(Math.abs(h)).toBeLessThan(3);
      expect(waveHeight(i * 13.7, i * -7.1, i * 0.31)).toBe(h);
    }
  });

  it('moves over time', () => {
    expect(waveHeight(0, 0, 0)).not.toBe(waveHeight(0, 0, 3));
  });

  it('has an upward normal', () => {
    for (let i = 0; i < 20; i++) {
      const n = waveNormal(i * 9.3, i * 4.1, i * 0.7);
      expect(n.y).toBeGreaterThan(0.5);
      expect(n.length()).toBeCloseTo(1, 6);
    }
  });
});

describe('surface normal', () => {
  it('points straight up on flat ground', () => {
    const n = surfaceNormal(() => 42, 0, 0, 2);
    expect(n.x).toBeCloseTo(0, 9);
    expect(n.y).toBeCloseTo(1, 9);
    expect(n.z).toBeCloseTo(0, 9);
  });

  it('tilts away from a slope rising to the east', () => {
    const n = surfaceNormal((x) => x * 0.5, 0, 0, 2);
    expect(n.x).toBeLessThan(0);
    expect(n.y).toBeGreaterThan(0);
    expect(n.length()).toBeCloseTo(1, 9);
  });
});

describe('vehicle placement', () => {
  it('keeps a valid spot where it is', () => {
    const world = fakeWorld(() => 200);
    const result = findGround(world, new Vector3(10, 0, 20), isLand);
    expect(result.moved).toBe(false);
    expect(result.position.x).toBe(10);
  });

  it('finds the nearest land when the car is dropped at sea', () => {
    // Land only east of x = 500; open water reads 0, as the real data does.
    const world = fakeWorld((x) => (x > 500 ? 40 : 0));
    const result = findGround(world, new Vector3(0, 0, 0), isLand);
    expect(result.moved).toBe(true);
    expect(result.position.x).toBeGreaterThan(500);
    expect(world.heightAt(result.position.x, result.position.z)).toBeGreaterThan(1);
  });

  it('finds water when the boat is dropped inland', () => {
    const world = fakeWorld((_x, z) => (z < -800 ? 0 : 120));
    const result = findGround(world, new Vector3(0, 0, 0), isWater);
    expect(result.moved).toBe(true);
    expect(world.heightAt(result.position.x, result.position.z)).toBeLessThanOrEqual(0);
  });

  it('gives up gracefully when nothing matches', () => {
    const world = fakeWorld(() => 500);
    const result = findGround(world, new Vector3(3, 0, 4), isWater);
    expect(result.moved).toBe(false);
    expect(result.position.x).toBe(3);
  });

  it('classifies sea level as water and keeps land off the shoreline', () => {
    // The data has no bathymetry: open sea is exactly 0 m, so that must count
    // as water or a boat could never be placed at sea.
    expect(isWater(0)).toBe(true);
    expect(isWater(-5)).toBe(true);
    // Land needs clearance, so a vehicle is never dropped on the waterline.
    expect(isLand(0.5)).toBe(false);
    expect(isLand(0)).toBe(false);
    expect(isLand(5)).toBe(true);
    expect(isWater(0.5)).toBe(false);
  });
});
