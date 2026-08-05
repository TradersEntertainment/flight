/**
 * Frame loop with a fixed-timestep physics accumulator.
 *
 * Physics runs at FIXED_HZ so vehicle handling is deterministic regardless of
 * display refresh rate; rendering happens once per animation frame.
 */

export const FIXED_DT = 1 / 60;
const MAX_FRAME_DT = 0.1; // clamp after tab-out so the accumulator cannot explode
const MAX_STEPS_PER_FRAME = 5;

export type StepFn = (dt: number) => void;
export type RenderFn = (alpha: number, frameDt: number) => void;

export class Engine {
  private accumulator = 0;
  private last = 0;
  private running = false;
  private rafId = 0;
  private readonly steps: StepFn[] = [];
  private readonly renders: RenderFn[] = [];
  private readonly frames: StepFn[] = [];

  /** Wall-clock seconds since start, advanced only while running. */
  elapsed = 0;
  /** Smoothed frames per second, for HUD and adaptive quality. */
  fps = 60;

  /** Fixed-timestep callback (physics, vehicle integration). */
  onStep(fn: StepFn): void {
    this.steps.push(fn);
  }

  /** Variable-timestep callback that runs once per frame before render. */
  onFrame(fn: StepFn): void {
    this.frames.push(fn);
  }

  onRender(fn: RenderFn): void {
    this.renders.push(fn);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(loop);
      const frameDt = Math.min((now - this.last) / 1000, MAX_FRAME_DT);
      this.last = now;
      this.elapsed += frameDt;
      this.fps += (1 / Math.max(frameDt, 1e-4) - this.fps) * 0.08;

      this.accumulator += frameDt;
      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
        for (const fn of this.steps) fn(FIXED_DT);
        this.accumulator -= FIXED_DT;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0; // give up on the backlog

      for (const fn of this.frames) fn(frameDt);
      const alpha = this.accumulator / FIXED_DT;
      for (const fn of this.renders) fn(alpha, frameDt);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }
}
