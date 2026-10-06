import { test, expect, type Browser, type BrowserContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { mkdir } from 'node:fs/promises';
import { connectMongo, closeMongo } from '../../server/src/components/mongodb';
import { auditCol, capabilitySettingsCol, coursePeopleAccessCol, coursePeopleImportsCol, coursesCol, registrationCodeBatchesCol, usersCol } from '../../server/src/components/mongodb/collections';

type Identity = { puid: string; uid: string; email: string; courseRoles: Array<{ courseId: string; role: string }> };
async function signIn(browser: Browser, baseURL: string, username: string) {
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] }, permissions: ['clipboard-read', 'clipboard-write'] });
  try {
    await expect.poll(async () => { try { return (await context.request.get('/api/health')).ok(); } catch { return false; } }, { timeout: 15000 }).toBe(true);
    const page = await context.newPage(); await page.goto('/auth/ubcshib');
    await page.fill('input[name="username"]', username); await page.fill('input[name="password"]', username);
    await page.getByRole('button', { name: /login|log in|sign in|yes/i }).first().click();
    await page.waitForURL(`${baseURL}/**`);
    const state = await (await context.request.get('/api/auth/me')).json(); expect(state.authenticated).toBe(true);
    return { context, page, user: state.user as Identity };
  } catch (error) { await context.close(); throw error; }
}

test('People: real SAML roles, durable course bans, search/pages, Share invitations and code copy', async ({ browser, baseURL }) => {
  await connectMongo();
  const contexts: BrowserContext[] = [];
  const courseId = new ObjectId(); const otherCourseId = new ObjectId();
  const screenshots = 'artifacts/people-workspace-live-2026-10-06'; await mkdir(screenshots, { recursive: true });
  try {
    const owner = await signIn(browser, baseURL!, 'faculty'); contexts.push(owner.context);
    const student = await signIn(browser, baseURL!, 'student'); contexts.push(student.context);
    const ta = await signIn(browser, baseURL!, 'ta'); contexts.push(ta.context);
    const instructor = await signIn(browser, baseURL!, 'staff'); contexts.push(instructor.context);
    const now = new Date();
    const course = { name: 'People Workspace · Local Acceptance', courseCode: `PPL${String(courseId).slice(-5)}`, term: '2026W', ownerPuid: owner.user.puid,
      registrationCode: `OLD${String(courseId).slice(-5)}`, published: true, lifecycle: 'published' as const,
      termStart: new Date(now.getTime() - 86400000), termEnd: new Date(now.getTime() + 86400000), feedbackStrategy: 'adaptive' as const,
      autoPause: { minAttempts: 5, flagPercent: 30, flagCount: 3 }, redirectFailureThreshold: 3, reviewBacklogThreshold: 10, createdAt: now };
    await coursesCol().insertOne({ _id: courseId, ...course });
    await coursesCol().insertOne({ _id: otherCourseId, ...course, courseCode: `OTH${String(otherCourseId).slice(-5)}`, registrationCode: `OTH${String(otherCourseId).slice(-5)}` });
    await usersCol().updateOne({ puid: owner.user.puid }, { $addToSet: { courseRoles: { courseId, role: 'instructor' } } });
    await usersCol().updateOne({ puid: student.user.puid }, { $addToSet: { courseRoles: { courseId: otherCourseId, role: 'student' } } });
    const base = `/api/courses/${courseId}`;
    const csv = `Student,SIS Login ID\nStudent Test,${student.user.puid}\n${Array.from({ length: 31 }, (_, i) => `Synthetic Student ${String(i + 1).padStart(2, '0')},PEOPLE-${courseId}-${i}`).join('\n')}\n`;
    const upload = (revision: number) => owner.context.request.put(`${base}/people-import`, { multipart: {
      expectedRevision: String(revision), confirmedTeachingAccess: 'false', file: { name: 'synthetic-gradebook.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) },
    } });
    expect((await upload(0)).status()).toBe(200);
    const me = async (context: BrowserContext): Promise<Identity> => (await (await context.request.get('/api/auth/me')).json()).user;
    const role = async (context: BrowserContext) => (await me(context)).courseRoles.filter(r => r.courseId === String(courseId)).map(r => r.role);
    expect(await role(student.context)).toEqual(['student']);
    const invite = (identifier: string, targetRole: string, permissions = {}) => owner.context.request.post(`${base}/people`, { data: { identifier, role: targetRole, ...(targetRole === 'ta' ? { permissions } : {}) } });
    expect((await invite(ta.user.uid, 'ta', { 'question.suggest-edit': false })).status()).toBe(201);
    expect(await role(ta.context)).toEqual(['ta']);
    expect((await invite(instructor.user.uid, 'instructor')).status()).toBe(201);
    expect(await role(instructor.context)).toEqual(['instructor']);
    expect((await instructor.context.request.get(`${base}/people`)).status()).toBe(200);
    expect((await instructor.context.request.post(`${base}/people`, { data: { identifier: 'no-access@ubc.ca', role: 'instructor' } })).status()).toBe(403);
    expect((await student.context.request.get(`${base}/people`)).status()).toBe(403);
    expect((await ta.context.request.get(`${base}/people`)).status()).toBe(403);
    const getPerson = async (puid: string) => (await (await owner.context.request.get(`${base}/people?search=${encodeURIComponent(puid)}`)).json()).people.find((p: { puid: string }) => p.puid === puid);
    const modify = async (puid: string, action: string, targetRole?: string) => {
      const person = await getPerson(puid);
      return owner.context.request.patch(`${base}/people/${encodeURIComponent(person.id)}`, { data: { expectedRevision: person.revision, action, ...(targetRole ? { role: targetRole } : {}) } });
    };
    expect((await modify(owner.user.puid, 'ban')).status()).toBe(403);
    const original = await getPerson(student.user.puid);
    expect((await modify(student.user.puid, 'role', 'ta')).status()).toBe(200);
    expect(await role(student.context)).toEqual(['ta']);
    expect((await owner.context.request.patch(`${base}/people/${encodeURIComponent(original.id)}`, { data: { expectedRevision: original.revision, action: 'ban' } })).status()).toBe(409);
    expect((await modify(student.user.puid, 'ban')).status()).toBe(200);
    expect(await role(student.context)).toEqual([]);
    expect((await me(student.context)).courseRoles.some(r => r.courseId === String(otherCourseId) && r.role === 'student')).toBe(true);
    expect((await upload(1)).status()).toBe(200);
    expect(await role(student.context)).toEqual([]);
    await owner.context.request.post(`${base}/registration-codes`, { data: { count: 3, requestId: randomUUID() } });
    const codes = (await (await owner.context.request.get(`${base}/registration-codes`)).json()).codes;
    expect((await student.context.request.post('/api/enrollments', { data: { code: codes[0].code } })).status()).toBe(403);
    expect((await modify(student.user.puid, 'unban')).status()).toBe(200);
    expect(await role(student.context)).toEqual(['ta']);
    expect((await modify(student.user.puid, 'role', 'student')).status()).toBe(200);
    expect(await role(student.context)).toEqual(['student']);
    expect((await instructor.context.request.post(`${base}/registration-codes`, { data: { count: 1, requestId: randomUUID() } })).status()).toBe(403);
    // Validate safe TA preset and hard-denied capabilities through the real endpoint.
    const permissions = (await (await ta.context.request.get(`${base}/capabilities/me`)).json());
    // The self-capabilities route returns its documented wrapper when available.
    const values = permissions.capabilities ?? permissions;
    expect(values['question.approve']).toBe(false); expect(values['flag.resolve']).toBe(false); expect(values['question.suggest-edit']).toBe(false);
    await owner.page.goto(`/#/instructor/course/${courseId}/people`);
    await expect(owner.page.getByRole('heading', { name: 'People', exact: true })).toBeVisible();
    await expect(owner.page.locator('.people-table tbody tr')).toHaveCount(10);
    await owner.page.addStyleTag({ content: '*{animation:none!important;transition:none!important}' });
    await owner.page.screenshot({ path: `${screenshots}/01-people-desktop.png`, fullPage: true });
    expect((await new AxeBuilder({ page: owner.page }).include('.people-workspace').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    await owner.page.getByRole('button', { name: 'Next people page' }).click();
    await expect(owner.page.locator('.people-pagination')).toContainText('Page 2');
    await owner.page.getByRole('searchbox', { name: 'Search people' }).fill('Synthetic Student 31');
    await expect(owner.page.locator('.people-table tbody tr')).toHaveCount(1);
    await owner.page.screenshot({ path: `${screenshots}/02-search.png`, fullPage: true });
    await owner.page.getByRole('button', { name: 'Share', exact: true }).click();
    await expect(owner.page.getByRole('dialog', { name: 'Share course' })).toBeVisible();
    await owner.page.getByRole('textbox', { name: 'UBC email or CWL' }).fill('pending-people-test@ubc.ca');
    await owner.page.getByRole('radio', { name: 'TA', exact: true }).check();
    await owner.page.screenshot({ path: `${screenshots}/03-share-role-invite.png` });
    expect((await new AxeBuilder({ page: owner.page }).include('.people-dialog').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    await owner.page.getByRole('button', { name: 'Save invitation', exact: true }).click();
    await expect(owner.page.locator('.people-dialog .inline-feedback')).toContainText('Invitation saved');
    await owner.page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await owner.page.getByRole('button', { name: /Invitations \(/ }).click();
    await owner.page.getByRole('searchbox', { name: 'Search people' }).fill('');
    await expect(owner.page.locator('.people-table')).toContainText('pending-people-test@ubc.ca');
    await owner.page.screenshot({ path: `${screenshots}/04-invitations.png`, fullPage: true });
    await owner.page.getByRole('button', { name: 'Registration codes', exact: true }).click();
    await expect(owner.page.locator('.registration-code-row')).toHaveCount(3);
    await owner.page.locator('.registration-code-copy').first().click();
    const copied = await owner.page.evaluate(() => navigator.clipboard.readText());
    expect(codes.map((c: { code: string }) => c.code)).toContain(copied);
    await expect(owner.page.locator('.registration-codes-notice')).toContainText('copied');
    await owner.page.screenshot({ path: `${screenshots}/05-click-code-copy.png`, fullPage: true });
    await owner.page.getByRole('button', { name: 'Import Gradebook', exact: true }).click();
    const updatedCsv = `${csv}Late Joiner Alice,PEOPLE-LATE-A-${courseId}\nLate Joiner Ben,PEOPLE-LATE-B-${courseId}\n`;
    await expect(owner.page.getByRole('dialog', { name: 'Import people from Canvas', exact: true }).getByRole('button', { name: 'Browse files', exact: true })).toBeVisible();
    await owner.page.getByLabel('Canvas people CSV').setInputFiles({ name: 'gradebook-with-late-joiners.csv', mimeType: 'text/csv', buffer: Buffer.from(updatedCsv) });
    await expect(owner.page.locator('.people-import-preview .import-change-summary')).toContainText('2 newly added');
    await expect(owner.page.locator('.people-import-preview .import-change-table')).toContainText('Late Joiner Alice');
    await expect(owner.page.locator('.people-import-preview .import-change-table')).toContainText('Late Joiner Ben');
    expect((await new AxeBuilder({ page: owner.page }).include('.people-dialog').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    await owner.page.screenshot({ path: `${screenshots}/08-gradebook-new-people-preview.png` });
    await owner.page.getByRole('dialog', { name: 'Import people from Canvas', exact: true }).getByRole('button', { name: 'Import people', exact: true }).click();
    await owner.page.getByRole('dialog', { name: 'Import course people?', exact: true }).getByRole('button', { name: 'Import people', exact: true }).click();
    await expect(owner.page.getByRole('dialog', { name: 'Import people from Canvas', exact: true })).toContainText('2 newly added people; see the names above');
    await expect(owner.page.locator('.people-import-changes')).toContainText('Late Joiner Alice');
    await owner.page.screenshot({ path: `${screenshots}/09-gradebook-new-people-saved.png` });
    await owner.page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await owner.page.getByRole('button', { name: /^People \(/ }).click();
    await owner.page.getByRole('searchbox', { name: 'Search people' }).fill('');
    await owner.page.getByRole('searchbox', { name: 'Search people' }).fill(instructor.user.puid);
    await expect(owner.page.locator('.people-table tbody tr')).toHaveCount(1);
    await expect(owner.page.locator('.person-name')).toHaveText('Staff Member');
    await owner.page.getByRole('button', { name: 'Change role for Staff Member', exact: true }).click();
    await owner.page.getByRole('radio', { name: 'TA', exact: true }).check();
    await owner.page.screenshot({ path: `${screenshots}/10-change-role.png` });
    await owner.page.getByRole('button', { name: 'Save role', exact: true }).click();
    await expect(owner.page.getByRole('dialog')).toHaveCount(0);
    expect(await role(instructor.context)).toEqual(['ta']);
    await owner.page.getByRole('button', { name: /^Ban / }).click();
    await owner.page.getByRole('dialog').getByRole('button', { name: 'Ban from course', exact: true }).click();
    await expect(owner.page.locator('.status-badge')).toHaveText('Banned');
    expect(await role(instructor.context)).toEqual([]);
    await owner.page.screenshot({ path: `${screenshots}/11-banned-person.png`, fullPage: true });
    await owner.page.getByRole('searchbox', { name: 'Search people' }).fill('');
    await expect(owner.page.locator('.people-table tbody tr')).toHaveCount(10);
    await owner.page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    expect((await new AxeBuilder({ page: owner.page }).include('.people-workspace').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    await owner.page.screenshot({ path: `${screenshots}/06-people-dark.png`, fullPage: true });
    await owner.page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await owner.page.setViewportSize({ width: 390, height: 844 });
    await owner.page.screenshot({ path: `${screenshots}/07-people-mobile.png`, fullPage: true });
    expect((await new AxeBuilder({ page: owner.page }).include('.people-workspace').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    expect(await owner.page.locator('.people-workspace').evaluate(n => n.scrollWidth <= n.clientWidth + 1)).toBe(true);
  } finally {
    await Promise.all([courseId, otherCourseId].flatMap(id => [coursesCol().deleteOne({ _id: id }), coursePeopleAccessCol().deleteMany({ courseId: id }), coursePeopleImportsCol().deleteMany({ courseId: id }), registrationCodeBatchesCol().deleteMany({ courseId: id }), auditCol().deleteMany({ courseId: id }), capabilitySettingsCol().deleteMany({ courseId: id }), usersCol().updateMany({}, { $pull: { courseRoles: { courseId: id } } })]));
    await Promise.all(contexts.map(c => c.close())); await closeMongo();
  }
});
