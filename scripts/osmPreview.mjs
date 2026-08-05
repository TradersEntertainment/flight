/**
 * Visual check for the OSM layers without a live Overpass service.
 *
 * Feeds a synthetic street grid and block of buildings straight into the road
 * and building streamers, then drives the car down the main street and takes a
 * frame. The data is invented — it exists to exercise the geometry, shading and
 * road-following code paths, not to depict a real place.
 *
 *   node scripts/osmPreview.mjs [night|day]
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const SHOT = new URL('../.shots/', import.meta.url).pathname;
mkdirSync(SHOT, { recursive: true });
const time = process.argv[2] ?? 'night';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(t)) errs.push('CONSOLE ' + t.slice(0, 160));
  if (m.type() === 'warning' && /WebGL|GL_INVALID/.test(t)) errs.push('GL ' + t.slice(0, 140));
});

// Flat coastal ground near Antalya, so the layout is easy to read.
const LON = 30.79, LAT = 36.93;
await page.goto(`http://127.0.0.1:4173/?tiles=proxy&time=${time}&veh=car&lat=${LAT}&lon=${LON}`);
await page.waitForSelector('#boot.hidden', { timeout: 60000 }).catch(() => console.log('BOOT TIMEOUT'));
await page.waitForTimeout(3000);

const injected = await page.evaluate(({ lon, lat }) => {
  const world = window.flight.world;
  const dLon = 1 / (111320 * Math.cos((lat * Math.PI) / 180));
  const dLat = 1 / 110540;

  const ways = [];
  const buildings = [];
  let id = 1;

  // A main road running north, plus cross streets every 120 m.
  const main = [];
  for (let m = -600; m <= 900; m += 40) main.push({ lon, lat: lat + m * dLat });
  ways.push({ id: id++, name: 'Sahil Bulvarı', roadClass: 'primary', lit: true, points: main });

  for (let k = -3; k <= 6; k++) {
    const z = k * 120;
    const cross = [];
    for (let m = -260; m <= 260; m += 40) cross.push({ lon: lon + m * dLon, lat: lat + z * dLat });
    ways.push({ id: id++, name: `${k + 4}. Sokak`, roadClass: 'secondary', lit: true, points: cross });

    // Buildings down both sides of each cross street.
    for (const side of [-1, 1]) {
      for (let b = 0; b < 5; b++) {
        const cx = lon + (30 + b * 42) * side * dLon;
        const cz = lat + (z + 34 * side) * dLat;
        const w = (14 + (b % 3) * 6) * dLon;
        const h = (12 + ((b + k) % 3) * 5) * dLat;
        buildings.push({
          id: id++,
          height: 8 + ((b * 7 + k * 5) % 5) * 6,
          kind: b % 3 === 0 ? 'apartments' : 'house',
          points: [
            { lon: cx - w, lat: cz - h },
            { lon: cx + w, lat: cz - h },
            { lon: cx + w, lat: cz + h },
            { lon: cx - w, lat: cz + h },
          ],
        });
      }
    }
  }

  // A crossing: banks either side, open water between, tagged as a bridge.
  const bridge = [];
  for (let m = -700; m <= 700; m += 50) bridge.push({ lon: lon + m * dLon, lat: lat + 260 * dLat });
  ways.push({ id: id++, name: 'Boğaz Köprüsü', roadClass: 'motorway', lit: true, bridge: true, layer: 1, points: bridge });

  for (const w of ways) if (w.bridge === undefined) { w.bridge = false; w.layer = 0; }
  world.roads.ingest(lon, lat, ways, world.anchor);
  world.buildings.ingest(lon, lat, buildings, world.anchor);
  return { ways: ways.length, buildings: buildings.length };
}, { lon: LON, lat: LAT });
console.log('injected', JSON.stringify(injected));

await page.waitForTimeout(2500);
const onRoad = await page.evaluate(() => {
  const w = window.flight.world;
  const s = w.roadSurfaceAt(0, 0);
  return s ? { name: s.name, height: +s.height.toFixed(2), edge: +s.edgeDistance.toFixed(2) } : null;
});
console.log('road under spawn', JSON.stringify(onRoad));

await page.keyboard.down('KeyW');
await page.waitForTimeout(9000);
await page.keyboard.up('KeyW');
const hud = await page.evaluate(() => {
  const h = window.flight.game.vehicles.active.getHud();
  return { spd: Math.round(h.speed), road: h.surface, label: document.querySelector('.road-label')?.textContent };
});
console.log('driving', JSON.stringify(hud));
const perf = await page.evaluate(() => {
  const w = window.flight.world;
  const info = w.renderer.info.render;
  const t0 = performance.now();
  for (let i = 0; i < 500; i++) w.roadSurfaceAt(Math.random() * 400 - 200, Math.random() * 400 - 200);
  const roadQueryUs = ((performance.now() - t0) / 500) * 1000;
  return { calls: info.calls, tris: info.triangles, roadQueryUs: +roadQueryUs.toFixed(2),
           fps: Math.round(window.flight.game.engine.fps) };
});
console.log('perf', JSON.stringify(perf));
await page.screenshot({ path: `${SHOT}/osm-${time}.png` });
console.log('ERRORS:', errs.length ? errs.slice(0, 4).join(' | ') : 'none');
await browser.close();
