import { chromium, type FullConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Where the authenticated browser state (cookies) is saved. Authenticated specs
// reuse it via `test.use({ storageState: AUTH_FILE })` so they don't each repeat
// the login. Git-ignored.
export const AUTH_FILE = path.join(__dirname, '.auth', 'user.json');

/**
 * Global setup: perform a REAL SAML/CWL login once and save the session.
 *
 * This is the pattern for e2e-testing behind SSO: drive the SP-initiated flow in
 * a browser (`/auth/ubcshib` → the SimpleSAMLphp login form → back to the app),
 * then persist the resulting cookies. Everything after this reuses that session.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:6118';
  const username = process.env.E2E_USERNAME ?? 'faculty';
  const password = process.env.E2E_PASSWORD ?? 'faculty';

  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    // SP-initiated login redirects to the IdP's login form.
    await page.goto(`${baseURL}/auth/ubcshib`);
    await page.fill('input[name="username"]', username);
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"], input[type="submit"]');
    // The IdP posts the signed assertion back to our ACS; we land on the app.
    await page.waitForURL(`${baseURL}/**`, { timeout: 30_000 });

    // Fail loudly if the session was not actually established.
    const me = await page.request.get(`${baseURL}/api/auth/me`);
    const state = (await me.json()) as { authenticated: boolean };
    if (!state.authenticated) {
      throw new Error(
        'global-setup: SAML login did not establish a session. Is the IdP running ' +
          'and the SP entry / certificate configured? See README "Authentication".',
      );
    }

    await page.context().storageState({ path: AUTH_FILE });
  } finally {
    await browser.close();
  }
}
