import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', testMatch: 'admin-diagnostics.spec.ts', workers: 1,
  timeout: 60_000, reporter: 'list',
  use: { baseURL: 'http://localhost:6118', reducedMotion: 'reduce', trace: 'retain-on-failure' },
});
