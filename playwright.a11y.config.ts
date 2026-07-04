import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config';

// Accessibility scans run as a SEPARATE Playwright check: same app + webServer +
// login (inherited from the base config), but a different test directory and its
// own HTML report so they don't collide with the e2e run.
// Run with: npm run test:a11y. See tests/AGENTS.md.
export default defineConfig({
  ...baseConfig,
  testDir: './tests/a11y',
  reporter: [['html', { open: 'never', outputFolder: 'playwright-report-a11y' }], ['list']],
});
