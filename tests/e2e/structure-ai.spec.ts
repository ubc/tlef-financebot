import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('inline AI outline streams, recovers, edits, inspects evidence and applies the selected subset', async ({ page }) => {
  let run: Record<string, unknown> | undefined;
  let submitted: unknown; let applied: { runId: string; themes: Array<{ name: string; los: Array<{ name: string; sourceThemeIndex: number; sourceLoIndex: number }> }> } | undefined;
  let applyFails = true;
  const m1 = '111111111111111111111111', m2 = '222222222222222222222222';
  await page.addInitScript(() => {
    class Stream {
      static instances: Stream[] = [];
      listeners = new Map<string, Array<(event: { data: string }) => void>>();
      constructor() { Stream.instances.push(this); }
      addEventListener(type: string, fn: (event: { data: string }) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
      close() { Stream.instances = Stream.instances.filter(s => s !== this); }
    }
    Object.assign(window, { EventSource: Stream, emitRun: (data: unknown) => Stream.instances.forEach(s => s.listeners.get('run')?.forEach(fn => fn({ data: JSON.stringify(data) }))) });
  });
  await page.route('**/fixture', r => r.fulfill({ contentType: 'text/html', body: '<html lang="en"><head><title>Structure</title><link rel="stylesheet" href="/styles/main.css"></head><body><main></main></body></html>' }));
  await page.route('**/api/**', async r => {
    const path = new URL(r.request().url()).pathname;
    if (path.endsWith('/source-readiness')) {
      const input = r.request().postDataJSON() as { materialIds?: string[] };
      const requested = (input.materialIds ?? []).map(materialId => ({ materialId, name: materialId, ready: true, state: 'indexed', classification: 'completed', snapshot: { materialId, name: materialId, sourceTextHash: 'fixture', chunkCount: 1, characterCount: 100, parserVersion: 'fixture', chunkerVersion: 'fixture' } }));
      return r.fulfill({ json: { requested, included: requested.map(item => item.snapshot), excluded: [], ready: true } });
    }
    if (path.endsWith('/structure-generation')) {
      submitted = r.request().postDataJSON(); run = { _id: 'run1', kind: 'structure-generation', status: 'running', stage: 'analyzing', completedUnits: 0, totalUnits: 3, revision: 1, createdAt: '2026-09-15', input: submitted };
      return r.fulfill({ json: { runId: 'run1' } });
    }
    if (path.endsWith('/content-runs/run1')) return r.fulfill({ json: run });
    if (path.endsWith('/content-runs')) return r.fulfill({ json: run ? [run] : [] });
    if (path.endsWith('/apply-suggested-hierarchy')) {
      applied = r.request().postDataJSON();
      if (applyFails) { applyFails = false; return r.fulfill({ status: 409, json: { error: 'structure-apply-conflict-after-write' } }); }
      return r.fulfill({ json: { themesCreated: 1, losCreated: 1, assignmentsCreated: 2, materialsAssigned: 2, consistency: 'best-effort', warning: 'Sources were checked before and after applying. This database does not support atomic source adoption; concurrent source changes cannot be ruled out.' } });
    }
    if (path.endsWith('/preseeding')) return r.fulfill({ json: [] });
    if (path.endsWith('/materials')) return r.fulfill({ json: [{ _id: m1, name: 'Lecture.pdf', status: 'ready', assignments: [] }, { _id: m2, name: 'Assignment.pdf', status: 'ready', assignments: [] }] });
    return r.fulfill({ json: { themes: [{ _id: 'saved', name: 'Existing topic', los: [{ _id: 'lo', name: 'Existing objective' }] }] } });
  });
  const mount = () => page.evaluate(async () => { (await import('/js/views/instructor/structure.js')).renderStructure(document.querySelector('main')!, { id: 'course' }); });
  const emit = () => page.evaluate(value => (window as unknown as { emitRun: (v: unknown) => void }).emitRun(value), run);
  await page.goto('/fixture'); await mount();
  await page.getByRole('button', { name: 'AI draft', exact: true }).click();
  await expect(page.getByLabel('Topic count')).toBeHidden();
  await page.locator('.structure-ai-settings > summary').click();
  await expect(page.getByLabel('Topic count')).toHaveValue('');
  await page.getByLabel('Course level').selectOption('introductory');
  await page.getByRole('button', { name: 'Generate draft →', exact: true }).click();
  await expect.poll(() => submitted).toMatchObject({ materialIds: [m1, m2], level: 'introductory' });
  expect(submitted).not.toHaveProperty('topicCount');
  await expect(page.getByRole('button', { name: 'Generating…' })).toBeDisabled();
  run = { ...run, stage: 'synthesizing', revision: 2, structurePreview: { themes: [{ name: 'Mechanics', los: [{ name: 'Calculate acc' }] }] } };
  await emit();
  await expect(page.locator('.structure-ai-draft-row')).toContainText('Calculate acc');
  run = { ...run, revision: 3, structurePreview: { themes: [{ name: 'Mechanics', los: [{ name: 'Calculate acceleration using force vectors' }] }] } };
  await emit();
  await expect(page.locator('.structure-ai-draft-row')).toContainText('Calculate acceleration using force vectors');
  await page.reload(); await mount(); await page.getByRole('button', { name: 'AI draft', exact: true }).click();
  await expect(page.locator('.structure-ai-draft-row')).toContainText('Calculate acceleration using force vectors');
  run = { ...run, status: 'completed', revision: 4, structureResult: {
    themes: [{ name: 'Mechanics', los: [{ name: 'Calculate acceleration', evidenceIds: ['E1', 'E2', 'E3'], materialIds: [m1, m2] }, { name: 'Resolve force vectors', evidenceIds: ['E2'], materialIds: [m2] }] }],
    evidence: [{ id: 'E3', materialId: m1, materialName: 'Lecture.pdf', chunkIndex: 9, quote: 'Newton’s second law relates force to acceleration.', supportingPassages: [{ passageId: 'C10.S1.P2', quote: 'The mass is constant and the reference frame is inertial.' }] }, { id: 'E1', materialId: m1, materialName: 'Lecture.pdf', chunkIndex: 9, quote: 'Newton’s second law relates force to acceleration.', supportingPassages: [{ passageId: 'C10.S1.P3', quote: 'State the direction of the resulting acceleration.' }] }, { id: 'E2', materialId: m2, materialName: 'Assignment.pdf', chunkIndex: 1, quote: 'Resolve the force vector into components.' }],
    coverage: { materials: [{ materialId: m1, name: 'Lecture.pdf', chunks: 10, mappedObjectives: 1 }, { materialId: m2, name: 'Assignment.pdf', chunks: 2, mappedObjectives: 1 }], analyzedSections: 12, extractedObjectives: 2, mappedObjectives: 2, unmappedEvidenceIds: [], excludedSections: [], warnings: ['Check source diagrams.'],
      sourceInventory: { version: 'source-passage-inventory-v1', totalPassages: 5, objectiveLinkedPassages: 4, mappedPassages: 4, materialsWithoutMappedObjectives: [], potentialRedundantObjectives: [], redundancyAudit: { objectivesConsidered: 2, totalObjectives: 2, truncated: false },
        targets: [{ materialId: m2, materialName: 'Assignment.pdf', chunkIndex: 1, sectionId: 'C2.S1', passageId: 'C2.S1.P2', cues: ['visual-relationship'], status: 'visual-review', evidenceIds: [], reason: 'Plotted chart values did not survive text extraction.', quote: 'The original chart labels remain visible.' }] } },
  } };
  await emit();
  await expect(page.getByRole('textbox', { name: 'Draft topic 1 name', exact: true })).toHaveValue('Mechanics');
  await expect(page.getByRole('textbox', { name: 'Objective 1.2', exact: true })).toHaveValue('Resolve force vectors');
  await expect(page.locator('.structure-ai-evidence').first().locator('blockquote')).toHaveCount(4);
  const longObjective = 'Analyze a complete physical situation by identifying every external force, resolving the forces into components, calculating the resulting acceleration, and explaining the assumptions and the direction of the result.';
  await page.getByRole('textbox', { name: 'Objective 1.1', exact: true }).fill(longObjective);
  await page.setViewportSize({ width: 900, height: 900 });
  const field = page.getByRole('textbox', { name: 'Objective 1.1', exact: true });
  await expect.poll(() => field.evaluate(n => n.scrollHeight <= n.clientHeight)).toBe(true);
  await field.fill('Calculate acceleration from a force diagram');
  await page.getByLabel('Include objective 1.2').uncheck();
  await page.getByText('2 supporting materials · View evidence').click();
  await expect(page.getByText('Newton’s second law relates force to acceleration.')).toBeVisible();
  await expect(page.getByText('The mass is constant and the reference frame is inertial.')).toBeVisible();
  await expect(page.getByText('State the direction of the resulting acceleration.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Lecture.pdf · Section 10 ↗' }).first()).toHaveAttribute('href', /materials/);
  await page.getByText('Source coverage ·', { exact: false }).click();
  const coverageReview = page.getByRole('region', { name: 'Source coverage review', exact: true });
  await coverageReview.getByLabel('Review category').selectOption('visual');
  await coverageReview.locator('[data-row-kind="passage"][data-review-id="C2.S1.P2"] > summary').click();
  await expect(page.getByText('Plotted chart values did not survive text extraction.')).toBeVisible();
  await expect(page.getByText('The original chart labels remain visible.')).toBeVisible();
  await page.getByRole('button', { name: 'Add selected to course' }).click();
  await expect(page.getByText('Some additions may have been retained.', { exact: false })).toBeVisible();
  await expect(page.getByText('Inspect the saved course structure and sources before trying again.', { exact: false })).toBeVisible();
  expect(applied?.themes[0].los).toEqual([expect.objectContaining({ name: 'Calculate acceleration from a force diagram' })]);
  expect(applied).toMatchObject({ runId: 'run1', themes: [{ los: [{ sourceThemeIndex: 0, sourceLoIndex: 0 }] }] });
  await emit();
  await expect(page.getByRole('textbox', { name: 'Objective 1.1', exact: true })).toHaveValue('Calculate acceleration from a force diagram');
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.screenshot({ path: '/tmp/structure-ai-desktop.png', fullPage: true });
  const axe = await new AxeBuilder({ page }).include('.structure-ai').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  expect((await new AxeBuilder({ page }).include('.structure-ai').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: '/tmp/structure-ai-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Add selected to course' }).click();
  await expect(page.getByRole('button', { name: 'AI draft', exact: true })).toBeVisible();
  await expect(page.locator('.outline-lo-row').filter({ hasText: 'Existing objective' })).toBeVisible();
  await expect(page.locator('.structure-action-notice')).toContainText('does not support atomic source adoption');
});

test('empty-course app shell opens the composer, reports failures and keeps a running draft across navigation', async ({ page }) => {
  const course = '111111111111111111111111', material = '222222222222222222222222';
  let posts = 0, rejectStart = true, failSnapshot = true;
  let run: Record<string, unknown> | undefined;
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    class Stream {
      static instances: Stream[] = [];
      listeners = new Map<string, Array<(event: { data: string }) => void>>();
      constructor() { Stream.instances.push(this); }
      addEventListener(type: string, fn: (event: { data: string }) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
      close() { Stream.instances = Stream.instances.filter(s => s !== this); }
    }
    Object.assign(window, { EventSource: Stream, emitRun: (data: unknown) => Stream.instances.forEach(s => s.listeners.get('run')?.forEach(fn => fn({ data: JSON.stringify(data) }))) });
  });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/source-readiness')) {
      const input = route.request().postDataJSON() as { materialIds?: string[] };
      const requested = (input.materialIds ?? []).map(materialId => ({ materialId, name: materialId, ready: true, state: 'indexed', classification: 'completed', snapshot: { materialId, name: materialId, sourceTextHash: 'fixture', chunkCount: 1, characterCount: 100, parserVersion: 'fixture', chunkerVersion: 'fixture' } }));
      return route.fulfill({ json: { requested, included: requested.map(item => item.snapshot), excluded: [], ready: true } });
    }
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { authenticated: true, roles: ['faculty'], user: { puid: 'teacher', displayName: 'Test Instructor', courseRoles: [{ courseId: course, role: 'instructor' }] } } });
    if (path.endsWith('/structure-generation')) {
      posts++;
      if (rejectStart) return route.fulfill({ status: 409, json: { error: 'structure-chunks-missing' } });
      run = { _id: 'run-shell', kind: 'structure-generation', status: 'running', stage: 'analyzing', completedUnits: 0, totalUnits: 10, revision: 1, createdAt: '2026-09-15', input: route.request().postDataJSON() };
      return route.fulfill({ status: 202, json: { runId: 'run-shell' } });
    }
    if (path.endsWith('/content-runs/run-shell')) {
      if (failSnapshot) { failSnapshot = false; return route.fulfill({ status: 503, json: { error: 'Temporary snapshot failure' } }); }
      return route.fulfill({ json: run });
    }
    if (path.endsWith('/content-runs')) return route.fulfill({ json: run ? [run] : [] });
    if (path.endsWith('/materials')) return route.fulfill({ json: [{ _id: material, name: 'Synthetic lecture.pdf', status: 'ready', assignments: [] }] });
    if (path === `/api/courses/${course}`) return route.fulfill({ json: { _id: course, name: 'Mechanics', courseCode: 'PHYS 100', term: '2026', themes: [] } });
    return route.fulfill({ json: [] });
  });
  await page.goto(`/#/instructor/course/${course}/structure`);
  await expect(page.getByRole('heading', { name: 'Shape your outline' })).toBeVisible();
  const generate = page.getByRole('button', { name: 'Generate draft →', exact: true });
  await generate.click();
  await expect(page.locator('.structure-ai-message')).toContainText('Reprocess them in Course Materials');
  await expect(generate).toBeEnabled();
  rejectStart = false;
  await generate.click();
  await expect(page.getByRole('button', { name: 'Generating…' })).toBeDisabled();
  await expect(page.locator('.structure-ai-message')).toContainText('Reconnecting to its live progress');
  await page.evaluate(value => (window as unknown as { emitRun: (v: unknown) => void }).emitRun(value), run);
  await expect(page.locator('.structure-ai-status')).toContainText('0 / 10 sections');
  await page.getByRole('button', { name: 'Course outline · 0', exact: true }).click();
  await expect(page.getByText('Make space for what students will learn.')).toBeVisible();
  await page.getByRole('button', { name: 'AI draft', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Generating…' })).toBeDisabled();
  run = { ...run, status: 'failed', revision: 2, error: { code: 'structure-analysis-invalid' } };
  await page.evaluate(value => (window as unknown as { emitRun: (v: unknown) => void }).emitRun(value), run);
  await expect(page.locator('.structure-ai-message')).toContainText('source analysis could not be validated');
  await expect(generate).toBeEnabled();
  await generate.click();
  await expect.poll(() => posts).toBe(3);
  await expect(page.locator('.structure-ai-message')).toHaveText('');
  run = { ...run, stage: 'synthesizing', revision: 3, structurePreview: { themes: [{ name: 'Force and motion', los: [{ name: 'Describe the forces' }] }] } };
  await page.evaluate(value => (window as unknown as { emitRun: (v: unknown) => void }).emitRun(value), run);
  await expect(page.locator('.structure-ai-draft-row')).toContainText('Describe the forces');
  // Re-enter through the actual shell/router, not a component-only mount.
  await page.getByRole('link', { name: 'Back to all courses', exact: true }).click();
  await expect(page).toHaveURL(/instructor\/courses/);
  await page.goBack();
  await expect(page.locator('.structure-ai-draft-row')).toContainText('Describe the forces');
  await page.reload();
  await expect(page.locator('.structure-ai-draft-row')).toContainText('Describe the forces');
  expect(posts).toBe(3);
  expect(errors).toEqual([]);
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.screenshot({ path: '/tmp/structure-ai-shell.png', fullPage: true });
});

test('no ready sources explains the prerequisite instead of leaving a silent generate control', async ({ page }) => {
  await page.route('**/fixture', r => r.fulfill({ contentType: 'text/html', body: '<html lang="en"><head><title>Structure</title><link rel="stylesheet" href="/styles/main.css"></head><body><main></main></body></html>' }));
  await page.route('**/api/**', r => {
    const path = new URL(r.request().url()).pathname;
    if (path.endsWith('/source-readiness')) {
      const input = r.request().postDataJSON() as { materialIds?: string[] };
      const requested = (input.materialIds ?? []).map(materialId => ({ materialId, name: materialId, ready: true, state: 'indexed', classification: 'completed', snapshot: { materialId, name: materialId, sourceTextHash: 'fixture', chunkCount: 1, characterCount: 100, parserVersion: 'fixture', chunkerVersion: 'fixture' } }));
      return r.fulfill({ json: { requested, included: requested.map(item => item.snapshot), excluded: [], ready: true } });
    }
    if (path.endsWith('/materials')) return r.fulfill({ json: [{ _id: 'm1', name: 'Processing.pdf', status: 'processing', assignments: [] }] });
    if (path.endsWith('/preseeding') || path.endsWith('/content-runs')) return r.fulfill({ json: [] });
    if (path.endsWith('/events')) return r.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: snapshot\ndata: []\n\n' });
    return r.fulfill({ json: { themes: [] } });
  });
  await page.goto('/fixture');
  await page.evaluate(async () => { (await import('/js/views/instructor/structure.js')).renderStructure(document.querySelector('main')!, { id: 'course' }); });
  await expect(page.getByRole('button', { name: 'Generate draft →' })).toBeDisabled();
  await expect(page.getByText('Upload a material and wait for processing to finish before generating.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Course Materials →' })).toHaveAttribute('href', '#/instructor/course/course/materials');
});

const groundingMaterial = '333333333333333333333333';
const groundingFinding = (id: string, status: 'supported' | 'unsupported' | 'uncertain') => ({
  id, themeIndex: 0, loIndex: id === 'L1' ? 0 : 1, topic: 'Risk and return',
  name: status === 'supported' ? 'Calculate expected return from beta' : `Read the exact 1989 chart value (${id})`,
  contentHash: 'fixture-only', evidenceIds: [id === 'L1' ? 'E1' : 'E2'], materialIds: [groundingMaterial], sourceIds: ['S1'],
  learningPoints: [{ id: id === 'L1' ? 'E1' : 'E2', objective: 'Read a chart relationship', materialId: groundingMaterial, sourceIds: ['S1'] }],
  status, reason: 'The extracted chart labels do not establish an exact plotted value.',
  citedSourceIds: status === 'supported' ? ['S1'] : [], coveredEvidenceIds: status === 'supported' ? ['E1'] : [],
});

async function mountGroundingSnapshot(page: Page, run: Record<string, unknown>, onApply?: (body: unknown) => void): Promise<string[]> {
  const mutations: string[] = [];
  await page.addInitScript(() => {
    Object.assign(window, { EventSource: class { addEventListener() {} close() {} } });
  });
  await page.route('**/fixture', route => route.fulfill({ contentType: 'text/html', body: '<html lang="en"><head><title>Outline source review</title><link rel="stylesheet" href="/styles/main.css"></head><body><main></main></body></html>' }));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') mutations.push(path);
    if (path.endsWith('/apply-suggested-hierarchy') && onApply) {
      onApply(route.request().postDataJSON());
      return route.fulfill({ json: { themesCreated: 1, losCreated: 1, assignmentsCreated: 1, materialsAssigned: 1, consistency: 'atomic' } });
    }
    if (path.endsWith('/content-runs')) return route.fulfill({ json: [run] });
    if (path.endsWith('/materials')) return route.fulfill({ json: [{ _id: groundingMaterial, name: 'Chart lecture.pdf', status: 'ready', assignments: [] }] });
    if (path.endsWith('/preseeding')) return route.fulfill({ json: [] });
    return route.fulfill({ json: { themes: [] } });
  });
  await page.goto('/fixture');
  await page.evaluate(async () => { (await import('/js/views/instructor/structure.js')).renderStructure(document.querySelector('main')!, { id: 'course' }); });
  return mutations;
}

for (const partial of [false, true]) test(`failed ${partial ? 'partial' : 'all-withheld'} original-source review exposes reasons without an applicable streamed draft`, async ({ page }) => {
  const findings = partial ? [groundingFinding('L1', 'uncertain')] : [groundingFinding('L1', 'uncertain'), groundingFinding('L2', 'unsupported')];
  const mutations = await mountGroundingSnapshot(page, {
    _id: 'grounding-failed', kind: 'structure-generation', status: 'failed', stage: 'checking', revision: 3, createdAt: '2026-10-16',
    input: { materialIds: [groundingMaterial] }, error: { code: partial ? 'structure-budget-exhausted' : 'structure-grounding-no-supported-objectives' },
    structurePreview: { themes: [{ name: 'Unvalidated streamed topic', los: [{ name: 'Unvalidated streamed objective' }] }] },
    structureDiagnostics: { outlineGrounding: { version: 'original-final-lo-review-v1', method: 'model-review-of-original-sections',
      totalObjectives: 2, reviewedObjectives: findings.length, supportedObjectives: 0, withheldObjectives: findings.length, complete: !partial, findings } },
  });
  const review = page.getByLabel('Original-source review', { exact: true });
  await expect(review).toBeVisible();
  await expect(review.locator('summary').first()).toContainText(`${findings.length}/2 reviewed · 0 supported · ${findings.length} withheld`);
  await review.locator('summary').first().click();
  if (partial) await expect(review).toContainText('Review is incomplete. 1 objective has no completed finding.');
  await review.locator('.structure-ai-evidence > summary').first().click();
  await expect(review).toContainText('The extracted chart labels do not establish an exact plotted value.');
  await expect(review.getByRole('link', { name: 'Open Chart lecture.pdf ↗' }).first()).toHaveAttribute('href', `/api/courses/course/materials/${groundingMaterial}/source`);
  await expect(page.getByText('Unvalidated streamed objective', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add selected to course' })).toBeHidden();
  await expect(page.getByText('No validated draft is available to apply.', { exact: true })).toBeVisible();
  expect(mutations).toEqual([]);
  await page.screenshot({ path: `artifacts/quality-lab-book-2026-10-16/outline-grounding-${partial ? 'incomplete' : 'all-withheld'}-desktop-api-fixture.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('.structure-ai').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: `artifacts/quality-lab-book-2026-10-16/outline-grounding-${partial ? 'incomplete' : 'all-withheld'}-mobile-api-fixture.png`, fullPage: true });
});

test('completed partial supply keeps withheld objectives outside selection and shows exact original support groups', async ({ page }) => {
  const findings = [groundingFinding('L1', 'supported'), groundingFinding('L2', 'uncertain')];
  const mutations = await mountGroundingSnapshot(page, {
    _id: 'grounding-partial-supply', kind: 'structure-generation', status: 'completed', stage: 'checking', revision: 4, createdAt: '2026-10-16',
    input: { materialIds: [groundingMaterial] }, structureResult: {
      themes: [{ name: 'Risk and return', los: [{ name: 'Calculate expected return from beta', evidenceIds: ['E1'], materialIds: [groundingMaterial] }] }],
      evidence: [{ id: 'E1', objective: 'Use the CAPM formula', materialId: groundingMaterial, materialName: 'Chart lecture.pdf', chunkIndex: 0, quote: 'Expected return uses beta.', sourcePassageId: 'C1.S1.P1' },
        { id: 'E2', objective: 'Interpret a historical chart', materialId: groundingMaterial, materialName: 'Chart lecture.pdf', chunkIndex: 0, quote: 'Historical price chart: 1988–1990.', sourcePassageId: 'C1.S1.P2',
          supportingPassages: [{ passageId: 'C1.S1.P3', quote: 'Only the chart axis labels survive text extraction.' }] }],
      coverage: { materials: [{ materialId: groundingMaterial, name: 'Chart lecture.pdf', chunks: 1, sections: 1, mappedObjectives: 1 }], analyzedSections: 1, extractedObjectives: 2, mappedObjectives: 1,
        unmappedEvidenceIds: ['E2'], excludedSections: [], warnings: [], outlineGrounding: { version: 'original-final-lo-review-v1', method: 'model-review-of-original-sections',
          totalObjectives: 2, reviewedObjectives: 2, supportedObjectives: 1, withheldObjectives: 1, complete: true, findings } },
    },
  });
  await expect(page.getByRole('textbox', { name: 'Objective 1.1', exact: true })).toHaveValue('Calculate expected return from beta');
  await expect(page.getByRole('checkbox', { name: /Include objective/ })).toHaveCount(1);
  const review = page.getByLabel('Original-source review', { exact: true });
  await review.locator('summary').first().click();
  await review.locator('.structure-ai-evidence > summary').click();
  await expect(review.getByText('Historical price chart: 1988–1990.', { exact: true })).toBeVisible();
  await expect(review.getByText('Only the chart axis labels survive text extraction.', { exact: true })).toBeVisible();
  await expect(review.getByRole('button', { name: 'Show passage in context' })).toHaveCount(2);
  await expect(page.getByRole('textbox', { name: 'Objective 1.2', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add selected to course' })).toBeEnabled();
  expect(mutations).toEqual([]);
  await page.screenshot({ path: 'artifacts/quality-lab-book-2026-10-16/outline-grounding-partial-supply-desktop-api-fixture.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/quality-lab-book-2026-10-16/outline-grounding-partial-supply-mobile-api-fixture.png', fullPage: true });
});


function completedGroundingResult(findings: ReturnType<typeof groundingFinding>[], version: 'original-final-lo-review-v1' | 'original-final-lo-review-v2', groupingIssues = 0): Record<string, unknown> {
  const supported = findings.filter(finding => finding.status === 'supported');
  return {
    _id: 'grounding-versioned', kind: 'structure-generation', status: 'completed', stage: 'checking', revision: 5, createdAt: '2026-10-16',
    input: { materialIds: [groundingMaterial] }, structureResult: {
      themes: supported.length ? [{ name: 'Risk and return', los: supported.map(finding => ({ name: finding.name, evidenceIds: finding.coveredEvidenceIds, materialIds: [groundingMaterial] })) }] : [],
      evidence: findings.map(finding => ({ id: finding.evidenceIds[0], objective: finding.learningPoints[0].objective, materialId: groundingMaterial, materialName: 'Chart lecture.pdf',
        chunkIndex: 0, quote: finding.status === 'supported' ? 'Expected return uses beta.' : 'Historical price chart: 1988–1990.', sourcePassageId: 'C1.S1.P1' })),
      coverage: { materials: [{ materialId: groundingMaterial, name: 'Chart lecture.pdf', chunks: 1, sections: 1, mappedObjectives: supported.length }],
        analyzedSections: 1, extractedObjectives: findings.length, mappedObjectives: supported.length,
        unmappedEvidenceIds: findings.filter(finding => finding.status !== 'supported').flatMap(finding => finding.evidenceIds), excludedSections: [], warnings: [],
        outlineGrounding: { version, method: 'model-review-of-original-sections', totalObjectives: findings.length, reviewedObjectives: findings.length,
          supportedObjectives: supported.length, withheldObjectives: findings.length - supported.length, complete: true, findings,
          ...(version === 'original-final-lo-review-v2' ? { groupingIssues } : {}) } },
    },
  };
}

test('v2 source-supported objectives remain selectable with a separate topic placement advisory', async ({ page }) => {
  const finding = { ...groundingFinding('L1', 'supported'), loIndex: 3, reason: 'The original source explicitly teaches expected return from beta.',
    topicFit: 'misgrouped', topicReason: 'This calculation belongs with cost of equity rather than portfolio diversification.' };
  let applied: unknown;
  const mutations = await mountGroundingSnapshot(page, completedGroundingResult([finding], 'original-final-lo-review-v2', 1), body => { applied = body; });
  const review = page.getByLabel('Original-source review', { exact: true });
  await expect(review.locator('summary').first()).toHaveText('Original-source review · 1/1 reviewed · 1 supported · 0 withheld · 1 topic placement concern');
  const objective = page.locator('.structure-ai-review-row').first();
  await expect(objective.getByText(`Topic placement needs review. ${finding.topicReason}`, { exact: true })).toBeVisible();
  await expect(objective.getByRole('checkbox')).toBeChecked();
  await expect(page.getByRole('button', { name: 'Add selected to course' })).toBeEnabled();
  expect(mutations).toEqual([]);
  await review.locator('summary').first().click();
  await expect(review.getByRole('heading', { name: 'Objectives withheld from the draft' })).toHaveCount(0);
  await expect(review.getByText('These objectives are supported by their original sources and remain available in the draft.', { exact: false })).toBeVisible();
  await review.getByText(`Source supported · ${finding.topic} / ${finding.name}`, { exact: true }).click();
  await expect(review.getByText(finding.reason, { exact: true })).toBeVisible();
  await expect(review.getByRole('link', { name: 'Open Chart lecture.pdf ↗' })).toHaveAttribute('href', `/api/courses/course/materials/${groundingMaterial}/source`);
  await expect(review.getByText('Expected return uses beta.', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/quality-lab-book-2026-10-16/outline-grounding-v2-placement-desktop-api-fixture.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('.structure-ai').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'artifacts/quality-lab-book-2026-10-16/outline-grounding-v2-placement-mobile-api-fixture.png', fullPage: true });
  await page.getByRole('button', { name: 'Add selected to course' }).click();
  await expect.poll(() => applied).toEqual({ runId: 'grounding-versioned', themes: [{ name: 'Risk and return', los: [{ name: finding.name, materialIds: [groundingMaterial], sourceThemeIndex: 0, sourceLoIndex: 0 }] }] });
  expect(mutations).toEqual(['/api/courses/course/apply-suggested-hierarchy']);
});

test('v2 topic fit cannot make a source-unsupported objective selectable', async ({ page }) => {
  const findings = [
    { ...groundingFinding('L1', 'supported'), reason: 'The beta relationship is explicit.', topicFit: 'fits', topicReason: 'The topic covers risk and expected return.' },
    { ...groundingFinding('L2', 'unsupported'), topicFit: 'fits', topicReason: 'The chart concerns the topic, but its values are unavailable.' },
  ];
  const mutations = await mountGroundingSnapshot(page, completedGroundingResult(findings, 'original-final-lo-review-v2'));
  await expect(page.getByRole('checkbox', { name: /Include objective/ })).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: 'Objective 1.1', exact: true })).toHaveValue(findings[0].name);
  await expect(page.getByRole('textbox', { name: 'Objective 1.2', exact: true })).toHaveCount(0);
  const review = page.getByLabel('Original-source review', { exact: true });
  await expect(review.locator('summary').first()).toContainText('1 supported · 1 withheld · 0 topic placement concerns');
  await review.locator('summary').first().click();
  await review.getByText(`Unsupported · ${findings[1].topic} / ${findings[1].name}`, { exact: true }).click();
  await expect(review.getByText(findings[1].reason, { exact: true })).toBeVisible();
  await expect(review.getByText(`Topic placement: fits. ${findings[1].topicReason}`, { exact: true })).toBeVisible();
  await expect(review.getByRole('heading', { name: 'Supported objectives with topic placement concerns' })).toHaveCount(0);
  await expect(page.locator('.structure-ai-review-row').getByText(/Topic placement needs review/)).toHaveCount(0);
  expect(mutations).toEqual([]);
});

test('v1 source-review reasons retain their original status without interpreting grouping language', async ({ page }) => {
  const reason = 'The source content is supported, but this objective belongs under another topic.';
  const finding = { ...groundingFinding('L1', 'uncertain'), reason };
  const mutations = await mountGroundingSnapshot(page, {
    _id: 'grounding-legacy', kind: 'structure-generation', status: 'failed', stage: 'checking', revision: 5, createdAt: '2026-10-16',
    input: { materialIds: [groundingMaterial] }, error: { code: 'structure-grounding-no-supported-objectives' },
    structureDiagnostics: { outlineGrounding: { version: 'original-final-lo-review-v1', method: 'model-review-of-original-sections',
      totalObjectives: 1, reviewedObjectives: 1, supportedObjectives: 0, withheldObjectives: 1, complete: true, findings: [finding] } },
  });
  const review = page.getByLabel('Original-source review', { exact: true });
  await expect(review.locator('summary').first()).toHaveText('Original-source review · 1/1 reviewed · 0 supported · 1 withheld');
  await review.locator('summary').first().click();
  await review.getByText(`Uncertain · ${finding.topic} / ${finding.name}`, { exact: true }).click();
  await expect(review.getByText(reason, { exact: true })).toBeVisible();
  await expect(review.getByRole('heading', { name: 'Objectives withheld from the draft' })).toBeVisible();
  await expect(review.getByRole('heading', { name: 'Supported objectives with topic placement concerns' })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /Include objective/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add selected to course' })).toBeHidden();
  expect(mutations).toEqual([]);
});


test('incomplete v2 review retains placement findings without exposing an applicable draft', async ({ page }) => {
  const finding = { ...groundingFinding('L1', 'supported'), topicFit: 'uncertain', topicReason: 'The proposed topic is too broad to confirm placement.' };
  const mutations = await mountGroundingSnapshot(page, {
    _id: 'grounding-v2-incomplete', kind: 'structure-generation', status: 'failed', stage: 'checking', revision: 6, createdAt: '2026-10-16',
    input: { materialIds: [groundingMaterial] }, error: { code: 'structure-budget-exhausted' },
    structurePreview: { themes: [{ name: 'Unvalidated topic', los: [{ name: finding.name }] }] },
    structureDiagnostics: { outlineGrounding: { version: 'original-final-lo-review-v2', method: 'model-review-of-original-sections',
      totalObjectives: 2, reviewedObjectives: 1, supportedObjectives: 1, withheldObjectives: 0, complete: false, groupingIssues: 1, findings: [finding] } },
  });
  const review = page.getByLabel('Original-source review', { exact: true });
  await expect(review.locator('summary').first()).toHaveText('Original-source review · 1/2 reviewed · 1 supported · 0 withheld · 1 topic placement concern');
  await review.locator('summary').first().click();
  await expect(review.getByText('Review is incomplete. 1 objective has no completed finding. No incomplete draft can be applied.', { exact: true })).toBeVisible();
  await expect(review.getByText('These objectives have source support, but the outline is incomplete.', { exact: false })).toBeVisible();
  await expect(review.getByText('remain available in the draft', { exact: false })).toHaveCount(0);
  await review.getByText(`Source supported · ${finding.topic} / ${finding.name}`, { exact: true }).click();
  await expect(review.getByText(`Topic placement needs review. ${finding.topicReason}`, { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Include objective/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add selected to course' })).toBeHidden();
  expect(mutations).toEqual([]);
});
