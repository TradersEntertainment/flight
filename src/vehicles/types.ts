/**
 * The contract every vehicle implements.
 *
 * A vehicle owns its physics state and its scene object; the switcher hands
 * control between them and carries position and heading across.
 */

import type { Group, Vector3 } from 'three';
import type { Input } from '../core/input';
import type { World } from '../game/world';

export type VehicleKind = 'plane' | 'car' | 'boat';

export interface VehicleState {
  /** World position in metres. */
  position: Vector3;
  /** Heading in radians, 0 = north, increasing clockwise (east positive). */
  heading: number;
  /** Speed along the heading in metres per second. */
  speed: number;
  /** False places the vehicle on the ground; undefined lets it decide. */
  airborne?: boolean;
}

export interface CameraTarget {
  /** Point the camera looks at and follows. */
  position: Vector3;
  /** Vehicle orientation as a heading in radians. */
  heading: number;
  /** Extra pitch/roll the camera should partly inherit, in radians. */
  pitch: number;
  roll: number;
  /** Preferred distance and height, in metres. */
  distance: number;
  height: number;
  /** Field of view widening with speed, 0..1. */
  speedFactor: number;
}

export interface HudReading {
  /** Primary speed readout in km/h (or knots for the boat). */
  speed: number;
  speedUnit: string;
  /** Altitude above sea level, metres; null hides the field. */
  altitude: number | null;
  /** Height above ground, metres; null hides the field. */
  agl: number | null;
  /** Vertical speed in m/s; null hides the field. */
  vario: number | null;
  throttle: number;
  heading: number;
  /** Short warning text, e.g. stall. */
  warning: string | null;
  /** Name of the road being driven, when there is one. */
  surface?: string | null;
}

/** What the sound system needs to know about a vehicle each frame. */
export interface VehicleAudio {
  /** Metres per second. */
  speed: number;
  throttle: number;
  airborne: boolean;
  /** Surface roughness 0..1; tarmac is smooth, open ground is not. */
  roughness: number;
  /** How hard the vehicle is sliding, 0..1. */
  slip: number;
}

export interface Vehicle {
  readonly kind: VehicleKind;
  readonly object: Group;
  /** Fixed-timestep update. */
  step(dt: number, input: Input, world: World): void;
  /** Per-frame update for visuals that need the frame delta. */
  frame?(dt: number, world: World): void;
  getCameraTarget(): CameraTarget;
  getHud(): HudReading;
  getAudio(): VehicleAudio;
  getState(): VehicleState;
  /** Places the vehicle; called on spawn, teleport and vehicle change. */
  enter(state: VehicleState, world: World): void;
  /** Resets to a safe state after a crash or when the player presses reset. */
  reset(world: World): void;
  /**
   * Translates the vehicle when the world anchor moves under it. Must not
   * disturb speed or attitude — this happens mid-flight.
   */
  shift(delta: { x: number; z: number }): void;
  dispose(): void;
}
