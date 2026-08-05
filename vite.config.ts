import { defineConfig, type PluginOption } from 'vite';
import { createTileProxy } from './server/tileProxy';

/**
 * Mounts the tile proxy into dev and preview so the browser can reach map data
 * through one origin. The shipped build talks to tile services directly unless
 * the page is loaded with `?tiles=proxy`.
 */
function tileProxyPlugin(): PluginOption {
  const handler = createTileProxy();
  return {
    name: 'flight-tile-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => void handler(req, res, next));
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => void handler(req, res, next));
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [tileProxyPlugin()],
  build: { target: 'es2022', sourcemap: true },
  worker: { format: 'es' },
  server: { host: true },
  // Unit tests are *.test.ts; Playwright owns *.spec.ts under tests/e2e.
  test: { include: ['tests/**/*.test.ts'] },
});
