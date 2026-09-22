import { test, expect } from '@playwright/test';

for (const theme of ['light', 'dark']) {
  test(`Admin sidebar keeps white active and focused labels during setup (${theme})`, async ({ page }) => {
    await page.route('**/admin-nav-fixture', route => route.fulfill({ contentType: 'text/html', body: `
      <html data-admin="true" data-theme="${theme}"><head><link rel="stylesheet" href="/styles/main.css"></head><body>
      <div class="app-shell app-shell--instructor app-shell--admin"><aside class="sidebar sidebar--instructor"><nav class="nav">
        <a class="nav__link nav__link--active" href="#users"><span class="nav__glyph">U</span><span class="nav__text">User Directory</span></a>
        <a class="nav__link nav__link--active journey-current" href="#materials"><span class="nav__glyph">✓</span><span class="nav__text">Course Materials</span></a>
      </nav></aside></div></body></html>` }));
    await page.goto('/admin-nav-fixture');
    for (const name of ['User Directory', 'Course Materials']) {
      const link = page.getByRole('link', { name, exact: false });
      await expect(link.locator('.nav__text')).toHaveCSS('color', 'rgb(255, 255, 255)');
      await link.click();
      await expect(link.locator('.nav__text')).toHaveCSS('color', 'rgb(255, 255, 255)');
      await page.keyboard.press('Tab');
      await link.focus();
      await expect(link.locator('.nav__text')).toHaveCSS('color', 'rgb(255, 255, 255)');
      await link.hover(); await page.mouse.down();
      await expect(link.locator('.nav__text')).toHaveCSS('color', 'rgb(255, 255, 255)');
      await page.mouse.up();
    }
    await expect(page.locator('.journey-current .nav__glyph')).toHaveCSS('color', 'rgb(24, 51, 40)');
  });
}

test('real guide follows server progress, persists navigation, isolates courses and keeps button contrast', async ({ page }) => {
  const counts = { readyMaterials: 0, processingMaterials: 0, failedMaterials: 0, learningObjectives: 0, totalQuestions: 0, activeGenerationRuns: 0, approvedQuestions: 0, reviewQueue: 0 };
  let released = false;
  let fail = false;
  await page.route('**/journey-fixture', route => route.fulfill({ contentType: 'text/html', body: `<html><head><link rel="stylesheet" href="/styles/main.css"></head><body>
    <div class="app-shell app-shell--instructor"><aside class="sidebar"><nav class="nav">
      <a href="#/instructor/course/test/materials"><span class="nav__glyph">1</span>Materials</a>
      <a href="#/instructor/course/test/structure"><span class="nav__glyph">2</span>Objectives</a>
    </nav></aside><main class="main"><header class="topbar">Course</header><div class="outlet">
      <div class="view" style="min-height:100%;background:var(--surface)">Existing course page</div>
      <button style="position:absolute;bottom:16px;right:16px" onclick="this.textContent='Page action works'">Page action</button>
    </div></main></div></body></html>` }));
  await page.route('**/api/auth/me', route => route.fulfill({ json: { authenticated: true, roles: [], user: { puid: 'journey-user', courseRoles: [{ courseId: 'test', role: 'instructor' }] } } }));
  await page.route('**/api/courses/test/instructor-workflow', route => fail ? route.fulfill({ status: 503, json: { error: 'Offline' } }) : route.fulfill({ json: { counts, setup: { steps: [] } } }));
  await page.route('**/api/courses/test', route => route.fulfill({ json: { themes: [{ _id: 'topic', availableFrom: released ? '2020-01-01' : undefined }] } }));
  await page.route('**/api/courses/test/questions?state=approved', route => route.fulfill({ json: { total: counts.approvedQuestions, questions: counts.approvedQuestions ? [{ contentReady: true, themeIds: ['topic'] }] : [] } }));
  await page.goto('/journey-fixture');
  const originalOutlet = await page.locator('.outlet').boundingBox();
  await page.evaluate(async () => { await (await import('/js/auth.js')).loadSession(); (await import('/js/setup-journey.js')).startSetupJourney('test'); });
  await expect(page.locator('.setup-island--small')).toBeVisible();
  await expect.poll(async () => (await page.locator('.setup-island').boundingBox())?.height ?? 999).toBeLessThan(70);
  await expect.poll(async () => (await page.locator('.outlet').boundingBox())!.height).toBe(originalOutlet!.height);
  const outletBox = (await page.locator('.outlet').boundingBox())!;
  expect(outletBox.y + outletBox.height).toBeGreaterThan((await page.locator('.setup-island').boundingBox())!.y);
  expect(await page.locator('.outlet').evaluate(node => parseFloat(getComputedStyle(node).paddingBottom))).toBeGreaterThan(80);
  await page.getByRole('button', { name: 'Page action', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Page action works' })).toBeVisible();
  expect(await page.locator('#setup-journey').evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await expect(page.locator('.setup-island')).toHaveCSS('box-shadow', 'none');
  const next = page.getByRole('button', { name: 'Next: Objectives →' });
  await expect(next).toBeDisabled();
  await expect(page.locator('.journey-current')).toHaveAttribute('href', '#/instructor/course/test/materials');
  counts.readyMaterials = 1;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(next).toBeEnabled();
  await page.keyboard.press('Tab');
  await next.focus();
  const focused = await next.evaluate(node => ({ color: getComputedStyle(node).color, background: getComputedStyle(node).backgroundColor }));
  expect(focused.color).toBe('rgb(20, 43, 28)');
  expect(focused.background).toBe('rgb(198, 221, 169)');
  await next.hover(); await page.mouse.down();
  expect(await next.evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(198, 221, 169)');
  await page.mouse.up();
  await expect(page).toHaveURL(/structure/);
  await expect(page.locator('.journey-complete .nav__glyph')).toHaveText('✓');
  await expect(page.locator('.setup-island--small')).toBeVisible();
  await page.getByRole('button', { name: 'Expand setup guide' }).click();
  await expect(page.getByRole('button', { name: 'Minimize', exact: true })).toBeFocused();
  await expect.poll(async () => { const box = (await page.locator('.outlet').boundingBox())!; return box.y + box.height; }).toBeGreaterThan((await page.locator('.setup-island').boundingBox())!.y);
  await page.getByRole('button', { name: 'Minimize', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Expand setup guide' })).toBeFocused();
  await page.reload();
  await page.evaluate(async () => { await (await import('/js/auth.js')).loadSession(); (await import('/js/setup-journey.js')).syncSetupJourney(); });
  await expect(page.getByRole('button', { name: 'Expand setup guide' })).toBeVisible();
  await page.evaluate(() => { location.hash = '/ta/course/test/review'; });
  await expect(page.locator('.setup-island')).toHaveCount(0);
  await page.evaluate(() => { location.hash = '/instructor/course/other/materials'; });
  await expect(page.locator('.setup-island')).toHaveCount(0);
  counts.approvedQuestions = 1;
  await page.evaluate(() => { location.hash = '/instructor/course/test/bank'; });
  const preview = page.getByRole('button', { name: 'Next: Student Preview →' });
  await expect(preview).toBeDisabled();
  released = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(preview).toBeEnabled();
  fail = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expect(preview).toBeDisabled();
  fail = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(preview).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await page.locator('.setup-island').boundingBox())!.height).toBeLessThan(70);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.locator('.setup-island').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await preview.click();
  await expect(page).toHaveURL(/preview\/course\/test/);
  await expect(page.locator('.setup-island')).toHaveCount(0);
  await page.evaluate(() => { location.hash = '/instructor/course/test'; });
  await expect(page.getByRole('button', { name: 'Finish guide ✓' })).toBeDisabled();
  await page.getByRole('button', { name: 'Expand setup guide' }).click();
  expect(await page.locator('.setup-island').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.getByRole('button', { name: 'Exit guide' }).click();
  await expect(page.locator('.setup-island')).toHaveCount(0);
  await expect(page.locator('[data-journey-step]')).toHaveCount(0);
});
