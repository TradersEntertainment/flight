/**
 * Terrain material: MeshStandardMaterial patched so we keep Three's lighting,
 * fog and tone mapping while adding
 *
 *  - a per-tile uv transform, so a tile can draw a sub-rectangle of a coarser
 *    ancestor texture until its own arrives,
 *  - a night grade that darkens and cools the imagery instead of leaving the
 *    world pitch black,
 *  - city glow: bright imagery pixels emit warm light at night, which is what
 *    sells "lit-up towns seen from the air",
 *  - close-range procedural detail so 30 m elevation posts do not read as
 *    smooth plastic when driving.
 */

import {
  Color,
  MeshStandardMaterial,
  Vector4,
  type IUniform,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';

export interface TerrainUniforms {
  uNight: IUniform<number>;
  uCityGlow: IUniform<number>;
  uNightTint: IUniform<Color>;
  uDetail: IUniform<number>;
  uCameraHeight: IUniform<number>;
}

/** Shared across every tile material so one write updates the whole terrain. */
export function createTerrainUniforms(): TerrainUniforms {
  return {
    uNight: { value: 0 },
    uCityGlow: { value: 1 },
    uNightTint: { value: new Color(0.35, 0.45, 0.75) },
    uDetail: { value: 1 },
    uCameraHeight: { value: 1000 },
  };
}

const COMMON_HEADER = /* glsl */ `
  uniform vec4 uUvTransform4;
  uniform float uNight;
  uniform float uCityGlow;
  uniform vec3 uNightTint;
  uniform float uDetail;
  uniform float uCameraHeight;
  varying vec3 vTerrainWorld;
  vec3 gTerrainAlbedo = vec3(0.5);

  float terrainHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float terrainNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = terrainHash(i);
    float b = terrainHash(i + vec2(1.0, 0.0));
    float c = terrainHash(i + vec2(0.0, 1.0));
    float d = terrainHash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
`;

const MAP_FRAGMENT = /* glsl */ `
  #ifdef USE_MAP
    vec2 terrainUv = vMapUv * uUvTransform4.xy + uUvTransform4.zw;
    vec4 terrainTexel = texture2D( map, terrainUv );
    gTerrainAlbedo = terrainTexel.rgb;

    // Close-range detail: two octaves of value noise, faded out with altitude
    // so it never shows as a texture from the air.
    float detailFade = uDetail * clamp(1.0 - uCameraHeight / 900.0, 0.0, 1.0);
    if (detailFade > 0.001) {
      float n = terrainNoise(vTerrainWorld.xz * 0.35) * 0.6
              + terrainNoise(vTerrainWorld.xz * 1.7) * 0.4;
      terrainTexel.rgb *= 1.0 + (n - 0.5) * 0.38 * detailFade;
    }

    // Night grade: darken, pull toward moonlight blue, keep some contrast.
    if (uNight > 0.001) {
      float luma = dot(terrainTexel.rgb, vec3(0.299, 0.587, 0.114));
      vec3 cool = mix(vec3(luma), terrainTexel.rgb, 0.55) * uNightTint;
      terrainTexel.rgb = mix(terrainTexel.rgb, cool * 0.46, uNight);
    }

    diffuseColor *= terrainTexel;
  #endif
`;

const EMISSIVE_FRAGMENT = /* glsl */ `
  #include <emissivemap_fragment>
  #ifdef USE_MAP
    // Bright satellite pixels at night read as settlements; give them a warm
    // glow. Only real imagery earns this: the stylised texture is mid-toned
    // everywhere, so the same rule would set entire landscapes alight
    // (uCityGlow is zero when the fallback texture is in use).
    float cityLuma = dot(gTerrainAlbedo, vec3(0.299, 0.587, 0.114));
    float city = smoothstep(0.62, 0.92, cityLuma) * uNight * uCityGlow;
    totalEmissiveRadiance += vec3(1.0, 0.72, 0.38) * city * 0.45;
  #endif
`;

const WORLDPOS_VERTEX = /* glsl */ `
  #include <begin_vertex>
  vTerrainWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

export interface TerrainMaterialOptions {
  shared: TerrainUniforms;
  map: Texture | null;
}

export interface TerrainMaterial extends MeshStandardMaterial {
  uvTransform4: Vector4;
}

export function createTerrainMaterial(opts: TerrainMaterialOptions): TerrainMaterial {
  const material = new MeshStandardMaterial({
    map: opts.map,
    roughness: 0.96,
    metalness: 0,
    color: 0xffffff,
    dithering: true,
  }) as TerrainMaterial;

  material.uvTransform4 = new Vector4(1, 1, 0, 0);

  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uUvTransform4 = { value: material.uvTransform4 };
    shader.uniforms.uNight = opts.shared.uNight;
    shader.uniforms.uCityGlow = opts.shared.uCityGlow;
    shader.uniforms.uNightTint = opts.shared.uNightTint;
    shader.uniforms.uDetail = opts.shared.uDetail;
    shader.uniforms.uCameraHeight = opts.shared.uCameraHeight;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n varying vec3 vTerrainWorld;`)
      .replace('#include <begin_vertex>', WORLDPOS_VERTEX);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COMMON_HEADER}`)
      .replace('#include <map_fragment>', MAP_FRAGMENT)
      .replace('#include <emissivemap_fragment>', EMISSIVE_FRAGMENT);
  };

  // Tiles that share this shader source share the compiled program.
  material.customProgramCacheKey = () => 'terrain-v1';
  return material;
}
