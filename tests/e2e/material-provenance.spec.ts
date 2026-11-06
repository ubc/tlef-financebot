import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { GenerationQualityAssessment, MaterialWorkspaceDetail, SourceLocation } from '../../client/src/api';

/** Synthetic DTOs test compiled rendering/bindings only. They do not represent
 * a real PDF, new model judgment, source readiness or pedagogical acceptance. */
const courseId = '6ad000000000000000000001';
const materialId = '6ad000000000000000000002';
const provenanceId = '6ad000000000000000000003';
const foreignId = '6ad000000000000000000004';
const output = join(__dirname, '../../audit-results/pdf-provenance-ui-2026-10-17');
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const quote = 'A chart legend on physical page nine.\fNext-page context: <img src=x onerror="window.provenanceInjected=true"> & β = 1.20.';
const split = quote.indexOf('\f');
const rawStart = 1000;
const spans = [
  { physicalPage: 9, rawStart, rawEnd: rawStart + split, chunkStart: 0, chunkEnd: split },
  { physicalPage: 10, rawStart: rawStart + split + 1, rawEnd: rawStart + quote.length, chunkStart: split + 1, chunkEnd: quote.length },
];
function fixture(): MaterialWorkspaceDetail {
  return {
    material: { _id: materialId, courseId, name: 'Chapter 10 — mocked PDF source.pdf', format: 'pdf', kind: 'lecture', status: 'ready', revision: 1,
      assignments: [], uploadedAt: '2026-10-17T12:00:00.000Z' },
    sourceProvenance: { status: 'verified', provenanceId, successfulEngine: 'poppler-pdftotext', engineVersion: 'pdftotext version 25.12.0',
      pdfSha256: sha('mock PDF'), rawTextSha256: sha('mock full native text'), pageCount: 40 },
    chunks: [{ index: 20, text: quote, characterCount: quote.length, sourceProvenance: {
      provenanceId, pdfSha256: sha('mock PDF'), rawTextSha256: sha('mock full native text'), pageMapSha256: sha('mock page map'),
      locator: { version: 'pdf-chunk-locator-v1', offsetUnit: 'utf16-code-units', status: 'verified', chunkTextSha256: sha(quote),
        rawStart, rawEnd: rawStart + quote.length, pageSpans: structuredClone(spans) },
    } }],
  };
}
function citation(): GenerationQualityAssessment['citations'][number] {
  const sourceLocation: SourceLocation = { version: 'pdf-source-location-v1', offsetUnit: 'utf16-code-units', status: 'verified', provenanceId,
    pdfSha256: sha('mock PDF'), rawTextSha256: sha('mock full native text'), pageMapSha256: sha('mock page map'), chunkTextSha256: sha(quote),
    chunkStart: 0, chunkEnd: quote.length, rawStart, rawEnd: rawStart + quote.length, pageSpans: structuredClone(spans) };
  return { kind: 'premise', claim: 'A literal claim: <script>window.provenanceInjected=true</script>', passageId: 'S9.P1', quote, materialId, sourceLocation };
}
test.beforeAll(async () => { await mkdir(output, { recursive: true }); });

async function mountFixture(page: Page, detail = fixture(), citations?: GenerationQualityAssessment['citations']) {
  const requests: Array<{ method: string; path: string }> = []; const external: string[] = []; const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { Object.assign(window, { EventSource: class { addEventListener() {} close() {} } }); });
  await page.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:6167') { external.push(url.origin); return route.abort('blockedbyclient'); }
    if (url.pathname === '/provenance-fixture') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mocked PDF provenance UI</title><link rel="stylesheet" href="/styles/main.css"></head><body><main id="fixture" style="padding:16px"></main></body></html>' });
    if (!url.pathname.startsWith('/api/')) return route.continue();
    requests.push({ method: request.method(), path: url.pathname });
    if (request.method() !== 'GET') return route.fulfill({ status: 405, json: { error: 'Read-only mocked provenance fixture' } });
    if (url.pathname.endsWith('/source')) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><title>Mock original source</title></head><body><p>Mock source preview; no real PDF is fetched.</p></body></html>' });
    if (url.pathname.endsWith('/workspace')) return route.fulfill({ json: detail });
    if (url.pathname === `/api/courses/${courseId}`) return route.fulfill({ json: { _id: courseId, name: 'Mocked provenance course', code: 'MOCK 101', themes: [] } });
    if (url.pathname.endsWith('/materials')) return route.fulfill({ json: [detail.material] });
    if (url.pathname.endsWith('/materials-trash') || url.pathname.endsWith('/content-runs')) return route.fulfill({ json: [] });
    if (url.pathname.endsWith('/knowledge-graph')) return route.fulfill({ json: { nodes: [], edges: [], truncated: false } });
    return route.fulfill({ status: 404, json: { error: 'Unexpected mocked API request' } });
  });
  await page.goto('/provenance-fixture');
  if (citations) {
    await page.evaluate(async ({ id, rows }) => {
      const { sourceCitationDetails } = await import('/js/views/instructor/source-citations.js');
      const outlet = document.querySelector('main')!;
      outlet.className = 'source-citation-fixture';
      const heading = document.createElement('h1'); heading.textContent = 'Mocked question source quotations'; outlet.append(heading);
      const details = sourceCitationDetails(id, rows); if (details) outlet.append(details);
    }, { id: courseId, rows: citations });
  } else {
    await page.evaluate(async id => { (await import('/js/views/instructor/materials.js')).renderMaterials(document.querySelector('main')!, { id }); }, courseId);
    await expect(page.getByRole('complementary', { name: 'Source inspector', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: detail.material.name, exact: true })).toBeVisible();
  }
  return { requests, external, errors };
}
function readOnly(state: Awaited<ReturnType<typeof mountFixture>>) {
  expect(state.requests.every(row => row.method === 'GET')).toBe(true); expect(state.external).toEqual([]); expect(state.errors).toEqual([]);
}
async function assertPinnedPages(page: Page) {
  for (const number of [9, 10]) await expect(page.getByRole('link', { name: `PDF p. ${number}`, exact: true })).toHaveAttribute('href',
    `/api/courses/${courseId}/materials/${materialId}/source?provenanceId=${provenanceId}#page=${number}`);
  await expect(page.getByRole('link', { name: 'PDF p. 21', exact: true })).toHaveCount(0);
}

test('compiled materials shows the recorded parser/physical receipt and cross-page9/10 links for Chunk21', async ({ page }) => {
  const state = await mountFixture(page);
  await page.getByRole('tab', { name: 'Metadata', exact: true }).click();
  const inspector = page.getByRole('complementary', { name: 'Source inspector', exact: true });
  await expect(inspector).toContainText('Physical page locations verified'); await expect(inspector).toContainText('40 physical PDF pages');
  await expect(inspector).toContainText('Text parser: Poppler · pdftotext version 25.12.0');
  await expect(inspector).toContainText('They do not verify chart interpretation or teaching coverage.');
  await page.getByRole('tab', { name: 'Chunks', exact: true }).click();
  await expect(inspector).toContainText('Chunk 21'); await assertPinnedPages(page);
  expect(await inspector.locator('.workspace-chunk > p').last().textContent()).toBe(quote);
  await expect(inspector.locator('img, script')).toHaveCount(0); expect(await page.evaluate(() => 'provenanceInjected' in window)).toBe(false);
  readOnly(state);
});

test('historical missing receipt stays unavailable without guessing a page from chunk ordinal', async ({ page }) => {
  const detail = fixture(); delete detail.sourceProvenance; delete detail.chunks[0].sourceProvenance;
  const state = await mountFixture(page, detail);
  await page.getByRole('tab', { name: 'Metadata', exact: true }).click();
  await expect(page.getByText('Physical page locations unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText('0 physical PDF pages', { exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Chunks', exact: true }).click();
  await expect(page.getByText('Physical PDF page unavailable.', { exact: true })).toBeVisible(); await expect(page.getByRole('link', { name: /^PDF p\./ })).toHaveCount(0);
  readOnly(state);
});

for (const mode of ['foreign-id', 'bad-id', 'foreign-hash', 'missing-count', 'bad-page', 'bad-range', 'bad-version', 'unavailable-map'] as const) {
  test(`compiled materials suppresses page links for ${mode} locator/receipt bindings`, async ({ page }) => {
    const detail = fixture(); const provenance = detail.chunks[0].sourceProvenance!; const locator = provenance.locator;
    if (locator.status !== 'verified') throw new Error('Fixture locator unavailable');
    if (mode === 'foreign-id') provenance.provenanceId = foreignId;
    if (mode === 'bad-id') detail.sourceProvenance!.provenanceId = '../invalid?source';
    if (mode === 'foreign-hash') provenance.pdfSha256 = sha('foreign original');
    if (mode === 'missing-count') delete detail.sourceProvenance!.pageCount;
    if (mode === 'bad-page') locator.pageSpans[0].physicalPage = 41;
    if (mode === 'bad-range') locator.pageSpans[1].rawStart += 1;
    if (mode === 'bad-version') locator.version = 'unknown-version' as never;
    if (mode === 'unavailable-map') detail.sourceProvenance!.status = 'unavailable';
    const state = await mountFixture(page, detail);
    await page.getByRole('tab', { name: 'Chunks', exact: true }).click();
    await expect(page.getByText('Physical PDF page unavailable.', { exact: true })).toBeVisible(); await expect(page.getByRole('link', { name: /^PDF p\./ })).toHaveCount(0);
    readOnly(state);
  });
}

test('compiled citation helper consumes server sourceLocation and safely renders the exact quote', async ({ page }) => {
  const rows = [citation(), { ...citation(), passageId: 'legacy', sourceLocation: undefined }];
  const state = await mountFixture(page, fixture(), rows);
  await page.getByText('Source quotations (2)', { exact: true }).click();
  await assertPinnedPages(page); expect(await page.locator('blockquote').first().textContent()).toBe(quote);
  await expect(page.getByText('Physical page not recorded for this quotation.', { exact: true })).toHaveCount(1);
  await expect(page.locator('main img, main script')).toHaveCount(0); expect(await page.evaluate(() => 'provenanceInjected' in window)).toBe(false);
  readOnly(state);
});

for (const mode of ['bad-material-id', 'bad-provenance-id', 'bad-page', 'bad-range', 'missing-spans', 'legacy-name'] as const) {
  test(`compiled citation helper keeps ${mode} unavailable while preserving the source quote`, async ({ page }) => {
    const row = citation(); const location = row.sourceLocation!;
    if (location.status !== 'verified') throw new Error('Fixture location unavailable');
    if (mode === 'bad-material-id') row.materialId = '../foreign';
    if (mode === 'bad-provenance-id') location.provenanceId = 'not-a-record-id';
    if (mode === 'bad-page') location.pageSpans[1].physicalPage = -1;
    if (mode === 'bad-range') location.pageSpans[1].rawStart += 1;
    if (mode === 'missing-spans') location.pageSpans = undefined as never;
    if (mode === 'legacy-name') { Object.assign(row, { location }); delete row.sourceLocation; }
    const state = await mountFixture(page, fixture(), [row]);
    await page.getByText('Source quotations (1)', { exact: true }).click();
    expect(await page.locator('blockquote').textContent()).toBe(quote); await expect(page.getByRole('link', { name: /^PDF p\./ })).toHaveCount(0);
    await expect(page.getByText('Physical page not recorded for this quotation.', { exact: true })).toBeVisible(); readOnly(state);
  });
}

for (const [name, width, theme] of [['desktop-light', 1440, 'light'], ['mobile-dark', 390, 'dark']] as const) {
  test(`compiled ${name} provenance receipts and citations pass scoped axe with readable page links`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const state = await mountFixture(page); await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
    const inspector = page.getByRole('complementary', { name: 'Source inspector', exact: true });
    await page.getByRole('tab', { name: 'Metadata', exact: true }).click(); await inspector.scrollIntoViewIfNeeded();
    expect((await new AxeBuilder({ page }).include('.knowledge-workspace__inspector').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    await inspector.screenshot({ path: join(output, `${name}-material-metadata.png`) });
    await page.getByRole('tab', { name: 'Chunks', exact: true }).click(); await assertPinnedPages(page);
    expect((await new AxeBuilder({ page }).include('.knowledge-workspace__inspector').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await inspector.screenshot({ path: join(output, `${name}-material-chunks.png`) }); readOnly(state);
    const citationState = await mountFixture(page, fixture(), [citation()]); await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
    await page.getByText('Source quotations (1)', { exact: true }).focus(); await page.keyboard.press('Enter'); await assertPinnedPages(page);
    expect((await new AxeBuilder({ page }).include('.source-citation-fixture').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('main').screenshot({ path: join(output, `${name}-source-citations.png`) }); readOnly(citationState);
  });
}
