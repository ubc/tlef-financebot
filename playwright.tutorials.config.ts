import { defineConfig } from '@playwright/test';

// Deterministic browser tests for the compiled client engine; no real service writes.
export default defineConfig({
  testDir: './tests/e2e', testMatch: 'role-tutorials.spec.ts', workers: 1,
  reporter: 'list', use: { baseURL: 'http://localhost:6118', reducedMotion: 'reduce' },
});
