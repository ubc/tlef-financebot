import { defineConfig } from '@playwright/test';

// Production shell, intercepted APIs: no SAML or live permission changes.
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: 'role-workspace-switching.spec.ts',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:6118',
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
  },
  outputDir: 'audit-results/role-workspaces/test-results',
  reporter: [['list'], ['json', { outputFile: 'audit-results/role-workspaces/results.json' }]],
});
