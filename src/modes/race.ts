/**
 * Checkpoint racing.
 *
 * A route is generated ahead of the player along their current heading, so a
 * race can start anywhere in the world without an editor: press the key and the
 * gates appear. Gates are wide rings for the aeroplane and low arches on the
 * ground for the car and boat, sized so they can be hit at speed.
 */

import {
  AdditiveBlending,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  TorusGeometry,
  Vector3,
} from 'three';
import type { World } from '../game/world';
import type { VehicleKind } from '../vehicles/types';

export interface Checkpoint {
  position: Vector3;
  radius: number;
}

export interface RaceResult {
  time: number;
  best: number;
  improved: boolean;
  checkpoints: number;
}

const STORAGE_KEY = 'flight.bestTimes.v1';

/** Gate spacing and size per vehicle, in metres. */
const SHAPE: Record<VehicleKind, { spacing: number; radius: number; height: number }> = {
  plane: { spacing: 2600, radius: 130, height: 260 },
  car: { spacing: 700, radius: 26, height: 6 },
  boat: { spacing: 900, radius: 40, height: 8 },
};

export class RaceMode {
  readonly group = new Group();
  private checkpoints: Checkpoint[] = [];
  private meshes: Mesh[] = [];
  private index = 0;
  private startedAt = 0;
  private running = false;
  private countdown = 0;
  private kind: VehicleKind = 'plane';

  onCountdown: ((value: number) => void) | null = null;
  onFinish: ((result: RaceResult) => void) | null = null;
  onCheckpoint: ((remaining: number) => void) | null = null;

  constructor() {
    this.group.name = 'race';
  }

  get isActive(): boolean {
    return this.running || this.countdown > 0;
  }

  get elapsed(): number {
    return this.running ? performance.now() / 1000 - this.startedAt : 0;
  }

  get remaining(): number {
    return this.checkpoints.length - this.index;
  }

  get nextCheckpoint(): Checkpoint | null {
    return this.checkpoints[this.index] ?? null;
  }

  /** Markers for the minimap: the next gate is highlighted. */
  get markers(): Array<{ x: number; z: number; colour: string; ring?: boolean }> {
    return this.checkpoints.slice(this.index).map((checkpoint, i) => ({
      x: checkpoint.position.x,
      z: checkpoint.position.z,
      colour: i === 0 ? '#6fe3c4' : 'rgba(111,227,196,0.45)',
      ring: i === 0,
    }));
  }

  /**
   * Lays out a route ahead of the player.
   *
   * Gates curve gently left or right so the route is not a straight line, and
   * ground gates follow the terrain. For the boat, gates that would land on dry
   * ground are nudged back toward the water.
   */
  start(world: World, origin: Vector3, heading: number, kind: VehicleKind, gates = 6): void {
    this.clear();
    this.kind = kind;
    const shape = SHAPE[kind];
    let cursor = origin.clone();
    let bearing = heading;
    // A deterministic wiggle keeps routes varied but repeatable within a run.
    const turn = ((Math.floor(origin.x + origin.z) % 7) - 3) * 0.06;

    for (let i = 0; i < gates; i++) {
      bearing += turn + (i % 2 === 0 ? 0.05 : -0.05);
      const next = new Vector3(
        cursor.x + Math.sin(bearing) * shape.spacing,
        0,
        cursor.z - Math.cos(bearing) * shape.spacing,
      );
      const ground = world.heightAt(next.x, next.z);
      if (kind === 'boat' && ground > -1) {
        // Steer the route back out to sea rather than through a headland.
        bearing -= 0.5;
        continue;
      }
      next.y = kind === 'plane' ? Math.max(ground, 0) + shape.height : ground + shape.height;
      this.checkpoints.push({ position: next, radius: shape.radius });
      cursor = next;
    }

    this.index = 0;
    this.countdown = 3.999;
    this.running = false;
    this.buildMeshes();
  }

  private buildMeshes(): void {
    const colour = new Color(0x6fe3c4);
    for (const checkpoint of this.checkpoints) {
      const geometry = new TorusGeometry(checkpoint.radius, checkpoint.radius * 0.045, 8, 40);
      const material = new MeshBasicMaterial({
        color: colour,
        transparent: true,
        opacity: 0.75,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new Mesh(geometry, material);
      mesh.position.copy(checkpoint.position);
      // Rings stand upright for the aeroplane, lie flat for surface vehicles.
      if (this.kind !== 'plane') mesh.rotation.x = Math.PI / 2;
      this.group.add(mesh);
      this.meshes.push(mesh);
    }
    this.updateMeshes();
  }

  private updateMeshes(): void {
    this.meshes.forEach((mesh, i) => {
      mesh.visible = i >= this.index;
      const material = mesh.material as MeshBasicMaterial;
      material.opacity = i === this.index ? 0.95 : 0.35;
    });
  }

  update(dt: number, position: Vector3): void {
    if (this.countdown > 0) {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const now = Math.ceil(this.countdown);
      if (now !== before) this.onCountdown?.(Math.max(0, now));
      if (this.countdown <= 0) {
        this.running = true;
        this.startedAt = performance.now() / 1000;
      }
      return;
    }
    if (!this.running) return;

    const target = this.checkpoints[this.index];
    if (!target) return;
    // Gates are cylinders, not spheres: clipping the edge at speed still counts.
    const horizontal = Math.hypot(position.x - target.position.x, position.z - target.position.z);
    const vertical = Math.abs(position.y - target.position.y);
    if (horizontal < target.radius && vertical < target.radius * 1.2) {
      this.index++;
      this.updateMeshes();
      if (this.index >= this.checkpoints.length) this.finish();
      else this.onCheckpoint?.(this.remaining);
    }

    for (const mesh of this.meshes) mesh.rotation.z += dt * 0.35;
  }

  private finish(): void {
    const time = performance.now() / 1000 - this.startedAt;
    const key = `${this.kind}`;
    const best = loadBest();
    const previous = best[key];
    const improved = previous === undefined || time < previous;
    if (improved) {
      best[key] = time;
      saveBest(best);
    }
    this.running = false;
    this.onFinish?.({
      time,
      best: improved ? time : previous,
      improved,
      checkpoints: this.checkpoints.length,
    });
    this.clear();
  }

  /** Shifts the route when the world anchor moves. */
  shift(delta: { x: number; z: number }): void {
    for (const checkpoint of this.checkpoints) {
      checkpoint.position.x += delta.x;
      checkpoint.position.z += delta.z;
    }
    this.meshes.forEach((mesh, i) => mesh.position.copy(this.checkpoints[i].position));
  }

  clear(): void {
    for (const mesh of this.meshes) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
    }
    this.meshes = [];
    this.checkpoints = [];
    this.index = 0;
    this.running = false;
    this.countdown = 0;
  }
}

function loadBest(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

function saveBest(best: Record<string, number>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(best));
  } catch {
    /* storage unavailable */
  }
}

export function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(2).padStart(5, '0')}`;
}
