/**
 * Entry point.
 */

import { Raycaster, Vector3 } from 'three';
import { Game } from './game/game';
import './ui/style.css';

const canvas = document.getElementById('viewport') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui-root') as HTMLElement;

const game = new Game(canvas, uiRoot);
game.start();

// Handle for the smoke test and for poking at the world from the console. The
// two three classes are there so a session can raycast the drawn terrain —
// which is how "the car looks like it is inside the hill" gets measured rather
// than guessed at.
(window as unknown as { flight: unknown }).flight = {
  world: game.world,
  game,
  engine: game.engine,
  three: { Raycaster, Vector3 },
};
