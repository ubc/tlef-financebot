import { defineConfig } from '@playwright/test';

/** Static compiled Instructor UI; synthetic API judgments, no app/DB/provider. */
export default defineConfig({
  testDir: './tests/e2e', testMatch: ['answerability-exclusion-disclosure.spec.ts'], workers: 1,
  outputDir: './audit-results/answer-exclusion-warrants-2026-10-17/ui-r4/playwright',
  reporter: [['list'], ['json', { outputFile: './audit-results/answer-exclusion-warrants-2026-10-17/ui-r4/report.json' }]],
  use: { baseURL: 'http://127.0.0.1:6183', viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'python3 -m http.server 6183 --bind 127.0.0.1 --directory client/public', url: 'http://127.0.0.1:6183', reuseExistingServer: false },
});
