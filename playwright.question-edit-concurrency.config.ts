import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e', testMatch: 'question-edit-concurrency.spec.ts', workers: 1,
  use: { baseURL: 'http://127.0.0.1:6118', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  outputDir: 'audit-results/question-edit-concurrency/test-results', reporter: 'list',
});
