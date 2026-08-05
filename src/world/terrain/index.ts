/**
 * Streaming terrain: a quadtree of Mercator tiles selected by screen-space size.
 *
 * Selection rule: a node splits when its ground size covers more than
 * `splitPixels` on screen. Children are only rendered once all four have a mesh,
 * so the surface never opens a hole; while they load, the parent keeps drawing
 * and the desired chain is prefetched in parallel (otherwise reaching z15 would
 * cost ten sequential round trips).
 *
 * Neighbouring tiles at different levels are joined by skirts — a lowered ring
 * around each tile — which is cheaper and steadier than stitching index buffers.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Frustum,
  Group,
  Matrix4,
  Mesh,
  Sphere,
  Vector3,
  type PerspectiveCamera,
} from 'three';
import { mercatorXToLon, mercatorYToLat } from '../../geo/mercator';
import {
  idKey,
  tileAt,
  tileBounds,
  tileCenterMercator,
  tileChildren,
  tileGroundSize,
  tileSpan,
  tilesPerAxis,
  type TileId,
} from '../../geo/tilemath';
import type { Anchor } from '../../geo/anchor';
import type { ElevationStore } from '../elevation';
import { ELEVATION_MAX_ZOOM } from '../elevation';
import type { TerrainTextures } from './textures';
import { createTerrainMaterial, type TerrainMaterial, type TerrainUniforms } from './material';

export const ROOT_ZOOM = 5;
/** Hard ceiling on render zoom; imagery beyond this adds little on screen. */
export const MAX_RENDER_ZOOM = 17;

interface QuadNode {
  id: TileId;
  key: string;
  parent: QuadNode | null;
  children: QuadNode[] | null;
  /** Mercator centre, the anchor-independent identity of the tile. */
  merc: { x: number; y: number };
  groundSize: number;
  mesh: Mesh | null;
  material: TerrainMaterial | null;
  /** Anchor scale the geometry was built with, to correct after re-anchoring. */
  builtScale: number;
  builtEpoch: number;
  minHeight: number;
  maxHeight: number;
  lastUsed: number;
  queued: boolean;
  /** Set when finer elevation arrived under a mesh built from coarser data. */
  needsRebuild: boolean;
  priority: number;
}

export interface TerrainOptions {
  meshSegments: number;
  splitPixels: number;
  tileBudget: number;
}

export interface TerrainStats {
  drawn: number;
  meshes: number;
  queued: number;
  maxZoom: number;
}

/** Metres the sea bed is pushed below the ocean surface (see buildGeometry). */
const SEA_BED_DROP = 2.5;

const SKIRT_FRACTION = 0.06;
const MIN_SKIRT = 12;

export class Terrain {
  readonly group = new Group();
  private readonly roots = new Map<string, QuadNode>();
  private readonly meshNodes = new Map<string, QuadNode>();
  private readonly buildQueue: QuadNode[] = [];
  private readonly frustum = new Frustum();
  private readonly projScreen = new Matrix4();
  private readonly sphere = new Sphere();
  private readonly tmp = new Vector3();
  private frame = 0;
  private anchorEpoch = -1;
  private drawn: QuadNode[] = [];
  stats: TerrainStats = { drawn: 0, meshes: 0, queued: 0, maxZoom: ROOT_ZOOM };

  constructor(
    private readonly elevation: ElevationStore,
    private readonly textures: TerrainTextures,
    private readonly uniforms: TerrainUniforms,
    private options: TerrainOptions,
  ) {
    this.group.name = 'terrain';
    this.group.matrixAutoUpdate = false;
    this.elevation.onTileReady((id) => this.onElevationReady(id));
  }

  setOptions(options: Partial<TerrainOptions>): void {
    const before = this.options.meshSegments;
    this.options = { ...this.options, ...options };
    if (options.meshSegments && options.meshSegments !== before) this.rebuildAll();
  }

  /** Highest render zoom the current imagery justifies. */
  private get maxZoom(): number {
    return Math.min(MAX_RENDER_ZOOM, Math.max(ELEVATION_MAX_ZOOM, this.textures.imageryZoomLimit));
  }

  update(camera: PerspectiveCamera, anchor: Anchor, screenHeight: number): void {
    this.frame++;
    this.elevation.tick();
    this.textures.tick();

    if (anchor.epoch !== this.anchorEpoch) {
      this.anchorEpoch = anchor.epoch;
      this.repositionAll(anchor);
    }

    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    // Pixels a one-metre object covers at one metre distance.
    const pixelScale = screenHeight / (2 * Math.tan(((camera.fov * Math.PI) / 180) / 2));

    this.ensureRoots(camera, anchor);
    this.drawn.length = 0;
    for (const root of this.roots.values()) {
      this.select(root, camera, anchor, pixelScale, this.drawn);
    }

    // Draw exactly the selected set.
    for (const node of this.meshNodes.values()) {
      if (node.mesh) node.mesh.visible = false;
    }
    let maxZoomDrawn = ROOT_ZOOM;
    for (const node of this.drawn) {
      if (!node.mesh) continue;
      node.mesh.visible = true;
      node.lastUsed = this.frame;
      maxZoomDrawn = Math.max(maxZoomDrawn, node.id.z);
      this.applyTexture(node);
    }

    this.processBuildQueue(anchor);
    this.evict();

    this.stats = {
      drawn: this.drawn.length,
      meshes: this.meshNodes.size,
      queued: this.buildQueue.length,
      maxZoom: maxZoomDrawn,
    };
  }

  /** Root tiles are a small window around the camera at a fixed low zoom. */
  private ensureRoots(camera: PerspectiveCamera, anchor: Anchor): void {
    const ll = anchor.lonLatFromWorld(camera.position.x, camera.position.z);
    const centre = tileAt(ll.lon, ll.lat, ROOT_ZOOM);
    const radius = 1;
    const n = tilesPerAxis(ROOT_ZOOM);
    const wanted = new Set<string>();
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const y = centre.y + dy;
        if (y < 0 || y >= n) continue;
        const x = (((centre.x + dx) % n) + n) % n;
        const id: TileId = { z: ROOT_ZOOM, x, y };
        const key = idKey(id);
        wanted.add(key);
        if (!this.roots.has(key)) this.roots.set(key, this.createNode(id, null, anchor));
      }
    }
    for (const [key, root] of this.roots) {
      if (!wanted.has(key)) {
        this.disposeSubtree(root);
        this.roots.delete(key);
      }
    }
  }

  private createNode(id: TileId, parent: QuadNode | null, anchor: Anchor): QuadNode {
    const merc = tileCenterMercator(id);
    const stats = this.elevation.statsFor(this.elevationIdFor(id));
    const node: QuadNode = {
      id,
      key: idKey(id),
      parent,
      children: null,
      merc,
      groundSize: tileGroundSize(id),
      mesh: null,
      material: null,
      builtScale: anchor.scale,
      builtEpoch: anchor.epoch,
      minHeight: stats?.min ?? 0,
      maxHeight: stats?.max ?? 0,
      lastUsed: this.frame,
      queued: false,
      needsRebuild: false,
      priority: 0,
    };
    return node;
  }

  /** Elevation exists only up to z15; deeper tiles reuse their z15 ancestor. */
  private elevationIdFor(id: TileId): TileId {
    if (id.z <= ELEVATION_MAX_ZOOM) return id;
    const shift = id.z - ELEVATION_MAX_ZOOM;
    return { z: ELEVATION_MAX_ZOOM, x: id.x >> shift, y: id.y >> shift };
  }

  private worldCentre(node: QuadNode, anchor: Anchor, out: Vector3): Vector3 {
    const w = anchor.worldFromMercator(node.merc.x, node.merc.y);
    return out.set(w.x, (node.minHeight + node.maxHeight) / 2, w.z);
  }

  private isVisible(node: QuadNode, anchor: Anchor): boolean {
    this.worldCentre(node, anchor, this.tmp);
    const vertical = Math.max(50, (node.maxHeight - node.minHeight) / 2 + 100);
    const radius = Math.hypot(node.groundSize * 0.71, vertical);
    this.sphere.set(this.tmp, radius);
    return this.frustum.intersectsSphere(this.sphere);
  }

  private screenPixels(node: QuadNode, camera: PerspectiveCamera, anchor: Anchor, pixelScale: number): number {
    this.worldCentre(node, anchor, this.tmp);
    const distance = Math.max(1, this.tmp.distanceTo(camera.position) - node.groundSize * 0.5);
    return (node.groundSize / distance) * pixelScale;
  }

  private priorityOf(node: QuadNode, camera: PerspectiveCamera, anchor: Anchor): number {
    this.worldCentre(node, anchor, this.tmp);
    return this.tmp.distanceTo(camera.position) / Math.max(1, node.groundSize);
  }

  private select(
    node: QuadNode,
    camera: PerspectiveCamera,
    anchor: Anchor,
    pixelScale: number,
    out: QuadNode[],
  ): void {
    if (!this.isVisible(node, anchor)) return;
    node.lastUsed = this.frame;
    this.requestData(node, camera, anchor);

    const wantSplit =
      node.id.z < this.maxZoom &&
      this.screenPixels(node, camera, anchor, pixelScale) > this.options.splitPixels;

    if (!wantSplit) {
      this.ensureMesh(node, camera, anchor);
      if (node.mesh) out.push(node);
      else this.fallbackToAncestor(node, out);
      return;
    }

    // Only the children on screen have to be ready: culled ones are never built,
    // so waiting for them would pin the whole subtree at its coarsest level.
    const children = this.ensureChildren(node, anchor);
    const visible = children.filter((c) => this.isVisible(c, anchor));
    if (visible.length > 0 && visible.every((c) => c.mesh !== null)) {
      for (const child of visible) this.select(child, camera, anchor, pixelScale, out);
      return;
    }

    // Draw the coarse version now, but keep loading the chain we actually want.
    this.ensureMesh(node, camera, anchor);
    if (node.mesh) out.push(node);
    else this.fallbackToAncestor(node, out);
    for (const child of visible) this.prefetch(child, camera, anchor, pixelScale);
  }

  /** Keeps something on screen when a node's own mesh is not built yet. */
  private fallbackToAncestor(node: QuadNode, out: QuadNode[]): void {
    let cursor = node.parent;
    while (cursor) {
      if (cursor.mesh) {
        if (!out.includes(cursor)) out.push(cursor);
        return;
      }
      cursor = cursor.parent;
    }
  }

  private prefetch(
    node: QuadNode,
    camera: PerspectiveCamera,
    anchor: Anchor,
    pixelScale: number,
  ): void {
    if (!this.isVisible(node, anchor)) return;
    this.requestData(node, camera, anchor);
    this.ensureMesh(node, camera, anchor);
    if (node.id.z >= this.maxZoom) return;
    if (this.screenPixels(node, camera, anchor, pixelScale) <= this.options.splitPixels) return;
    for (const child of this.ensureChildren(node, anchor)) {
      this.prefetch(child, camera, anchor, pixelScale);
    }
  }

  private ensureChildren(node: QuadNode, anchor: Anchor): QuadNode[] {
    if (!node.children) {
      node.children = tileChildren(node.id).map((id) => this.createNode(id, node, anchor));
    }
    return node.children;
  }

  private requestData(node: QuadNode, camera: PerspectiveCamera, anchor: Anchor): void {
    const priority = this.priorityOf(node, camera, anchor);
    this.elevation.request(this.elevationIdFor(node.id), priority);
    if (node.id.z <= this.textures.imageryZoomLimit) this.textures.request(node.id, priority + 0.5);
  }

  private ensureMesh(node: QuadNode, camera: PerspectiveCamera, anchor: Anchor): void {
    if (node.queued) return;
    if (node.mesh && !node.needsRebuild) return;
    if (!this.elevation.isLoaded(this.elevationIdFor(node.id))) return;
    node.queued = true;
    node.priority = this.priorityOf(node, camera, anchor) + (node.mesh ? 1000 : 0);
    this.buildQueue.push(node);
  }

  private processBuildQueue(anchor: Anchor): void {
    if (this.buildQueue.length === 0) return;
    // Fresh tiles first (they are holes on screen); rebuilds are cosmetic and
    // carry a priority penalty so they never delay first paint.
    this.buildQueue.sort((a, b) => a.priority - b.priority);
    const budget = 2;
    for (let i = 0; i < budget && this.buildQueue.length > 0; i++) {
      const node = this.buildQueue.shift()!;
      node.queued = false;
      this.buildMesh(node, anchor);
    }
  }

  private buildMesh(node: QuadNode, anchor: Anchor): void {
    const segments = this.options.meshSegments;
    const geometry = this.buildGeometry(node, anchor, segments);
    node.needsRebuild = false;

    if (node.mesh) {
      // Rebuild in place so the tile never blinks out.
      node.mesh.geometry.dispose();
      node.mesh.geometry = geometry;
      node.builtScale = anchor.scale;
      node.builtEpoch = anchor.epoch;
      this.positionMesh(node, anchor);
      return;
    }

    const material = createTerrainMaterial({ shared: this.uniforms, map: null });
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = true;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = node.id.z; // finer tiles draw last, hiding coarse seams
    node.mesh = mesh;
    node.material = material;
    node.builtScale = anchor.scale;
    node.builtEpoch = anchor.epoch;
    this.positionMesh(node, anchor);
    this.applyTexture(node);
    mesh.visible = false;
    this.group.add(mesh);
    this.meshNodes.set(node.key, node);
  }

  private buildGeometry(node: QuadNode, anchor: Anchor, segments: number): BufferGeometry {
    const n = segments;
    const g = n + 3; // one skirt ring on each side
    const bounds = tileBounds(node.id);
    const span = tileSpan(node.id.z);
    const centre = anchor.worldFromMercator(node.merc.x, node.merc.y);

    const positions = new Float32Array(g * g * 3);
    const normals = new Float32Array(g * g * 3);
    const uvs = new Float32Array(g * g * 2);
    const heights = new Float32Array(g * g);

    // Latitude varies per row and longitude per column; compute each once.
    const lats = new Float64Array(g);
    const mercYs = new Float64Array(g);
    const lons = new Float64Array(g);
    const mercXs = new Float64Array(g);
    for (let j = 0; j < g; j++) {
      const v = clampIndex(j, n) / n;
      const my = bounds.maxY - v * span;
      mercYs[j] = my;
      lats[j] = mercatorYToLat(my);
    }
    for (let i = 0; i < g; i++) {
      const u = clampIndex(i, n) / n;
      const mx = bounds.minX + u * span;
      mercXs[i] = mx;
      lons[i] = mercatorXToLon(mx);
    }

    const elevationZoom = this.elevationIdFor(node.id).z;
    let min = Infinity;
    let max = -Infinity;
    for (let j = 0; j < g; j++) {
      for (let i = 0; i < g; i++) {
        const idx = j * g + i;
        const raw = this.elevation.sampleAtZoomOrCoarser(lons[i], lats[j], elevationZoom);
        // Open water is exactly 0 m in the elevation data, which is also where
        // the ocean plane sits — coincident surfaces z-fight along every coast.
        // Dropping the sea bed clear of the surface fixes it, and the step is
        // under water where nothing can see it. Land (> 0) is untouched, so
        // vehicles still drive on the height the sampler reports.
        const h = raw > 0 ? raw : raw - SEA_BED_DROP;
        heights[idx] = h;
        if (h < min) min = h;
        if (h > max) max = h;
      }
    }
    node.minHeight = min;
    node.maxHeight = max;

    const skirt = Math.max(MIN_SKIRT, node.groundSize * SKIRT_FRACTION);
    const dx = (node.groundSize / n) * 1;
    for (let j = 0; j < g; j++) {
      const isSkirtRow = j === 0 || j === g - 1;
      for (let i = 0; i < g; i++) {
        const idx = j * g + i;
        const isSkirt = isSkirtRow || i === 0 || i === g - 1;
        const world = anchor.worldFromMercator(mercXs[i], mercYs[j]);
        const p = idx * 3;
        positions[p] = world.x - centre.x;
        positions[p + 1] = heights[idx] - (isSkirt ? skirt : 0);
        positions[p + 2] = world.z - centre.z;

        // Central differences on the height grid give smooth normals.
        const iw = Math.max(0, i - 1);
        const ie = Math.min(g - 1, i + 1);
        const jn = Math.max(0, j - 1);
        const js = Math.min(g - 1, j + 1);
        const dhdx = (heights[j * g + ie] - heights[j * g + iw]) / (2 * dx);
        const dhdz = (heights[js * g + i] - heights[jn * g + i]) / (2 * dx);
        const len = Math.hypot(dhdx, 1, dhdz) || 1;
        normals[p] = -dhdx / len;
        normals[p + 1] = 1 / len;
        normals[p + 2] = -dhdz / len;

        const q = idx * 2;
        uvs[q] = clampIndex(i, n) / n;
        uvs[q + 1] = clampIndex(j, n) / n;
      }
    }

    const quads = (g - 1) * (g - 1);
    const indices = g * g > 65535 ? new Uint32Array(quads * 6) : new Uint16Array(quads * 6);
    let k = 0;
    for (let j = 0; j < g - 1; j++) {
      for (let i = 0; i < g - 1; i++) {
        const a = j * g + i;
        const b = a + 1;
        const c = a + g;
        const d = c + 1;
        indices[k++] = a;
        indices[k++] = c;
        indices[k++] = b;
        indices[k++] = b;
        indices[k++] = c;
        indices[k++] = d;
      }
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
    geometry.setIndex(new BufferAttribute(indices, 1));
    geometry.computeBoundingSphere();
    return geometry;
  }

  private positionMesh(node: QuadNode, anchor: Anchor): void {
    if (!node.mesh) return;
    const w = anchor.worldFromMercator(node.merc.x, node.merc.y);
    node.mesh.position.set(w.x, 0, w.z);
    // Local offsets were baked with the anchor scale of the build; correct for
    // the new one rather than rebuilding the geometry.
    const s = anchor.scale / node.builtScale;
    node.mesh.scale.set(s, 1, s);
    node.mesh.updateMatrix();
  }

  private repositionAll(anchor: Anchor): void {
    for (const node of this.meshNodes.values()) this.positionMesh(node, anchor);
  }

  private applyTexture(node: QuadNode): void {
    if (!node.material) return;
    const resolved = this.textures.resolve(node.id);
    if (!resolved) return;
    const material = node.material;
    if (material.map !== resolved.texture) {
      const hadMap = material.map !== null;
      material.map = resolved.texture;
      if (!hadMap) material.needsUpdate = true; // first map defines USE_MAP
    }
    material.uvTransform4.set(resolved.scale, resolved.scale, resolved.offsetX, resolved.offsetY);
  }

  /**
   * A mesh samples its own elevation level, and its border vertices read one
   * sample into the neighbouring elevation tiles. When such a neighbour arrives
   * after the mesh was built, those border heights change — so the mesh is
   * rebuilt, otherwise adjacent tiles disagree along their shared edge.
   */
  private onElevationReady(id: TileId): void {
    for (const node of this.meshNodes.values()) {
      const elevation = this.elevationIdFor(node.id);
      if (elevation.z !== id.z) continue;
      if (Math.abs(elevation.x - id.x) <= 1 && Math.abs(elevation.y - id.y) <= 1) {
        node.needsRebuild = true;
      }
    }
  }

  private rebuildAll(): void {
    for (const node of this.meshNodes.values()) this.disposeMesh(node);
    this.meshNodes.clear();
    this.buildQueue.length = 0;
  }

  private evict(): void {
    const excess = this.meshNodes.size - this.options.tileBudget;
    if (excess <= 0) return;
    const candidates = [...this.meshNodes.values()]
      .filter((n) => n.lastUsed < this.frame - 1 && this.roots.get(n.key) === undefined)
      .sort((a, b) => a.lastUsed - b.lastUsed);
    for (let i = 0; i < Math.min(excess, candidates.length); i++) {
      const node = candidates[i];
      this.disposeMesh(node);
      this.meshNodes.delete(node.key);
      // A node with no mesh and no drawn children is dead weight; drop children
      // so the tree does not grow without bound.
      if (node.children && node.children.every((c) => c.mesh === null)) node.children = null;
    }
  }

  private disposeMesh(node: QuadNode): void {
    if (!node.mesh) return;
    this.group.remove(node.mesh);
    node.mesh.geometry.dispose();
    node.material?.dispose();
    node.mesh = null;
    node.material = null;
  }

  private disposeSubtree(node: QuadNode): void {
    this.disposeMesh(node);
    this.meshNodes.delete(node.key);
    if (node.children) {
      for (const child of node.children) this.disposeSubtree(child);
      node.children = null;
    }
  }

  dispose(): void {
    for (const root of this.roots.values()) this.disposeSubtree(root);
    this.roots.clear();
    this.meshNodes.clear();
  }
}

function clampIndex(i: number, n: number): number {
  return Math.max(0, Math.min(n, i - 1));
}

