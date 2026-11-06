import { defineConfig } from '@playwright/test';

/** Mocked compiled UI only; starts a static file server, never the app/jobs/DB. */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['structure-page-text-observations.spec.ts'],
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:6167', viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', trace: 'retain-on-failure' },
  webServer: { command: 'python3 -m http.server 6167 --bind 127.0.0.1 --directory client/public', url: 'http://127.0.0.1:6167', reuseExistingServer: false },
});
