import { test, expect, type Page } from '@playwright/test';
import { AUTH_FILE } from './global-setup';

// EXAMPLE (Academic API demo) e2e coverage. Requires the FakeAcademicAPI
// container on :3689 (docker compose up in its checkout) in addition to
// MongoDB + the IdP. Seed facts used here (see FakeAcademicAPI/USERS.md):
// `faculty` teaches CPSC 110 101; `student` (student # 12345678) is on its
// roster and enrolled in nothing else; `staff` has no courses.

/** SP-initiated CWL login (test users' password equals their username). */
async function login(page: Page, username: string): Promise<void> {
  await page.goto('/auth/ubcshib');
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', username);
  // The SimpleSAMLphp login button is a bare <button>Login</button> (no type
  // attribute), so match by role/name — mirrors tests/e2e/global-setup.ts.
  await page.getByRole('button', { name: /login|log in|sign in|yes/i }).first().click();
  await page.waitForURL('**/', { timeout: 30_000 });
}

test.describe('classes (faculty)', () => {
  test.use({ storageState: AUTH_FILE }); // global-setup signs in as `faculty`

  test('lists taught classes and opens the class list', async ({ page }) => {
    await page.goto('/#/classes');

    await expect(page.getByRole('heading', { name: /^teaching$/i })).toBeVisible();
    const cpsc110 = page.getByRole('button', { name: /CPSC 110 101/ });
    await expect(cpsc110).toBeVisible();

    await cpsc110.click();
    await expect(page.getByRole('heading', { name: /CPSC 110 101/ })).toBeVisible();
    // The `student` test account is on the CPSC 110 roster. (.first() because
    // the number also appears inside the collapsed raw-JSON <pre> blocks.)
    await expect(page.getByText('12345678').first()).toBeVisible();

    await page.getByRole('button', { name: /back to classes/i }).click();
    await expect(page.getByRole('heading', { name: /^teaching$/i })).toBeVisible();
  });
});

test.describe('classes (student)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('sees enrolments only, with no class-list access', async ({ page }) => {
    await login(page, 'student');
    await page.goto('/#/classes');

    await expect(page.getByRole('heading', { name: /enrolled in/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^teaching$/i })).toHaveCount(0);
    await expect(page.getByText(/CPSC 110/).first()).toBeVisible();
    // Enrolled rows are plain rows, not buttons: no roster drill-down.
    await expect(page.getByRole('button', { name: /CPSC 110/ })).toHaveCount(0);
  });
});

test.describe('classes (staff)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('has no Classes nav item', async ({ page }) => {
    await login(page, 'staff');
    await page.goto('/');

    await expect(page.getByRole('navigation', { name: /primary/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /^classes$/i })).toHaveCount(0);
  });
});
