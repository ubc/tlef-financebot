import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

const COURSE = '507f1f77bcf86cd799439011', QUESTION = '507f1f77bcf86cd799439012';
const VERSION = '507f1f77bcf86cd799439013', SAVED = '507f1f77bcf86cd799439014';
const LO = '507f1f77bcf86cd799439015', THEME = '507f1f77bcf86cd799439016', MATERIAL = '507f1f77bcf86cd799439017';
const CANDIDATE = '507f1f77bcf86cd799439018';
const ARTIFACTS = 'artifacts/quality-authoring-2026-10-13';
const options = [{ key: 'A', text: 'Systematic market risk remains.', role: 'correct', explanation: 'Diversification does not remove market risk.' },
  { key: 'B', text: 'All risk disappears.', role: 'common-misconception', explanation: 'Firm-specific risk can be diversified, while market risk remains.' },
  { key: 'C', text: 'Beta must become zero.', role: 'partially-correct', explanation: 'Portfolio beta can remain positive.' },
  { key: 'D', text: 'Only total volatility earns compensation.', role: 'clearly-wrong', explanation: 'The source distinguishes total volatility and systematic risk.' }];
const variant = { type: 'mcq', stem: 'What risk remains in a broadly diversified portfolio?', difficulty: 'easy', options, paramSlots: [], derivedValues: [] };
const tree = { _id: COURSE, name: 'Finance · Quality authoring', themes: [{ _id: THEME, name: 'Risk and return', order: 0,
  los: [{ _id: LO, themeId: THEME, name: 'Distinguish market risk from diversifiable risk', order: 0 }] }] };
const status = (available = true) => ({ coordinatedSaveAvailable: available, pilot: true, teacherCalibrated: false, concurrencyScope: 'process' });

async function documentFixture(page: Page) {
  await page.addInitScript(() => { Object.assign(window, { EventSource: class { addEventListener() {} close() {} } }); });
  await page.route('**/authoring-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><title>FinanceBot quality authoring</title><link rel="stylesheet" href="/styles/main.css"><script src="/vendor/katex.min.js"></script><script src="/vendor/katex-auto-render.min.js"></script><script src="/vendor/marked.min.js"></script><script src="/vendor/purify.min.js"></script></head><body><main></main></body></html>' }));
}

async function generationFixture(page: Page) {
  const submissions: Array<Record<string, unknown>> = [];
  const apiPaths: string[] = [];
  let fail = true;
  let run: Record<string, unknown> | undefined;
  await documentFixture(page);
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    apiPaths.push(path);
    if (path.endsWith('/authoring-quality-status')) return route.fulfill({ json: status(false) });
    if (path.endsWith('/generation-plan')) {
      const body = route.request().postDataJSON(); submissions.push(body);
      if (fail) { fail = false; return route.abort('failed'); }
      run = { _id: 'run1', courseId: COURSE, kind: 'question-generation', revision: 3, status: 'completed', stage: 'persisting', completedUnits: 0, totalUnits: 3, createdAt: '2026-10-13T17:00:00Z', warnings: [], events: [],
        input: { loId: LO, count: 3, type: 'mcq', qualityPolicy: 'grounded-memory-v2' }, result: { createdQuestionIds: [], failures: [], quality: { policy: 'grounded-memory-v2', independentRequested: 3, independentPlanned: 1,
          assessments: [{ policy: 'grounded-memory-v2', item: 0, status: 'withheld', sourceSupport: 'supported', notation: 'matches-source', novelty: 'same-task', reasons: ['Diagnostic mode: concurrent saving is unavailable.'], candidate: { ...variant, truncated: false } }], slotBudgets: [] } } };
      return route.fulfill({ json: { runs: [{ loId: LO, runId: 'run1' }] } });
    }
    if (path.endsWith('/content-runs/run1')) return route.fulfill({ json: run });
    if (path.endsWith('/content-runs')) return route.fulfill({ json: run ? [run] : [] });
    if (path.endsWith('/materials')) return route.fulfill({ json: [{ _id: MATERIAL, courseId: COURSE, name: 'Chapter 3 · Risk and return.pdf', status: 'ready', assignments: [{ loId: LO, themeId: THEME }] }] });
    if (path.endsWith('/preseeding')) return route.fulfill({ json: [{ loId: LO, approved: 0, unapproved: 0, target: 5 }] });
    if (path === `/api/courses/${COURSE}`) return route.fulfill({ json: tree });
    if (path.endsWith('/questions')) return route.fulfill({ json: { total: 0, questions: [] } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/authoring-fixture');
  const mount = () => page.evaluate(async course => { await (await import('/js/views/instructor/generation-workbench.js')).renderGenerationWorkbench(document.querySelector('main')!, course); }, COURSE);
  return { mount, submissions, apiPaths };
}

async function regenerationFixture(page: Page, settings: { diagnostic?: boolean; loseResponse?: boolean; withheld?: boolean; preparing?: boolean } = {}) {
  const requests: Array<Record<string, unknown>> = [], adoptions: Array<Record<string, unknown>> = [], edits: Array<Record<string, unknown>> = [];
  let lose = !!settings.loseResponse, adoptionConflict = false;
  let adoptionFailure: { status: number; error: string } | 'network' | undefined;
  let generationFailure: { status: number; error: string } | undefined;
  let current = { _id: VERSION, questionId: QUESTION, version: 1, type: 'mcq', stem: 'Which risk remains after diversification?', difficulty: 'easy', options, sourceRefs: [], paramSlots: [], derivedValues: [], createdBy: 'instructor', createdAt: '2026-10-13T17:00:00Z' };
  let candidate = { candidateId: CANDIDATE, originalVersionId: VERSION, intent: 'edit-existing', status: settings.withheld ? 'withheld' : 'eligible', reasons: settings.withheld ? ['The requested notation change was not completed.'] : [], variant: settings.withheld ? undefined : variant,
    quality: { policy: 'grounded-memory-v2', item: 0, status: settings.withheld ? 'withheld' : 'eligible', sourceSupport: 'supported', notation: 'matches-source', novelty: 'same-task', reasons: [] }, budget: { observedSends: 4, reportedInputTokens: 1800, reportedOutputTokens: 900 } };
  await documentFixture(page);
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/authoring-quality-status')) return route.fulfill({ json: status(!settings.diagnostic) });
    if (path.endsWith('/regenerate')) {
      const body = route.request().postDataJSON(); requests.push(body); candidate = { ...candidate, intent: body.intent, originalVersionId: body.expectedVersionId };
      if (generationFailure) return route.fulfill({ status: generationFailure.status, json: { error: generationFailure.error } });
      if (lose) { lose = false; return route.abort('failed'); }
      if (settings.preparing && requests.length === 1) return route.fulfill({ json: { ...candidate, status: 'preparing', variant: undefined } });
      return route.fulfill({ json: candidate });
    }
    if (path.endsWith(`/regeneration-candidates/${CANDIDATE}/adopt`)) {
      const body = route.request().postDataJSON(); adoptions.push(body);
      if (adoptionFailure === 'network') return route.abort('failed');
      if (adoptionFailure) return route.fulfill({ status: adoptionFailure.status, json: { error: adoptionFailure.error } });
      if (adoptionConflict || body.expectedVersionId !== candidate.originalVersionId) return route.fulfill({ status: 409, json: { error: 'Original question or sources changed. Generate a new checked candidate.' } });
      current = { ...current, ...variant, _id: SAVED, version: 2 };
      return route.fulfill({ json: { version: current } });
    }
    if (path.endsWith(`/regeneration-candidates/${CANDIDATE}`)) return route.fulfill({ json: settings.preparing && requests.length === 1 ? { ...candidate, status: 'preparing', variant: undefined } : candidate });
    if (path === `/api/questions/${QUESTION}` && route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON(); edits.push(body);
      current = { ...current, ...body, _id: SAVED, version: 2 };
      return route.fulfill({ json: current });
    }
    if (path === `/api/questions/${QUESTION}`) return route.fulfill({ json: { id: QUESTION, courseId: COURSE, currentVersionId: current._id, currentVersion: current.version, current, state: 'draft', loIds: [LO], themeIds: [THEME], labels: [], internalNotes: [], versions: [] } });
    if (path === `/api/courses/${COURSE}`) return route.fulfill({ json: tree });
    if (path.endsWith('/sample')) return route.fulfill({ json: { stem: current.stem, options: current.options, parameterized: false } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/authoring-fixture');
  const mount = () => page.evaluate(async ({ course, question }) => { (await import('/js/views/instructor/question-detail.js')).renderQuestionDetail(document.querySelector('main')!, { id: course, questionId: question }); }, { course: COURSE, question: QUESTION });
  const open = async () => { await mount(); await page.getByRole('button', { name: '↻ Regenerate' }).click(); };
  const enable = async () => {
    await page.getByRole('checkbox', { name: 'Sources and question memory v2 pilot' }).check();
    const prompt = page.getByRole('textbox', { name: 'Regeneration prompt' });
    await expect(prompt).toHaveValue('');
    await prompt.fill('Match the original source notation while preserving the tested learning task.');
  };
  return {
    mount, open, enable, requests, adoptions, edits,
    failAdoption: (failure: typeof adoptionFailure) => { adoptionFailure = failure; },
    failGeneration: (failure: typeof generationFailure) => { generationFailure = failure; },
    conflict: () => { adoptionConflict = true; },
    changed: () => { current = { ...current, _id: SAVED, version: 2, stem: 'A colleague saved a different risk question.' }; },
  };
}

function regenerationRecoveryState(page: Page) {
  return page.evaluate(({ course, question }) => Object.fromEntries(Object.keys(sessionStorage)
    .filter(key => key.startsWith('financebot:regeneration:') && (key.endsWith(`:${course}:${question}`) || key.endsWith(`:${course}:${question}:pending`)))
    .map(key => [key, sessionStorage.getItem(key)])), { course: COURSE, question: QUESTION });
}

test('v2 policy and UUID persist across a lost generation response, with diagnostic output distinguished from saved questions', async ({ page }) => {
  const fixture = await generationFixture(page); await fixture.mount();
  await page.getByRole('checkbox', { name: 'Sources and question memory pilot' }).check();
  await page.getByRole('combobox', { name: 'Quality pilot version' }).selectOption('grounded-memory-v2');
  await expect(page.getByText(/Diagnostic mode: this server/)).toBeVisible();
  await page.getByRole('button', { name: /Analyze 3 diagnostic candidates/ }).click();
  await expect(page.getByRole('button', { name: 'Recover this batch' })).toBeVisible();
  expect(fixture.submissions[0]).toMatchObject({ qualityPolicy: 'grounded-memory-v2', submissionId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  await page.reload(); await fixture.mount();
  await page.getByRole('button', { name: 'Recover this batch' }).click();
  await expect.poll(() => fixture.submissions.length).toBe(2);
  expect(fixture.submissions[1]).toEqual(fixture.submissions[0]);
  await expect.poll(() => fixture.apiPaths).toContain(`/api/courses/${COURSE}/content-runs/run1`);
  await expect(page.getByText('3 of 3 requested questions not saved.')).toBeVisible();
  await expect(page.getByText('Question 1 · Withheld')).toBeVisible();
  await page.getByText('Inspect candidate snapshot').click();
  await expect(page.getByText('Diagnostic candidate copy. This view is not a saved or approved question.')).toBeVisible();
  await mkdir(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: `${ARTIFACTS}/generation-v2-diagnostic.png`, fullPage: true });
});

test('preparing historical question memory is an explicit optional v2 step with a five-question limit and receipt', async ({ page }) => {
  const fixture = await generationFixture(page);
  const memoryRequests: unknown[] = [];
  await page.route(`**/api/courses/${COURSE}/question-memory/prepare`, route => {
    memoryRequests.push(route.request().postDataJSON());
    return route.fulfill({ json: { prepared: 3, skipped: 1, failed: 1, embeddingCostsIncluded: false } });
  });
  await fixture.mount();
  await expect(page.getByText('Prepare older question memory · optional')).toBeHidden();
  await page.getByRole('checkbox', { name: 'Sources and question memory pilot' }).check();
  await expect(page.getByText('Prepare older question memory · optional')).toBeHidden();
  await page.getByRole('combobox', { name: 'Quality pilot version' }).selectOption('grounded-memory-v2');
  await page.getByText('Prepare older question memory · optional').click();
  await expect(page.getByText(/Uses additional model calls.*At most five questions per click/)).toBeVisible();
  expect(memoryRequests).toEqual([]); expect(fixture.submissions).toEqual([]);
  await page.getByRole('button', { name: 'Prepare memory for up to 5 questions' }).click();
  await expect(page.getByText(/3 historical question descriptors prepared · 1 skipped · 1 failed/)).toBeVisible();
  expect(memoryRequests).toEqual([{ limit: 5 }]);
  expect(fixture.submissions).toEqual([]);
  await expect(page.getByText(/Existing question content and approval are unchanged.*Embedding costs are excluded/)).toBeVisible();
});

for (const mobile of [false, true]) test(`v2 diagnostic generation is accessible at ${mobile ? 'mobile dark' : 'desktop light'} width`, async ({ page }) => {
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
  const fixture = await generationFixture(page); await fixture.mount();
  await page.evaluate(dark => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }, mobile);
  await page.getByRole('checkbox', { name: 'Sources and question memory pilot' }).check();
  await page.getByRole('combobox', { name: 'Quality pilot version' }).selectOption('grounded-memory-v2');
  await page.getByRole('button', { name: /Analyze 3 diagnostic candidates/ }).click();
  await page.getByRole('button', { name: 'Recover this batch' }).click();
  await expect(page.getByText('3 of 3 requested questions not saved.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const scan = await new AxeBuilder({ page }).include('.generation-workbench').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(scan.violations).toEqual([]);
  await mkdir(ARTIFACTS, { recursive: true });
  await page.locator('.gw-inspector-body').evaluate(node => { node.scrollTop = 0; });
  await page.screenshot({ path: `${ARTIFACTS}/generation-v2-${mobile ? 'mobile-dark' : 'desktop-light'}.png`, fullPage: true });
});

for (const intent of ['edit-existing', 'create-variant', 'create-independent-task']) test(`regeneration sends explicit ${intent} and change/preservation requirements before explicit adoption`, async ({ page }) => {
  const fixture = await regenerationFixture(page); await fixture.open(); await fixture.enable();
  await page.getByRole('combobox', { name: 'Regeneration intent' }).selectOption(intent);
  await page.getByRole('textbox', { name: 'Regeneration prompt' }).fill('Use the original lecture notation and the current bank context.');
  await page.getByRole('textbox', { name: 'Required changes' }).fill('Use beta consistently\nExplain the remaining market risk');
  await page.getByRole('textbox', { name: 'Preserve requirements' }).fill('Preserve the correct answer\nPreserve parameter distributions');
  await page.getByRole('button', { name: 'Generate alternative', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Replace with variant' })).toBeVisible();
  expect(fixture.requests[0]).toMatchObject({ qualityPolicy: 'grounded-memory-v2', intent, expectedVersionId: VERSION, requiredChanges: ['Use beta consistently', 'Explain the remaining market risk'], preserve: ['Preserve the correct answer', 'Preserve parameter distributions'], requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  expect(fixture.adoptions).toEqual([]); expect(fixture.edits).toEqual([]);
  await page.getByRole('button', { name: 'Replace with variant' }).click();
  await expect(page.getByRole('textbox', { name: 'Question stem', exact: true })).toHaveValue(variant.stem);
  expect(fixture.adoptions).toEqual([{ expectedVersionId: VERSION }]);
  expect(fixture.edits).toEqual([]);
});

test('a lost regeneration response survives reload with the same UUID and editing requirements', async ({ page }) => {
  const fixture = await regenerationFixture(page, { loseResponse: true }); await fixture.open(); await fixture.enable();
  await page.getByRole('combobox', { name: 'Regeneration intent' }).selectOption('edit-existing');
  await page.getByRole('textbox', { name: 'Regeneration prompt' }).fill('Change notation only.');
  await page.getByRole('textbox', { name: 'Required changes' }).fill('Match lecture beta notation');
  await page.getByRole('textbox', { name: 'Preserve requirements' }).fill('Keep the correct answer');
  await page.getByRole('button', { name: 'Generate alternative', exact: true }).click();
  await expect.poll(() => fixture.requests.length).toBe(1);
  await expect(page.getByRole('button', { name: 'Generate alternative', exact: true })).toBeEnabled();
  await page.reload(); await fixture.open();
  await expect(page.getByRole('textbox', { name: 'Regeneration prompt' })).toHaveValue('Change notation only.');
  await expect(page.getByRole('textbox', { name: 'Required changes' })).toHaveValue('Match lecture beta notation');
  await page.getByRole('button', { name: 'Generate alternative', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Replace with variant' })).toBeVisible();
  expect(fixture.requests[1]).toEqual(fixture.requests[0]);
});

test('retained candidates reload without another generation call and stale original versions cannot be adopted', async ({ page }) => {
  const fixture = await regenerationFixture(page); await fixture.open(); await fixture.enable();
  await page.getByRole('button', { name: 'Generate alternative', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Replace with variant' })).toBeVisible();
  await page.reload(); await fixture.open();
  await expect(page.getByText(/Restored candidate/)).toBeVisible();
  expect(fixture.requests).toHaveLength(1);
  fixture.changed(); await page.reload(); await fixture.open();
  await expect(page.getByText(/changed.*candidate|candidate.*changed|original.*changed/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Replace with variant' })).toBeHidden();
  expect(fixture.adoptions).toEqual([]);
});

test('adoption conflicts preserve the generated candidate and the original editor contents', async ({ page }) => {
  const fixture = await regenerationFixture(page); await fixture.open(); await fixture.enable();
  await page.getByRole('button', { name: 'Generate alternative', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Replace with variant' })).toBeVisible();
  fixture.conflict(); await page.getByRole('button', { name: 'Replace with variant' }).click();
  await expect(page.getByText('Original question or sources changed. Generate a new checked candidate.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Question stem', exact: true })).toHaveValue('Which risk remains after diversification?');
  await expect(page.getByRole('heading', { name: 'Generated variant' })).toBeVisible();
  expect(fixture.edits).toEqual([]);
});

// These intercepted production-UI checks prove recovery behavior, not model quality or backend guard execution.
for (const rejection of [
  { code: 'generation-evidence-source-changed', status: 409, guidance: 'The course sources changed after this candidate was checked. Review the current files, then generate a new alternative before replacing.' },
  { code: 'generation-evidence-provenance-changed', status: 409, guidance: 'The PDF source and page evidence changed or could not be verified after this candidate was checked. Review the current files, then generate a new alternative before replacing.' },
  { code: 'generation-evidence-schema-invalid', status: 422, guidance: 'This candidate uses a source evidence format that this server cannot validate. Preserve any unsaved edits, reload the app, then generate a new alternative before replacing.' },
  { code: 'authoring-memory-changed', status: 409, guidance: 'The Question Bank or Review Queue changed after this candidate was checked. Generate a new alternative against the current question memory before replacing.' },
  { code: 'regeneration-original-comparison-required', status: 422, guidance: 'This candidate is missing a valid comparison with the original question. Generate a new alternative; this candidate cannot replace the question.' },
  { code: 'regeneration-candidate-not-eligible', status: 422, guidance: 'This candidate is no longer eligible for replacement. Review its source and memory checks, then generate a new alternative.' },
]) test(`mocked UI retains evidence but blocks replacement after ${rejection.code}`, async ({ page }, testInfo) => {
  const fixture = await regenerationFixture(page); await fixture.open(); await fixture.enable();
  const prompt = page.getByRole('textbox', { name: 'Regeneration prompt' });
  const requiredChanges = page.getByRole('textbox', { name: 'Required changes' });
  await requiredChanges.fill('Keep lecture notation.');
  await page.getByRole('button', { name: 'Generate alternative', exact: true }).click();
  const replace = page.getByRole('button', { name: 'Replace with variant' });
  await expect(replace).toBeEnabled();
  expect(Object.values(await regenerationRecoveryState(page))).toContain(CANDIDATE);
  await page.evaluate(() => sessionStorage.setItem('financebot:regeneration:unrelated-course:unrelated-question', 'keep'));

  fixture.failAdoption({ status: rejection.status, error: rejection.code });
  await replace.click();
  await expect(page.getByText(rejection.guidance, { exact: true })).toBeVisible();
  await expect(replace).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Generated variant' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Current question', exact: true })).toBeVisible();
  await page.getByText('Source and memory checks', { exact: true }).click();
  await expect(page.getByText('Source support: supported. Notation: matches-source. Task: same-task.')).toBeVisible();
  await expect(page.getByText('4 observed model sends · input 1800 tokens · output 900 tokens.')).toBeVisible();
  await expect(prompt).toHaveValue('Match the original source notation while preserving the tested learning task.');
  await expect(requiredChanges).toHaveValue('Keep lecture notation.');
  const stem = page.getByRole('textbox', { name: 'Question stem', exact: true });
  await expect(stem).toHaveValue('Which risk remains after diversification?');
  expect(await regenerationRecoveryState(page)).toEqual({});
  expect(await page.evaluate(() => sessionStorage.getItem('financebot:regeneration:unrelated-course:unrelated-question'))).toBe('keep');
  if (rejection.code === 'generation-evidence-source-changed') {
    await page.screenshot({ path: testInfo.outputPath('stale-source-retained-desktop-mocked.png'), fullPage: true });
    await page.getByRole('heading', { name: 'Regenerate side by side' }).locator('..').screenshot({ path: testInfo.outputPath('stale-source-panel-desktop-mocked.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include('.view--question-detail').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('stale-source-retained-mobile-dark-mocked.png'), fullPage: true });
    await page.getByRole('heading', { name: 'Regenerate side by side' }).locator('..').screenshot({ path: testInfo.outputPath('stale-source-panel-mobile-dark-mocked.png') });
    await page.setViewportSize({ width: 1280, height: 720 });
  }

  // Neither a forced event nor the dirty-editor reset may re-enable this exact candidate.
  await replace.dispatchEvent('click');
  await stem.fill('My unsaved risk clarification.');
  await expect(stem).toHaveValue('My unsaved risk clarification.');
  await stem.fill('Which risk remains after diversification?');
  await expect(replace).toBeDisabled();
  expect(fixture.adoptions).toEqual([{ expectedVersionId: VERSION }]);
  expect(fixture.requests).toHaveLength(1);
  expect(fixture.edits).toEqual([]);

  // Starting fresh is an explicit instructor action, with a new request identity even for identical inputs.
  await page.getByRole('button', { name: 'Generate alternative', exact: true }).click();
  await expect(replace).toBeEnabled();
  expect(fixture.requests).toHaveLength(2);
  expect(fixture.requests[1]).toMatchObject({ expectedVersionId: VERSION, requiredChanges: ['Keep lecture notation.'] });
  expect(fixture.requests[1].requestId).not.toBe(fixture.requests[0].requestId);
  expect(fixture.adoptions).toHaveLength(1);
});

test('mocked UI explains a generation source prerequisite rejection and uses a fresh UUID only on explicit retry', async ({ page }) => {
  const fixture = await regenerationFixture(page); await fixture.open(); await fixture.enable();
  fixture.failGeneration({ status: 409, error: 'generation-evidence-ingest-incomplete' });
  await page.getByRole('button', { name: 'Generate alternative', exact: true }).click();
  await expect(page.getByText('The course sources are not fully processed. Wait for the files to finish processing, then generate a new alternative.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Replace with variant' })).toBeHidden();
  expect(await regenerationRecoveryState(page)).toEqual({});
  expect(fixture.requests).toHaveLength(1);
  expect(fixture.adoptions).toEqual([]);
  fixture.failGeneration(undefined);
  await page.getByRole('button', { name: 'Generate alternative', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Replace with variant' })).toBeEnabled();
  expect(fixture.requests).toHaveLength(2);
  expect(fixture.requests[1].requestId).not.toBe(fixture.requests[0].requestId);
});

for (const failure of ['server', 'network'] as const) test(`mocked UI preserves retry and candidate restoration after an ambiguous ${failure} adoption failure`, async ({ page }) => {
  const fixture = await regenerationFixture(page); await fixture.open(); await fixture.enable();
  await page.getByRole('button', { name: 'Generate alternative', exact: true }).click();
  const replace = page.getByRole('button', { name: 'Replace with variant' });
  await expect(replace).toBeEnabled();
  // Even a recognized code cannot establish staleness when returned with an unknown-failure status.
  fixture.failAdoption(failure === 'server' ? { status: 500, error: 'generation-evidence-source-changed' } : 'network');
  await replace.click();
  await expect(replace).toBeEnabled();
  if (failure === 'server') await expect(page.getByText('generation-evidence-source-changed', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Generated variant' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Question stem', exact: true })).toHaveValue('Which risk remains after diversification?');
  expect(Object.values(await regenerationRecoveryState(page))).toContain(CANDIDATE);
  expect(fixture.requests).toHaveLength(1);

  await page.reload(); await fixture.open();
  await expect(page.getByText(/Restored candidate/)).toBeVisible();
  await expect(replace).toBeEnabled();
  fixture.failAdoption(undefined);
  await replace.click();
  await expect(page.getByRole('textbox', { name: 'Question stem', exact: true })).toHaveValue(variant.stem);
  expect(fixture.adoptions).toEqual([{ expectedVersionId: VERSION }, { expectedVersionId: VERSION }]);
  expect(fixture.requests).toHaveLength(1);
  expect(fixture.edits).toEqual([]);
});

test('unsaved editor changes cannot be discarded by generating or adopting a candidate', async ({ page }) => {
  const fixture = await regenerationFixture(page); await fixture.open(); await fixture.enable();
  await page.getByRole('button', { name: 'Generate alternative', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Replace with variant' })).toBeVisible();
  const stem = page.getByRole('textbox', { name: 'Question stem', exact: true });
  await stem.fill('My unsaved risk clarification.');
  await expect(page.getByRole('button', { name: 'Replace with variant' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Generate alternative', exact: true })).toBeDisabled();
  await expect(stem).toHaveValue('My unsaved risk clarification.');
  expect(fixture.adoptions).toEqual([]);
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Replace with variant' })).toBeHidden();
  await expect(stem).toHaveValue('My unsaved risk clarification.');
  expect(fixture.edits[0]).toMatchObject({ expectedVersionId: VERSION });
});

test('a still-preparing retained candidate replays the same UUID after reload', async ({ page }) => {
  const fixture = await regenerationFixture(page, { preparing: true }); await fixture.open(); await fixture.enable();
  await page.getByRole('textbox', { name: 'Regeneration prompt' }).fill('Change notation only while preserving the formula.');
  await page.getByRole('button', { name: 'Generate alternative', exact: true }).click();
  await expect(page.getByText(/Candidate preparing:/)).toBeVisible();
  await page.reload(); await fixture.open();
  await expect(page.getByText(/Restored candidate/)).toBeVisible();
  await page.getByRole('button', { name: 'Generate alternative', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Replace with variant' })).toBeVisible();
  expect(fixture.requests[1]).toEqual(fixture.requests[0]);
});

test('diagnostic candidates remain visibly distinct from adoptable questions', async ({ page }) => {
  const fixture = await regenerationFixture(page, { diagnostic: true }); await fixture.open(); await fixture.enable();
  await expect(page.getByText(/Diagnostic mode: candidates/)).toBeVisible();
  await page.getByRole('button', { name: 'Generate diagnostic candidate' }).click();
  await expect(page.getByRole('button', { name: 'Replace with variant' })).toBeDisabled();
  expect(fixture.adoptions).toEqual([]);
});

test('withheld regeneration explains the failed requirement and cannot replace the original question', async ({ page }) => {
  const fixture = await regenerationFixture(page, { withheld: true }); await fixture.open(); await fixture.enable();
  await page.getByRole('textbox', { name: 'Regeneration prompt' }).fill('Use the notation from the original lecture.');
  await page.getByRole('textbox', { name: 'Required changes' }).fill('Match the lecture beta notation');
  await page.getByRole('button', { name: 'Generate alternative', exact: true }).click();
  await expect(page.getByText(/Candidate withheld: The requested notation change was not completed./)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Replace with variant' })).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Question stem', exact: true })).toHaveValue('Which risk remains after diversification?');
  expect(fixture.adoptions).toEqual([]); expect(fixture.edits).toEqual([]);
  await page.reload(); await fixture.open();
  await expect(page.getByText(/Restored candidate.*withheld/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Replace with variant' })).toBeHidden();
  expect(fixture.requests).toHaveLength(1);
});

for (const mobile of [false, true]) test(`checked regeneration is accessible at ${mobile ? 'mobile dark' : 'desktop light'} width`, async ({ page }) => {
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
  const fixture = await regenerationFixture(page); await fixture.open(); await fixture.enable();
  if (mobile) await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.getByRole('button', { name: 'Generate alternative', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Replace with variant' })).toBeVisible();
  await page.getByText('Source and memory checks').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const scan = await new AxeBuilder({ page }).include('.view--question-detail').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(scan.violations).toEqual([]);
  await mkdir(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: `${ARTIFACTS}/regeneration-${mobile ? 'mobile-dark' : 'desktop-light'}.png`, fullPage: true });
});
