import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { TUTORIAL_DEFINITIONS } from '../../client/src/tutorial-definitions';
import type { AuthUser } from '../../client/src/api';

const COURSE = '507f1f77bcf86cd799439011';
const OTHER_COURSE = '507f1f77bcf86cd799439012';
type Role = 'admin' | 'instructor' | 'ta' | 'student';
const LABELS = { admin: 'Admin', instructor: 'Instructor', ta: 'TA', student: 'Student' };
const COURSES = [
  { _id: COURSE, name: 'Finance Foundations', courseCode: 'FIN 101', section: '001', term: '2026W1', lifecycle: 'published', published: true },
  { _id: OTHER_COURSE, name: 'Advanced Finance', courseCode: 'FIN 201', section: '002', term: '2026W1', lifecycle: 'published', published: true },
];

async function fixture(page: Page, role: Role, options: { theme?: 'light' | 'dark'; path?: string; forgedRole?: Role } = {}) {
  const user: AuthUser = {
    puid: `ROLE-FIXTURE-${role}`, uid: role, displayName: `${LABELS[role]} User`,
    isAdmin: role === 'admin', platformInstructor: role === 'instructor',
    affiliations: [role === 'admin' ? 'staff' : role === 'instructor' ? 'faculty' : 'student'],
    courseRoles: role === 'admin' ? [] : COURSES.map(course => ({ courseId: course._id, role })),
  };
  const writes: string[] = [];
  const unhandled: string[] = [];
  const requests: URL[] = [];
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  await page.addInitScript(({ theme, puid, forgedRole }) => {
    localStorage.setItem('tlef-theme', theme);
    if (forgedRole) sessionStorage.setItem(`financebot:workspace-role:${puid}`, forgedRole);
  }, { theme: options.theme ?? 'light', puid: user.puid, forgedRole: options.forgedRole });
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    requests.push(url);
    if (route.request().method() !== 'GET') {
      writes.push(`${route.request().method()} ${path}`);
      return route.fulfill({ status: 405, json: { error: 'This fixture permits no mutations.' } });
    }
    if (path === '/api/auth/me') return route.fulfill({ json: { authenticated: true, user } });
    if (path === '/api/tutorials') return route.fulfill({ json: TUTORIAL_DEFINITIONS.map(definition => ({ id: definition.id, role: definition.role, version: 1, status: 'dismissed' })) });
    if (path === '/api/notifications') return route.fulfill({ json: [] });
    if (path === '/api/admin/directory' || path === '/api/admin/users') return route.fulfill({ json: [] });
    if (path === '/api/admin/courses' || path === '/api/courses') return route.fulfill({ json: COURSES });
    if (path === '/api/enrollments') return route.fulfill({ json: COURSES.map(course => ({ courseId: course._id, name: course.name, courseCode: course.courseCode, term: course.term, active: true })) });
    const course = COURSES.find(entry => path === `/api/courses/${entry._id}` || path.startsWith(`/api/courses/${entry._id}/`));
    if (course && path === `/api/courses/${course._id}`) return route.fulfill({ json: { ...course, themes: [] } });
    if (course && path.endsWith('/preview/identity')) return route.fulfill({ json: { name: course.name, courseCode: course.courseCode, term: course.term, section: course.section } });
    if (course && path.endsWith('/outline')) return route.fulfill({ json: { course, themes: [] } });
    if (course && path.endsWith('/learning/library')) return route.fulfill({ json: { settings: { mode: 'topic-practice', order: 'instructor', notes: [] }, questions: [], themes: [] } });
    if (course && path.endsWith('/home')) return route.fulfill({ json: [] });
    if (course && path.endsWith('/session-summary')) return route.fulfill({ json: { welcome: false, deferred: null } });
    if (course && path.endsWith('/capabilities/me')) return route.fulfill({ json: { 'question.review': true, 'question.suggestEdit': true } });
    if (course && path.endsWith('/questions')) return route.fulfill({ json: { questions: [], total: 0 } });
    if (course && path.endsWith('/ta/review-queue')) return route.fulfill({ json: [] });
    unhandled.push(path);
    return route.fulfill({ status: 404, json: { error: `Unconfigured role fixture: ${path}` } });
  });
  const defaultPath = role === 'admin' ? '/admin/users' : role === 'instructor' ? '/instructor/courses' : role === 'ta' ? '/ta/courses' : '/';
  await page.goto(`/#${options.path ?? defaultPath}`);
  await expect(page.locator('.app-shell--unified')).toBeVisible();
  await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
  return {
    user, writes, requests,
    assertClean() {
      expect(unhandled, 'Every API call must stay inside the fixture').toEqual([]);
      expect(writes, 'Role switching must never mutate permissions or student records').toEqual([]);
      expect(browserErrors).toEqual([]);
    },
  };
}

const roleButton = (page: Page, role: Role) => page.getByRole('button', { name: `Switch role, current role ${LABELS[role]}`, exact: true });

async function openRoles(page: Page, current: Role) {
  await roleButton(page, current).click();
  const menu = page.getByRole('navigation', { name: 'Switch role', exact: true });
  await expect(menu).toBeVisible();
  return menu;
}

async function switchRole(page: Page, current: Role, next: Role, back = false) {
  const menu = await openRoles(page, current);
  await menu.getByRole('link', { name: `${back ? 'Back to' : 'Switch to'} ${LABELS[next]}`, exact: true }).click();
  await expect(roleButton(page, next)).toBeVisible();
  await expect(page.getByRole('link', { name: /^Exit (?:Preview|TA View)$/, includeHidden: true })).toHaveCount(0);
}

async function sidebarGeometry(page: Page, color: string) {
  await expect(page.locator('.sidebar')).toHaveCSS('width', '210px');
  await expect(page.locator('.sidebar')).toHaveCSS('background-color', color);
  await expect(page.locator('.sidebar .nav__link').first()).toHaveCSS('font-size', '11px');
  await expect(page.locator('.topbar')).toHaveCSS('height', '52px');
  await page.getByRole('button', { name: 'Collapse navigation', exact: true }).click();
  await expect(page.locator('.sidebar')).toHaveCSS('width', '60px');
  await page.getByRole('button', { name: 'Expand navigation', exact: true }).click();
}

test('Admin cycles every workspace and returns; sidebar dimensions match and course actions stay black', async ({ page }) => {
  const state = await fixture(page, 'admin');
  await sidebarGeometry(page, 'rgb(12, 13, 15)');
  await page.locator('.sidebar').getByRole('link', { name: 'My Courses', exact: true }).click();
  await expect(page.locator('.course-card')).toHaveCount(2);
  const create = page.getByRole('button', { name: '+ Create course', exact: true });
  await expect(create).toHaveCSS('background-color', 'rgb(26, 31, 26)');
  const adminPrimary = await create.evaluate(element => getComputedStyle(element).backgroundColor);
  await switchRole(page, 'admin', 'instructor');
  await expect(page.locator('html')).not.toHaveAttribute('data-admin', 'true');
  await expect(page.getByLabel('Anonymous Instructor Preview; course changes are live', { exact: true })).toHaveText('Anonymous Instructor Preview');
  await expect(page.locator('.instructor-pill')).toHaveText('PREVIEW MODE');
  await expect(page.locator('.app-shell')).toHaveClass(/app-shell--instructor-preview/);
  await sidebarGeometry(page, 'rgb(36, 95, 53)');
  await expect(create).toHaveCSS('background-color', adminPrimary);
  await page.reload();
  await expect(roleButton(page, 'instructor')).toBeVisible();
  await expect(page.getByText('Anonymous Instructor Preview', { exact: true })).toBeVisible();
  await switchRole(page, 'instructor', 'ta');
  await expect(page.locator('.course-card')).toHaveCount(2);
  await sidebarGeometry(page, 'rgb(36, 95, 53)');
  await switchRole(page, 'ta', 'student');
  await expect(page.locator('.course-card')).toHaveCount(2);
  await sidebarGeometry(page, 'rgb(47, 76, 171)');
  await switchRole(page, 'student', 'admin', true);
  await expect(page.getByRole('heading', { name: 'User Directory', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-admin', 'true');
  state.assertClean();
});

test('Admin role views keep usable TA and Student help without writing tutorial progress', async ({ page }) => {
  const state = await fixture(page, 'admin');
  await switchRole(page, 'admin', 'ta');
  const taHelp = page.locator('.sidebar').getByRole('link', { name: 'Help & Tutorials' });
  await expect(taHelp).toBeVisible();
  await taHelp.click();
  await expect(page.getByRole('heading', { name: 'Help & Tutorials' })).toBeVisible();
  await expect(page.locator('.help-lesson')).toHaveCount(4);
  await expect(page.locator('.help-lesson[data-tutorial-id^="student-"]')).toHaveCount(0);
  await page.getByRole('link', { name: 'Open page' }).first().click();
  await expect(page.getByRole('heading', { name: 'Review Queue' })).toBeVisible();
  await expect(taHelp).toBeHidden();
  await page.locator('.sidebar').getByRole('link', { name: 'Back to all courses' }).click();
  await expect(taHelp).toBeVisible();
  await switchRole(page, 'ta', 'student');
  const studentHelp = page.locator('.sidebar').getByRole('link', { name: 'Help & Tutorials' });
  await expect(studentHelp).toBeVisible();
  await studentHelp.click();
  await expect(page.getByRole('heading', { name: 'Help & Tutorials' })).toBeVisible();
  await expect(page.locator('.help-lesson')).toHaveCount(6);
  await expect(page.locator('.help-lesson[data-tutorial-id="student-exam-prep"]')).toHaveCount(0);
  await expect(page.locator('.help-lesson[data-tutorial-id^="ta-"]')).toHaveCount(0);
  await expect(page.getByText('Tutorial progress is not saved in this view.')).toBeVisible();
  await switchRole(page, 'student', 'admin', true);
  state.assertClean();
  expect(state.requests.some(url => url.pathname === '/api/tutorials' && url.searchParams.get('role') === 'student')).toBe(false);
  expect(state.requests.some(url => url.pathname === '/api/tutorials' && url.searchParams.get('role') === 'ta')).toBe(false);
});

for (const role of ['admin', 'instructor', 'ta'] as const) test(`${role} TA review scrolls long questions with the mouse wheel`, async ({ page }) => {
  const state = await fixture(page, role);
  const options = ['10%', '12%', '14%', '16%'].map((text, index) => ({
    key: String.fromCharCode(65 + index), role: index === 1 ? 'correct' : 'distractor',
    text: `{{VALUE_${index}}}`, explanation: `Calculation and explanation for option ${index + 1}. `.repeat(12),
  }));
  const current = { _id: 'version-1', type: 'mcq', difficulty: 'easy', version: 1,
    stem: 'What is the return when X = {{X}}?', options, paramSlots: [{ name: 'X' }], sourceRefs: [] };
  const sample = { seed: 3, parameterized: true, stem: 'What is the return when X = 10?',
    options: options.map((option, index) => ({ key: option.key, text: ['10%', '12%', '14%', '16%'][index], explanation: option.explanation })) };
  const question = { id: 'question-1', courseId: COURSE, currentVersionId: current._id, currentVersion: 1,
    state: 'draft', labels: [], loIds: [], themeIds: [], current, priority: 1, sample, suggestions: [], internalNotes: [], versions: [],
    agentDecision: { decision: 'pass', reasoning: 'Evidence and calculation checked. '.repeat(18), roleAssessment: '' } };
  await page.route(`**/api/courses/${COURSE}/ta/review-queue`, route => route.fulfill({ json: [question] }));
  await page.route('**/api/questions/question-1', route => route.fulfill({ json: question }));
  if (role !== 'ta') await switchRole(page, role, 'ta');
  await page.locator('.course-card').first().click();
  await expect(page.locator('.ta-reader-layout .question-stem')).toContainText('X = 10');
  await expect(page.locator('.ta-reader-layout .question-stem')).not.toContainText('{{X}}');
  await expect(page.locator('.ta-reader-layout .review-workbench__answer').first()).toContainText('10%');
  for (const width of [1280, 1440, 1728]) {
    await page.setViewportSize({ width, height: 800 });
    const frame = await page.locator('.ta-review-workbench').boundingBox();
    const actions = await page.locator('.ta-reader-actions').boundingBox();
    const board = await page.getByRole('button', { name: /Question board/ }).boundingBox();
    expect(frame).not.toBeNull();
    expect(actions).not.toBeNull();
    expect(board).not.toBeNull();
    expect(frame!.y + frame!.height).toBeLessThanOrEqual(800);
    expect(actions!.y + actions!.height).toBeLessThanOrEqual(800);
    expect(board!.y + board!.height).toBeLessThanOrEqual(800);
    const geometry = await page.locator('.ta-reader-layout').evaluate(element => {
      const reader = element.querySelector<HTMLElement>('.review-workbench__body')!;
      const inspector = element.querySelector<HTMLElement>('.review-workbench__inspector')!;
      const scroll = element.closest<HTMLElement>('.ta-embedded')!;
      scroll.scrollTop = 0;
      return { width: element.getBoundingClientRect().width, readerWidth: reader.getBoundingClientRect().width,
        inspectorWidth: inspector.getBoundingClientRect().width,
        documentWidth: document.documentElement.scrollWidth };
    });
    expect(geometry.readerWidth).toBeGreaterThan(500);
    expect(geometry.inspectorWidth).toBeGreaterThan(270);
    expect(geometry.documentWidth).toBeLessThanOrEqual(width);
    const content = await page.locator('.ta-reader-layout .review-workbench__body').boundingBox();
    await page.mouse.move(content!.x + 80, content!.y + 70);
    await page.mouse.wheel(0, 1000);
    await expect.poll(() => page.locator('.ta-embedded').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await page.mouse.wheel(0, 5000);
    await expect(page.getByLabel('Add a note')).toBeInViewport();
    const after = await page.locator('.ta-reader-actions').boundingBox();
    expect(Math.abs(after!.y - actions!.y)).toBeLessThanOrEqual(1);
    if (role === 'ta' && width === 1728) await page.screenshot({ path: '/tmp/ta-review-scroll-fixed.png' });
    await page.locator('.ta-embedded').evaluate(element => { element.scrollTop = 0; });
    const inspector = await page.locator('.ta-reader-layout .review-workbench__inspector').boundingBox();
    // On laptops the context follows the question; on wide screens it is
    // beside it. Wheel input must reach the same outer reader in either case.
    await page.locator('.ta-reader-layout .review-workbench__inspector h2').scrollIntoViewIfNeeded();
    const context = await page.locator('.ta-reader-layout .review-workbench__inspector h2').boundingBox();
    const scrollBefore = await page.locator('.ta-embedded').evaluate(element => element.scrollTop);
    await page.mouse.move(inspector!.x + 30, context!.y + 30);
    await page.mouse.wheel(0, width <= 1450 ? -500 : 500);
    await expect.poll(() => page.locator('.ta-embedded').evaluate(element => element.scrollTop)).not.toBe(scrollBefore);
  }
  for (const width of [390, 768, 850, 851]) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
    await expect(page.locator('.ta-reader-layout .question-stem')).toBeVisible();
    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(documentWidth).toBeLessThanOrEqual(width);
    await page.getByLabel('Add a note').scrollIntoViewIfNeeded();
    await expect(page.getByLabel('Add a note')).toBeInViewport();
  }
  state.assertClean();
});

test('Instructor offers TA and isolated Student workspaces with a return to Instructor', async ({ page }) => {
  const state = await fixture(page, 'instructor');
  const menu = await openRoles(page, 'instructor');
  await expect(menu.getByRole('link')).toHaveCount(3);
  await expect(menu.getByRole('link', { name: /Admin/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(roleButton(page, 'instructor')).toBeFocused();
  await expect(roleButton(page, 'instructor')).toHaveAttribute('aria-expanded', 'false');
  await roleButton(page, 'instructor').press('Space');
  await expect(menu).toBeVisible();
  await expect(roleButton(page, 'instructor')).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await switchRole(page, 'instructor', 'ta');
  await expect(page.locator('.course-card')).toHaveCount(2);
  await switchRole(page, 'ta', 'instructor', true);
  await switchRole(page, 'instructor', 'student');
  await expect(page).toHaveURL(/#\/preview\/courses/);
  await expect(page.locator('.course-card')).toHaveCount(2);
  await switchRole(page, 'student', 'instructor', true);
  await expect(page.getByRole('heading', { name: 'My Courses', exact: true })).toBeVisible();
  state.assertClean();
});

test('TA can preview assigned courses as Student and return without higher-role controls', async ({ page }) => {
  const state = await fixture(page, 'ta');
  await expect(page.locator('.sidebar').getByRole('link', { name: 'Help & Tutorials' })).toBeVisible();
  await expect(page.locator('.sidebar .nav').getByRole('link', { name: 'My Courses', exact: true })).toHaveAttribute('aria-current', 'page');
  const sidebar = (await page.locator('.sidebar').boundingBox())!;
  const footer = (await page.locator('.sidebar__foot').boundingBox())!;
  expect(footer.y).toBeGreaterThan(sidebar.y + sidebar.height - 80);
  const menu = await openRoles(page, 'ta');
  await expect(menu.getByRole('link')).toHaveCount(2);
  await expect(menu.getByRole('link', { name: /Admin|Instructor/ })).toHaveCount(0);
  await menu.getByRole('link', { name: 'Switch to Student', exact: true }).click();
  await expect(roleButton(page, 'student')).toBeVisible();
  await expect(page.locator('.course-card')).toHaveCount(2);
  await page.locator('.course-card').filter({ hasText: 'Finance Foundations' }).click();
  await expect(page.getByRole('heading', { name: 'Finance Foundations', exact: true, level: 1 })).toBeVisible();
  const studentMenu = await openRoles(page, 'student');
  await expect(studentMenu.getByRole('link', { name: 'Back to TA', exact: true })).toHaveAttribute('href', `#/ta/course/${COURSE}/review?workspace=ta`);
  await page.keyboard.press('Escape');
  await page.locator('.sidebar').getByRole('link', { name: 'My Courses', exact: true }).click();
  await switchRole(page, 'student', 'ta', true);
  await expect(page).toHaveURL(/#\/ta\/courses/);
  state.assertClean();
});

test('Student Preview switches course identity and isolated session, and refresh resumes the selected course', async ({ page }) => {
  const state = await fixture(page, 'admin');
  await switchRole(page, 'admin', 'student');
  await page.locator('.course-card').filter({ hasText: 'Finance Foundations' }).click();
  await expect(page.getByRole('heading', { name: 'Finance Foundations', exact: true, level: 1 })).toBeVisible();
  const first = await page.evaluate(() => JSON.parse(sessionStorage.getItem('financebot-anonymous-preview')!));
  expect(first.courseId).toBe(COURSE);
  await page.locator('.sidebar').getByRole('link', { name: 'My Courses', exact: true }).click();
  await page.locator('.course-card').filter({ hasText: 'Advanced Finance' }).click();
  await expect(page.getByRole('heading', { name: 'Advanced Finance', exact: true, level: 1 })).toBeVisible();
  const second = await page.evaluate(() => JSON.parse(sessionStorage.getItem('financebot-anonymous-preview')!));
  expect(second.courseId).toBe(OTHER_COURSE);
  expect(second.previewSessionId).not.toBe(first.previewSessionId);
  await page.reload();
  await expect(roleButton(page, 'student')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Advanced Finance', exact: true, level: 1 })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('financebot-anonymous-preview')!).previewSessionId)).toBe(second.previewSessionId);
  expect(state.requests.filter(url => /\/home$/.test(url.pathname)).every(url => url.pathname.includes('/preview/'))).toBe(true);
  await switchRole(page, 'student', 'admin', true);
  expect(await page.evaluate(() => sessionStorage.getItem('financebot-anonymous-preview'))).toBeNull();
  state.assertClean();
});

test('real Student shares course cards but cannot gain higher workspaces through saved preferences or query parameters', async ({ page }) => {
  const state = await fixture(page, 'student', { forgedRole: 'admin', path: '/admin/users?workspace=admin' });
  await expect(page.locator('.sidebar').getByRole('link', { name: 'Help & Tutorials' })).toBeVisible();
  await expect(roleButton(page, 'student')).toBeVisible();
  await expect(page.locator('.course-card')).toHaveCount(2);
  await expect(page.getByRole('link', { name: 'Open FIN 101 Finance Foundations', exact: true })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Learning objectives covered' })).toHaveCount(2);
  await expect(page.getByRole('button', { name: '+ Create course', exact: true })).toHaveCount(0);
  const menu = await openRoles(page, 'student');
  await expect(menu.getByRole('link')).toHaveCount(1);
  await expect(menu.getByRole('link', { name: 'Switch to Student', exact: true })).toBeVisible();
  for (const path of ['/instructor/courses?workspace=instructor', '/ta/courses?workspace=ta', '/preview/courses?workspace=student']) {
    await page.goto(`/#${path}`);
    await expect(roleButton(page, 'student')).toBeVisible();
    await expect(page.locator('.course-card')).toHaveCount(2);
  }
  expect(state.requests.some(url => url.pathname.startsWith('/api/admin/') || url.pathname === '/api/courses' || url.pathname.includes('/preview/'))).toBe(false);
  state.assertClean();
});

test('unsaved changes block role navigation before preference updates or Preview cleanup', async ({ page }) => {
  const state = await fixture(page, 'instructor');
  await expect(page.locator('.course-card')).toHaveCount(2);
  await expect.poll(() => state.requests.some(url => url.pathname === '/api/tutorials')).toBe(true);
  const preference = `financebot:workspace-role:${state.user.puid}`;
  const guard = async () => page.evaluate(async () => {
    const root = document.querySelector<HTMLElement>('#view-root > .view')!;
    root.dataset.leaveDecisions = '0';
    const { protectUnsavedChanges } = await import('/js/router.js');
    protectUnsavedChanges(root, () => true, async () => {
      root.dataset.leaveDecisions = String(Number(root.dataset.leaveDecisions) + 1);
      return root.dataset.allowLeave === 'true';
    });
  });
  await guard();
  const requestCount = state.requests.length;
  const menu = await openRoles(page, 'instructor');
  await menu.getByRole('link', { name: 'Switch to Student', exact: true }).click();
  await expect(page.locator('#view-root > .view')).toHaveAttribute('data-leave-decisions', '1');
  await expect(page).toHaveURL(/#\/instructor\/courses$/);
  await expect(roleButton(page, 'instructor')).toBeVisible();
  expect(await page.evaluate(key => sessionStorage.getItem(key), preference)).toBe('instructor');
  expect(state.requests).toHaveLength(requestCount);
  await page.locator('#view-root > .view').evaluate(root => { (root as HTMLElement).dataset.allowLeave = 'true'; });
  await switchRole(page, 'instructor', 'student');
  await expect(page.locator('.course-card')).toHaveCount(2);
  const previewSession = await page.evaluate(() => sessionStorage.getItem('financebot-anonymous-preview'));
  expect(previewSession).not.toBeNull();
  await guard();
  const studentMenu = await openRoles(page, 'student');
  await studentMenu.getByRole('link', { name: 'Back to Instructor', exact: true }).click();
  await expect(page.locator('#view-root > .view')).toHaveAttribute('data-leave-decisions', '1');
  await expect(roleButton(page, 'student')).toBeVisible();
  await expect(page).toHaveURL(/#\/preview\/courses\?workspace=student$/);
  expect(await page.evaluate(key => sessionStorage.getItem(key), preference)).toBe('student');
  expect(await page.evaluate(() => sessionStorage.getItem('financebot-anonymous-preview'))).toBe(previewSession);
  await page.locator('#view-root > .view').evaluate(root => { (root as HTMLElement).dataset.allowLeave = 'true'; });
  await switchRole(page, 'student', 'instructor', true);
  expect(await page.evaluate(() => sessionStorage.getItem('financebot-anonymous-preview'))).toBeNull();
  state.assertClean();
});

for (const theme of ['light', 'dark'] as const) {
  test(`mobile role menu remains reachable and accessible in ${theme} mode`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const state = await fixture(page, 'admin', { theme });
    const menu = await openRoles(page, 'admin');
    await expect(menu.getByRole('link', { name: 'Switch to Student', exact: true })).toBeVisible();
    expect((await new AxeBuilder({ page }).include('.topbar').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    await menu.getByRole('link', { name: 'Switch to Student', exact: true }).click();
    await expect(roleButton(page, 'student')).toBeVisible();
    await expect(page.getByRole('link', { name: /^Exit (?:Preview|TA View)$/, includeHidden: true })).toHaveCount(0);
    await expect(page.locator('.course-card')).toHaveCount(2);
    await openRoles(page, 'student');
    const menuBounds = (await page.locator('.role-switcher__menu').boundingBox())!;
    expect(menuBounds.x).toBeGreaterThanOrEqual(0);
    expect(menuBounds.x + menuBounds.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect((await new AxeBuilder({ page }).include('.topbar').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `audit-results/role-workspaces/student-role-menu-mobile-${theme}.png`, fullPage: true });
    await page.getByRole('navigation', { name: 'Switch role', exact: true }).getByRole('link', { name: 'Back to Admin', exact: true }).click();
    await expect(roleButton(page, 'admin')).toBeVisible();
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
    await expect(page.locator('.sidebar')).toHaveCSS('width', '230px');
    await expect(page.locator('.sidebar')).toHaveCSS('background-color', 'rgb(12, 13, 15)');
    await expect(page.locator('.sidebar').getByRole('link', { name: 'User Directory', exact: true })).toBeVisible();
    state.assertClean();
  });
}

for (const role of ['instructor', 'ta'] as const) test(`${role} course navigation returns to global tools through the compact back link`, async ({ page }) => {
  const state = await fixture(page, role, { path: role === 'ta' ? `/ta/course/${COURSE}/review` : `/instructor/course/${COURSE}/bank` });
  const sidebar = page.locator('.sidebar');
  await expect(sidebar.getByRole('link', { name: role === 'ta' ? 'Review Queue' : 'Question Bank', exact: true })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'My Courses', exact: true })).toBeHidden();
  await expect(sidebar.getByRole('link', { name: 'Help & Tutorials' })).toBeHidden();
  if (role === 'instructor') await expect(sidebar.getByRole('link', { name: 'Canvas connection' })).toBeHidden();
  await expect(sidebar.locator('.course-context__project')).toHaveCount(0);
  const back = sidebar.getByRole('link', { name: 'Back to all courses' });
  await expect(back).toBeVisible();
  await page.screenshot({ path: `audit-results/role-workspaces/${role}-compact-course-navigation.png`, fullPage: true });
  await page.getByRole('button', { name: 'Collapse navigation', exact: true }).click();
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(new RegExp(`#/${role}/courses$`));
  await expect(page.locator('.course-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Expand navigation', exact: true }).click();
  await expect(sidebar.getByRole('link', { name: 'My Courses', exact: true })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Help & Tutorials' })).toBeVisible();
  state.assertClean();
});
