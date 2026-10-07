import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e', testMatch: ['student-learning.spec.ts', 'topic-practice-workspace.spec.ts'], workers: 1,
  use: { baseURL: 'http://127.0.0.1:6158', viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' }, reporter: [['list']],
  webServer: { command: 'python3 -m http.server 6158 --bind 127.0.0.1 --directory client/public', url: 'http://127.0.0.1:6158', reuseExistingServer: true },
});
