/**
 * Sound, synthesised.
 *
 * No audio files: every sound here is oscillators and filtered noise, which
 * keeps the download at zero bytes, sidesteps sample licensing, and — more
 * usefully — lets the engine note follow the vehicle continuously instead of
 * cross-fading between recorded loops.
 *
 * Browsers refuse to start audio without a gesture, so the context is created
 * on the first key press or tap and the game is silent until then.
 */

import {
  CAR_GEARBOX,
  engineNote,
  marineNote,
  propellerNote,
  windLevel,
} from './engine';
import type { VehicleKind } from '../vehicles/types';

export interface AudioState {
  kind: VehicleKind;
  /** Metres per second along the ground or through the air. */
  speed: number;
  throttle: number;
  /** True when the wheels or hull are off the surface. */
  airborne: boolean;
  /** Surface roughness 0..1: tarmac is smooth, open ground is not. */
  roughness: number;
  /** How hard the vehicle is sliding, 0..1. */
  slip: number;
}

/** One filtered-noise voice: wind, tyres, water. */
interface NoiseVoice {
  source: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

const SMOOTHING = 0.08;

export class AudioSystem {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private oscillators: OscillatorNode[] = [];
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private wind: NoiseVoice | null = null;
  private surface: NoiseVoice | null = null;
  private started = false;
  private enabled: boolean;
  /** Smoothed values, so a dropped frame does not click. */
  private frequency = 40;
  private engineLevel = 0;
  private windLevelValue = 0;
  private surfaceLevel = 0;

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  /**
   * Creates the audio graph. Must be called from a user gesture; calling it
   * again afterwards is harmless.
   */
  start(): void {
    if (this.started || !this.enabled) return;
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.context = new Ctor();
    } catch {
      return; // audio unavailable; the game is simply silent
    }
    this.started = true;

    const context = this.context;
    this.master = context.createGain();
    this.master.gain.value = 0.0001;
    // A compressor keeps the mix from clipping when several voices peak at once.
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.ratio.value = 8;
    this.master.connect(compressor).connect(context.destination);

    this.engineGain = context.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = context.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 700;
    this.engineFilter.Q.value = 3;
    this.engineFilter.connect(this.engineGain).connect(this.master);

    // Three detuned voices an octave apart give the note some body; a single
    // sawtooth sounds like a doorbell.
    for (const [type, ratio, level, detune] of [
      ['sawtooth', 1, 0.6, 0],
      ['sawtooth', 2, 0.25, 7],
      ['square', 0.5, 0.3, -5],
    ] as const) {
      const oscillator = context.createOscillator();
      oscillator.type = type;
      oscillator.frequency.value = 40 * ratio;
      oscillator.detune.value = detune;
      const gain = context.createGain();
      gain.gain.value = level;
      oscillator.connect(gain).connect(this.engineFilter);
      oscillator.start();
      this.oscillators.push(oscillator);
    }

    this.wind = this.createNoise(context, 'bandpass', 500, 0.7);
    this.surface = this.createNoise(context, 'bandpass', 1400, 1.4);

    void context.resume();
  }

  private createNoise(
    context: AudioContext,
    type: BiquadFilterType,
    frequency: number,
    q: number,
  ): NoiseVoice {
    // Two seconds of noise, looped: long enough that the loop is not audible.
    const length = context.sampleRate * 2;
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 1;
    for (let i = 0; i < length; i++) {
      // A deterministic generator, so the noise floor is identical every run.
      seed = (seed * 1103515245 + 12345) % 2147483648;
      data[i] = (seed / 1073741824 - 1) * 0.5;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = context.createGain();
    gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(this.master!);
    source.start();
    return { source, filter, gain };
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled && this.master && this.context) {
      this.master.gain.setTargetAtTime(0.0001, this.context.currentTime, 0.05);
    }
  }

  get isRunning(): boolean {
    return this.started && this.context?.state === 'running';
  }

  /** Called every frame; silent until `start` has run. */
  update(state: AudioState): void {
    if (!this.started || !this.context || !this.master) return;
    if (!this.enabled) return;
    const now = this.context.currentTime;

    let targetFrequency: number;
    let engineTarget: number;
    let windReference: number;
    switch (state.kind) {
      case 'plane':
        targetFrequency = propellerNote(state.throttle, state.speed);
        engineTarget = 0.1 + state.throttle * 0.22;
        windReference = 110;
        break;
      case 'boat':
        targetFrequency = marineNote(state.throttle, state.speed);
        engineTarget = 0.12 + Math.abs(state.throttle) * 0.2;
        windReference = 40;
        break;
      default: {
        const note = engineNote(state.speed, state.throttle, CAR_GEARBOX);
        targetFrequency = note.frequency;
        engineTarget = 0.09 + note.load * 0.16 + state.throttle * 0.05;
        windReference = 75;
      }
    }

    // Smooth every parameter: stepping them straight to target clicks.
    this.frequency += (targetFrequency - this.frequency) * SMOOTHING;
    this.engineLevel += (engineTarget - this.engineLevel) * SMOOTHING;
    const windTarget = windLevel(state.speed, windReference) * (state.kind === 'boat' ? 0.5 : 1);
    this.windLevelValue += (windTarget - this.windLevelValue) * SMOOTHING;
    const surfaceTarget = state.airborne
      ? 0
      : Math.min(1, Math.abs(state.speed) / 45) * (0.25 + state.roughness * 0.75) +
        state.slip * 0.5;
    this.surfaceLevel += (surfaceTarget - this.surfaceLevel) * SMOOTHING;

    const ratios = [1, 2, 0.5];
    this.oscillators.forEach((oscillator, i) => {
      oscillator.frequency.setTargetAtTime(this.frequency * ratios[i], now, 0.02);
    });
    this.engineFilter?.frequency.setTargetAtTime(
      500 + state.throttle * 2200 + this.frequency * 4,
      now,
      0.05,
    );
    this.engineGain?.gain.setTargetAtTime(this.engineLevel, now, 0.05);

    if (this.wind) {
      this.wind.gain.gain.setTargetAtTime(this.windLevelValue * 0.35, now, 0.08);
      this.wind.filter.frequency.setTargetAtTime(400 + this.windLevelValue * 900, now, 0.1);
    }
    if (this.surface) {
      this.surface.gain.gain.setTargetAtTime(this.surfaceLevel * 0.22, now, 0.05);
      // Tarmac hisses higher than gravel.
      this.surface.filter.frequency.setTargetAtTime(900 + (1 - state.roughness) * 1400, now, 0.1);
    }

    this.master.gain.setTargetAtTime(0.9, now, 0.2);
  }

  /** A short thump for a crash or a heavy landing. */
  impact(strength: number): void {
    if (!this.started || !this.context || !this.master || !this.enabled) return;
    const context = this.context;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(140, now);
    oscillator.frequency.exponentialRampToValueAtTime(40, now + 0.35);
    const gain = context.createGain();
    gain.gain.setValueAtTime(Math.min(0.6, strength * 0.5), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.55);
  }

  dispose(): void {
    for (const oscillator of this.oscillators) oscillator.stop();
    this.oscillators = [];
    this.wind?.source.stop();
    this.surface?.source.stop();
    void this.context?.close();
    this.context = null;
    this.started = false;
  }
}
