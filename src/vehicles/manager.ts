/**
 * Vehicle switching and placement.
 *
 * Switching is the feature that makes this world one world rather than three
 * games, so the rules matter: pressing "car" over open sea must not drop you in
 * the water, and pressing "boat" inland must not beach you. Each vehicle asks
 * for the kind of ground it needs and the search below finds the nearest such
 * spot, spiralling outward from where you already are.
 */

import { Group, Vector3 } from 'three';
import { PlaneVehicle } from './plane';
import { CarVehicle } from './car';
import { BoatVehicle } from './boat';
import type { Vehicle, VehicleKind, VehicleState } from './types';
import type { World } from '../game/world';

export interface PlacementResult {
  position: Vector3;
  moved: boolean;
  /** Distance the spawn had to be moved, metres. */
  distance: number;
}

/** How far to look for suitable ground before giving up, metres. */
const SEARCH_RADIUS = 24_000;

/**
 * Finds the nearest point matching a predicate, spiralling outward.
 *
 * Steps grow with radius so the search covers a lot of ground in few samples;
 * every sample costs a height lookup, and those are not free.
 */
export function findGround(
  world: World,
  origin: Vector3,
  predicate: (height: number) => boolean,
): PlacementResult {
  const here = world.heightAt(origin.x, origin.z);
  if (predicate(here)) return { position: origin.clone(), moved: false, distance: 0 };

  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 1; i < 900; i++) {
    const radius = SEARCH_RADIUS * Math.sqrt(i / 900);
    const angle = i * golden;
    const x = origin.x + Math.cos(angle) * radius;
    const z = origin.z + Math.sin(angle) * radius;
    if (predicate(world.heightAt(x, z))) {
      return { position: new Vector3(x, 0, z), moved: true, distance: radius };
    }
  }
  return { position: origin.clone(), moved: false, distance: 0 };
}

/**
 * Land and water tests.
 *
 * The elevation dataset has no bathymetry: every open-water sample is exactly
 * 0 m, and land is positive. So water is "at or below sea level" and land needs
 * a metre of clearance, which also keeps a placement off the interpolated
 * shoreline where a sample mixes beach and sea.
 */
export const isLand = (height: number): boolean => height > 1;
export const isWater = (height: number): boolean => height <= 0;

export class VehicleManager {
  readonly group = new Group();
  private readonly vehicles: Record<VehicleKind, Vehicle>;
  private activeKind: VehicleKind = 'plane';
  /** Set when a switch had to move the player; the UI reports it. */
  onRelocate: ((kind: VehicleKind, distance: number) => void) | null = null;

  constructor(private readonly world: World) {
    this.vehicles = {
      plane: new PlaneVehicle(),
      car: new CarVehicle(),
      boat: new BoatVehicle(),
    };
    for (const vehicle of Object.values(this.vehicles)) {
      vehicle.object.visible = false;
      this.group.add(vehicle.object);
    }
    this.group.name = 'vehicles';
  }

  get active(): Vehicle {
    return this.vehicles[this.activeKind];
  }

  get kind(): VehicleKind {
    return this.activeKind;
  }

  /** A vehicle by kind, active or not. */
  get(kind: VehicleKind): Vehicle {
    return this.vehicles[kind];
  }

  /** Places the starting vehicle. */
  start(kind: VehicleKind, state: VehicleState): void {
    this.activeKind = kind;
    this.active.object.visible = true;
    this.active.enter(this.place(kind, state), this.world);
  }

  /** Switches vehicle, carrying position and heading across. */
  switchTo(kind: VehicleKind): boolean {
    if (kind === this.activeKind) return false;
    const state = this.active.getState();
    // Switching into the aeroplane always means taking off from where you are.
    state.airborne = kind === 'plane' ? true : undefined;
    this.active.object.visible = false;
    this.activeKind = kind;
    const placed = this.place(kind, state);
    this.active.enter(placed, this.world);
    this.active.object.visible = true;
    return true;
  }

  /** Moves the active vehicle to a new spot, e.g. after a search or teleport. */
  teleport(state: VehicleState): void {
    this.active.enter(this.place(this.activeKind, state), this.world);
  }

  private place(kind: VehicleKind, state: VehicleState): VehicleState {
    const result = this.requiredGround(kind, state.position);
    if (result.moved) this.onRelocate?.(kind, result.distance);
    const position = result.position.clone();
    if (kind === 'plane' && state.airborne !== false) {
      // Arriving by air: level flight at a safe height above the ground.
      position.y = Math.max(state.position.y, this.world.heightAt(position.x, position.z) + 350);
    }
    return {
      position,
      heading: state.heading,
      speed: state.speed,
      airborne: state.airborne,
    };
  }

  private requiredGround(kind: VehicleKind, origin: Vector3): PlacementResult {
    switch (kind) {
      case 'car':
        return findGround(this.world, origin, isLand);
      case 'boat':
        return findGround(this.world, origin, isWater);
      case 'plane':
        // An aeroplane can be anywhere; it spawns in the air.
        return { position: origin.clone(), moved: false, distance: 0 };
    }
  }

  step(dt: number, input: Parameters<Vehicle['step']>[1]): void {
    this.active.step(dt, input, this.world);
  }

  frame(dt: number): void {
    this.active.frame?.(dt, this.world);
  }

  /** Applies a world re-anchor to every vehicle, not just the active one. */
  shift(delta: { x: number; z: number }): void {
    for (const vehicle of Object.values(this.vehicles)) vehicle.shift(delta);
  }

  dispose(): void {
    for (const vehicle of Object.values(this.vehicles)) vehicle.dispose();
  }
}
