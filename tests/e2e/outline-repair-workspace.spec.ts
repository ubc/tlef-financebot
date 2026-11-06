import { test, expect, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { StructureGenerationRun, StructureRepairRequest, StructureRepairTargetView, StructureRepairView, StructureResult } from '../../client/src/api';

const ORIGIN = 'http://127.0.0.1:6170', COURSE = '6cf200000000000000000001';
const PARENT = '6cf200000000000000000002', CHILD = '6cf200000000000000000003', MATERIAL = '6cf200000000000000000004';
const originalName = 'Explain shareholder value and its assumptions';
const repairedName = 'Explain shareholder residual claims and the assumptions used to assess shareholder value';
const sourceQuote = 'Shareholders receive residual claims after contractual claims are met.';
const hostile = '<img src=x onerror="window.outlineRepairInjected=true">';
const mode = 'coverage-wording-outline-repair-v1';

async function fixture(page: Page, options: { child?: 'failed' | 'completed'; unavailable?: boolean; paging?: boolean; manyPoints?: boolean; readFailure?: boolean; baseline?: boolean } = {}) {
  const calls: Array<{ method: string; path: string; query: string; body?: unknown }> = [];
  const responses: Array<{ method: string; path: string; query: string; status: number | 'aborted'; body?: unknown }> = [];
  const external: string[] = [], errors: string[] = [], unexpected: string[] = [];
  let childStatus: 'running' | 'failed' | 'completed' | undefined = options.child;
  let latestId = options.child ? CHILD : PARENT;
  let readFailure = !!options.readFailure, malformed = false, losePost = false;
  let request: StructureRepairRequest | undefined = options.child ? { version: mode, targets: [{ id: 'L1', evidenceIds: ['E2'] }] } : undefined;
  const applied: unknown[] = [];
  const coverageTarget = (id: string, index = 0): StructureRepairTargetView => ({
    id, topic: 'Corporate finance', name: index ? `Explain source-supported financial claim ${index}` : originalName,
    status: 'supported', mode, reason: 'The assigned original passages support this objective, but some assigned points are not credited.',
    preservedEvidenceIds: [`E${index ? index * 10 + 1 : 1}`], missingEvidenceIds: Array.from({ length: options.manyPoints && !index ? 9 : 1 }, (_, i) => `E${index ? index * 10 + 2 : i + 2}`),
    points: [{ id: `E${index ? index * 10 + 1 : 1}`, objective: 'State the assumptions of the shareholder-value objective', materialId: MATERIAL,
      materialName: 'Chapter 2.pdf', chunkIndex: 1, quotes: [{ passageId: 'C2.S1.P1', text: 'The share price is observable and continually updated.' }] },
    ...Array.from({ length: options.manyPoints && !index ? 9 : 1 }, (_, i) => ({ id: `E${index ? index * 10 + 2 : i + 2}`,
      objective: i ? `Explain related residual-claim condition ${i}` : 'Explain why shareholder claims are residual', materialId: MATERIAL,
      materialName: 'Chapter 2.pdf', chunkIndex: 1, quotes: [{ passageId: `C2.S1.P${i + 2}`, text: `${sourceQuote} ${hostile}` }] }))],
  });
  const rows: StructureRepairTargetView[] = options.paging
    ? Array.from({ length: 11 }, (_, index) => coverageTarget(`L${index + 1}`, index))
    : [coverageTarget('L1'), { id: 'L2', topic: 'Corporate finance', name: 'Calculate an unsupported market forecast', status: 'unsupported',
      mode: 'wording-only-outline-repair-v1', reason: 'The source does not supply the forecasting method.', preservedEvidenceIds: [], missingEvidenceIds: [],
      points: [{ id: 'E4', objective: 'Describe observable market prices', materialId: MATERIAL, materialName: 'Chapter 2.pdf', chunkIndex: 1,
        quotes: [{ passageId: 'C2.S1.P3', text: 'Market prices are observable.' }] }] }];
  const result: StructureResult = {
    themes: [{ name: 'Corporate finance', los: options.paging ? rows.map(row => ({ name: row.name, evidenceIds: row.preservedEvidenceIds, materialIds: [MATERIAL] }))
      : [{ name: originalName, evidenceIds: ['E1'], materialIds: [MATERIAL] }, { name: 'Explain manager incentives', evidenceIds: ['E3'], materialIds: [MATERIAL] }] }],
    evidence: [...rows.flatMap(row => row.points.map(point => ({ id: point.id, objective: point.objective, materialId: MATERIAL,
      materialName: point.materialName, chunkIndex: point.chunkIndex, quote: point.quotes[0]!.text, sourcePassageId: point.quotes[0]!.passageId }))),
    ...(!options.paging ? [{ id: 'E3', objective: 'Explain manager incentives', materialId: MATERIAL, materialName: 'Chapter 2.pdf', chunkIndex: 1, quote: 'Managers respond to incentives.' }] : [])],
    coverage: { materials: [{ materialId: MATERIAL, name: 'Chapter 2.pdf', chunks: 2, sections: 2, mappedObjectives: options.paging ? 11 : 2 }],
      analyzedSections: 2, extractedObjectives: 0, mappedObjectives: options.paging ? 11 : 2,
      unmappedEvidenceIds: ['E2'], excludedSections: [], warnings: [] },
  };
  result.coverage!.extractedObjectives = result.evidence!.length;
  const mappedIds = new Set(result.themes.flatMap(theme => theme.los.flatMap(lo => lo.evidenceIds ?? [])));
  result.coverage!.unmappedEvidenceIds = result.evidence!.filter(point => !mappedIds.has(point.id)).map(point => point.id);
  const base = { courseId: COURSE, kind: 'structure-generation' as const, requestedBy: 'synthetic-instructor', completedUnits: 2, totalUnits: 2,
    warnings: [], createdAt: '2026-10-17T18:00:00.000Z', updatedAt: '2026-10-17T18:00:00.000Z', input: { materialIds: [MATERIAL] } };
  const parent: StructureGenerationRun = { ...base, _id: PARENT, revision: 2, status: 'completed', stage: 'completed', structureResult: result };
  const child = (): StructureGenerationRun => ({ ...base, _id: CHILD, revision: childStatus === 'running' ? 1 : 2,
    createdAt: '2026-10-17T18:01:00.000Z', status: childStatus ?? 'running', stage: childStatus === 'running' ? 'checking' : 'completed',
    ...(childStatus === 'completed' ? { structureResult: { ...result, themes: [{ ...result.themes[0]!, los:
      result.themes[0]!.los.map((lo, i) => i ? lo : { ...lo, name: repairedName, evidenceIds: ['E1', 'E2'] }) }] } } : {}),
    ...(childStatus === 'failed' ? { error: { code: 'structure-repair-coverage-shortfall', message: 'The proposed wording did not retain every required source point.', atStage: 'checking', retryable: false } } : {}),
  });
  const view = (requestedRunId: string, pageNumber = 1): StructureRepairView => {
    const selectedIds = request ? request.version === mode ? request.targets.map(target => target.id) : request.targetIds : [];
    const targets = childStatus ? rows.filter(row => selectedIds.includes(row.id)) : rows;
    const start = childStatus ? 0 : (pageNumber - 1) * 10;
    return { version: 'outline-wording-repair-view-v1', requestedRunId, parentRunId: PARENT, parentStatus: 'completed',
      availability: { canStart: !options.unavailable && !childStatus, reason: childStatus ? 'cycle-used' : options.unavailable ? 'checkpoint-unavailable' : null,
        message: childStatus ? 'A repair attempt is already recorded for this draft.' : options.unavailable ? 'This historical draft has no repair checkpoint.' : 'Choose source-bound wording to check once.' },
      limits: { maxTargets: 2, maxPointsPerTarget: 8, maxSends: 10, maxInputUnits: 48000, maxOutputUnits: 6000, maxNewUnits: 540000 },
      budget: { accounting: 'conservative-units-v1', remainingSends: 6, remainingUnits: 120000 },
      cycle: { used: !!childStatus, ...(childStatus ? { childRunId: CHILD, childStatus, mode: request?.version ?? mode } : {}) },
      targets: { items: options.unavailable ? [] : targets.slice(start, start + 10), total: options.unavailable ? 0 : targets.length, page: childStatus ? 1 : pageNumber, pageSize: 10 },
      ...(childStatus ? { child: { runId: CHILD, parentRunId: PARENT, mode: request?.version ?? mode, status: childStatus,
        canApply: childStatus === 'completed', unknownWork: false,
        ...(childStatus === 'failed' ? { error: child().error } : {}),
        targets: targets.map(target => ({ id: target.id, topic: target.topic, before: target.name, after: repairedName,
          proposalStatus: 'proposed' as const, finding: childStatus === 'running' ? undefined : {
            status: 'supported' as const, reason: 'Synthetic source-review response for UI testing only.', coveredEvidenceIds: ['E1', 'E2'], citedSourceIds: ['S1'] } })),
        coverageAssessment: request?.version === mode && childStatus !== 'running' ? { status: childStatus === 'completed' ? 'passed' as const : 'shortfall' as const,
          targets: [{ id: 'L1', status: childStatus === 'completed' ? 'covered' as const : 'shortfall' as const, requestedEvidenceIds: ['E2'],
            preservedEvidenceIds: ['E1'], missingEvidenceIds: childStatus === 'failed' ? ['E2'] : [], lostEvidenceIds: childStatus === 'failed' ? ['E1'] : [],
            reasons: childStatus === 'failed' ? ['The requested point remains uncredited and an old credit was lost.'] : [] }] } : undefined } } : {}),
    };
  };
  await page.addInitScript(() => {
    class Stream {
      static instances: Stream[] = [];
      listeners = new Map<string, Array<(event: { data: string }) => void>>();
      constructor() { Stream.instances.push(this); }
      addEventListener(type: string, callback: (event: { data: string }) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]); }
      close() { Stream.instances = Stream.instances.filter(value => value !== this); }
    }
    Object.assign(window, { EventSource: Stream, emitOutlineRun: (value: unknown) => Stream.instances.forEach(stream =>
      stream.listeners.get('run')?.forEach(callback => callback({ data: JSON.stringify(value) }))) });
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== ORIGIN) { external.push(url.href); return route.abort('blockedbyclient'); }
    if (url.pathname === '/outline-repair-fixture') return route.fulfill({ contentType: 'text/html', body:
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Outline repair — synthetic UI receipts</title>'
      + '<link rel="stylesheet" href="/styles/main.css"></head><body><p class="form-field__help" style="margin:16px">Synthetic intercepted responses. '
      + 'This verifies the authoring workflow, not model quality or real source acceptance.</p><main style="max-width:1380px;margin:auto;padding:16px"></main></body></html>' });
    if (!url.pathname.startsWith('/api/')) {
      if (options.baseline && (url.pathname.startsWith('/js/') || url.pathname.startsWith('/styles/'))) {
        const bytes = await readFile(resolve('audit-results/outline-repair-workspace-2026-10-17/client-tests/baseline-build/public', url.pathname.slice(1)));
        return route.fulfill({ contentType: url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript', body: bytes });
      }
      return route.continue();
    }
    calls.push({ method: req.method(), path: url.pathname, query: url.search, ...(req.postData() ? { body: req.postDataJSON() as unknown } : {}) });
    const reply = async (body: unknown, status = 200) => {
      responses.push({ method: req.method(), path: url.pathname, query: url.search, status, ...(body === undefined ? {} : { body }) });
      return route.fulfill({ status, ...(body === undefined ? {} : { json: body }) });
    };
    if (url.pathname === '/api/diagnostics/client-error' && req.method() === 'POST') return reply(undefined, 204);
    if (url.pathname.endsWith('/materials') && req.method() === 'GET') return reply([{ _id: MATERIAL, courseId: COURSE, name: 'Chapter 2.pdf', format: 'pdf', status: 'ready', assignments: [], uploadedAt: base.createdAt }]);
    if (url.pathname.endsWith('/content-runs') && req.method() === 'GET') return reply([latestId === CHILD ? child() : parent]);
    if (url.pathname.endsWith(`/content-runs/${PARENT}`) && req.method() === 'GET') return reply(parent);
    if (url.pathname.endsWith(`/content-runs/${CHILD}`) && req.method() === 'GET') return reply(child());
    if (url.pathname.endsWith('/repair') && req.method() === 'GET') {
      if (readFailure) return reply({ error: 'Temporary read failure' }, 503);
      return reply(malformed ? {} : view(url.pathname.includes(CHILD) ? CHILD : PARENT, Number(url.searchParams.get('page') ?? 1)));
    }
    if (url.pathname.endsWith(`/structure-generation/${PARENT}/repair`) && req.method() === 'POST') {
      request = req.postDataJSON() as StructureRepairRequest; childStatus = 'running'; latestId = CHILD;
      if (losePost) {
        responses.push({ method: req.method(), path: url.pathname, query: url.search, status: 'aborted' });
        return route.abort('failed');
      }
      return reply({ runId: CHILD, parentRunId: PARENT }, 202);
    }
    if (url.pathname.endsWith('/apply-suggested-hierarchy') && req.method() === 'POST') {
      const body = req.postDataJSON() as { runId: string; themes: Array<{ los: Array<{ name: string }> }> };
      applied.push(body);
      const edited = body.themes[0]?.los[0]?.name !== repairedName;
      return reply({ themesCreated: 1, losCreated: body.themes[0]?.los.length ?? 0, assignmentsCreated: 1, materialsAssigned: 1,
        ...(body.runId === CHILD ? { repairReview: { runId: CHILD, parentRunId: PARENT, mode, wording: edited ? 'instructor-edited' : 'reviewed', teacherEditedNames: edited ? 1 : 0 } } : {}) });
    }
    unexpected.push(`${req.method()} ${url.pathname}`);
    return reply({ error: 'The synthetic fixture refuses every other operation.' }, 405);
  });
  const mount = async () => {
    await page.evaluate(async ({ course, material }) => {
      const owner = document.querySelector('main')!;
      const assistant = (await import('/js/views/instructor/structure-ai-workbench.js')).createStructureAssistant(course,
        [{ _id: material, courseId: course, name: 'Chapter 2.pdf', format: 'pdf', status: 'ready', assignments: [], uploadedAt: '2026-10-17T18:00:00.000Z' }],
        () => {}, async notice => { Object.assign(window, { outlineAppliedNotice: notice }); }, owner);
      owner.append(assistant.element); assistant.open();
    }, { course: COURSE, material: MATERIAL });
  };
  await page.goto('/outline-repair-fixture'); await mount();
  const panel = page.getByRole('region', { name: 'Repair outline wording', exact: true });
  if (options.baseline) await expect(page.getByLabel('Objective 1.1', { exact: true })).toBeVisible();
  else {
    await expect(panel).toBeVisible();
    await panel.locator(':scope > details > summary').click();
  }
  return { panel, calls, responses, external, errors, unexpected, applied, parent, view, mount,
    setReadFailure(value: boolean) { readFailure = value; }, setMalformed(value: boolean) { malformed = value; },
    loseNextPost() { losePost = true; },
    async emit(status: 'running' | 'failed' | 'completed') {
      childStatus = status; latestId = CHILD;
      if (!request) request = { version: mode, targets: [{ id: 'L1', evidenceIds: ['E2'] }] };
      await page.evaluate(value => (window as unknown as { emitOutlineRun(value: unknown): void }).emitOutlineRun(value), child());
    },
  };
}

async function choose(state: Awaited<ReturnType<typeof fixture>>, id = 'L1', pointId = 'E2') {
  await state.panel.locator('summary').filter({ hasText: new RegExp(`^${id} · (?:Source supported|Withheld) ·`) }).click();
  await state.panel.getByLabel(`Select ${id} for wording repair`, { exact: true }).check();
  if (pointId) await state.panel.getByLabel(`Cover source point ${pointId} for ${id}`, { exact: true }).check();
}

async function submit(page: Page, state: Awaited<ReturnType<typeof fixture>>) {
  await state.panel.getByRole('button', { name: 'Repair selected wording', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('one repair attempt');
  await expect(page.getByRole('dialog')).toContainText('up to 10 model sends');
  await page.getByRole('button', { name: 'Start one repair attempt', exact: true }).click();
}

async function retain(state: Awaited<ReturnType<typeof fixture>>, info: TestInfo) {
  expect(state.external).toEqual([]); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
  await mkdir(info.outputDir, { recursive: true });
  for (const name of await readdir(info.outputDir)) if (name.endsWith('.png')) await info.attach(name, { path: join(info.outputDir, name), contentType: 'image/png' });
  await info.attach('synthetic-input-output', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
    scope: 'Compiled authoring workflow with synthetic intercepted API responses; no provider, database or semantic-quality acceptance.',
    initialParent: state.parent, syntheticFinalServerView: state.view(CHILD), requests: state.calls, interceptedResponses: state.responses, syntheticApplies: state.applied,
    external: state.external, pageErrors: state.errors, unexpected: state.unexpected,
  }, null, 2)) });
}

for (const [name, width, theme] of [['desktop-light', 1440, 'light'], ['mobile-dark', 390, 'dark']] as const) {
  test(`repair choices preserve the current design ${name}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1100 });
    const state = await fixture(page); await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await expect(page.getByLabel('Objective 1.1', { exact: true })).toHaveValue(originalName);
    await expect(state.panel).toContainText('One repair attempt per draft.');
    await choose(state);
    await state.panel.getByLabel('Cover source point E2 for L1', { exact: true }).locator('..').locator('..')
      .getByText('Chapter 2.pdf · Source quotes', { exact: true }).click();
    await expect(state.panel).toContainText(hostile);
    await expect(state.panel.locator('img,script')).toHaveCount(0);
    expect(await page.evaluate(() => 'outlineRepairInjected' in window)).toBe(false);
    await state.panel.getByText('Repair budget', { exact: true }).click();
    await expect(state.panel).toContainText('not reported provider tokens or a cost estimate');
    const scan = await new AxeBuilder({ page }).include('[aria-label="Repair outline wording"]').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(scan.violations).toEqual([]);
    expect(await state.panel.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await state.panel.screenshot({ path: info.outputPath(`${name}-repair-choices.png`) });
    expect(state.calls.filter(call => call.method === 'POST')).toEqual([]);
    await retain(state, info);
  });
}

test('one explicit coverage repair retains the parent until the repaired draft is chosen', async ({ page }, info) => {
  const state = await fixture(page);
  await page.getByLabel('Objective 1.1', { exact: true }).fill('Instructor’s local wording');
  await page.getByLabel('Include objective 1.2', { exact: true }).uncheck();
  await choose(state);
  await state.panel.screenshot({ path: info.outputPath('selected-original-and-requested-point.png') });
  await submit(page, state);
  await expect(state.panel).toContainText('Repair running');
  await expect(page.getByLabel('Objective 1.1', { exact: true })).toHaveValue('Instructor’s local wording');
  expect(state.calls.find(call => call.method === 'POST')?.body).toEqual({ version: mode, targets: [{ id: 'L1', evidenceIds: ['E2'] }] });
  await state.emit('completed');
  await expect(state.panel.getByRole('button', { name: 'Review repaired draft', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Objective 1.1', { exact: true })).toHaveValue('Instructor’s local wording');
  expect(state.applied).toEqual([]);
  await state.panel.getByText('L1 · Before and after', { exact: true }).click();
  await expect(state.panel).toContainText('Requested: E2. Preserved: E1. Missing: None. Lost: None.');
  await state.panel.screenshot({ path: info.outputPath('completed-repair-retains-original-until-review.png') });
  await state.panel.getByRole('button', { name: 'Review repaired draft', exact: true }).click();
  await expect(page.getByLabel('Objective 1.1', { exact: true })).toHaveValue(repairedName);
  await page.locator('main').screenshot({ path: info.outputPath('explicitly-reviewed-repaired-draft.png') });
  await state.panel.getByRole('button', { name: 'Review original draft', exact: true }).click();
  await expect(page.getByLabel('Objective 1.1', { exact: true })).toHaveValue('Instructor’s local wording');
  await expect(page.getByLabel('Include objective 1.2', { exact: true })).not.toBeChecked();
  await retain(state, info);
});

test('a failed newest child cannot erase the original edits and selection after reload', async ({ page }, info) => {
  const state = await fixture(page);
  await page.getByLabel('Objective 1.1', { exact: true }).fill('Retained instructor wording');
  await page.getByLabel('Include objective 1.2', { exact: true }).uncheck();
  await choose(state); await submit(page, state); await expect(state.panel).toContainText('Repair running');
  await state.emit('failed'); await expect(state.panel).toContainText('coverage shortfall');
  await page.reload(); await state.mount();
  await expect(page.getByLabel('Objective 1.1', { exact: true })).toHaveValue('Retained instructor wording');
  await expect(page.getByLabel('Include objective 1.2', { exact: true })).not.toBeChecked();
  await state.panel.locator(':scope > details > summary').click();
  await expect(state.panel.getByRole('button', { name: 'Review repaired draft', exact: true })).toBeDisabled();
  await state.panel.getByText('L1 · Before and after', { exact: true }).click();
  await expect(state.panel).toContainText('Requested: E2. Preserved: E1. Missing: E2. Lost: E1.');
  await expect(state.panel).toContainText(sourceQuote);
  await state.panel.screenshot({ path: info.outputPath('failed-child-retained-parent.png') });
  expect(state.calls.filter(call => call.method === 'POST' && call.path.endsWith('/repair'))).toHaveLength(1);
  await retain(state, info);
});

test('withheld wording uses the exclusive target-ID request and cannot buy a second mode', async ({ page }, info) => {
  const state = await fixture(page);
  await state.panel.getByLabel('Repair goal', { exact: true }).selectOption('wording-only-outline-repair-v1');
  await choose(state, 'L2', ''); await submit(page, state);
  await expect(state.panel).toContainText('Repair running');
  expect(state.calls.find(call => call.method === 'POST')?.body).toEqual({ version: 'wording-only-outline-repair-v1', targetIds: ['L2'] });
  await expect(state.panel).toContainText('one repair attempt has been used');
  await expect(state.panel.getByLabel('Repair goal', { exact: true })).toHaveCount(0);
  await retain(state, info);
});

test('an unknown start response recovers the same attempt through read-only refresh', async ({ page }, info) => {
  const state = await fixture(page); state.loseNextPost();
  await choose(state); await submit(page, state);
  await expect(state.panel).toContainText('The request may have started.');
  await expect(state.panel.getByRole('button', { name: 'Repair selected wording', exact: true })).toBeDisabled();
  await state.panel.getByRole('button', { name: 'Refresh repair status', exact: true }).click();
  await expect(state.panel).toContainText('Repair running');
  expect(state.calls.filter(call => call.method === 'POST' && call.path.endsWith('/repair'))).toHaveLength(1);
  expect(state.calls.filter(call => call.path === '/api/diagnostics/client-error')).toHaveLength(1);
  await retain(state, info);
});

test('unknown initial identity stays unappliable until parent recovery succeeds', async ({ page }, info) => {
  const state = await fixture(page, { child: 'failed', readFailure: true });
  await expect(state.panel).toContainText('Could not load repair options.');
  await expect(page.getByLabel('Objective 1.1', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add selected to course', exact: true })).toBeHidden();
  state.setReadFailure(false);
  await state.panel.getByRole('button', { name: 'Refresh repair status', exact: true }).click();
  await expect(page.getByLabel('Objective 1.1', { exact: true })).toHaveValue(originalName);
  await expect(state.panel).toContainText('coverage shortfall');
  expect(state.applied).toEqual([]);
  await retain(state, info);
});

test('an incomplete repair read retains a known parent and never selects a completed child', async ({ page }, info) => {
  const state = await fixture(page);
  await page.getByLabel('Objective 1.1', { exact: true }).fill('Keep this edit through failed reads');
  state.setMalformed(true); await state.emit('completed');
  await expect(state.panel).toContainText('Repair options could not be verified.');
  await expect(page.getByLabel('Objective 1.1', { exact: true })).toHaveValue('Keep this edit through failed reads');
  await expect(page.getByRole('button', { name: 'Add selected to course', exact: true })).toBeEnabled();
  state.setMalformed(false); await state.panel.getByRole('button', { name: 'Refresh repair status', exact: true }).click();
  await expect(state.panel.getByRole('button', { name: 'Review repaired draft', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Objective 1.1', { exact: true })).toHaveValue('Keep this edit through failed reads');
  await retain(state, info);
});

test('target pagination retains the selection and enforces two objectives and eight points', async ({ page }, info) => {
  const state = await fixture(page, { paging: true, manyPoints: true });
  await choose(state);
  for (let id = 3; id <= 9; id += 1) await state.panel.getByLabel(`Cover source point E${id} for L1`, { exact: true }).check();
  await expect(state.panel.getByLabel('Cover source point E10 for L1', { exact: true })).toBeDisabled();
  await choose(state, 'L2', 'E12');
  await state.panel.getByRole('button', { name: 'Next repair targets', exact: true }).click();
  await expect(state.panel).toContainText('Page 2 of 2');
  await state.panel.locator('summary').filter({ hasText: /^L11 · Source supported ·/ }).click();
  await expect(state.panel.getByLabel('Select L11 for wording repair', { exact: true })).toBeDisabled();
  await state.panel.getByRole('button', { name: 'Previous repair targets', exact: true }).click();
  await expect(state.panel.getByLabel('Select L1 for wording repair', { exact: true })).toBeChecked();
  await expect(state.panel.getByLabel('Cover source point E9 for L1', { exact: true })).toBeChecked();
  expect(state.calls.filter(call => call.method === 'POST')).toEqual([]);
  await retain(state, info);
});

test('explicit repaired adoption pins the child and labels later instructor wording edits', async ({ page }, info) => {
  const state = await fixture(page, { child: 'completed' });
  await expect(page.getByLabel('Objective 1.1', { exact: true })).toHaveValue(originalName);
  await state.panel.getByRole('button', { name: 'Review repaired draft', exact: true }).click();
  await expect(page.getByLabel('Objective 1.1', { exact: true })).toHaveValue(repairedName);
  await page.getByLabel('Objective 1.1', { exact: true }).fill('Instructor revised the reviewed proposal');
  await page.getByLabel('Include objective 1.2', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Add selected to course', exact: true }).click();
  await expect.poll(() => state.applied).toMatchObject([{ runId: CHILD, themes: [{ los: [{ name: 'Instructor revised the reviewed proposal', sourceThemeIndex: 0, sourceLoIndex: 0 }] }] }]);
  expect(await page.evaluate(() => (window as unknown as { outlineAppliedNotice: string }).outlineAppliedNotice)).toContain('instructor edits');
  await retain(state, info);
});

test('historical ordinary drafts have explicit unavailable repair state and keep the normal apply flow', async ({ page }, info) => {
  const state = await fixture(page, { unavailable: true });
  await expect(page.getByLabel('Objective 1.1', { exact: true })).toHaveValue(originalName);
  await expect(state.panel).toContainText('historical draft has no repair checkpoint');
  await expect(state.panel.getByRole('button', { name: 'Repair selected wording', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Add selected to course', exact: true })).toBeEnabled();
  expect(state.calls.filter(call => call.method === 'POST')).toEqual([]);
  await retain(state, info);
});

for (const baseline of [true, false]) {
  test(`same failed-child input ${baseline ? 'before retained baseline' : 'after current workspace'}`, async ({ page }, info) => {
    const state = await fixture(page, { baseline });
    await page.getByLabel('Objective 1.1', { exact: true }).fill('Retained instructor wording');
    await page.getByLabel('Include objective 1.2', { exact: true }).uncheck();
    await state.emit('failed');
    if (!baseline) await expect(state.panel).toContainText('coverage shortfall');
    await page.reload(); await state.mount();
    if (baseline) {
      await expect(page.getByLabel('Objective 1.1', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Add selected to course', exact: true })).toBeHidden();
      await expect(state.panel).toHaveCount(0);
      expect(state.calls.filter(call => call.path.endsWith('/repair'))).toEqual([]);
    } else {
      await expect(page.getByLabel('Objective 1.1', { exact: true })).toHaveValue('Retained instructor wording');
      await expect(page.getByLabel('Include objective 1.2', { exact: true })).not.toBeChecked();
      await state.panel.locator(':scope > details > summary').click();
      await state.panel.getByText('L1 · Before and after', { exact: true }).click();
      await expect(state.panel).toContainText('Requested: E2. Preserved: E1. Missing: E2. Lost: E1.');
      await expect(state.panel.getByRole('button', { name: 'Review repaired draft', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Add selected to course', exact: true })).toBeEnabled();
    }
    await page.locator('main').screenshot({ path: info.outputPath(`${baseline ? 'before' : 'after'}-same-failed-child-and-reload.png`) });
    expect(state.calls.filter(call => call.method === 'POST')).toEqual([]);
    expect(state.applied).toEqual([]);
    await retain(state, info);
  });
}
