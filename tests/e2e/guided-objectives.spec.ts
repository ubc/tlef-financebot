import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function fixture(page: Page, empty = false) {
  const topics = empty ? [] : Array.from({ length: 5 }, (_, i) => ({
    _id: `topic-${i}`, name: `Topic ${i + 1} physics`, order: i,
    availableFrom: '2026-09-01',
    los: Array.from({ length: 3 }, (_, j) => ({ _id: `lo-${i}-${j}`, themeId: `topic-${i}`, order: j, name: `Explain principle ${i + 1}.${j + 1}` })),
  }));
  let failSave = false;
  let failRead = false;
  await page.route('**/objectives-fixture', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><title>Objectives test</title><link rel="stylesheet" href="/styles/main.css"></head><body><main></main></body></html>' }));
  await page.route('**/api/**', async r => {
    const url = new URL(r.request().url());
    if (url.pathname.endsWith('/content-runs/events')) return r.fulfill({ contentType: 'text/event-stream', body: 'event: snapshot\ndata: []\n\n' });
    if (url.pathname === '/api/courses/course') return r.fulfill(failRead ? { status: 503, json: { error: 'Cannot load objectives' } } : { json: { _id: 'course', name: 'Physics', themes: topics } });
    if (url.pathname === '/api/courses/course/outline') {
      if (failSave) return r.fulfill({ status: 503, json: { error: 'Please retry saving' } });
      const data = r.request().postDataJSON();
      const input = data.themes[0];
      let topic = topics.find(t => t.name === input.name);
      if (!topic) { topic = { _id: 'new-topic', name: input.name, order: topics.length, availableFrom: '', los: [] }; topics.push(topic); }
      for (const name of input.los) if (!topic.los.some(lo => lo.name === name)) topic.los.push({ _id: `new-${name}`, themeId: topic._id, order: topic.los.length, name });
      return r.fulfill({ json: { losCreated: input.los.length, themesCreated: 0 } });
    }
    if (url.pathname.startsWith('/api/los/')) {
      const lo = topics.flatMap(t => t.los).find(l => l._id === url.pathname.split('/').pop())!;
      Object.assign(lo, r.request().postDataJSON());
      return r.fulfill({ json: lo });
    }
    if (url.pathname.endsWith('/instructor-workflow')) return r.fulfill({ status: 503, json: { error: 'Aggregate unavailable' } });
    return r.fulfill({ json: [] });
  });
  const open = async () => {
    await page.evaluate(async () => {
      const { openCourseSetupGuide } = await import('/js/views/instructor/course-setup-guide.js');
      openCourseSetupGuide({ courseId: 'course', actionId: 'choose-authoring-path', learningObjectiveCount: 0, onChanged: () => {} });
    });
    await page.getByRole('button', { name: /^2\. Learning objectives/ }).click();
  };
  await page.goto('/objectives-fixture');
  await open();
  return { topics, open, setFailSave: (v: boolean) => { failSave = v; }, setFailRead: (v: boolean) => { failRead = v; } };
}

test('existing objectives, cancel, inline edit and step return preserve saved work', async ({ page }) => {
  const state = await fixture(page);
  await expect(page.getByText('15 learning objectives across 5 topics')).toBeVisible();
  await expect(page.getByLabel('Learning Objectives — one per line')).toHaveCount(0);
  await page.screenshot({ path: '/tmp/guided-objectives-desktop.png' });
  expect((await new AxeBuilder({ page }).include('.course-setup-guide').analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: '+ Add learning objectives', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Explain principle 1.1', exact: true }).click();
  await page.getByLabel('Learning objective name').fill('Understand vector addition');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Understand vector addition', { exact: true })).toBeVisible();
  expect(state.topics[0].availableFrom).toBe('2026-09-01');
  await page.getByRole('button', { name: 'Continue to questions →', exact: true }).click();
  await page.getByRole('button', { name: /^2\. Learning objectives/ }).click();
  await expect(page.getByText('Understand vector addition', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close course setup guide' }).click();
  await state.open();
  await expect(page.getByText('Understand vector addition', { exact: true })).toBeVisible();
});

test('add to existing or new topic, failed save retains input, and reload restores results', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('button', { name: '+ Add learning objectives', exact: true }).click();
  await page.getByRole('combobox', { name: 'Topic', exact: true }).selectOption('topic-2');
  await expect(page.getByLabel('Topic name', { exact: true })).toBeHidden();
  await page.getByLabel('Learning Objectives — one per line').fill('Apply Newton’s law');
  state.setFailSave(true);
  await page.getByRole('button', { name: 'Save Learning Objectives', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Please retry saving');
  await expect(page.getByLabel('Learning Objectives — one per line')).toHaveValue('Apply Newton’s law');
  state.setFailSave(false);
  await page.getByRole('button', { name: 'Save Learning Objectives', exact: true }).click();
  await expect(page.getByText('16 learning objectives across 5 topics')).toBeVisible();
  expect(state.topics[2].los).toHaveLength(4);
  await page.getByRole('button', { name: '+ Add learning objectives', exact: true }).click();
  await page.getByRole('combobox', { name: 'Topic', exact: true }).selectOption('');
  await page.getByLabel('Topic name', { exact: true }).fill('Momentum');
  await page.getByLabel('Learning Objectives — one per line').fill('Apply conservation of momentum');
  await page.getByRole('button', { name: 'Save Learning Objectives', exact: true }).click();
  await expect(page.getByText('17 learning objectives across 6 topics')).toBeVisible();
  await page.reload(); await state.open();
  await expect(page.getByText('Apply conservation of momentum', { exact: true })).toBeVisible();
});

test('empty and error states stay distinct; mobile dark reduced-motion remains accessible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const state = await fixture(page, true);
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  await expect(page.getByText('What should students be able to do?')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to questions →' })).toBeDisabled();
  expect((await new AxeBuilder({ page }).include('.course-setup-guide').analyze()).violations).toEqual([]);
  expect(await page.locator('.course-setup-guide__body').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  state.setFailRead(true);
  await page.getByRole('button', { name: /^2\. Learning objectives/ }).click();
  await expect(page.getByRole('alert')).toContainText('Cannot load objectives');
  state.setFailRead(false);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('What should students be able to do?')).toBeVisible();
});

test('populated objective list and add form fit a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await expect(page.getByText('15 learning objectives across 5 topics')).toBeVisible();
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  await page.screenshot({ path: '/tmp/guided-objectives-mobile.png' });
  await page.getByRole('button', { name: '+ Add learning objectives', exact: true }).click();
  expect((await new AxeBuilder({ page }).include('.course-setup-guide').analyze()).violations).toEqual([]);
  expect(await page.locator('.course-setup-guide__body').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  await page.getByRole('button', { name: 'Cancel', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Your learning objectives' })).toBeFocused();
});
