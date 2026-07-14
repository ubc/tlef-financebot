import { test, expect } from '@playwright/test';
import { AUTH_FILE } from './global-setup';

// Phase 0 exit test (phase-0-foundations.md, Task 13): log in via the mock CWL
// IdP -> session persists across a reload -> a role-appropriate home renders,
// and the identity endpoint reflects the PUID-keyed session (ST-E01).
//
// global-setup logs in as instructor1 (faculty affiliation), so the home shows
// the instructor heading. This reuses that saved session.
test.use({ storageState: AUTH_FILE });

test.describe('walking skeleton (Phase 0 exit)', () => {
  test('a logged-in user sees a role-appropriate home and survives a reload', async ({ page }) => {
    await page.goto('/');

    // The greeting heading and the role-appropriate section both render.
    await expect(page.getByRole('heading', { name: /welcome/i })).toBeVisible();
    await expect(page.getByText(/instructor dashboard/i)).toBeVisible();

    // Session persistence: a full reload must not bounce to the landing screen.
    await page.reload();
    await expect(page.getByText(/instructor dashboard/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /log in with cwl/i })).toHaveCount(0);
  });

  test('the identity endpoint reflects the PUID-keyed session', async ({ page }) => {
    const res = await page.request.get('/api/auth/me');
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { authenticated: boolean; user?: { puid: string } };
    expect(body.authenticated).toBe(true);
    expect(body.user?.puid).toMatch(/^PUID-/);
  });
});
