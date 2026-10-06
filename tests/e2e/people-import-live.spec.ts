import { test, expect, type Browser, type BrowserContext } from '@playwright/test';
import { ObjectId } from 'mongodb';
import { AUTH_FILE } from './global-setup';
import { connectMongo, closeMongo } from '../../server/src/components/mongodb';
import { auditCol, capabilitySettingsCol, coursePeopleImportsCol, coursesCol, usersCol } from '../../server/src/components/mongodb/collections';

type Identity = { puid: string; isAdmin: boolean; platformInstructor: boolean; courseRoles: Array<{ courseId: string; role: string }> };
async function signIn(browser: Browser, baseURL: string, username: string) {
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  try {
    const page = await context.newPage();
    await page.goto('/auth/ubcshib');
    await page.fill('input[name="username"]', username);
    await page.fill('input[name="password"]', username);
    await page.getByRole('button', { name: /login|log in|sign in|yes/i }).first().click();
    await page.waitForURL(`${baseURL}/**`);
    const response = await context.request.get('/api/auth/me');
    const state = await response.json() as { authenticated: boolean; user: Identity };
    expect(state.authenticated).toBe(true);
    return { context, user: state.user };
  } catch (error) { await context.close(); throw error; }
}

test.use({ storageState: AUTH_FILE });
test('manual CSV activates real CWL roles, analytics and TA permissions, then revokes only imported access', async ({ page, browser, baseURL }) => {
  test.setTimeout(90000);
  await connectMongo();
  let courseId: ObjectId | undefined;
  const contexts: BrowserContext[] = [];
  try {
    const student = await signIn(browser, baseURL!, 'student'); contexts.push(student.context);
    const teacher = await signIn(browser, baseURL!, 'staff'); contexts.push(teacher.context);
    const ta = await signIn(browser, baseURL!, 'ta'); contexts.push(ta.context);
    const created = await page.request.post('/api/courses', { data: { name: `People import acceptance ${Date.now()}`, courseCode: 'CSV-QA', term: '2026W1' } });
    expect(created.status(), await created.text()).toBe(201);
    courseId = new ObjectId((await created.json() as { _id: string })._id);
    const path = `/api/courses/${courseId}/people-import`;
    const csv = `Login ID,Role\n${student.user.puid},Student\n${teacher.user.puid},Teacher\n${ta.user.puid},TA`;
    const uploadedFile = { name: 'synthetic-local-people.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) };
    const preview = await page.request.post(`${path}/preview`, { multipart: { file: uploadedFile } });
    const previewData = await preview.json();
    expect(preview.status()).toBe(200); expect(previewData.rejects).toEqual([]); expect(previewData.members).toHaveLength(3);
    expect(await coursePeopleImportsCol().findOne({ _id: courseId })).toBeNull();
    const imported = await page.request.put(path, { multipart: { expectedRevision: '0', confirmedTeachingAccess: 'true', file: uploadedFile } });
    expect(imported.status(), await imported.text()).toBe(200);
    const identity = async (context: BrowserContext): Promise<Identity> => (await (await context.request.get('/api/auth/me')).json()).user;
    const hasRole = (user: Identity, role: string) => user.courseRoles.some(r => r.courseId === String(courseId) && r.role === role);
    const teacherAfter = await identity(teacher.context); const taAfter = await identity(ta.context);
    expect(hasRole(teacherAfter, 'instructor')).toBe(true); expect(hasRole(taAfter, 'ta')).toBe(true);
    expect(teacherAfter.platformInstructor).toBe(teacher.user.platformInstructor); expect(teacherAfter.isAdmin).toBe(teacher.user.isAdmin);
    expect(hasRole(await identity(student.context), 'student')).toBe(false);
    expect((await teacher.context.request.put(path, { multipart: { expectedRevision: '1', confirmedTeachingAccess: 'true', file: uploadedFile } })).status()).toBe(403);
    // Release only this isolated synthetic course to exercise the student gate.
    await coursesCol().updateOne({ _id: courseId }, { $set: { published: true, lifecycle: 'published', termStart: new Date(Date.now() - 86400000), termEnd: new Date(Date.now() + 86400000) } });
    expect(hasRole(await identity(student.context), 'student')).toBe(true);
    const enrollments = await student.context.request.get('/api/enrollments');
    expect((await enrollments.json()).some((e: { courseId: string }) => e.courseId === String(courseId))).toBe(true);
    const students = await page.request.get(`/api/courses/${courseId}/students?q=`);
    expect(students.status(), await students.text()).toBe(200);
    expect((await students.json()).some((u: { puid: string }) => u.puid === student.user.puid)).toBe(true);
    expect((await page.request.get(`/api/courses/${courseId}/students/${student.user.puid}/analytics`)).status()).toBe(200);
    const tas = await page.request.get(`/api/courses/${courseId}/tas`);
    expect((await tas.json()).some((u: { activatedPuid: string; source: string }) => u.activatedPuid === ta.user.puid && u.source === 'csv-import')).toBe(true);
    const permission = await page.request.put(`/api/courses/${courseId}/tas/${ta.user.puid}/permissions`, { data: { permissions: { 'analytics.view': false } } });
    expect(permission.status(), await permission.text()).toBe(204);
    const effective = await ta.context.request.get(`/api/courses/${courseId}/capabilities/me`);
    expect(effective.status()).toBe(200);
    const capabilities = await effective.json();
    expect(capabilities['analytics.view']).toBe(false);
    expect(capabilities['question.approve']).toBe(false);
    expect(capabilities['flag.resolve']).toBe(false);
    for (const puid of [student.user.puid, teacher.user.puid, ta.user.puid]) {
      const stored = await usersCol().findOne({ puid });
      expect(stored!.courseRoles.some(r => r.courseId.equals(courseId!))).toBe(false);
    }
    const cleared = await page.request.delete(path, { data: { expectedRevision: 1 } });
    expect(cleared.status()).toBe(200);
    expect(hasRole(await identity(student.context), 'student')).toBe(false);
    expect(hasRole(await identity(teacher.context), 'instructor')).toBe(false);
    expect(hasRole(await identity(ta.context), 'ta')).toBe(false);
    const events = await auditCol().find({ courseId, targetType: 'course-people-import' }).sort({ createdAt: 1, _id: 1 }).toArray();
    expect(events.map(e => e.action)).toEqual(['course.people.import', 'course.people.clear']);
  } finally {
    if (courseId) {
      await coursePeopleImportsCol().deleteMany({ courseId });
      await capabilitySettingsCol().deleteMany({ courseId });
      await auditCol().deleteMany({ courseId });
      await usersCol().updateMany({ 'courseRoles.courseId': courseId }, { $pull: { courseRoles: { courseId } } });
      await coursesCol().deleteOne({ _id: courseId });
    }
    await Promise.all(contexts.map(context => context.close()));
    await closeMongo();
  }
});
