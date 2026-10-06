/* Local acceptance walkthrough. Only authored synthetic sources are sent to models. */
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { chromium } = require('@playwright/test');
const { ObjectId } = require('mongodb');
const root = process.cwd();
const out = path.join(root, 'artifacts/generation-quality-local-2026-10-05');
const mongo = require(path.join(root, 'server/dist/components/mongodb'));
const cols = require(path.join(root, 'server/dist/components/mongodb/collections'));
const embeddings = require(path.join(root, 'server/dist/components/genai/embeddings'));
const qdrant = require(path.join(root, 'server/dist/components/qdrant'));
const materials = require(path.join(root, 'server/dist/services/materials.service'));
const questions = require(path.join(root, 'server/dist/services/questions.service'));
const report = { startedAt: new Date().toISOString(), syntheticDataOnly: true, mocks: false, steps: [], runs: [], checks: [], screenshots: [] };
let browser, context, page;
const save = () => fs.writeFile(path.join(out, 'evidence.json'), JSON.stringify(report, null, 2));
async function api(method, url, data) {
  const r = await context.request[method](url, data ? { data } : {});
  const body = await r.json();
  report.steps.push({ method: method.toUpperCase(), url, status: r.status(), at: new Date().toISOString() });
  if (!r.ok()) throw new Error(`${method} ${url}: HTTP ${r.status()} ${body.error || body.message || 'request failed'}`);
  return body;
}
async function shot(name, caption) {
  await page.screenshot({ path: path.join(out, 'images', name + '.png'), fullPage: false });
  report.screenshots.push({ name, caption, url: page.url(), viewport: page.viewportSize() });
  await save(); console.log('SCREENSHOT', name);
}
async function go(hash) {
  await page.goto('http://localhost:6118/#' + hash);
  await page.waitForTimeout(1200);
  const dismiss = page.getByRole('button', { name: /Skip tutorial|Skip tour|Not now|Dismiss/i });
  if (await dismiss.first().isVisible().catch(() => false)) await dismiss.first().click();
}
async function run(name, data) {
  console.log('START_RUN', name);
  const started = Date.now();
  const { runId } = await api('post', `/api/courses/${report.courseId}/preseeding`, { loId: report.loId, count: 1, type: 'mcq', difficulty: 'easy', kind: 'conceptual', ...data });
  let snap;
  for (let i = 0; i < 100; i++) {
    snap = await api('get', `/api/courses/${report.courseId}/content-runs/${runId}`);
    if (['completed', 'partial', 'failed'].includes(snap.status)) break;
    if (i === 1) { await go(`/instructor/course/${report.courseId}/preseeding`); await shot(name + '-running', 'Live persisted generation progress'); }
    if (i % 6 === 0) console.log('RUN_STAGE', name, snap.stage);
    await page.waitForTimeout(4000);
  }
  const usage = await api('get', `/api/courses/${report.courseId}/content-runs/${runId}/usage`);
  const exported = ['completed', 'partial', 'failed'].includes(snap.status) ? await api('get', `/api/courses/${report.courseId}/content-runs/${runId}/evaluation-export`) : null;
  report.runs.push({ name, runId, seconds: Math.round((Date.now() - started) / 1000), snapshot: snap, usage, exported });
  await save(); console.log('END_RUN', name, snap.status, JSON.stringify(snap.error || {}));
  await go(`/instructor/course/${report.courseId}/preseeding`);
  await shot(name + '-terminal', 'Actual terminal generation state');
  const button = page.locator(`[data-gw-focus="steps-${runId}"]`);
  if (await button.count()) {
    await button.click(); await page.waitForTimeout(700);
    await shot(name + '-checks', 'Actual checks and model usage from persisted run');
    const dialog = page.getByRole('dialog');
    const checks = dialog.getByText('Check details', { exact: true });
    for (let i = 0; i < await checks.count(); i++) await checks.nth(i).click();
    if (await checks.count()) await shot(name + '-check-details', 'Source, notation and novelty findings');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  }
  return snap;
}
(async () => {
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ baseURL: 'http://localhost:6118', viewport: { width: 1512, height: 982 }, reducedMotion: 'reduce' });
  page = await context.newPage();
  await page.goto('http://localhost:6118/auth/ubcshib');
  await page.locator('input[name="username"]').fill('admin');
  await page.locator('input[name="password"]').fill('admin');
  await page.getByRole('button', { name: /login|log in|sign in|yes/i }).first().click();
  await page.waitForURL('http://localhost:6118/', { timeout: 30000 });
  const me = await api('get', '/api/auth/me');
  report.actor = me.user?.puid || me.puid;
  const course = await api('post', '/api/courses', { name: 'Generation Quality · Local Acceptance · Synthetic', courseCode: 'QLT' + String(Date.now()).slice(-8), term: '2026W' });
  report.courseId = course._id; report.courseCode = course.courseCode;
  const theme = await api('post', `/api/courses/${course._id}/themes`, { name: 'Risk and CAPM', availableFrom: '2020-01-01T00:00:00.000Z' });
  const lo = await api('post', `/api/themes/${theme._id}/los`, { name: 'Distinguish systematic risk from total volatility and interpret CAPM' });
  report.loId = lo._id;
  await mongo.connectMongo();
  const courseId = new ObjectId(course._id), materialId = new ObjectId();
  const source = 'Synthetic Finance teaching note. CAPM uses E[R_i] = r_f + beta_i (E[R_m] - r_f). Preserve the notation beta_i, r_f, and E[R_m] - r_f. beta_i measures exposure to systematic market risk; total annual return volatility is not beta_i. Diversification removes firm-specific risk, but not systematic risk. Two securities with equal beta_i have equal CAPM required returns, even if their total volatility differs. A larger beta_i implies a larger required return when the market risk premium is positive. Lecture scope excludes option pricing, Black-Scholes, alpha regressions, Sharpe ratios, and multifactor models.';
  report.sourceText = source;
  await cols.materialsCol().insertOne({ _id: materialId, courseId, name: 'Synthetic Finance note · CAPM scope', format: 'txt', kind: 'lecture-notes', status: 'ready', assignments: [{ themeId: new ObjectId(theme._id), loId: new ObjectId(lo._id) }], uploadedAt: new Date(), excerpt: source });
  await cols.materialChunksCol().insertOne({ courseId, materialId, index: 0, text: source, characterCount: source.length, createdAt: new Date() });
  const vector = await embeddings.embedOne(source);
  await qdrant.ensureCollection(materials.courseCollection(courseId), vector.length);
  await qdrant.upsertPoints(materials.courseCollection(courseId), [{ id: randomUUID(), vector, payload: { materialId: materialId.toHexString(), chunkIndex: 0, chunk: source } }]);
  report.sourceSetup = 'Synthetic material/chunk inserted in MongoDB and embedded into Qdrant using production components. Upload and parsing were not tested.';
  const seed = await questions.createQuestion({ courseId, loIds: [new ObjectId(lo._id)], themeIds: [new ObjectId(theme._id)], createdBy: report.actor, type: 'mcq', difficulty: 'easy', numericKind: 'conceptual', stem: 'Existing bank question: Which measure determines systematic risk in CAPM?', options: [
    { key: 'A', text: 'beta_i', role: 'correct', explanation: 'CAPM prices exposure to systematic market risk through beta_i.' },
    { key: 'B', text: 'Total annual return volatility', role: 'common-misconception', explanation: 'Total volatility includes firm-specific risk and is not beta_i.' },
    { key: 'C', text: 'Firm-specific risk alone', role: 'partially-correct', explanation: 'Firm-specific risk can be diversified away; it does not determine systematic exposure.' },
    { key: 'D', text: 'The security price alone', role: 'clearly-wrong', explanation: 'A price is not a measure of exposure to market risk.' }
  ], sourceRefs: [{ materialId, chunk: source }] });
  report.seedQuestionId = seed.questionId.toHexString();
  await save();
  await go(`/instructor/course/${course._id}/materials`); await shot('01-source', 'Original synthetic Finance source in the actual Materials workspace');
  await go(`/instructor/course/${course._id}/preseeding`);
  await shot('02-generation-baseline', 'Baseline is the default; the optional pilot is visible in the real generation form');
  const pilot = page.getByRole('checkbox', { name: 'Sources and question memory pilot' });
  if (await pilot.count()) { await pilot.check(); await shot('03-generation-pilot', 'Enable source support, notation and existing-question checks'); }
  const baseline = await run('04-baseline', { prompt: 'Create a concise concept question about CAPM systematic risk. Do not use numerical parameters.' });
  const providerFailure = /429|quota|rate.limit|authentication|401|403/i.test(JSON.stringify(baseline.error || {}) + JSON.stringify(baseline.result?.failures || []));
  if (!providerFailure) {
    await run('05-pilot', { count: 2, qualityPolicy: 'grounded-memory-v1', prompt: 'Create concise concept questions grounded only in the note. Test different reasoning from existing bank and queue questions. One can compare equal beta_i and different total volatility; another can interpret diversification. Preserve lecture notation.' });
    await run('06-scope-challenge', { qualityPolicy: 'grounded-memory-v1', prompt: 'Create a question requiring the Black-Scholes option pricing formula, even though it is not taught in the supplied note.' });
  } else report.checks.push({ name: 'Provider acceptance', status: 'blocked', detail: 'Provider rejected the live baseline. Further paid generation was not started.' });
  const anon = await browser.newContext({ baseURL: 'http://localhost:6118' });
  const denied = await anon.request.get(`/api/courses/${course._id}/content-runs/${report.runs[0].runId}/usage`);
  report.checks.push({ name: 'Unauthenticated usage endpoint denied', status: denied.status() === 401 ? 'pass' : 'fail', http: denied.status() });
  await anon.close();
  await go(`/admin/operations?tab=usage&courseId=${course._id}`); await shot('07-admin-usage', 'Actual model calls filtered to the synthetic local course');
  await go(`/admin/operations?tab=workflows&courseId=${course._id}`); await shot('08-admin-workflow', 'Recorded API actions and background tasks for this course');
  const workflow = await api('get', `/api/admin/workflows?courseId=${course._id}`); report.workflow = workflow;
  const usage = await api('get', `/api/admin/model-usage?courseId=${course._id}`); report.adminUsage = usage;
  await context.storageState({ path: path.join(root, 'tests/e2e/.auth/quality-local.json') });
  report.finishedAt = new Date().toISOString(); report.fixtureRetained = true;
  await save(); console.log('DONE', report.courseId);
})().catch(async error => { report.failure = error.message; await save(); console.error('WALKTHROUGH_FAILED', error.message); process.exitCode = 1; }).finally(async () => { await mongo.closeMongo(); await browser?.close(); });
