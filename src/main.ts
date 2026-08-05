/**
 * Entry point.
 */

import { Game } from './game/game';
import './ui/style.css';

const canvas = document.getElementById('viewport') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui-root') as HTMLElement;

const game = new Game(canvas, uiRoot);
game.start();

// Handle for the smoke test and for poking at the world from the console.
(window as unknown as { flight: unknown }).flight = {
  world: game.world,
  game,
  engine: game.engine,
};
