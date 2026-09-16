import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function setup(page: Page, empty = false) {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const tree = { course: { _id: 'course', name: 'Physics', published: true, lifecycle: 'published' }, themes: [{ _id: 'topic', name: 'Forces and Vectors', availableFrom: undefined as string | null | undefined, los: [{ _id: 'lo', name: 'Combine forces', themeId: 'topic' }] }] };
  const questions = empty ? [] : Array.from({ length: 3 }, (_, i) => ({ id: `q${i}`, courseId: 'course', state: i === 2 ? 'draft' : 'approved', contentReady: i === 0, currentVersionId: `v${i}`, currentVersion: 1, labels: [], loIds: ['lo'], themeIds: ['topic'], internalNotes: [], versions: [{ version: 1, createdAt: '2026-09-01', createdBy: 'faculty' }], current: { _id: `v${i}`, version: 1, type: 'mcq', stem: `Question ${i + 1}: Which way does the net force point?`, options: [ { key: 'A', text: 'Toward the larger force.', role: 'correct', explanation: 'Add the signed forces.' }, { key: 'B', text: 'Always east.', role: 'clearly-wrong', explanation: 'Direction depends on magnitude.' }, { key: 'C', text: 'Both ways.', role: 'common-misconception', explanation: 'There is one resultant.' }, { key: 'D', text: 'Neither way.', role: 'partially-correct', explanation: 'Only for equal opposing forces.' } ], difficulty: 'easy', sourceRefs: [] } }));
  let fail = false;
  await page.route('**/bank-fixture', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><title>Bank</title><link rel="stylesheet" href="/styles/main.css"><script src="/vendor/katex.min.js"></script><script src="/vendor/katex-auto-render.min.js"></script><script src="/vendor/marked.min.js"></script><script src="/vendor/purify.min.js"></script></head><body><main></main></body></html>' }));
  await page.route('**/api/**', async r => {
    const path = new URL(r.request().url()).pathname;
    if (r.request().method() === 'PATCH') { const body = r.request().postDataJSON(); calls.push({ path, body });
      if (fail) return r.fulfill({ status: 409, json: { error: 'question-conflict' } });
      if (path === '/api/themes/topic') { tree.themes[0].availableFrom = body.availableFrom; return r.fulfill({ json: tree.themes[0] }); }
      const q = questions.find(x => path.endsWith('/' + x.id))!; Object.assign(q.current, body, { _id: 'new-version', version: 2 }); q.state = 'pending-review'; return r.fulfill({ json: q.current });
    }
    if (path === '/api/courses/course') return r.fulfill({ json: { ...tree.course, themes: tree.themes } });
    if (path === '/api/courses/course/questions') { const state = new URL(r.request().url()).searchParams.get('state'); return r.fulfill({ json: { questions: questions.filter(q => q.state === state), total: questions.filter(q => q.state === state).length } }); }
    if (path.endsWith('/transition')) { const body = r.request().postDataJSON(); calls.push({ path, body }); const q = questions.find(x => path.includes('/' + x.id + '/'))!; q.state = body.to; return r.fulfill({ json: q }); }
    const q = questions.find(x => path === '/api/questions/' + x.id); if (q) return r.fulfill({ json: q });
    return r.fulfill({ json: {} });
  });
  await page.goto('/bank-fixture');
  await page.evaluate(async () => { const { renderBank } = await import('/js/views/instructor/bank.js'); renderBank(document.querySelector('main')!, { id: 'course' }); });
  if (empty) await expect(page.getByRole('heading', { name: 'Your approved questions belong here' })).toBeVisible();
  else await expect(page.locator('.bank-workbench__stem')).toContainText('Question 1');
  return { calls, tree, questions, fail: (value: boolean) => { fail = value; } };
}

test('approved collection, topic release and authoritative content gate', async ({ page }) => {
  const state = await setup(page);
  await expect(page.locator('.bank-workbench__item')).toHaveCount(2);
  await page.getByRole('button', { name: 'Show topics ↓' }).click();
  await page.getByRole('button', { name: /Set release/ }).click();
  await page.getByRole('radio', { name: 'Release now', exact: true }).check();
  expect(await page.locator('.bank-release-dialog').evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  await page.screenshot({ path: '/tmp/bank-release-dialog.png' });
  await page.getByRole('button', { name: 'Save topic release', exact: true }).click();
  await expect(page.locator('dialog')).toHaveCount(0);
  expect(state.calls[0].path).toBe('/api/themes/topic');
  await page.getByRole('button', { name: /Student-visible/ }).first().click();
  await expect(page.locator('.bank-workbench__item')).toHaveCount(1);
  await page.getByRole('button', { name: /Not yet available/ }).first().click();
  await expect(page.locator('.bank-workbench__stem')).toContainText('Question 2');
  await expect(page.locator('.bank-workbench__availability')).toContainText('Content checks needed');
});

test('full editor pins version and sends answers and explanation back to review', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('button', { name: 'Edit question', exact: true }).click();
  await page.getByLabel('Answer text', { exact: true }).first().fill('The resultant follows the larger force.');
  await page.getByLabel('Explanation', { exact: true }).first().fill('Use signed vector addition.');
  await page.getByRole('button', { name: 'Save & send to review', exact: true }).click();
  await expect(page.locator('.bank-workbench__item')).toHaveCount(1);
  const patch = state.calls.find(c => c.path === '/api/questions/q0')!.body;
  expect(patch.expectedVersionId).toBe('v0'); expect(patch.submitForReview).toBe(true);
  expect((patch.options as Array<{ text: string; explanation: string }>)[0]).toMatchObject({ text: 'The resultant follows the larger force.', explanation: 'Use signed vector addition.' });
  await expect(page.getByText('Changes saved. This question is back in Review Queue.')).toBeVisible();
});

test('failed edits retain content and schedule validation prevents writes', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('button', { name: 'Show topics ↓' }).click();
  await page.getByRole('button', { name: /Set release/ }).click();
  await page.getByRole('radio', { name: 'Schedule a release', exact: true }).check();
  await page.getByRole('button', { name: 'Save topic release', exact: true }).click();
  await expect(page.getByText('Choose a future date and time.')).toBeVisible(); expect(state.calls).toHaveLength(0);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  state.fail(true); await page.getByRole('button', { name: 'Edit question', exact: true }).click();
  await page.getByLabel('Question text', { exact: true }).fill('My unsaved edit');
  await page.getByRole('button', { name: 'Save & send to review', exact: true }).click();
  await expect(page.getByText('question-conflict', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Question text', { exact: true })).toHaveValue('My unsaved edit');
});

for (const mode of ['desktop', 'mobile-dark']) test(`${mode}: board, search, layout and accessibility`, async ({ page }) => {
  await page.setViewportSize(mode === 'desktop' ? { width: 1440, height: 1050 } : { width: 390, height: 844 });
  await setup(page); if (mode === 'mobile-dark') await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  await page.getByRole('button', { name: '▦ Question board' }).click();
  await page.getByRole('button', { name: 'Question 2: Awaiting topic release', exact: true }).click();
  await expect(page.locator('.bank-workbench__stem')).toContainText('Question 2');
  await page.getByLabel('Search bank questions').fill('Question 1');
  await expect(page.locator('.bank-workbench__item')).toHaveCount(1);
  await expect(page.locator('.bank-workbench__stem')).toContainText('Question 1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('.view--bank-workbench').analyze()).violations).toEqual([]);
  await page.screenshot({ path: `/tmp/production-bank-${mode}.png`, fullPage: true });
});

test('empty approved bank points back to review', async ({ page }) => { await setup(page, true); await expect(page.getByRole('button', { name: 'Open Review Queue', exact: true })).toBeVisible(); await expect(page.locator('.bank-workbench')).toBeHidden(); });

test('release summary stays compact and empty tabs explain their own state', async ({ page }) => {
  await setup(page);
  await expect(page.getByRole('button', { name: 'Show topics ↓' })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.bank-release-topic')).toHaveCount(0);
  await page.getByRole('button', { name: /^Paused/ }).click();
  await expect(page.getByRole('heading', { name: 'No paused questions' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Review Queue', exact: true })).toHaveCount(0);
  await page.screenshot({ path: '/tmp/bank-paused-empty.png', fullPage: true });
  await page.getByRole('button', { name: 'View approved questions' }).click();
  await expect(page.locator('.bank-workbench')).toBeVisible();
});
