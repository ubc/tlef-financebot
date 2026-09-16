import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Verify the shared binding itself, separately from production view coverage below.
test('shared actions retain labels, block duplicate clicks and support icon buttons', async ({ page }) => {
  await realView(page);
  await page.evaluate(async () => {
    const { el } = await import('/js/dom.js');
    const state = window as unknown as { calls: number; finish: () => void };
    state.calls = 0;
    const action = () => new Promise<void>(resolve => { state.calls++; state.finish = resolve; });
    document.getElementById('fixture')!.append(
      el('button', { class: 'btn', onclick: action }, 'Save'),
      el('button', { class: 'btn', disabled: true }, 'Unavailable'),
      el('button', { 'aria-label': 'Refresh', onclick: action }, '↻'),
    );
  });
  const button = page.getByRole('button', { name: 'Save', exact: true });
  await button.click();
  await button.click();
  await visibleBusy(button);
  expect(await page.evaluate(() => (window as unknown as { calls: number }).calls)).toBe(1);
  await expect(page.getByRole('button', { name: 'Unavailable' })).not.toHaveAttribute('aria-busy', 'true');
  await page.evaluate(() => (window as unknown as { finish: () => void }).finish());
  await expect(button).not.toHaveAttribute('aria-busy', 'true');
  const icon = page.getByRole('button', { name: 'Refresh' });
  await icon.click();
  await visibleBusy(icon);
  await expect(icon).toHaveAccessibleName('Refresh');
});

// Mount production views with every API intercepted: no live records or AI calls.
async function realView(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/progress-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><link rel="stylesheet" href="/styles/main.css"><script src="/vendor/katex.min.js"></script><script src="/vendor/katex-auto-render.min.js"></script><script src="/vendor/marked.min.js"></script><script src="/vendor/purify.min.js"></script></head><body><main id="fixture"></main></body></html>' }));
  await page.route('**/api/**', route => route.fulfill({ status: 404, json: { error: 'Unconfigured test API' } }));
  await page.goto('/progress-fixture');
}

function gate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
}

async function visibleBusy(button: import('@playwright/test').Locator): Promise<void> {
  await expect(button).toHaveAttribute('aria-busy', 'true');
  await expect(button).toHaveCSS('cursor', 'default');
  expect(await button.evaluate(node => parseFloat(getComputedStyle(node, '::before').width))).toBeGreaterThan(0);
}

test('real Admin form prevents repeated submits and recovers after failure', async ({ page }) => {
  await realView(page);
  await page.route('**/api/admin/users', route => route.fulfill({ json: [] }));
  const pending = gate();
  let calls = 0;
  await page.route('**/api/admin/platform-instructors/*', async route => {
    calls++;
    await pending.promise;
    await route.fulfill({ status: 503, json: { error: 'Please retry this grant' } });
  });
  await page.evaluate(async () => {
    const { renderAdminAccounts } = await import('/js/views/admin/accounts.js');
    renderAdminAccounts(document.getElementById('fixture')!, {});
  });
  await page.getByLabel('UBC PUID').fill('fixture-user');
  const button = page.getByRole('button', { name: 'Add as Instructor' });
  await button.click();
  await visibleBusy(button);
  await page.locator('.admin-account-create').evaluate(form => (form as HTMLFormElement).requestSubmit(form.querySelector('button')!));
  expect(calls).toBe(1);
  pending.release();
  await expect(page.getByText('Please retry this grant')).toBeVisible();
  await expect(button).toBeEnabled();
  await expect(button).not.toHaveAttribute('aria-busy', 'true');
});

test('real Student practice retains submit progress across redraw and permits retry', async ({ page }) => {
  await realView(page);
  await page.evaluate(async () => {
    const { makeQuestionCard } = await import('/js/views/student/practice-card.js');
    const { PracticeSession } = await import('/js/practice-session.js');
    const pendingWindow = window as unknown as { rejectSubmission: () => void; submissions: number };
    pendingWindow.submissions = 0;
    const card = makeQuestionCard(
      { courseId: 'fixture', theme: { _id: 'theme', name: 'Finance' }, los: [{ lo: { _id: 'lo', name: 'Compare investments' }, status: 'not-started' }], loIndex: 0, isThemeMode: false, mode: 'topic' },
      new PracticeSession(),
      { questionId: 'question', questionVersionId: 'version', type: 'mcq', stem: 'Which investment?', options: [{ key: 'A', text: 'Investment A' }, { key: 'B', text: 'Investment B' }], difficulty: 'easy', watermark: 'fixture', degraded: 'none' },
      { onTranscriptChange() {}, onNext() {}, onAdvanceLo() {}, onSkip() {} }, false,
      { updatesMastery: false, submit: () => { pendingWindow.submissions++; return new Promise((_resolve, reject) => { pendingWindow.rejectSubmission = () => reject(new Error('Submission interrupted')); }); } },
    );
    document.getElementById('fixture')!.append(card);
  });
  const submit = page.getByRole('button', { name: 'Submit', exact: true });
  await expect(submit).toBeDisabled();
  await expect(submit).not.toHaveAttribute('aria-busy', 'true');
  await page.getByRole('button', { name: /Investment A/ }).click();
  await submit.click();
  await visibleBusy(submit);
  await page.evaluate(() => (window as unknown as { rejectSubmission: () => void }).rejectSubmission());
  await expect(page.getByText('Submission interrupted')).toBeVisible();
  await page.getByRole('button', { name: /Try again/i }).click();
  await visibleBusy(submit);
  expect(await page.evaluate(() => (window as unknown as { submissions: number }).submissions)).toBe(2);
});

test('real TA review preserves pending state when filters redraw rows', async ({ page }) => {
  await realView(page);
  await page.route('**/api/courses/fixture/outline', route => route.fulfill({ json: { course: { _id: 'fixture', name: 'Finance' }, themes: [] } }));
  await page.route('**/api/courses/fixture/capabilities/me', route => route.fulfill({ json: { 'question.mark-reviewed': true } }));
  await page.route('**/api/courses/fixture/ta/review-queue', route => route.fulfill({ json: [{ id: 'question', state: 'draft', labels: [], loIds: [], themeIds: [], suggestions: [], current: { stem: 'Compare investments', type: 'mcq' } }] }));
  await page.route('**/api/questions/question', route => route.fulfill({ json: {} }));
  const pending = gate();
  let calls = 0;
  await page.route('**/api/questions/question/mark-reviewed', async route => { calls++; await pending.promise; await route.fulfill({ status: 503, json: { error: 'Review interrupted' } }); });
  await page.evaluate(async () => {
    const { renderTaReviewQueue } = await import('/js/views/ta/review-queue.js');
    renderTaReviewQueue(document.getElementById('fixture')!, { id: 'fixture' });
  });
  const button = page.getByRole('button', { name: /^Mark(?:ing)? reviewed/ });
  await button.click();
  await visibleBusy(button);
  await page.getByLabel('Sort the review queue').selectOption('stem');
  await visibleBusy(button);
  expect(calls).toBe(1);
  pending.release();
  await expect(page.getByText('Review interrupted')).toBeVisible();
  await expect(button).not.toHaveAttribute('aria-busy', 'true');
});

for (const mobile of [false, true]) {
test(`real source guide renders SSE transitions and closes stream (${mobile ? 'mobile dark' : 'desktop light'})`, async ({ page }) => {
  if (mobile) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
  }
  await realView(page);
  await page.evaluate(dark => document.documentElement.dataset.theme = dark ? 'dark' : 'light', mobile);
  const material = { _id: 'material', name: 'Lecture notes.pdf', format: 'pdf', status: 'processing', uploadedAt: '2026-09-14T12:00:00Z' };
  await page.route('**/api/courses/fixture/materials', route => route.fulfill({ json: [material] }));
  await page.route('**/api/courses/fixture/content-runs?*', route => route.fulfill({ json: [] }));
  await page.evaluate(async () => {
    const fixtureWindow = window as unknown as { sourceEvents: EventTarget; streamClosed: boolean };
    class FixtureEvents extends EventTarget {
      constructor() { super(); fixtureWindow.sourceEvents = this; }
      close() { fixtureWindow.streamClosed = true; }
    }
    window.EventSource = FixtureEvents as unknown as typeof EventSource;
    const { openCourseSetupGuide } = await import('/js/views/instructor/course-setup-guide.js');
    openCourseSetupGuide({ courseId: 'fixture', actionId: 'monitor-sources', learningObjectiveCount: 1, onChanged() {} });
  });
  const emit = async (status: string, id: string, revision: number): Promise<void> => {
    await page.evaluate(({ status, id, revision }) => {
      const run = { _id: id, kind: 'material-ingest', status, stage: 'indexing', completedUnits: 3, totalUnits: 8, revision, updatedAt: new Date().toISOString(), input: { materialId: 'material', sourceName: 'Lecture notes.pdf' }, error: status === 'failed' ? { message: 'Source parsing interrupted' } : undefined };
      (window as unknown as { sourceEvents: EventTarget }).sourceEvents.dispatchEvent(new MessageEvent('run', { data: JSON.stringify(run) }));
    }, { status, id, revision });
  };
  await expect(page.getByText('Lecture notes.pdf', { exact: true })).toBeVisible();
  await emit('running', 'run1', 1);
  await expect(page.getByText('Indexing · 3/8')).toBeVisible();
  const waiting = page.getByRole('button', { name: 'Waiting for a ready source…' });
  await expect(waiting).toBeDisabled();
  await expect(waiting).toHaveCSS('cursor', 'default');
  await expect(page.locator('.course-setup-guide__source-progress .spinner')).toBeVisible();
  await waiting.scrollIntoViewIfNeeded();
  if (mobile) await expect(page.locator('.course-setup-guide__source-progress .spinner')).toHaveCSS('animation-name', 'none');
  expect((await new AxeBuilder({ page }).include('.course-setup-guide').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: `/private/tmp/action-progress-source-${mobile ? 'mobile-dark' : 'desktop'}.png` });
  material.status = 'failed';
  await emit('failed', 'run1', 2);
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expect(page.locator('.course-setup-guide__source .spinner')).toHaveCount(0);
  material.status = 'ready';
  await emit('completed', 'run2', 1);
  await expect(page.getByRole('button', { name: 'Continue to questions' })).toBeEnabled();
  await page.getByRole('button', { name: 'Close course setup guide' }).click();
  expect(await page.evaluate(() => (window as unknown as { streamClosed: boolean }).streamClosed)).toBe(true);
});
}

test('real Instructor native preview button shows pending animation and releases on error', async ({ page }) => {
  await realView(page);
  await page.route('**/api/questions/question', route => route.fulfill({ json: { courseId: 'fixture', current: { stem: 'Compute {{rate}}', paramSlots: [{ name: 'rate', min: 1, max: 5, step: 1 }], derivedValues: [] } } }));
  const pending = gate();
  let calls = 0;
  await page.route('**/api/questions/question/params/preview', async route => { calls++; await pending.promise; await route.fulfill({ status: 503, json: { error: 'Preview interrupted' } }); });
  await page.evaluate(async () => {
    const { renderParamConfig } = await import('/js/views/instructor/param-config.js');
    renderParamConfig(document.getElementById('fixture')!, { id: 'fixture', questionId: 'question' });
  });
  const button = page.getByRole('button', { name: /Re-roll preview/ });
  await button.click();
  await visibleBusy(button);
  await button.click();
  expect(calls).toBe(1);
  pending.release();
  await expect(page.getByText('Preview interrupted')).toBeVisible();
  await expect(button).not.toHaveAttribute('aria-busy', 'true');
});

test('real workspace keeps generation pending through immediate and search redraws', async ({ page }) => {
  await realView(page);
  await page.route('**/api/courses/fixture', route => route.fulfill({ json: { _id: 'fixture', name: 'Finance', themes: [] } }));
  await page.route('**/api/courses/fixture/materials', route => route.fulfill({ json: [] }));
  await page.route('**/api/courses/fixture/materials-trash', route => route.fulfill({ json: [] }));
  await page.route('**/api/courses/fixture/content-runs?*', route => route.fulfill({ json: [] }));
  await page.route('**/api/courses/fixture/knowledge-graph', route => route.fulfill({ json: { nodes: [], edges: [] } }));
  const pending = gate();
  let calls = 0;
  await page.route('**/api/courses/fixture/suggest-hierarchy', async route => { calls++; await pending.promise; await route.fulfill({ status: 503, json: { error: 'Analysis interrupted' } }); });
  await page.evaluate(async () => {
    class FixtureEvents extends EventTarget { close() {} }
    window.EventSource = FixtureEvents as unknown as typeof EventSource;
    const { renderMaterials } = await import('/js/views/instructor/materials.js');
    renderMaterials(document.getElementById('fixture')!, { id: 'fixture' });
  });
  const button = page.getByRole('button', { name: /Build(?:ing)? knowledge base/ });
  await button.click();
  await visibleBusy(button);
  await page.getByLabel('Search course sources').fill('lecture');
  await visibleBusy(button);
  await button.evaluate(node => (node as HTMLButtonElement).click());
  expect(calls).toBe(1);
  pending.release();
  await expect(page.getByText('Analysis interrupted')).toBeVisible();
  await expect(button).toBeEnabled();
  await expect(button).not.toHaveAttribute('aria-busy', 'true');
});
