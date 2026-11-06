import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { GenerationQualityAssessment, QuestionOption } from '../../client/src/api';

/** Synthetic judgments test rendering only, not model quality or semantic acceptance. */
const COURSE = '6ae000000000000000000001', QUESTION = '6ae000000000000000000002', VERSION = '6ae000000000000000000003';
const LO = '6ae000000000000000000004', THEME = '6ae000000000000000000005', CANDIDATE = '6ae000000000000000000006';
const output = join(__dirname, '../../audit-results/answer-exclusion-warrants-2026-10-17/ui-r4');
const options: QuestionOption[] = [
  { key: 'A', text: 'Systematic risk remains.', role: 'correct', explanation: 'A diversified portfolio can retain market risk.' },
  { key: 'B', text: 'All risk disappears.', role: 'common-misconception', explanation: 'Diversification removes firm-specific risk, not every source of risk.' },
  { key: 'C', text: 'Beta must become zero.', role: 'partially-correct', explanation: 'Portfolio beta can remain positive.' },
  { key: 'D', text: 'Only total volatility earns compensation.', role: 'clearly-wrong', explanation: 'Systematic risk determines the required return in this source.' },
];
const tree = { _id: COURSE, name: 'Mocked finance course', code: 'MOCK 101', themes: [{ _id: THEME, name: 'Risk', order: 0, los: [{ _id: LO, name: 'Distinguish systematic risk', order: 0, themeId: THEME }] }] };
function assessment(): GenerationQualityAssessment {
  return { policy: 'grounded-memory-v2', item: 0, status: 'eligible', sourceSupport: 'supported', notation: 'consistent', novelty: 'independent', reasons: [],
    citations: [], matchedEntryIds: [], evidencePacketId: 'mock-evidence', memoryDigest: 'mock-memory', checkedAt: '2026-10-17T12:00:00Z',
    candidate: { type: 'mcq', stem: 'Which risk remains after diversification?', options: structuredClone(options), contentHash: 'mock', truncated: false },
    coverage: { evidenceTruncated: false, memoryTruncated: false, shownEntries: 1, totalEntries: 1, missingVersions: 0, consistency: 'best-effort' },
    answerability: { protocol: 'option-answerability-v1', kind: 'mcq', status: 'passed', keyedOptionKey: 'A', resolvedCorrectKey: 'A', issues: [], options: options.map((option, index) => ({
      key: option.key, verdict: index === 0 ? 'fully-correct' : 'not-fully-correct', reason: index === 0 ? 'The literal answer matches the supplied distinction.' : 'The literal answer conflicts with the supplied distinction.',
      exclusionBasis: index === 0 ? 'none' : 'source-contradiction', exclusion: index === 0 ? '' : 'The source retains systematic risk.', stemQuote: '',
      citations: index === 0 ? [{ kind: 'premise', claim: 'The source retains systematic risk.', passageId: 'S1.P1', quote: 'Diversification does not remove systematic risk.' }] : [],
    })) } };
}
test.beforeAll(async () => { await mkdir(output, { recursive: true }); });

async function fixture(page: Page, quality: GenerationQualityAssessment, mode: 'component' | 'generation' | 'regeneration' = 'component') {
  const requests: Array<{ method: string; path: string }> = [], external: string[] = [], errors: string[] = [], consoleErrors: string[] = [];
  const run = { _id: 'recorded-run', courseId: COURSE, kind: 'question-generation', revision: 2, status: 'completed', stage: 'persisting', createdAt: '2026-10-17T12:00:00Z', completedAt: '2026-10-17T12:01:00Z',
    input: { loId: LO, count: 1, type: 'mcq', qualityPolicy: 'grounded-memory-v2' }, completedUnits: 1, totalUnits: 1, warnings: [], events: [], result: { createdQuestionIds: [], failures: [], quality: { policy: 'grounded-memory-v2', assessments: [quality] } } };
  const current = { _id: VERSION, questionId: QUESTION, version: 1, type: 'mcq', stem: 'Which risk remains after diversification?', difficulty: 'easy', options, paramSlots: [], derivedValues: [], sourceRefs: [], createdAt: '2026-10-17T12:00:00Z', createdBy: 'mock-instructor' };
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.addInitScript(() => { Object.assign(window, { EventSource: class { addEventListener() {} close() {} } }); });
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:6183') { external.push(url.origin); return route.abort('blockedbyclient'); }
    if (url.pathname === '/js/views/instructor/answerability-before-exclusion.js') return route.fulfill({ contentType: 'text/javascript', body: readFileSync(join(__dirname, 'fixtures/answerability-before-exclusion.js'), 'utf8') });
    if (url.pathname === '/answerability-fixture') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mocked answerability checks</title><link rel="stylesheet" href="/styles/main.css"><script src="/vendor/katex.min.js"></script><script src="/vendor/katex-auto-render.min.js"></script><script src="/vendor/marked.min.js"></script><script src="/vendor/purify.min.js"></script></head><body><main style="padding:16px"></main></body></html>' });
    if (!url.pathname.startsWith('/api/')) return route.continue();
    requests.push({ method: request.method(), path: url.pathname });
    if (request.method() !== 'GET') return route.fulfill({ status: 405, json: { error: 'Read-only synthetic fixture' } });
    if (url.pathname === `/api/courses/${COURSE}`) return route.fulfill({ json: tree });
    if (url.pathname.endsWith('/authoring-quality-status')) return route.fulfill({ json: { coordinatedSaveAvailable: true, pilot: true, teacherCalibrated: false } });
    if (url.pathname.endsWith('/materials')) return route.fulfill({ json: [{ _id: 'material', name: 'Mocked source.txt', status: 'ready', assignments: [{ loId: LO }] }] });
    if (url.pathname.endsWith('/preseeding')) return route.fulfill({ json: [{ loId: LO, approved: 0, unapproved: 0, target: 1 }] });
    if (url.pathname.endsWith('/content-runs')) return route.fulfill({ json: url.searchParams.has('status') ? [] : [run] });
    if (url.pathname.endsWith('/content-runs/recorded-run')) return route.fulfill({ json: run });
    if (url.pathname.endsWith('/usage')) return route.fulfill({ json: { calls: [], totalCalls: 0 } });
    if (url.pathname === `/api/questions/${QUESTION}`) return route.fulfill({ json: { id: QUESTION, courseId: COURSE, current, currentVersionId: VERSION, currentVersion: 1, state: 'draft', loIds: [LO], themeIds: [THEME], labels: [], internalNotes: [], versions: [] } });
    if (url.pathname.endsWith('/sample')) return route.fulfill({ json: { stem: current.stem, options, parameterized: false } });
    if (url.pathname.endsWith(`/regeneration-candidates/${CANDIDATE}`)) return route.fulfill({ json: { candidateId: CANDIDATE, originalVersionId: VERSION, intent: 'edit-existing', status: quality.status, quality, reasons: [], variant: { ...current } } });
    if (url.pathname.endsWith('/questions')) return route.fulfill({ json: { total: 0, questions: [] } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/answerability-fixture');
  if (mode === 'component') {
    await page.evaluate(async ({ course, quality }) => {
      const main = document.querySelector('main')!;
      main.style.maxWidth = '760px'; main.style.margin = 'auto';
      const heading = document.createElement('h1'); heading.textContent = 'Recorded question checks'; main.append(heading);
      const fixtureNotice = document.createElement('p'); fixtureNotice.textContent = 'Scripted UI fixture · no model call or semantic acceptance claim.'; main.append(fixtureNotice);
      const details = document.createElement('details'); details.open = true;
      const summary = document.createElement('summary'); summary.textContent = 'Source and memory checks'; details.append(summary);
      details.append((await import('/js/views/instructor/answerability-checks.js')).answerabilityChecks(course, quality)); main.append(details);
    }, { course: COURSE, quality });
  } else if (mode === 'generation') {
    await page.evaluate(async course => { await (await import('/js/views/instructor/generation-workbench.js')).renderGenerationWorkbench(document.querySelector('main')!, course); }, COURSE);
    await page.getByRole('button', { name: 'Generation activity', exact: true }).click();
    await page.getByRole('button', { name: 'View steps', exact: true }).click();
    await page.getByRole('dialog').getByText('Check details', { exact: true }).click();
  } else {
    await page.evaluate(async ({ course, question, candidate }) => {
      sessionStorage.setItem(`financebot:regeneration:unknown:${course}:${question}`, candidate);
      (await import('/js/views/instructor/question-detail.js')).renderQuestionDetail(document.querySelector('main')!, { id: course, questionId: question });
    }, { course: COURSE, question: QUESTION, candidate: CANDIDATE });
    await page.getByRole('button', { name: '↻ Regenerate', exact: true }).click();
    await page.getByText('Source and memory checks', { exact: true }).click();
  }
  await expect(page.getByRole('region', { name: 'Answerability checks', exact: true })).toBeVisible();
  return { requests, external, errors, consoleErrors };
}
function readOnly(state: Awaited<ReturnType<typeof fixture>>) {
  expect(state.requests.every(row => row.method === 'GET')).toBe(true); expect(state.external).toEqual([]); expect(state.errors).toEqual([]); expect(state.consoleErrors).toEqual([]);
  const title = test.info().title;
  writeFileSync(join(output, `case-${createHash('sha256').update(title).digest('hex').slice(0, 12)}.json`), JSON.stringify({ title, synthetic: true, ...state }, null, 2));
}
async function openOptions(page: Page) {
  for (const details of await page.locator('[data-answerability-option]').all()) await details.locator('summary').first().click();
}


type Answer = Extract<NonNullable<GenerationQualityAssessment['answerability']>, { kind: 'mcq' }>;
function withWarrants(): GenerationQualityAssessment {
  const quality = assessment(), answer = quality.answerability as Answer & { exclusionProtocol: string };
  answer.exclusionProtocol = 'literal-exclusion-warrants-v1';
  for (const [index, option] of answer.options.entries()) if (index > 0) Object.assign(option, { exclusionWarrant: {
    basis: 'direct-contradiction', optionQuote: quality.candidate!.options[index].text, stemQuote: '',
    challenge: { status: 'excluded', reason: 'The retained source states the opposing proposition.', citations: [
      { kind: 'solution', claim: 'Systematic risk remains.', passageId: 'S1.P1', quote: 'Diversification does not remove systematic risk.' },
    ] }, issues: [],
  } });
  return quality;
}
function option(quality: GenerationQualityAssessment, index = 1): Record<string, unknown> {
  return (quality.answerability as Answer).options[index] as unknown as Record<string, unknown>;
}
async function openCheck(page: Page, key = 'B') {
  const dialog = page.getByRole('dialog'); const scope = await dialog.isVisible() ? dialog : page;
  const row = scope.locator(`[data-answerability-option="${key}"]`); await row.locator('summary').first().click();
  const check = row.locator('[data-exclusion-check]'); await check.locator('summary').first().click(); return check;
}

test('historical absent protocol produces the exact prior compiled disclosure DOM', async ({ page }) => {
  const quality = assessment(), state = await fixture(page, quality);
  const prior = await page.evaluate(async ({ course, quality }) => {
    const module = await import('/js/views/instructor/answerability-before-exclusion.js');
    return module.answerabilityChecks(course, quality).outerHTML;
  }, { course: COURSE, quality });
  expect(await page.getByRole('region', { name: 'Answerability checks' }).evaluate(node => node.outerHTML)).toBe(prior);
  await expect(page.locator('[data-exclusion-check]')).toHaveCount(0); readOnly(state);
});

test('valid recorded exclusion preserves exact clauses, challenge and source quotations', async ({ page }) => {
  const quality = withWarrants(), state = await fixture(page, quality), check = await openCheck(page);
  await expect(check).toContainText('Basis: Direct contradiction');
  expect(await check.locator(':scope > blockquote').textContent()).toBe(options[1].text);
  await expect(check).toContainText('Challenge: Alternative excluded in recorded check');
  await expect(check).toContainText('Quotations locate retained evidence; they do not prove');
  await check.getByText('Source quotations (1)', { exact: true }).click();
  expect(await check.locator('blockquote').allTextContents()).toEqual([options[1].text, 'Diversification does not remove systematic risk.']);
  await expect(page.locator('[data-answerability-option="A"] [data-exclusion-check]')).toHaveCount(0); readOnly(state);
});

test('exact stem restrictions remain separate from the option and corrective feedback', async ({ page }) => {
  const quality = withWarrants(), warrant = option(quality).exclusionWarrant as Record<string, unknown>;
  warrant.basis = 'explicit-task-restriction'; warrant.stemQuote = quality.candidate!.stem;
  const state = await fixture(page, quality), check = await openCheck(page);
  expect(await check.locator(':scope > blockquote, :scope > div > blockquote').allTextContents()).toEqual([options[1].text, quality.candidate!.stem]);
  await expect(check).not.toContainText(options[1].explanation); readOnly(state);
});

for (const [basis, label] of [
  ['derived-incompatibility', 'Derived incompatibility'], ['required-component-missing', 'Required component missing'],
  ['placement-only', 'Table placement only'], ['strength-only', 'Difference in strength only'],
  ['silence-only', 'Source silence only'], ['undetermined', 'Undetermined'],
]) test(`known basis ${basis} has a bounded human label and preserves uncertainty`, async ({ page }) => {
  const quality = withWarrants(), warrant = option(quality).exclusionWarrant as Record<string, unknown>;
  warrant.basis = basis; warrant.challenge = { status: 'uncertain', reason: 'The original does not resolve this exclusion.', citations: [] };
  const state = await fixture(page, quality), check = await openCheck(page);
  await expect(check).toContainText(`Basis: ${label}`); await expect(check).toContainText('Challenge: Unresolved');
  if (['placement-only', 'strength-only', 'silence-only', 'undetermined'].includes(basis)) await expect(check).toContainText('This basis does not establish that the alternative is excluded.');
  readOnly(state);
});

test('a viable alternative and recorded issue count remain visible without raw issue JSON', async ({ page }) => {
  const quality = withWarrants(), warrant = option(quality).exclusionWarrant as Record<string, unknown>;
  warrant.challenge = { status: 'viable', reason: 'The literal alternative remains possible under the supplied conditions.', citations: [] };
  warrant.issues = [{ path: 'answerability.options.1.exclusion', code: 'unknown-private-debug-code' }];
  const state = await fixture(page, quality), check = await openCheck(page);
  await expect(check).toContainText('Challenge: Alternative remains viable'); await expect(check).toContainText('1 recorded exclusion issue needs review.');
  await expect(check).not.toContainText('unknown-private-debug-code'); await expect(check).not.toContainText('answerability.options.1.exclusion'); readOnly(state);
});

for (const [name, mutation] of [
  ['missing', (row: Record<string, unknown>) => { delete row.exclusionWarrant; }],
  ['unknown-basis', (row: Record<string, unknown>) => { (row.exclusionWarrant as Record<string, unknown>).basis = 'invented-safe'; }],
  ['prototype-basis', (row: Record<string, unknown>) => { (row.exclusionWarrant as Record<string, unknown>).basis = 'toString'; }],
  ['oversize-clause', (row: Record<string, unknown>) => { (row.exclusionWarrant as Record<string, unknown>).optionQuote = 'x'.repeat(121); }],
  ['invalid-challenge', (row: Record<string, unknown>) => { (row.exclusionWarrant as Record<string, unknown>).challenge = null; }],
  ['invalid-citation', (row: Record<string, unknown>) => { ((row.exclusionWarrant as Record<string, unknown>).challenge as Record<string, unknown>).citations = [null]; }],
  ['oversize-quote', (row: Record<string, unknown>) => { ((row.exclusionWarrant as Record<string, unknown>).challenge as Record<string, unknown>).citations = [{ kind: 'solution', claim: 'claim', passageId: 'S1.P1', quote: 'x'.repeat(20_001) }]; }],
  ['invalid-issues', (row: Record<string, unknown>) => { (row.exclusionWarrant as Record<string, unknown>).issues = [null]; }],
] as const) test(`malformed ${name} warrant is safely unavailable`, async ({ page }) => {
  const quality = withWarrants(); mutation(option(quality)); const state = await fixture(page, quality), check = await openCheck(page);
  await expect(check).toContainText('This recorded exclusion check is unavailable or malformed.');
  await expect(check).not.toContainText('Alternative excluded in recorded check'); readOnly(state);
});

test('unknown protocol is unavailable and never renders its warrant', async ({ page }) => {
  const quality = withWarrants(); Object.assign(quality.answerability!, { exclusionProtocol: 'future-private-protocol' });
  const state = await fixture(page, quality); await openOptions(page);
  await expect(page.getByText('Exclusion checks are unavailable for this recorded protocol.', { exact: true })).toBeVisible();
  await expect(page.locator('[data-exclusion-check]')).toHaveCount(0); readOnly(state);
});

test('multiple exact quotations resolved from a span group are retained beyond three rows', async ({ page }) => {
  const quality = withWarrants(), warrant = option(quality).exclusionWarrant as Record<string, unknown>;
  (warrant.challenge as Record<string, unknown>).citations = Array.from({ length: 4 }, (_, index) => ({ kind: 'solution', claim: `Claim ${index}`, passageId: `P${index}`, quote: `Exact original quotation ${index}` }));
  const state = await fixture(page, quality), check = await openCheck(page); await check.getByText('Source quotations (4)', { exact: true }).click();
  expect(await check.locator('blockquote').allTextContents()).toEqual([options[1].text, ...Array.from({ length: 4 }, (_, index) => `Exact original quotation ${index}`)]); readOnly(state);
});

test('hostile clause, reason and citation remain literal and never create HTML', async ({ page }) => {
  const quality = withWarrants(), warrant = option(quality).exclusionWarrant as Record<string, unknown>;
  const hostile = '<img src=x onerror="window.exclusionInjected=true">';
  warrant.optionQuote = hostile; warrant.stemQuote = hostile; warrant.challenge = { status: 'viable', reason: hostile, citations: [{ kind: 'solution', claim: hostile, passageId: 'S1.P1', quote: hostile }] };
  const state = await fixture(page, quality), check = await openCheck(page); await check.getByText('Source quotations (1)', { exact: true }).click();
  expect(await check.locator('blockquote').allTextContents()).toEqual([hostile, hostile, hostile]);
  await expect(check.locator('img, script')).toHaveCount(0); expect(await page.evaluate(() => 'exclusionInjected' in window)).toBe(false); readOnly(state);
});

for (const mode of ['generation', 'regeneration'] as const) test(`compiled ${mode} reuses the same recorded exclusion disclosure without calls`, async ({ page }) => {
  const state = await fixture(page, withWarrants(), mode); const check = await openCheck(page);
  await expect(check).toContainText('Challenge: Alternative excluded in recorded check');
  if (mode === 'regeneration') expect(state.requests.some(row => row.path.endsWith(`/regeneration-candidates/${CANDIDATE}`))).toBe(true);
  readOnly(state);
});

for (const [name, width, theme] of [['desktop-light', 1440, 'light'], ['desktop-dark', 1440, 'dark'], ['mobile-light', 390, 'light'], ['mobile-dark', 390, 'dark']] as const) {
  test(`compiled ${name} exclusion disclosure has no overflow or scoped axe violations`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); const quality = withWarrants();
    quality.status = 'withheld'; quality.answerability!.status = 'withheld'; delete quality.answerability!.resolvedCorrectKey;
    quality.candidate!.stem = 'Which statement about diversification is supported by the supplied source?';
    quality.candidate!.options[0].text = 'Market risk cannot be diversified away.';
    quality.candidate!.options[1].text = 'Diversification across asset classes can mitigate market risk.';
    Object.assign(option(quality), { reason: 'The initial recorded check treated mitigation as complete elimination.', exclusion: 'Market risk cannot be diversified away.' });
    const warrant = option(quality).exclusionWarrant as Record<string, unknown>; warrant.basis = 'strength-only';
    warrant.optionQuote = quality.candidate!.options[1].text;
    warrant.challenge = { status: 'viable', reason: 'Mitigation is weaker than elimination; the source permits this alternative.', citations: [{ kind: 'solution', claim: 'Mitigation is compatible with risk that cannot be diversified away.', passageId: 'S1.P1', quote: 'Investors can mitigate market risk through asset allocation; it cannot be diversified away.' }] };
    warrant.issues = [{ path: 'answerability.options.1.exclusion', code: 'exclusion-challenge-viable' }];
    const state = await fixture(page, quality); await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    const check = await openCheck(page); await check.getByText('Source quotations (1)', { exact: true }).click();
    await expect(page.getByText('Scripted UI fixture · no model call or semantic acceptance claim.', { exact: true })).toBeVisible();
    await expect(check).toContainText(quality.candidate!.options[1].text);
    await expect(check).toContainText('Investors can mitigate market risk through asset allocation; it cannot be diversified away.');
    const scan = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze(); expect(scan.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('main').screenshot({ path: join(output, `${name}-exclusion-disclosure.png`) });
    await writeFile(join(output, `${name}-axe.json`), JSON.stringify({ synthetic: true, violations: scan.violations, passes: scan.passes.length, requests: state.requests, external: state.external, pageErrors: state.errors, consoleErrors: state.consoleErrors }, null, 2)); readOnly(state);
  });
}
