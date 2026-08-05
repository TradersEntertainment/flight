/**
 * The boat: throttle, rudder and a hull that rides the same waves the shader
 * draws.
 */

import { Euler, Group, Vector3, type MeshBasicMaterial } from 'three';
import { createBoat, type BoatModel } from './models';
import { approach, fitHull, type HullShape } from './buoyancy';
import { waveHeight } from '../world/water';
import type { CameraTarget, HudReading, Vehicle, VehicleAudio, VehicleState } from './types';
import type { Input } from '../core/input';
import type { World } from '../game/world';

const HULL: HullShape = { halfLength: 5.2, halfBeam: 1.6 };

export interface BoatConfig {
  thrust: number;
  reverseThrust: number;
  topSpeed: number;
  dragLinear: number;
  dragQuadratic: number;
  /** Rudder authority in radians per second at full speed. */
  maxYawRate: number;
  /** Metres the hull sits below its waterline mark. */
  draft: number;
}

export const DEFAULT_BOAT: BoatConfig = {
  thrust: 4.6,
  reverseThrust: 2.2,
  topSpeed: 32,
  dragLinear: 0.08,
  dragQuadratic: 0.004,
  maxYawRate: 0.85,
  draft: 0.35,
};

/**
 * Ground height above which the hull runs aground, metres.
 *
 * Open water reads exactly 0 m in the elevation data (there is no bathymetry),
 * so grounding has to key off land rising above sea level rather than off a
 * depth. The small positive margin lets the boat run right up to the beach.
 */
const GROUNDING_DEPTH = 0.4;

const _euler = new Euler();

export class BoatVehicle implements Vehicle {
  readonly kind = 'boat' as const;
  readonly object: Group;
  private readonly model: BoatModel;
  private readonly config = DEFAULT_BOAT;
  private readonly position = new Vector3();
  private heading = 0;
  private speed = 0;
  private pitch = 0;
  private roll = 0;
  private heave = 0;
  private aground = false;

  constructor() {
    this.model = createBoat();
    this.object = this.model.group;
  }

  enter(state: VehicleState, world: World): void {
    this.position.copy(state.position);
    this.position.y = 0;
    this.heading = state.heading;
    this.speed = 0;
    this.aground = world.heightAt(state.position.x, state.position.z) > GROUNDING_DEPTH;
    this.syncObject();
  }

  step(dt: number, input: Input, world: World): void {
    const cfg = this.config;
    const throttle = input.axis('throttleDown', 'throttleUp');
    const rudder = input.axis('left', 'right');
    const anchor = input.value('brake') > 0;

    const seabed = world.heightAt(this.position.x, this.position.z);
    this.aground = seabed > GROUNDING_DEPTH;

    let accel = throttle > 0 ? throttle * cfg.thrust : throttle * cfg.reverseThrust;
    accel -= Math.sign(this.speed) * (cfg.dragLinear * Math.abs(this.speed));
    accel -= Math.sign(this.speed) * cfg.dragQuadratic * this.speed * this.speed;
    if (anchor) accel -= Math.sign(this.speed) * 3.5;
    if (this.aground) {
      // Running onto the shore kills way quickly and refuses forward thrust.
      accel = Math.min(accel, 0) - Math.sign(this.speed) * 6;
    }
    this.speed = clamp(this.speed + accel * dt, -cfg.topSpeed * 0.35, cfg.topSpeed);
    if (Math.abs(this.speed) < 0.05 && throttle === 0) this.speed = 0;

    // A rudder only bites when water is moving past it.
    const rudderAuthority = Math.min(1, Math.abs(this.speed) / 6) * Math.sign(this.speed || 1);
    this.heading += rudder * cfg.maxYawRate * rudderAuthority * dt;

    const forwardX = Math.sin(this.heading);
    const forwardZ = -Math.cos(this.heading);
    this.position.x += forwardX * this.speed * dt;
    this.position.z += forwardZ * this.speed * dt;

    this.rideWaves(dt, world.time, forwardX, forwardZ);
    this.syncObject();
  }

  /** Fits the hull to the wave surface and eases the attitude toward it. */
  private rideWaves(dt: number, time: number, forwardX: number, forwardZ: number): void {
    const { x, z } = this.position;
    const rightX = -forwardZ;
    const rightZ = forwardX;
    const l = HULL.halfLength;
    const b = HULL.halfBeam;

    const fit = fitHull(
      HULL,
      waveHeight(x + forwardX * l, z + forwardZ * l, time),
      waveHeight(x - forwardX * l, z - forwardZ * l, time),
      waveHeight(x - rightX * b, z - rightZ * b, time),
      waveHeight(x + rightX * b, z + rightZ * b, time),
    );

    // Faster boats plane: they follow the surface less and cut through more.
    const planing = Math.min(1, Math.abs(this.speed) / this.config.topSpeed);
    const follow = 6 - planing * 3.5;
    this.heave = approach(this.heave, fit.heave, follow, dt);
    this.pitch = approach(this.pitch, fit.pitch * (1 - planing * 0.6) + planing * 0.05, 3.5, dt);
    this.roll = approach(this.roll, fit.roll * (1 - planing * 0.35), 3, dt);
  }

  private syncObject(): void {
    this.object.position.set(this.position.x, this.heave - this.config.draft, this.position.z);
    this.object.quaternion.setFromEuler(_euler.set(this.pitch, this.heading, this.roll, 'YXZ'));

    const wake = this.model.wake.material as MeshBasicMaterial;
    wake.opacity = Math.min(0.5, Math.abs(this.speed) / this.config.topSpeed) * (this.aground ? 0 : 1);
    this.model.wake.scale.y = 18 + Math.abs(this.speed) * 1.4;
  }

  shift(delta: { x: number; z: number }): void {
    this.position.x += delta.x;
    this.position.z += delta.z;
    this.object.position.set(this.position.x, this.object.position.y, this.position.z);
  }

  reset(): void {
    this.speed = 0;
    this.pitch = 0;
    this.roll = 0;
    this.syncObject();
  }

  getCameraTarget(): CameraTarget {
    return {
      position: this.object.position,
      heading: this.heading,
      pitch: this.pitch * 0.4,
      roll: this.roll * 0.5,
      distance: 22 + Math.abs(this.speed) * 0.35,
      height: 6.5,
      speedFactor: Math.min(1, Math.abs(this.speed) / this.config.topSpeed),
    };
  }

  getHud(): HudReading {
    return {
      // Boats are measured in knots; one knot is 1.852 km/h.
      speed: Math.abs(this.speed) * 1.94384,
      speedUnit: 'kn',
      altitude: null,
      agl: null,
      vario: null,
      throttle: Math.min(1, Math.abs(this.speed) / this.config.topSpeed),
      heading: this.heading,
      warning: this.aground ? 'KARAYA OTURDU' : null,
    };
  }

  getAudio(): VehicleAudio {
    return {
      speed: Math.abs(this.speed),
      throttle: Math.min(1, Math.abs(this.speed) / this.config.topSpeed),
      airborne: false,
      // The hull noise is water, not grit.
      roughness: 0.35,
      slip: 0,
    };
  }

  getState(): VehicleState {
    return {
      position: new Vector3(this.position.x, 0, this.position.z),
      heading: this.heading,
      speed: Math.abs(this.speed),
    };
  }

  dispose(): void {
    this.object.traverse((child) => {
      const mesh = child as { geometry?: { dispose(): void } };
      mesh.geometry?.dispose();
    });
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
