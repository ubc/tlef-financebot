import { test, expect } from '@playwright/test';
import { AUTH_FILE } from './global-setup';

// Logged-IN tests. Reuse the session saved by global-setup so every test starts
// authenticated without repeating the login.
test.use({ storageState: AUTH_FILE });

test.describe('app shell (logged in)', () => {
  test('renders the sidebar with gated nav and greets the user', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('navigation', { name: /primary/i })).toBeVisible();
    // The gated Members area is only in the nav when signed in.
    await expect(page.getByRole('link', { name: /members area/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /welcome/i })).toBeVisible();
  });

  test('can add a note (MongoDB demo)', async ({ page }) => {
    await page.goto('/#/notes');

    const text = `e2e note ${Date.now()}`;
    await page.getByPlaceholder(/write a note/i).fill(text);
    await page.getByRole('button', { name: /add note/i }).click();

    await expect(page.getByText(text)).toBeVisible();
  });

  test('loads gated data in the Members area', async ({ page }) => {
    await page.goto('/#/members');
    await expect(page.getByText(/members-only area/i)).toBeVisible();
    // The nameID readout confirms this came from the gated endpoint.
    await expect(page.getByText(/subject \(nameid\)/i)).toBeVisible();
  });

  // global-setup logs in as `faculty`, so only the Faculty area should appear,
  // and the server must refuse another role's area (403 -> friendly state).
  test('shows only the matching role area and enforces the others', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: /faculty area/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /student area/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /staff area/i })).toHaveCount(0);

    await page.goto('/#/faculty');
    await expect(page.getByText(/tools for instructors/i)).toBeVisible();

    // Deep-linking another role's area is refused by the server (403).
    await page.goto('/#/student');
    await expect(page.getByText(/only available to student users/i)).toBeVisible();
  });
});
