import { test, expect } from '@playwright/test';

test('shows course student participation and USD estimates at the recorded model rates', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await page.route('**/dashboard-fixture', route => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><html lang="en"><head><link rel="stylesheet" href="/styles/main.css"></head><body><main></main></body></html>' }));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/instructor-workflow')) return route.fulfill({ json: {
      course: { id: 'course', name: 'Physics', courseCode: 'PHYS 100', term: 'Winter', lifecycle: 'draft' },
      setup: { steps: [], primaryAction: { id: 'publish-course', title: 'Publish', priority: 'blocking', destination: 'dashboard' } },
      counts: { topics: 3, learningObjectives: 4, approvedQuestions: 7, reviewQueue: 2, openFlags: 0, contentIssues: 0 },
      actions: [],
    } });
    if (path.endsWith('/dashboard-metrics')) return route.fulfill({ json: {
      students: { enrolled: 20, active: 11, usageRate: 0.55, windowDays: 7 },
      generation: {
        total: { tokens: 40_300, estimatedUsd: 0.83, partial: true, unpricedCalls: 1, models: [
          { provider: 'openai', model: 'gpt-6.2-sol', tokens: 40_100, estimatedUsd: 0.83, unpricedCalls: 0 },
          { provider: 'local', model: 'unpriced', tokens: 200, estimatedUsd: null, unpricedCalls: 1 },
        ] },
        generationTokens: 36_000,
        average: { tokens: 1800, estimatedUsd: 0.026, sampleSize: 20, sampleKind: 'saved-question' },
        forecast: { generator: 'gpt-6-luna', checker: 'gpt-6.2-sol', tokens: 1800, estimatedUsd: 0.0037 },
      },
    } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/dashboard-fixture');
  await page.evaluate(async () => {
    (await import('/js/views/instructor/dashboard.js')).renderDashboard(document.querySelector('main')!, { id: 'course' });
  });

  const students = page.getByRole('region', { name: 'Student activity' });
  await expect(students.locator('dd')).toHaveText(['20', '11', '55%']);
  const usage = page.getByRole('region', { name: 'AI usage and cost estimates' });
  await expect(usage).toContainText('Cumulative estimated subtotal');
  await expect(usage).toContainText('$0.83');
  await expect(usage).toContainText('36,000');
  await expect(usage).toContainText('$0.026');
  await expect(usage).toContainText('$0.0037');
  await expect(usage).toContainText('gpt-6-luna');
  await usage.getByText('Cost by model', { exact: true }).click();
  await expect(usage.getByText('1 unpriced')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
