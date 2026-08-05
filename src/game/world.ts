/**
 * The world: renderer, scene, streaming terrain, sky and ocean.
 *
 * Everything geographic goes through `anchor`; vehicles and UI talk to the world
 * in metres and lon/lat and never touch tiles directly.
 */

import {
  ACESFilmicToneMapping,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { Anchor, REANCHOR_DISTANCE } from '../geo/anchor';
import { ElevationStore } from '../world/elevation';
import { TileFetcher } from '../world/tiles/fetcher';
import { TerrainTextures } from '../world/terrain/textures';
import { Terrain } from '../world/terrain';
import { createTerrainUniforms, type TerrainUniforms } from '../world/terrain/material';
import { resolveProvider } from '../world/imagery/providers';
import { Sky, type TimeOfDay } from '../world/sky';
import { Ocean } from '../world/water';
import { quality, type Settings } from '../core/settings';

export interface WorldOptions {
  canvas: HTMLCanvasElement;
  settings: Settings;
  spawn: { lon: number; lat: number };
}

export class World {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly anchor: Anchor;
  readonly elevation: ElevationStore;
  readonly terrain: Terrain;
  readonly textures: TerrainTextures;
  readonly sky: Sky;
  readonly ocean: Ocean;
  readonly uniforms: TerrainUniforms;
  private readonly fetcher: TileFetcher;
  private settings: Settings;
  /** Seconds of world time, drives waves and animation. */
  time = 0;
  onNotice: ((message: string) => void) | null = null;

  constructor(opts: WorldOptions) {
    this.settings = opts.settings;
    const q = quality(opts.settings);

    this.renderer = new WebGLRenderer({
      canvas: opts.canvas,
      antialias: !q.postFx,
      powerPreference: 'high-performance',
      // Terrain spans metres to hundreds of kilometres; a logarithmic buffer is
      // the only practical way to keep near geometry and the horizon both stable.
      logarithmicDepthBuffer: true,
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.maxPixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.camera = new PerspectiveCamera(62, window.innerWidth / window.innerHeight, 2, 320_000);
    this.camera.position.set(0, 1200, 0);

    this.anchor = new Anchor(opts.spawn.lon, opts.spawn.lat);
    this.fetcher = new TileFetcher(q.concurrency);
    this.elevation = new ElevationStore(this.fetcher);
    this.uniforms = createTerrainUniforms();
    this.textures = new TerrainTextures(
      this.elevation,
      this.fetcher,
      resolveProvider(opts.settings.imagery),
      q.tileBudget,
    );
    this.textures.onDegrade = (reason) => this.onNotice?.(reason);
    this.terrain = new Terrain(this.elevation, this.textures, this.uniforms, {
      meshSegments: q.meshSegments,
      splitPixels: q.splitPixels,
      tileBudget: q.tileBudget,
    });
    this.scene.add(this.terrain.group);

    this.sky = new Sky(this.scene, this.uniforms, 'night');
    this.scene.add(this.sky.group);

    this.ocean = new Ocean({ extent: 6000, segments: q.waterDetail });
    this.scene.add(this.ocean.group);

    window.addEventListener('resize', this.onResize);
    this.warmUp(opts.spawn.lon, opts.spawn.lat);
  }

  /** Requests the tiles under the spawn point before the first frame. */
  private warmUp(lon: number, lat: number): void {
    for (let z = 5; z <= 15; z++) this.elevation.ensureAt(lon, lat, z, -100 + z);
  }

  private onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  };

  applySettings(settings: Settings): void {
    this.settings = settings;
    const q = quality(settings);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.maxPixelRatio));
    this.fetcher.setConcurrency(q.concurrency);
    this.textures.setBudget(q.tileBudget);
    this.textures.setProvider(resolveProvider(settings.imagery));
    this.terrain.setOptions({
      meshSegments: q.meshSegments,
      splitPixels: q.splitPixels,
      tileBudget: q.tileBudget,
    });
    this.ocean.setDetail(q.waterDetail);
    this.elevation.budget = Math.round(q.tileBudget * 0.8);
  }

  get currentSettings(): Settings {
    return this.settings;
  }

  /** Ground height in metres at a world position. */
  heightAt(x: number, z: number): number {
    const ll = this.anchor.lonLatFromWorld(x, z);
    return this.elevation.sample(ll.lon, ll.lat);
  }

  isWaterAt(x: number, z: number): boolean {
    return this.heightAt(x, z) <= 0;
  }

  /** True once terrain near a world position is loaded at usable detail. */
  hasDetailAt(x: number, z: number, minZoom = 12): boolean {
    const ll = this.anchor.lonLatFromWorld(x, z);
    const best = this.elevation.bestZoomAt(ll.lon, ll.lat);
    return best !== null && best >= minZoom;
  }

  lonLatOf(position: Vector3): { lon: number; lat: number } {
    return this.anchor.lonLatFromWorld(position.x, position.z);
  }

  /**
   * Moves the anchor under a world position when the player has strayed far
   * enough that float precision and the local scale start to matter.
   */
  maybeReanchor(position: Vector3): { x: number; z: number } | null {
    if (Math.hypot(position.x, position.z) < REANCHOR_DISTANCE) return null;
    const ll = this.anchor.lonLatFromWorld(position.x, position.z);
    return this.anchor.moveTo(ll.lon, ll.lat);
  }

  setTimeOfDay(time: TimeOfDay): void {
    this.sky.setTimeOfDay(time);
  }

  update(dt: number): void {
    this.time += dt;
    this.sky.update(dt, this.camera.position);
    this.ocean.update(this.time, this.camera.position);
    this.ocean.setNight(this.sky.nightAmount);
    this.uniforms.uCameraHeight.value = Math.max(
      1,
      this.camera.position.y - this.heightAt(this.camera.position.x, this.camera.position.z),
    );
    this.terrain.update(this.camera, this.anchor, this.renderer.domElement.height);
    // Keep full-detail elevation under the camera even when terrain culls it.
    const ll = this.lonLatOf(this.camera.position);
    this.elevation.ensureAt(ll.lon, ll.lat, 15, -50);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  get attribution(): string {
    const parts = ['Terrain: Mapzen / AWS Open Data'];
    if (this.textures.attribution) parts.unshift(this.textures.attribution);
    return parts.join(' · ');
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.terrain.dispose();
    this.textures.dispose();
    this.elevation.dispose();
    this.sky.dispose();
    this.ocean.dispose();
    this.renderer.dispose();
  }
}
