import { defineConfig } from '@playwright/test';

/** Compiled UI only: no application, authentication, database or model worker. */
export default defineConfig({
  testDir: './tests/e2e', testMatch: ['material-provenance.spec.ts'], workers: 1,
  outputDir: './audit-results/pdf-provenance-ui-2026-10-17/playwright',
  reporter: [['list'], ['json', { outputFile: './audit-results/pdf-provenance-ui-2026-10-17/report.json' }]],
  use: { baseURL: 'http://127.0.0.1:6167', viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: {
    command: 'python3 -m http.server 6167 --bind 127.0.0.1 --directory client/public',
    url: 'http://127.0.0.1:6167', reuseExistingServer: false,
  },
});
