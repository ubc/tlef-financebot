import { test, expect } from '@playwright/test';

test('saved setup preserves a one-question recipe and restores it on selection', async ({ page }) => {
  let saved: Record<string, unknown> | undefined;
  await page.route('**/qa-fixture', route => route.fulfill({ contentType: 'text/html', body: '<html><head><link rel="stylesheet" href="/styles/main.css"></head><body><main></main></body></html>' }));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/generation-blueprints')) {
      if (route.request().method() === 'POST') { saved = { ...route.request().postDataJSON(), _id: 'saved' }; return route.fulfill({ json: saved }); }
      return route.fulfill({ json: saved ? [saved] : [] });
    }
    if (path === '/api/courses/course') return route.fulfill({ json: { _id: 'course', themes: [{ _id: 'topic', name: 'Finance', los: [{ _id: 'lo', name: 'Explain present value' }] }] } });
    if (path.endsWith('/materials')) return route.fulfill({ json: [{ _id: 'material', name: 'QA source', status: 'ready', assignments: [{ themeId: 'topic', loId: 'lo' }] }] });
    if (path.endsWith('/preseeding')) return route.fulfill({ json: [{ loId: 'lo', approved: 0, unapproved: 0, target: 5 }] });
    return route.fulfill({ json: [] });
  });
  await page.goto('/qa-fixture#/instructor/course/course/preseeding?advanced=1&loId=lo');
  await page.evaluate(async () => {
    class Source extends EventTarget { close() {} }
    window.EventSource = Source as unknown as typeof EventSource;
    (await import('/js/views/instructor/preseeding.js')).renderPreseeding(document.querySelector('main')!, { id: 'course' });
  });
  await page.getByLabel('Number of Questions').selectOption('1');
  await page.getByLabel('Setup name').fill('One question');
  await page.getByRole('button', { name: 'Save setup', exact: true }).click();
  await expect.poll(() => saved?.count).toBe(1);
  await page.getByLabel('Number of Questions').selectOption('5');
  await page.locator('#preseeding-saved-setup').selectOption('');
  await page.locator('#preseeding-saved-setup').selectOption('saved');
  await expect(page.getByLabel('Number of Questions')).toHaveValue('1');
});

test('completed material uses terminal readiness, not the last processing stage', async ({ page }) => {
  await page.route('**/qa-fixture', route => route.fulfill({ contentType: 'text/html', body: '<html><head><link rel="stylesheet" href="/styles/main.css"></head><body><main></main></body></html>' }));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/materials')) return route.fulfill({ json: [{ _id: 'material', courseId: 'course', name: 'QA lecture.txt', format: 'txt', uploadedAt: '2026-09-19', kind: 'lecture', status: 'ready', assignments: [], activeRunId: 'run' }] });
    if (path.endsWith('/content-runs')) return route.fulfill({ json: [{ _id: 'run', courseId: 'course', kind: 'material-ingest', status: 'completed', stage: 'classifying', input: { materialId: 'material' }, revision: 2 }] });
    if (path.endsWith('/knowledge-graph')) return route.fulfill({ json: { nodes: [], edges: [] } });
    if (path === '/api/courses/course') return route.fulfill({ json: { _id: 'course', themes: [] } });
    return route.fulfill({ json: [] });
  });
  await page.goto('/qa-fixture');
  await page.evaluate(async () => {
    class Source extends EventTarget { close() {} }
    window.EventSource = Source as unknown as typeof EventSource;
    (await import('/js/views/instructor/materials.js')).renderMaterials(document.querySelector('main')!, { id: 'course' });
  });
  await expect(page.locator('.workspace-file__meta')).toHaveText('lecture · ready');
});
