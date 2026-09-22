import { defineConfig } from '@playwright/test';

// Production client UI with intercepted APIs; no live platform mutations.
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: ['admin-operations-workspace.spec.ts', 'admin-questions-workspace.spec.ts', 'admin-people-workspace.spec.ts', 'admin-configuration-workspace.spec.ts', 'admin-appearance.spec.ts'],
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:6118', reducedMotion: 'reduce', trace: 'retain-on-failure' },
  outputDir: 'audit-results/admin-workspace-2026-09-20/test-results',
  reporter: [['list'], ['json', { outputFile: 'audit-results/admin-workspace-2026-09-20/results.json' }]],
});
