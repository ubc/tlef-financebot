import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function setup(context: BrowserContext, pending = 0) {
  const run = { _id: 'run-1', courseId: 'course', kind: 'question-generation', status: 'running', stage: 'generating', revision: 1, input: { loId: 'lo', count: 5 }, completedUnits: 0, totalUnits: 5, result: { createdQuestionIds: [], failures: [] }, updatedAt: new Date().toISOString() };
  const requests: Array<{ submissionId: string; cells: Array<{ count: number }>; prompt: string }> = [];
  let loseResponse = false;
  let accepted = false;
  await context.route('**/generation-fixture', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><title>Generate questions</title><link rel="stylesheet" href="/styles/main.css"></head><body><main></main></body></html>' }));
  await context.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith('/content-runs/events')) return route.fulfill({ contentType: 'text/event-stream', body: 'event: snapshot\ndata: []\n\n' });
    if (path.endsWith('/content-runs/run-1')) return route.fulfill({ json: run });
    if (path.endsWith('/content-runs')) return route.fulfill({ json: accepted ? [run] : [] });
    if (path === '/api/courses/course') return route.fulfill({ json: { _id: 'course', name: 'Physics', themes: [{ _id: 'topic', name: 'Forces', order: 0, los: [{ _id: 'lo', name: 'Explain net force', themeId: 'topic', order: 0 }] }] } });
    if (path.endsWith('/materials')) return route.fulfill({ json: [{ _id: 'material', status: 'ready', filename: 'lecture.pdf', assignments: [{ loId: 'lo', themeId: 'topic' }] }] });
    if (path.endsWith('/preseeding')) return route.fulfill({ json: [{ loId: 'lo', approved: 0, unapproved: pending, target: 5 }] });
    if (path.endsWith('/generation-plan')) {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON(); requests.push(body); accepted = true;
        if (loseResponse) { loseResponse = false; return route.abort(); }
        return route.fulfill({ status: 202, json: { runs: body.cells.map((cell: object) => ({ ...cell, runId: 'run-1' })) } });
      }
      return route.fulfill({ json: [{ loId: 'lo', loName: 'Explain net force', themeName: 'Forces', loKind: 'conceptual', approved: { easy: 0, medium: 0, hard: 0 }, cells: [{ difficulty: 'easy', kind: 'conceptual', count: 2 }, { difficulty: 'medium', kind: 'conceptual', count: 2 }, { difficulty: 'hard', kind: 'conceptual', count: 1 }] }] });
    }
    if (path.endsWith('/instructor-workflow')) return route.fulfill({ status: 503, json: { error: 'No aggregate fixture' } });
    return route.fulfill({ json: [] });
  });
  const open = async (page: Page) => {
    await page.goto('/generation-fixture');
    await page.evaluate(async () => {
      const { openCourseSetupGuide } = await import('/js/views/instructor/course-setup-guide.js');
      openCourseSetupGuide({ courseId: 'course', actionId: 'seed-thin-los', learningObjectiveCount: 1, onChanged: () => {} });
    });
  };
  return { open, requests, loseResponse: () => { loseResponse = true; } };
}

test('simple default keeps advanced inputs closed and pending drafts reduce recommendations', async ({ page, context }) => {
  const state = await setup(context, 5); await state.open(page);
  await expect(page.getByText('0 questions across 0 learning objectives')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate questions', exact: true })).toBeDisabled();
  await expect(page.getByRole('spinbutton')).not.toBeVisible();
  await page.getByText('Customize distribution & existing supply', { exact: true }).click();
  await page.getByLabel('Generate additional questions beyond existing supply').check();
  await expect(page.getByText('5 questions across 1 learning objective')).toBeVisible();
  await page.getByText('Customize distribution & existing supply', { exact: true }).click();
  expect((await new AxeBuilder({ page }).include('.course-setup-guide').analyze()).violations).toEqual([]);
  await page.screenshot({ path: '/tmp/guided-generation-desktop.png' });
});

test('submission enters Review, stays locked after reopening and across tabs', async ({ page, context }) => {
  const state = await setup(context); await state.open(page);
  await page.getByLabel('Optional instructions').fill('Use everyday situations.');
  await page.getByRole('button', { name: 'Generate questions', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review before students can see anything' })).toBeVisible();
  expect(state.requests).toHaveLength(1);
  expect(state.requests[0].prompt).toBe('Use everyday situations.');
  await page.getByRole('button', { name: /^3\. Questions/ }).click();
  await expect(page.getByRole('button', { name: 'Generation in progress', exact: true })).toBeDisabled();
  const other = await context.newPage(); await state.open(other);
  await expect(other.getByRole('button', { name: 'Generation in progress', exact: true })).toBeDisabled();
  expect(state.requests).toHaveLength(1);
});

test('lost response resumes the identical request after reload without starting a new batch', async ({ page, context }) => {
  const state = await setup(context); await state.open(page); state.loseResponse();
  await page.getByRole('button', { name: 'Generate questions', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume submission', exact: true })).toBeEnabled();
  await state.open(page);
  await page.getByRole('button', { name: 'Resume submission', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review before students can see anything' })).toBeVisible();
  expect(state.requests).toHaveLength(2);
  expect(state.requests[1]).toEqual(state.requests[0]);
});

test('mobile dark composer fits and keeps advanced controls accessible', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await setup(context); await state.open(page);
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  await expect(page.getByText('5 questions across 1 learning objective')).toBeVisible();
  expect(await page.locator('.course-setup-guide__body').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('.course-setup-guide').analyze()).violations).toEqual([]);
  await page.screenshot({ path: '/tmp/guided-generation-mobile.png' });
});
