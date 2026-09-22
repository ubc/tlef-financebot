import { defineConfig } from '@playwright/test';

// Real sharing components, intercepted APIs; no live access or email changes.
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: 'course-sharing.spec.ts',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:6118', viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', trace: 'retain-on-failure' },
  outputDir: 'audit-results/course-sharing/test-results',
  reporter: [['list'], ['json', { outputFile: 'audit-results/course-sharing/results.json' }]],
});
