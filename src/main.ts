/**
 * Entry point: builds the world, wires input and drives the frame loop.
 */

import { Engine } from './core/engine';
import { Input } from './core/input';
import { loadSettings } from './core/settings';
import { World } from './game/world';
import { readSpawnFromUrl } from './game/spawn';
import { Vector3 } from 'three';

const canvas = document.getElementById('viewport') as HTMLCanvasElement;
const boot = document.getElementById('boot')!;
const bootStatus = boot.querySelector('.boot-status') as HTMLElement;

const settings = loadSettings();
const spawn = readSpawnFromUrl();
const world = new World({ canvas, settings, spawn });
if (spawn.time === 'day' || spawn.time === 'sunset' || spawn.time === 'night') {
  world.sky.setTimeOfDay(spawn.time, true);
}
const input = new Input();
const engine = new Engine();

// Temporary free camera until the vehicle layer lands.
const cameraVelocity = new Vector3();
let yaw = 0;
let pitch = -0.35;

engine.onStep((dt) => {
  input.pollGamepad();
  yaw -= input.axis('left', 'right') * dt * 0.9;
  pitch = Math.max(-1.4, Math.min(1.2, pitch - input.axis('pitchDown', 'pitchUp') * dt * 0.8));
  const forward = new Vector3(
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
  );
  const speed = 200 + (input.value('boost') > 0 ? 1800 : 0);
  cameraVelocity.addScaledVector(forward, input.axis('throttleDown', 'throttleUp') * speed * dt);
  cameraVelocity.multiplyScalar(1 - Math.min(1, dt * 1.6));
  world.camera.position.addScaledVector(cameraVelocity, dt);
  const ground = world.heightAt(world.camera.position.x, world.camera.position.z);
  world.camera.position.y = Math.max(world.camera.position.y, ground + 30);
  world.camera.lookAt(world.camera.position.clone().add(forward));
  input.clearVirtual();
});

engine.onFrame((dt) => {
  world.update(dt);
});

engine.onRender(() => {
  world.render();
});

let booted = false;
engine.onFrame(() => {
  if (booted) return;
  const stats = world.terrain.stats;
  bootStatus.textContent = `arazi yükleniyor — ${stats.drawn} parça, z${stats.maxZoom}`;
  if (stats.maxZoom >= 11 && stats.drawn > 3) {
    booted = true;
    boot.classList.add('hidden');
    setTimeout(() => boot.remove(), 700);
  }
});

engine.start();

// Expose a handle for the smoke test and for debugging in the console.
(window as unknown as { flight: unknown }).flight = { world, engine, input };
