import { defineConfig } from '@playwright/test';

/** Compiled client receipts only; every API is intercepted by the fixture. */
export default defineConfig({
  testDir: './tests/e2e', testMatch: ['answerability-checks.spec.ts'], workers: 1,
  outputDir: './audit-results/answerability-ui-2026-10-17/playwright',
  reporter: [['list'], ['json', { outputFile: './audit-results/answerability-ui-2026-10-17/report.json' }]],
  use: { baseURL: 'http://127.0.0.1:6167', viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'python3 -m http.server 6167 --bind 127.0.0.1 --directory client/public', url: 'http://127.0.0.1:6167', reuseExistingServer: false },
});
