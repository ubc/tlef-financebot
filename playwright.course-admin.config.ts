import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: 'tests/e2e', testMatch: ['course-admin-workbench.spec.ts'], workers: 1, use: { baseURL: 'http://localhost:6118' } });
