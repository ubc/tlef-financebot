import { test, expect, type Page, type Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StructureResult } from '../../client/src/api';

/** These tests exercise compiled production UI with intercepted, content-sanitized
 * records. They do not run generation or establish semantic acceptance. */
const fixture = JSON.parse(readFileSync(join(__dirname, '../fixtures/structure-source-coverage-ten-files.json'), 'utf8')) as {
  provenance: { scope: string; authoritySha256: string; recordedBounds: Record<string, unknown> };
  result: StructureResult;
};
const courseId = 'coverage-fixture-course';
const regionName = 'Source coverage review';
const reviewRows = (root: Locator) => root.locator('[data-coverage-review-id]');
const tableRows = (root: Locator) => root.getByRole('table', { name: 'Source files', exact: true }).locator('tbody tr');
const range = (root: Locator) => root.getByRole('status').filter({ hasText: /review items? · Page/ });
const duplicate = () => structuredClone(fixture.result);

async function mountFixture(page: Page, result: StructureResult, throughWorkbench = false, runOverride?: Record<string, unknown>, summaryExpectation?: string | RegExp) {
  const requests: Array<{ method: string; path: string }> = [];
  const external: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    Object.assign(window, { EventSource: class { addEventListener() {} close() {} } });
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:6167') {
      external.push(url.origin);
      return route.abort('blockedbyclient');
    }
    if (url.pathname === '/fixture') return route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mocked source coverage UI</title><link rel="stylesheet" href="/styles/main.css"></head><body><main class="structure-ai"><h1>Mocked source coverage UI</h1></main></body></html>',
    });
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const method = route.request().method();
    requests.push({ method, path: url.pathname });
    if (method !== 'GET') return route.fulfill({ status: 405, json: { error: 'Read-only mocked UI fixture; no mutation is allowed.' } });
    if (url.pathname.endsWith('/workspace')) {
      const materialId = url.pathname.split('/').at(-2)!;
      const material = result.coverage.materials.find(item => item.materialId === materialId);
      const byChunk = new Map<number, string[]>();
      for (const point of result.evidence.filter(item => item.materialId === materialId)) {
        byChunk.set(point.chunkIndex, [...(byChunk.get(point.chunkIndex) ?? []), point.quote, ...(point.supportingPassages ?? []).map(passage => passage.quote)]);
      }
      for (const target of result.coverage.sourceInventory?.targets.filter(item => item.materialId === materialId) ?? []) {
        if (target.quote) byChunk.set(target.chunkIndex, [...(byChunk.get(target.chunkIndex) ?? []), target.quote]);
      }
      return route.fulfill({ json: {
        material: { _id: materialId, name: material?.name ?? 'Mocked original source', status: 'ready', assignments: [] },
        chunks: [...byChunk].map(([index, quotes]) => ({ index, text: quotes.join('\n'), characterCount: quotes.join('\n').length })),
      } });
    }
    if (url.pathname.endsWith('/content-runs')) return route.fulfill({ json: [{
      _id: 'coverage-fixture-run', courseId, kind: 'structure-generation', status: 'completed', stage: 'completed', revision: 1,
      completedUnits: 671, totalUnits: 671, input: { materialIds: result.coverage.materials.map(material => material.materialId) },
      warnings: [], createdAt: '2026-10-17T10:00:00.000Z', structureResult: result, ...runOverride,
    }] });
    if (url.pathname.endsWith('/materials')) return route.fulfill({ json: result.coverage.materials.map(material => ({
      _id: material.materialId, courseId, name: material.name, status: 'ready', format: 'pdf', assignments: [],
    })) });
    if (url.pathname.endsWith('/preseeding')) return route.fulfill({ json: [] });
    if (url.pathname === `/api/courses/${courseId}` || url.pathname.endsWith('/tree')) return route.fulfill({ json: { _id: courseId, name: 'Mocked ten-file course', themes: [] } });
    if (url.pathname.includes('/tutorials')) return route.fulfill({ json: [] });
    return route.fulfill({ json: [] });
  });
  await page.goto('/fixture');
  if (throughWorkbench) {
    await page.evaluate(async id => {
      const outlet = document.querySelector('main')!;
      // The real app outlet is not itself an AI composer grid.
      outlet.classList.remove('structure-ai');
      (await import('/js/views/instructor/structure.js')).renderStructure(outlet, { id });
    }, courseId);
    const summary = page.locator('.structure-ai-coverage > summary');
    await expect(summary).toContainText(summaryExpectation ?? (runOverride ? 'Outline incomplete' : '620/999 learning points mapped'));
    await expect(summary).toBeInViewport();
    await summary.click();
  } else {
    await page.evaluate(async ({ id, snapshot }) => {
      const { createStructureSourceCoverage } = await import('/js/views/instructor/structure-source-coverage.js');
      document.querySelector('main')!.append(createStructureSourceCoverage(id, snapshot));
    }, { id: courseId, snapshot: result });
  }
  const root = page.getByRole('region', { name: regionName, exact: true });
  await expect(root).toBeVisible();
  return { root, requests, external, errors };
}

function expectReadOnly(state: Awaited<ReturnType<typeof mountFixture>>) {
  expect(state.requests.every(request => request.method === 'GET')).toBe(true);
  expect(state.external).toEqual([]);
  expect(state.errors).toEqual([]);
}

test('mocked ten-file projection retains the recorded scale without depending on ignored audit receipts', () => {
  const result = fixture.result;
  expect(fixture.provenance.scope).toContain('not generation');
  expect(fixture.provenance.authoritySha256).toBe('492bce4a301999bcf719e326710b4363cdf7bb0561823751aafa49dd14a15edf');
  expect(result.coverage.materials).toHaveLength(10);
  expect(result.coverage.materials.reduce((sum, material) => sum + material.sections, 0)).toBe(671);
  expect(result.evidence).toHaveLength(999);
  expect(new Set(result.evidence.map(item => item.id)).size).toBe(999);
  expect(result.coverage.mappedObjectives).toBe(620);
  expect(result.coverage.unmappedEvidenceIds).toHaveLength(379);
  expect(result.themes).toHaveLength(30);
  expect(result.themes.reduce((sum, topic) => sum + topic.los.length, 0)).toBe(119);
  const inventory = result.coverage.sourceInventory!;
  expect(inventory.targets).toHaveLength(1238);
  for (const [status, expected] of [['mapped', 739], ['unmapped-objective', 348], ['visual-review', 136], ['context', 8], ['non-instructional', 7]] as const) {
    expect(inventory.targets.filter(target => target.status === status)).toHaveLength(expected);
  }
  expect(result.coverage.excludedSections).toHaveLength(73);
  expect(result.evidence.every(item => item.quote.startsWith('UI-only'))).toBe(true);
});

test('mocked large receipt paginates every gap and original decision with bounded DOM and consistent separate counts', async ({ page }) => {
  test.setTimeout(60_000);
  const state = await mountFixture(page, duplicate());
  const { root } = state;
  await expect(tableRows(root)).toHaveCount(10);
  const metrics = await tableRows(root).evaluateAll(rows => rows.map(row => Array.from(row.querySelectorAll('td')).map(cell => Number(cell.textContent?.replace(/,/g, '')))));
  expect(metrics.reduce((sum, cells) => sum + cells[0], 0)).toBe(671);
  expect(metrics.reduce((sum, cells) => sum + cells[1], 0)).toBe(999);
  expect(metrics.reduce((sum, cells) => sum + cells[2], 0)).toBe(620);
  expect(metrics.reduce((sum, cells) => sum + cells[3], 0)).toBe(379);
  expect(metrics.reduce((sum, cells) => sum + cells[4], 0)).toBe(136);
  await expect(root).toContainText('may refer to the same content');
  await expect(range(root)).toHaveText('1–10 of 727 review items · Page 1 of 73');
  await expect(reviewRows(root)).toHaveCount(10);
  await expect(root.getByRole('button', { name: 'Previous review page' })).toBeDisabled();
  await root.getByRole('button', { name: 'Next review page' }).click();
  await expect(range(root)).toHaveText('11–20 of 727 review items · Page 2 of 73');
  await root.getByLabel('Rows per page').selectOption('25');
  await expect(range(root)).toHaveText('1–25 of 727 review items · Page 1 of 30');
  await expect(reviewRows(root)).toHaveCount(25);
  await root.getByLabel('Rows per page').selectOption('50');
  await root.getByLabel('Review category').selectOption('all');
  const seen: string[] = [];
  for (let index = 0; index < 20; index++) {
    const ids = await reviewRows(root).evaluateAll(rows => rows.map(row => row.getAttribute('data-coverage-review-id')!));
    expect(ids.length).toBeLessThanOrEqual(50);
    seen.push(...ids);
    if (index === 19) {
      await expect(range(root)).toHaveText('951–951 of 951 review items · Page 20 of 20');
      await expect(root.getByRole('button', { name: 'Next review page' })).toBeDisabled();
    } else await root.getByRole('button', { name: 'Next review page' }).click();
  }
  expect(seen).toHaveLength(951);
  expect(new Set(seen).size).toBe(951);
  expect(seen.filter(id => id.startsWith('point:'))).toHaveLength(379);
  expect(seen.filter(id => id.startsWith('passage:'))).toHaveLength(499);
  expect(seen.filter(id => id.startsWith('section:'))).toHaveLength(73);
  await root.getByLabel('Review category').selectOption('visual');
  await expect(range(root)).toHaveText('1–50 of 136 review items · Page 1 of 3');
  await root.getByLabel('Review category').selectOption('other');
  await expect(range(root)).toHaveText('1–50 of 88 review items · Page 1 of 2');
  expectReadOnly(state);
});

test('mocked search includes late-page quotes and IDs, combines file/category filters and resets pagination', async ({ page }) => {
  const snapshot = duplicate();
  const state = await mountFixture(page, snapshot);
  const { root } = state;
  const lastId = snapshot.coverage.unmappedEvidenceIds.at(-1)!;
  const point = snapshot.evidence.find(item => item.id === lastId)!;
  await root.getByRole('button', { name: 'Next review page' }).click();
  await root.getByLabel('Search source coverage').fill(`UI-ONLY LEARNING POINT ${lastId} FROM`);
  await expect(range(root)).toContainText('Page 1 of');
  await expect(root.locator(`[data-coverage-review-id="point:${lastId}"]`)).toBeVisible();
  await root.getByLabel('Source file', { exact: true }).selectOption(snapshot.coverage.materials.find(item => item.materialId !== point.materialId)!.materialId);
  await expect(range(root)).toHaveText('0–0 of 0 review items · Page 1 of 1');
  await expect(root.getByText('No review items match these filters.', { exact: false })).toBeVisible();
  await root.getByRole('button', { name: 'Clear filters' }).click();
  await expect(root.getByLabel('Search source coverage')).toHaveValue('');
  await expect(root.getByLabel('Source file', { exact: true })).toHaveValue('');
  await expect(root.getByLabel('Review category')).toHaveValue('all');
  await expect(range(root)).toHaveText('1–10 of 951 review items · Page 1 of 96');
  const material = snapshot.coverage.materials[2];
  const expected = snapshot.coverage.unmappedEvidenceIds.filter(id => snapshot.evidence.find(item => item.id === id)?.materialId === material.materialId).length
    + snapshot.coverage.sourceInventory!.targets.filter(target => target.materialId === material.materialId && target.status !== 'mapped').length
    + snapshot.coverage.excludedSections.filter(section => section.materialId === material.materialId).length;
  await tableRows(root).filter({ hasText: material.name }).getByRole('button').click();
  await expect(root.getByLabel('Source file', { exact: true })).toHaveValue(material.materialId);
  await expect(range(root)).toContainText(`of ${expected} review items · Page 1`);
  await expect(reviewRows(root).first()).toContainText(material.name);
  await root.getByLabel('Search source coverage').fill('no-such-fixture-record');
  await expect(reviewRows(root)).toHaveCount(0);
  await expect(root.getByRole('button', { name: 'Previous review page' })).toBeDisabled();
  await expect(root.getByRole('button', { name: 'Next review page' })).toBeDisabled();
  expectReadOnly(state);
});

test('mocked original and exact-context actions bind the selected material and stored quote without writes', async ({ page }) => {
  const snapshot = duplicate();
  const target = snapshot.coverage.sourceInventory!.targets.find(item => item.status === 'visual-review')!;
  const state = await mountFixture(page, snapshot);
  const { root } = state;
  await root.getByLabel('Review category').selectOption('visual');
  await root.getByLabel('Source file', { exact: true }).selectOption(target.materialId);
  await root.getByLabel('Search source coverage').fill(target.passageId);
  const row = reviewRows(root).filter({ hasText: `Original passage ${target.passageId}` }).first();
  await row.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(row.locator('blockquote')).toHaveText(target.quote!);
  await expect(row.getByRole('link', { name: 'Open original source ↗' })).toHaveAttribute('href', `/api/courses/${courseId}/materials/${target.materialId}/source`);
  await expect(row.getByRole('link', { name: 'Open original source ↗' })).toHaveAttribute('rel', 'noopener');
  await row.getByRole('button', { name: 'Show passage in context' }).click();
  const dialog = page.getByRole('dialog', { name: 'Source evidence preview' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('mark')).toHaveText(target.quote!);
  await expect(dialog.getByRole('heading', { name: target.materialName, exact: true })).toBeVisible();
  expect(state.requests.filter(item => item.path.endsWith('/workspace'))).toEqual([{ method: 'GET', path: `/api/courses/${courseId}/materials/${target.materialId}/workspace` }]);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expectReadOnly(state);
});

test('mocked historical receipts keep missing inventory and missing gap records explicitly unavailable', async ({ page }) => {
  const snapshot = duplicate();
  delete snapshot.coverage.sourceInventory;
  const missingId = snapshot.coverage.unmappedEvidenceIds[0];
  snapshot.evidence = snapshot.evidence.filter(item => item.id !== missingId);
  const state = await mountFixture(page, snapshot);
  const { root } = state;
  await expect(root).toContainText('This historical draft has no passage inventory.');
  await expect(root).toContainText('Per-file extracted counts are unavailable.');
  await expect(root).toContainText('Some learning-point gap records are unavailable');
  const cells = await tableRows(root).first().locator('td').allTextContents();
  expect(cells[1]).toBe('Unavailable');
  expect(cells[3]).toBe('Unavailable');
  expect(cells[4]).toBe('Unavailable');
  expect(cells[5]).toBe('Unavailable');
  await expect(range(root)).toHaveText('1–10 of 379 review items · Page 1 of 38');
  await root.getByLabel('Search source coverage').fill(missingId);
  const row = root.locator(`[data-coverage-review-id="point:${missingId}"]`);
  await row.locator('summary').click();
  await expect(row).toContainText('Source unavailable');
  await expect(row).toContainText('Its source record is not available');
  await expect(row.getByRole('link', { name: 'Open original source ↗' })).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Show passage in context' })).toHaveCount(0);
  expectReadOnly(state);
});

test('mocked zero-extraction eleventh source remains visible on the second file page and never claims teaching coverage', async ({ page }) => {
  const snapshot = duplicate();
  const empty = { materialId: '999999999999999999999999', name: 'Synthetic zero-extraction appendix.pdf', sections: 12, chunks: 12, mappedObjectives: 0 };
  snapshot.coverage.materials.push(empty);
  snapshot.coverage.sourceInventory!.materialsWithoutMappedObjectives.push(empty.materialId);
  const state = await mountFixture(page, snapshot);
  const { root } = state;
  await expect(tableRows(root)).toHaveCount(10);
  await root.getByRole('button', { name: 'Next source page' }).click();
  await expect(tableRows(root)).toHaveCount(1);
  await expect(tableRows(root).first()).toContainText(empty.name);
  expect(await tableRows(root).first().locator('td').allTextContents()).toEqual(['12', '0', '0', '0', '0', '0']);
  await expect(root.getByRole('button', { name: 'Next source page' })).toBeDisabled();
  await tableRows(root).getByRole('button').click();
  await expect(root.getByLabel('Source file', { exact: true })).toHaveValue(empty.materialId);
  await expect(range(root)).toHaveText('0–0 of 0 review items · Page 1 of 1');
  await expect(root).toContainText('do not establish complete teaching coverage');
  expectReadOnly(state);
});

test('mocked unreviewed and hostile literal source records remain inspectable without executing their text', async ({ page }) => {
  const snapshot = duplicate();
  const target = snapshot.coverage.sourceInventory!.targets.find(item => item.status === 'visual-review')!;
  target.status = 'unreviewed';
  target.quote = '<img src="https://invalid.example/coverage-probe" onerror="window.coverageInjected=true"> & <script>window.coverageInjected=true</script>';
  target.reason = 'SYNTHETIC-UNREVIEWED-PROBE: no reviewer decision exists.';
  const state = await mountFixture(page, snapshot);
  const { root } = state;
  await root.getByLabel('Review category').selectOption('visual');
  await root.getByLabel('Search source coverage').fill('SYNTHETIC-UNREVIEWED-PROBE');
  await expect(reviewRows(root)).toHaveCount(1);
  await reviewRows(root).locator('summary').click();
  await expect(reviewRows(root)).toContainText('Unreviewed original passage');
  await expect(reviewRows(root).locator('blockquote')).toHaveText(target.quote);
  await expect(reviewRows(root).locator('img, script')).toHaveCount(0);
  expect(await page.evaluate(() => 'coverageInjected' in window)).toBe(false);
  expectReadOnly(state);
});

for (const [name, width, theme] of [['desktop-light', 1440, 'light'], ['mobile-dark', 390, 'dark']] as const) {
  test(`mocked ${name} coverage remains bounded, keyboard accessible and passes scoped WCAG scans`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const state = await mountFixture(page, duplicate());
    const { root } = state;
    await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
    await root.getByLabel('Review category').selectOption('visual');
    await reviewRows(root).first().locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(reviewRows(root).first().locator('blockquote')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include('.structure-source-coverage').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`${name}-mocked-source-coverage.png`), fullPage: true });
    expectReadOnly(state);
  });
}

test('mocked actual Course Structure workbench exposes the compact receipt and keeps coverage separate from local edits', async ({ page }, testInfo) => {
  const state = await mountFixture(page, duplicate(), true);
  const { root } = state;
  await expect(reviewRows(root)).toHaveCount(10);
  await expect(tableRows(root)).toHaveCount(10);
  const objective = page.getByRole('textbox', { name: 'Objective 1.1', exact: true });
  await objective.fill('Synthetic instructor edit does not rewrite the recorded coverage receipt.');
  await expect(page.locator('.structure-ai-coverage > summary')).toContainText('620/999 learning points mapped');
  await expect(range(root)).toHaveText('1–10 of 727 review items · Page 1 of 73');
  await page.locator('.structure-ai-coverage > summary').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('actual-workbench-mocked-source-coverage.png'), fullPage: false });
  expectReadOnly(state);
});


test('mocked partial passage inventory preserves uncertainty instead of turning missing original records into zero visual gaps', async ({ page }) => {
  const snapshot = duplicate();
  snapshot.coverage.sourceInventory!.targets.pop();
  const state = await mountFixture(page, snapshot);
  await expect(state.root).toContainText('The recorded passage list is incomplete or inconsistent with its receipt.');
  for (const row of await tableRows(state.root).all()) {
    const cells = await row.locator('td').allTextContents();
    expect(cells[4]).toBe('Unavailable');
    expect(cells[5]).toBe('Unavailable');
  }
  await state.root.getByLabel('Review category').selectOption('visual');
  await expect(range(state.root)).toContainText('136 review items');
  expectReadOnly(state);
});

test('mocked failed run exposes only retained processing diagnostics, with unavailable coverage and no applicable draft', async ({ page }, testInfo) => {
  const snapshot = duplicate();
  const unprocessed = Array.from({ length: 63 }, (_, index) => {
    const material = snapshot.coverage.materials[index % snapshot.coverage.materials.length];
    return { materialId: material.materialId, name: material.name, sectionId: `SYNTHETIC-UNPROCESSED-${index + 1}` };
  });
  const state = await mountFixture(page, snapshot, true, {
    status: 'failed', stage: 'failed', structureResult: undefined,
    error: { code: 'structure-analysis-invalid' },
    structureDiagnostics: {
      sourceSelection: { requested: snapshot.coverage.materials.map(material => ({
        materialId: material.materialId, name: material.name, ready: true, state: 'indexed', classification: 'warning',
      })), included: [], excluded: [], ready: true },
      cache: { hits: 0, misses: 63, reusedSections: 0, extractedSections: 0 },
      unprocessedSections: unprocessed,
    },
  });
  const { root } = state;
  await expect(root).toContainText('All learning-point and passage-coverage counts are unavailable.');
  await expect(root).toContainText('This run ended without a complete validated outline.');
  await expect(tableRows(root)).toHaveCount(10);
  for (const row of await tableRows(root).all()) expect(await row.locator('td').allTextContents()).toEqual(Array(6).fill('Unavailable'));
  await expect(range(root)).toHaveText('1–10 of 63 review items · Page 1 of 7');
  await expect(page.locator('.structure-ai-topic-card')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add selected to course', includeHidden: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Add selected to course', includeHidden: true })).toBeHidden();
  await root.getByLabel('Search source coverage').fill('SYNTHETIC-UNPROCESSED-63');
  await expect(reviewRows(root)).toHaveCount(1);
  await reviewRows(root).locator('summary').click();
  await expect(reviewRows(root)).toContainText('No applicable outline or coverage finding is available');
  await expect(reviewRows(root).getByRole('button', { name: 'Show passage in context' })).toHaveCount(0);
  await expect(reviewRows(root).getByRole('link', { name: 'Open original source ↗' })).toHaveAttribute('href', `/api/courses/${courseId}/materials/${unprocessed[62].materialId}/source`);
  await page.screenshot({ path: testInfo.outputPath('failed-workbench-mocked-processing-receipt.png'), fullPage: true });
  expectReadOnly(state);
});


test('mocked duplicate original-passage identities retain diagnostics without inflating trusted visual counts or context bindings', async ({ page }) => {
  const snapshot = duplicate();
  const target = snapshot.coverage.sourceInventory!.targets.find(item => item.status === 'visual-review')!;
  snapshot.coverage.sourceInventory!.targets.push(structuredClone(target));
  // Matching array length is insufficient: canonical identity must also be unique.
  snapshot.coverage.sourceInventory!.totalPassages += 1;
  const state = await mountFixture(page, snapshot);
  const { root } = state;
  await expect(root).toContainText('Duplicate passage identities');
  const sourceRow = root.locator(`tr[data-source-id="${target.materialId}"]`);
  expect(await sourceRow.locator('td').nth(4).textContent()).toBe('Unavailable');
  await root.getByLabel('Review category').selectOption('visual');
  await root.getByLabel('Source file', { exact: true }).selectOption(target.materialId);
  await root.getByLabel('Search source coverage').fill(target.passageId);
  const rows = root.locator(`[data-row-kind="passage"][data-review-id="${target.passageId}"]`);
  await expect(rows).toHaveCount(2);
  for (const row of await rows.all()) {
    await row.locator('summary').click();
    await expect(row.getByRole('button', { name: 'Show passage in context' })).toHaveCount(0);
    for (const link of await row.getByRole('link', { name: 'Open original source ↗' }).all()) {
      await expect(link).toHaveAttribute('href', `/api/courses/${courseId}/materials/${target.materialId}/source`);
    }
    await expect(row.locator('blockquote')).toHaveText(target.quote!);
  }
  expectReadOnly(state);
});

test('mocked conflicting learning-point IDs preserve both literal records and refuse a last-wins source selection', async ({ page }, testInfo) => {
  const snapshot = duplicate();
  const id = snapshot.coverage.unmappedEvidenceIds[0];
  const original = snapshot.evidence.find(item => item.id === id)!;
  const foreign = snapshot.coverage.materials.find(item => item.materialId !== original.materialId)!;
  const conflict = { ...structuredClone(original), materialId: foreign.materialId, materialName: foreign.name,
    objective: 'SYNTHETIC conflicting duplicate learning-point record', quote: 'SYNTHETIC-CONFLICTING-QUOTE: this second source binding must not win by array order.' };
  snapshot.evidence.push(conflict);
  const state = await mountFixture(page, snapshot);
  const { root } = state;
  await expect(root).toContainText('Ambiguous learning-point IDs');
  const row = root.locator(`[data-coverage-review-id="point:${id}"]`);
  await expect(row).toContainText('Ambiguous learning-point ID');
  await row.locator('summary').click();
  await expect(row.locator('blockquote').filter({ hasText: original.quote })).toHaveCount(1);
  await expect(row.locator('blockquote').filter({ hasText: conflict.quote })).toHaveCount(1);
  await expect(row).toContainText(original.materialName);
  await expect(row).toContainText(conflict.materialName);
  await expect(row.getByRole('link', { name: 'Open original source ↗' })).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Show passage in context' })).toHaveCount(0);
  expect(state.requests.some(request => request.path.endsWith('/workspace'))).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('conflicting-records-mocked-source-coverage.png'), fullPage: true });
  expectReadOnly(state);
});

test('mocked impossible mapped totals are unavailable in both file metrics and the actual workbench summary', async ({ page }) => {
  const snapshot = duplicate();
  const first = snapshot.coverage.materials[0];
  const extractedInFile = snapshot.evidence.filter(item => item.materialId === first.materialId).length;
  first.mappedObjectives = extractedInFile + 1;
  snapshot.coverage.mappedObjectives = snapshot.coverage.extractedObjectives + 1;
  const state = await mountFixture(page, snapshot, true, undefined, /unavailable/i);
  await expect(state.root).toContainText('Per-file mapped counts conflict');
  const row = state.root.locator(`tr[data-source-id="${first.materialId}"]`);
  await expect(row.locator('td').nth(1)).toHaveText(String(extractedInFile));
  await expect(row.locator('td').nth(2)).toHaveText('Unavailable');
  const summary = page.locator('.structure-ai-coverage > summary');
  await expect(summary).toContainText('unavailable');
  await expect(summary).not.toContainText('1,000/999');
  await expect(summary).not.toContainText('1000/999');
  expectReadOnly(state);
});

test('mocked mapped-and-unmapped contradictions are labelled conflicts instead of asserting that the objective has no link', async ({ page }) => {
  const snapshot = duplicate();
  const linked = new Set(snapshot.themes.flatMap(topic => topic.los.flatMap(objective => objective.evidenceIds)));
  const point = snapshot.evidence.find(item => linked.has(item.id) && !snapshot.coverage.unmappedEvidenceIds.includes(item.id))!;
  snapshot.coverage.unmappedEvidenceIds.push(point.id);
  const state = await mountFixture(page, snapshot);
  const { root } = state;
  await root.getByLabel('Search source coverage').fill(`UI-only learning point ${point.id} from`);
  const row = root.locator(`[data-coverage-review-id="point:${point.id}"]`);
  await expect(row).toContainText('Conflicting mapping receipt');
  await row.locator('summary').click();
  await expect(row).not.toContainText('has no link to an objective');
  await expect(row).toContainText(/conflict/i);
  const source = root.locator(`tr[data-source-id="${point.materialId}"]`);
  await expect(source.locator('td').nth(2)).toHaveText('Unavailable');
  await expect(source.locator('td').nth(3)).toHaveText('Unavailable');
  expectReadOnly(state);
});

test('mocked foreign learning-point and passage bindings remain literal diagnostics without opening the wrong source', async ({ page }) => {
  const snapshot = duplicate();
  const target = snapshot.coverage.sourceInventory!.targets.find(item => item.status === 'unmapped-objective' && item.evidenceIds.length)!;
  const point = snapshot.evidence.find(item => item.id === target.evidenceIds[0])!;
  const unselectedMaterial = 'ffffffffffffffffffffffff';
  point.materialId = unselectedMaterial;
  point.materialName = 'SYNTHETIC unselected foreign material.pdf';
  const state = await mountFixture(page, snapshot);
  const { root } = state;
  await expect(root).toContainText('Conflicting source bindings');
  const pointRow = root.locator(`[data-coverage-review-id="point:${point.id}"]`);
  await pointRow.locator('summary').click();
  await expect(pointRow.locator('blockquote').first()).toHaveText(point.quote);
  await expect(pointRow.getByRole('link', { name: 'Open original source ↗' })).toHaveCount(0);
  await expect(pointRow.getByRole('button', { name: 'Show passage in context' })).toHaveCount(0);
  await root.getByLabel('Search source coverage').fill(target.passageId);
  const targetRow = root.locator(`[data-row-kind="passage"][data-review-id="${target.passageId}"]`).filter({ hasText: target.materialName }).first();
  await targetRow.locator('summary').click();
  await expect(targetRow.locator('blockquote')).toHaveText(target.quote!);
  await expect(targetRow.getByRole('button', { name: 'Show passage in context' })).toHaveCount(0);
  for (const link of await targetRow.getByRole('link', { name: 'Open original source ↗' }).all()) {
    await expect(link).toHaveAttribute('href', `/api/courses/${courseId}/materials/${target.materialId}/source`);
  }
  await expect(root.locator(`a[href*="${unselectedMaterial}"]`)).toHaveCount(0);
  expect(state.requests.some(request => request.path.endsWith('/workspace'))).toBe(false);
  expectReadOnly(state);
});


test('mocked omitted gap IDs remain an explicit receipt defect without inventing replacement learning-point rows', async ({ page }) => {
  const snapshot = duplicate();
  const missing = snapshot.coverage.unmappedEvidenceIds.shift()!;
  const state = await mountFixture(page, snapshot);
  const { root } = state;
  await expect(root).toContainText(`Missing learning-point gap IDs: ${missing}`);
  await expect(root).toContainText('no replacement receipt entries have been invented');
  await expect(root.locator(`[data-coverage-review-id="point:${missing}"]`)).toHaveCount(0);
  await expect(range(root)).toHaveText('1–10 of 726 review items · Page 1 of 73');
  for (const row of await tableRows(root).all()) await expect(row.locator('td').nth(3)).toHaveText('Unavailable');
  expectReadOnly(state);
});

test('mocked duplicate source receipts preserve both raw versions but cannot supply counts or an analyzed-file total', async ({ page }) => {
  const snapshot = duplicate();
  const original = snapshot.coverage.materials[0];
  const conflicting = { ...structuredClone(original), name: 'SYNTHETIC conflicting duplicate source receipt.pdf', sections: 9999, chunks: 9999, mappedObjectives: 9999 };
  snapshot.coverage.materials.push(conflicting);
  const state = await mountFixture(page, snapshot, true, undefined, 'unavailable materials analyzed');
  const { root } = state;
  await expect(root).toContainText(`Ambiguous source receipt IDs: ${original.materialId}`);
  const sourceRows = root.locator(`tr[data-source-id="${original.materialId}"]`);
  await expect(sourceRows).toHaveCount(1);
  await expect(sourceRows).toContainText(`Ambiguous source receipt (${original.materialId})`);
  expect(await sourceRows.locator('td').allTextContents()).toEqual(Array(6).fill('Unavailable'));
  await expect(tableRows(root)).toHaveCount(10);
  await root.getByLabel('Review category').selectOption('other');
  await root.getByLabel('Source file', { exact: true }).selectOption(original.materialId);
  await root.getByLabel('Search source coverage').fill('Recorded source receipt');
  const rawRecords = root.locator(`[data-coverage-review-id^="material-record:${original.materialId}:"]`);
  await expect(rawRecords).toHaveCount(2);
  for (const row of await rawRecords.all()) {
    await row.locator('summary').click();
    await expect(row.getByRole('link', { name: 'Open original source ↗' })).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Show passage in context' })).toHaveCount(0);
  }
  await expect(rawRecords.filter({ hasText: original.name })).toHaveCount(1);
  await expect(rawRecords.filter({ hasText: conflicting.name })).toHaveCount(1);
  await expect(rawRecords.filter({ hasText: '9999' })).toHaveCount(1);
  expectReadOnly(state);
});
