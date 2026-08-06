/**
 * Buildings: OpenStreetMap footprints extruded onto the terrain.
 *
 * One merged mesh per cell keeps the draw calls flat even in a dense city, and
 * the windows are a shader pattern rather than geometry — at night a town reads
 * as thousands of lit windows for the cost of a few instructions.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  type IUniform,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import type { Anchor } from '../../geo/anchor';
import { CellStreamer, type CellContext } from '../osm/cellStreamer';
import { extrudeFootprint, polygonArea, type Point2 } from './extrude';
import { fetchBuildings, type Building } from './overpass';

/** Cells are smaller than the road cells: a city block of buildings is a lot of geometry. */
const CELL_DEGREES = 0.01;
const CELL_RADIUS = 1;
const MAX_CELLS = 30;
/** Footprints smaller than this are sheds and bin stores; skip them. */
const MIN_AREA = 12;
/** Buildings per cell, so one dense district cannot stall a frame. */
const MAX_PER_CELL = 1200;
/** How far the base is sunk below the terrain sample, metres. */
const FOUNDATION = 2.5;

const WINDOW_SHADER = /* glsl */ `
  // v < 0 marks the roof, which has no windows.
  if (vBuildingUv.y >= 0.0) {
    vec2 cell = vec2(vBuildingUv.x / 3.4, vBuildingUv.y);
    vec2 id = floor(cell);
    vec2 f = fract(cell);

    // Antialias the pane edges against their own screen-space derivative.
    // Without this a street of windows turns into crawling static as soon as a
    // cell is smaller than a pixel.
    vec2 blur = fwidth(cell) * 1.4 + 0.001;
    vec2 paneXY = smoothstep(vec2(0.18) - blur, vec2(0.18) + blur, f)
                * (1.0 - smoothstep(vec2(0.80) - blur, vec2(0.80) + blur, f));
    float pane = paneXY.x * paneXY.y;

    // Beyond a few hundred metres individual windows are meaningless; fade to
    // an average glow so a distant town still reads as lit.
    float distance = length(cameraPosition - vBuildingWorld);
    float detail = 1.0 - smoothstep(180.0, 520.0, distance);
    float coverage = mix(0.34, pane, detail);

    // id is constant across a window cell, so the pattern is stable per window
    // rather than per pixel.
    float lit = step(0.58, fract(sin(dot(id, vec2(12.9898, 78.233))) * 43758.5453));
    // Ground floors read as shopfronts: lit more often than flats above.
    float ground = step(id.y, 0.5) * 0.7;
    float on = coverage * max(lit, ground) * uNight;

    totalEmissiveRadiance += vec3(1.0, 0.82, 0.55) * on * uWindowGlow;
    diffuseColor.rgb *= 1.0 - pane * 0.22 * detail;
  }
`;

export interface BuildingUniforms {
  uNight: IUniform<number>;
  uWindowGlow: IUniform<number>;
}

function createBuildingMaterial(uniforms: BuildingUniforms): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color: 0xb9b3a8,
    roughness: 0.86,
    metalness: 0.02,
    vertexColors: true,
  });
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uNight = uniforms.uNight;
    shader.uniforms.uWindowGlow = uniforms.uWindowGlow;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\n varying vec2 vBuildingUv;\n varying vec3 vBuildingWorld;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n vBuildingUv = uv;\n vBuildingWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\n uniform float uNight;\n uniform float uWindowGlow;\n varying vec2 vBuildingUv;\n varying vec3 vBuildingWorld;`,
      )
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${WINDOW_SHADER}`);
  };
  material.customProgramCacheKey = () => 'buildings-v1';
  return material;
}

/** Facade tints, picked per building so a street is not one flat colour. */
const PALETTE = [
  new Color(0xc8c0b2),
  new Color(0xb4a898),
  new Color(0xd6cfc2),
  new Color(0xa89e91),
  new Color(0xc2b6a4),
  new Color(0x9fa4a8),
];

export class Buildings {
  readonly group: Group;
  private readonly streamer: CellStreamer<Building, null>;
  private readonly material: MeshStandardMaterial;
  private readonly uniforms: BuildingUniforms = {
    uNight: { value: 0 },
    uWindowGlow: { value: 1.6 },
  };

  constructor(
    private readonly heightAt: (x: number, z: number) => number,
    enabled: boolean,
  ) {
    this.material = createBuildingMaterial(this.uniforms);
    this.streamer = new CellStreamer<Building, null>({
      name: 'buildings',
      cellDegrees: CELL_DEGREES,
      radius: CELL_RADIUS,
      maxCells: MAX_CELLS,
      fetch: (bbox, signal) => fetchBuildings(bbox, signal),
      build: (items, context) => this.build(items, context),
      disposeCell: (group) => {
        group.traverse((child) => (child as Mesh).geometry?.dispose());
        group.clear();
      },
    });
    this.streamer.enabled = enabled;
    this.group = this.streamer.group;
  }

  setEnabled(enabled: boolean): void {
    this.streamer.setEnabled(enabled);
  }

  setNight(night: number): void {
    this.uniforms.uNight.value = night;
  }

  get hasData(): boolean {
    return this.streamer.hasData;
  }

  get stats(): { cells: number; ready: number; pending: number } {
    return this.streamer.stats;
  }

  update(anchor: Anchor, lon: number, lat: number): void {
    this.streamer.update(anchor, lon, lat);
  }

  /** Feeds footprints straight in, for the screenshot harness and tests. */
  ingest(lon: number, lat: number, buildings: Building[], anchor: Anchor): void {
    this.streamer.ingestDirect(lon, lat, buildings, anchor);
  }

  clear(): void {
    this.streamer.clear();
  }

  dispose(): void {
    this.streamer.clear();
    this.material.dispose();
  }

  /** Merges every footprint in a cell into one mesh. */
  private build(buildings: Building[], context: CellContext): { group: Group } | null {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    let used = 0;

    for (const building of buildings) {
      if (used >= MAX_PER_CELL) break;
      const ring: Point2[] = building.points.map((point) => {
        const world = context.anchor.worldFromLonLat(point.lon, point.lat);
        return { x: world.x - context.centre.x, z: world.z - context.centre.z };
      });
      if (polygonArea(ring) < MIN_AREA) continue;

      // Sit the building on the lowest corner so it never floats on a slope,
      // and sink the base so the walls meet the ground on the high side too.
      let base = Infinity;
      for (const point of ring) {
        const height = this.heightAt(point.x + context.centre.x, point.z + context.centre.z);
        if (height < base) base = height;
      }
      if (!Number.isFinite(base)) continue;

      const geometry = extrudeFootprint(ring, {
        base: base - FOUNDATION,
        top: base + building.height,
        // A stable per-building shift, so neighbours do not light up in step.
        uOffset: (Math.abs(building.id) % 89) * 1.7,
      });
      if (!geometry) continue;

      const offset = positions.length / 3;
      const tint = PALETTE[Math.abs(building.id) % PALETTE.length];
      for (let i = 0; i < geometry.positions.length; i++) positions.push(geometry.positions[i]);
      for (let i = 0; i < geometry.normals.length; i++) normals.push(geometry.normals[i]);
      for (let i = 0; i < geometry.uvs.length; i++) uvs.push(geometry.uvs[i]);
      for (let i = 0; i < geometry.positions.length / 3; i++) {
        colors.push(tint.r, tint.g, tint.b);
      }
      for (let i = 0; i < geometry.indices.length; i++) indices.push(geometry.indices[i] + offset);
      used++;
    }

    if (indices.length === 0) return null;

    const merged = new BufferGeometry();
    merged.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    merged.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    merged.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    merged.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
    merged.setIndex(new BufferAttribute(new Uint32Array(indices), 1));
    merged.computeBoundingSphere();

    const group = new Group();
    const mesh = new Mesh(merged, this.material);
    mesh.renderOrder = 15;
    group.add(mesh);
    return { group };
  }
}
