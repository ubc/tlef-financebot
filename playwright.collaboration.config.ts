import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e', testMatch: 'question-collaboration.spec.ts', workers: 1, timeout: 120000,
  use: { baseURL: 'http://localhost:6118', viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', trace: 'retain-on-failure' },
  outputDir: 'audit-results/question-collaboration/test-results',
  reporter: [['list'], ['json', { outputFile: 'audit-results/question-collaboration/results.json' }]],
});
