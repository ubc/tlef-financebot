import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createBlindReview, renderReviewHtml } from '../../scripts/prompt-ab/evaluation/review';
import { DatasetSchema, hashValue, type EvaluationQuestion, type ReviewFile, type TeacherLabel } from '../../scripts/prompt-ab/evaluation/schema';

const url = 'http://review.local/offline-review';
async function fixture(page: Page, malicious = false) {
  const content: EvaluationQuestion = { type: 'mcq',
    stem: malicious ? '</script><script>window.pwned=true</script><img src="https://attacker.invalid/x">' : 'Which input measures systematic risk in CAPM? Use $beta_i$.',
    options: [{ key: 'A', text: 'Beta', role: 'correct', explanation: 'Beta measures systematic risk.' }, { key: 'B', text: 'Total volatility', role: 'common-misconception', explanation: 'Total volatility includes diversifiable risk.' }],
  };
  const context = { objective: 'Use the supplied CAPM relationship and notation.',
    request: { type: 'mcq', difficulty: 'easy', count: 3, instruction: 'Use source notation.' },
    sources: [{ id: 'original-private-source', role: 'primary', text: 'CAPM uses beta_i for systematic risk. R_f is the annual risk-free return.' }],
    bank: [{ id: 'original-private-question', content: { ...content, stem: 'What does systematic risk mean?' } }],
    coverage: { sourcesComplete: false, bankComplete: false, notes: ['private-model-verdict'] },
  };
  const input = DatasetSchema.parse({ schemaVersion: 'financebot-quality-evaluation-v1', experimentId: 'original-private-experiment', origin: 'synthetic', rubricVersion: 'financebot-teacher-v1',
    cases: [{ caseId: 'original-private-case', repetitions: 1, context }],
    runs: [{ runId: 'original-private-run', caseId: 'original-private-case', repetition: 1, policy: 'grounded-memory-v1', contextHash: hashValue(context),
      comparison: { contextTiming: 'synthetic', isolated: true, controlsHash: hashValue('controls') }, requestedSlots: 3,
      slots: [0, 1, 2].map(item => ({ item, outcome: item === 2 ? 'missing' : 'withheld', candidate: item === 2 ? null : { content, contentHash: hashValue(content), truncated: false },
        automatic: { sourceScope: 'fail', notation: 'pass', duplication: 'uncertain', gate: 'withheld' }, numerical: 'not-applicable', limitations: ['private-automatic-reason'] })),
      usage: { status: 'unavailable', inputTokens: null, outputTokens: null, totalTokens: null, observedCalls: 0, unknownCalls: 0, pendingCalls: 0, coverageGaps: 1, untracked: true }, elapsedMs: null, limitations: [] }], limitations: [] });
  const result = createBlindReview(input);
  // Predictable test navigation changes only presentation order, never content hashes.
  result.bundle.cards.sort((a, b) => Number(b.reviewable) - Number(a.reviewable) || a.earlierCandidates.length - b.earlierCandidates.length);
  const html = renderReviewHtml(result.bundle, result.reviews);
  const requests: string[] = []; page.on('request', request => requests.push(request.url()));
  await page.route('**/*', route => route.request().url() === url ? route.fulfill({ contentType: 'text/html', body: html }) : route.abort());
  const open = async () => { await page.goto(url); await expect(page.getByRole('heading', { name: 'Blinded question review', exact: true })).toBeVisible(); };
  await open();
  return { ...result, open, requests };
}
async function downloaded(page: Page): Promise<ReviewFile> {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download review JSON', exact: true }).click();
  const path = await (await download).path();
  return JSON.parse(readFileSync(path!, 'utf8')) as ReviewFile;
}
const imported = (page: Page, value: unknown) => page.getByLabel('Resume previous reviews').setInputFiles({ name: 'previous.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });

test('manual judgments and time export, resume and preserve conflicting entries', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  const state = await fixture(page);
  await page.screenshot({ path: '/tmp/financebot-blind-review-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/financebot-blind-review-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.clock.install(); await page.clock.fastForward(180000);
  await expect(page.getByLabel('Active review minutes', { exact: false })).toHaveValue('');
  expect((await downloaded(page)).labels).toEqual([]);
  await page.getByLabel('Reviewer ID', { exact: true }).fill('teacher-a');
  await page.getByLabel('Source scope issue', { exact: false }).selectOption('absent');
  await page.getByLabel('Notation issue', { exact: false }).selectOption('uncertain');
  await page.getByLabel('Duplicate learning task issue', { exact: false }).selectOption('present');
  await page.getByLabel('Difficulty issue', { exact: false }).selectOption('absent');
  await page.getByLabel('Answer quality issue', { exact: false }).selectOption('absent');
  await page.getByLabel('Disposition', { exact: true }).selectOption('intentional-variant');
  await page.getByLabel('Active review minutes', { exact: false }).fill('2.75');
  await page.getByLabel('Evidence references', { exact: false }).fill('S1, Q1');
  await page.getByLabel('Notes', { exact: true }).fill('Same learning task with a new numerical context.');
  const saved = await downloaded(page);
  expect(saved.labels).toHaveLength(1);
  expect(saved.labels[0]).toMatchObject({ sourceScope: 'absent', notation: 'uncertain', duplication: 'present', difficulty: 'absent', answerQuality: 'absent', disposition: 'intentional-variant', reviewMinutes: 2.75, evidenceRefs: ['S1', 'Q1'] });
  expect(JSON.stringify(saved)).not.toContain('original-private');
  await page.getByRole('button', { name: 'Next card', exact: true }).click();
  await expect(page.getByLabel('Active review minutes', { exact: false })).toHaveValue('');
  await expect(page.getByLabel('Source scope issue', { exact: false })).toHaveValue('');
  await state.open(); await imported(page, saved);
  await expect(page.getByRole('status')).toContainText('Previous reviews merged');
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue('Same learning task with a new numerical context.');
  await expect(page.getByLabel('Active review minutes', { exact: false })).toHaveValue('2.75');
  await imported(page, { ...saved, labels: [{ ...saved.labels[0], notes: 'A conflicting note.' }] });
  await expect(page.getByRole('status')).toContainText('Conflicting reviews require separate adjudication');
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue(saved.labels[0].notes);
  await imported(page, { ...saved, labels: [saved.labels[0], saved.labels[0]] });
  await expect(page.getByRole('status')).toContainText('Duplicate or malformed');
  await imported(page, { ...saved, labels: [{ ...saved.labels[0], reviewHash: hashValue('stale') }] });
  await expect(page.getByRole('status')).toContainText('content hash is stale');
  expect((await downloaded(page)).labels).toEqual(saved.labels);
});

test('incomplete cards permit triage only; invalid time and references block export', async ({ page }) => {
  const state = await fixture(page);
  await page.getByLabel('Reviewer ID', { exact: true }).fill('teacher-a');
  await page.getByLabel('Active review minutes', { exact: false }).fill('-1');
  await page.getByRole('button', { name: 'Next card', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Correct the active review minutes');
  await expect(page.locator('#position')).toContainText('Card 1 of 3');
  await page.getByLabel('Active review minutes', { exact: false }).fill('');
  await page.getByRole('button', { name: 'Next card', exact: true }).click();
  await page.getByRole('button', { name: 'Next card', exact: true }).click();
  await expect(page.getByLabel('Source scope issue', { exact: false })).toBeDisabled();
  expect(await page.getByLabel('Disposition', { exact: true }).locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual(['', 'unresolved', 'source-shortfall']);
  await page.getByLabel('Disposition', { exact: true }).selectOption('source-shortfall');
  await page.getByLabel('Active review minutes', { exact: false }).fill('0');
  await page.getByLabel('Notes', { exact: true }).fill('No candidate snapshot was available to inspect.');
  await page.getByLabel('Evidence references', { exact: false }).fill('S99');
  await page.getByRole('button', { name: 'Download review JSON', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Evidence references must identify');
  await page.getByLabel('Evidence references', { exact: false }).fill('S1');
  const saved = await downloaded(page); const triage = saved.labels.find(label => label.disposition === 'source-shortfall')!;
  expect(triage).toMatchObject({ sourceScope: null, notation: null, duplication: null, difficulty: null, answerQuality: null, reviewMinutes: 0, evidenceRefs: ['S1'] });
  const card = state.bundle.cards.find(row => !row.reviewable)!;
  const positive: TeacherLabel = { ...triage, reviewId: card.reviewId, reviewHash: card.reviewHash, disposition: 'accepted' };
  await imported(page, { ...state.reviews, reviewerId: 'teacher-a', labels: [positive] });
  await expect(page.getByRole('status')).toContainText('Incomplete cards permit triage');
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue(triage.notes);
});

test('hostile text stays literal; sources, bank and earlier candidates are accessible offline', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  const state = await fixture(page, true);
  await expect(page.locator('#card')).toContainText('</script><script>window.pwned=true</script>');
  expect(await page.evaluate(() => (window as unknown as { pwned?: boolean }).pwned)).toBeUndefined();
  expect(await page.locator('img').count()).toBe(0);
  await page.getByText('Inspect sources (1)', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'S1 · primary', exact: true })).toBeVisible();
  await page.getByText('Inspect question bank (1)', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Q1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next card', exact: true }).click();
  await page.getByText('Inspect earlier batch candidates (1)', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'B1', exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: '/tmp/financebot-blind-review-hostile-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: '/tmp/financebot-blind-review-hostile-mobile.png', fullPage: true });
  expect(state.requests).toEqual([url]);
});

test('entered notes require an assigned reviewer and blank identity is rejected on import and export', async ({ page }) => {
  const state = await fixture(page);
  await page.getByLabel('Notes', { exact: true }).fill('Manual source check pending.');
  await page.getByRole('button', { name: 'Download review JSON', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Assign an anonymized reviewer identifier');
  await page.getByLabel('Reviewer ID', { exact: true }).fill('   ');
  await page.getByRole('button', { name: 'Download review JSON', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Reviewer identifier cannot be blank');
  await imported(page, { ...state.reviews, reviewerId: '   ' });
  await expect(page.getByRole('status')).toContainText('Reviewer identifier cannot be blank');
  await page.getByLabel('Reviewer ID', { exact: true }).fill('teacher-a');
  const saved = await downloaded(page);
  expect(saved.labels[0]).toMatchObject({ sourceScope: null, disposition: null, reviewMinutes: null, notes: 'Manual source check pending.' });
  await imported(page, { ...saved, reviewerId: 'unassigned' });
  await expect(page.getByRole('status')).toContainText('Assign an anonymized reviewer identifier');
  await expect(page.getByLabel('Reviewer ID', { exact: true })).toHaveValue('teacher-a');
});
