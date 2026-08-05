/**
 * Screenshot harness.
 *
 * Boots the built game in Chromium, plays a short scripted run and saves a
 * frame — the quickest way to see whether a change to the terrain, sky or a
 * vehicle actually looks right. Needs `npm run build` and a preview server on
 * port 4173.
 *
 *   node scripts/capture.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const SHOT = new URL('../.shots/', import.meta.url).pathname;
mkdirSync(SHOT, { recursive: true });
const browser = await chromium.launch({
  // Software rendering keeps this runnable on a headless box; on a machine with
  // a GPU, drop the flags for a representative frame rate.
  executablePath: process.env.CHROMIUM_PATH ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

async function shot(url, file, drive) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(url);
  await page.waitForSelector('#boot.hidden', { timeout: 60000 }).catch(()=>{});
  await page.waitForTimeout(5000);
  if (drive === 'car') { await page.keyboard.down('KeyW'); await page.waitForTimeout(9000); await page.keyboard.up('KeyW'); }
  if (drive === 'fly') {
    await page.keyboard.down('KeyW'); await page.waitForTimeout(17000);
    await page.keyboard.down('ArrowDown'); await page.waitForTimeout(3500); await page.keyboard.up('ArrowDown');
    await page.waitForTimeout(7000);
    await page.keyboard.down('KeyD'); await page.waitForTimeout(500); await page.keyboard.up('KeyD');
    await page.keyboard.down('ArrowDown'); await page.waitForTimeout(1200); await page.keyboard.up('ArrowDown');
    await page.waitForTimeout(3500); await page.keyboard.up('KeyW');
  }
  if (drive === 'boat') { await page.keyboard.down('KeyW'); await page.waitForTimeout(8000); await page.keyboard.up('KeyW'); await page.waitForTimeout(1500); }
  await page.screenshot({ path: `${SHOT}/${file}` });
  const s = await page.evaluate(() => { const g=window.flight.game; const h=g.vehicles.active.getHud();
    return `${g.vehicles.kind} ${Math.round(h.speed)}${h.speedUnit} ${h.altitude?Math.round(h.altitude)+'m':''}`; });
  console.log(file, '→', s);
  await page.close();
}
await shot('http://127.0.0.1:4173/?tiles=proxy&time=dawn&lat=36.90&lon=30.71', '4-dawn-flight.png', 'fly');
await shot('http://127.0.0.1:4173/?tiles=proxy&time=dawn&veh=boat&lat=41.10&lon=29.06', '5-dawn-boat.png', 'boat');
await browser.close();
