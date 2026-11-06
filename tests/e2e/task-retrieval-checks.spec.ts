import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { GenerationQualityAssessment, GenerationTaskRetrievalDiagnostic } from '../../client/src/api';

const COURSE = '6cf000000000000000000001', QUESTION = '6cf000000000000000000002';
const VERSION = '6cf000000000000000000003', LO = '6cf000000000000000000004';
const THEME = '6cf000000000000000000005', CANDIDATE = '6cf000000000000000000006';
const runId = 'task-retrieval-run';

function retrieval(): GenerationTaskRetrievalDiagnostic {
  return { protocol: 'course-task-retrieval-v1', rankerVersion: 'lexical-profile-v1', queryHash: 'a'.repeat(64), bindingsDigest: 'b'.repeat(64),
    status: 'complete', headsScanned: 202, versionsChecked: 202, missingVersions: 0, invalidVersions: 0, invalidHeads: 0,
    missingDescriptors: 5, ignoredProfiles: 1, unscannedHeadsLowerBound: 0,
    nominatedIds: ['older-task-v1', 'different-inference-v3'], retainedIds: ['older-task-v1', 'different-inference-v3', 'recent-task-v2'],
    requiredComparisonIds: ['older-task-v1', 'different-inference-v3'] };
}

async function fixture(page: Page, diagnostic: GenerationTaskRetrievalDiagnostic | undefined,
  mode: 'component' | 'generation' | 'initial' | 'regeneration' = 'component', failure?: { status: number; error: string }) {
  const calls: Array<{ method: string; path: string }> = [], external: string[] = [], errors: string[] = [];
  const options = [{ key: 'A', text: 'Market risk remains.', role: 'correct' as const, explanation: 'Diversification does not remove systematic risk.' },
    { key: 'B', text: 'All risk disappears.', role: 'common-misconception' as const, explanation: 'Firm-specific risk is diversifiable.' }];
  const quality: GenerationQualityAssessment = { policy: 'grounded-memory-v2', item: 0, status: 'eligible', sourceSupport: 'supported', notation: 'consistent', novelty: 'uncertain', reasons: [], citations: [],
    matchedEntryIds: [], evidencePacketId: 'synthetic-evidence', memoryDigest: 'synthetic-memory', checkedAt: '2026-10-17T14:00:00Z', taskRetrieval: diagnostic,
    coverage: { evidenceTruncated: false, memoryTruncated: true, shownEntries: 12, totalEntries: 200, missingVersions: 0, consistency: 'best-effort' } };
  const current = { _id: VERSION, questionId: QUESTION, version: 1, type: 'mcq', stem: 'Which risk remains after diversification?', difficulty: 'easy', options,
    sourceRefs: [], paramSlots: [], derivedValues: [], createdBy: 'synthetic-instructor', createdAt: '2026-10-17T14:00:00Z' };
  const tree = { _id: COURSE, name: 'Synthetic retrieval course', themes: [{ _id: THEME, name: 'Risk', order: 0, los: [{ _id: LO, themeId: THEME, name: 'Explain systematic risk', order: 0 }] }] };
  const run = { _id: runId, courseId: COURSE, kind: 'question-generation', status: mode === 'initial' ? 'failed' : 'completed', stage: 'persisting', revision: 2, warnings: [], events: [],
    createdAt: '2026-10-17T14:00:00Z', input: { loId: LO, count: 1, type: 'mcq', qualityPolicy: 'grounded-memory-v2' }, result: { createdQuestionIds: [], failures: [],
      quality: { policy: 'grounded-memory-v2', assessments: mode === 'initial' ? [] : [quality], ...(mode === 'initial' ? { taskRetrieval: diagnostic } : {}) } } };
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { Object.assign(window, { EventSource: class { addEventListener() {} close() {} } }); });
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:6167') { external.push(url.href); return route.abort('blockedbyclient'); }
    if (url.pathname === '/task-retrieval-fixture') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic task retrieval receipt</title><link rel="stylesheet" href="/styles/main.css"><script src="/vendor/katex.min.js"></script><script src="/vendor/katex-auto-render.min.js"></script><script src="/vendor/marked.min.js"></script><script src="/vendor/purify.min.js"></script></head><body><main style="padding:16px"></main></body></html>' });
    if (!url.pathname.startsWith('/api/')) return route.continue();
    calls.push({ method: request.method(), path: url.pathname });
    if (url.pathname.endsWith(`/regeneration-candidates/${CANDIDATE}/adopt`) && request.method() === 'POST' && failure) return route.fulfill({ status: failure.status, json: { error: failure.error } });
    if (request.method() !== 'GET') return route.fulfill({ status: 405, json: { error: 'Synthetic receipt fixture refuses mutations' } });
    if (url.pathname === `/api/courses/${COURSE}`) return route.fulfill({ json: tree });
    if (url.pathname.endsWith('/authoring-quality-status')) return route.fulfill({ json: { coordinatedSaveAvailable: true, pilot: true, teacherCalibrated: false } });
    if (url.pathname.endsWith('/materials')) return route.fulfill({ json: [{ _id: 'mock-source', name: 'Synthetic risk.pdf', status: 'ready', assignments: [{ loId: LO }] }] });
    if (url.pathname.endsWith('/preseeding')) return route.fulfill({ json: [{ loId: LO, approved: 0, unapproved: 0, target: 1 }] });
    if (url.pathname.endsWith('/content-runs')) return route.fulfill({ json: url.searchParams.has('status') ? [] : [run] });
    if (url.pathname.endsWith(`/content-runs/${runId}`)) return route.fulfill({ json: run });
    if (url.pathname.endsWith('/usage')) return route.fulfill({ json: { calls: [], totalCalls: 0 } });
    if (url.pathname === `/api/questions/${QUESTION}`) return route.fulfill({ json: { id: QUESTION, courseId: COURSE, current, currentVersionId: VERSION, currentVersion: 1, state: 'draft', loIds: [LO], themeIds: [THEME], labels: [], internalNotes: [], versions: [] } });
    if (url.pathname.endsWith('/sample')) return route.fulfill({ json: { stem: current.stem, options, parameterized: false } });
    if (url.pathname.endsWith(`/regeneration-candidates/${CANDIDATE}`)) return route.fulfill({ json: { candidateId: CANDIDATE, originalVersionId: VERSION, intent: 'edit-existing', status: 'eligible', reasons: [], quality, variant: current } });
    if (url.pathname.endsWith('/questions')) return route.fulfill({ json: { total: 0, questions: [] } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/task-retrieval-fixture');
  if (mode === 'component') await page.evaluate(async quality => {
    const main = document.querySelector('main')!; const heading = document.createElement('h1'); heading.textContent = 'Recorded synthetic checks'; main.append(heading);
    main.append((await import('/js/views/instructor/task-retrieval-checks.js')).taskRetrievalChecks(quality));
  }, quality);
  else if (mode === 'generation' || mode === 'initial') {
    await page.evaluate(async id => (await import('/js/views/instructor/generation-workbench.js')).renderGenerationWorkbench(document.querySelector('main')!, id), COURSE);
    await page.getByRole('button', { name: 'Generation activity', exact: true }).click();
    await page.getByRole('button', { name: 'View steps', exact: true }).click();
  } else {
    // Imported modules run in the browser; fixture identifiers are passed explicitly.
    await page.evaluate(async ({ course, question, candidate }) => {
      sessionStorage.setItem(`financebot:regeneration:unknown:${course}:${question}`, candidate);
      (await import('/js/views/instructor/question-detail.js')).renderQuestionDetail(document.querySelector('main')!, { id: course, questionId: question });
    }, { course: COURSE, question: QUESTION, candidate: CANDIDATE });
    await page.getByRole('button', { name: '↻ Regenerate', exact: true }).click();
    await page.getByText('Source and memory checks', { exact: true }).click();
  }
  const root = (mode === 'generation' || mode === 'initial' ? page.getByRole('dialog') : page).getByRole('region', { name: mode === 'initial' ? 'Initial task retrieval' : 'Task retrieval', exact: true });
  await expect(root).toBeVisible();
  return { root, calls, external, errors };
}

function safe(state: Awaited<ReturnType<typeof fixture>>, adopts = 0) {
  expect(state.calls.filter(call => call.method !== 'GET')).toEqual(Array.from({ length: adopts }, () => ({ method: 'POST', path: `/api/courses/${COURSE}/questions/${QUESTION}/regeneration-candidates/${CANDIDATE}/adopt` })));
  expect(state.external).toEqual([]); expect(state.errors).toEqual([]);
}

for (const [name, width, theme] of [['desktop-light', 1440, 'light'], ['mobile-dark', 390, 'dark']] as const) test(`task retrieval receipt ${name} remains compact in the existing generation checks`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  const state = await fixture(page, retrieval(), 'generation');
  await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
  await expect(state.root).toContainText('Complete · 202 heads scanned · 202 current versions checked · 2 nominated · 2 required comparisons');
  await expect(state.root).toContainText('not novelty or duplicate verdicts'); await expect(state.root).toContainText('not complete semantic recall');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('dialog [aria-label="Task retrieval"]').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  await state.root.screenshot({ path: testInfo.outputPath(`${name}-synthetic-task-retrieval.png`) });
  await state.root.getByText('Task retrieval receipt', { exact: true }).click();
  await expect(state.root).toContainText('Retained Bank entries: 3. Missing prepared descriptors: 5. Ignored profiles: 1');
  await expect(state.root).toContainText('older-task-v1'); safe(state);
});

test('incomplete task retrieval retains missing counts, bounded literal IDs and an honest lower bound', async ({ page }) => {
  const hostile = '<img src=x onerror="window.taskRetrievalInjected=true">';
  const state = await fixture(page, { ...retrieval(), status: 'incomplete', incompleteReason: 'profile-limit', versionsChecked: 199, missingVersions: 2, invalidVersions: 1,
    unscannedHeadsLowerBound: 1, nominatedIds: [hostile, ...Array.from({ length: 20 }, (_, i) => `literal-${i}`)], requiredComparisonIds: [hostile] });
  await state.root.getByText('Task retrieval receipt', { exact: true }).click();
  await expect(state.root).toContainText('Incomplete · 202 heads scanned · 199 current versions checked · 21 nominated · 1 required comparisons');
  await expect(state.root).toContainText('profile limit reached'); await expect(state.root).toContainText('Missing versions: 2. Invalid versions: 1');
  await expect(state.root).toContainText('not an estimate of the remaining Bank size'); await expect(state.root).toContainText('first 12 displayed');
  await expect(state.root.locator('li')).toHaveCount(13); await expect(state.root).toContainText(hostile); await expect(state.root.locator('img,script')).toHaveCount(0);
  expect(await page.evaluate(() => 'taskRetrievalInjected' in window)).toBe(false); safe(state);
});

test('historical and unknown retrieval receipts supply no invented counts or API work', async ({ page }) => {
  const state = await fixture(page, undefined); await expect(state.root).toContainText('not recorded for this assessment');
  await expect(state.root).not.toContainText('0 heads scanned'); expect(state.calls).toEqual([]);
  await page.evaluate(async () => {
    const root = document.querySelector('[aria-label="Task retrieval"]')!;
    root.replaceWith((await import('/js/views/instructor/task-retrieval-checks.js')).taskRetrievalChecks({ taskRetrieval: { protocol: 'unknown' } } as never));
  });
  await expect(state.root).toContainText('coverage is unavailable'); await expect(state.root).not.toContainText('heads scanned'); safe(state);
});

test('initial run retrieval remains visible when incomplete readiness prevents every assessment', async ({ page }) => {
  const state = await fixture(page, { ...retrieval(), status: 'incomplete', incompleteReason: 'deadline', nominatedIds: [], requiredComparisonIds: [] }, 'initial');
  await expect(state.root).toContainText('Initial task retrieval · Incomplete');
  await state.root.getByText('Task retrieval receipt', { exact: true }).click(); await expect(state.root).toContainText('deadline reached');
  await expect(page.getByRole('dialog')).toContainText('No recorded pilot assessment is available'); safe(state);
});

test('transient incomplete retrieval preserves the same recovered candidate for explicit adoption retry', async ({ page }) => {
  const state = await fixture(page, retrieval(), 'regeneration', { status: 503, error: 'generation-task-retrieval-incomplete' });
  const replace = page.getByRole('button', { name: 'Replace with variant', exact: true }); await expect(replace).toBeEnabled(); await replace.click();
  await expect(page.getByText('The current Question Bank task retrieval could not finish. Your candidate is retained. Retry Replace when the bank is available.', { exact: true })).toBeVisible();
  await expect(replace).toBeEnabled(); await expect(page.getByRole('heading', { name: 'Generated variant' })).toBeVisible();
  expect(await page.evaluate(({ course, question }) => sessionStorage.getItem(`financebot:regeneration:unknown:${course}:${question}`), { course: COURSE, question: QUESTION })).toBe(CANDIDATE);
  await replace.click(); safe(state, 2);
});

for (const suffix of ['receipt-invalid', 'selection-invalid', 'assessment-invalid', 'query-invalid', 'scope-invalid', 'protocol-invalid', 'policy-invalid', 'vector-invalid']) test(`invalid task retrieval ${suffix} retains previews and blocks stale adoption`, async ({ page }) => {
  const state = await fixture(page, retrieval(), 'regeneration', { status: 422, error: `generation-task-retrieval-${suffix}` });
  await page.evaluate(() => sessionStorage.setItem('financebot:regeneration:unrelated-course:unrelated-question', 'keep'));
  const replace = page.getByRole('button', { name: 'Replace with variant', exact: true }); await replace.click();
  await expect(page.getByText('This candidate does not have a valid current task-retrieval check. Review its source and memory checks, then generate a new alternative before replacing.', { exact: true })).toBeVisible();
  await expect(replace).toBeDisabled(); await expect(page.getByRole('heading', { name: 'Generated variant' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Question stem', exact: true })).toHaveValue('Which risk remains after diversification?');
  expect(await page.evaluate(({ course, question }) => sessionStorage.getItem(`financebot:regeneration:unknown:${course}:${question}`), { course: COURSE, question: QUESTION })).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem('financebot:regeneration:unrelated-course:unrelated-question'))).toBe('keep');
  await replace.dispatchEvent('click'); safe(state, 1);
});
