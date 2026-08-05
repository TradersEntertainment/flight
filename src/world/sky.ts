/**
 * Sky, stars and the day/night grade.
 *
 * The sky is a shader dome rather than a cubemap so the horizon, sun glow and
 * night palette can be driven continuously from one sun-elevation parameter.
 * Everything else that reacts to time of day — light colour, fog, terrain night
 * uniforms, star opacity — is derived from the same value.
 */

import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  Group,
  HemisphereLight,
  Mesh,
  Points,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import type { TerrainUniforms } from './terrain/material';

export type TimeOfDay = 'day' | 'sunset' | 'night';

/** Sun elevation in degrees for each preset. */
const PRESET_ELEVATION: Record<TimeOfDay, number> = {
  day: 52,
  sunset: 2,
  night: -18,
};

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_Position.z = gl_Position.w; // always at the far plane
  }
`;

const SKY_FRAG = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunSize;
  uniform float uHaze;

  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y;
    vec3 sky = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
    sky = mix(uGround, sky, smoothstep(-0.06, 0.02, h));

    float cosAngle = dot(dir, normalize(uSunDir));
    // Broad glow around the sun, plus a small disc.
    float glow = pow(max(cosAngle, 0.0), 26.0) * 0.16 + pow(max(cosAngle, 0.0), 900.0) * 0.7;
    float disc = smoothstep(uSunSize, uSunSize + 0.0012, cosAngle);
    sky += uSunColor * (glow * uHaze + disc * 1.6);

    gl_FragColor = vec4(sky, 1.0);
  }
`;

interface Palette {
  zenith: Color;
  horizon: Color;
  ground: Color;
  sun: Color;
  light: Color;
  ambientSky: Color;
  ambientGround: Color;
  fog: Color;
  lightIntensity: number;
  ambientIntensity: number;
  fogDensity: number;
  night: number;
}

const DAY: Palette = {
  zenith: new Color(0x2f6fd0),
  horizon: new Color(0xa9c8e8),
  ground: new Color(0x6a7484),
  sun: new Color(0xfff4e0),
  light: new Color(0xfff2dc),
  ambientSky: new Color(0x9fc0e8),
  ambientGround: new Color(0x6b6353),
  fog: new Color(0xa9c2dc),
  lightIntensity: 2.15,
  ambientIntensity: 0.85,
  fogDensity: 1.1e-5,
  night: 0,
};

const SUNSET: Palette = {
  zenith: new Color(0x1d3f7a),
  horizon: new Color(0xe08a4a),
  ground: new Color(0x3a3038),
  sun: new Color(0xffb066),
  light: new Color(0xffa066),
  ambientSky: new Color(0x6a5a80),
  ambientGround: new Color(0x3a2f2a),
  fog: new Color(0x8a6a70),
  lightIntensity: 1.5,
  ambientIntensity: 0.6,
  fogDensity: 1.6e-5,
  night: 0.45,
};

const NIGHT: Palette = {
  zenith: new Color(0x03060f),
  horizon: new Color(0x0b1526),
  ground: new Color(0x05070c),
  sun: new Color(0xbcc8e0),
  light: new Color(0x8fa4cc),
  ambientSky: new Color(0x243354),
  ambientGround: new Color(0x0e1219),
  fog: new Color(0x070c16),
  lightIntensity: 0.55,
  ambientIntensity: 0.46,
  fogDensity: 2.1e-5,
  night: 1,
};

/** Scratch palette that lerpPalette writes into, to avoid per-frame garbage. */
function blankPalette(): Palette {
  return {
    zenith: new Color(),
    horizon: new Color(),
    ground: new Color(),
    sun: new Color(),
    light: new Color(),
    ambientSky: new Color(),
    ambientGround: new Color(),
    fog: new Color(),
    lightIntensity: 1,
    ambientIntensity: 1,
    fogDensity: 2e-5,
    night: 1,
  };
}

function lerpPalette(a: Palette, b: Palette, t: number, out: Palette): Palette {
  out.zenith.copy(a.zenith).lerp(b.zenith, t);
  out.horizon.copy(a.horizon).lerp(b.horizon, t);
  out.ground.copy(a.ground).lerp(b.ground, t);
  out.sun.copy(a.sun).lerp(b.sun, t);
  out.light.copy(a.light).lerp(b.light, t);
  out.ambientSky.copy(a.ambientSky).lerp(b.ambientSky, t);
  out.ambientGround.copy(a.ambientGround).lerp(b.ambientGround, t);
  out.fog.copy(a.fog).lerp(b.fog, t);
  out.lightIntensity = a.lightIntensity + (b.lightIntensity - a.lightIntensity) * t;
  out.ambientIntensity = a.ambientIntensity + (b.ambientIntensity - a.ambientIntensity) * t;
  out.fogDensity = a.fogDensity + (b.fogDensity - a.fogDensity) * t;
  out.night = a.night + (b.night - a.night) * t;
  return out;
}

export class Sky {
  readonly group = new Group();
  readonly sun = new DirectionalLight(0xffffff, 2.5);
  readonly ambient = new HemisphereLight(0x9fc0e8, 0x6b6353, 0.8);
  readonly sunDirection = new Vector3(0.4, 0.7, 0.3).normalize();

  private readonly dome: Mesh;
  private readonly material: ShaderMaterial;
  private readonly stars: Points;
  private readonly starMaterial: PointsMaterial;
  private readonly current: Palette = blankPalette();
  private elevationDeg = PRESET_ELEVATION.night;
  private targetElevation = PRESET_ELEVATION.night;
  /** Sun azimuth in radians, measured from north toward east. */
  private azimuth = 2.5;

  constructor(
    private readonly scene: Scene,
    private readonly terrainUniforms: TerrainUniforms,
    initial: TimeOfDay = 'night',
  ) {
    this.material = new ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      uniforms: {
        uZenith: { value: new Color() },
        uHorizon: { value: new Color() },
        uGround: { value: new Color() },
        uSunDir: { value: this.sunDirection },
        uSunColor: { value: new Color() },
        uSunSize: { value: 0.99975 },
        uHaze: { value: 1 },
      },
    });
    this.dome = new Mesh(new SphereGeometry(1, 32, 16), this.material);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
    this.dome.scale.setScalar(1);
    this.group.add(this.dome);

    this.starMaterial = new PointsMaterial({
      size: 2.2,
      sizeAttenuation: false,
      color: 0xffffff,
      // Opaque-list membership is deliberate: transparent objects draw after
      // everything else, and with depth testing off that would paint stars over
      // the terrain. In the opaque list the negative renderOrder puts them
      // right behind the sky and in front of nothing.
      transparent: false,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      fog: false,
    });
    this.stars = new Points(makeStarField(1400), this.starMaterial);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -999;
    this.group.add(this.stars);

    this.scene.add(this.sun);
    this.scene.add(this.ambient);
    this.scene.fog = new FogExp2(0x070c16, 2e-5);
    this.setTimeOfDay(initial, true);
  }

  setTimeOfDay(time: TimeOfDay, immediate = false): void {
    this.targetElevation = PRESET_ELEVATION[time];
    if (immediate) this.elevationDeg = this.targetElevation;
  }

  /** Cycles day → sunset → night → day. */
  cycle(): TimeOfDay {
    const order: TimeOfDay[] = ['day', 'sunset', 'night'];
    const currentIndex = order.findIndex((t) => PRESET_ELEVATION[t] === this.targetElevation);
    const next = order[(currentIndex + 1) % order.length];
    this.setTimeOfDay(next);
    return next;
  }

  get timeOfDay(): TimeOfDay {
    if (this.elevationDeg > 20) return 'day';
    if (this.elevationDeg > -6) return 'sunset';
    return 'night';
  }

  get nightAmount(): number {
    return this.current.night;
  }

  /** Horizon colour, which is what a flat surface below mostly reflects. */
  get horizonColour(): Color {
    return this.current.horizon;
  }

  update(dt: number, cameraPosition: Vector3): void {
    // Ease toward the target so switching time of day is a transition.
    this.elevationDeg += (this.targetElevation - this.elevationDeg) * Math.min(1, dt * 1.8);

    const rad = (this.elevationDeg * Math.PI) / 180;
    this.sunDirection.set(
      Math.cos(rad) * Math.sin(this.azimuth),
      Math.sin(rad),
      -Math.cos(rad) * Math.cos(this.azimuth),
    );

    // Blend day → sunset → night by sun elevation.
    let palette: Palette;
    if (this.elevationDeg >= PRESET_ELEVATION.sunset) {
      const t = 1 - (this.elevationDeg - PRESET_ELEVATION.sunset) /
        (PRESET_ELEVATION.day - PRESET_ELEVATION.sunset);
      palette = lerpPalette(DAY, SUNSET, clamp01(t), this.current);
    } else {
      const t = (PRESET_ELEVATION.sunset - this.elevationDeg) /
        (PRESET_ELEVATION.sunset - PRESET_ELEVATION.night);
      palette = lerpPalette(SUNSET, NIGHT, clamp01(t), this.current);
    }

    const u = this.material.uniforms;
    (u.uZenith.value as Color).copy(palette.zenith);
    (u.uHorizon.value as Color).copy(palette.horizon);
    (u.uGround.value as Color).copy(palette.ground);
    (u.uSunColor.value as Color).copy(palette.sun);
    u.uHaze.value = 1 - palette.night * 0.85;

    // At night the "sun" is the moon: keep a light in the sky so terrain reads.
    const lightDir = this.elevationDeg < -3 ? this.sunDirection.clone().negate() : this.sunDirection;
    this.sun.position.copy(cameraPosition).addScaledVector(lightDir, 12000);
    this.sun.target.position.copy(cameraPosition);
    this.sun.target.updateMatrixWorld();
    this.sun.color.copy(palette.light);
    this.sun.intensity = palette.lightIntensity;
    this.ambient.color.copy(palette.ambientSky);
    this.ambient.groundColor.copy(palette.ambientGround);
    this.ambient.intensity = palette.ambientIntensity;

    const fog = this.scene.fog as FogExp2;
    fog.color.copy(palette.fog);
    fog.density = palette.fogDensity;
    this.scene.background = palette.fog;

    this.terrainUniforms.uNight.value = palette.night;
    this.starMaterial.opacity = clamp01((palette.night - 0.35) * 1.6);

    // Sky and stars ride with the camera.
    this.group.position.copy(cameraPosition);
    this.dome.scale.setScalar(Math.max(20000, 40000));
    this.stars.scale.setScalar(Math.max(19000, 39000));
    this.stars.rotation.y += dt * 0.0015;
  }

  dispose(): void {
    this.material.dispose();
    this.dome.geometry.dispose();
    this.stars.geometry.dispose();
    this.starMaterial.dispose();
  }
}

function makeStarField(count: number): BufferGeometry {
  const positions = new Float32Array(count * 3);
  let seed = 20260805;
  const random = () => {
    // Deterministic star field so the sky is the same on every load.
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    const u = random() * 2 - 1;
    const theta = random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    positions[i * 3] = r * Math.cos(theta);
    positions[i * 3 + 1] = Math.abs(u) * 0.9 + 0.05; // keep them above the horizon
    positions[i * 3 + 2] = r * Math.sin(theta);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  return geometry;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
