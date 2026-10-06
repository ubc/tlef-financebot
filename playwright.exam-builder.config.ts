import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: 'tests/e2e', testMatch: 'exam-builder.spec.ts', workers: 1, use: { baseURL: 'http://127.0.0.1:6118', viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', trace: 'retain-on-failure' }, outputDir: 'audit-results/exam-builder/test-results', reporter: 'list' });
