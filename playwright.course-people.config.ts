import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e', testMatch: 'course-people-live.spec.ts', workers: 1, timeout: 180000,
  use: { baseURL: 'http://localhost:6118', viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', trace: 'retain-on-failure' },
  outputDir: 'audit-results/course-people/test-results', reporter: 'list',
});
