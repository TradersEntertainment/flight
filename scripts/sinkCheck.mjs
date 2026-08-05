/**
 * Ground-penetration check.
 *
 * Drives or flies a vehicle over real terrain and, once a second, raycasts the
 * drawn terrain to compare the vehicle's height against the surface the player
 * actually sees. `sank` is how far the mesh sits above the vehicle: anything
 * positive means the player is looking at their car buried in a hill.
 *
 * Needs `npm run build` and a preview server on 4173.
 *
 *   node scripts/sinkCheck.mjs car 36.73 30.28     # steep mountain
 *   node scripts/sinkCheck.mjs plane 36.75 30.35   # low over ridges
 */
import { chromium } from '@playwright/test';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
const [veh = 'car', lat = '36.73', lon = '30.28'] = process.argv.slice(2);
await page.goto(`http://127.0.0.1:4173/?tiles=proxy&time=day&veh=${veh}&lat=${lat}&lon=${lon}`);
await page.waitForSelector('#boot.hidden', { timeout: 60000 }).catch(()=>{});
await page.waitForTimeout(1200);
await page.evaluate(() => {
  const { Raycaster, Vector3 } = window.flight.three;
  window.__probe = () => {
    const w = window.flight.world, v = window.flight.game.vehicles.active;
    const p = v.getState().position;
    const ray = new Raycaster(new Vector3(p.x, p.y + 600, p.z), new Vector3(0, -1, 0), 0, 8000);
    const hits = ray.intersectObject(w.terrain.group, true).filter((h) => h.object.visible);
    const meshY = hits.length ? hits[0].point.y : null;
    const ll = w.anchor.lonLatFromWorld(p.x, p.z);
    return { y: +p.y.toFixed(1), mesh: meshY === null ? null : +meshY.toFixed(1),
             sank: meshY === null ? null : +(meshY - p.y).toFixed(2),
             hits: hits.length, spread: hits.length > 1 ? +(hits[0].point.y - hits[hits.length-1].point.y).toFixed(1) : 0,
             drawnZ: w.terrain.drawnZoomAt(ll.lon, ll.lat),
             sampled: +w.heightAt(p.x, p.z).toFixed(1), spd: Math.round(v.getHud().speed) };
  };
});
await page.keyboard.down('KeyW');
if (veh === 'plane') { await page.waitForTimeout(16000); await page.keyboard.down('ArrowDown'); await page.waitForTimeout(4000); await page.keyboard.up('ArrowDown'); }
let worst = 0, worstAt = null;
for (let i = 0; i < 14; i++) {
  await page.waitForTimeout(1800);
  const r = await page.evaluate(() => window.__probe());
  if (r.sank !== null && r.sank > worst) { worst = r.sank; worstAt = r; }
  console.log(String(i).padStart(2), JSON.stringify(r));
}
console.log('WORST SINK', worst, JSON.stringify(worstAt));
await browser.close();
