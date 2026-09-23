import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function fixture(page: Page, scenario: 'ready' | 'empty' | 'sources' = 'ready') {
  const calls: Array<{ cells: Array<{ count: number; kind: string; type: string }>; submissionId: string; prompt: string }> = [];
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
  await page.route('**/generation-fixture', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><title>Generation</title><link rel="stylesheet" href="/styles/main.css"><script src="/vendor/katex.min.js"></script><script src="/vendor/katex-auto-render.min.js"></script><script src="/vendor/marked.min.js"></script><script src="/vendor/purify.min.js"></script></head><body><main></main></body></html>' }));
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
        if (!runs.some(run => run._id === runId)) runs.push({ _id: runId, courseId: 'course', kind: 'question-generation', input: { loId: cell.loId, count: cell.count, type: cell.type }, status: 'queued', stage: 'queued', completedUnits: 0, totalUnits: cell.count, revision: 1, createdAt: new Date().toISOString(), result: { createdQuestionIds: [], failures: [] }, events: [{ at: new Date().toISOString(), stage: 'retrieving', status: 'running', completedUnits: 0, message: 'Retrieved relevant source passages.' }] });
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
