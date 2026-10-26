import { defineConfig } from '@playwright/test';

// Compiled Admin UI with intercepted APIs; no database, login or provider calls.
export default defineConfig({
  testDir: './tests/e2e', testMatch: ['admin-operations-workspace.spec.ts'], workers: 1,
  reporter: 'list', outputDir: 'audit-results/operations-logging/test-results',
  use: { baseURL: 'http://127.0.0.1:6173', reducedMotion: 'reduce', trace: 'retain-on-failure' },
  webServer: {
    command: 'python3 -m http.server 6173 --bind 127.0.0.1 --directory client/public',
    url: 'http://127.0.0.1:6173', reuseExistingServer: false,
  },
});
