'use strict';

const { chromium } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

const base = 'http://127.0.0.1:6133/admin-operations-v2/';
const out = path.join(__dirname, 'screenshots');
const report = { generatedAt: new Date().toISOString(), checks: [], layouts: [], accessibility: [], consoleErrors: [], externalRequests: [] };

(async () => {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => report.consoleErrors.push(e.message));
  page.on('request', (request) => { if (!request.url().startsWith(base) && !request.url().startsWith('blob:')) report.externalRequests.push(request.url()); });
  page.setDefaultTimeout(5000);
  const check = async (name, fn) => {
    try { await fn(); report.checks.push({ name, passed: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, passed: false, error: error.message }); console.log('FAIL ' + name + ': ' + error.message); }
  };
  const open = async (hash = '') => { await page.goto(base + hash); await page.locator('.activity-table').waitFor(); };
  const rows = () => page.locator('tbody tr');
  const text = (selector) => page.locator(selector).innerText();
  const clickAction = (action, id) => page.locator(`[data-action="${action}"]${id ? `[data-id="${id}"]` : ''}`).first().click();
  const inspect = async (id) => {
    await page.locator('#search').fill(id);
    await page.locator(`.operation-link[data-id="${id}"]`).click();
    await page.locator('.inspector').waitFor();
  };

  for (const width of [1440, 1280, 580, 390]) {
    await check(`Layout ${width}px`, async () => {
      await page.setViewportSize({ width, height: 900 });
      await open();
      const metrics = await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        firstRowTop: document.querySelector('tbody tr').getBoundingClientRect().top,
        rowHeight: document.querySelector('tbody tr').getBoundingClientRect().height,
        contentHeight: document.querySelector('.content').getBoundingClientRect().height,
      }));
      report.layouts.push(metrics);
      assert.ok(metrics.scrollWidth <= width + 1, `Document overflow: ${metrics.scrollWidth} > ${width}`);
      assert.ok(metrics.firstRowTop < 390, `First data row too low: ${metrics.firstRowTop}`);
      const clippedStatuses = await page.locator('tbody .status-col').evaluateAll((cells) => cells.filter((cell) => {
        const badge = cell.querySelector('.pill');
        const rect = cell.getBoundingClientRect();
        return badge.getBoundingClientRect().right > rect.right - Number.parseFloat(getComputedStyle(cell).paddingRight) + 1;
      }).map((cell) => cell.textContent));
      assert.deepEqual(clippedStatuses, [], 'Outcome badges should never be clipped');
      await page.screenshot({ path: path.join(out, `qa-${width}-table.png`) });
      await page.locator('.operation-link[data-id="RUN-2087"]').click();
      await page.locator('.inspector').waitFor();
      const bounds = await page.locator('.inspector').boundingBox();
      assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= width + 1, 'Inspector exceeds viewport');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Inspector causes document overflow');
      await page.screenshot({ path: path.join(out, `qa-${width}-inspector.png`) });
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.inspector').count(), 0);
    });
  }
  await check('1280 × 720 full-height inspector', async () => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await open();
    await page.locator('.operation-link[data-id="RUN-2087"]').click();
    const inspector = await page.locator('.inspector').boundingBox();
    const contextBounds = await page.locator('.property-list').boundingBox();
    assert.ok(inspector.y <= 60, `Inspector starts too low: ${inspector.y}`);
    assert.ok(inspector.height >= 620, `Inspector is too short: ${inspector.height}`);
    assert.ok(contextBounds.y + contextBounds.height < inspector.y + inspector.height - 48, 'Operation context should fit before the footer');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Inspector causes document overflow');
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    report.accessibility.push({ mode: '1280x720-inspector', violations: result.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })) })) });
    assert.equal(result.violations.length, 0, result.violations.map((v) => `${v.id} (${v.nodes.length})`).join(', '));
    report.layouts.push({ width: 1280, height: 720, inspectorTop: inspector.y, inspectorHeight: inspector.height, contextBottom: contextBounds.y + contextBounds.height });
    await page.screenshot({ path: path.join(out, 'qa-1280x720-inspector.png') });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });

  await check('Natural typing preserves search text and cursor', async () => {
    await open();
    await page.locator('#search').pressSequentially('Jordan');
    assert.equal(await page.locator('#search').inputValue(), 'Jordan');
    await page.locator('#search').press('Home');
    await page.locator('#search').pressSequentially('abc');
    assert.equal(await page.locator('#search').inputValue(), 'abcJordan');
  });

  await check('Search and empty state', async () => {
    await open();
    await page.locator('#search').fill('VERSION_CONFLICT');
    assert.equal(await rows().count(), 1);
    assert.match(await rows().innerText(), /REQ-8143/);
    await page.locator('#search').fill('nothing-matches-this-query');
    assert.equal(await rows().count(), 0);
    assert.match(await text('.empty-state'), /No matching events/);
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    assert.equal(await rows().count(), 20);
  });

  await check('Source tabs, sorting, pagination', async () => {
    await open();
    await clickAction('kind', 'run');
    assert.equal(await rows().count(), 10);
    await clickAction('kind', 'change');
    assert.equal(await rows().count(), 6);
    await clickAction('kind', 'request');
    assert.equal(await rows().count(), 20);
    await clickAction('kind', 'all');
    await page.locator('#page-size').selectOption('10');
    const firstPage = await rows().allTextContents();
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    assert.equal(await rows().count(), 10);
    assert.notDeepEqual(await rows().allTextContents(), firstPage);
    assert.match(await text('.table-footer .current'), /2 \/ 4/);
    await clickAction('sort', 'duration');
    assert.equal(await rows().first().getAttribute('data-row'), 'RUN-2088');
    await clickAction('sort', 'duration');
    assert.match(await rows().first().getAttribute('data-row'), /AUD-|REQ-8144|RUN-2089/);
  });

  await check('User, course, outcome, and time filters', async () => {
    await open();
    await clickAction('filters');
    await page.locator('#actor-filter').selectOption('Jordan Lee');
    await page.locator('#course-filter').selectOption('COMM 298');
    await clickAction('close-popover');
    await page.locator('#status-filter').selectOption('Failed');
    assert.equal(await rows().count(), 2);
    await page.locator('#range-filter').selectOption('1');
    assert.equal(await rows().count(), 1);
    assert.equal(await rows().first().getAttribute('data-row'), 'RUN-2087');
    await page.locator('.operation-link').first().click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#status-filter').inputValue(), 'Failed');
    assert.match(await text('.chips'), /Jordan Lee/);
    assert.match(page.url(), /actor=Jordan\+Lee/);
  });

  await check('Accepted request links to failed task without rewriting outcome', async () => {
    await open();
    await inspect('REQ-8142');
    assert.match(await text('.issue-callout'), /Request accepted ≠ task completed/);
    await page.locator('.inspector [data-action="inspect"][data-id="RUN-2087"]').click();
    assert.match(await text('.inspector-heading'), /Failed/);
    assert.match(await text('.issue-callout'), /1000\.00/);
    assert.match(await text('.inspector-top'), /Outside current filter/);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#search').inputValue(), 'REQ-8142');
  });

  await check('Unverified browser report and interrupted outcome', async () => {
    await open(); await inspect('REQ-8144');
    assert.match(await text('.issue-callout'), /unverified/);
    assert.doesNotMatch(await text('.property-list'), /HTTP 0/);
    await page.keyboard.press('Escape');
    await inspect('REQ-8145');
    assert.match(await text('.issue-callout'), /may have been saved/);
    assert.match(await text('.issue-callout'), /before retrying/);
  });

  await check('Recorded and seeded reproduction are distinct', async () => {
    await open(); await inspect('RUN-2087');
    await page.getByRole('button', { name: 'Reproduce question', exact: true }).click();
    await page.getByRole('button', { name: 'Reproduce calculation', exact: true }).click();
    assert.match(await text('.replay-result'), /Recorded values reproduced/);
    assert.match(await text('.replay-result'), /\$1000\.00/);
    await page.locator('#replay-mode').selectOption('seeded');
    await page.locator('[name="seed"]').fill('9');
    await page.getByRole('button', { name: 'Generate sample', exact: true }).click();
    assert.match(await text('.replay-result'), /New sample · not historical evidence/);
    assert.match(await text('.replay-result'), /1198\.35/);
    await page.keyboard.press('Escape');
    await inspect('REQ-8146');
    await page.getByRole('button', { name: 'Reproduce question', exact: true }).click();
    assert.match(await text('.detail-scroll'), /Exact replay unavailable/);
    assert.equal(await page.locator('#replay-form').count(), 0);
  });

  await check('CSV, evidence, and selected-row exports', async () => {
    await open();
    await page.locator('#status-filter').selectOption('Failed');
    const download1 = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export filtered activity', exact: true }).click();
    const file1 = await download1;
    const csv = await fs.readFile(await file1.path(), 'utf8');
    assert.equal(csv.split('\n').length, 8);
    assert.match(csv, /ANSWER|Generate questions/);
    await page.locator('[data-check="RUN-2087"]').check();
    const download2 = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export selected', exact: true }).click();
    const file2 = await download2;
    const selected = await fs.readFile(await file2.path(), 'utf8');
    assert.equal(selected.split('\n').length, 2);
    await page.locator('.operation-link[data-id="RUN-2087"]').click();
    const download3 = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export evidence', exact: true }).click();
    const file3 = await download3;
    const evidence = JSON.parse(await fs.readFile(await file3.path(), 'utf8'));
    assert.equal(evidence.id, 'RUN-2087');
    assert.equal(evidence.input.expectedAnswer, 1000);
  });

  await check('Saved view survives reload', async () => {
    await open();
    await page.locator('#status-filter').selectOption('Failed');
    await clickAction('views'); await clickAction('save-view');
    await page.locator('#save-view-form [name="name"]').fill('QA saved failures');
    await page.getByRole('button', { name: 'Save view', exact: true }).click();
    await open();
    await clickAction('views');
    await page.getByRole('button', { name: 'QA saved failures', exact: true }).click();
    assert.equal(await page.locator('#status-filter').inputValue(), 'Failed');
    assert.equal(await rows().count(), 7);
  });

  await check('Keyboard search, tab navigation, and Escape', async () => {
    await open(); await page.locator('h1').click();
    await page.keyboard.press('/');
    assert.equal(await page.locator('#search').evaluate((el) => el === document.activeElement), true);
    await page.getByRole('tab', { name: 'All activity' }).focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.getByRole('tab', { name: 'User operations' }).getAttribute('aria-selected'), 'true');
    await clickAction('filters'); await page.keyboard.press('Escape');
    assert.equal(await page.locator('.filter-popover').count(), 0);
    await page.getByRole('button', { name: 'About this design', exact: true }).click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#modal').evaluate((el) => el.open), false);
  });

  for (const mode of ['default', 'drawer', 'desktop-timeline', 'desktop-reproduction']) {
    await check(`Accessibility ${mode}`, async () => {
      await page.setViewportSize({ width: mode === 'drawer' ? 580 : 1440, height: 1000 });
      await open();
      if (mode === 'drawer') await inspect('RUN-2087');
      if (mode.startsWith('desktop-')) {
        await inspect('RUN-2087');
        if (mode === 'desktop-timeline') await page.getByRole('tab', { name: 'Timeline', exact: true }).click();
        else {
          await page.getByRole('button', { name: 'Reproduce question', exact: true }).click();
          await page.getByRole('button', { name: 'Reproduce calculation', exact: true }).click();
        }
        await page.screenshot({ path: path.join(out, `qa-${mode}.png`) });
        if (mode === 'desktop-reproduction') {
          await page.locator('.detail-scroll').evaluate((el) => { el.scrollTop = el.scrollHeight; });
          await page.screenshot({ path: path.join(out, 'qa-desktop-reproduced-result.png') });
        }
      }
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      report.accessibility.push({ mode, violations: result.violations.map((v) => ({ id: v.id, impact: v.impact, description: v.description, nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })) })) });
      assert.equal(result.violations.length, 0, result.violations.map((v) => `${v.id} (${v.nodes.length})`).join(', '));
    });
  }

  report.passed = report.checks.filter((x) => x.passed).length;
  report.failed = report.checks.filter((x) => !x.passed).length;
  await fs.writeFile(path.join(out, 'verification.json'), JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify({ passed: report.passed, failed: report.failed, errors: report.consoleErrors, report: path.join(out, 'verification.json') }, null, 2));
  if (report.failed || report.consoleErrors.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
