import { test, expect } from '@playwright/test';

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
