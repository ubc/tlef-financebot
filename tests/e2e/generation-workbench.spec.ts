import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function fixture(page: Page, scenario: 'ready' | 'empty' | 'sources' = 'ready') {
  const calls: Array<{ cells: Array<{ count: number; kind: string; type: string }>; submissionId: string; prompt: string; qualityPolicy?: string }> = [];
  const runs: Array<Record<string, unknown>> = [];
  const questions: Array<Record<string, unknown>> = [];
  let fail = false;
  const submissions = new Map<string,string>();
  await page.addInitScript(() => {
    class MockSource extends EventTarget {
      static sources: MockSource[] = [];
      closed = false;
      constructor() { super(); MockSource.sources.push(this); }
      close() { this.closed = true; }
    }
    Object.assign(window, { EventSource: MockSource, emitRun: (run: unknown) => MockSource.sources.filter(s => !s.closed).forEach(s => s.dispatchEvent(new MessageEvent('run', { data: JSON.stringify(run) }))), streamClosed: () => MockSource.sources.every(s => s.closed) });
  });
  await page.route('**/generation-fixture', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><title>Generation</title><link rel="stylesheet" href="/styles/main.css"><link rel="stylesheet" href="/vendor/katex.min.css"><script src="/vendor/katex.min.js"></script><script src="/vendor/katex-auto-render.min.js"></script><script src="/vendor/marked.min.js"></script><script src="/vendor/purify.min.js"></script></head><body><main></main></body></html>' }));
  await page.route('**/api/**', async r => {
    const url = new URL(r.request().url()); const path = url.pathname;
    if (path === '/api/courses/course') return r.fulfill({ json: { course: { _id: 'course' }, themes: scenario === 'empty' ? [] : [{ _id: 'topic', name: 'Forces and vectors', order: 1, los: [ { _id: 'a', name: 'Define force as a vector interaction', order: 1, kind: 'conceptual' }, { _id: 'b', name: 'Combine forces to find net force', order: 2, kind: 'mixed' }, { _id: 'c', name: 'Calculate weight using W = mg', order: 3, kind: 'calculation' } ] }] } });
    if (path.endsWith('/preseeding')) return r.fulfill({ json: [{ loId: 'a', approved: 1, unapproved: 0, target: 5 }, { loId: 'b', approved: 0, unapproved: 5, target: 5 }, { loId: 'c', approved: 0, unapproved: 0, target: 5 }] });
    if (path.endsWith('/materials')) return r.fulfill({ json: scenario === 'sources' ? [] : [{ _id: 'm', name: 'Week 3 lecture notes.pdf', status: 'ready', assignments: [{ themeId: 'topic', loId: 'a' }, { themeId: 'topic', loId: 'b' }] }] });
    if (path.endsWith('/generation-plan')) {
      const body = r.request().postDataJSON(); calls.push(body);
      if (!submissions.has(body.submissionId)) submissions.set(body.submissionId, submissions.size ? `batch${submissions.size}-` : 'r');
      const result = body.cells.map((cell: Record<string, unknown>, i: number) => {
        const runId = `${submissions.get(body.submissionId)}${i}`;
        if (!runs.some(run => run._id === runId)) runs.push({ _id: runId, courseId: 'course', kind: 'question-generation', input: { loId: cell.loId, count: cell.count, type: cell.type, ...(body.qualityPolicy ? { qualityPolicy: body.qualityPolicy } : {}) }, status: 'queued', stage: 'queued', completedUnits: 0, totalUnits: cell.count, revision: 1, createdAt: new Date().toISOString(), result: { createdQuestionIds: [], failures: [] }, events: [{ at: new Date().toISOString(), stage: 'retrieving', status: 'running', completedUnits: 0, message: 'Retrieved relevant source passages.' }] });
        return { ...cell, runId };
      });
      if (fail) return r.abort();
      return r.fulfill({ json: { runs: result } });
    }
    if (path.endsWith('/content-runs')) return r.fulfill({ json: runs.filter(run => !url.searchParams.has('status') || run.status === url.searchParams.get('status')) });
    if (path.includes('/content-runs/')) return r.fulfill({ json: runs.find(run => path.endsWith('/'+run._id)) ?? {} });
    if (path.endsWith('/questions')) return r.fulfill({ json: { total: questions.length, questions } });
    if (path === '/api/questions/q') return r.fulfill({ json: { ...questions[0], currentVersionId: 'v', agentDecision: { decision: 'flag', reasoning: 'The answer needs a clearer assumption about equal magnitudes.' } } });
    return r.fulfill({ json: {} });
  });
  async function open() {
    await page.goto('/generation-fixture');
    await page.evaluate(async () => { const { renderPreseeding } = await import('/js/views/instructor/preseeding.js'); renderPreseeding(document.querySelector('main')!, { id: 'course' }); });
    await expect(page.getByRole('heading', { name: 'Generate questions', exact: true })).toBeVisible();
  }
  await open();
  return { calls, runs, questions, open, fail: (value: boolean) => { fail = value; } };
}

test('focused selection excludes covered and ungrounded objectives; exact batch and prompt', async ({ page }) => {
  const state = await fixture(page);
  await expect(page.getByRole('button', { name: 'Generate 3 questions →' })).toBeEnabled();
  await expect(page.getByRole('checkbox', { name: /Calculate weight/ })).toBeDisabled();
  await page.getByRole('checkbox', { name: /Combine forces/ }).check();
  await page.getByRole('button', { name: 'More questions per objective' }).click();
  await expect(page.getByRole('button', { name: 'Generate 8 questions →' })).toBeEnabled();
  await page.getByLabel('Instructions · optional').fill('Use everyday scenarios.');
  await page.getByRole('button', { name: 'Generate 8 questions →' }).click();
  await expect(page.locator('.gw-live')).toBeVisible();
  expect(state.calls[0].cells.reduce((s,c) => s+c.count,0)).toBe(8);
  expect(state.calls[0].prompt).toBe('Use everyday scenarios.');
  expect(state.calls[0].qualityPolicy).toBeUndefined();
  await page.getByRole('button', { name: 'Create a batch', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Generation in progress', exact: true })).toBeDisabled();
});

test('single-question batch uses singular labels', async ({ page }) => {
  await fixture(page);
  await page.getByRole('button', { name: 'Fewer questions per objective' }).click();
  await page.getByRole('button', { name: 'Fewer questions per objective' }).click();
  await expect(page.getByText('1 objective selected · 1 question each', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate 1 question →', exact: true })).toBeVisible();
  const summary = page.getByRole('complementary', { name: 'Batch summary' });
  await expect(summary).toContainText('1question');
  await expect(summary).toContainText('Across 1 learning objective');
});

test('lost response and reload recover identical immutable request', async ({ page }) => {
  const state = await fixture(page); state.fail(true);
  await page.getByRole('button', { name: 'Generate 3 questions →' }).click();
  await expect(page.getByRole('button', { name: 'Recover this batch' })).toBeVisible();
  const first = state.calls[0];
  state.fail(false); await state.open();
  await page.getByRole('button', { name: 'Recover this batch' }).click();
  await expect(page.locator('.gw-run')).toHaveCount(3);
  expect(state.calls[1]).toEqual(first);
});

test('real run events reveal saved draft and assessment, failed units are not saved questions', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('button', { name: 'Generate 3 questions →' }).click();
  await expect(page.locator('.gw-run')).toHaveCount(3);
  state.questions.push({ id: 'q', state: 'draft', loIds: ['a'], themeIds: ['topic'], labels: [], current: { _id: 'v', type: 'mcq', difficulty: 'easy', stem: 'Which direction is the net force?', provenance: { kind: 'generated', runId: 'r0' }, options: [{ key: 'A', text: 'Toward the larger force.', role: 'correct' }] } });
  Object.assign(state.runs[0], { status: 'partial', stage: 'persisting', revision: 2, completedUnits: 2, totalUnits: 2, result: { createdQuestionIds: ['q'], failures: [{ item: 1 }] } });
  await page.evaluate(run => (window as unknown as { emitRun: (r: unknown) => void }).emitRun(run), state.runs[0]);
  await expect(page.locator('.gw-stem')).toHaveText('Which direction is the net force?');
  await expect(page.locator('.gw-assessment')).toContainText('AI flagged this question');
  await expect(page.locator('.gw-live .gw-total')).toHaveText('1/ 3 saved');
  await expect(page.getByRole('link', { name: 'Review questions →', exact: true })).toHaveAttribute('href', '#/instructor/course/course/queue?runId=r0');
  await page.getByRole('button', { name: 'View steps', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toContainText('Retrieved relevant source passages.');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.screenshot({ path: '/tmp/generation-production-live.png', fullPage: true });
  await page.evaluate(() => document.querySelector('main')!.replaceChildren());
  await expect.poll(() => page.evaluate(() => (window as unknown as { streamClosed: () => boolean }).streamClosed())).toBe(true);
});

test('desktop and mobile dark mode stay readable and pass scoped accessibility', async ({ page }) => {
  await page.setViewportSize({ width: 1450, height: 980 });
  await fixture(page);
  await page.screenshot({ path: '/tmp/generation-production-setup.png', fullPage: true });
  expect((await new AxeBuilder({ page }).include('.generation-workbench').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/generation-production-mobile.png', fullPage: true });
  expect((await new AxeBuilder({ page }).include('.generation-workbench').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
});

test('laptop layout docks generate actions and scrolls the teaching brief independently', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fixture(page);
  const composer = page.locator('.gw-composer');
  const body = composer.locator('.gw-body');
  const footer = composer.locator('.gw-footer');
  await body.evaluate(node => { const spacer = document.createElement('div'); spacer.style.height = '1200px'; spacer.style.flex = 'none'; node.append(spacer); });
  const before = await footer.boundingBox();
  const composerBox = await composer.boundingBox();
  expect(before).not.toBeNull();
  expect(composerBox).not.toBeNull();
  expect(Math.abs(before!.y + before!.height - (composerBox!.y + composerBox!.height))).toBeLessThanOrEqual(1);
  expect(await body.evaluate(node => getComputedStyle(node).overflowY)).toBe('auto');
  await body.evaluate(node => { node.scrollTop = 600; });
  await expect.poll(() => body.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  const after = await footer.boundingBox();
  expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(1.5);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
});

for (const scenario of ['empty','sources'] as const) test(`${scenario} state offers a working next step`, async ({ page }) => {
  await fixture(page,scenario);
  await expect(page.locator('.gw-empty')).toBeVisible();
  await expect(page.locator('.gw-empty a')).toHaveAttribute('href', `#/instructor/course/course/${scenario === 'empty' ? 'structure' : 'materials'}`);
  await expect(page.getByRole('button', { name: /Generate \d/ })).toHaveCount(0);
});

test('new batch clears the previous draft and retains keyboard focus while choosing objectives', async ({ page }) => {
  const state = await fixture(page);
  const objective = page.getByRole('checkbox', { name: /Combine forces/ });
  await objective.focus(); await page.keyboard.press('Space'); await expect(objective).toBeFocused();
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'Generate 3 questions →' }).click();
  await expect(page.locator('.gw-run')).toHaveCount(3);
  state.questions.push({ id: 'q', state: 'draft', loIds: ['a'], themeIds: ['topic'], labels: [], current: { _id: 'v', type: 'mcq', difficulty: 'easy', stem: 'Previous batch question', provenance: { kind: 'generated', runId: 'r0' }, options: [] } });
  for (const run of state.runs) {
    Object.assign(run, { status: 'completed', revision: 2, completedUnits: 1, result: { createdQuestionIds: run._id === 'r0' ? ['q'] : [], failures: [] } });
    await page.evaluate(r => (window as unknown as { emitRun: (r: unknown) => void }).emitRun(r), run);
  }
  await expect(page.locator('.gw-stem')).toContainText('Previous batch question');
  await page.getByRole('button', { name: 'Create another batch' }).click();
  state.runs.splice(0); state.questions.splice(0);
  await page.getByRole('button', { name: 'Generate 3 questions →' }).click();
  await expect(page.locator('.gw-stem')).toHaveCount(0);
});

test('live words arrive before any saved question and survive a reconnect snapshot', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('button', { name: 'Generate 3 questions →' }).click();
  await expect(page.locator('.gw-run')).toHaveCount(3);
  const run = state.runs[0];
  Object.assign(run, { status: 'running', stage: 'generating', revision: 2, preview: { item: 0, attempt: 1, stem: 'Two forces' } });
  await page.evaluate(r => (window as unknown as { emitRun: (r: unknown) => void }).emitRun(r), run);
  await expect(page.getByLabel('Live question text')).toHaveText('Two forces');
  await expect(page.locator('.gw-live .gw-total')).toHaveText('0/ 3 saved');
  Object.assign(run, { revision: 3, preview: { item: 0, attempt: 1, stem: 'Two forces act on the same object.' } });
  await page.evaluate(r => (window as unknown as { emitRun: (r: unknown) => void }).emitRun(r), run);
  await expect(page.getByLabel('Live question text')).toHaveText('Two forces act on the same object.');
  await expect(page.getByRole('link', { name: 'Review questions →', exact: true })).toHaveCount(0);
  await state.open();
  await expect(page.getByLabel('Live question text')).toHaveText('Two forces act on the same object.');
  Object.assign(run, { revision: 4, preview: { item: 0, attempt: 2, stem: 'A revised question' } });
  await page.evaluate(r => (window as unknown as { emitRun: (r: unknown) => void }).emitRun(r), run);
  await expect(page.getByLabel('Live question text')).toHaveText('A revised question');
  await page.screenshot({ path: '/tmp/generation-streaming-words.png', fullPage: true });
});

test('answers and explanations stream, reset on retry, and persist in the saved reader', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('button', { name: 'Generate 3 questions →' }).click();
  await expect(page.locator('.gw-run')).toHaveCount(3);
  const run = state.runs[0];
  const emit = async () => page.evaluate(r => (window as unknown as { emitRun: (r: unknown) => void }).emitRun(r),run);
  Object.assign(run,{status:'running',stage:'generating',revision:2,preview:{item:0,attempt:1,stem:'Which force?',options:[{key:'A',text:'The larger',role:'',explanation:''}]}});
  await emit(); await expect(page.getByLabel('Live option 1', {exact:true})).toHaveText('The larger');
  Object.assign(run,{revision:3,preview:{item:0,attempt:1,stem:'Which force?',difficulty:'easy',options:[{key:'A',text:'The larger force determines direction.',role:'correct',explanation:'Compare their magnitudes.'},{key:'B',text:'They always cancel.',role:'clearly-wrong',explanation:'Equal magnitude is required.'}]}});
  await emit(); await expect(page.getByLabel('Live explanation 1')).toHaveText('Compare their magnitudes.');
  await expect(page.getByText('Proposed correct answer · unverified')).toBeVisible();
  await expect(page.getByLabel('Live option 2', {exact:true})).toHaveText('They always cancel.');
  await state.open(); await expect(page.getByLabel('Live explanation 2')).toHaveText('Equal magnitude is required.');
  await page.screenshot({path:'/tmp/generation-live-answers.png',fullPage:true});
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect((await new AxeBuilder({page}).include('.generation-workbench').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).include('.generation-workbench').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  Object.assign(run,{revision:4,preview:{item:0,attempt:2,stem:'Revised question'}}); await emit();
  await expect(page.getByLabel('Live option 1', {exact:true})).toHaveCount(0);
  state.questions.push({id:'q',state:'draft',loIds:['a'],themeIds:['topic'],labels:[],current:{_id:'v',type:'mcq',difficulty:'easy',stem:'Final checked question',provenance:{kind:'generated',runId:'r0',item:0},options:[{key:'A',text:'Final answer',role:'correct',explanation:'Final explanation retained.'}]}});
  Object.assign(run,{revision:5,status:'completed',stage:'persisting',completedUnits:1,result:{createdQuestionIds:['q'],failures:[]}}); await emit();
  await expect(page.getByText('Final explanation retained.')).toBeVisible();
  await expect(page.getByText('Correct answer',{exact:true})).toBeVisible();
});

 for (const [shortcut, prompt] of [['Concept check', 'Test conceptual understanding'], ['Apply a formula', 'Ask students to apply a formula'], ['Spot a misconception', 'Use plausible distractors']]) {
   test(`shortcut ${shortcut} suggests instructions without overriding practice focus`, async ({ page }) => {
     const state = await fixture(page);
     await page.getByRole('checkbox', { name: /Combine forces/ }).check();
     await page.getByLabel('Practice focus').selectOption('calculation');
     await page.getByRole('button', { name: shortcut, exact: true }).click();
     await expect(page.getByLabel('Practice focus')).toHaveValue('calculation');
     await expect(page.getByLabel('Instructions · optional')).toHaveValue(new RegExp(prompt));
     await page.getByRole('button', { name: 'Generate 6 questions →' }).click();
     await expect.poll(() => state.calls.length).toBe(1);
     expect(state.calls[0].cells.every(cell => cell.kind === 'calculation')).toBe(true);
   });
 }
test('question type selection reaches the generation request', async ({ page }) => {
  const state = await fixture(page);
  await page.getByLabel('Question type').selectOption('true-false');
  await expect(page.getByRole('complementary', { name: 'Batch summary' })).toContainText('True / false');
  await page.getByRole('button', { name: 'Generate 3 questions →' }).click();
  await expect.poll(() => state.calls.length).toBe(1);
  expect(state.calls[0].cells.every(cell => cell.type === 'true-false')).toBe(true);
});
 test('edited generated questions remain in history and retain their run review link', async ({ page }) => {
   const state = await fixture(page);
   await page.getByRole('button', { name: 'Generate 3 questions →' }).click();
   await expect(page.locator('.gw-run')).toHaveCount(3);
   state.questions.push({ id: 'q', state: 'draft', loIds: ['a'], themeIds: ['topic'], labels: [], current: { _id: 'v', version: 2, type: 'mcq', difficulty: 'easy', stem: 'Edited generated question', provenance: { kind: 'edited', parentVersionId: 'old-v' }, options: [{ key: 'A', text: 'Answer', role: 'correct' }] } });
   Object.assign(state.runs[0], { status: 'completed', stage: 'persisting', revision: 2, result: { createdQuestionIds: ['q'], failures: [] } });
   await page.evaluate(run => (window as unknown as { emitRun: (r: unknown) => void }).emitRun(run), state.runs[0]);
   await expect(page.locator('.gw-stem')).toHaveText('Edited generated question');
   await expect(page.getByRole('link', { name: 'Review questions →', exact: true })).toHaveAttribute('href', '#/instructor/course/course/queue?runId=r0');
 });

const usageTotals = { inputTokens: 200, outputTokens: 50, totalTokens: 250, reasoningTokens: null, cachedInputTokens: null, cacheWriteTokens: null, observedCalls: 2, reportedCalls: 1, callsWithKnownTotal: 1, unknownCalls: 0, pendingCalls: 1 };
const usageSummary = { ...usageTotals, status: 'partial', scope: 'llm-calls', coverageGaps: 0, untracked: false, retryVisibility: 'disabled', stages: [], models: [] };

test('generation usage shows partial totals, late receipts without a run revision and refresh rehydration', async ({ page }) => {
  const state = await fixture(page);
  let summary = { ...usageSummary };
  await page.route('**/api/courses/course/content-runs/*/usage', route => route.fulfill({ json: { summary, calls: [] } }));
  await page.clock.install();
  await page.getByRole('button', { name: 'Generate 3 questions →' }).click();
  const first = page.locator('.gw-run').first();
  await expect(first).toContainText('Partial usage · known subtotal');
  await expect(first.locator('.mu-totals')).toContainText('Input tokens200');
  await expect(first.locator('.mu-totals')).toContainText('Output tokens50');
  Object.assign(state.runs[0], { status: 'completed', revision: 2, completedUnits: 1 });
  await page.evaluate(run => (window as unknown as { emitRun: (value: unknown) => void }).emitRun(run), state.runs[0]);
  await expect(first).toContainText('Completed');
  summary = { ...summary, status: 'complete', inputTokens: 300, outputTokens: 80, totalTokens: 380, reportedCalls: 2, callsWithKnownTotal: 2, pendingCalls: 0 };
  await page.clock.fastForward(5100);
  await expect(first).toContainText('Complete recorded usage');
  await expect(first.locator('.mu-totals')).toContainText('Total tokens380');
  await state.open();
  await expect(page.locator('.gw-run').first().locator('.mu-totals')).toContainText('Total tokens380');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: '/tmp/financebot-generation-usage-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/financebot-generation-usage-mobile.png', fullPage: true });
});

test('generation usage preserves zero, unknown components and model-call metadata', async ({ page }) => {
  await fixture(page);
  const summary = { ...usageSummary, status: 'partial', observedCalls: 1, reportedCalls: 1, pendingCalls: 0, inputTokens: 0, outputTokens: null, totalTokens: null, callsWithKnownTotal: 0 };
  const call = { _id: 'call-1', trackingSessionId: 'session', stage: 'generator', provider: 'test', requestedModel: 'requested-model', actualModel: 'resolved-model', responseId: null, requestOptions: {}, startedAt: '2026-10-03T18:00:00Z', finishedAt: '2026-10-03T18:00:01Z', durationMs: 1000, outcome: 'failed', candidateAttempt: 2, jsonAttempt: 1, retryVisibility: 'unknown', usage: { inputTokens: 0, outputTokens: null, totalTokens: null } };
  await page.route('**/api/courses/course/content-runs/*/usage', route => route.fulfill({ json: { summary, calls: [call] } }));
  await page.getByRole('button', { name: 'Generate 3 questions →' }).click();
  const first = page.locator('.gw-run').first();
  await expect(first.locator('.mu-totals')).toContainText('Input tokens0');
  await expect(first.locator('.mu-totals')).toContainText('Output tokensUnknown');
  await expect(first.locator('.mu-totals')).toContainText('Total tokensUnknown');
  await page.getByRole('button', { name: 'View steps', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('generator · resolved-model · failed', { exact: true }).click();
  await expect(dialog).toContainText('Candidate attempt2');
  await expect(dialog).toContainText('Visibility unknown');
  await expect(dialog).not.toContainText('prompt');
  expect((await new AxeBuilder({ page }).include('.gw-timeline').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
});

test('quality pilot defaults off, reaches every plan run and freezes its recovery snapshot', async ({ page }) => {
  const state = await fixture(page);
  const pilot = page.getByRole('checkbox', { name: 'Sources and question memory pilot', exact: true });
  await expect(pilot).not.toBeChecked();
  await expect(page.getByRole('complementary', { name: 'Batch summary' })).toContainText('Baseline');
  await pilot.check();
  await expect(page.getByRole('complementary', { name: 'Batch summary' })).toContainText('Sources and question memory pilot');
  state.fail(true);
  await page.getByRole('button', { name: 'Generate 3 questions →' }).click();
  await expect(page.getByRole('button', { name: 'Recover this batch' })).toBeVisible();
  const first = state.calls[0];
  expect(first.qualityPolicy).toBe('grounded-memory-v1');
  state.fail(false); await state.open();
  await page.getByRole('button', { name: 'Create a batch', exact: true }).click();
  await expect(pilot).toBeChecked();
  await expect(pilot).toBeDisabled();
  await page.getByRole('button', { name: 'Generation activity', exact: true }).click();
  await page.getByRole('button', { name: 'Recover this batch' }).click();
  await expect(page.locator('.gw-run')).toHaveCount(3);
  expect(state.calls[1]).toEqual(first);
  expect(state.runs.every(run => (run.input as { qualityPolicy: string }).qualityPolicy === 'grounded-memory-v1')).toBe(true);
});

test('quality policy reaches the single generation API without changing omitted defaults', async ({ page }) => {
  await fixture(page);
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/api/courses/course/generate', route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: { runId: 'single' } });
  });
  await page.evaluate(async () => {
    const api = await import('/js/api.js');
    await api.generateQuestions('course', { loId: 'a', count: 1, qualityPolicy: 'grounded-memory-v1' });
    await api.generateQuestions('course', { loId: 'a', count: 1 });
  });
  expect(requests).toEqual([{ loId: 'a', count: 1, qualityPolicy: 'grounded-memory-v1' }, { loId: 'a', count: 1 }]);
});

const pilotEvidence = {
  id: 'frozen-evidence', parsingProvenance: 'unrecorded',
  coverage: { sourceChunks: 6, selectedChunks: 2, selectedCharacters: 420, omittedPassages: 1, truncated: true, searchScope: 'retrieved-chunks-and-immediate-neighbors' },
  findings: [{ code: 'source-text-damage', message: 'An extracted formula may be damaged; check the original source.', passageIds: ['E1'] }],
};
const pilotAssessment = {
  policy: 'grounded-memory-v1', item: 0, status: 'withheld', sourceSupport: 'supported', notation: 'consistent', novelty: 'variant',
  reasons: ['The numbers changed, but the question repeats the same reasoning task.', 'Choose a different inference task before generating another independent question.'],
  citations: [], matchedEntryIds: ['bank-version'], evidencePacketId: 'frozen-evidence', memoryDigest: 'memory-snapshot', checkedAt: '2026-10-03T18:00:00Z',
  coverage: { evidenceTruncated: true, memoryTruncated: true, shownEntries: 2, totalEntries: 5, missingVersions: 1, consistency: 'best-effort' },
  candidate: { type: 'mcq', stem: 'Which input belongs in CAPM: $R_f$ or total volatility?', options: [{ key: 'A', text: '$R_f$', role: 'correct', explanation: 'The risk-free return belongs in the formula.' }, { key: 'B', text: 'Total volatility', role: 'common-misconception', explanation: 'Total volatility does not replace beta.' }], contentHash: 'diagnostic-content-hash', truncated: true },
};

test('quality pilot shows withheld reasons, requested shortfall and bounded coverage after refresh', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const state = await fixture(page);
  await page.getByRole('checkbox', { name: 'Sources and question memory pilot', exact: true }).check();
  await page.screenshot({ path: '/tmp/financebot-quality-pilot-setup-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Generate 3 questions →' }).click();
  const run = state.runs[0];
  Object.assign(run, { status: 'failed', stage: 'reviewing', revision: 2, completedUnits: 1,
    result: { createdQuestionIds: [], failures: [{ item: 0, stage: 'reviewing', code: 'quality-withheld', message: pilotAssessment.reasons[0] }], quality: { policy: 'grounded-memory-v1', assessments: [pilotAssessment], evidence: pilotEvidence } } });
  await page.evaluate(value => (window as unknown as { emitRun: (run: unknown) => void }).emitRun(value), run);
  const first = page.locator('.gw-run').first();
  await expect(first).toContainText('1 of 1 requested question not saved.');
  await expect(first).toContainText('1 assessed · 1 withheld');
  await expect(first).toContainText(pilotAssessment.reasons[0]);
  await expect(first).toContainText('Evidence uses 2 of 6 source chunks');
  await expect(first).toContainText('2 of 5 question versions shown; 1 unavailable');
  await expect(first).toContainText('Comparison is best effort.');
  await first.getByText('Check details', { exact: true }).click();
  await expect(first).toContainText('Novelty: variant');
  await first.getByText('Inspect candidate snapshot', { exact: true }).click();
  await expect(first).toContainText('Diagnostic candidate copy');
  await expect(first).toContainText('Candidate snapshot is truncated');
  await expect(first).toContainText('The risk-free return belongs in the formula.');
  await expect(first.locator('.gw-quality-candidate .katex')).toHaveCount(2);
  await expect(page.locator('.gw-live .gw-total')).toHaveText('0/ 3 saved');
  await state.open();
  await expect(page.locator('.gw-run').first()).toContainText(pilotAssessment.reasons[0]);
  await page.screenshot({ path: '/tmp/financebot-quality-pilot-findings-desktop.png', fullPage: true });
  expect((await new AxeBuilder({ page }).include('.generation-workbench').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/financebot-quality-pilot-findings-mobile.png', fullPage: true });
  expect((await new AxeBuilder({ page }).include('.generation-workbench').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'View steps', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toContainText('Sources and question memory pilot');
  await expect(page.getByRole('dialog')).toContainText(pilotAssessment.reasons[0]);
  await expect(page.getByRole('dialog').getByRole('link', { name: 'Download evaluation export' })).toHaveAttribute('href', `/api/courses/course/content-runs/${run._id}/evaluation-export`);
  await page.getByRole('dialog').getByText('Inspect candidate snapshot', { exact: true }).click();
  await page.screenshot({ path: '/tmp/financebot-quality-pilot-candidate-mobile.png', fullPage: true });
});

test('quality pilot source failures provide recovery guidance rather than only internal codes', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('checkbox', { name: 'Sources and question memory pilot', exact: true }).check();
  await page.getByRole('button', { name: 'Generate 3 questions →' }).click();
  const run = state.runs[0];
  const cases = [
    ['generation-evidence-stale-retrieval', 'Reprocess the assigned material'],
    ['generation-evidence-ingest-incomplete', 'Source processing is incomplete'],
    ['generation-evidence-chunks-missing', 'source index is unavailable'],
    ['generation-evidence-material-unavailable', 'Review the sources'],
    ['generation-evidence-source-changed', 'changed during generation'],
    ['generation-evidence-corpus-too-large', 'Assign fewer materials'],
    ['generation-evidence-material-limit', 'Assign fewer materials'],
    ['generation-evidence-no-primary', 'No usable primary source evidence'],
    ['generation-quality-reviewer-required', 'Ask an Admin to enable it'],
  ];
  for (const [index, [code, guidance]] of cases.entries()) {
    Object.assign(run, { status: 'failed', revision: index + 2, error: { code, message: code, retryable: true } });
    await page.evaluate(value => (window as unknown as { emitRun: (run: unknown) => void }).emitRun(value), run);
    await expect(page.locator('.gw-run').first()).toContainText(guidance);
    await expect(page.locator('.gw-run').first()).not.toContainText(code);
  }
});

test('quality pilot exposes persisted evidence before assessments and does not infer a verdict', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('checkbox', { name: 'Sources and question memory pilot', exact: true }).check();
  await page.getByRole('button', { name: 'Generate 3 questions →' }).click();
  const run = state.runs[0];
  Object.assign(run, { status: 'running', stage: 'reviewing', revision: 2, result: { createdQuestionIds: [], failures: [], quality: { policy: 'grounded-memory-v1', assessments: [], evidence: pilotEvidence } } });
  await page.evaluate(value => (window as unknown as { emitRun: (run: unknown) => void }).emitRun(value), run);
  const first = page.locator('.gw-run').first();
  await expect(first).toContainText('Pilot assessments will appear as checks finish.');
  await expect(first).toContainText('An extracted formula may be damaged');
  await expect(first).not.toContainText('assessed ·');
  Object.assign(run, { status: 'failed', revision: 3 });
  await page.evaluate(value => (window as unknown as { emitRun: (run: unknown) => void }).emitRun(value), run);
  await expect(first).toContainText('No recorded pilot assessment is available. No quality conclusion can be inferred.');
});
