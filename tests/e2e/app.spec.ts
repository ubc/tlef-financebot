import { test, expect } from '@playwright/test';
import { AUTH_FILE } from './global-setup';

// Logged-IN tests. Reuse the session saved by global-setup so every test starts
// authenticated without repeating the login.
test.use({ storageState: AUTH_FILE });

test.describe('app shell (logged in)', () => {
  test('renders the current instructor shell and its primary controls', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('navigation', { name: 'Instructor' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'My Courses' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'My Courses' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Notifications/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Log out' })).toBeVisible();

    const themeBefore = await page.locator('html').getAttribute('data-theme');
    await page.getByRole('button', { name: 'Toggle light or dark theme' }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', themeBefore ?? '');
  });

  test('keeps affiliation role enforcement on the server', async ({ page }) => {
    const faculty = await page.request.get('/api/roles/faculty');
    expect(faculty.status()).toBe(200);

    const student = await page.request.get('/api/roles/student');
    expect(student.status()).toBe(403);
  });
});
