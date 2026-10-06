/* Run after setup-local.rb, seed-local.rb and local SAML fixtures. Real browser/API evidence. */
const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs'); const path = require('node:path');
const base = 'http://localhost:6118';
const output = path.resolve('audit-results/canvas-integration');
fs.mkdirSync(output, { recursive: true });
const evidence = [];
async function snap(page, name, title, detail) {
  if (name === '05-multiselect') await page.locator('.canvas-choices').evaluate(e => e.scrollIntoView({block:'center'}));
  if (name === '06-roster') await page.getByRole('heading', {name:/Combined roster/}).evaluate(e => e.scrollIntoView({block:'start'}));
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true, animations: 'disabled' });
  evidence.push({ name, title, detail, screenshot: `${name}.png`, at: new Date().toISOString() });
  fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log('PASS',name,title);
}
async function login(page, username) {
  await page.goto(`${base}/auth/ubcshib`);
  if (await page.locator('[name=username]').count()) {
    await page.locator('[name=username]').fill(username); await page.locator('[name=password]').fill(username);
    await page.getByRole('button', { name: /login/i }).click();
  }
  await page.waitForURL(`${base}/**`);
  const me = await (await page.request.get(`${base}/api/auth/me`)).json();
  expect(me.authenticated).toBe(true); return me;
}
async function json(page, endpoint, method = 'GET', data) {
  return page.evaluate(async ({ endpoint, method, data }) => {
    const r = await fetch(endpoint, { method, headers: { 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: r.status, body: r.status === 204 ? null : await r.json() };
  }, { endpoint, method, data });
}
(async () => {
 const browser = await chromium.launch();
 const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
 const page = await context.newPage();
 try {
  await login(page, 'faculty');
  await page.goto(`${base}/#/instructor/courses`);
  await page.getByRole('link', { name: 'Connect or link Canvas' }).waitFor();
  await expect(page.locator('.course-list')).toBeVisible();
  await snap(page, '01-existing-ui', '保留原有 My Courses 卡片', '新增 Canvas 入口；课程卡片仍由原 course-card.ts 渲染。');
  await page.getByRole('link', { name: 'Connect or link Canvas' }).click();
  await page.getByRole('heading', { name: 'One FinanceBot course, multiple Canvas sections' }).waitFor();
  const connect = page.getByRole('button', { name: /^(Connect Canvas|Reconnect Canvas)$/ });
  await snap(page, '02-connect', '教师发起 Canvas 授权', 'FinanceBot 已通过真实 CWL SAML 登录，教师点击连接。');
  await connect.click();
  await page.waitForURL(u => u.port !== '6118');
  if (new URL(page.url()).pathname.includes('/login/canvas')) {
    await snap(page, '03-canvas-login', '真实本地 Canvas 登录', '浏览器跳转到运行中的 Canvas LMS。');
    await page.locator('#pseudonym_session_unique_id').fill('financebot-demo-teacher');
    await page.locator('#pseudonym_session_password').fill('financebot-demo-teacher');
    await page.getByRole('button', { name: /log in/i }).click();
  }
  await page.locator('input.Button--primary').waitFor();
  await snap(page, '04-oauth-consent', '教师确认只读 OAuth 授权', '专用 Developer Key；读取课程、学生与文件，不写入成绩。');
  await page.locator('input.Button--primary').click();
  await page.waitForURL(`${base}/**`);
  await page.getByRole('heading', { name: 'Canvas is connected' }).waitFor();
  await page.getByRole('checkbox', { name: /FINANCEBOT-DEMO-101/ }).check();
  await page.getByRole('checkbox', { name: /FINANCEBOT-DEMO-102/ }).check();
  await page.getByLabel('FinanceBot course', { exact: true }).selectOption('new');
  const stamp = Date.now();
  await page.getByLabel('New course name').fill('Canvas linked Finance · 101 + 102');
  await page.getByLabel('New course code').fill(`FB${stamp}`);
  await page.getByLabel('New course term').fill('2026W1');
  await page.getByLabel('New course sections').fill('101 + 102');
  await snap(page, '05-multiselect', '101 与 102 同时关联一个新课程', '两个复选框可同时选中；可编辑课程名称、学期和合并班级标签。');
  await page.getByRole('button', { name: 'Save course links' }).click();
  await page.waitForURL(/#\/instructor\/course\/[a-f0-9]+\/canvas/);
  const id = page.url().match(/course\/([a-f0-9]+)\/canvas/)[1];
  fs.writeFileSync(path.join(output, 'course.json'), JSON.stringify({ courseId: id }));
  await page.getByRole('heading', { name: 'Combined roster · 20 students' }).waitFor();
  const linked = await json(page, `/api/courses/${id}/canvas`);
  expect(linked.body.students).toHaveLength(20); expect(linked.body.sources).toHaveLength(2);
  expect(linked.body.students.filter(s => s.name === 'Alex Chen')).toHaveLength(2);
  await snap(page, '06-roster', '22 个班级成员记录合并成 20 名学生', '101 有12人，102有10人，两人跨班；同名 Alex Chen 保留两个不同身份。');
  await page.getByRole('button', { name: 'Browse Canvas files' }).click();
  await page.getByRole('checkbox', { name: 'Finance foundations.txt', exact: true }).first().check();
  await snap(page, '07-files', '从已关联 Canvas 课程选择材料', '列出两个来源班的真实 Canvas 文件，保留来源课程标签。');
  await page.getByRole('button', { name: 'Import selected files' }).click();
  await page.getByText('Finance foundations.txt — imported; processing in Course Materials.').waitFor();
  await snap(page, '08-import', '真实 Canvas 文件导入成功', 'Toolkit 下载文件后交给现有材料处理队列。');
  await context.storageState({ path: path.join(output, 'instructor-auth.json') });
  console.log('COURSE', id);
 } catch (error) {
  await page.screenshot({path:path.join(output,'failure.png'),fullPage:true,animations:'disabled'});
  console.error('FAIL',error.message); console.error((await page.locator('body').innerText()).slice(-3000)); process.exitCode = 1;
 } finally { await browser.close(); }
})();
