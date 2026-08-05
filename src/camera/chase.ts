/**
 * Chase camera.
 *
 * Springs toward a point behind the vehicle rather than being rigidly attached:
 * rigid attachment makes fast roll and yaw nauseating. It inherits only part of
 * the vehicle's pitch and roll, keeps itself above the terrain, and widens the
 * field of view with speed for the sense of pace.
 */

import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import type { CameraTarget } from '../vehicles/types';
import type { World } from '../game/world';

export type CameraMode = 'chase' | 'far' | 'cockpit';

export const CAMERA_MODES: CameraMode[] = ['chase', 'far', 'cockpit'];

const MODE_MULTIPLIER: Record<CameraMode, { distance: number; height: number }> = {
  chase: { distance: 1, height: 1 },
  far: { distance: 2.1, height: 1.7 },
  cockpit: { distance: 0.02, height: 0.55 },
};

const BASE_FOV = 60;
const MAX_FOV = 82;

export class ChaseCamera {
  mode: CameraMode = 'chase';
  private readonly position = new Vector3();
  private readonly lookAt = new Vector3();
  private readonly desired = new Vector3();
  private readonly focus = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private readonly axis = new Vector3();
  private fov = BASE_FOV;
  private initialised = false;

  cycleMode(): CameraMode {
    const index = CAMERA_MODES.indexOf(this.mode);
    this.mode = CAMERA_MODES[(index + 1) % CAMERA_MODES.length];
    return this.mode;
  }

  /** Snaps the camera behind the target, e.g. after a teleport. */
  reset(): void {
    this.initialised = false;
  }

  update(dt: number, camera: PerspectiveCamera, target: CameraTarget, world: World): void {
    const mult = MODE_MULTIPLIER[this.mode];
    const distance = target.distance * mult.distance;
    const height = target.height * mult.height;

    // Behind the vehicle along its heading, lifted by part of its pitch so the
    // camera swings under the nose in a climb instead of clipping through it.
    const behindX = -Math.sin(target.heading);
    const behindZ = Math.cos(target.heading);
    const pitchLift = Math.sin(target.pitch) * distance * 0.55;

    this.desired.set(
      target.position.x + behindX * distance * Math.cos(target.pitch * 0.55),
      target.position.y + height - pitchLift,
      target.position.z + behindZ * distance * Math.cos(target.pitch * 0.55),
    );

    if (!this.initialised) {
      this.position.copy(this.desired);
      this.focus.copy(target.position);
      this.initialised = true;
    }

    // Springs: position lags more than aim, which reads as weight.
    const positionRate = this.mode === 'cockpit' ? 30 : 6.5;
    this.position.lerp(this.desired, Math.min(1, positionRate * dt));
    this.focus.lerp(target.position, Math.min(1, 12 * dt));

    // Never let the terrain come between the camera and the vehicle.
    const ground = world.heightAt(this.position.x, this.position.z);
    const minimum = ground + 2.5;
    if (this.position.y < minimum) this.position.y = minimum;

    this.lookAt
      .copy(this.focus)
      .addScaledVector(
        this.axis.set(Math.sin(target.heading), 0, -Math.cos(target.heading)),
        distance * 0.35,
      );
    this.lookAt.y += Math.sin(target.pitch) * distance * 0.3;

    camera.position.copy(this.position);
    // Partially inherit roll so a banked turn tilts the horizon: world up,
    // rotated about the direction of travel. Inheriting all of it would put the
    // horizon upside down in a loop, which is disorienting in a chase view.
    this.up.set(0, 1, 0).applyAxisAngle(
      this.axis.set(Math.sin(target.heading), 0, -Math.cos(target.heading)),
      -target.roll * 0.5,
    );
    camera.up.copy(this.up);
    camera.lookAt(this.lookAt);

    const targetFov = BASE_FOV + (MAX_FOV - BASE_FOV) * target.speedFactor;
    this.fov = MathUtils.lerp(this.fov, targetFov, Math.min(1, dt * 2.5));
    if (Math.abs(camera.fov - this.fov) > 0.01) {
      camera.fov = this.fov;
      camera.updateProjectionMatrix();
    }
  }

  /** Shifts the camera when the world anchor moves under it. */
  shift(delta: { x: number; z: number }): void {
    this.position.x += delta.x;
    this.position.z += delta.z;
    this.focus.x += delta.x;
    this.focus.z += delta.z;
  }
}
