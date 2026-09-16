import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/e2e', testMatch: ['structure-ai.spec.ts', 'structure-workbench.spec.ts'], workers: 1, reporter: 'list', use: { baseURL: 'http://localhost:6118', reducedMotion: 'reduce' } });
