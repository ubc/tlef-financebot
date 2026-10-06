import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e', testMatch: 'quality-evaluation-review.spec.ts', workers: 1,
  use: { trace: 'retain-on-failure' }, reporter: [['list']],
});
