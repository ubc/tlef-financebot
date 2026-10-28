import { expect, test, type Page } from '@playwright/test';

const courseId = '111111111111111111111111';
const firstId = '222222222222222222222222';
const secondId = '333333333333333333333333';
const materials = [firstId, secondId].map((_id, index) => ({ _id, courseId, name: `Source ${index + 1}.pdf`, format: 'pdf', status: 'ready', assignments: [], uploadedAt: '2026-10-28T10:00:00Z' }));
async function fixture(page: Page) {
  const transfers: string[] = [];
  const controls = { delayFirst: false };
  await page.addInitScript(() => {
    const streams: EventTarget[] = [];
    Object.assign(window, { previewTestStreams: streams });
    window.EventSource = class extends EventTarget {
      constructor() { super(); streams.push(this); }
      close() { streams.splice(streams.indexOf(this), 1); }
    } as unknown as typeof EventSource;
  });
  await page.route('**/preview-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><title>Preview QA</title><link rel="stylesheet" href="/styles/main.css"></head><body><main id="fixture"></main></body></html>' }));
  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/source')) {
      transfers.push(pathname);
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><title>Retained preview</title><label>Preview position<input aria-label="Preview position"></label></html>' });
    }
    if (pathname.endsWith('/workspace')) {
      const material = materials.find(item => pathname.includes(item._id))!;
      if (controls.delayFirst && material._id === firstId) await new Promise(resolve => setTimeout(resolve, 500));
      return route.fulfill({ json: { material, chunks: [{ index: 0, text: material.name, characterCount: 12 }] } });
    }
    if (pathname === `/api/courses/${courseId}`) return route.fulfill({ json: { _id: courseId, name: 'Preview stability', courseCode: 'QA', themes: [] } });
    if (pathname.endsWith('/materials')) return route.fulfill({ json: materials });
    if (pathname.endsWith('/materials-trash')) return route.fulfill({ json: [] });
    if (pathname.endsWith('/content-runs')) return route.fulfill({ json: [] });
    if (pathname.endsWith('/knowledge-graph')) return route.fulfill({ json: { nodes: [], edges: [], truncated: false } });
    if (pathname === '/api/auth/me') return route.fulfill({ json: { authenticated: true, user: { puid: 'SYNTHETIC-INSTRUCTOR', uid: 'instructor', displayName: 'Synthetic Instructor', isAdmin: false, courseRoles: [{ courseId, role: 'instructor' }] } } });
    if (pathname.includes('/tutorial')) return route.fulfill({ json: { progress: [], items: [] } });
    throw new Error(`Unexpected preview fixture request: ${pathname}`);
  });
  await page.goto('/preview-fixture');
  await page.evaluate(async course => {
    const { getAuthState } = await import('/js/api.js'); await getAuthState();
    const { renderMaterials } = await import('/js/views/instructor/materials.js');
    renderMaterials(document.getElementById('fixture')!, { id: course });
  }, courseId);
  await expect(page.frameLocator('iframe').getByLabel('Preview position')).toBeVisible();
  return { transfers, controls };
}
async function emitRuns(page: Page, event: 'snapshot' | 'run', status = 'running') {
  await page.evaluate(({ event, status, courseId, firstId }) => {
    const streams = (window as unknown as { previewTestStreams: EventTarget[] }).previewTestStreams;
    const runs = Array.from({ length: 7 }, (_, index) => ({ _id: `run-${index}`, courseId, kind: 'material-ingest', status, stage: 'parsing', completedUnits: 0, totalUnits: 1, revision: 2, warnings: [], input: { materialId: firstId }, createdAt: '2026-10-28T10:00:00Z', updatedAt: '2026-10-28T10:01:00Z' }));
    for (const source of streams) {
      if (event === 'snapshot') source.dispatchEvent(new MessageEvent(event, { data: JSON.stringify({ runs }) }));
      else for (const run of runs) source.dispatchEvent(new MessageEvent(event, { data: JSON.stringify(run) }));
    }
  }, { event, status, courseId, firstId });
}
test('snapshot, progress and completion updates preserve the preview browsing context and transfer', async ({ page }) => {
  const state = await fixture(page);
  await page.frameLocator('iframe').getByLabel('Preview position').fill('page 14');
  await emitRuns(page, 'snapshot');
  await emitRuns(page, 'run');
  await emitRuns(page, 'run', 'completed');
  await page.waitForLoadState('networkidle');
  await expect(page.frameLocator('iframe').getByLabel('Preview position')).toHaveValue('page 14');
  await expect(page.locator('.knowledge-workspace__inspector iframe')).toHaveCount(1);
  expect(state.transfers).toHaveLength(1);
});
test('switching the selected source or inspector tab loads the intended preview', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('button', { name: 'Preview Source 2.pdf', exact: true }).click();
  await expect(page.locator('iframe')).toHaveAttribute('src', new RegExp(secondId));
  await expect.poll(() => state.transfers.length).toBe(2);
  await page.getByRole('tab', { name: 'Chunks', exact: true }).click();
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  await expect(page.frameLocator('iframe').getByLabel('Preview position')).toBeVisible();
  expect(state.transfers).toHaveLength(3);
});
test('a late source detail response cannot replace the newly selected source', async ({ page }) => {
  const state = await fixture(page);
  state.controls.delayFirst = true;
  const delayed = page.waitForResponse(response => response.url().includes(`${firstId}/workspace`));
  await page.getByRole('button', { name: 'Preview Source 1.pdf', exact: true }).click();
  await page.getByRole('button', { name: 'Preview Source 2.pdf', exact: true }).click();
  await delayed;
  await expect(page.locator('iframe')).toHaveAttribute('src', new RegExp(secondId));
  await expect(page.frameLocator('iframe').getByLabel('Preview position')).toBeVisible();
  expect(state.transfers.filter(path => path.includes(secondId))).toHaveLength(1);
});
