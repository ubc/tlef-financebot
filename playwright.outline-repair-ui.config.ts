import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

const runDirectory = process.env.FINANCEBOT_OUTLINE_REPAIR_UI_RUN_DIRECTORY
  ?? resolve('audit-results/outline-repair-workspace-2026-10-17/client-tests', new Date().toISOString().replace(/[:.]/g, '-'));
process.env.FINANCEBOT_OUTLINE_REPAIR_UI_RUN_DIRECTORY = runDirectory;

export default defineConfig({
  testDir: './tests/e2e', testMatch: ['outline-repair-workspace.spec.ts'], workers: 1,
  outputDir: resolve(runDirectory, 'test-results'),
  reporter: [['list'], ['json', { outputFile: resolve(runDirectory, 'results.json') }]],
  metadata: { runDirectory, scope: 'Compiled outline workspace with synthetic intercepted API receipts' },
  use: { baseURL: 'http://127.0.0.1:6170', viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', trace: 'retain-on-failure' },
  webServer: { command: 'python3 -m http.server 6170 --bind 127.0.0.1 --directory client/public',
    url: 'http://127.0.0.1:6170', reuseExistingServer: false },
});
