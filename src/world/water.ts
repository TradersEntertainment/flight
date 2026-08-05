/**
 * Ocean surface.
 *
 * A camera-following grid displaced by Gerstner waves. The wave parameters live
 * in one table that is both compiled into the shader and evaluated on the CPU,
 * so the boat floats on exactly the surface the player sees.
 */

import {
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Vector3,
  type IUniform,
  type WebGLProgramParametersWithUniforms,
} from 'three';

export interface WaveSpec {
  /** Direction in the world xz plane. */
  dx: number;
  dz: number;
  /** Crest-to-trough amplitude in metres. */
  amplitude: number;
  /** Wavelength in metres. */
  length: number;
  /** Steepness 0..1; higher values sharpen crests. */
  steepness: number;
}

export const WAVES: WaveSpec[] = [
  { dx: 1, dz: 0.35, amplitude: 0.62, length: 74, steepness: 0.55 },
  { dx: 0.55, dz: -1, amplitude: 0.34, length: 38, steepness: 0.5 },
  { dx: -0.7, dz: -0.35, amplitude: 0.16, length: 17, steepness: 0.45 },
];

const GRAVITY = 9.81;

interface PreparedWave {
  dx: number;
  dz: number;
  k: number;
  speed: number;
  amplitude: number;
  steepness: number;
}

const PREPARED: PreparedWave[] = WAVES.map((w) => {
  const len = Math.hypot(w.dx, w.dz) || 1;
  const k = (2 * Math.PI) / w.length;
  return {
    dx: w.dx / len,
    dz: w.dz / len,
    k,
    speed: Math.sqrt(GRAVITY / k),
    amplitude: w.amplitude,
    steepness: w.steepness,
  };
});

/**
 * Surface height at a world position.
 *
 * Gerstner waves displace horizontally as well as vertically, so this evaluates
 * at the undisplaced position — the standard approximation for buoyancy, off by
 * a fraction of the wave amplitude.
 */
export function waveHeight(x: number, z: number, time: number): number {
  let y = 0;
  for (const w of PREPARED) {
    const phase = w.k * (w.dx * x + w.dz * z) - w.speed * w.k * time;
    y += w.amplitude * Math.sin(phase);
  }
  return y;
}

/** Surface normal, used to align floating hulls with the water. */
export function waveNormal(x: number, z: number, time: number, out = new Vector3()): Vector3 {
  let dx = 0;
  let dz = 0;
  for (const w of PREPARED) {
    const phase = w.k * (w.dx * x + w.dz * z) - w.speed * w.k * time;
    const d = w.amplitude * w.k * Math.cos(phase);
    dx += d * w.dx;
    dz += d * w.dz;
  }
  return out.set(-dx, 1, -dz).normalize();
}

/**
 * Emits the wave sum as GLSL from the same table the CPU uses.
 *
 * The ocean mesh only ever translates, so the world position of a vertex is
 * `position + uOrigin` and the displacement can be applied in local space —
 * no matrix inversion (unavailable in GLSL ES 1.0) is needed.
 */
function waveGlsl(): string {
  return PREPARED.map(
    (w) => `
      {
        vec2 d = vec2(${w.dx.toFixed(6)}, ${w.dz.toFixed(6)});
        float k = ${w.k.toFixed(8)};
        float speed = ${w.speed.toFixed(6)};
        float amp = ${w.amplitude.toFixed(4)};
        float steep = ${w.steepness.toFixed(4)};
        float phase = k * dot(d, p.xz) - speed * k * uTime;
        float c = cos(phase);
        float s = sin(phase);
        gWaveDisp.y += amp * s;
        gWaveDisp.xz += d * (amp * steep * c);
        slope += d * (amp * k * c);
        gCrest += s / ${PREPARED.length.toFixed(1)};
      }`,
  ).join('\n');
}

const VERTEX_HEADER = /* glsl */ `
  uniform float uTime;
  uniform vec3 uOrigin;
  varying vec3 vWaterWorld;
  varying float vCrest;
  varying vec3 vWaterNormal;
  vec3 gWaveDisp = vec3(0.0);
  vec3 gWaveNormal = vec3(0.0, 1.0, 0.0);
  float gCrest = 0.0;

  void computeWaves(vec3 p) {
    vec2 slope = vec2(0.0);
    ${waveGlsl()}
    gWaveNormal = normalize(vec3(-slope.x, 1.0, -slope.y));
  }
`;

// Runs before begin_vertex, so the displaced normal is ready for the lighting
// chunks that follow.
const NORMAL_PATCH = /* glsl */ `
  #include <beginnormal_vertex>
  computeWaves(position + uOrigin);
  objectNormal = gWaveNormal;
`;

const VERTEX_PATCH = /* glsl */ `
  #include <begin_vertex>
  transformed += gWaveDisp;
  vWaterWorld = transformed + uOrigin;
  vWaterNormal = gWaveNormal;
  vCrest = gCrest;
`;

const FRAGMENT_PATCH = /* glsl */ `
  #include <color_fragment>
  float crest = vCrest * 0.5 + 0.5;
  diffuseColor.rgb = mix(uDeepColor, uShallowColor, crest * 0.45);

  // Fresnel sky reflection. Without it the sea is only as bright as the
  // specular highlight, which leaves it black under a sunset or a night sky —
  // water reflects the sky far more than it reflects the sun.
  vec3 viewDir = normalize(cameraPosition - vWaterWorld);
  float facing = clamp(dot(normalize(vWaterNormal), viewDir), 0.0, 1.0);
  float fresnel = pow(1.0 - facing, 4.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, uSkyColor, clamp(fresnel * 0.92, 0.0, 0.88));

  // Foam on the sharpest crests.
  float foam = smoothstep(0.72, 0.98, crest);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.9, 0.95), foam * uFoam);
`;

export interface OceanOptions {
  /** Half-size of the water grid in metres. */
  extent: number;
  segments: number;
}

export class Ocean {
  readonly group = new Group();
  readonly material: MeshStandardMaterial;
  private readonly mesh: Mesh;
  private readonly uTime: IUniform<number> = { value: 0 };
  private readonly uOrigin: IUniform<Vector3> = { value: new Vector3() };
  private readonly uDeep: IUniform<Color> = { value: new Color(0x0b2438) };
  private readonly uShallow: IUniform<Color> = { value: new Color(0x1d5a7a) };
  private readonly uFoam: IUniform<number> = { value: 1 };
  private readonly uSky: IUniform<Color> = { value: new Color(0x9fc0e8) };
  private options: OceanOptions;

  constructor(options: OceanOptions) {
    this.options = options;
    this.material = new MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.12,
      metalness: 0.35,
      transparent: false,
    });

    this.material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uTime = this.uTime;
      shader.uniforms.uOrigin = this.uOrigin;
      shader.uniforms.uDeepColor = this.uDeep;
      shader.uniforms.uShallowColor = this.uShallow;
      shader.uniforms.uFoam = this.uFoam;
      shader.uniforms.uSkyColor = this.uSky;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERTEX_HEADER}`)
        .replace('#include <beginnormal_vertex>', NORMAL_PATCH)
        .replace('#include <begin_vertex>', VERTEX_PATCH);
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>\n uniform vec3 uDeepColor;\n uniform vec3 uShallowColor;\n uniform float uFoam;\n uniform vec3 uSkyColor;\n varying vec3 vWaterWorld;\n varying vec3 vWaterNormal;\n varying float vCrest;`,
        )
        .replace('#include <color_fragment>', FRAGMENT_PATCH);
    };
    this.material.customProgramCacheKey = () => 'ocean-v1';

    const geometry = new PlaneGeometry(
      options.extent * 2,
      options.extent * 2,
      options.segments,
      options.segments,
    );
    geometry.rotateX(-Math.PI / 2);
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.group.add(this.mesh);
    this.group.name = 'ocean';
  }

  /** The colour the surface reflects; driven by the sky each frame. */
  setSkyColour(colour: Color): void {
    this.uSky.value.copy(colour);
  }

  setNight(night: number): void {
    this.uDeep.value.setRGB(0.043, 0.14, 0.22).multiplyScalar(1 - night * 0.72);
    this.uShallow.value.setRGB(0.11, 0.35, 0.48).multiplyScalar(1 - night * 0.62);
    this.material.roughness = 0.12 + night * 0.06;
    this.uFoam.value = 1 - night * 0.45;
  }

  setDetail(segments: number): void {
    if (segments === this.options.segments) return;
    this.options = { ...this.options, segments };
    const geometry = new PlaneGeometry(
      this.options.extent * 2,
      this.options.extent * 2,
      segments,
      segments,
    );
    geometry.rotateX(-Math.PI / 2);
    this.mesh.geometry.dispose();
    this.mesh.geometry = geometry;
  }

  update(time: number, cameraPosition: Vector3): void {
    this.uTime.value = time;
    // Snap to a grid cell so vertices do not swim under the camera.
    const cell = (this.options.extent * 2) / this.options.segments;
    this.group.position.set(
      Math.round(cameraPosition.x / cell) * cell,
      0,
      Math.round(cameraPosition.z / cell) * cell,
    );
    // The shader reads world position as `position + uOrigin`, so the waves
    // stay put while the grid follows the camera.
    this.uOrigin.value.copy(this.group.position);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
