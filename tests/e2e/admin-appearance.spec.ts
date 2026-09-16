import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Real local SAML persona; no directory/settings mutations. Tutorial reads are
// suppressed without changing the account's persisted tutorial state.
test('local admin persona has an accessible monochrome shell and keeps personal theme', async ({ page }) => {
  await page.route('**/api/tutorials**', route => route.fulfill({ json: ['admin-users', 'admin-accounts', 'admin-capabilities', 'admin-platform-settings'].map(id => ({ id, role: 'admin', version: 1, status: 'dismissed' })) }));
  await page.goto('/');
  await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
  await page.evaluate(() => localStorage.setItem('tlef-theme', 'light'));
  await page.goto('/auth/ubcshib');
  await page.locator('input[name="username"]').fill('admin');
  await page.locator('input[name="password"]').fill('admin');
  await page.getByRole('button', { name: /login|log in|sign in|yes/i }).first().click();
  await page.waitForURL('http://localhost:6118/**');
  await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
  const identity = await (await page.request.get('/api/auth/me')).json();
  expect(identity.authenticated).toBe(true);
  expect(identity.user.uid).toBe('admin');
  expect(identity.user.puid).toBe('PUID-ADMIN-0001');
  expect(identity.user.isAdmin).toBe(true);
  await expect(page.locator('.brand__name')).toHaveText('Admin');
  await expect(page.locator('html')).toHaveAttribute('data-admin', 'true');
  const toggle = page.getByRole('button', { name: 'Toggle light or dark theme' });
  await expect(toggle).toBeVisible();
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await toggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('body')).toHaveCSS('background-color', theme === 'light' ? 'rgb(245, 245, 246)' : 'rgb(8, 9, 11)');
    await expect(page.locator('.sidebar')).toHaveCSS('background-color', 'rgb(12, 13, 15)');
    expect(await page.evaluate(() => localStorage.getItem('tlef-theme'))).toBe(theme);
    for (const [path, title] of [['users', 'User Directory'], ['accounts', 'User Accounts'], ['capabilities', 'Capability Matrix'], ['platform-settings', 'Platform Settings']]) {
      await page.goto(`/#/admin/${path}`);
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await expect(page.locator('.state--loading')).toHaveCount(0);
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    }
    await page.screenshot({ path: `/private/tmp/admin-console-${theme}.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
    await expect(page.locator('.brand__name')).toBeVisible();
    await expect(page.locator('.sidebar')).toHaveCSS('background-color', 'rgb(12, 13, 15)');
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    await page.locator('.backdrop').click({ position: { x: 360, y: 400 } });
    await page.setViewportSize({ width: 1280, height: 720 });
  }
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await toggle.click();
  await page.goto('/auth/logout');
  await expect(page.getByRole('link', { name: /Log in with CWL/ })).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-admin', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
