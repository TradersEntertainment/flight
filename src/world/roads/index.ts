/**
 * Streams OpenStreetMap roads around the player and lights them at night.
 *
 * The world is divided into cells; the cells around the player are fetched once
 * and turned into ribbon meshes draped over the terrain, with instanced lamp
 * posts along the major ones. This is the layer that gives the night drive its
 * look: a chain of sodium lights running off into the dark.
 *
 * Roads are optional. If Overpass is unreachable the cell is marked empty and
 * the game carries on — nothing here is load-bearing.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  CylinderGeometry,
} from 'three';
import type { Anchor } from '../../geo/anchor';
import { latToMercatorY, lonToMercatorX } from '../../geo/mercator';
import { LAMP_SPACING, ROAD_WIDTH, fetchRoads, type Bbox, type RoadWay } from './overpass';
import { buildRibbon, lampSites, type RibbonPoint } from './ribbon';

/** Cell size in degrees; about 2.2 km of latitude. */
const CELL_DEGREES = 0.02;
/** Cells kept resident around the player. */
const CELL_RADIUS = 2;
const MAX_CELLS = 40;
/** Metres the road surface floats above the terrain, to avoid z-fighting. */
const ROAD_LIFT = 0.45;
const LAMP_HEIGHT = 8.5;

interface Cell {
  key: string;
  /** Mercator centre, so the cell can be repositioned after a re-anchor. */
  merc: { x: number; y: number };
  group: Group;
  builtScale: number;
  state: 'loading' | 'ready' | 'empty';
  lastUsed: number;
  abort: AbortController | null;
}

export interface RoadsOptions {
  enabled: boolean;
}

export class Roads {
  readonly group = new Group();
  private readonly cells = new Map<string, Cell>();
  private readonly roadMaterial: MeshStandardMaterial;
  private readonly lampPostMaterial: MeshStandardMaterial;
  private readonly lampGlowMaterial: MeshBasicMaterial;
  private readonly postGeometry = new CylinderGeometry(0.16, 0.22, LAMP_HEIGHT, 5);
  private readonly bulbGeometry = new SphereGeometry(0.6, 8, 6);
  private readonly dummy = new Object3D();
  private frame = 0;
  private inFlight = 0;
  private enabled: boolean;
  private anchorEpoch = -1;
  /** Set once a fetch has succeeded, so the UI can mention road data. */
  hasData = false;

  constructor(
    private readonly heightAt: (x: number, z: number) => number,
    options: RoadsOptions,
  ) {
    this.enabled = options.enabled;
    this.group.name = 'roads';

    this.roadMaterial = new MeshStandardMaterial({
      color: 0x22242a,
      roughness: 0.82,
      metalness: 0.05,
      side: DoubleSide,
      // The ribbon sits just above a terrain surface that changes with LOD;
      // a depth bias keeps it from flickering through.
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    this.lampPostMaterial = new MeshStandardMaterial({
      color: 0x2b2f36,
      roughness: 0.7,
      metalness: 0.4,
    });
    // Basic material: the bulb is its own light source, so it should not be
    // shaded, and bloom picks it up from the raw colour.
    this.lampGlowMaterial = new MeshBasicMaterial({ color: new Color(0xffd08a) });
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  /** Dims the lamps in daylight; they are only interesting at night. */
  setNight(night: number): void {
    const glow = 0.18 + night * 0.82;
    this.lampGlowMaterial.color.setRGB(glow, glow * 0.82, glow * 0.55);
    this.group.visible = this.enabled;
  }

  update(anchor: Anchor, lon: number, lat: number): void {
    if (!this.enabled) return;
    this.frame++;

    if (anchor.epoch !== this.anchorEpoch) {
      this.anchorEpoch = anchor.epoch;
      for (const cell of this.cells.values()) this.position(cell, anchor);
    }

    const cellX = Math.floor(lon / CELL_DEGREES);
    const cellY = Math.floor(lat / CELL_DEGREES);
    for (let dy = -CELL_RADIUS; dy <= CELL_RADIUS; dy++) {
      for (let dx = -CELL_RADIUS; dx <= CELL_RADIUS; dx++) {
        this.ensureCell(cellX + dx, cellY + dy, anchor);
      }
    }
    this.evict();
  }

  private ensureCell(cellX: number, cellY: number, anchor: Anchor): void {
    const key = `${cellX}/${cellY}`;
    const existing = this.cells.get(key);
    if (existing) {
      existing.lastUsed = this.frame;
      return;
    }
    // One request at a time: Overpass is a shared public service.
    if (this.inFlight >= 1) return;

    const bbox: Bbox = {
      west: cellX * CELL_DEGREES,
      south: cellY * CELL_DEGREES,
      east: (cellX + 1) * CELL_DEGREES,
      north: (cellY + 1) * CELL_DEGREES,
    };
    const centreLon = (bbox.west + bbox.east) / 2;
    const centreLat = (bbox.south + bbox.north) / 2;
    const cell: Cell = {
      key,
      merc: { x: lonToMercatorX(centreLon), y: latToMercatorY(centreLat) },
      group: new Group(),
      builtScale: anchor.scale,
      state: 'loading',
      lastUsed: this.frame,
      abort: new AbortController(),
    };
    this.cells.set(key, cell);
    this.inFlight++;

    void fetchRoads(bbox, cell.abort?.signal)
      .then((ways) => {
        cell.abort = null;
        if (!this.cells.has(key)) return;
        if (ways.length === 0) {
          cell.state = 'empty';
          return;
        }
        this.hasData = true;
        this.build(cell, ways, anchor);
        cell.state = 'ready';
        this.group.add(cell.group);
      })
      .catch(() => {
        cell.state = 'empty';
      })
      .finally(() => {
        this.inFlight--;
      });
  }

  /** Builds one merged mesh per road class, plus the lamps. */
  private build(cell: Cell, ways: RoadWay[], anchor: Anchor): void {
    const centre = anchor.worldFromMercator(cell.merc.x, cell.merc.y);
    const byClass = new Map<string, { positions: number[]; uvs: number[]; indices: number[] }>();
    const lampMatrices: Matrix4[] = [];

    for (const way of ways) {
      const points: RibbonPoint[] = way.points.map((point) => {
        const world = anchor.worldFromLonLat(point.lon, point.lat);
        return {
          x: world.x - centre.x,
          y: this.heightAt(world.x, world.z) + ROAD_LIFT,
          z: world.z - centre.z,
        };
      });

      const ribbon = buildRibbon(points, ROAD_WIDTH[way.roadClass]);
      if (!ribbon) continue;

      let bucket = byClass.get(way.roadClass);
      if (!bucket) byClass.set(way.roadClass, (bucket = { positions: [], uvs: [], indices: [] }));
      const offset = bucket.positions.length / 3;
      for (const value of ribbon.positions) bucket.positions.push(value);
      for (const value of ribbon.uvs) bucket.uvs.push(value);
      for (const index of ribbon.indices) bucket.indices.push(index + offset);

      const spacing = LAMP_SPACING[way.roadClass];
      if (spacing !== null || way.lit) {
        const sites = lampSites(points, spacing ?? 40, ROAD_WIDTH[way.roadClass] / 2 + 1.2);
        for (const site of sites) {
          const matrix = new Matrix4();
          matrix.setPosition(site.x + site.offsetX, site.y, site.z + site.offsetZ);
          lampMatrices.push(matrix);
        }
      }
    }

    for (const bucket of byClass.values()) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(bucket.positions), 3));
      geometry.setAttribute('uv', new BufferAttribute(new Float32Array(bucket.uvs), 2));
      geometry.setIndex(new BufferAttribute(new Uint32Array(bucket.indices), 1));
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      const mesh = new Mesh(geometry, this.roadMaterial);
      mesh.renderOrder = 20;
      cell.group.add(mesh);
    }

    if (lampMatrices.length > 0) {
      const posts = new InstancedMesh(this.postGeometry, this.lampPostMaterial, lampMatrices.length);
      const bulbs = new InstancedMesh(this.bulbGeometry, this.lampGlowMaterial, lampMatrices.length);
      lampMatrices.forEach((matrix, i) => {
        const x = matrix.elements[12];
        const y = matrix.elements[13];
        const z = matrix.elements[14];
        this.dummy.position.set(x, y + LAMP_HEIGHT / 2, z);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.updateMatrix();
        posts.setMatrixAt(i, this.dummy.matrix);
        this.dummy.position.set(x, y + LAMP_HEIGHT, z);
        this.dummy.updateMatrix();
        bulbs.setMatrixAt(i, this.dummy.matrix);
      });
      posts.instanceMatrix.needsUpdate = true;
      bulbs.instanceMatrix.needsUpdate = true;
      posts.frustumCulled = false;
      bulbs.frustumCulled = false;
      cell.group.add(posts);
      cell.group.add(bulbs);
    }

    cell.builtScale = anchor.scale;
    this.position(cell, anchor);
  }

  private position(cell: Cell, anchor: Anchor): void {
    const world = anchor.worldFromMercator(cell.merc.x, cell.merc.y);
    cell.group.position.set(world.x, 0, world.z);
    const scale = anchor.scale / cell.builtScale;
    cell.group.scale.set(scale, 1, scale);
  }

  private evict(): void {
    if (this.cells.size <= MAX_CELLS) return;
    const sorted = [...this.cells.values()].sort((a, b) => a.lastUsed - b.lastUsed);
    for (let i = 0; i < this.cells.size - MAX_CELLS; i++) {
      const cell = sorted[i];
      if (cell.lastUsed >= this.frame - 1) continue;
      this.disposeCell(cell);
      this.cells.delete(cell.key);
    }
  }

  private disposeCell(cell: Cell): void {
    cell.abort?.abort();
    this.group.remove(cell.group);
    cell.group.traverse((child) => {
      const mesh = child as Mesh;
      // Materials are shared across cells; only geometry is per-cell.
      mesh.geometry?.dispose();
    });
    cell.group.clear();
  }

  clear(): void {
    for (const cell of this.cells.values()) this.disposeCell(cell);
    this.cells.clear();
  }

  get stats(): { cells: number; ready: number } {
    let ready = 0;
    for (const cell of this.cells.values()) if (cell.state === 'ready') ready++;
    return { cells: this.cells.size, ready };
  }

  dispose(): void {
    this.clear();
    this.roadMaterial.dispose();
    this.lampPostMaterial.dispose();
    this.lampGlowMaterial.dispose();
    this.postGeometry.dispose();
    this.bulbGeometry.dispose();
  }
}
