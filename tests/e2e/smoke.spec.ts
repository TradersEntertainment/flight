import { expect, test, type ConsoleMessage } from '@playwright/test';

/**
 * Acceptance gate for the streaming terrain: boots the real app against the real
 * elevation service and checks that tiles are selected, built and drawn.
 *
 * Failed tile downloads are not treated as test failures — imagery providers are
 * optional by design and the renderer falls back to the stylised texture. What
 * must never happen is an uncaught exception or a WebGL error.
 */
const EXPECTED_NETWORK_NOISE = /Failed to load resource|net::ERR_/;

test('boots, streams terrain and renders', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    const text = msg.text();
    if (msg.type() === 'error' && !EXPECTED_NETWORK_NOISE.test(text)) errors.push(text);
    // Three logs WebGL problems as warnings; those are real defects for us.
    if (msg.type() === 'warning' && /WebGL|GL_INVALID/.test(text)) errors.push(text);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

  // `tiles=proxy` routes map data through the dev tile proxy, so the test does
  // not depend on the browser reaching tile services directly.
  await page.goto('/?tiles=proxy&lat=41.0082&lon=28.9784&name=Istanbul');

  // The boot overlay only hides once tiles have actually been drawn.
  await expect(page.locator('#boot')).toHaveClass(/hidden/, { timeout: 60_000 });

  await page.waitForTimeout(4000);

  const stats = await page.evaluate(() => {
    const flight = (window as unknown as { flight: { world: { terrain: { stats: unknown } } } })
      .flight;
    return flight.world.terrain.stats as {
      drawn: number;
      meshes: number;
      maxZoom: number;
    };
  });

  expect(stats.drawn).toBeGreaterThan(8);
  expect(stats.maxZoom).toBeGreaterThanOrEqual(13);

  const shot = await page.screenshot();
  await testInfo.attach('terrain', { body: shot, contentType: 'image/png' });
  expect(errors).toEqual([]);
});
