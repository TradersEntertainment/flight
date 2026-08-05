/**
 * Post-processing.
 *
 * Bloom is what makes the night look like the reference: street lights, brake
 * lights and navigation strobes bleed instead of sitting flat, and the tone
 * mapping keeps the day from blowing out. The whole chain is optional — if
 * anything fails to initialise, rendering falls back to a plain forward pass
 * rather than showing a black screen.
 */

import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';

export interface PostOptions {
  bloom: boolean;
  antialias: boolean;
}

export class PostProcessing {
  private composer: EffectComposer | null = null;
  private bloomEffect: BloomEffect | null = null;
  /** False when the composer could not be built; the caller renders directly. */
  readonly available: boolean;

  constructor(
    private readonly renderer: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera,
    options: PostOptions,
  ) {
    let ok = false;
    try {
      const composer = new EffectComposer(renderer, { multisampling: 0 });
      composer.addPass(new RenderPass(scene, camera));

      const effects = [];
      // Tone mapping moves into the composer: the renderer's own pass would run
      // before bloom and clip the highlights bloom needs.
      effects.push(new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }));
      if (options.bloom) {
        this.bloomEffect = new BloomEffect({
          intensity: 1.1,
          luminanceThreshold: 0.62,
          luminanceSmoothing: 0.24,
          mipmapBlur: true,
          radius: 0.72,
        });
        effects.push(this.bloomEffect);
      }
      effects.push(new VignetteEffect({ darkness: 0.32, offset: 0.34 }));
      if (options.antialias) effects.push(new SMAAEffect());

      composer.addPass(new EffectPass(camera, ...effects));
      this.composer = composer;
      renderer.toneMapping = 0; // NoToneMapping: the composer owns it now
      ok = true;
    } catch {
      this.composer = null;
    }
    this.available = ok;
  }

  /** Bloom strengthens at night and backs off in daylight. */
  setNight(night: number): void {
    if (!this.bloomEffect) return;
    this.bloomEffect.intensity = 0.55 + night * 1.15;
    this.bloomEffect.luminanceMaterial.threshold = 0.72 - night * 0.28;
  }

  setSize(width: number, height: number): void {
    this.composer?.setSize(width, height);
  }

  render(deltaTime: number): boolean {
    if (!this.composer) return false;
    this.composer.render(deltaTime);
    return true;
  }

  dispose(): void {
    this.composer?.dispose();
    this.composer = null;
    // Hand tone mapping back to the renderer.
    this.renderer.toneMapping = 4; // ACESFilmicToneMapping
  }
}
