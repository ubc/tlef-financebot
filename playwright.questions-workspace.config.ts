import { defineConfig } from '@playwright/test';
// Mocked-API spec for the instructor Questions workspace; needs only the
// static client served by the dev server (npm run dev, port 6118).
export default defineConfig({ testDir: 'tests/e2e', testMatch: 'questions-workspace.spec.ts', workers: 1, use: { baseURL: 'http://127.0.0.1:6118', trace: 'retain-on-failure' }, reporter: [['list']] });
