import { test, expect } from '@playwright/test';

// Logged-OUT tests. The default context has no saved session (see
// playwright.config.ts `use`), so these see the pre-login landing screen.
test.describe('landing (logged out)', () => {
  test('shows the brand, live health status, and a login link', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('link', { name: /log in with cwl/i })).toBeVisible();

    // The health card fetches the public /api/health and renders status dots.
    await expect(page.getByRole('heading', { name: /system status/i })).toBeVisible();
    await expect(page.getByText('mongodb', { exact: true })).toBeVisible();
  });

  test('does not expose the app shell when signed out', async ({ page }) => {
    await page.goto('/');
    // The sidebar (and its gated nav) only exists once authenticated.
    await expect(page.getByRole('navigation', { name: /primary/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /members area/i })).toHaveCount(0);
  });
});
