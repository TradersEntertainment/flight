import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    launchOptions: {
      // The image ships a fixed Chromium build; never re-download it.
      executablePath:
        process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        `--proxy-server=${process.env.HTTPS_PROXY ?? ''}`,
        '--ignore-certificate-errors-spki-list=',
      ].filter((a) => !a.endsWith('=')),
    },
  },
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
