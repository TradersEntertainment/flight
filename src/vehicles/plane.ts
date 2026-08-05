/**
 * The aeroplane: flight model plus its scene representation.
 */

import { Group, Vector3 } from 'three';
import { FlightModel, type FlightControls } from './flightModel';
import { createPlane, type PlaneModel } from './models';
import type { CameraTarget, HudReading, Vehicle, VehicleState } from './types';
import type { Input } from '../core/input';
import type { World } from '../game/world';

const CRUISE_SPEED = 62;

export class PlaneVehicle implements Vehicle {
  readonly kind = 'plane' as const;
  readonly object: Group;
  private readonly model: PlaneModel;
  private readonly flight = new FlightModel();
  private readonly controls: FlightControls = {
    pitch: 0,
    roll: 0,
    yaw: 0,
    throttleDelta: 0,
    brake: false,
  };
  private propellerAngle = 0;
  private strobePhase = 0;
  /** Last position known to be safe, for the reset key and after a crash. */
  private readonly safeState: VehicleState = {
    position: new Vector3(),
    heading: 0,
    speed: CRUISE_SPEED,
  };
  private crashFade = 0;
  invertPitch = false;

  constructor() {
    this.model = createPlane();
    this.object = this.model.group;
  }

  enter(state: VehicleState, world: World): void {
    const ground = world.heightAt(state.position.x, state.position.z);
    const position = state.position.clone();
    if (state.airborne === false) {
      // Standing start: on the wheels, engine idle.
      position.y = ground + this.flight.config.gearHeight;
      this.flight.place(position, state.heading, 0, true);
    } else {
      // Entering the aeroplane from another vehicle starts a fly-by at a safe
      // height rather than dropping it onto whatever is below.
      position.y = Math.max(position.y, ground + 320);
      this.flight.place(position, state.heading, Math.max(state.speed, CRUISE_SPEED));
    }
    this.saveSafeState();
    this.syncObject();
  }

  shift(delta: { x: number; z: number }): void {
    this.flight.position.x += delta.x;
    this.flight.position.z += delta.z;
    this.safeState.position.x += delta.x;
    this.safeState.position.z += delta.z;
    this.syncObject();
  }

  step(dt: number, input: Input, world: World): void {
    const pitchInput = input.axis('pitchDown', 'pitchUp');
    this.controls.pitch = this.invertPitch ? -pitchInput : pitchInput;
    this.controls.roll = input.axis('left', 'right');
    this.controls.yaw = input.axis('yawLeft', 'yawRight');
    this.controls.throttleDelta = input.axis('throttleDown', 'throttleUp');
    this.controls.brake = input.value('brake') > 0;

    this.flight.step(dt, this.controls, (x, z) => world.heightAt(x, z));

    if (this.flight.crashed) {
      this.crashFade = 1;
      this.reset(world);
      return;
    }
    if (this.crashFade > 0) this.crashFade = Math.max(0, this.crashFade - dt);

    // Remember a spot we could safely return to: airborne, level and fast.
    if (this.flight.agl > 120 && !this.flight.stalled) this.saveSafeState();
    this.syncObject();
  }

  frame(dt: number): void {
    // Propeller speed follows throttle; the blur is implied by the rate.
    this.propellerAngle += dt * (12 + this.flight.throttle * 90);
    this.model.propeller.rotation.z = this.propellerAngle;

    this.strobePhase += dt;
    const on = this.strobePhase % 1.4 < 0.12;
    for (const strobe of this.model.strobes) strobe.visible = !this.flight.onGround || on;
  }

  private syncObject(): void {
    this.object.position.copy(this.flight.position);
    this.object.quaternion.copy(this.flight.orientation);
  }

  private saveSafeState(): void {
    this.safeState.position.copy(this.flight.position);
    this.safeState.heading = this.flight.heading;
    this.safeState.speed = Math.max(this.flight.forwardSpeed, CRUISE_SPEED);
  }

  reset(world: World): void {
    const ground = world.heightAt(this.safeState.position.x, this.safeState.position.z);
    const position = this.safeState.position.clone();
    position.y = Math.max(position.y, ground + 300);
    this.flight.place(position, this.safeState.heading, this.safeState.speed);
    this.syncObject();
  }

  getCameraTarget(): CameraTarget {
    const speed = this.flight.airspeed;
    const up = new Vector3(0, 1, 0).applyQuaternion(this.flight.orientation);
    const right = new Vector3(1, 0, 0).applyQuaternion(this.flight.orientation);
    return {
      position: this.flight.position,
      heading: this.flight.heading,
      pitch: Math.asin(clamp(this.flight.forward.y, -1, 1)),
      roll: Math.atan2(-right.y, up.y),
      distance: 26 + speed * 0.12,
      height: 7,
      speedFactor: clamp(speed / 130, 0, 1),
    };
  }

  getHud(): HudReading {
    return {
      speed: this.flight.airspeed * 3.6,
      speedUnit: 'km/h',
      altitude: this.flight.position.y,
      agl: this.flight.agl,
      vario: this.flight.verticalSpeed,
      throttle: this.flight.throttle,
      heading: this.flight.heading,
      warning: this.flight.stalled
        ? 'STALL'
        : this.crashFade > 0
          ? 'ÇARPMA — SIFIRLANDI'
          : this.flight.agl < 60 && !this.flight.onGround
            ? 'ALÇAK'
            : null,
    };
  }

  getState(): VehicleState {
    return {
      position: this.flight.position.clone(),
      heading: this.flight.heading,
      speed: this.flight.forwardSpeed,
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
