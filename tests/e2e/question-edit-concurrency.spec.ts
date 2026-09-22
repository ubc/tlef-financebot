import { expect, test, type Page } from '@playwright/test';

const COURSE = '507f1f77bcf86cd799439011', QUESTION = '507f1f77bcf86cd799439012';
const VERSION = '507f1f77bcf86cd799439013', SAVED = '507f1f77bcf86cd799439014';
const LO = '507f1f77bcf86cd799439015', THEME = '507f1f77bcf86cd799439016';

async function fixture(page: Page, surface: 'detail' | 'params') {
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  let conflict = true;
  const current = { _id: VERSION, version: 1, questionId: QUESTION, type: 'mcq', stem: 'Compute {{RATE}}', difficulty: 'easy',
    options: ['correct', 'common-misconception', 'partially-correct', 'clearly-wrong'].map((role, index) => ({ key: 'ABCD'[index], text: `Answer ${index + 1}`, explanation: `Explanation ${index + 1}`, role })),
    sourceRefs: [], paramSlots: [{ name: 'RATE', min: 1, max: 10, step: 1 }], derivedValues: [], createdBy: 'instructor', createdAt: '2026-09-20T00:00:00Z' };
  const detail = { id: QUESTION, courseId: COURSE, currentVersionId: VERSION, currentVersion: 1, current, state: 'draft', loIds: [LO], themeIds: [THEME], labels: [], internalNotes: [], versions: [] };
  await page.route('**/question-concurrency-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><title>Question editor</title><link rel="stylesheet" href="/styles/main.css"><script src="/vendor/katex.min.js"></script><script src="/vendor/katex-auto-render.min.js"></script><script src="/vendor/marked.min.js"></script><script src="/vendor/purify.min.js"></script></head><body><main></main></body></html>' }));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      writes.push({ path, body });
      if (conflict) return route.fulfill({ status: 409, json: { error: 'A colleague saved newer changes. Your draft is retained.' } });
      if (path.endsWith('/transition')) return route.fulfill({ json: { ...detail, state: body.to } });
      if (body.loIds || body.themeIds) return route.fulfill({ json: current });
      Object.assign(current, body, { _id: SAVED, version: 2 });
      return route.fulfill({ json: current });
    }
    if (path === `/api/questions/${QUESTION}`) return route.fulfill({ json: detail });
    if (path === `/api/courses/${COURSE}`) return route.fulfill({ json: { _id: COURSE, name: 'Finance', themes: [{ _id: THEME, name: 'Interest', los: [{ _id: LO, name: 'Compute interest' }] }] } });
    if (path.endsWith('/sample')) return route.fulfill({ json: { stem: 'Compute 5', options: current.options, parameterized: true } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/question-concurrency-fixture');
  await page.evaluate(async ({ courseId, questionId, surface }) => {
    const outlet = document.querySelector('main')!;
    if (surface === 'detail') {
      const { renderQuestionDetail } = await import('/js/views/instructor/question-detail.js');
      renderQuestionDetail(outlet, { id: courseId, questionId });
    } else {
      const { renderParamConfig } = await import('/js/views/instructor/param-config.js');
      renderParamConfig(outlet, { id: courseId, questionId });
    }
  }, { courseId: COURSE, questionId: QUESTION, surface });
  return { writes, allow: () => { conflict = false; } };
}

test('legacy content edits retain drafts on conflict and advance the pin only after a saved response', async ({ page }) => {
  const state = await fixture(page, 'detail');
  const stem = page.getByRole('textbox', { name: 'Question stem', exact: true });
  await stem.fill('My unsaved explanation of [RATE]');
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(page.getByText('A colleague saved newer changes. Your draft is retained.')).toBeVisible();
  await expect(stem).toHaveValue('My unsaved explanation of [RATE]');
  expect(state.writes[0].body).toMatchObject({ expectedVersionId: VERSION, stem: 'My unsaved explanation of {{RATE}}' });
  state.allow();
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(3);
  expect(state.writes[2]).toEqual({ path: `/api/questions/${QUESTION}/transition`, body: { to: 'approved', expectedVersionId: SAVED } });
});

test('LO removals send the exact loaded tag arrays and leave chips intact after conflict', async ({ page }) => {
  const state = await fixture(page, 'detail');
  await page.getByRole('button', { name: 'Remove Topic 1 › LO 1', exact: true }).click();
  await expect(page.getByText('A colleague saved newer changes. Your draft is retained.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove Topic 1 › LO 1', exact: true })).toBeVisible();
  expect(state.writes[0].body).toEqual({ expectedVersionId: VERSION, expectedTags: { loIds: [LO], themeIds: [THEME] }, loIds: [] });
});

test('parameter conflict preserves changed values and a later success updates subsequent version pins', async ({ page }) => {
  const state = await fixture(page, 'params');
  await page.locator('#slot-min-0').fill('3');
  await page.getByRole('button', { name: 'Save Parameterization', exact: true }).click();
  await expect(page.getByText('A colleague saved newer changes. Your draft is retained.')).toBeVisible();
  await expect(page.locator('#slot-min-0')).toHaveValue('3');
  expect(state.writes[0].body).toMatchObject({ expectedVersionId: VERSION, paramSlots: [{ name: 'RATE', min: 3, max: 10, step: 1 }] });
  state.allow();
  await page.getByRole('button', { name: 'Save Parameterization', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save Parameterization', exact: true })).toBeEnabled();
  await page.locator('#slot-min-0').fill('4');
  await page.getByRole('button', { name: 'Save Parameterization', exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(3);
  expect(state.writes[2].body.expectedVersionId).toBe(SAVED);
});
