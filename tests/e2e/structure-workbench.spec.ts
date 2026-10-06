import { test, expect } from '@playwright/test';
test('compact structure saves, searches and recovers a partial batch', async ({ page }) => {
  const themes = [{ _id: 't1', name: 'Forces', los: [{ _id: 'l1', name: 'Combine forces', kind: 'mixed' }] }, { _id: 't2', name: 'Energy', los: [{ _id: 'l2', name: 'Calculate work', kind: 'calculation' }] }];
  let failSecond = true;
  await page.route('**/fixture', r => r.fulfill({ contentType: 'text/html', body: '<html lang="en"><head><title>Structure</title><link rel="stylesheet" href="/styles/main.css"></head><body><main></main></body></html>' }));
  await page.route('**/api/**', async r => {
    const path = new URL(r.request().url()).pathname;
    if (r.request().method() === 'PATCH') { Object.assign(themes[0].los[0], r.request().postDataJSON()); return r.fulfill({ json: themes[0].los[0] }); }
    if (r.request().method() === 'POST') {
      const { name } = r.request().postDataJSON();
      if (name === 'Second objective' && failSecond) { failSecond = false; return r.fulfill({ status: 500, json: { error: 'Try again' } }); }
      const lo = { _id: name, name, kind: 'mixed' }; themes[0].los.push(lo); return r.fulfill({ json: lo });
    }
    if (path.endsWith('/preseeding') || path.endsWith('/materials')) return r.fulfill({ json: [] });
    return r.fulfill({ json: { _id: 'course', name: 'Physics', themes } });
  });
  await page.goto('/fixture');
  await page.evaluate(async () => { const { renderStructure } = await import('/js/views/instructor/structure.js'); renderStructure(document.querySelector('main')!, { id: 'course' }); });
  await page.locator('.outline-lo-row').filter({ hasText: 'Combine forces' }).click();
  await page.getByRole('textbox', { name: 'Learning objective', exact: true }).fill('Resolve forces');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('.outline-lo-row').filter({ hasText: 'Resolve forces' })).toBeVisible();
  await page.getByRole('searchbox').fill('work');
  await expect(page.locator('.outline-lo-row').filter({ hasText: 'Calculate work' })).toBeVisible();
  await page.getByRole('searchbox').fill('');
  await page.getByRole('button', { name: '+ Add objectives', exact: true }).click();
  await page.getByRole('textbox', { name: 'New objectives, one per line' }).fill('First objective\nSecond objective');
  await page.getByRole('button', { name: 'Add objectives', exact: true }).click();
  await expect(page.getByText(/Saved objectives are retained/)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'New objectives, one per line' })).toHaveValue('Second objective');
  await page.getByRole('button', { name: 'Add objectives', exact: true }).click();
  await expect(page.locator('.outline-lo')).toHaveCount(3);
  expect(themes[0].los.filter(lo => lo.name === 'First objective')).toHaveLength(1);
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.screenshot({ path: '/tmp/structure-production.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

async function deletionFixture(page: import('@playwright/test').Page) {
  const themes = [
    { _id: 't1', name: 'Risk', order: 1, los: [{ _id: 'l1', name: 'Explain beta', kind: 'conceptual' }, { _id: 'l2', name: 'Unused objective', kind: 'mixed' }] },
    { _id: 't2', name: 'Unused batch topic', order: 2, los: [{ _id: 'l3', name: 'Unused batch objective', kind: 'mixed' }] },
  ];
  const archived: string[] = [];
  let failNext = false;
  let hold: Promise<void> | undefined;
  await page.route('**/fixture', route => route.fulfill({ contentType: 'text/html', body: '<html lang="en"><head><title>Course structure cleanup</title><link rel="stylesheet" href="/styles/main.css"></head><body><main></main></body></html>' }));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/archive')) {
      archived.push(path);
      if (hold) await hold;
      if (failNext) { failNext = false; return route.fulfill({ status: 500, json: { error: 'Unable to remove this item. Try again.' } }); }
      const theme = themes.find(item => path === `/api/themes/${item._id}/archive`);
      if (theme) themes.splice(themes.indexOf(theme), 1);
      else themes.forEach(item => { item.los = item.los.filter(lo => path !== `/api/los/${lo._id}/archive`); });
      return route.fulfill({ json: { archivedAt: new Date().toISOString() } });
    }
    if (path.endsWith('/preseeding') || path.endsWith('/materials') || path.endsWith('/tutorials')) return route.fulfill({ json: [] });
    return route.fulfill({ json: { _id: 'course', name: 'Finance', themes } });
  });
  const render = async () => {
    await page.goto('/fixture');
    await page.evaluate(async () => { const { renderStructure } = await import('/js/views/instructor/structure.js'); renderStructure(document.querySelector('main')!, { id: 'course' }); });
    await expect(page.getByRole('button', { name: 'Topic settings', exact: true })).toBeVisible();
  };
  await render();
  return { archived, themes, render, fail: () => { failNext = true; }, hold: (promise: Promise<void> | undefined) => { hold = promise; } };
}

test('individual LO deletion confirms, cancels safely, persists, and keeps sibling objectives', async ({ page }) => {
  const fixture = await deletionFixture(page);
  await page.getByRole('searchbox').fill('Unused objective');
  await expect(page.getByRole('button', { name: 'Delete topic: Risk', exact: true })).toHaveCount(1);
  await page.getByRole('searchbox').fill('');
  await page.getByRole('button', { name: 'Delete learning objective: Unused objective', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this learning objective?', exact: true });
  await expect(dialog).toContainText('Other learning objectives stay in place');
  await expect(dialog).toContainText('student history are retained');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(fixture.archived).toEqual([]);
  await expect(page.getByRole('button', { name: 'Delete learning objective: Unused objective', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete learning objective: Unused objective', exact: true }).click();
  await dialog.getByRole('button', { name: 'Delete learning objective', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete learning objective: Unused objective', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete learning objective: Explain beta', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Course outline · 2', exact: true })).toBeVisible();
  expect(fixture.archived).toEqual(['/api/los/l2/archive']);
  await fixture.render();
  await expect(page.getByRole('button', { name: 'Delete learning objective: Unused objective', exact: true })).toHaveCount(0);
});

test('failed deletion preserves the editor draft, allows retry, and guards duplicate requests', async ({ page }) => {
  const fixture = await deletionFixture(page);
  await page.getByRole('button', { name: /Unused objective.*materials/ }).click();
  await page.getByRole('textbox', { name: 'Learning objective', exact: true }).fill('Unsaved revision');
  fixture.fail();
  await page.getByRole('button', { name: 'Delete learning objective: Unused objective', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete learning objective', exact: true }).click();
  await expect(page.getByText('Unable to remove this item. Try again.', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Learning objective', exact: true })).toHaveValue('Unsaved revision');
  let release!: () => void;
  fixture.hold(new Promise<void>(resolve => { release = resolve; }));
  const remove = page.getByRole('button', { name: 'Delete learning objective: Unused objective', exact: true });
  await remove.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete learning objective', exact: true }).click();
  await expect(remove).toHaveAttribute('aria-busy', 'true');
  await remove.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  expect(fixture.archived).toHaveLength(2);
  release();
  await expect(remove).toHaveCount(0);
  expect(fixture.archived).toHaveLength(2);
});

test('topic deletion removes its batch-created children and remains accessible on a narrow dark view', async ({ page }) => {
  const fixture = await deletionFixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.getByRole('button', { name: 'All objectives', exact: true }).click();
  await page.getByRole('button', { name: 'Delete topic: Unused batch topic', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this topic?', exact: true });
  await expect(dialog).toContainText('its 1 learning objective');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/financebot-topic-delete-mobile.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Delete topic', exact: true }).click();
  await expect(page.getByRole('button', { name: /Unused batch topic/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete learning objective: Explain beta', exact: true })).toBeVisible();
  expect(fixture.archived).toEqual(['/api/themes/t2/archive']);
  await fixture.render();
  await expect(page.getByRole('button', { name: /Unused batch topic/ })).toHaveCount(0);
});
