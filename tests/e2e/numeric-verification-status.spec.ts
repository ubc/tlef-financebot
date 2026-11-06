import { test, expect, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const ORIGIN = 'http://127.0.0.1:6169';
const COURSE = '6cf100000000000000000001', QUESTION = '6cf100000000000000000002';
const VERSION = '6cf100000000000000000003', SAVED_VERSION = '6cf100000000000000000004';
const proof = {
  evaluatorVersion: 1, inputDisplayVersion: 1,
  sampleSeeds: Array.from({ length: 100 }, (_, index) => 1_000_003 + index),
  verifiedAt: '2026-10-17T18:00:00.000Z',
};
const exhaustive = { ...proof, parameterCoverage: {
  version: 'finite-slot-grid-v1', mode: 'exhaustive', totalCombinations: 27,
  checkedCombinations: 27, maxCombinations: 256,
} };

async function fixture(page: Page, verification: unknown, save?: { verification?: unknown; verificationError?: string }) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const external: string[] = [], errors: string[] = [], unexpected: string[] = [];
  const current = {
    _id: VERSION, questionId: QUESTION, version: 1, type: 'mcq', difficulty: 'easy',
    stem: 'A risk-free rate of {{RF}}%, beta {{BETA}}, and market premium {{MRP}}%. Compute expected return.',
    numericKind: 'numeric', paramSlots: [{ name: 'RF', values: [2, 3, 4] },
      { name: 'BETA', values: [0.8, 0.9, 1.1] }, { name: 'MRP', values: [4, 5, 6] }],
    derivedValues: [{ name: 'ANSWER', formula: 'RF+BETA*MRP' },
      { name: 'DISTRACTOR', formula: 'RF+MRP', errorModel: 'omitted beta' }],
    options: [{ key: 'A', text: '{{ANSWER}}%', role: 'correct', explanation: 'Apply CAPM to the supplied inputs.' },
      { key: 'B', text: '{{DISTRACTOR}}%', role: 'common-misconception', explanation: 'This ignores beta.' }],
    verification, sourceRefs: [], createdBy: 'synthetic-instructor', createdAt: proof.verifiedAt,
  };
  const saved = { ...current, _id: SAVED_VERSION, version: 2, verification: undefined, ...save };
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== ORIGIN) { external.push(url.href); return route.abort('blockedbyclient'); }
    if (url.pathname === '/numeric-verification-fixture') return route.fulfill({ contentType: 'text/html', body:
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<title>Numerical verification display — synthetic receipts</title><link rel="stylesheet" href="/styles/main.css">'
      + '</head><body><p class="form-field__help" style="margin:16px">Synthetic intercepted API receipts. '
      + 'These screens verify display and save-state behavior, not numerical correctness or model quality.</p>'
      + '<main style="padding:16px;max-width:1120px;margin:auto"></main></body></html>' });
    if (!url.pathname.startsWith('/api/')) return route.continue();
    calls.push({ method: request.method(), path: url.pathname,
      ...(request.postData() ? { body: request.postDataJSON() as unknown } : {}) });
    if (url.pathname === `/api/questions/${QUESTION}` && request.method() === 'GET') return route.fulfill({ json: {
      id: QUESTION, courseId: COURSE, currentVersionId: VERSION, currentVersion: 1,
      state: 'draft', loIds: [], themeIds: [], labels: [], internalNotes: [], versions: [], current,
    } });
    if (url.pathname === `/api/questions/${QUESTION}/params` && request.method() === 'PATCH' && save) {
      const body = request.postDataJSON() as { paramSlots?: unknown; derivedValues?: unknown };
      Object.assign(saved, body.paramSlots !== undefined ? { paramSlots: body.paramSlots } : {},
        body.derivedValues !== undefined ? { derivedValues: body.derivedValues } : {});
      return route.fulfill({ json: saved });
    }
    unexpected.push(`${request.method()} ${url.pathname}`);
    return route.fulfill({ status: 405, json: { error: 'The synthetic fixture refuses all other API operations.' } });
  });
  await page.goto('/numeric-verification-fixture');
  await page.evaluate(async ({ course, question }) => {
    const component = await import('/js/views/instructor/param-config.js');
    component.renderParamConfig(document.querySelector('main')!, { id: course, questionId: question });
  }, { course: COURSE, question: QUESTION });
  await expect(page.getByRole('heading', { name: 'Parameterization Configuration' })).toBeVisible();
  return { current, saved, calls, external, errors, unexpected, banner: page.locator('.param-config__verification') };
}

async function retainAndCheck(state: Awaited<ReturnType<typeof fixture>>, testInfo: TestInfo, saves = 0) {
  expect(state.external).toEqual([]);
  expect(state.errors).toEqual([]);
  expect(state.unexpected).toEqual([]);
  expect(state.calls.filter(call => call.method !== 'GET')).toHaveLength(saves);
  if (saves) {
    expect(state.calls[1]).toMatchObject({ method: 'PATCH', path: `/api/questions/${QUESTION}/params`,
      body: { expectedVersionId: VERSION } });
  }
  await mkdir(testInfo.outputDir, { recursive: true });
  for (const name of await readdir(testInfo.outputDir)) {
    if (name.endsWith('.png')) await testInfo.attach(name, { path: join(testInfo.outputDir, name), contentType: 'image/png' });
  }
  await testInfo.attach('synthetic-intercepted-input-output', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
    scope: 'Compiled parameter-config renderer and mocked responses only; no arithmetic, provider or database acceptance.',
    initialVersion: state.current, syntheticSaveResponse: saves ? state.saved : null,
    interceptedRequests: state.calls, externalRequests: state.external, pageErrors: state.errors, unexpectedApis: state.unexpected,
  }, null, 2)) });
}

for (const [name, width, theme] of [['desktop-light', 1440, 'light'], ['mobile-dark', 390, 'dark']] as const) {
  test(`complete finite-grid receipt ${name} uses the real compact parameter banner`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const state = await fixture(page, exhaustive);
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await expect(state.banner).toContainText('Verified all 27 parameter-entry combinations plus 100 recorded sample draws.');
    await expect(state.banner).toContainText('Approval is still required.');
    await expect(state.banner.locator('.verification-banner--ok')).toBeVisible();
    await state.banner.scrollIntoViewIfNeeded();
    const bounds = await state.banner.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(await state.banner.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include('.param-config__verification').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    await state.banner.screenshot({ path: testInfo.outputPath(`${name}-finite-grid-banner.png`) });
    await page.screenshot({ path: testInfo.outputPath(`${name}-parameter-config.png`), fullPage: true });
    await retainAndCheck(state, testInfo);
  });
}

test('large-domain sampled receipt remains explicitly limited to its recorded samples', async ({ page }, testInfo) => {
  const state = await fixture(page, { ...proof, parameterCoverage: {
    version: 'finite-slot-grid-v1', mode: 'sampled', totalCombinations: 257,
    checkedCombinations: 0, maxCombinations: 256, reason: 'combination-limit',
  } });
  await expect(state.banner).toContainText('Verified across 100 recorded sample draws.');
  await expect(state.banner).toContainText('exceeds the 256-combination limit');
  await expect(state.banner).not.toContainText('Verified all');
  await state.banner.screenshot({ path: testInfo.outputPath('sampled-fallback-banner.png') });
  await retainAndCheck(state, testInfo);
});

test('historical proof shows 25 actual samples and no invented grid claim', async ({ page }, testInfo) => {
  const state = await fixture(page, { ...proof, sampleSeeds: proof.sampleSeeds.slice(0, 25) });
  await expect(state.banner).toContainText('Verified across 25 recorded sample draws.');
  await expect(state.banner).toContainText('Full-grid coverage was not recorded.');
  await expect(state.banner).not.toContainText('100 recorded');
  await expect(state.banner).not.toContainText('Verified all');
  await retainAndCheck(state, testInfo);
});

test('hostile contradictory metadata cannot claim complete coverage or execute markup', async ({ page }, testInfo) => {
  const hostile = '<img src=x onerror="window.numericProofInjected=true">';
  const state = await fixture(page, { ...proof, parameterCoverage: { ...exhaustive.parameterCoverage,
    totalCombinations: 257, checkedCombinations: 257, reason: hostile } });
  await expect(state.banner).toContainText('Full-grid coverage is unavailable.');
  await expect(state.banner).not.toContainText('Verified all');
  await expect(state.banner.locator('img,script')).toHaveCount(0);
  expect(await page.evaluate(() => 'numericProofInjected' in window)).toBe(false);
  await retainAndCheck(state, testInfo);
});

test('save response with a failing grid tuple replaces the previous success banner', async ({ page }, testInfo) => {
  const failure = 'finite parameter grid {"RF":3,"BETA":1.2,"MRP":6}: options ANSWER and DISTRACTOR are identical at display precision (both show 10.20)';
  const state = await fixture(page, exhaustive, { verificationError: failure });
  await expect(state.banner.locator('.verification-banner--ok')).toBeVisible();
  await page.locator('.param-slot__values').nth(1).fill('0.8, 0.9, 1.2');
  await page.locator('#derived-formula-1').fill('RF+BETA+MRP');
  await page.locator('#derived-error-1').fill('added beta rather than multiplying the market premium');
  await page.getByRole('button', { name: 'Save Parameterization', exact: true }).click();
  await expect(state.banner.locator('.verification-banner--fail')).toContainText(failure);
  await expect(state.banner).toContainText('Not verified — this question will not be served to students.');
  await expect(state.banner.locator('.verification-banner--ok')).toHaveCount(0);
  expect(state.calls[1]).toMatchObject({ body: {
    paramSlots: [{ name: 'RF', values: [2, 3, 4] }, { name: 'BETA', values: [0.8, 0.9, 1.2] }, { name: 'MRP', values: [4, 5, 6] }],
    derivedValues: [{ name: 'ANSWER', formula: 'RF+BETA*MRP' }, { name: 'DISTRACTOR', formula: 'RF+BETA+MRP' }],
  } });
  await state.banner.screenshot({ path: testInfo.outputPath('rejected-grid-tuple-banner.png') });
  await retainAndCheck(state, testInfo, 1);
});

test('save response without a proof stays neutral and cannot retain prior success', async ({ page }, testInfo) => {
  const state = await fixture(page, exhaustive, {});
  await expect(state.banner.locator('.verification-banner--ok')).toBeVisible();
  await page.getByRole('button', { name: 'Save Parameterization', exact: true }).click();
  await expect(state.banner).toContainText('No numerical verification proof is recorded for this version.');
  await expect(state.banner.locator('.verification-banner--ok,.verification-banner--fail')).toHaveCount(0);
  await expect(state.banner).not.toContainText('Verified all');
  await state.banner.screenshot({ path: testInfo.outputPath('missing-proof-neutral.png') });
  await retainAndCheck(state, testInfo, 1);
});
