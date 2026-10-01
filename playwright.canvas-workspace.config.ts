import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: 'tests/e2e', testMatch: 'canvas-workspace.spec.ts', workers: 1,
  use: { baseURL: process.env.CANVAS_UI_BASE_URL ?? 'http://127.0.0.1:6118', reducedMotion: 'reduce', trace: 'retain-on-failure' },
  outputDir: 'audit-results/canvas-workspace/test-results', reporter: 'list' });
