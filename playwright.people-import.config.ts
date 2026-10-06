import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e', testMatch: ['people-import-workspace.spec.ts', 'course-admin-workbench.spec.ts'], workers: 1,
  use: { baseURL: 'http://localhost:6118', reducedMotion: 'reduce' },
  webServer: { command: 'npm start', url: 'http://localhost:6118', reuseExistingServer: true },
});
