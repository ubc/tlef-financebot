import { test, expect } from '@playwright/test';
test('graph node cards reveal exact evidence with safe original links', async ({ page }) => {
  const counts = { draft: 1, 'pending-review': 0, reviewed: 0, approved: 1, paused: 0, archived: 0 };
  const nodes = [{ id: 'material:m', type: 'material', label: 'Notes.pdf', materialId: 'm' }, { id: 'evidence:m:0', type: 'evidence', label: 'Chunk 1', materialId: 'm' }, { id: 'lo:l', type: 'lo', label: 'Combine forces' }, { id: 'question:q', type: 'question', label: 'Which force?' }];
  await page.route('**/fixture', r => r.fulfill({ contentType: 'text/html', body: '<html lang="en"><head><title>Coverage</title><link rel="stylesheet" href="/styles/main.css"></head><body><main></main></body></html>' }));
  await page.route('**/api/**', async r => {
    const path = new URL(r.request().url()).pathname;
    if (path.endsWith('/content-map')) return r.fulfill({ json: { themes: [{ themeId: 't', name: 'Forces', los: [{ loId: 'l', name: 'Combine forces', materials: [{ status: 'ready', name: 'Notes.pdf' }], questionCounts: counts }] }], unassignedMaterials: [] } });
    if (path.endsWith('/knowledge-graph')) return r.fulfill({ json: { nodes, edges: [{ source: 'material:m', target: 'evidence:m:0', type: 'contains' }, { source: 'evidence:m:0', target: 'lo:l', type: 'covers' }, { source: 'lo:l', target: 'question:q', type: 'assesses' }], truncated: true } });
    if (path.endsWith('/workspace')) return r.fulfill({ json: { material: { name: 'Notes.pdf' }, chunks: [{ index: 0, text: 'Forces add as vectors. <script>not executable</script>' }, { index: 1, text: 'Other evidence.' }] } });
    return r.fulfill({ json: { _id: 'course', name: 'Physics', themes: [{ _id: 't', name: 'Forces', los: [] }] } });
  });
  await page.goto('/fixture');
  await page.evaluate(async () => { const { renderContentMap } = await import('/js/views/instructor/content-map.js'); renderContentMap(document.querySelector('main')!, { id: 'course' }); });
  await expect(page.getByRole('link', { name: 'Review questions →' })).toBeVisible();
  await page.getByRole('button', { name: '◇ Graph', exact: true }).click();
  await page.locator('[data-node="evidence:m:0"]').click();
  await page.getByRole('button', { name: 'Preview highlighted evidence' }).click();
  await expect(page.locator('dialog mark')).toHaveText('Forces add as vectors. <script>not executable</script>');
  await expect(page.locator('dialog script')).toHaveCount(0);
  await expect(page.getByRole('dialog').getByRole('link', { name: 'Open original file ↗' })).toHaveAttribute('href', '/api/courses/course/materials/m/source');
  await page.screenshot({ path: '/tmp/coverage-evidence.png', fullPage: true });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(async () => {
    const { previewEvidence } = await import('/js/views/instructor/coverage-graph.js');
    await previewEvidence('course', 'm', undefined, 'add as vectors');
  });
  await expect(page.locator('dialog mark')).toHaveText('add as vectors');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(async () => {
    const { previewEvidence } = await import('/js/views/instructor/coverage-graph.js');
    await previewEvidence('course', 'm', undefined, 'Missing quotation');
  });
  await expect(page.locator('dialog mark')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toContainText('could not be matched');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('[data-node="lo:l"]').click();
  await page.getByRole('button', { name: 'View objective coverage', exact: true }).click();
  await expect(page.locator('.coverage-table .is-selected')).toContainText('Combine forces');
});
