import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { DEFAULT_FLIGHT, FlightModel, type FlightControls } from '../src/vehicles/flightModel';

const flat = (): number => 0;
const NEUTRAL: FlightControls = { pitch: 0, roll: 0, yaw: 0, throttleDelta: 0, brake: false };

function fly(model: FlightModel, seconds: number, controls: Partial<FlightControls> = {}): void {
  const dt = 1 / 60;
  const c = { ...NEUTRAL, ...controls };
  for (let i = 0; i < Math.round(seconds / dt); i++) model.step(dt, c, flat);
}

function airborne(speed = DEFAULT_FLIGHT.referenceSpeed, altitude = 1000): FlightModel {
  const model = new FlightModel();
  model.place(new Vector3(0, altitude, 0), 0, speed);
  return model;
}

describe('flight model', () => {
  it('holds altitude at reference speed with matching thrust', () => {
    const model = airborne();
    model.throttle = 0.62; // roughly balances drag at reference speed
    const before = model.position.y;
    fly(model, 6);
    expect(Math.abs(model.position.y - before)).toBeLessThan(40);
    expect(model.airspeed).toBeGreaterThan(30);
  });

  it('sinks when the engine is idle', () => {
    const model = airborne();
    model.throttle = 0;
    fly(model, 8);
    expect(model.position.y).toBeLessThan(1000);
    expect(model.velocity.y).toBeLessThan(0);
  });

  it('climbs when the nose is raised under power', () => {
    const model = airborne(70);
    model.throttle = 1;
    fly(model, 5, { pitch: 0.7 });
    expect(model.position.y).toBeGreaterThan(1000);
  });

  it('drops the nose in a stall', () => {
    const model = airborne(12); // well below stall speed
    model.throttle = 0;
    fly(model, 1.5);
    expect(model.stalled).toBe(true);
    // A stalled wing pitches down: the nose ends up below the horizon.
    expect(model.forward.y).toBeLessThan(0);
  });

  it('turns right when banked right', () => {
    const model = airborne(70);
    model.throttle = 0.8;
    fly(model, 0.35, { roll: 1 }); // roll into a bank to the right
    fly(model, 3, { pitch: 0.35 }); // pull through the turn
    // Heading grows clockwise from north, so a right turn heads east.
    expect(model.heading).toBeGreaterThan(0.25);
    expect(model.heading).toBeLessThan(Math.PI);
  });

  it('turns left when banked left', () => {
    const model = airborne(70);
    model.throttle = 0.8;
    fly(model, 0.35, { roll: -1 });
    fly(model, 3, { pitch: 0.35 });
    expect(model.heading).toBeLessThan(-0.25);
  });

  it('yaws right on rudder input', () => {
    const model = airborne(60);
    fly(model, 1, { yaw: 1 });
    expect(model.heading).toBeGreaterThan(0);
  });

  it('lands gently and rolls out', () => {
    const model = new FlightModel();
    model.place(new Vector3(0, 3, 0), 0, 30);
    model.velocity.y = -1.5;
    model.throttle = 0;
    fly(model, 3);
    expect(model.onGround).toBe(true);
    expect(model.crashed).toBe(false);
    expect(model.position.y).toBeCloseTo(DEFAULT_FLIGHT.gearHeight, 3);
  });

  it('crashes when flown into the ground nose first', () => {
    const model = airborne(90, 300);
    model.throttle = 1;
    fly(model, 0.7, { pitch: -1 }); // push into a steep dive
    let crashed = false;
    for (let i = 0; i < 60 * 20 && !crashed; i++) {
      model.step(1 / 60, NEUTRAL, flat);
      crashed = model.crashed;
    }
    expect(crashed).toBe(true);
  });

  it('takes off after accelerating down the runway', () => {
    const model = new FlightModel();
    model.place(new Vector3(0, 0, 0), 0, 0);
    model.position.y = DEFAULT_FLIGHT.gearHeight;
    model.onGround = true;
    model.throttle = 1;
    fly(model, 12, { throttleDelta: 1 });
    expect(model.forwardSpeed).toBeGreaterThan(DEFAULT_FLIGHT.rotateSpeed);
    fly(model, 2.5, { pitch: 0.35, throttleDelta: 1 });
    expect(model.onGround).toBe(false);
    expect(model.position.y).toBeGreaterThan(20);
  });

  it('keeps the throttle inside its range', () => {
    const model = airborne();
    fly(model, 10, { throttleDelta: 1 });
    expect(model.throttle).toBe(1);
    fly(model, 10, { throttleDelta: -1 });
    expect(model.throttle).toBe(0);
  });
});
