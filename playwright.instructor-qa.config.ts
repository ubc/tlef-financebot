import { defineConfig } from '@playwright/test';

// Build first; all API fixtures are isolated from live teaching data.
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: [
    'bank-workbench.spec.ts', 'generation-workbench.spec.ts',
    'review-workbench.spec.ts', 'setup-journey.spec.ts',
    'structure-ai.spec.ts', 'instructor-qa-regressions.spec.ts',
  ],
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:6118', trace: 'retain-on-failure' },
  outputDir: 'audit-results/instructor-fixes-2026-09-19/test-results',
  reporter: [['list'], ['json', { outputFile: 'audit-results/instructor-fixes-2026-09-19/ui-results.json' }]],
});
