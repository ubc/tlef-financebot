import { test, expect } from '@playwright/test';

// Logged-OUT tests. The default context has no saved session (see
// playwright.config.ts `use`), so these see the pre-login landing screen.
// The screen mirrors Figma "Wireframe v0.2" frame `0 - Login` (148:5448):
// a single centered card — wordmark, CWL button, redirect note. Nothing else.
test.describe('landing (logged out)', () => {
  test('shows the FinanceBot wordmark, the CWL login link, and the redirect note', async ({
    page,
  }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1, name: 'FinanceBot' })).toBeVisible();
    await expect(page.getByRole('link', { name: /log in with cwl/i })).toHaveAttribute(
      'href',
      '/auth/ubcshib',
    );
    await expect(page.getByText("You’ll be redirected to UBC’s CWL login.")).toBeVisible();
  });

  test('strips the dev affordances the wireframe does not show', async ({ page }) => {
    await page.goto('/');
    // Health card, local-test-user hint and theme toggle were removed to match
    // the wireframe; the health card still lives on the signed-in overview.
    await expect(page.getByRole('heading', { name: /system status/i })).toHaveCount(0);
    await expect(page.getByText(/faculty:faculty/)).toHaveCount(0);
  });

  test('does not expose the app shell when signed out', async ({ page }) => {
    await page.goto('/');
    // The sidebar (and its gated nav) only exists once authenticated.
    await expect(page.getByRole('navigation', { name: /primary/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /members area/i })).toHaveCount(0);
  });

  test('offers a theme toggle even though the wireframe omits one', async ({ page }) => {
    await page.goto('/');

    const html = page.locator('html');
    const toggle = page.getByRole('button', { name: /toggle light or dark theme/i });
    await expect(toggle).toBeVisible();

    const before = await html.getAttribute('data-theme');
    await toggle.click();
    await expect(html).not.toHaveAttribute('data-theme', before ?? 'light');

    // The choice persists across a reload, which is the whole point of having
    // the control on the signed-out screen.
    const after = await html.getAttribute('data-theme');
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', after ?? 'dark');
  });
});
