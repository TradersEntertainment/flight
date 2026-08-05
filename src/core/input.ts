/**
 * Action-map input: keyboard, gamepad and virtual (touch) sources feed the same
 * named actions so vehicles never read raw key codes.
 */

export type Action =
  | 'throttleUp'
  | 'throttleDown'
  | 'left'
  | 'right'
  | 'pitchUp'
  | 'pitchDown'
  | 'yawLeft'
  | 'yawRight'
  | 'brake'
  | 'boost';

export type Command =
  | 'vehiclePlane'
  | 'vehicleCar'
  | 'vehicleBoat'
  | 'camera'
  | 'reset'
  | 'search'
  | 'timeOfDay'
  | 'help'
  | 'menu'
  | 'race';

const KEY_ACTIONS: Record<string, Action> = {
  KeyW: 'throttleUp',
  KeyS: 'throttleDown',
  KeyA: 'left',
  KeyD: 'right',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  // Up climbs. Sim players who expect a control column can flip this in the
  // settings; everyone else presses up to go up.
  ArrowUp: 'pitchUp',
  ArrowDown: 'pitchDown',
  KeyQ: 'yawLeft',
  KeyE: 'yawRight',
  Space: 'brake',
  ShiftLeft: 'boost',
  ShiftRight: 'boost',
};

const KEY_COMMANDS: Record<string, Command> = {
  Digit1: 'vehiclePlane',
  Digit2: 'vehicleCar',
  Digit3: 'vehicleBoat',
  KeyC: 'camera',
  KeyR: 'reset',
  KeyT: 'search',
  KeyN: 'timeOfDay',
  KeyH: 'help',
  Escape: 'menu',
  KeyG: 'race',
};

/** Axis values are -1..1, action values 0..1. */
export class Input {
  private readonly down = new Set<Action>();
  private readonly virtual = new Map<Action, number>();
  private readonly listeners = new Map<Command, Set<() => void>>();
  /** When true, keyboard actions are ignored (a text field has focus). */
  captured = false;
  gamepadIndex: number | null = null;

  constructor(target: EventTarget = window) {
    target.addEventListener('keydown', (e) => this.onKey(e as KeyboardEvent, true));
    target.addEventListener('keyup', (e) => this.onKey(e as KeyboardEvent, false));
    window.addEventListener('blur', () => this.down.clear());
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadIndex = (e as GamepadEvent).gamepad.index;
    });
    window.addEventListener('gamepaddisconnected', () => {
      this.gamepadIndex = null;
    });
  }

  private onKey(e: KeyboardEvent, isDown: boolean): void {
    if (e.repeat) return;
    const cmd = KEY_COMMANDS[e.code];
    if (cmd && isDown) {
      // Escape and the search key must work even while typing, to close panels.
      if (!this.captured || cmd === 'menu' || cmd === 'search') {
        e.preventDefault();
        this.emit(cmd);
      }
      if (this.captured) return;
    }
    if (this.captured) return;
    const action = KEY_ACTIONS[e.code];
    if (!action) return;
    e.preventDefault();
    if (isDown) this.down.add(action);
    else this.down.delete(action);
  }

  on(cmd: Command, fn: () => void): void {
    let set = this.listeners.get(cmd);
    if (!set) this.listeners.set(cmd, (set = new Set()));
    set.add(fn);
  }

  private emit(cmd: Command): void {
    const set = this.listeners.get(cmd);
    if (set) for (const fn of set) fn();
  }

  /** Sets a virtual (touch/UI) action value; pass 0 to release. */
  setVirtual(action: Action, value: number): void {
    if (value === 0) this.virtual.delete(action);
    else this.virtual.set(action, Math.max(-1, Math.min(1, value)));
  }

  clearVirtual(): void {
    this.virtual.clear();
  }

  value(action: Action): number {
    const v = this.virtual.get(action) ?? 0;
    const k = this.down.has(action) ? 1 : 0;
    return Math.max(v, k);
  }

  /** Difference of two actions, clamped to -1..1 (e.g. steering). */
  axis(negative: Action, positive: Action): number {
    return Math.max(-1, Math.min(1, this.value(positive) - this.value(negative)));
  }

  /** Reads the gamepad once per frame and folds it into the virtual layer. */
  pollGamepad(): void {
    if (this.gamepadIndex === null || !navigator.getGamepads) return;
    const pad = navigator.getGamepads()[this.gamepadIndex];
    if (!pad) return;
    const dead = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
    const lx = dead(pad.axes[0] ?? 0);
    const ly = dead(pad.axes[1] ?? 0);
    if (lx < 0) this.setVirtual('left', -lx);
    else if (lx > 0) this.setVirtual('right', lx);
    if (ly < 0) this.setVirtual('pitchDown', -ly);
    else if (ly > 0) this.setVirtual('pitchUp', ly);
    const rt = pad.buttons[7]?.value ?? 0;
    const lt = pad.buttons[6]?.value ?? 0;
    if (rt > 0.05) this.setVirtual('throttleUp', rt);
    if (lt > 0.05) this.setVirtual('throttleDown', lt);
    if (pad.buttons[0]?.pressed) this.setVirtual('brake', 1);
  }
}
