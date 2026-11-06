import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const courseA = '111111111111111111111111';
const courseB = '222222222222222222222222';
const permissions = ['question.review', 'question.suggest-edit', 'question.mark-reviewed', 'question.create-draft', 'question.approve', 'flag.triage', 'flag.resolve', 'analytics.view', 'analytics.individual', 'exam.configure', 'course.manage-tas', 'materials.upload', 'hierarchy.edit'];
const roles = ['student', 'instructor', 'ta', 'admin'];
const profileClassic = { profile: 'classic', temperature: { min: 0, max: 2, default: 0 }, reasoningEffort: null, defaultEffort: 'none', tokenLimitParam: 'max_tokens' };
const initialSettings = {
  models: { generator: { model: 'fixture-classic' }, validator: { model: 'fixture-reasoning' }, reviewer: { model: 'fixture-reasoning', reasoningEffort: 'medium' }, masteryEvaluator: { model: 'fixture-reasoning' }, utility: { model: 'fixture-classic' } },
  customModels: [], costControls: { maxGenerationsPerDay: 1000 }, featureFlags: { reviewerAgent: true, layer2Evaluator: true, retryOnReject: true }, updatedBy: 'admin', updatedAt: '2026-09-20T12:00:00.000Z',
  catalogue: { environmentModels: { generator: 'fixture-reasoning', validator: 'fixture-reasoning', reviewer: 'fixture-reasoning', masteryEvaluator: 'fixture-reasoning', utility: 'fixture-classic' }, models: [{ id: 'fixture-classic', profile: 'classic', custom: false }, { id: 'fixture-reasoning', profile: 'reasoning-fixed', custom: false }], profiles: { classic: profileClassic, 'reasoning-fixed': { ...profileClassic, profile: 'reasoning-fixed', reasoningEffort: ['none', 'low', 'medium', 'high'], defaultEffort: 'medium' }, 'reasoning-tunable': { ...profileClassic, profile: 'reasoning-tunable', reasoningEffort: ['none', 'low', 'medium', 'high'], defaultEffort: 'none' } }, stepTemperatureDefaults: { generator: 0.7, validator: 0, reviewer: 0, masteryEvaluator: 0, utility: 0 } },
};
async function fixture(page: Page, view: 'capabilities' | 'settings', settingsFixture = initialSettings) {
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  let assignments: Record<string, Record<string, Record<string, boolean>>> = { platform: {}, [courseA]: {}, [courseB]: {} };
  let settings = structuredClone(settingsFixture);
  const controls = { failSave: false, delayScopeA: false, scopeALoaded: false, failRead: false };
  await page.route('**/configuration-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en" data-theme="light" data-admin="true"><head><title>Admin configuration</title><link rel="stylesheet" href="/styles/main.css"><link rel="stylesheet" href="/styles/course-cards.css"><link rel="stylesheet" href="/styles/admin-console.css"><link rel="stylesheet" href="/styles/admin-configuration.css"></head><body><main id="app" class="outlet"></main></body></html>' }));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    if (path === '/api/auth/me') return route.fulfill({ json: { authenticated: true, roles: [], user: { puid: 'admin', isAdmin: true, courseRoles: [] } } });
    if (path.includes('tutorial')) return route.fulfill({ json: [] });
    if (path === '/api/diagnostics/client-error') return route.fulfill({ status: 204 });
    if (method !== 'GET') {
      const body = route.request().postDataJSON(); writes.push({ path, body });
      if (controls.failSave) return route.fulfill({ status: 503, json: { error: 'Save unavailable. Try again.' } });
      if (path.endsWith('/capabilities')) { assignments = { ...assignments, [body.courseId || 'platform']: body.assignments }; return route.fulfill({ status: 204 }); }
      if (path.endsWith('/platform-settings')) { settings = { ...settings, ...body }; return route.fulfill({ json: settings }); }
    }
    if (path.endsWith('/platform-settings')) return route.fulfill({ json: settings });
    if (path.endsWith('/capabilities')) {
      const scope = url.searchParams.get('courseId') || 'platform';
      if (controls.delayScopeA && scope === courseA) { controls.scopeALoaded = true; await new Promise(resolve => setTimeout(resolve, 350)); }
      if (controls.failRead) return route.fulfill({ status: 503, json: { error: 'Capability service unavailable.' } });
      const values = assignments[scope] || {};
      return route.fulfill({ json: { scope: scope === 'platform' ? 'platform' : 'course', courseId: scope === 'platform' ? undefined : scope, assignments: values, matrix: permissions.map(capability => ({ capability, roles: Object.fromEntries(roles.map(role => {
        const fallback = role === 'admin' || role === 'instructor' || role === 'ta' && ['question.review', 'question.suggest-edit', 'question.mark-reviewed', 'flag.triage'].includes(capability);
        return [role, { value: values[capability]?.[role] ?? assignments.platform[capability]?.[role] ?? fallback, source: values[capability]?.[role] !== undefined ? scope === 'platform' ? 'admin-override' : 'course' : assignments.platform[capability]?.[role] !== undefined ? 'admin-override' : 'default' }];
      })) })) } });
    }
    return route.fulfill({ status: 404, json: { error: 'Unexpected request ' + path } });
  });
  await page.goto('/configuration-fixture');
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
  await page.evaluate(async view => {
    await (await import('/js/auth.js')).loadSession();
    const root = document.querySelector('#app')! as HTMLElement;
    const render = view === 'capabilities' ? (await import('/js/views/admin/capabilities.js')).renderAdminCapabilities : (await import('/js/views/admin/platform-settings.js')).renderAdminPlatformSettings;
    (await import('/js/router.js')).startRouter({ routes: [{ path: '/configuration', render }, { path: '/away', render: outlet => { outlet.textContent = 'Away page'; } }], outlet: root, fallback: '/configuration' });
  }, view);
  await expect(page.getByRole('heading', { name: view === 'settings' ? 'Platform Settings' : 'Capabilities', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review changes', exact: true })).toBeVisible();
  return { writes, controls };
}

test('Admin can save one course’s model choice and restore platform inheritance', async ({ page }) => {
  await fixture(page, 'settings');
  await page.route('**/api/admin/courses', route => route.fulfill({ json: [
    { _id: courseA, courseCode: 'COMM 298', name: 'Intro to Finance', section: '101', term: '2026W1', lifecycle: 'published', owner: { displayName: 'Ana García' } },
    { _id: courseB, courseCode: 'COMM 298', name: 'Intro to Finance', section: '102', term: '2026W1', lifecycle: 'published', owner: { displayName: 'Sam Chen' } },
  ] }));
  let revision = 0;
  let override: string | undefined;
  await page.route('**/api/admin/courses/*/models', route => {
    const forA = route.request().url().includes(courseA);
    if (route.request().method() === 'PUT') {
      expect(forA).toBe(true);
      const body = route.request().postDataJSON();
      expect(body.revision).toBe(revision++);
      override = body.overrides.generator;
    }
    const generator = forA ? override : undefined;
    return route.fulfill({ json: {
      revision: forA ? revision : 0, overrides: generator ? { generator } : {},
      platformModels: initialSettings.models,
      effectiveModels: { ...initialSettings.models, ...(generator ? { generator: { model: generator } } : {}) },
      availableModels: ['fixture-classic', 'fixture-reasoning'],
    } });
  });
  await page.getByRole('tab', { name: 'Course models' }).click();
  const search = page.getByRole('searchbox', { name: 'Search by course or instructor' });
  const courseCardA = page.getByRole('button', { name: /Model settings COMM 298.*Section 101.*Ana García/ });
  const courseCardB = page.getByRole('button', { name: /Model settings COMM 298.*Section 102.*Sam Chen/ });
  const back = page.getByRole('button', { name: 'Back to courses' });
  await search.fill('comm298');
  await expect(courseCardA).toBeVisible();
  await expect(courseCardB).toBeVisible();
  await search.fill('does not exist');
  await expect(page.getByText('No courses match your search.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Model settings COMM 298/ })).toHaveCount(0);
  await search.fill('garcia ana');
  await expect(courseCardB).toHaveCount(0);
  await courseCardA.press('Enter');
  await expect(page.getByRole('heading', { name: 'COMM 298 · Intro to Finance' })).toBeFocused();
  await expect(search).toBeHidden();
  const generator = page.getByLabel('Generator course model', { exact: true });
  await generator.selectOption('fixture-reasoning');
  await back.click();
  await expect(page.getByRole('dialog')).toContainText('Discard course model changes?');
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(generator).toHaveValue('fixture-reasoning');
  await page.getByRole('button', { name: 'Review course changes' }).click();
  await expect(page.getByRole('dialog')).toContainText('Section 101');
  await page.getByRole('button', { name: 'Save course models', exact: true }).click();
  await expect(page.getByText('Currently fixture-reasoning · Course override')).toBeVisible();
  await back.click();
  await expect(search).toHaveValue('garcia ana');
  await expect(courseCardA).toBeFocused();
  await search.clear();
  await courseCardB.click();
  await expect(generator).toHaveValue('');
  await back.click();
  await courseCardA.click();
  await expect(generator).toHaveValue('fixture-reasoning');
  await generator.selectOption('');
  await page.getByRole('button', { name: 'Review course changes' }).click();
  await page.getByRole('button', { name: 'Save course models', exact: true }).click();
  await expect(page.getByText('Currently fixture-classic · Inherited').first()).toBeVisible();
  expect(override).toBeUndefined();
});

test('capabilities preserve sparse assignments, enforce safety locks and save the loaded scope', async ({ page }) => {
  const { writes } = await fixture(page, 'capabilities');
  await expect(page.locator('tbody tr')).toHaveCount(13);
  await expect(page.getByLabel('TA: question.approve', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('TA: flag.resolve', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Admin: question.review', { exact: true })).toBeDisabled();
  await page.getByLabel('TA: analytics.view', { exact: true }).check();
  await page.getByLabel('Course ID override').fill(courseA);
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Platform defaults');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body).toEqual({ assignments: { 'analytics.view': { ta: true } } });
  await expect(page.getByText('No unsaved changes', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Load matrix', exact: true }).click();
  await expect(page.locator('.ac-config-scope')).toContainText(courseA);
  await page.getByRole('button', { name: 'View course analytics', exact: true }).click();
  await expect(page.getByLabel('TA access for View course analytics')).toHaveValue('inherit');
  await page.getByLabel('TA access for View course analytics').selectOption('deny');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1].body).toEqual({ assignments: { 'analytics.view': { ta: false } }, courseId: courseA });
});

test('capabilities inherit, discard and empty filters retain unsaved protection', async ({ page }) => {
  const { writes } = await fixture(page, 'capabilities');
  await page.getByLabel('Student: question.review', { exact: true }).check();
  await page.getByRole('button', { name: 'Review questions', exact: true }).click();
  await page.getByLabel('Student access for Review questions').selectOption('inherit');
  await expect(page.getByText('No unsaved changes', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByLabel('Search permissions').fill('impossible');
  await expect(page.getByText('No matching permissions.', { exact: false })).toBeVisible();
  await page.getByLabel('Search permissions').fill('');
  await page.getByLabel('TA: analytics.individual', { exact: true }).check();
  await page.evaluate(() => { location.hash = '/away'; });
  await expect(page.getByRole('dialog')).toContainText('Discard permission changes?');
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(page.getByLabel('TA: analytics.individual', { exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page.getByLabel('TA: analytics.individual', { exact: true })).not.toBeChecked();
  expect(writes).toHaveLength(0);
});

test('capability failed save retains the draft and failed verification does not pretend to refresh', async ({ page }) => {
  const { writes, controls } = await fixture(page, 'capabilities');
  await page.getByLabel('TA: analytics.view', { exact: true }).check();
  controls.failSave = true;
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Save unavailable');
  await expect(page.getByLabel('TA: analytics.view', { exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Review changes', exact: true })).toBeEnabled();
  controls.failSave = false; controls.failRead = true;
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('saved, but the updated matrix could not be loaded');
  await expect(page.getByRole('button', { name: 'Review changes', exact: true })).toBeDisabled();
  expect(writes).toHaveLength(2);
  controls.failRead = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByLabel('TA: analytics.view', { exact: true })).toBeChecked();
  await expect(page.getByText('No unsaved changes', { exact: true })).toBeVisible();
});

test('settings use catalogue parameters, validate limits, preserve tabs and save explicit nonreasoning effort with temperature', async ({ page }) => {
  const { writes } = await fixture(page, 'settings');
  await page.getByRole('button', { name: 'Edit Structure validator', exact: true }).click();
  await expect(page.getByLabel('Structure validator reasoning effort')).toHaveValue('none');
  await expect(page.getByLabel('Structure validator temperature')).toHaveValue('');
  await page.getByLabel('Structure validator temperature').fill('0.4');
  await page.getByLabel('Structure validator reasoning effort').selectOption('high');
  await expect(page.getByLabel('Structure validator temperature')).toHaveCount(0);
  await page.getByLabel('Structure validator reasoning effort').selectOption('none');
  await expect(page.getByLabel('Structure validator temperature')).toHaveValue('');
  await page.getByLabel('Structure validator temperature').fill('0.3');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('tab', { name: 'Usage & limits', exact: true }).click();
  await page.getByLabel('Maximum generations per day').fill('0');
  await expect(page.getByRole('button', { name: 'Review changes', exact: true })).toBeDisabled();
  await page.getByLabel('Maximum generations per day').fill('1200');
  await page.getByRole('tab', { name: 'Model pipeline', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Structure validator', exact: true }).click();
  await expect(page.getByLabel('Structure validator temperature')).toHaveValue('0.3');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect((writes[0].body.models as Record<string, unknown>).validator).toEqual({ model: 'fixture-reasoning', temperature: 0.3, reasoningEffort: 'none' });
  expect(writes[0].body.costControls).toEqual({ maxGenerationsPerDay: 1200 });
  await expect(page.getByText('No unsaved changes', { exact: true })).toBeVisible();
});

test('Sol reasoning-required profile defaults to medium without none and Luna retains supported none save payloads', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const settingsFixture = {
    ...initialSettings,
    models: { ...initialSettings.models, generator: { model: 'gpt-6-luna', reasoningEffort: 'none', temperature: 0.4 } },
    catalogue: { ...initialSettings.catalogue,
      models: [...initialSettings.catalogue.models, { id: 'gpt-6-luna', profile: 'reasoning-fixed', custom: false }, { id: 'gpt-6.1-sol', profile: 'reasoning-required', custom: false }],
      profiles: { ...initialSettings.catalogue.profiles,
        'reasoning-fixed': { ...initialSettings.catalogue.profiles['reasoning-fixed'], reasoningEffort: ['none', 'low', 'medium', 'high', 'xhigh'], tokenLimitParam: 'max_completion_tokens' },
        'reasoning-required': { profile: 'reasoning-required', temperature: null, reasoningEffort: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'medium', tokenLimitParam: 'max_completion_tokens' } },
    },
  };
  const { writes } = await fixture(page, 'settings', settingsFixture);
  await page.evaluate(() => {
    const label = document.createElement('p');
    label.textContent = 'API fixture · Compiled Admin settings UI · Intercepted responses only · No live model or platform setting changes';
    label.style.cssText = 'margin:12px 24px;padding:12px;border:1px solid #607080;border-radius:8px;background:#eef4f8;color:#17202a;font:14px system-ui';
    document.body.prepend(label);
  });
  await page.getByRole('button', { name: 'Edit Generator', exact: true }).click();
  await expect(page.getByLabel('Generator reasoning effort', { exact: true })).toHaveValue('none');
  await expect(page.getByLabel('Generator temperature', { exact: true })).toHaveValue('0.4');
  await page.getByLabel('Generator model', { exact: true }).selectOption('gpt-6.1-sol');
  const effort = page.getByLabel('Generator reasoning effort', { exact: true });
  await expect(effort).toHaveValue('medium');
  expect(await effort.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual(['low', 'medium', 'high', 'xhigh']);
  await expect(page.getByLabel('Generator temperature', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Generator configuration')).toContainText('reasoning-required');
  await expect(page.getByText('always reasons; effort “none” and temperature are unavailable', { exact: true })).toBeVisible();
  await effort.selectOption('medium');
  await page.screenshot({ path: 'artifacts/quality-lab-book-2026-10-16/admin-sol-reasoning-required-api-fixture.png', fullPage: true });
  expect((await new AxeBuilder({ page }).include('.admin-configuration').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect((writes[0].body.models as Record<string, unknown>).generator).toEqual({ model: 'gpt-6.1-sol', modelSource: 'override', reasoningEffort: 'medium' });
  await expect(page.getByText('No unsaved changes', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Edit Generator', exact: true }).click();
  await expect(page.getByLabel('Generator model', { exact: true })).toHaveValue('gpt-6.1-sol');
  await expect(page.getByLabel('Generator reasoning effort', { exact: true })).toHaveValue('medium');
  await page.getByLabel('Generator model', { exact: true }).selectOption('gpt-6-luna');
  await expect(effort).toHaveValue('none');
  expect(await effort.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual(['none', 'low', 'medium', 'high', 'xhigh']);
  await expect(page.getByLabel('Generator temperature', { exact: true })).toBeVisible();
  await effort.selectOption('none');
  await page.getByLabel('Generator temperature', { exact: true }).fill('0.4');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Generator', exact: true }).click();
  await page.screenshot({ path: 'artifacts/quality-lab-book-2026-10-16/admin-luna-none-api-fixture.png', fullPage: true });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect((writes[1].body.models as Record<string, unknown>).generator).toEqual({ model: 'gpt-6-luna', modelSource: 'override', reasoningEffort: 'none', temperature: 0.4 });
  expect(writes.every(write => write.path === '/api/admin/platform-settings')).toBe(true);
});

test('settings reviewer disabling requires quality confirmation and failed writes retain draft', async ({ page }) => {
  const { writes, controls } = await fixture(page, 'settings');
  await page.getByRole('tab', { name: 'Quality controls', exact: true }).click();
  await page.getByLabel('Reviewer Agent', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Disable Reviewer Agent?');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(writes).toHaveLength(0);
  controls.failSave = true;
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await page.getByRole('button', { name: 'Disable reviewer', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Save unavailable');
  expect(writes[0].body.confirmQualityImpact).toBe(true);
  await expect(page.getByLabel('Reviewer Agent', { exact: true })).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Review changes', exact: true })).toBeEnabled();
});

test('custom catalogue validates duplicates, edits active models and prevents deleting in-use model', async ({ page }) => {
  const { writes } = await fixture(page, 'settings');
  await page.getByRole('tab', { name: 'Custom models', exact: true }).click();
  await page.getByRole('button', { name: 'Add model', exact: true }).click();
  await page.getByLabel('Custom model id').fill('fixture-classic');
  await page.getByRole('button', { name: 'Add to draft', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('already registered');
  await page.getByLabel('Custom model id').fill('local/finance');
  await page.getByRole('button', { name: 'Add to draft', exact: true }).click();
  await page.getByRole('tab', { name: 'Model pipeline', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Generator', exact: true }).click();
  await page.getByLabel('Generator model', { exact: true }).selectOption('local/finance');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('tab', { name: 'Custom models', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body.customModels).toEqual([{ id: 'local/finance', profile: 'classic' }]);
  expect((writes[0].body.models as Record<string, unknown>).generator).toEqual({ model: 'local/finance', modelSource: 'override' });
});

for (const view of ['capabilities', 'settings'] as const) test(`${view}: compact responsive layouts and light/dark accessibility`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fixture(page, view);
  for (const width of [1440, 580, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `audit-results/admin-workspace-2026-09-20/configuration-${view}-${width}.png` });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    expect((await new AxeBuilder({ page }).include('.admin-configuration').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  }
  await page.getByRole('button', { name: view === 'settings' ? 'Edit Generator' : 'Review questions', exact: true }).click();
  expect((await new AxeBuilder({ page }).include('.admin-configuration').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `audit-results/admin-workspace-2026-09-20/configuration-${view}-inspector-390.png` });
});

test('model sources follow environment defaults and allow a same-ID explicit override', async ({ page }) => {
  const { writes } = await fixture(page, 'settings');
  await page.getByRole('button', { name: 'Edit Generator', exact: true }).click();
  await page.getByLabel('Generator model', { exact: true }).selectOption('__environment__');
  await page.getByLabel('Generator reasoning effort', { exact: true }).selectOption('high');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect((writes[0].body.models as Record<string, unknown>).generator).toEqual({ model: 'fixture-reasoning', modelSource: 'environment', reasoningEffort: 'high' });
  await page.getByRole('button', { name: 'Edit Generator', exact: true }).click();
  await expect(page.getByLabel('Generator model', { exact: true })).toHaveValue('__environment__');
  await page.getByLabel('Generator model', { exact: true }).selectOption('fixture-reasoning');
  await expect(page.getByLabel('Generator reasoning effort', { exact: true })).toHaveValue('high');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect((writes[1].body.models as Record<string, unknown>).generator).toEqual({ model: 'fixture-reasoning', modelSource: 'override', reasoningEffort: 'high' });
});
