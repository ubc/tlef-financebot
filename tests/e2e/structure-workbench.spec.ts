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
  await page.getByRole('button', { name: /Combine forces/ }).click();
  await page.getByRole('textbox', { name: 'Learning objective', exact: true }).fill('Resolve forces');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('button', { name: /Resolve forces/ })).toBeVisible();
  await page.getByRole('searchbox').fill('work');
  await expect(page.getByRole('button', { name: /Calculate work/ })).toBeVisible();
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
