/**
 * Streams OpenStreetMap roads around the player, lights them at night, and lets
 * vehicles drive on them.
 *
 * The geometry is a ribbon draped over the terrain, but a road is more than
 * decoration here: `surfaceAt` answers "am I on a road, how high is it and what
 * is it called", which is what makes the car ride the tarmac instead of the
 * 30 m elevation grid underneath it.
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
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  BoxGeometry,
  CylinderGeometry,
} from 'three';
import type { Anchor } from '../../geo/anchor';
import { CellStreamer, type CellContext } from '../osm/cellStreamer';
import {
  LAMP_SPACING,
  ROAD_WIDTH,
  fetchRoads,
  type RoadClass,
  type RoadWay,
} from './overpass';
import {
  bridgeDeck,
  buildRibbon,
  lampSites,
  resamplePolyline,
  smoothHeights,
  type RibbonPoint,
} from './ribbon';

const CELL_DEGREES = 0.02;
const CELL_RADIUS = 2;
const MAX_CELLS = 36;
/** Metres the road surface floats above the terrain, to avoid z-fighting. */
const ROAD_LIFT = 0.45;
const LAMP_HEIGHT = 8.5;
/** Spacing the source polyline is resampled to before draping, metres. */
const RESAMPLE = 12;
/** Buckets per axis in the per-cell lookup grid. */
const GRID = 24;
/** Metres a bridge deck keeps clear of whatever passes under it. */
const BRIDGE_CLEARANCE = 5;
/** Lowest a deck may sit over open water, metres above sea level. */
const BRIDGE_OVER_WATER = 9;
/** Deck height above the surface below at which piers become visible. */
const PIER_THRESHOLD = 9;
const PIER_SPACING = 70;

interface Segment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  ay: number;
  by: number;
  halfWidth: number;
  wayIndex: number;
}

interface CellIndex {
  /** Segment indices per grid bucket. */
  buckets: number[][];
  segments: Segment[];
  names: Array<string | null>;
  classes: RoadClass[];
  /** Local-space extent of the cell, for bucket lookup. */
  minX: number;
  minZ: number;
  size: number;
}

export interface RoadSurface {
  /** Height of the road surface at the query point, metres. */
  height: number;
  /** 0 at the centre line, 1 at the edge of the carriageway. */
  edgeDistance: number;
  name: string | null;
  roadClass: RoadClass;
}

export class Roads {
  readonly group: Group;
  private readonly streamer: CellStreamer<RoadWay, CellIndex>;
  private readonly roadMaterial: MeshStandardMaterial;
  private readonly lampPostMaterial: MeshStandardMaterial;
  private readonly lampGlowMaterial: MeshBasicMaterial;
  private readonly postGeometry = new CylinderGeometry(0.16, 0.22, LAMP_HEIGHT, 5);
  private readonly bulbGeometry = new SphereGeometry(0.6, 8, 6);
  /** A unit column, scaled per pier; one geometry for every bridge support. */
  private readonly pierGeometry = new BoxGeometry(1, 1, 1);
  private readonly pierMaterial: MeshStandardMaterial;
  private readonly dummy = new Object3D();

  constructor(
    private readonly heightAt: (x: number, z: number) => number,
    options: { enabled: boolean },
  ) {
    this.roadMaterial = new MeshStandardMaterial({
      color: 0x24262c,
      roughness: 0.8,
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
    this.pierMaterial = new MeshStandardMaterial({ color: 0x8d8f94, roughness: 0.9, metalness: 0.05 });

    this.streamer = new CellStreamer<RoadWay, CellIndex>({
      name: 'roads',
      cellDegrees: CELL_DEGREES,
      radius: CELL_RADIUS,
      maxCells: MAX_CELLS,
      fetch: (bbox, signal) => fetchRoads(bbox, signal),
      build: (items, context) => this.build(items, context),
      disposeCell: (group) => {
        // Materials are shared across cells; only geometry is per-cell.
        group.traverse((child) => (child as Mesh).geometry?.dispose());
        group.clear();
      },
    });
    this.streamer.enabled = options.enabled;
    this.group = this.streamer.group;
  }

  setEnabled(enabled: boolean): void {
    this.streamer.setEnabled(enabled);
  }

  /** Dims the lamps in daylight; they are only interesting at night. */
  setNight(night: number): void {
    const glow = 0.18 + night * 0.82;
    this.lampGlowMaterial.color.setRGB(glow, glow * 0.82, glow * 0.55);
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

  /** Feeds ways straight in, for the screenshot harness and tests. */
  ingest(lon: number, lat: number, ways: RoadWay[], anchor: Anchor): void {
    this.streamer.ingestDirect(lon, lat, ways, anchor);
  }

  clear(): void {
    this.streamer.clear();
  }

  /**
   * The road under a world position, if there is one.
   *
   * Returns the closest carriageway the point falls inside. Called once per
   * vehicle step, so it walks a per-cell bucket grid rather than every segment.
   */
  surfaceAt(x: number, z: number): RoadSurface | null {
    let best: RoadSurface | null = null;
    let bestDistance = Infinity;

    for (const { data, group } of this.streamer.ready) {
      const scale = group.scale.x || 1;
      const lx = (x - group.position.x) / scale;
      const lz = (z - group.position.z) / scale;
      const gx = Math.floor(((lx - data.minX) / data.size) * GRID);
      const gz = Math.floor(((lz - data.minZ) / data.size) * GRID);
      if (gx < 0 || gz < 0 || gx >= GRID || gz >= GRID) continue;

      // The neighbouring buckets matter: a segment can cross a bucket border.
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const bx = gx + dx;
          const bz = gz + dz;
          if (bx < 0 || bz < 0 || bx >= GRID || bz >= GRID) continue;
          for (const index of data.buckets[bz * GRID + bx]) {
            const segment = data.segments[index];
            const hit = distanceToSegment(lx, lz, segment);
            if (hit.distance > segment.halfWidth) continue;
            if (hit.distance >= bestDistance) continue;
            bestDistance = hit.distance;
            best = {
              height: segment.ay + (segment.by - segment.ay) * hit.t,
              edgeDistance: hit.distance / segment.halfWidth,
              name: data.names[segment.wayIndex],
              roadClass: data.classes[segment.wayIndex],
            };
          }
        }
      }
    }
    return best;
  }

  dispose(): void {
    this.streamer.clear();
    this.roadMaterial.dispose();
    this.lampPostMaterial.dispose();
    this.lampGlowMaterial.dispose();
    this.pierMaterial.dispose();
    this.postGeometry.dispose();
    this.bulbGeometry.dispose();
    this.pierGeometry.dispose();
  }

  /** Builds one merged mesh per road class, the lamps, and the lookup grid. */
  private build(ways: RoadWay[], context: CellContext): { group: Group; data: CellIndex } | null {
    const group = new Group();
    const byClass = new Map<string, { positions: number[]; uvs: number[]; indices: number[] }>();
    const lampPositions: Array<{ x: number; y: number; z: number }> = [];
    const piers: Array<{ x: number; z: number; base: number; top: number; width: number }> = [];
    const segments: Segment[] = [];
    const names: Array<string | null> = [];
    const classes: RoadClass[] = [];

    for (const way of ways) {
      const raw: RibbonPoint[] = way.points.map((point) => {
        const world = context.anchor.worldFromLonLat(point.lon, point.lat);
        return { x: world.x - context.centre.x, y: 0, z: world.z - context.centre.z };
      });
      // Resample first, then read the terrain, then flatten the profile: a road
      // is engineered, so it should not inherit every ripple of the elevation
      // grid it crosses.
      const points = resamplePolyline(raw, RESAMPLE);
      const ground = points.map((point) =>
        this.heightAt(point.x + context.centre.x, point.z + context.centre.z),
      );
      const width = ROAD_WIDTH[way.roadClass];

      if (way.bridge) {
        bridgeDeck(points, ground, BRIDGE_CLEARANCE, BRIDGE_OVER_WATER);
        collectPiers(points, ground, width, piers);
      } else {
        for (let i = 0; i < points.length; i++) points[i].y = ground[i] + ROAD_LIFT;
        smoothHeights(points, 2);
      }
      const ribbon = buildRibbon(points, width);
      if (!ribbon) continue;

      let bucket = byClass.get(way.roadClass);
      if (!bucket) byClass.set(way.roadClass, (bucket = { positions: [], uvs: [], indices: [] }));
      const offset = bucket.positions.length / 3;
      for (const value of ribbon.positions) bucket.positions.push(value);
      for (const value of ribbon.uvs) bucket.uvs.push(value);
      for (const index of ribbon.indices) bucket.indices.push(index + offset);

      const wayIndex = names.length;
      names.push(way.name);
      classes.push(way.roadClass);
      for (let i = 1; i < points.length; i++) {
        segments.push({
          ax: points[i - 1].x,
          az: points[i - 1].z,
          ay: points[i - 1].y,
          bx: points[i].x,
          bz: points[i].z,
          by: points[i].y,
          halfWidth: width / 2,
          wayIndex,
        });
      }

      const spacing = LAMP_SPACING[way.roadClass];
      if (spacing !== null || way.lit) {
        for (const site of lampSites(points, spacing ?? 40, width / 2 + 1.2)) {
          lampPositions.push({ x: site.x + site.offsetX, y: site.y, z: site.z + site.offsetZ });
        }
      }
    }

    if (segments.length === 0) return null;

    for (const bucket of byClass.values()) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(bucket.positions), 3));
      geometry.setAttribute('uv', new BufferAttribute(new Float32Array(bucket.uvs), 2));
      geometry.setIndex(new BufferAttribute(new Uint32Array(bucket.indices), 1));
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      const mesh = new Mesh(geometry, this.roadMaterial);
      mesh.renderOrder = 20;
      group.add(mesh);
    }

    if (piers.length > 0) {
      const columns = new InstancedMesh(this.pierGeometry, this.pierMaterial, piers.length);
      piers.forEach((pier, i) => {
        const height = pier.top - pier.base;
        this.dummy.position.set(pier.x, pier.base + height / 2, pier.z);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.set(pier.width, height, pier.width);
        this.dummy.updateMatrix();
        columns.setMatrixAt(i, this.dummy.matrix);
      });
      this.dummy.scale.set(1, 1, 1);
      columns.instanceMatrix.needsUpdate = true;
      columns.frustumCulled = false;
      group.add(columns);
    }

    if (lampPositions.length > 0) {
      const posts = new InstancedMesh(this.postGeometry, this.lampPostMaterial, lampPositions.length);
      const bulbs = new InstancedMesh(this.bulbGeometry, this.lampGlowMaterial, lampPositions.length);
      lampPositions.forEach((site, i) => {
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.position.set(site.x, site.y + LAMP_HEIGHT / 2, site.z);
        this.dummy.updateMatrix();
        posts.setMatrixAt(i, this.dummy.matrix);
        this.dummy.position.set(site.x, site.y + LAMP_HEIGHT, site.z);
        this.dummy.updateMatrix();
        bulbs.setMatrixAt(i, this.dummy.matrix);
      });
      posts.instanceMatrix.needsUpdate = true;
      bulbs.instanceMatrix.needsUpdate = true;
      posts.frustumCulled = false;
      bulbs.frustumCulled = false;
      group.add(posts, bulbs);
    }

    return { group, data: indexSegments(segments, names, classes) };
  }
}

/**
 * Places supports under a raised deck.
 *
 * Only where the deck actually stands clear of the surface, and spaced by arc
 * length, so a long water crossing gets a row of piers and a short flyover gets
 * one or two.
 */
function collectPiers(
  points: RibbonPoint[],
  ground: number[],
  width: number,
  out: Array<{ x: number; z: number; base: number; top: number; width: number }>,
): void {
  let sinceLast = PIER_SPACING;
  for (let i = 1; i < points.length; i++) {
    sinceLast += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    if (sinceLast < PIER_SPACING) continue;
    const clearance = points[i].y - ground[i];
    if (clearance < PIER_THRESHOLD) continue;
    sinceLast = 0;
    out.push({
      x: points[i].x,
      z: points[i].z,
      // Sink the foot so a pier standing in water is not a floating box.
      base: ground[i] - 3,
      top: points[i].y,
      width: Math.max(2.2, width * 0.22),
    });
  }
}

/** Buckets segments into a uniform grid covering the cell. */
function indexSegments(
  segments: Segment[],
  names: Array<string | null>,
  classes: RoadClass[],
): CellIndex {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const segment of segments) {
    minX = Math.min(minX, segment.ax, segment.bx);
    maxX = Math.max(maxX, segment.ax, segment.bx);
    minZ = Math.min(minZ, segment.az, segment.bz);
    maxZ = Math.max(maxZ, segment.az, segment.bz);
  }
  const size = Math.max(maxX - minX, maxZ - minZ, 1) * 1.001;
  const buckets: number[][] = Array.from({ length: GRID * GRID }, () => []);

  segments.forEach((segment, index) => {
    // Insert into every bucket the segment's bounding box touches.
    const x0 = Math.floor(((Math.min(segment.ax, segment.bx) - minX) / size) * GRID);
    const x1 = Math.floor(((Math.max(segment.ax, segment.bx) - minX) / size) * GRID);
    const z0 = Math.floor(((Math.min(segment.az, segment.bz) - minZ) / size) * GRID);
    const z1 = Math.floor(((Math.max(segment.az, segment.bz) - minZ) / size) * GRID);
    for (let z = Math.max(0, z0); z <= Math.min(GRID - 1, z1); z++) {
      for (let x = Math.max(0, x0); x <= Math.min(GRID - 1, x1); x++) {
        buckets[z * GRID + x].push(index);
      }
    }
  });

  return { buckets, segments, names, classes, minX, minZ, size };
}

/** Perpendicular distance to a segment, and how far along it the foot lies. */
function distanceToSegment(
  x: number,
  z: number,
  segment: Segment,
): { distance: number; t: number } {
  const dx = segment.bx - segment.ax;
  const dz = segment.bz - segment.az;
  const lengthSquared = dx * dx + dz * dz;
  const t =
    lengthSquared > 0
      ? Math.max(0, Math.min(1, ((x - segment.ax) * dx + (z - segment.az) * dz) / lengthSquared))
      : 0;
  const px = segment.ax + dx * t;
  const pz = segment.az + dz * t;
  return { distance: Math.hypot(x - px, z - pz), t };
}
