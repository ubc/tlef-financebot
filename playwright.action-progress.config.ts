import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: 'action-progress.spec.ts',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:6118', trace: 'retain-on-failure' },
  reporter: [['list']],
});
