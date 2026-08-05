/**
 * Arcade flight model.
 *
 * Not an aerodynamic simulation: lift, drag and control authority are simple
 * functions of forward speed, tuned so the aircraft feels responsive and stays
 * controllable with a keyboard. It is deliberately free of scene objects so it
 * can be unit tested.
 *
 * Axes follow the scene convention: -z is the nose, +y is up, +x is starboard.
 */

import { Euler, Quaternion, Vector3 } from 'three';

export interface FlightConfig {
  /** Peak acceleration from the engine, m/s². */
  maxThrust: number;
  /** Speed at which lift exactly cancels gravity, m/s. */
  referenceSpeed: number;
  /** Below this forward speed the wing stalls, m/s. */
  stallSpeed: number;
  /** Speed at which the aircraft can rotate for take-off, m/s. */
  rotateSpeed: number;
  maxPitchRate: number;
  maxRollRate: number;
  maxYawRate: number;
  dragLinear: number;
  dragQuadratic: number;
  /** How quickly the velocity vector swings toward the nose, per second. */
  alignRate: number;
  /** Height of the wheels below the origin, m. */
  gearHeight: number;
  /** Vertical speed above which touchdown becomes a crash, m/s. */
  maxTouchdownRate: number;
  /**
   * Steepest climb or dive the controls will hold, radians.
   *
   * Without a limit, holding the pitch key loops the aircraft — which for
   * anyone not flying simulators reads as "it keeps crashing".
   */
  pitchLimit: number;
  /** How strongly the aircraft rolls itself level when the stick is centred. */
  levelAssist: number;
}

export const DEFAULT_FLIGHT: FlightConfig = {
  maxThrust: 22,
  referenceSpeed: 52,
  stallSpeed: 26,
  rotateSpeed: 34,
  maxPitchRate: 1.15,
  maxRollRate: 2.4,
  maxYawRate: 0.6,
  dragLinear: 0.02,
  dragQuadratic: 0.0009,
  alignRate: 2.2,
  gearHeight: 1.15,
  maxTouchdownRate: 7,
  pitchLimit: 0.95, // about 54 degrees
  levelAssist: 1.1,
};

export const GRAVITY = 9.81;

export interface FlightControls {
  /** -1 nose down, +1 nose up. */
  pitch: number;
  /** -1 roll left, +1 roll right. */
  roll: number;
  /** -1 yaw left, +1 yaw right. */
  yaw: number;
  /** Throttle change per second, -1..1. */
  throttleDelta: number;
  /** Wheel brake, only meaningful on the ground. */
  brake: boolean;
}

export type GroundHeightFn = (x: number, z: number) => number;

export interface FlightState {
  position: Vector3;
  velocity: Vector3;
  orientation: Quaternion;
  throttle: number;
  onGround: boolean;
  stalled: boolean;
  /** Set for one step when the aircraft hits the ground too hard. */
  crashed: boolean;
}

const _forward = new Vector3();
const _up = new Vector3();
const _accel = new Vector3();
const _tmp = new Vector3();
const _rot = new Quaternion();
const _euler = new Euler();
const _alignTarget = new Vector3();

export class FlightModel {
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  readonly orientation = new Quaternion();
  throttle = 0;
  onGround = false;
  stalled = false;
  crashed = false;
  /** Metres above the ground directly below, refreshed every step. */
  agl = 0;

  constructor(readonly config: FlightConfig = DEFAULT_FLIGHT) {}

  /** Places the aircraft, either flying or standing on its wheels. */
  place(position: Vector3, headingRad: number, speed: number, onGround = false): void {
    this.position.copy(position);
    this.orientation.setFromEuler(_euler.set(0, headingRad, 0, 'YXZ'));
    _forward.set(0, 0, -1).applyQuaternion(this.orientation);
    this.velocity.copy(_forward).multiplyScalar(speed);
    this.throttle = speed > 1 && !onGround ? 0.75 : 0;
    this.onGround = onGround;
    this.stalled = false;
    this.crashed = false;
  }

  get forward(): Vector3 {
    return _forward.set(0, 0, -1).applyQuaternion(this.orientation).clone();
  }

  get airspeed(): number {
    return this.velocity.length();
  }

  get forwardSpeed(): number {
    _forward.set(0, 0, -1).applyQuaternion(this.orientation);
    return this.velocity.dot(_forward);
  }

  /** Heading in radians, 0 = north (-z), increasing toward east (+x). */
  get heading(): number {
    _forward.set(0, 0, -1).applyQuaternion(this.orientation);
    return Math.atan2(_forward.x, -_forward.z);
  }

  get verticalSpeed(): number {
    return this.velocity.y;
  }

  step(dt: number, controls: FlightControls, groundHeight: GroundHeightFn): void {
    const cfg = this.config;
    this.crashed = false;

    this.throttle = clamp(this.throttle + controls.throttleDelta * dt * 0.65, 0, 1);

    _forward.set(0, 0, -1).applyQuaternion(this.orientation);
    _up.set(0, 1, 0).applyQuaternion(this.orientation);
    const vFwd = this.velocity.dot(_forward);
    const speed = this.velocity.length();

    // Control authority grows with airspeed: a parked aircraft cannot manoeuvre.
    const authority = clamp(Math.abs(vFwd) / cfg.referenceSpeed, 0, 1.25);
    const ground = groundHeight(this.position.x, this.position.z);
    this.agl = this.position.y - ground;

    if (this.onGround) {
      this.stepGround(dt, controls, groundHeight, vFwd);
      return;
    }

    // Lift is quadratic in forward speed and capped so dives do not launch.
    const liftRatio = clamp((vFwd / cfg.referenceSpeed) ** 2, 0, 1.7);
    this.stalled = vFwd < cfg.stallSpeed;
    const stallScale = this.stalled ? clamp(vFwd / cfg.stallSpeed, 0, 1) ** 2 : 1;

    _accel.set(0, -GRAVITY, 0);
    _accel.addScaledVector(_forward, this.throttle * cfg.maxThrust);
    _accel.addScaledVector(_up, liftRatio * GRAVITY * stallScale);
    if (speed > 0.01) {
      _tmp.copy(this.velocity).normalize();
      _accel.addScaledVector(_tmp, -(cfg.dragLinear * speed + cfg.dragQuadratic * speed * speed));
    }

    this.velocity.addScaledVector(_accel, dt);

    // Body-frame rotation rates. About +x the nose rises, so pitch maps
    // straight through; about +y the nose swings to port and about +z the right
    // wing rises, so yaw and roll are negated to match the control convention.
    let pitchRate = controls.pitch * cfg.maxPitchRate * authority;
    let rollRate = -controls.roll * cfg.maxRollRate * authority;
    let yawRate = -controls.yaw * cfg.maxYawRate * authority;

    // A stalled wing drops the nose until speed recovers.
    if (this.stalled) pitchRate -= (1 - stallScale) * 0.8;

    // Keep the nose inside a flyable envelope. Authority fades as the limit
    // approaches rather than stopping dead, so it feels like the aircraft
    // running out of elevator, not like hitting a wall.
    const pitchAngle = Math.asin(clamp(_forward.y, -1, 1));
    const margin = 0.35;
    if (pitchRate > 0 && pitchAngle > cfg.pitchLimit - margin) {
      pitchRate *= clamp((cfg.pitchLimit - pitchAngle) / margin, 0, 1);
    } else if (pitchRate < 0 && pitchAngle < -cfg.pitchLimit + margin) {
      pitchRate *= clamp((cfg.pitchLimit + pitchAngle) / margin, 0, 1);
    }
    // Near the stall there is not enough air over the tail to pull harder.
    if (pitchRate > 0) {
      pitchRate *= clamp((vFwd - cfg.stallSpeed) / (cfg.stallSpeed * 0.6), 0.15, 1);
    }

    // Coordinated turn: banking swings the nose without touching the rudder,
    // which is what makes a bank-and-pull feel like flying rather than steering.
    _tmp.set(1, 0, 0).applyQuaternion(this.orientation);
    const bankRight = -_tmp.y;
    yawRate += -bankRight * 0.6 * clamp(vFwd / cfg.referenceSpeed, 0, 1.4);

    // Hands off the stick, the aircraft rolls itself level. Without this a
    // casual player banks, gets distracted, and spirals into the ground.
    if (controls.roll === 0) rollRate += bankRight * cfg.levelAssist;

    _rot.setFromEuler(_euler.set(pitchRate * dt, yawRate * dt, rollRate * dt, 'YXZ'));
    this.orientation.multiply(_rot).normalize();

    // Arcade handling: the velocity vector chases the nose, so the aircraft
    // goes roughly where it points instead of sliding through turns.
    if (speed > 1) {
      _forward.set(0, 0, -1).applyQuaternion(this.orientation);
      _alignTarget.copy(_forward).multiplyScalar(speed);
      this.velocity.lerp(_alignTarget, clamp(cfg.alignRate * authority * dt, 0, 1));
    }

    this.position.addScaledVector(this.velocity, dt);

    const groundAfter = groundHeight(this.position.x, this.position.z);
    this.agl = this.position.y - groundAfter;
    if (this.agl <= cfg.gearHeight) this.touchdown(groundAfter);
  }

  /** Decides between a landing and a crash when the wheels reach the ground. */
  private touchdown(ground: number): void {
    const cfg = this.config;
    _up.set(0, 1, 0).applyQuaternion(this.orientation);
    const level = _up.y > 0.9; // within ~25 degrees of upright
    const gentle = this.velocity.y > -cfg.maxTouchdownRate;
    this.position.y = ground + cfg.gearHeight;

    if (level && gentle) {
      this.onGround = true;
      this.velocity.y = 0;
      // Flatten the aircraft onto its wheels, keeping the heading.
      this.orientation.setFromEuler(_euler.set(0, this.heading, 0, 'YXZ'));
      this.stalled = false;
    } else {
      this.crashed = true;
    }
  }

  /** Rolling, steering and braking while the wheels are down. */
  private stepGround(
    dt: number,
    controls: FlightControls,
    groundHeight: GroundHeightFn,
    vFwd: number,
  ): void {
    const cfg = this.config;
    this.velocity.y = 0;
    this.stalled = false;

    _forward.set(0, 0, -1).applyQuaternion(this.orientation);
    let accel = this.throttle * cfg.maxThrust;
    // Rolling resistance, plus the wheel brake.
    accel -= (controls.brake ? 9 : 1.6) * (vFwd > 0.1 ? 1 : 0);
    const nextFwd = Math.max(0, vFwd + accel * dt);
    this.velocity.copy(_forward).multiplyScalar(nextFwd);

    // Nose-wheel steering, effective at low speed only. Both the rudder and the
    // roll axis steer on the ground so the keyboard layout stays consistent.
    const steerAuthority = clamp(1 - nextFwd / cfg.rotateSpeed, 0.15, 1);
    const yawRate = -(controls.yaw + controls.roll * 0.6) * 0.7 * steerAuthority;
    _rot.setFromEuler(_euler.set(0, yawRate * dt, 0, 'YXZ'));
    this.orientation.multiply(_rot).normalize();

    this.position.addScaledVector(this.velocity, dt);
    this.position.y = groundHeight(this.position.x, this.position.z) + cfg.gearHeight;
    this.agl = cfg.gearHeight;

    // Rotate for take-off once there is enough speed on the wheels.
    if (nextFwd > cfg.rotateSpeed && controls.pitch > 0.1) {
      this.onGround = false;
      _rot.setFromEuler(_euler.set(0.12, 0, 0, 'YXZ'));
      this.orientation.multiply(_rot).normalize();
      this.velocity.y = 2.5;
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
