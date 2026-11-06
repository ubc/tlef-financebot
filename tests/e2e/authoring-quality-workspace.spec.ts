import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

const course = '111111111111111111111111';
const batchId = '222222222222222222222222';
const ids = ['333333333333333333333333', '444444444444444444444444'];
const material = (i: number, ready: boolean) => ({ _id: ids[i], courseId: course, name: `Chapter ${i + 1}.pdf`, format: 'pdf', status: ready ? 'ready' : 'processing', assignments: [], uploadedAt: '2026-10-13T17:00:00Z' });

async function fixture(page: Page) {
  let ready = false, uploaded = false, rejected = false, missingSecond = false;
  const calls: string[] = [];
  const selections: Record<string, unknown>[] = [];
  const sources = () => ids.map((id, i) => ({ materialId: id, name: `Chapter ${i + 1}.pdf`, ready: i === 0 || ready,
    state: i === 0 || ready ? 'indexed' : 'processing', reason: i === 0 || ready ? undefined : 'material-processing', classification: 'pending',
    snapshot: i === 0 || ready ? { materialId: id, name: `Chapter ${i + 1}.pdf`, sourceTextHash: 'hash', chunkCount: 20, characterCount: 20000, parserVersion: 'fixture', chunkerVersion: 'fixture' } : undefined }));
  const receipt = () => ({ _id: batchId, courseId: course, requestId: 'request', revision: 1, admission: rejected ? 'rejected' : uploaded ? 'accepted' : 'prepared',
    counts: { requested: 2, received: uploaded ? 2 : 0, ready: ready ? 2 : uploaded ? 1 : 0, rejected: rejected ? 2 : 0 },
    items: ids.map((id, i) => ({ clientFileId: String(i), name: `Chapter ${i + 1}.pdf`, size: 3, disposition: rejected ? 'rejected' : uploaded ? 'created' : 'pending', materialId: uploaded ? id : undefined, readiness: uploaded ? sources()[i] : undefined, error: rejected ? 'Upload interrupted' : undefined })) });
  await page.addInitScript(() => {
    class Stream {
      static instances: Stream[] = [];
      listeners = new Map<string, Array<(event: { data: string }) => void>>();
      constructor() { Stream.instances.push(this); }
      addEventListener(type: string, listener: (event: { data: string }) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
      close() { Stream.instances = Stream.instances.filter(stream => stream !== this); }
    }
    Object.assign(window, { EventSource: Stream, emitMaterialRun: (value: unknown) => Stream.instances.forEach(stream => stream.listeners.get('run')?.forEach(listener => listener({ data: JSON.stringify(value) }))) });
  });
  await page.route('**/fixture', route => route.fulfill({ contentType: 'text/html', body: '<html lang="en"><head><title>Authoring quality</title><link rel="stylesheet" href="/styles/main.css"></head><body><main></main></body></html>' }));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/material-upload-batches')) { calls.push('prepare'); return route.fulfill({ json: receipt() }); }
    if (path.endsWith(`/material-upload-batches/${batchId}/files`)) {
      calls.push('multipart');
      if (rejected) return route.fulfill({ status: 400, json: { error: 'Upload interrupted' } });
      uploaded = true; return route.fulfill({ json: receipt() });
    }
    if (path.endsWith(`/material-upload-batches/${batchId}`)) return route.fulfill({ json: receipt() });
    if (path.endsWith('/source-readiness')) {
      const body = route.request().postDataJSON() as { materialIds?: string[] };
      const requested = sources().filter(source => !body.materialIds || body.materialIds.includes(source.materialId));
      return route.fulfill({ json: { requested, included: requested.flatMap(source => source.snapshot ? [source.snapshot] : []), excluded: body.materialIds ? sources().filter(source => !body.materialIds!.includes(source.materialId)).map(source => ({ name: source.name, materialId: source.materialId, reason: 'instructor-selected-subset' })) : [], ready: requested.every(source => source.ready) } });
    }
    if (path.endsWith('/structure-generation')) { selections.push(route.request().postDataJSON()); return route.fulfill({ json: { runId: 'run1' } }); }
    if (path.endsWith('/content-runs/run1')) return route.fulfill({ json: { _id: 'run1', courseId: course, kind: 'structure-generation', revision: 1, status: 'running', stage: 'analyzing', input: selections.at(-1), createdAt: '2026-10-13', warnings: [] } });
    if (path.endsWith('/materials')) return route.fulfill({ json: uploaded ? ids.map((_, i) => material(i, i === 0 || ready)).filter(row => !missingSecond || row._id !== ids[1]) : [] });
    if (path.endsWith('/workspace')) return route.fulfill({ json: { material: material(path.includes(ids[0]) ? 0 : 1, ready), chunks: [] } });
    if (path.endsWith('/knowledge-graph')) return route.fulfill({ json: { nodes: [], edges: [] } });
    if (path.endsWith('/tree')) return route.fulfill({ json: { _id: course, name: 'Finance', themes: [] } });
    return route.fulfill({ json: [] });
  });
  await page.goto('/fixture');
  const openMaterials = () => page.evaluate(async id => { (await import('/js/views/instructor/materials.js')).renderMaterials(document.querySelector('main')!, { id }); }, course);
  return { calls, selections, openMaterials, ready: () => { ready = true; }, rejected: () => { rejected = true; }, uploaded: () => { uploaded = true; }, removeSecond: () => { missingSecond = true; } };
}

test('records both intended chapters before multipart, waits, recovers on reload and includes every source', async ({ page }) => {
  const state = await fixture(page); await state.openMaterials();
  await page.locator('input[type=file]').setInputFiles([{ name: 'Chapter 1.pdf', mimeType: 'application/pdf', buffer: Buffer.from('one') }, { name: 'Chapter 2.pdf', mimeType: 'application/pdf', buffer: Buffer.from('two') }]);
  await expect(page.getByText('Latest upload · 1/2 sources indexed')).toBeVisible();
  expect(state.calls).toEqual(['prepare', 'multipart']);
  await page.getByRole('button', { name: /Build knowledge base/ }).click();
  await expect(page.getByRole('log')).toContainText('Chapter 2.pdf (material-processing)');
  expect(state.selections).toHaveLength(0);
  await page.reload(); await state.openMaterials();
  await expect(page.getByText('Latest upload · 1/2 sources indexed')).toBeVisible();
  state.ready(); await page.getByRole('button', { name: 'Refresh source status' }).click();
  await page.getByRole('button', { name: /Build knowledge base/ }).click();
  await expect.poll(() => state.selections[0]).toEqual({ materialIds: ids, sourceBatchId: batchId });
});

test('failed admission keeps every filename visible and makes no paid structure request', async ({ page }) => {
  const state = await fixture(page); state.rejected(); await state.openMaterials();
  await page.locator('input[type=file]').setInputFiles([{ name: 'Chapter 1.pdf', mimeType: 'application/pdf', buffer: Buffer.from('one') }, { name: 'Chapter 2.pdf', mimeType: 'application/pdf', buffer: Buffer.from('two') }]);
  await expect(page.getByText('Latest upload · 0/2 sources indexed')).toBeVisible();
  await expect(page.locator('.workspace-message').filter({ has: page.locator('summary') })).toContainText('Chapter 1.pdf');
  await expect(page.locator('.workspace-message').filter({ has: page.locator('summary') })).toContainText('Chapter 2.pdf');
  expect(state.selections).toHaveLength(0);
});

test('structure defaults to all chapters, permits explicit exclusions and records source replacement', async ({ page }) => {
  const state = await fixture(page); state.uploaded();
  await page.evaluate(async ({ course, ids }) => {
    const owner = document.querySelector('main')!;
    const materials = ids.map((id, i) => ({ _id: id, courseId: course, name: `Chapter ${i + 1}.pdf`, format: 'pdf', status: i === 0 ? 'ready' : 'processing', assignments: [] }));
    const assistant = (await import('/js/views/instructor/structure-ai-workbench.js')).createStructureAssistant(course, materials, () => {}, async () => {}, owner);
    owner.append(assistant.element); assistant.open();
  }, { course, ids });
  await page.getByRole('button', { name: 'Generate draft →' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Sources are not ready:' })).toContainText('Chapter 2.pdf');
  expect(state.selections).toHaveLength(0);
  state.ready();
  await page.getByRole('button', { name: 'Refresh source status', exact: true }).click();
  await expect(page.getByLabel('Use Chapter 2.pdf').locator('..')).toContainText('Ready to use');
  await page.locator('.structure-ai-settings > summary').click();
  await page.getByText('Replace a source for this analysis', { exact: true }).click();
  await page.getByLabel('Earlier source to replace').selectOption(ids[0]);
  await page.getByLabel('Replacement source', { exact: true }).selectOption(ids[1]);
  await page.getByRole('button', { name: 'Use replacement' }).click();
  await page.getByRole('button', { name: 'Generate draft →' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Analyze selected sources' }).click();
  expect(state.selections[0]).toMatchObject({ materialIds: [ids[1]], sourceReplacements: [{ previousMaterialId: ids[0], replacementMaterialId: ids[1] }] });
});

test('material-ingest completion automatically unlocks a newly ready sole-selected chapter without resetting selection', async ({ page }) => {
  const state = await fixture(page); state.uploaded();
  await page.evaluate(async ({ course, ids }) => {
    const owner = document.querySelector('main')!;
    const assistant = (await import('/js/views/instructor/structure-ai-workbench.js')).createStructureAssistant(course,
      ids.map((id, index) => ({ _id: id, courseId: course, name: `Chapter ${index + 1}.pdf`, format: 'pdf', status: index === 0 ? 'ready' : 'processing', assignments: [] })), () => {}, async () => {}, owner);
    owner.append(assistant.element); assistant.open();
  }, { course, ids });
  await page.getByLabel('Use Chapter 1.pdf').uncheck();
  await expect(page.getByRole('button', { name: 'Generate draft →' })).toBeDisabled();
  state.ready();
  await page.evaluate(({ course, id }) => (window as unknown as { emitMaterialRun(value: unknown): void }).emitMaterialRun({
    _id: 'ingest2', courseId: course, kind: 'material-ingest', status: 'completed', stage: 'classifying', revision: 3,
    input: { materialId: id }, createdAt: '2026-10-13T17:00:00Z',
  }), { course, id: ids[1] });
  await expect(page.getByLabel('Use Chapter 2.pdf').locator('..')).toContainText('Ready to use');
  await expect(page.getByLabel('Use Chapter 1.pdf')).not.toBeChecked();
  await expect(page.getByLabel('Use Chapter 2.pdf')).toBeChecked();
  await expect(page.getByRole('button', { name: 'Generate draft →' })).toBeEnabled();
  await page.getByRole('button', { name: 'Generate draft →' }).click();
  await expect(page.getByRole('dialog')).toContainText('Chapter 1.pdf (instructor-selected-subset)');
  await page.getByRole('button', { name: 'Analyze selected sources' }).click();
  await expect.poll(() => state.selections[0]).toEqual(expect.objectContaining({ materialIds: [ids[1]] }));
});

test('refresh marks a removed source unavailable while preserving the instructor selection for correction', async ({ page }) => {
  const state = await fixture(page); state.uploaded(); state.ready();
  await page.evaluate(async ({ course, ids }) => {
    const owner = document.querySelector('main')!;
    const assistant = (await import('/js/views/instructor/structure-ai-workbench.js')).createStructureAssistant(course,
      ids.map((id, index) => ({ _id: id, courseId: course, name: `Chapter ${index + 1}.pdf`, format: 'pdf', status: 'ready', assignments: [] })), () => {}, async () => {}, owner);
    owner.append(assistant.element); assistant.open();
  }, { course, ids });
  await page.getByLabel('Use Chapter 1.pdf').uncheck();
  await expect(page.getByRole('button', { name: 'Generate draft →' })).toBeEnabled();
  state.removeSecond();
  await page.getByRole('button', { name: 'Refresh source status', exact: true }).click();
  await expect(page.getByLabel('Use Chapter 2.pdf').locator('..')).not.toContainText('Ready to use');
  await expect(page.getByLabel('Use Chapter 2.pdf')).toBeChecked();
  await expect(page.getByLabel('Use Chapter 1.pdf')).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Generate draft →' })).toBeDisabled();
  expect(state.selections).toEqual([]);
});

test('source receipt remains readable at a narrow dark viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page); state.uploaded();
  await page.evaluate(({ course, batchId }) => { document.documentElement.dataset.theme = 'dark'; sessionStorage.setItem(`financebot:source-batch:unknown:${course}`, batchId); }, { course, batchId });
  await state.openMaterials();
  await expect(page.getByText('Latest upload · 1/2 sources indexed')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const scan = await new AxeBuilder({ page }).include('.knowledge-workspace__assistant').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(scan.violations).toEqual([]);
});

for (const mobile of [false, true]) test(`materials-first guide waits for every intended source, consumes the async outline and applies only selected items (${mobile ? 'mobile dark' : 'desktop light'})`, async ({ page }) => {
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
  const state = await fixture(page); state.uploaded();
  let applied: Record<string, unknown> | undefined;
  const proposed = 'Risk and return from both chapters';
  await page.route(`**/api/courses/${course}/content-runs/run1`, route => route.fulfill({ json: {
    _id: 'run1', courseId: course, kind: 'structure-generation', revision: 3, status: 'completed', stage: 'checking', warnings: [],
    structureResult: { themes: [{ name: proposed, los: [{ name: 'Distinguish systematic and diversifiable risk', materialIds: ids, evidenceIds: ['E1'] }, { name: 'Exclude this objective', materialIds: [ids[1]], evidenceIds: ['E2'] }] }], evidence: [],
      coverage: { materials: ids.map((materialId, index) => ({ materialId, name: `Chapter ${index + 1}.pdf`, chunks: 20, sections: 2, mappedObjectives: 1 })), analyzedSections: 4, extractedObjectives: 2, mappedObjectives: 2, excludedSections: [], unmappedEvidenceIds: [], warnings: [], sourceSelection: { requested: ids.map(materialId => ({ materialId, ready: true })), included: ids.map(materialId => ({ materialId })), excluded: [], ready: true } } },
  } }));
  await page.route(`**/api/courses/${course}/apply-suggested-hierarchy`, route => { applied = route.request().postDataJSON(); return route.fulfill({ json: { themesCreated: 1, losCreated: 1, assignmentsCreated: 2, materialsAssigned: 2 } }); });
  await page.route(`**/api/courses/${course}`, route => route.fulfill({ json: { _id: course, name: 'Finance', themes: applied ? [{ _id: 'topic', name: proposed, los: [{ _id: 'lo', themeId: 'topic', name: 'Distinguish systematic and diversifiable risk', order: 0 }], order: 0 }] : [] } }));
  await page.route(`**/api/courses/${course}/instructor-workflow`, route => route.fulfill({ json: {
    counts: { learningObjectives: applied ? 1 : 0, totalQuestions: 0, approvedQuestions: 0 },
    setup: { steps: [] },
  } }));
  await page.route(`**/api/courses/${course}/generation-plan`, route => route.fulfill({ json: applied ? [{
    loId: 'lo', loName: 'Explain the risk that diversification cannot remove', themeName: proposed, loKind: 'conceptual',
    approved: { easy: 0, medium: 0, hard: 0 }, cells: [{ difficulty: 'easy', kind: 'conceptual', count: 3 }],
  }] : [] }));
  await page.route(`**/api/courses/${course}/materials`, route => route.fulfill({ json: ids.map((_, index) => ({
    ...material(index, true), assignments: applied ? [{ themeId: 'topic', loId: 'lo' }] : [],
  })) }));
  await page.evaluate(({ course, batchId, mobile }) => { document.documentElement.dataset.theme = mobile ? 'dark' : 'light'; sessionStorage.setItem(`financebot:source-batch:unknown:${course}`, batchId); }, { course, batchId, mobile });
  await page.evaluate(async courseId => { (await import('/js/views/instructor/course-setup-guide.js')).openCourseSetupGuide({ courseId, actionId: 'build-structure', learningObjectiveCount: 0, onChanged() {} }); }, course);
  const guide = page.getByRole('dialog', { name: 'Prepare this course, one step at a time' });
  await guide.getByRole('button', { name: 'Generate an AI draft' }).click();
  await expect(guide.getByText(/Sources are not ready:/)).toContainText('Chapter 2.pdf');
  expect(state.selections).toEqual([]);
  state.ready();
  await guide.getByRole('button', { name: 'Generate an AI draft' }).click();
  await expect(guide.getByLabel('Suggested Topic 1 name')).toHaveValue(proposed);
  expect(state.selections[0]).toEqual({ materialIds: ids, sourceBatchId: batchId });
  await guide.getByLabel('Include suggested Topic 1 Learning Objective 2').uncheck();
  await guide.getByLabel('Suggested Topic 1 Learning Objective 1 name').fill('Explain the risk that diversification cannot remove');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const scan = await new AxeBuilder({ page }).include('.course-setup-guide').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(scan.violations).toEqual([]);
  await mkdir('artifacts/quality-authoring-2026-10-13', { recursive: true });
  await page.screenshot({ path: `artifacts/quality-authoring-2026-10-13/source-guide-${mobile ? 'mobile-dark' : 'desktop-light'}.png`, fullPage: true });
  await guide.getByRole('button', { name: 'Apply selected structure' }).click();
  await expect.poll(() => applied).toEqual({ runId: 'run1', themes: [{ name: proposed, los: [{ name: 'Explain the risk that diversification cannot remove', materialIds: ids, sourceThemeIndex: 0, sourceLoIndex: 0 }] }] });
  await expect(guide.getByRole('heading', { name: 'Generate questions', exact: true })).toBeVisible();
  await expect(guide.getByRole('button', { name: 'Generate questions', exact: true })).toBeEnabled();
});
