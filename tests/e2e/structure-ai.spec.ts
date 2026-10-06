import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('inline AI outline streams, recovers, edits, inspects evidence and applies the selected subset', async ({ page }) => {
  let run: Record<string, unknown> | undefined;
  let submitted: unknown; let applied: { themes: Array<{ name: string; los: Array<{ name: string }> }> } | undefined;
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
    if (path.endsWith('/structure-generation')) {
      submitted = r.request().postDataJSON(); run = { _id: 'run1', kind: 'structure-generation', status: 'running', stage: 'analyzing', completedUnits: 0, totalUnits: 3, revision: 1, createdAt: '2026-09-15', input: submitted };
      return r.fulfill({ json: { runId: 'run1' } });
    }
    if (path.endsWith('/content-runs/run1')) return r.fulfill({ json: run });
    if (path.endsWith('/content-runs')) return r.fulfill({ json: run ? [run] : [] });
    if (path.endsWith('/apply-suggested-hierarchy')) {
      applied = r.request().postDataJSON();
      if (applyFails) { applyFails = false; return r.fulfill({ status: 500, json: { error: 'Temporary failure' } }); }
      return r.fulfill({ json: { themesCreated: 1, losCreated: 1, assignmentsCreated: 2, materialsAssigned: 2 } });
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
  expect(submitted).toMatchObject({ materialIds: [m1, m2], level: 'introductory' });
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
    evidence: [{ id: 'E3', materialId: m1, materialName: 'Lecture.pdf', chunkIndex: 9, quote: 'Newton’s second law relates force to acceleration.' }, { id: 'E1', materialId: m1, materialName: 'Lecture.pdf', chunkIndex: 9, quote: 'Newton’s second law relates force to acceleration.' }, { id: 'E2', materialId: m2, materialName: 'Assignment.pdf', chunkIndex: 1, quote: 'Resolve the force vector into components.' }],
    coverage: { materials: [{ materialId: m1, name: 'Lecture.pdf', chunks: 10, mappedObjectives: 1 }, { materialId: m2, name: 'Assignment.pdf', chunks: 2, mappedObjectives: 1 }], analyzedSections: 12, extractedObjectives: 2, mappedObjectives: 2, unmappedEvidenceIds: [], excludedSections: [], warnings: ['Check source diagrams.'] },
  } };
  await emit();
  await expect(page.getByRole('textbox', { name: 'Draft topic 1 name', exact: true })).toHaveValue('Mechanics');
  await expect(page.getByRole('textbox', { name: 'Objective 1.2', exact: true })).toHaveValue('Resolve force vectors');
  await expect(page.locator('.structure-ai-evidence').first().locator('blockquote')).toHaveCount(2);
  const longObjective = 'Analyze a complete physical situation by identifying every external force, resolving the forces into components, calculating the resulting acceleration, and explaining the assumptions and the direction of the result.';
  await page.getByRole('textbox', { name: 'Objective 1.1', exact: true }).fill(longObjective);
  await page.setViewportSize({ width: 900, height: 900 });
  const field = page.getByRole('textbox', { name: 'Objective 1.1', exact: true });
  await expect.poll(() => field.evaluate(n => n.scrollHeight <= n.clientHeight)).toBe(true);
  await field.fill('Calculate acceleration from a force diagram');
  await page.getByLabel('Include objective 1.2').uncheck();
  await page.getByText('2 supporting materials · View evidence').click();
  await expect(page.getByText('Newton’s second law relates force to acceleration.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Lecture.pdf · Section 10 ↗' })).toHaveAttribute('href', /materials/);
  await page.getByRole('button', { name: 'Add selected to course' }).click();
  await expect(page.getByText('Could not apply the draft.', { exact: false })).toBeVisible();
  expect(applied?.themes[0].los).toEqual([expect.objectContaining({ name: 'Calculate acceleration from a force diagram' })]);
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
    if (path === `/api/courses/${course}`) return route.fulfill({ json: { course: { _id: course, name: 'Mechanics', courseCode: 'PHYS 100', term: '2026' }, themes: [] } });
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
  run = { ...run, stage: 'synthesizing', revision: 3, structurePreview: { themes: [{ name: 'Force and motion', los: [{ name: 'Describe the forces' }] }] } };
  await page.evaluate(value => (window as unknown as { emitRun: (v: unknown) => void }).emitRun(value), run);
  await expect(page.locator('.structure-ai-draft-row')).toContainText('Describe the forces');
  // Re-enter through the actual shell/router, not a component-only mount.
  await page.getByRole('link', { name: 'Help & Tutorials', exact: true }).click();
  await expect(page).toHaveURL(/instructor\/help/);
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
