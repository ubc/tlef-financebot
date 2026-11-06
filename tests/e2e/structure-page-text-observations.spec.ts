import { test, expect, type Page, type Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { PdfPageTextObservationSummary, StructureResult } from '../../client/src/api';

/** Explicitly synthetic rendering fixtures. The 599-page scale is fixed; these
 * text states are not the observed corpus, model judgments or teacher labels. */
const courseId = '000000000000000000000099';
const chapters = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];
const pageCounts = [84, 21, 111, 87, 43, 90, 46, 40, 36, 41];
const materialId = (index: number) => (index + 1).toString(16).padStart(24, '0');
const provenanceId = (index: number) => (index + 100).toString(16).padStart(24, '0');
const tenth = materialId(chapters.indexOf(10));
const physicalRows = (root: Locator) => root.locator('tr[data-physical-page]');
const pageRange = (root: Locator) => root.getByRole('status').filter({ hasText: /physical pages? · Page/ });
const selectTenth = (root: Locator, label = 'UI-only Chapter 10.pdf') => root.getByLabel('Page source file', { exact: true }).selectOption({ label });

function observation(total: number): PdfPageTextObservationSummary {
  return { version: 'native-page-text-observations-v1', status: 'available', interpretation: 'unknown', teachingCoverage: 'not-assessed',
    pdfSha256: 'a'.repeat(64), rawTextSha256: 'b'.repeat(64), pageMapSha256: 'c'.repeat(64), observationsSha256: 'd'.repeat(64), sparseThreshold: 120,
    counts: { total, blank: 1, sparse: 1, present: total - 2 },
    ranges: [{ startPage: 1, endPage: 1, state: 'blank' }, { startPage: 2, endPage: 9, state: 'present' },
      { startPage: 10, endPage: 10, state: 'sparse' }, { startPage: 11, endPage: total, state: 'present' }] };
}
function fixture(): StructureResult {
  const materials = chapters.map((chapter, index) => ({ materialId: materialId(index), name: `UI-only Chapter ${chapter}.pdf`, chunks: 31, sections: 31, mappedObjectives: chapter === 10 ? 1 : 0 }));
  return { themes: [{ name: 'UI-only dividend topic', los: [{ name: 'UI-only formula from the adjacent page', evidenceIds: ['E785'], materialIds: [tenth] }] }],
    evidence: [{ id: 'E785', objective: 'UI-only formula from the adjacent page', materialId: tenth, materialName: materials[7].name, chunkIndex: 30,
      sourcePassageId: 'C31.S1.P1', quote: 'UI-only footer on page 10.\fDividend Payout = Dividends / Net Income on page 11.' }],
    coverage: { materials, analyzedSections: 310, extractedObjectives: 1, mappedObjectives: 1, unmappedEvidenceIds: [], excludedSections: [], warnings: [],
      sourceInventory: { version: 'source-passage-inventory-v1', totalPassages: 1, objectiveLinkedPassages: 1, mappedPassages: 1,
        targets: [{ materialId: tenth, materialName: materials[7].name, chunkIndex: 30, sectionId: 'C31.S1', passageId: 'C31.S1.P1', cues: ['formula'], status: 'mapped', evidenceIds: ['E785'],
          quote: 'UI-only adjacent formula and footer in the same chunk.' }], materialsWithoutMappedObjectives: materials.filter(row => row.materialId !== tenth).map(row => row.materialId),
        potentialRedundantObjectives: [], redundancyAudit: { objectivesConsidered: 1, totalObjectives: 1, truncated: false } },
      pageTextObservations: { version: 'pdf-page-text-obligations-v1', materials: materials.map((material, index) => ({ materialId: material.materialId,
        materialName: material.name, provenanceId: provenanceId(index), observation: observation(pageCounts[index]) })) } } };
}
async function mount(page: Page, result: StructureResult) {
  const api: Array<{ method: string; path: string }> = []; const external: string[] = []; const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:6167') { external.push(url.href); return route.abort('blockedbyclient'); }
    if (url.pathname === '/page-text-fixture') return route.fulfill({ contentType: 'text/html',
      body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mocked physical-page text receipt</title><link rel="stylesheet" href="/styles/main.css"></head><body><main style="padding:16px"><h1>Mocked physical-page text receipt</h1></main></body></html>' });
    if (!url.pathname.startsWith('/api/')) return route.continue();
    api.push({ method: request.method(), path: url.pathname + url.search });
    return route.fulfill({ status: 405, json: { error: 'All app APIs are refused in this rendering-only fixture.' } });
  });
  await page.goto('/page-text-fixture');
  await page.evaluate(async snapshot => {
    const { createStructureSourceCoverage } = await import('/js/views/instructor/structure-source-coverage.js');
    document.querySelector('main')!.append(createStructureSourceCoverage('000000000000000000000099', snapshot));
  }, result);
  const root = page.getByRole('region', { name: 'Physical-page text observations', exact: true });
  await expect(root).toBeVisible();
  return { root, api, external, errors };
}
function readOnly(state: Awaited<ReturnType<typeof mount>>) {
  expect(state.api).toEqual([]); expect(state.external).toEqual([]); expect(state.errors).toEqual([]);
}

test('synthetic fixed ten-file fixture has 599 physical pages independent of one mapped learning point', () => {
  const snapshot = fixture();
  expect(snapshot.coverage.materials).toHaveLength(10);
  expect(snapshot.coverage.pageTextObservations!.materials.reduce((sum, source) => sum + (source.observation.status === 'available' ? source.observation.counts.total : 0), 0)).toBe(599);
  expect(snapshot.coverage.mappedObjectives).toBe(1);
  expect(snapshot.coverage.sourceInventory!.targets[0]).toMatchObject({ chunkIndex: 30, status: 'mapped', evidenceIds: ['E785'] });
});

test('compiled mocked sparse page10 stays reviewable despite a mapped adjacent-page formula and links to the exact provenance-bound physical page', async ({ page }) => {
  const state = await mount(page, fixture()); const { root } = state;
  await selectTenth(root);
  const row = root.locator(`tr[data-page-material-id="${tenth}"][data-physical-page="10"]`);
  await expect(row).toHaveAttribute('data-page-text-state', 'sparse'); await expect(row).toBeVisible();
  await expect(row.getByRole('link', { name: 'Open original physical page', exact: true })).toHaveAttribute('href', `/api/courses/${courseId}/materials/${tenth}/source?provenanceId=${provenanceId(7)}#page=10`);
  await expect(row.getByRole('link')).toHaveAttribute('rel', 'noopener');
  await expect(root).toContainText(/not assessed|not-assessed|unknown/i);
  await expect(pageRange(root)).toHaveText('1–2 of 2 physical pages · Page 1 of 1');
  readOnly(state);
});

test('compiled mocked 599-page receipt keeps DOM bounded and enumerates each source/page once across 10/25/50 pagination', async ({ page }) => {
  test.setTimeout(60_000);
  const state = await mount(page, fixture()); const { root } = state;
  await expect(pageRange(root)).toHaveText('1–10 of 20 physical pages · Page 1 of 2');
  await expect(physicalRows(root)).toHaveCount(10);
  await expect(root.getByRole('button', { name: 'Previous physical-page result' })).toBeDisabled();
  await root.getByRole('button', { name: 'Next physical-page result' }).click();
  await expect(pageRange(root)).toHaveText('11–20 of 20 physical pages · Page 2 of 2');
  await root.getByLabel('Page text signal', { exact: true }).selectOption('all');
  await root.getByLabel('Physical pages per page', { exact: true }).selectOption('25'); await expect(physicalRows(root)).toHaveCount(25);
  await root.getByLabel('Physical pages per page', { exact: true }).selectOption('50');
  const seen: string[] = [];
  for (let index = 0; index < 12; index++) {
    const ids = await physicalRows(root).evaluateAll(rows => rows.map(row => `${row.getAttribute('data-page-material-id')}:${row.getAttribute('data-physical-page')}`));
    expect(ids.length).toBeLessThanOrEqual(50); seen.push(...ids);
    if (index < 11) await root.getByRole('button', { name: 'Next physical-page result' }).click();
  }
  expect(seen).toHaveLength(599); expect(new Set(seen).size).toBe(599);
  await expect(pageRange(root)).toHaveText('551–599 of 599 physical pages · Page 12 of 12');
  await expect(root.getByRole('button', { name: 'Next physical-page result' })).toBeDisabled();
  await root.getByText('Physical-page counts by file', { exact: true }).click();
  const cells = await root.getByRole('table', { name: 'Physical-page source counts', exact: true }).locator('tbody tr').evaluateAll(rows => rows.map(row => Array.from(row.querySelectorAll('td')).map(cell => cell.textContent)));
  expect(cells).toHaveLength(10);
  readOnly(state);
});

test('compiled mocked page search and filters reset pagination without losing present pages or empty-state meaning', async ({ page }) => {
  const state = await mount(page, fixture()); const { root } = state;
  await root.getByRole('button', { name: 'Next physical-page result' }).click();
  await selectTenth(root);
  await expect(pageRange(root)).toHaveText('1–2 of 2 physical pages · Page 1 of 1');
  await root.getByLabel('Page text signal', { exact: true }).selectOption('present');
  await expect(pageRange(root)).toHaveText('1–10 of 38 physical pages · Page 1 of 4');
  await expect(root.locator('[data-page-text-state="sparse"]')).toHaveCount(0);
  await root.getByLabel('Search physical pages', { exact: true }).fill('no-such-ui-source');
  await expect(physicalRows(root)).toHaveCount(0); await expect(pageRange(root)).toHaveText('0–0 of 0 physical pages · Page 1 of 1');
  await root.getByLabel('Search physical pages', { exact: true }).fill('');
  await root.getByLabel('Page text signal', { exact: true }).selectOption('sparse');
  await expect(pageRange(root)).toHaveText('1–1 of 1 physical page · Page 1 of 1');
  readOnly(state);
});

test('compiled mocked historical absence remains unavailable rather than zero visual gaps', async ({ page }) => {
  const snapshot = fixture(); delete snapshot.coverage.pageTextObservations;
  const state = await mount(page, snapshot);
  await expect(state.root).toContainText('Physical-page text observations are unavailable for this historical run.');
  await expect(physicalRows(state.root)).toHaveCount(0);
  await expect(state.root.getByRole('link')).toHaveCount(0);
  await expect(state.root.getByRole('table', { name: 'Physical-page source counts' })).toHaveCount(0);
  readOnly(state);
});

test('compiled mocked historical per-file absence is shown as unavailable with no invented page rows', async ({ page }) => {
  const snapshot = fixture(); snapshot.coverage.pageTextObservations!.materials[7].observation = {
    version: 'native-page-text-observations-v1', status: 'unavailable', reason: 'This source has no retained native page observations.', interpretation: 'unknown', teachingCoverage: 'not-assessed',
  };
  const state = await mount(page, snapshot);
  await expect(state.root).toContainText(/unavailable/i);
  await expect(state.root.locator(`[data-page-material-id="${tenth}"]`)).toHaveCount(0);
  readOnly(state);
});

for (const mode of ['missing', 'malformed'] as const) {
  test(`compiled mocked ${mode} provenance keeps valid text counts but disables original-page actions`, async ({ page }) => {
    const snapshot = fixture(); const source = snapshot.coverage.pageTextObservations!.materials[7];
    if (mode === 'missing') delete source.provenanceId; else source.provenanceId = '../foreign-path';
    const state = await mount(page, snapshot); const { root } = state;
    await selectTenth(root);
    await expect(pageRange(root)).toHaveText('1–2 of 2 physical pages · Page 1 of 1');
    await expect(physicalRows(root)).toHaveCount(2); await expect(physicalRows(root).getByRole('link')).toHaveCount(0);
    readOnly(state);
  });
}

for (const mode of ['range-gap', 'range-overlap', 'count-conflict', 'identity', 'duplicate-source', 'foreign-source', 'missing-source'] as const) {
  test(`compiled mocked ${mode} receipt cannot silently publish trusted page counts/actions`, async ({ page }) => {
    const snapshot = fixture(); const batch = snapshot.coverage.pageTextObservations!; const source = batch.materials[7]; const row = source.observation;
    if (row.status !== 'available') throw new Error('Fixture needs available observations');
    if (mode === 'range-gap') row.ranges[1].startPage = 3;
    if (mode === 'range-overlap') row.ranges[2].startPage = 9;
    if (mode === 'count-conflict') row.counts.present++;
    if (mode === 'identity') row.pdfSha256 = 'not-a-pdf-hash';
    if (mode === 'duplicate-source') batch.materials.push(structuredClone(source));
    if (mode === 'foreign-source') source.materialId = 'f'.repeat(24);
    if (mode === 'missing-source') batch.materials.splice(7, 1);
    const state = await mount(page, snapshot);
    await expect(state.root).toContainText(/unavailable|inconsistent|conflict|missing/i);
    await expect(state.root.locator(`tr[data-page-material-id="${tenth}"]`)).toHaveCount(0);
    if (mode === 'foreign-source') await expect(state.root.locator('tr[data-page-material-id="ffffffffffffffffffffffff"]')).toHaveCount(0);
    readOnly(state);
  });
}

for (const [name, width, theme] of [['desktop-light', 1440, 'light'], ['mobile-dark', 390, 'dark']] as const) {
  test(`compiled mocked ${name} page observations have bounded layout, literal source names and scoped axe`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const snapshot = fixture(); snapshot.coverage.pageTextObservations!.materials[7].materialName = 'UI-only <img src=x onerror="window.pageReceiptInjected=true">.pdf';
    const state = await mount(page, snapshot); const { root } = state;
    await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
    await selectTenth(root, snapshot.coverage.pageTextObservations!.materials[7].materialName);
    await root.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => 'pageReceiptInjected' in window)).toBe(false); await expect(root.locator('img,script')).toHaveCount(0);
    expect((await new AxeBuilder({ page }).include('[aria-label="Physical-page text observations"]').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    await root.screenshot({ path: testInfo.outputPath(`${name}-mocked-physical-page-observations.png`) });
    readOnly(state);
  });
}
