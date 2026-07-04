import { defineConfig, devices } from '@playwright/test';

// End-to-end tests: drive the REAL app in a real browser. Requires the same
// backing services the app needs to boot — MongoDB + the SAML IdP (docker) — and
// the IdP certificate (npm run saml:fetch-cert). RAG is NOT exercised here (it is
// covered by fast unit tests with mocked components), so Qdrant/Ollama are not
// required. See tests/AGENTS.md.

const PORT = process.env.TLEF_FINANCEBOT_PORT ?? '6118';
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  // Serial + single worker: the suite shares one logged-in session (see
  // global-setup) and writes to a real database.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  timeout: 30_000,
  // Logs in once via real SAML and saves the session for the authenticated specs.
  globalSetup: './tests/e2e/global-setup.ts',
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL,
    // No storageState here: specs are logged-OUT by default. Authenticated specs
    // opt in with `test.use({ storageState: AUTH_FILE })`.
    // Reduced motion: the app honors prefers-reduced-motion, so this disables the
    // view fade-in — keeping assertions (and axe contrast checks) stable rather
    // than racing element opacity transitions.
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Build then serve the compiled app. Reuses a running `npm run dev` locally.
    command: 'npm run build && npm start',
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
