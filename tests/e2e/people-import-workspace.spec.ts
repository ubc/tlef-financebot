import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { parsePeopleImport } from '../../server/src/services/people-import-parser';
const id = '111111111111111111111111';
const gradebook = 'Student,ID,SIS User ID,SIS Login ID,Final Score\nPoints Possible,,,,100\nAlex Student,123,99999999,PUID-STUDENT,95';
const staff = 'Login ID,Name,Role\nPUID-PROF,Example Professor,Teacher\nPUID-TA,Example TA,TA\nPUID-STUDENT,Example Student,Student';
const file = (body: string) => ({ name: 'people.csv', mimeType: 'text/csv', buffer: Buffer.from(body) });
async function fixture(page: Page, body = gradebook, canManage = true, stale = false) {
  let summary = { revision: 0, members: [] as ReturnType<typeof parsePeopleImport>['members'], canManage, importedAt: null as string | null, fileName: null as string | null };
  const requests: Array<{ method: string; body: string; type: string }> = [];
  await page.route('**/people-import-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><title>Course people import</title><link rel="stylesheet" href="/styles/main.css"></head><body><main style="padding:24px;max-width:850px"><h1>People</h1><h2>Import Gradebook</h2><div id="fixture"></div></main></body></html>' }));
  await page.route('**/api/**', route => {
    const method = route.request().method();
    if (method === 'GET') return route.fulfill({ json: summary });
    if (new URL(route.request().url()).pathname.endsWith('/preview')) return route.fulfill({ json: parsePeopleImport(body) });
    requests.push({ method, body: route.request().postData() ?? '', type: route.request().headers()['content-type'] });
    if (stale) return route.fulfill({ status: 409, json: { error: 'People import changed. Reload and preview the file again.' } });
    summary = { ...summary, revision: summary.revision + 1, members: method === 'DELETE' ? [] : parsePeopleImport(body).members, importedAt: new Date().toISOString(), fileName: 'people.csv' };
    return route.fulfill({ json: summary });
  });
  await page.goto('/people-import-fixture');
  await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
  await page.evaluate(async id => { document.getElementById('fixture')!.append((await import('/js/views/instructor/people-import.js')).peopleImportPanel(id)); }, id);
  await expect(page.getByText('No people imported yet.')).toBeVisible();
  return requests;
}

test('Gradebook preview, cancel/confirm, saved list, removal and JSON adapter', async ({ page }) => {
  const writes = await fixture(page);
  await page.getByLabel('Canvas people CSV').setInputFiles(file(gradebook));
  await expect(page.getByText('1 Students · 0 Instructors · 0 TAs · 0 rejected rows · 1 metadata/empty rows ignored.')).toBeVisible();
  await expect(page.getByText(/Student \(file has no role column\)/)).toBeVisible();
  await page.getByRole('button', { name: 'Import people', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  expect(writes).toHaveLength(0);
  await page.getByRole('button', { name: 'Import people', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import people', exact: true }).click();
  await expect(page.getByText(/Imported 1 Students/)).toBeVisible();
  expect(writes[0].body).toContain('name="expectedRevision"\r\n\r\n0');
  expect(writes[0].body).toContain('name="confirmedTeachingAccess"\r\n\r\nfalse');
  await page.getByText('View people (1)', { exact: true }).click();
  await expect(page.getByText('Alex Student · PUID-STUDENT · Student')).toBeVisible();
  await page.getByRole('button', { name: 'Remove imported access', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove imported access', exact: true }).click();
  await expect(page.getByText('Imported access removed.')).toBeVisible();
  expect(writes[1].type).toContain('application/json'); expect(JSON.parse(writes[1].body)).toEqual({ expectedRevision: 1 });
});

test('staff import requires whole-course confirmation and preserves explicit role counts', async ({ page }) => {
  const writes = await fixture(page, staff);
  await page.getByLabel('Canvas people CSV').setInputFiles(file(staff));
  await expect(page.getByRole('button', { name: 'Import people' })).toBeDisabled();
  await page.getByLabel(/I confirm these Instructors and TAs/).check();
  await page.getByRole('button', { name: 'Import people' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import people' }).click();
  await expect(page.getByText(/Imported 1 Students · 1 Instructors · 1 TAs/)).toBeVisible();
  expect(writes[0].body).toContain('name="confirmedTeachingAccess"\r\n\r\ntrue');
});

test('no-valid-row files block commit; co-instructors see a read-only panel; stale commit stays visible', async ({ page }) => {
  const writes = await fixture(page, 'Login ID,Role\nnot a PUID,Student');
  await page.getByLabel('Canvas people CSV').setInputFiles(file('Login ID,Role\nnot a PUID,Student'));
  await expect(page.getByText('No usable people. Your previous import will be kept.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import people' })).toBeDisabled();
  expect(writes).toHaveLength(0);
  await page.unrouteAll(); await fixture(page, gradebook, false);
  await expect(page.getByText('Only the course owner or an administrator can import or remove people.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Browse files' })).toHaveCount(0);
  await page.unrouteAll(); await fixture(page, gradebook, true, true);
  await page.getByLabel('Canvas people CSV').setInputFiles(file(gradebook));
  await page.getByRole('button', { name: 'Import people' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import people' }).click();
  await expect(page.getByText('People import changed. Reload and preview the file again.')).toBeVisible();
});

test('preview is accessible on desktop and mobile dark', async ({ page }) => {
  await fixture(page, staff);
  await page.getByLabel('Canvas people CSV').setInputFiles(file(staff));
  await expect(page.getByText(/1 Students · 1 Instructors · 1 TAs ·/)).toBeVisible();
  await page.getByText('View people (3)', { exact: true }).click();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'audit-results/people-import/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'audit-results/people-import/mobile-dark.png', fullPage: true });
});
