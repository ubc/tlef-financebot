import { defineConfig } from '@playwright/test';

// Build/start the local app and shared Mongo/SAML services first. No model calls.
export default defineConfig({
  testDir: 'tests/e2e', testMatch: 'supplemental-enrollment-live.spec.ts', workers: 1, timeout: 120000,
  use: { baseURL: 'http://localhost:6118', viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', trace: 'retain-on-failure' },
  outputDir: 'audit-results/supplemental-enrollment/test-results', reporter: 'list',
});
