/**
 * Vehicle models, built from primitives.
 *
 * Procedural geometry rather than downloaded glTF: no asset licences to track,
 * a few kilobytes instead of megabytes, and every part is addressable so the
 * propeller can spin and the brake lights can glow.
 */

import {
  BoxGeometry,
  CapsuleGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  SpotLight,
  type ColorRepresentation,
} from 'three';

function body(color: ColorRepresentation, roughness = 0.45, metalness = 0.25): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness, metalness });
}

function glow(color: ColorRepresentation, intensity = 2): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: 0x111111,
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.4,
  });
}

export interface PlaneModel {
  group: Group;
  propeller: Object3D;
  strobes: Mesh[];
}

/** Low-wing single-engine aircraft, nose pointing down -z. */
export function createPlane(): PlaneModel {
  const group = new Group();
  const hull = body(0xe8ecf2, 0.35, 0.35);
  const accent = body(0x1c2b45, 0.4, 0.3);

  const fuselage = new Mesh(new CapsuleGeometry(0.9, 5.2, 6, 12), hull);
  fuselage.rotation.x = Math.PI / 2;
  group.add(fuselage);

  const nose = new Mesh(new ConeGeometry(0.85, 1.6, 12), hull);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -3.9;
  group.add(nose);

  const wing = new Mesh(new BoxGeometry(11.5, 0.26, 1.9), hull);
  wing.position.set(0, -0.25, -0.4);
  group.add(wing);

  const wingStripe = new Mesh(new BoxGeometry(11.5, 0.06, 0.4), accent);
  wingStripe.position.set(0, -0.1, -0.4);
  group.add(wingStripe);

  const tailPlane = new Mesh(new BoxGeometry(4.2, 0.2, 0.9), hull);
  tailPlane.position.set(0, 0.25, 3.1);
  group.add(tailPlane);

  const fin = new Mesh(new BoxGeometry(0.18, 1.5, 1.3), accent);
  fin.position.set(0, 1, 3.2);
  group.add(fin);

  const canopy = new Mesh(new SphereGeometry(0.72, 12, 8), body(0x0e1a2c, 0.1, 0.7));
  canopy.scale.set(1, 0.75, 1.7);
  canopy.position.set(0, 0.55, -0.9);
  group.add(canopy);

  const propeller = new Group();
  for (let i = 0; i < 2; i++) {
    const blade = new Mesh(new BoxGeometry(0.12, 2.6, 0.18), body(0x22262e, 0.6, 0.2));
    blade.rotation.z = i * Math.PI * 0.5;
    propeller.add(blade);
  }
  propeller.position.z = -4.7;
  group.add(propeller);

  // Navigation lights: red to port, green to starboard, white on the tail.
  const strobes: Mesh[] = [];
  const lightGeometry = new SphereGeometry(0.16, 8, 6);
  const nav: Array<[number, number, number, number]> = [
    [-5.75, -0.2, -0.4, 0xff3b30],
    [5.75, -0.2, -0.4, 0x34c759],
    [0, 1.7, 3.2, 0xffffff],
  ];
  for (const [x, y, z, colour] of nav) {
    const light = new Mesh(lightGeometry, glow(colour, 3));
    light.position.set(x, y, z);
    group.add(light);
    strobes.push(light);
  }

  const gear = body(0x1a1d22, 0.8, 0.1);
  for (const [x, z] of [
    [-1.5, -0.4],
    [1.5, -0.4],
    [0, 2.6],
  ] as const) {
    const wheel = new Mesh(new CylinderGeometry(0.34, 0.34, 0.2, 10), gear);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, -1.15, z);
    group.add(wheel);
  }

  group.name = 'plane';
  return { group, propeller, strobes };
}

export interface CarModel {
  group: Group;
  wheels: Object3D[];
  brakeLights: Mesh[];
  /** Real lights, so the road ahead is actually lit at night. */
  headlightBeams: SpotLight[];
}

/** Low coupé, nose pointing down -z, sized for a 4.4 m car. */
export function createCar(): CarModel {
  const group = new Group();
  const paint = body(0x8f1420, 0.28, 0.55);
  const trim = body(0x14161b, 0.5, 0.4);

  const lower = new Mesh(new BoxGeometry(1.9, 0.62, 4.4), paint);
  lower.position.y = 0.62;
  group.add(lower);

  const cabin = new Mesh(new BoxGeometry(1.68, 0.56, 2.2), body(0x0d1017, 0.15, 0.6));
  cabin.position.set(0, 1.16, 0.12);
  group.add(cabin);

  const skirt = new Mesh(new BoxGeometry(1.96, 0.18, 4.2), trim);
  skirt.position.y = 0.34;
  group.add(skirt);

  const spoiler = new Mesh(new BoxGeometry(1.7, 0.08, 0.42), trim);
  spoiler.position.set(0, 1.18, 2.1);
  group.add(spoiler);

  const headlight = glow(0xfff2cc, 2.5);
  for (const x of [-0.62, 0.62]) {
    const lamp = new Mesh(new BoxGeometry(0.42, 0.16, 0.1), headlight);
    lamp.position.set(x, 0.78, -2.21);
    group.add(lamp);
  }

  const brakeLights: Mesh[] = [];
  const brakeMaterial = glow(0xff2a1a, 1.2);
  for (const x of [-0.62, 0.62]) {
    const lamp = new Mesh(new BoxGeometry(0.44, 0.14, 0.08), brakeMaterial);
    lamp.position.set(x, 0.82, 2.21);
    group.add(lamp);
    brakeLights.push(lamp);
  }

  const wheels: Object3D[] = [];
  const tyre = new CylinderGeometry(0.36, 0.36, 0.26, 14);
  const rim = new CylinderGeometry(0.2, 0.2, 0.27, 10);
  for (const [x, z] of [
    [-0.92, -1.42],
    [0.92, -1.42],
    [-0.92, 1.5],
    [0.92, 1.5],
  ] as const) {
    const wheel = new Group();
    const rubber = new Mesh(tyre, body(0x101215, 0.9, 0));
    rubber.rotation.z = Math.PI / 2;
    wheel.add(rubber);
    const hub = new Mesh(rim, body(0xb8bec8, 0.3, 0.8));
    hub.rotation.z = Math.PI / 2;
    wheel.add(hub);
    wheel.position.set(x, 0.36, z);
    group.add(wheel);
    wheels.push(wheel);
  }

  // Two spot lights pointing down the road. They live in the car's group so
  // they inherit its pitch and roll on a slope; intensity is driven by the time
  // of day, and set to zero when the car is not the active vehicle.
  const headlightBeams: SpotLight[] = [];
  for (const x of [-0.62, 0.62]) {
    const beam = new SpotLight(0xfff0d0, 0, 140, Math.PI / 7, 0.55, 1.1);
    beam.position.set(x, 0.78, -2.2);
    beam.target.position.set(x * 1.6, -1.4, -34);
    group.add(beam);
    group.add(beam.target);
    headlightBeams.push(beam);
  }

  group.name = 'car';
  return { group, wheels, brakeLights, headlightBeams };
}

export interface BoatModel {
  group: Group;
  wake: Mesh;
  navLights: Mesh[];
}

/** Small motor yacht, bow pointing down -z. */
export function createBoat(): BoatModel {
  const group = new Group();
  const hullMaterial = body(0xf2f4f7, 0.3, 0.2);
  const deck = body(0x8a6440, 0.7, 0.05);

  const hull = new Mesh(new BoxGeometry(3.2, 1.3, 10.5), hullMaterial);
  hull.position.y = 0.15;
  group.add(hull);

  const bow = new Mesh(new ConeGeometry(1.6, 3.4, 4), hullMaterial);
  bow.rotation.x = -Math.PI / 2;
  bow.rotation.z = Math.PI / 4;
  bow.scale.set(1, 1, 0.42);
  bow.position.set(0, 0.15, -6.4);
  group.add(bow);

  const deckPlate = new Mesh(new BoxGeometry(3.0, 0.1, 9.6), deck);
  deckPlate.position.y = 0.82;
  group.add(deckPlate);

  const cabin = new Mesh(new BoxGeometry(2.2, 1.15, 3.4), hullMaterial);
  cabin.position.set(0, 1.42, -1.1);
  group.add(cabin);

  const windows = new Mesh(new BoxGeometry(2.24, 0.5, 3.0), body(0x0d1a24, 0.1, 0.7));
  windows.position.set(0, 1.6, -1.1);
  group.add(windows);

  const mast = new Mesh(new CylinderGeometry(0.06, 0.06, 1.8, 6), body(0xd8dce2, 0.4, 0.3));
  mast.position.set(0, 2.9, -1.1);
  group.add(mast);

  const navLights: Mesh[] = [];
  const lightGeometry = new SphereGeometry(0.14, 8, 6);
  for (const [x, y, z, colour] of [
    [-1.6, 1.1, -3.4, 0xff3b30],
    [1.6, 1.1, -3.4, 0x34c759],
    [0, 3.8, -1.1, 0xffffff],
  ] as const) {
    const light = new Mesh(lightGeometry, glow(colour, 3));
    light.position.set(x, y, z);
    group.add(light);
    navLights.push(light);
  }

  // Wake: a flat quad behind the transom, faded by its own material opacity.
  const wake = new Mesh(
    new CircleGeometry(1, 16, 0, Math.PI),
    new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: DoubleSide,
    }),
  );
  wake.rotation.x = -Math.PI / 2;
  wake.scale.set(4, 26, 1);
  wake.position.set(0, 0.06, 12);
  group.add(wake);

  group.name = 'boat';
  return { group, wake, navLights };
}
