/**
 * Touch controls.
 *
 * A left thumb stick for the steering axes and two pedals on the right. Values
 * feed the same action map as the keyboard, so vehicles need no touch-specific
 * code. Only shown when the device actually reports touch.
 */

import type { Input } from '../core/input';

export function hasTouch(): boolean {
  return typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
}

const STICK_RADIUS = 58;

export class TouchControls {
  private readonly root = document.createElement('div');
  private readonly stick = document.createElement('div');
  private readonly knob = document.createElement('i');
  private stickPointer: number | null = null;
  private stickOrigin = { x: 0, y: 0 };

  constructor(parent: HTMLElement, private readonly input: Input) {
    this.root.className = 'touch';
    this.stick.className = 'stick';
    this.stick.appendChild(this.knob);
    this.root.appendChild(this.stick);

    const pedals = document.createElement('div');
    pedals.className = 'pedals';
    pedals.appendChild(this.pedal('▲', 'throttleUp'));
    pedals.appendChild(this.pedal('▼', 'throttleDown'));
    pedals.appendChild(this.pedal('■', 'brake'));
    this.root.appendChild(pedals);

    parent.appendChild(this.root);
    document.body.classList.toggle('touch-mode', hasTouch());

    this.stick.addEventListener('pointerdown', (e) => this.onStickDown(e));
    window.addEventListener('pointermove', (e) => this.onStickMove(e));
    window.addEventListener('pointerup', (e) => this.onStickUp(e));
    window.addEventListener('pointercancel', (e) => this.onStickUp(e));
  }

  private pedal(label: string, action: 'throttleUp' | 'throttleDown' | 'brake'): HTMLElement {
    const button = document.createElement('button');
    button.className = 'pedal';
    button.type = 'button';
    button.textContent = label;
    const press = (down: boolean) => (e: PointerEvent) => {
      e.preventDefault();
      // Held actions are re-applied each frame; see the loop in Game.
      this.held.set(action, down);
    };
    button.addEventListener('pointerdown', press(true));
    button.addEventListener('pointerup', press(false));
    button.addEventListener('pointerleave', press(false));
    button.addEventListener('pointercancel', press(false));
    return button;
  }

  private readonly held = new Map<'throttleUp' | 'throttleDown' | 'brake', boolean>();
  private axis = { x: 0, y: 0 };

  private onStickDown(e: PointerEvent): void {
    e.preventDefault();
    this.stickPointer = e.pointerId;
    const rect = this.stick.getBoundingClientRect();
    this.stickOrigin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    this.onStickMove(e);
  }

  private onStickMove(e: PointerEvent): void {
    if (this.stickPointer !== e.pointerId) return;
    const dx = (e.clientX - this.stickOrigin.x) / STICK_RADIUS;
    const dy = (e.clientY - this.stickOrigin.y) / STICK_RADIUS;
    const length = Math.hypot(dx, dy);
    const scale = length > 1 ? 1 / length : 1;
    this.axis = { x: dx * scale, y: dy * scale };
    this.knob.style.transform = `translate(${this.axis.x * STICK_RADIUS * 0.6}px, ${
      this.axis.y * STICK_RADIUS * 0.6
    }px)`;
  }

  private onStickUp(e: PointerEvent): void {
    if (this.stickPointer !== e.pointerId) return;
    this.stickPointer = null;
    this.axis = { x: 0, y: 0 };
    this.knob.style.transform = '';
  }

  /**
   * Pushes the current touch state into the input layer.
   *
   * Called once per fixed step because virtual actions are cleared each step —
   * that is what lets the keyboard and touch coexist without either latching.
   */
  apply(): void {
    if (this.axis.x < 0) this.input.setVirtual('left', -this.axis.x);
    else if (this.axis.x > 0) this.input.setVirtual('right', this.axis.x);
    // Screen down is nose up, matching the arrow keys.
    if (this.axis.y > 0) this.input.setVirtual('pitchUp', this.axis.y);
    else if (this.axis.y < 0) this.input.setVirtual('pitchDown', -this.axis.y);

    for (const [action, down] of this.held) {
      if (down) this.input.setVirtual(action, 1);
    }
  }
}
