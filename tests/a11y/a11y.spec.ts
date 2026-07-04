import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { AUTH_FILE } from '../e2e/global-setup';

// Accessibility scans using axe-core. We assert WCAG 2.0/2.1 A + AA rules and
// require zero violations, so a regression (missing label, low contrast, bad
// heading order, …) fails the build. Add pages here as the app grows.

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// Freeze animations so axe measures the steady-state render. Otherwise it can
// catch the view fade-in mid-flight and report transient (not real) low contrast.
async function freezeAnimations(page: Page): Promise<void> {
  await page.addStyleTag({
    content: '*, *::before, *::after { animation-duration: 0s !important; transition: none !important; }',
  });
}

test('landing screen has no WCAG A/AA violations', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /log in with cwl/i }).waitFor();
  await freezeAnimations(page);

  const results = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();

  expect(results.violations).toEqual([]);
});

test.describe('signed in', () => {
  test.use({ storageState: AUTH_FILE });

  test('overview page has no WCAG A/AA violations', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('heading', { name: /welcome/i }).waitFor();
    await freezeAnimations(page);

    const results = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();

    expect(results.violations).toEqual([]);
  });
});
