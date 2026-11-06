import { defineConfig } from '@playwright/test';

/** Static compiled UI and intercepted synthetic responses; no app or provider. */
export default defineConfig({
  testDir: './tests/e2e', testMatch: ['task-retrieval-checks.spec.ts'], workers: 1, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:6167', viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', trace: 'retain-on-failure' },
  webServer: { command: 'python3 -m http.server 6167 --bind 127.0.0.1 --directory client/public', url: 'http://127.0.0.1:6167', reuseExistingServer: false },
});
