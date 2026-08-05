/**
 * The car: arcade ground handling driven by height samples.
 *
 * No rigid-body engine. Four probe points give the surface height and normal;
 * longitudinal motion, lateral grip and steering are integrated directly. That
 * keeps the whole vehicle in one readable file, avoids shipping a physics WASM
 * blob, and — because it reads the same height sampler as everything else — the
 * car never disagrees with the terrain it is driving on.
 */

import { Euler, Group, Quaternion, Vector3, type MeshStandardMaterial } from 'three';
import { createCar, type CarModel } from './models';
import type { CameraTarget, HudReading, Vehicle, VehicleAudio, VehicleState } from './types';
import type { RoadSurface } from '../world/roads';
import type { Input } from '../core/input';
import type { World } from '../game/world';

export interface CarConfig {
  /** Peak forward acceleration, m/s². */
  enginePower: number;
  /** Speed at which the engine stops pulling, m/s. */
  topSpeed: number;
  brakePower: number;
  reversePower: number;
  dragLinear: number;
  dragQuadratic: number;
  rollingResistance: number;
  /** Lateral grip as a decay rate; higher sticks harder. */
  grip: number;
  handbrakeGrip: number;
  /** Multipliers applied while the car is on a road surface. */
  roadGrip: number;
  roadRollingResistance: number;
  roadTopSpeed: number;
  maxSteerRate: number;
  rideHeight: number;
  /** Half the wheelbase / track, for the probe points. */
  halfLength: number;
  halfWidth: number;
}

export const DEFAULT_CAR: CarConfig = {
  enginePower: 11,
  topSpeed: 78,
  brakePower: 18,
  reversePower: 6,
  dragLinear: 0.02,
  dragQuadratic: 0.0016,
  rollingResistance: 1.4,
  grip: 5.2,
  handbrakeGrip: 0.7,
  roadGrip: 1.45,
  roadRollingResistance: 0.45,
  roadTopSpeed: 1.25,
  maxSteerRate: 1.5,
  rideHeight: 0.42,
  halfLength: 1.45,
  halfWidth: 0.92,
};

const GRAVITY = 9.81;
const _q = new Quaternion();
const _euler = new Euler();
const _normal = new Vector3();
const _forward = new Vector3();
const _right = new Vector3();

/** Surface normal from four height samples around a point. */
export function surfaceNormal(
  height: (x: number, z: number) => number,
  x: number,
  z: number,
  spacing: number,
  out = new Vector3(),
): Vector3 {
  const dx = (height(x + spacing, z) - height(x - spacing, z)) / (2 * spacing);
  const dz = (height(x, z + spacing) - height(x, z - spacing)) / (2 * spacing);
  return out.set(-dx, 1, -dz).normalize();
}

export class CarVehicle implements Vehicle {
  readonly kind = 'car' as const;
  readonly object: Group;
  private readonly model: CarModel;
  private readonly config = DEFAULT_CAR;
  private readonly position = new Vector3();
  private readonly velocity = new Vector3();
  private heading = 0;
  private airborne = false;
  private wheelSpin = 0;
  private steerAngle = 0;
  private drift = 0;
  private braking = false;
  /** The road the car is on, or null when it is off-road. */
  private road: RoadSurface | null = null;
  /** 0..1, set by the game from the time of day. */
  headlightPower = 0;

  constructor() {
    this.model = createCar();
    this.object = this.model.group;
  }

  enter(state: VehicleState, world: World): void {
    this.position.copy(state.position);
    this.position.y = world.heightAt(state.position.x, state.position.z) + this.config.rideHeight;
    this.heading = state.heading;
    this.velocity.set(0, 0, 0);
    this.airborne = false;
    this.syncObject(world);
  }

  step(dt: number, input: Input, world: World): void {
    const cfg = this.config;
    // On a road the car rides the tarmac, which is smoothed and lifted clear of
    // the 30 m elevation grid; off it, the raw terrain.
    this.road = world.roadSurfaceAt(this.position.x, this.position.z);
    const height = (x: number, z: number): number => {
      const road = world.roadSurfaceAt(x, z);
      return road ? road.height : world.heightAt(x, z);
    };
    const throttle = input.axis('throttleDown', 'throttleUp');
    const steer = input.axis('left', 'right');
    const handbrake = input.value('brake') > 0;

    const ground = height(this.position.x, this.position.z);
    const rest = ground + cfg.rideHeight;
    this.airborne = this.position.y > rest + 0.35;

    if (this.airborne) {
      this.velocity.y -= GRAVITY * dt;
      this.position.addScaledVector(this.velocity, dt);
      const landing = height(this.position.x, this.position.z) + cfg.rideHeight;
      if (this.position.y <= landing) {
        this.position.y = landing;
        // Vertical energy is absorbed by the suspension, not bounced.
        this.velocity.y = 0;
        this.airborne = false;
      }
      this.steerAngle += (steer * 0.5 - this.steerAngle) * Math.min(1, dt * 8);
      this.syncObject(world);
      return;
    }

    surfaceNormal(height, this.position.x, this.position.z, 2, _normal);

    // Steer first, then decompose the momentum the car already has. Rotating
    // the chassis before resolving velocity is what produces a slide: the
    // sideways component appears on its own and grip decides how fast it goes
    // away.
    const forwardSpeedBefore = this.velocity.dot(
      _forward.set(Math.sin(this.heading), 0, -Math.cos(this.heading)),
    );
    const speedFactor =
      Math.min(1, Math.abs(forwardSpeedBefore) / 3) *
      (1 - Math.min(0.72, Math.abs(forwardSpeedBefore) / cfg.topSpeed));
    // Reversing steers the other way, as a real car does.
    const steerDirection = forwardSpeedBefore >= 0 ? 1 : -1;
    const yawRate = steer * cfg.maxSteerRate * speedFactor * (handbrake ? 1.35 : 1);
    this.heading += yawRate * dt * steerDirection;
    this.steerAngle += (steer * 0.5 - this.steerAngle) * Math.min(1, dt * 8);

    // Forward along the new heading, projected onto the slope so climbing a
    // hill costs speed and descending gains it.
    _forward.set(Math.sin(this.heading), 0, -Math.cos(this.heading));
    _forward.addScaledVector(_normal, -_forward.dot(_normal)).normalize();
    _right.crossVectors(_forward, _normal).normalize();

    let vForward = this.velocity.dot(_forward);
    let vRight = this.velocity.dot(_right);

    // Tarmac gives more grip, less rolling drag and a higher top speed than
    // open ground: that difference is the reason to look for a road at all.
    const onRoad = this.road !== null;
    const topSpeed = cfg.topSpeed * (onRoad ? cfg.roadTopSpeed : 1);

    // Engine, brake and reverse.
    let accel = 0;
    if (throttle > 0) {
      const fade = Math.max(0, 1 - Math.abs(vForward) / topSpeed);
      accel = throttle * cfg.enginePower * (0.45 + 0.55 * fade);
    } else if (throttle < 0) {
      accel = vForward > 0.5 ? throttle * cfg.brakePower : throttle * cfg.reversePower;
    }
    this.braking = throttle < 0 && vForward > 0.5;

    // Gravity along the slope, plus resistance.
    accel += -GRAVITY * _forward.y;
    const speed = Math.abs(vForward);
    const rolling = cfg.rollingResistance * (onRoad ? cfg.roadRollingResistance : 1);
    accel -= Math.sign(vForward) * (rolling + cfg.dragLinear * speed);
    accel -= Math.sign(vForward) * cfg.dragQuadratic * speed * speed;
    if (throttle === 0 && speed < 0.6) {
      vForward = 0;
      accel = 0;
    }
    vForward += accel * dt;

    // Lateral grip: the sideways component decays, slowly with the handbrake on,
    // which is what makes the back end step out.
    const grip = handbrake ? cfg.handbrakeGrip : cfg.grip * (onRoad ? cfg.roadGrip : 1);
    vRight *= Math.exp(-grip * dt);
    this.drift = Math.min(1, Math.abs(vRight) / 9);

    this.velocity.copy(_forward).multiplyScalar(vForward).addScaledVector(_right, vRight);
    this.position.addScaledVector(this.velocity, dt);

    const newGround = height(this.position.x, this.position.z);
    const target = newGround + cfg.rideHeight;
    if (this.position.y < target) {
      // Wheels never sink into the road. Easing down is fine — that reads as
      // suspension — but easing *up* leaves the car buried when the ground
      // climbs faster than the spring can follow, which is exactly what
      // happens driving uphill at speed.
      this.position.y = target;
      this.velocity.y = 0;
    } else if (this.position.y < target + 0.6) {
      this.position.y += (target - this.position.y) * Math.min(1, dt * 12);
      this.velocity.y = 0;
    }
    // Driving off a ledge: keep the vertical speed the slope gave us.
    if (this.position.y > target + 0.35) this.airborne = true;

    this.wheelSpin += (vForward / 0.36) * dt;
    this.syncObject(world);
  }

  private syncObject(world: World): void {
    this.object.position.copy(this.position);
    const sample = (x: number, z: number): number => {
      const road = world.roadSurfaceAt(x, z);
      return road ? road.height : world.heightAt(x, z);
    };
    const normal = this.airborne
      ? _normal.set(0, 1, 0)
      : surfaceNormal(sample, this.position.x, this.position.z, 2, _normal);

    // Face along the heading, then tilt onto the surface normal.
    _q.setFromEuler(_euler.set(0, this.heading, 0, 'YXZ'));
    const tilt = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), normal);
    this.object.quaternion.copy(tilt).multiply(_q);

    for (let i = 0; i < this.model.wheels.length; i++) {
      const wheel = this.model.wheels[i];
      wheel.rotation.x = -this.wheelSpin;
      if (i < 2) wheel.rotation.y = this.steerAngle;
    }
    for (const light of this.model.brakeLights) {
      const material = light.material as MeshStandardMaterial;
      material.emissiveIntensity = this.braking ? 6 : 1.2;
    }
    // Headlights come on as the light fades; full beam only at night.
    const beam = this.headlightPower * 165;
    for (const light of this.model.headlightBeams) light.intensity = beam;
  }

  shift(delta: { x: number; z: number }): void {
    this.position.x += delta.x;
    this.position.z += delta.z;
    this.object.position.copy(this.position);
  }

  reset(world: World): void {
    this.velocity.set(0, 0, 0);
    this.position.y = world.heightAt(this.position.x, this.position.z) + this.config.rideHeight;
    this.airborne = false;
    this.syncObject(world);
  }

  getCameraTarget(): CameraTarget {
    const speed = this.velocity.length();
    return {
      position: this.position,
      heading: this.heading,
      pitch: 0,
      roll: 0,
      distance: 9.5 + speed * 0.09,
      height: 3.1,
      speedFactor: Math.min(1, speed / 55),
    };
  }

  getHud(): HudReading {
    const speed = this.velocity.length();
    return {
      speed: speed * 3.6,
      speedUnit: 'km/h',
      altitude: this.position.y,
      agl: null,
      vario: null,
      throttle: Math.min(1, speed / this.config.topSpeed),
      heading: this.heading,
      warning: this.drift > 0.55 ? 'DRIFT' : null,
      surface: this.road?.name ?? (this.road ? 'yol' : null),
    };
  }

  getAudio(): VehicleAudio {
    return {
      speed: this.velocity.length(),
      throttle: Math.min(1, this.velocity.length() / this.config.topSpeed),
      airborne: this.airborne,
      // Tarmac hisses; open ground rumbles.
      roughness: this.road ? 0.15 : 0.8,
      slip: this.drift,
    };
  }

  getState(): VehicleState {
    return {
      position: this.position.clone(),
      heading: this.heading,
      speed: this.velocity.length(),
    };
  }

  dispose(): void {
    this.object.traverse((child) => {
      const mesh = child as { geometry?: { dispose(): void } };
      mesh.geometry?.dispose();
    });
  }
}
