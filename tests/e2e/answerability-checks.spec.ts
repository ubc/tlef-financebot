import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { GenerationQualityAssessment, QuestionOption } from '../../client/src/api';

/** Synthetic judgments test rendering only, not model quality or semantic acceptance. */
const COURSE = '6ae000000000000000000001', QUESTION = '6ae000000000000000000002', VERSION = '6ae000000000000000000003';
const LO = '6ae000000000000000000004', THEME = '6ae000000000000000000005', CANDIDATE = '6ae000000000000000000006';
const output = join(__dirname, '../../audit-results/answerability-ui-2026-10-17');
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
  const requests: Array<{ method: string; path: string }> = [], external: string[] = [], errors: string[] = [];
  const run = { _id: 'recorded-run', courseId: COURSE, kind: 'question-generation', revision: 2, status: 'completed', stage: 'persisting', createdAt: '2026-10-17T12:00:00Z', completedAt: '2026-10-17T12:01:00Z',
    input: { loId: LO, count: 1, type: 'mcq', qualityPolicy: 'grounded-memory-v2' }, completedUnits: 1, totalUnits: 1, warnings: [], events: [], result: { createdQuestionIds: [], failures: [], quality: { policy: 'grounded-memory-v2', assessments: [quality] } } };
  const current = { _id: VERSION, questionId: QUESTION, version: 1, type: 'mcq', stem: 'Which risk remains after diversification?', difficulty: 'easy', options, paramSlots: [], derivedValues: [], sourceRefs: [], createdAt: '2026-10-17T12:00:00Z', createdBy: 'mock-instructor' };
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { Object.assign(window, { EventSource: class { addEventListener() {} close() {} } }); });
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:6167') { external.push(url.origin); return route.abort('blockedbyclient'); }
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
  return { requests, external, errors };
}
function readOnly(state: Awaited<ReturnType<typeof fixture>>) {
  expect(state.requests.every(row => row.method === 'GET')).toBe(true); expect(state.external).toEqual([]); expect(state.errors).toEqual([]);
  const title = test.info().title;
  writeFileSync(join(output, `case-${createHash('sha256').update(title).digest('hex').slice(0, 12)}.json`), JSON.stringify({ title, synthetic: true, ...state }, null, 2));
}
async function openOptions(page: Page) {
  for (const details of await page.locator('[data-answerability-option]').all()) await details.locator('summary').first().click();
}

test('shows each literal MCQ verdict, reason and exclusion with feedback separated from the answer', async ({ page }) => {
  const state = await fixture(page, assessment()); await openOptions(page);
  const receipt = page.getByRole('region', { name: 'Answerability checks' });
  await expect(receipt).toContainText('Unique fully correct option: A.');
  await expect(receipt).toContainText('Proposed answer key: A. Independently resolved answer key: A.');
  await expect(receipt.locator('[data-answerability-option]')).toHaveCount(4);
  await expect(receipt).toContainText('Answer as written: All risk disappears.');
  await expect(receipt).toContainText('Exclusion basis: Source contradiction');
  await expect(receipt).toContainText('Exclusion: The source retains systematic risk.');
  await receipt.getByText('Recorded feedback · separate from answer', { exact: true }).nth(1).click();
  await expect(receipt).toContainText(options[1].explanation);
  await receipt.getByText('Source quotations (1)', { exact: true }).click();
  expect(await receipt.locator('blockquote').textContent()).toBe('Diversification does not remove systematic risk.'); readOnly(state);
});

test('two fully correct options are explicitly ambiguous and withheld', async ({ page }) => {
  const quality = assessment(), answer = quality.answerability!; if (answer.kind !== 'mcq') throw new Error('MCQ fixture');
  answer.status = 'withheld'; delete answer.resolvedCorrectKey; answer.options[1].verdict = 'fully-correct';
  answer.issues = [{ path: 'options', code: 'multiple-fully-correct-options' }];
  const state = await fixture(page, quality);
  await expect(page.getByRole('region', { name: 'Answerability checks' })).toContainText('Ambiguous answer set: 2 options were assessed as fully correct.');
  await expect(page.getByText('Unique fully correct option:', { exact: false })).toHaveCount(0);
  await page.getByText('Recorded issues (1)', { exact: true }).click(); await expect(page.getByText('options: multiple-fully-correct-options', { exact: true })).toBeVisible(); readOnly(state);
});

test('an uncertain option remains unresolved, with the explicit stem condition retained', async ({ page }) => {
  const quality = assessment(), answer = quality.answerability!; if (answer.kind !== 'mcq') throw new Error('MCQ fixture');
  answer.status = 'withheld'; delete answer.resolvedCorrectKey; answer.options[1] = { ...answer.options[1], verdict: 'undetermined', exclusionBasis: 'undetermined', exclusion: 'The stem does not provide a condition that excludes this option.', stemQuote: 'Which risk remains after diversification?' };
  const state = await fixture(page, quality); await openOptions(page);
  await expect(page.getByText('No unique answer resolved.', { exact: true })).toBeVisible();
  await expect(page.getByText('Option B · Undetermined', { exact: true })).toBeVisible();
  await expect(page.getByText('Exclusion basis: Undetermined', { exact: true })).toBeVisible();
  expect(await page.locator('[data-answerability-option="B"] blockquote').textContent()).toBe('Which risk remains after diversification?'); readOnly(state);
});

test('no fully correct option does not invent a correct answer', async ({ page }) => {
  const quality = assessment(), answer = quality.answerability!; if (answer.kind !== 'mcq') throw new Error('MCQ fixture');
  answer.status = 'withheld'; delete answer.resolvedCorrectKey; answer.options.forEach(row => { row.verdict = 'not-fully-correct'; });
  const state = await fixture(page, quality); await expect(page.getByText('No unique answer resolved.', { exact: true })).toBeVisible(); readOnly(state);
});

test('a different independently resolved key stays visible alongside the proposed key and withholding', async ({ page }) => {
  const quality = assessment(), answer = quality.answerability!; if (answer.kind !== 'mcq') throw new Error('MCQ fixture');
  answer.status = 'withheld'; answer.keyedOptionKey = 'B'; answer.issues = [{ path: 'keyedOptionKey', code: 'key-does-not-match-literal-answer' }];
  const state = await fixture(page, quality); await expect(page.getByRole('region', { name: 'Answerability checks' })).toContainText('Proposed answer key: B. Independently resolved answer key: A.');
  await expect(page.getByText('Withheld by recorded check', { exact: true })).toBeVisible(); readOnly(state);
});

test('true/false uses the recorded literal truth and resolved shuffled key, not option position', async ({ page }) => {
  const quality = assessment(); quality.answerability = { protocol: 'option-answerability-v1', kind: 'true-false', status: 'passed', keyedOptionKey: 'B', resolvedCorrectKey: 'B', stemTruth: 'false', reason: 'The statement claims all risk disappears, which contradicts the source.', citations: [], issues: [] };
  quality.candidate = { ...quality.candidate!, type: 'true-false', stem: 'Diversification removes all market risk.', options: [{ key: 'A', text: 'True', role: 'common-misconception', explanation: 'Systematic risk remains.' }, { key: 'B', text: 'False', role: 'correct', explanation: 'Systematic risk remains.' }] };
  const state = await fixture(page, quality); await expect(page.getByText('Literal statement truth: False', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Answerability checks' })).toContainText('Proposed answer key: B. Independently resolved answer key: B.');
  await expect(page.locator('[data-answerability-option]')).toHaveCount(0); readOnly(state);
});

test('undetermined true/false truth remains withheld without guessing a truth value', async ({ page }) => {
  const quality = assessment(); quality.answerability = { protocol: 'option-answerability-v1', kind: 'true-false', status: 'withheld', stemTruth: 'undetermined', reason: 'A necessary statement premise is missing.', citations: [], issues: [] };
  const state = await fixture(page, quality); await expect(page.getByText('Literal statement truth: Undetermined', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Answerability checks' })).toContainText('Independently resolved answer key: unresolved.'); readOnly(state);
});

test('historical absent answerability is explicitly not recorded and does not initiate new work', async ({ page }) => {
  const quality = assessment(); delete quality.answerability; const state = await fixture(page, quality);
  await expect(page.getByText('Not recorded for this assessment. Historical checks do not establish a unique answer.', { exact: true })).toBeVisible();
  await expect(page.getByText('Passed recorded check', { exact: true })).toHaveCount(0); expect(state.requests).toHaveLength(0); readOnly(state);
});

test('missing candidate text never substitutes current mutable question content', async ({ page }) => {
  const quality = assessment(); delete quality.candidate; const state = await fixture(page, quality); await openOptions(page);
  await expect(page.getByText('Answer as written: Answer text not retained in this receipt.', { exact: true })).toHaveCount(4); readOnly(state);
});

test('hostile option/reason/exclusion/source/issue strings remain literal text', async ({ page }) => {
  const quality = assessment(), answer = quality.answerability!; if (answer.kind !== 'mcq') throw new Error('MCQ fixture');
  const hostile = '<img src=x onerror="window.answerabilityInjected=true"><script>window.answerabilityInjected=true</script>';
  quality.candidate!.options[0].text = hostile; quality.candidate!.options[0].explanation = hostile;
  answer.options[0] = { ...answer.options[0], reason: hostile, exclusion: hostile, stemQuote: hostile, citations: [{ kind: 'premise', claim: hostile, passageId: 'S1.P1', quote: hostile }] }; answer.issues = [{ path: hostile, code: hostile }];
  const state = await fixture(page, quality); await openOptions(page); await page.getByText('Source quotations (1)', { exact: true }).click();
  expect(await page.locator('blockquote').allTextContents()).toEqual([hostile, hostile]);
  await expect(page.locator('main img, main script')).toHaveCount(0); expect(await page.evaluate(() => 'answerabilityInjected' in window)).toBe(false); readOnly(state);
});

test('compiled generation workbench includes the receipt in existing check details without generation calls', async ({ page }) => {
  const state = await fixture(page, assessment(), 'generation'); await expect(page.getByRole('dialog')).toContainText('Unique fully correct option: A.');
  await page.getByRole('dialog').screenshot({ path: join(output, 'desktop-generation-check-details.png') }); readOnly(state);
});

test('compiled regeneration restores the receipt inside Source and memory checks using read-only recovery', async ({ page }) => {
  const state = await fixture(page, assessment(), 'regeneration'); await expect(page.getByRole('region', { name: 'Answerability checks' })).toContainText('Unique fully correct option: A.');
  await page.getByRole('region', { name: 'Answerability checks' }).screenshot({ path: join(output, 'desktop-regeneration-answerability.png') });
  expect(state.requests.some(row => row.path.endsWith(`/regeneration-candidates/${CANDIDATE}`))).toBe(true); readOnly(state);
});

for (const [name, width, theme] of [['desktop-light', 1440, 'light'], ['mobile-dark', 390, 'dark']] as const) {
  test(`compiled ${name} literal-answer checks pass scoped axe and remain readable`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); const quality = assessment();
    quality.candidate!.options[1].text = `A literal unsupported claim ${'long-unbroken-source-value'.repeat(12)}`;
    const state = await fixture(page, quality); await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await openOptions(page); await page.getByText('Source quotations (1)', { exact: true }).click();
    const scan = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze(); expect(scan.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('main').screenshot({ path: join(output, `${name}-answerability.png`) });
    await writeFile(join(output, `${name}-axe.json`), JSON.stringify({ synthetic: true, violations: scan.violations, passes: scan.passes.length, requests: state.requests, external: state.external, pageErrors: state.errors }, null, 2)); readOnly(state);
  });
}
