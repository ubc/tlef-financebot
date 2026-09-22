import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function setup(page: Page, staleSample = false, count = 18) {
  const questions = Array.from({ length: count }, (_, i) => ({ id: `q${i}`, courseId: 'course', currentVersionId: `v${i}`, currentVersion: 1, state: 'draft', themeIds: ['topic'], loIds: ['lo'], labels: [], internalNotes: [], versions: [], agentDecision: { decision: i % 3 ? 'pass' : 'flag', reasoning: 'Check the direction and magnitude of each force.', roleAssessment: 'The answer correctly uses vector addition.' }, current: { _id: `v${i}`, questionId: `q${i}`, version: 1, type: 'mcq', difficulty: 'easy', stem: `Question ${i + 1}: Two opposite forces act on the same object. Which statement describes the net force?`, options: [ { key: 'A', text: 'They always cancel.', role: 'clearly-wrong', explanation: 'Opposite direction is insufficient.' }, { key: 'B', text: 'The larger force determines the net direction.', role: 'correct', explanation: 'Add the signed forces.' } ], sourceRefs: [{ materialId: 'material', chunk: 'The resultant force is the vector sum.' }] } }));
  if (staleSample) Object.assign(questions[1], { sample: { stem: 'OUTDATED SAMPLE', options: [], seed: 1, parameterized: true } });
  const calls: Array<{ id: string; body: Record<string, string> }> = [];
  let fail = false;
  let delay = 0;
  let slowId = '';
  await page.route('**/review-fixture', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><title>Review</title><link rel="stylesheet" href="/styles/main.css"><link rel="stylesheet" href="/vendor/katex.min.css"><script src="/vendor/katex.min.js"></script><script src="/vendor/katex-auto-render.min.js"></script><script src="/vendor/marked.min.js"></script><script src="/vendor/purify.min.js"></script></head><body><main></main></body></html>' }));
  await page.route('**/api/**', async r => {
    const path = new URL(r.request().url()).pathname;
    if (path.endsWith('/review-queue')) return r.fulfill({ json: questions.filter(q => q.state === 'draft') });
    if (path === '/api/courses/course') return r.fulfill({ json: { _id: 'course', themes: [{ _id: 'topic', name: 'Forces', los: [{ _id: 'lo', name: 'Combine forces to find net force' }] }] } });
    const match = path.match(/\/questions\/(q\d+)(\/transition)?$/);
    if (match) {
      const question = questions.find(q => q.id === match[1])!;
      if (match[2]) {
        const body = r.request().postDataJSON(); calls.push({ id: question.id, body });
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        if (fail) return r.fulfill({ status: 409, json: { error: 'Question version changed' } });
        question.state = body.to;
        if (body.rejectionReason) (question.internalNotes as unknown[]).push({ text: body.rejectionReason });
        return r.fulfill({ json: question });
      }
      if (r.request().method() === 'PATCH') {
        const body = r.request().postDataJSON(); Object.assign(question.current, body, { _id: question.current._id + '-edit', version: 2 });
        return r.fulfill({ json: question.current });
      }
      if (slowId === question.id) await new Promise(resolve => setTimeout(resolve, 300));
      return r.fulfill({ json: question });
    }
    return r.fulfill({ json: {} });
  });
  await page.goto('/review-fixture');
  await page.evaluate(async () => {
    const { renderReviewQueue } = await import('/js/views/instructor/review-queue.js');
    renderReviewQueue(document.querySelector('main')!, { id: 'course' });
  });
  if (count) await expect(page.locator('.review-workbench__stem')).toContainText('Question 1:');
  else await expect(page.getByRole('heading', { name: 'Nothing waiting for review' })).toBeVisible();
  return { questions, calls, fail: (value: boolean) => { fail = value; }, delay: (value: number) => { delay = value; }, slow: (id: string) => { slowId = id; } };
}

test('compact reader, board navigation, source evidence and search', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Open question board' }).click();
  await expect(page.locator('.review-question-board__square')).toHaveCount(18);
  await page.locator('.review-question-board__square').nth(8).click();
  await expect(page.locator('.review-workbench__stem')).toContainText('Question 9:');
  await expect(page.locator('dialog')).toHaveCount(0);
  await page.getByText('Reference 1', { exact: true }).click();
  await expect(page.getByText('The resultant force is the vector sum.', { exact: true })).toBeVisible();
  await page.getByLabel('Search review questions').fill('Question 17:');
  await expect(page.locator('.review-workbench__row')).toHaveCount(1);
  await expect(page.locator('.review-workbench__stem')).toContainText('Question 17:');
});

test('reject cancellation, retained failed reason, atomic request and next question', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await page.getByLabel('Reason for rejecting (optional)').fill('The answer is ambiguous.');
  await page.getByRole('button', { name: 'Keep reviewing', exact: true }).click();
  expect(state.calls).toHaveLength(0);
  state.fail(true);
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await page.getByLabel('Reason for rejecting (optional)').fill('The answer is ambiguous.');
  await page.getByRole('button', { name: 'Reject question', exact: true }).click();
  await expect(page.locator('.review-workbench__notice')).toContainText('not confirmed');
  await expect(page.locator('.review-workbench__stem')).toContainText('Question 1:');
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(page.getByLabel('Reason for rejecting (optional)')).toHaveValue('The answer is ambiguous.');
  state.fail(false);
  await page.getByRole('button', { name: 'Reject question', exact: true }).click();
  await expect(page.locator('.review-workbench__stem')).toContainText('Question 2:');
  expect(state.calls[1]).toEqual({ id: 'q0', body: { to: 'archived', expectedVersionId: 'v0', rejectionReason: 'The answer is ambiguous.' } });
  expect(state.questions[0].internalNotes).toHaveLength(1);
});

test('approval stays locked during request and pins edited content version', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Question stem', { exact: true }).fill('A clearer question.');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('.review-workbench__stem')).toHaveText('A clearer question.');
  state.delay(350);
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saving decision…', exact: true })).toBeDisabled();
  await expect(page.locator('.review-workbench__stem')).toContainText('Question 2:');
  expect(state.calls).toEqual([{ id: 'q0', body: { to: 'approved', expectedVersionId: 'v0-edit' } }]);
});

test('late detail response cannot replace a newer selection', async ({ page }) => {
  const state = await setup(page); state.slow('q1');
  await page.locator('.review-workbench__row button').nth(1).click();
  await page.locator('.review-workbench__row button').nth(2).click();
  await expect(page.locator('.review-workbench__stem')).toContainText('Question 3:');
  await page.waitForTimeout(400);
  await expect(page.locator('.review-workbench__stem')).toContainText('Question 3:');
});

for (const mode of ['desktop', 'mobile-dark']) test(`${mode} layout, keyboard board and accessibility`, async ({ page }) => {
  await page.setViewportSize(mode === 'desktop' ? { width: 1440, height: 1050 } : { width: 390, height: 844 });
  await setup(page);
  if (mode === 'mobile-dark') await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('.view--review-workbench').analyze()).violations).toEqual([]);
  await page.screenshot({ path: `/tmp/production-review-${mode}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Open question board' }).click();
  expect((await new AxeBuilder({ page }).include('.review-question-board').analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open question board' })).toBeFocused();
});

test('laptop layout keeps decisions docked while only the question content scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page);
  const reader = page.locator('.review-workbench__reader');
  const body = page.locator('.review-workbench__body');
  const actions = page.locator('.review-workbench__actions');
  await body.evaluate(node => { const spacer = document.createElement('div'); spacer.style.height = '1200px'; spacer.style.flex = 'none'; node.append(spacer); });
  const before = await actions.boundingBox();
  const readerBox = await reader.boundingBox();
  expect(before).not.toBeNull();
  expect(readerBox).not.toBeNull();
  expect(Math.abs(before!.y + before!.height - (readerBox!.y + readerBox!.height))).toBeLessThanOrEqual(1);
  expect(await body.evaluate(node => getComputedStyle(node).overflowY)).toBe('auto');
  await body.evaluate(node => { node.scrollTop = 600; });
  await expect.poll(() => body.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  const after = await actions.boundingBox();
  expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(1.5);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
});


test('reject without a reason and protect unsaved edits while changing questions', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Question stem', { exact: true }).fill('Unsaved wording');
  await page.locator('.review-workbench__row button').nth(1).click();
  await expect(page.getByRole('heading', { name: 'Discard unsaved edits?' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Question stem', { exact: true })).toHaveValue('Unsaved wording');
  await page.getByRole('button', { name: 'Cancel editing', exact: true }).click();
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await page.getByRole('button', { name: 'Reject question', exact: true }).click();
  await expect(page.locator('.review-workbench__stem')).toContainText('Question 2:');
  expect(state.calls).toEqual([{ id: 'q0', body: { to: 'archived', expectedVersionId: 'v0', rejectionReason: '' } }]);
});

test('an outdated list sample never replaces the current version in the reader', async ({ page }) => {
  const state = await setup(page, true);
  await page.route('**/api/questions/q1', r => r.fulfill({ json: { ...state.questions[1], current: { ...state.questions[1].current, _id: 'new-version', stem: 'The updated question', paramSlots: [{ name: 'x' }] } } }));
  await page.locator('.review-workbench__row button').nth(1).click();
  await expect(page.locator('.review-workbench__stem')).toHaveText('The updated question');
  await expect(page.locator('.review-workbench__sample-note')).toContainText('Template preview');
});


test('empty queue replaces the whole workspace and exposes useful next steps', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await setup(page, false, 0);
  await expect(page.locator('.review-workbench')).toBeHidden();
  await expect(page.getByLabel('Search review questions')).toBeHidden();
  await expect(page.getByRole('link', { name: 'Open question bank →' })).toHaveAttribute('href', '#/instructor/course/course/bank');
  await expect(page.getByRole('link', { name: 'Generate questions', exact: true })).toHaveAttribute('href', '#/instructor/course/course/preseeding');
  expect((await new AxeBuilder({ page }).include('.view--review-workbench').analyze()).violations).toEqual([]);
  await page.screenshot({ path: '/tmp/review-empty-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('.view--review-workbench').analyze()).violations).toEqual([]);
  await page.screenshot({ path: '/tmp/review-empty-mobile.png', fullPage: true });
});

test('no search results differs from an empty queue and can be cleared', async ({ page }) => {
  await setup(page);
  await page.getByLabel('Search review questions').fill('unfindable text');
  await expect(page.getByRole('heading', { name: 'No questions match', exact: true })).toBeVisible();
  await expect(page.getByText('18 questions still awaiting review.')).toBeVisible();
  await expect(page.locator('.review-workbench')).toBeHidden();
  await page.getByRole('button', { name: 'Clear search & filters' }).click();
  await expect(page.getByLabel('Search review questions')).toHaveValue('');
  await expect(page.locator('.review-workbench__stem')).toContainText('Question 1:');
});

 test('router keeps unsaved edits on cancellation and permits confirmed navigation', async ({ page }) => {
   await setup(page);
   await page.evaluate(async () => {
     const { startRouter } = await import('/js/router.js');
     const { renderReviewQueue } = await import('/js/views/instructor/review-queue.js');
     history.replaceState(null, '', '#/review');
     Object.assign(window, { shellNavigations: 0 });
     window.addEventListener('hashchange', event => { if (router.guardNavigation(event)) return; (window as unknown as { shellNavigations: number }).shellNavigations++; });
     const router = startRouter({ outlet: document.querySelector('main')!, fallback: '/review', routes: [
       { path: '/review', render: outlet => renderReviewQueue(outlet, { id: 'course' }) },
       { path: '/bank', render: outlet => { outlet.textContent = 'Bank destination'; } },
     ] });
     const link = document.createElement('a'); link.href = '#/bank'; link.textContent = 'Sidebar Bank'; document.body.prepend(link);
   });
   await page.getByRole('button', { name: 'Edit', exact: true }).click();
   await page.getByLabel('Question stem', { exact: true }).fill('Unsaved sidebar edit');
   await page.getByRole('link', { name: 'Sidebar Bank' }).click();
   await page.getByRole('button', { name: 'Cancel', exact: true }).click();
   await expect(page).toHaveURL(/#\/review$/);
   expect(await page.evaluate(() => (window as unknown as { shellNavigations: number }).shellNavigations)).toBe(0);
   await expect(page.getByLabel('Question stem', { exact: true })).toHaveValue('Unsaved sidebar edit');
   expect(await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; })).toBe(true);
   await page.getByRole('link', { name: 'Sidebar Bank' }).click();
   await page.getByRole('button', { name: 'Discard edits', exact: true }).click();
   await expect(page.locator('main')).toHaveText('Bank destination');
   expect(await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; })).toBe(false);
 });

 test('editing invalidates the visible AI assessment immediately', async ({ page }) => {
   await setup(page);
   await expect(page.locator('.review-workbench__inspector')).toContainText('AI check · FLAG');
   await page.getByRole('button', { name: 'Edit', exact: true }).click();
   await page.getByLabel('Question stem', { exact: true }).fill('Changed meaning of the question');
   await page.getByRole('button', { name: 'Save changes', exact: true }).click();
   await expect(page.locator('.review-workbench__inspector')).toContainText('AI check unavailable');
   await expect(page.locator('.review-workbench__inspector')).not.toContainText('AI check · FLAG');
 });
