import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

// Workers inherit this run-owned path; independently evaluating a timestamp
// would otherwise separate screenshots from the parent reporter's receipt.
const runDirectory = process.env.FINANCEBOT_NUMERIC_UI_RUN_DIRECTORY
  ?? resolve('audit-results/numeric-finite-domain-2026-10-17/ui', new Date().toISOString().replace(/[:.]/g, '-'));
process.env.FINANCEBOT_NUMERIC_UI_RUN_DIRECTORY = runDirectory;

/** Compile the client first. Only static files are served; APIs are intercepted. */
export default defineConfig({
  testDir: './tests/e2e', testMatch: ['numeric-verification-status.spec.ts'], workers: 1,
  outputDir: resolve(runDirectory, 'test-results'),
  reporter: [['list'], ['json', { outputFile: resolve(runDirectory, 'results.json') }]],
  metadata: { runDirectory, scope: 'Compiled parameter-config UI with synthetic intercepted API receipts' },
  use: {
    baseURL: 'http://127.0.0.1:6169', viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce', trace: 'retain-on-failure',
  },
  webServer: {
    command: 'python3 -m http.server 6169 --bind 127.0.0.1 --directory client/public',
    url: 'http://127.0.0.1:6169', reuseExistingServer: false,
  },
});
