import { test, expect, type Browser, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { connectMongo, closeMongo } from '../../server/src/components/mongodb';
import { auditCol, capabilitySettingsCol, courseInstructorSharesCol, coursePeopleImportsCol, coursesCol, registrationCodeBatchesCol, taInvitesCol, usersCol } from '../../server/src/components/mongodb/collections';

type Identity = { puid: string; uid: string; email: string; courseRoles: Array<{ courseId: string; role: string }>; isAdmin: boolean; platformInstructor?: boolean };
async function signIn(browser: Browser, baseURL: string, username: string) {
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  try {
    const page = await context.newPage();
    await page.goto('/auth/ubcshib');
    await page.fill('input[name="username"]', username); await page.fill('input[name="password"]', username);
    await page.getByRole('button', { name: /login|log in|sign in|yes/i }).first().click();
    await page.waitForURL(`${baseURL}/**`);
    const state = await (await context.request.get('/api/auth/me')).json();
    expect(state.authenticated).toBe(true);
    return { context, page, user: state.user as Identity };
  } catch (error) { await context.close(); throw error; }
}

test('Gradebook, one-time claims and TA/CWL invitations work against real SAML and Mongo', async ({ browser, baseURL }) => {
  await connectMongo();
  const contexts: BrowserContext[] = [];
  const courseId = new ObjectId();
  try {
    const teacher = await signIn(browser, baseURL!, 'faculty'); contexts.push(teacher.context);
    const student = await signIn(browser, baseURL!, 'student'); contexts.push(student.context);
    const staff = await signIn(browser, baseURL!, 'staff'); contexts.push(staff.context);
    const ta = await signIn(browser, baseURL!, 'ta'); contexts.push(ta.context);
    const now = new Date();
    await coursesCol().insertOne({ _id: courseId, name: 'Supplemental Enrollment · Local Synthetic Test', courseCode: `ENR${String(courseId).slice(-6)}`,
      term: '2026W', ownerPuid: teacher.user.puid, registrationCode: `OLD${String(courseId).slice(-5)}`,
      published: true, lifecycle: 'published', termStart: new Date(now.getTime() - 86400000), termEnd: new Date(now.getTime() + 86400000),
      feedbackStrategy: 'adaptive', autoPause: { minAttempts: 5, flagPercent: 30, flagCount: 3 }, redirectFailureThreshold: 3, reviewBacklogThreshold: 10, createdAt: now });
    await usersCol().updateOne({ puid: teacher.user.puid }, { $addToSet: { courseRoles: { courseId, role: 'instructor' } } });
    const base = `/api/courses/${courseId}`;
    const identity = async (context: BrowserContext): Promise<Identity> => (await (await context.request.get('/api/auth/me')).json()).user;
    const imported = await teacher.context.request.put(`${base}/people-import`, { multipart: {
      expectedRevision: '0', confirmedTeachingAccess: 'false',
      file: { name: 'synthetic-gradebook.csv', mimeType: 'text/csv', buffer: Buffer.from(`Student,SIS Login ID\nSynthetic Gradebook Student,${staff.user.puid}\n`) },
    } });
    expect(imported.status(), await imported.text()).toBe(200);
    expect((await identity(staff.context)).courseRoles.some(role => role.courseId === String(courseId) && role.role === 'student')).toBe(true);
    const requestId = randomUUID();
    const first = await teacher.context.request.post(`${base}/registration-codes`, { data: { count: 3, requestId } });
    expect(first.status(), await first.text()).toBe(201);
    const replay = await teacher.context.request.post(`${base}/registration-codes`, { data: { count: 3, requestId } });
    expect(await replay.json()).toEqual(await first.json());
    let receipt = await (await teacher.context.request.get(`${base}/registration-codes`)).json();
    expect(receipt.codes).toHaveLength(3);
    const codes = receipt.codes as Array<{ id: string; code: string }>;
    // Imported students already have access; an extra code stays unused.
    expect((await staff.context.request.post('/api/enrollments', { data: { code: codes[0].code } })).status()).toBe(409);
    const concurrent = await Promise.all([student.context, ta.context].map(context => context.request.post('/api/enrollments', { data: { code: codes[0].code } })));
    expect(concurrent.map(response => response.status()).sort()).toEqual([201, 409]);
    const loser = concurrent[0].status() === 201 ? ta.context : student.context;
    expect((await loser.request.post('/api/enrollments', { data: { code: codes[1].code } })).status()).toBe(201);
    expect((await staff.context.request.post('/api/enrollments', { data: { code: codes[0].code } })).status()).toBe(409);
    expect((await teacher.context.request.delete(`${base}/registration-codes/${codes[2].id}`)).status()).toBe(204);
    expect((await staff.context.request.post('/api/enrollments', { data: { code: codes[2].code } })).status()).toBe(410);
    expect((await student.context.request.get(`${base}/registration-codes`)).status()).toBe(403);
    expect((await student.context.request.post('/api/enrollments', { data: { code: `OLD${String(courseId).slice(-5)}` } })).status()).toBe(404);
    expect((await teacher.context.request.post(`${base}/registration-code`)).status()).toBe(410);
    receipt = await (await teacher.context.request.get(`${base}/registration-codes`)).json();
    expect(receipt.codes.filter((code: { status: string }) => code.status === 'used')).toHaveLength(2);
    expect(receipt.codes.filter((code: { status: string }) => code.status === 'revoked')).toHaveLength(1);
    for (const row of receipt.codes.filter((row: { status: string }) => row.status === 'used')) {
      expect([student.user.puid, ta.user.puid]).toContain(row.recipient.puid);
      expect(row.recipient.cwl).toBeTruthy(); expect(row.recipient.lastLoginAt).toBeTruthy();
    }
    await teacher.page.goto(`/#/instructor/course/${courseId}/people`);
    await teacher.page.getByRole('button', { name: 'Registration codes', exact: true }).click();
    await expect(teacher.page.locator('.registration-code-status').filter({ hasText: /^Used$/ })).toHaveCount(2);
    await teacher.page.locator('.registration-codes-list').scrollIntoViewIfNeeded();
    await teacher.page.screenshot({ path: 'artifacts/one-time-enrollment-2026-10-06/enrollment-live-receipts.png', fullPage: true });
    // Exercise actual Mongo pagination across a single large batch and older
    // records, then verify soft deletion cannot remove access or reopen a code.
    expect((await teacher.context.request.post(`${base}/registration-codes`, { data: { count: 50, requestId: randomUUID() } })).status()).toBe(201);
    const getPage = async (page: number, status = '') => (await (await teacher.context.request.get(`${base}/registration-codes?page=${page}&pageSize=10${status ? `&status=${status}` : ''}`)).json());
    const pages = await Promise.all([1, 2, 3, 4, 5, 6].map(page => getPage(page)));
    expect(pages[0]).toMatchObject({ total: 53, pageCount: 6, pageSize: 10 });
    expect(pages[5].codes).toHaveLength(3);
    expect(new Set(pages.flatMap(page => page.codes.map((row: { id: string }) => row.id))).size).toBe(53);
    expect(await getPage(1, 'used')).toMatchObject({ total: 2 });
    await teacher.page.getByRole('button', { name: 'Refresh codes', exact: true }).click();
    await teacher.page.getByLabel('Codes per page', { exact: true }).selectOption('10');
    await expect(teacher.page.locator('.registration-code-row')).toHaveCount(10);
    await teacher.page.locator('.registration-codes-panel').scrollIntoViewIfNeeded();
    await teacher.page.screenshot({ path: 'artifacts/one-time-enrollment-2026-10-06/enrollment-dense-live.png', fullPage: true });
    await teacher.page.locator('.registration-codes-panel').screenshot({ path: 'artifacts/one-time-enrollment-2026-10-06/enrollment-dense-panel.png' });
    await teacher.page.getByRole('button', { name: 'Next code page' }).click();
    await expect(teacher.page.getByText('11–20 of 53 · Page 2 of 6', { exact: true })).toBeVisible();
    const unused = pages[0].codes[0];
    expect((await teacher.context.request.delete(`${base}/registration-codes/${unused.id}/record`)).status()).toBe(204);
    expect((await staff.context.request.post('/api/enrollments', { data: { code: unused.code } })).status()).toBe(410);
    const used = receipt.codes.find((row: { status: string }) => row.status === 'used');
    expect((await student.context.request.delete(`${base}/registration-codes/${used.id}/record`)).status()).toBe(403);
    expect((await teacher.context.request.delete(`${base}/registration-codes/${used.id}/record`)).status()).toBe(204);
    expect((await getPage(1, 'used')).total).toBe(1);
    const retainedUser = await usersCol().findOne({ puid: used.recipient.puid });
    expect(retainedUser!.courseRoles.some(role => role.courseId.equals(courseId) && role.role === 'student')).toBe(true);
    expect((await staff.context.request.post('/api/enrollments', { data: { code: used.code } })).status()).toBe(409);
    const invitation = await teacher.context.request.post(`${base}/tas`, { data: { identifier: ta.user.uid } });
    expect(invitation.status(), await invitation.text()).toBe(201);
    const taRecord = await usersCol().findOne({ puid: ta.user.puid });
    expect(await invitation.json()).toMatchObject({ status: 'active', activatedPuid: ta.user.puid, email: taRecord!.email.toLowerCase() });
    expect((await teacher.context.request.post(`${base}/tas`, { data: { identifier: taRecord!.email } })).status()).toBe(409);
    const after = await identity(ta.context);
    expect(after.courseRoles.some(role => role.courseId === String(courseId) && role.role === 'ta')).toBe(true);
    expect(after.isAdmin).toBe(ta.user.isAdmin); expect(after.platformInstructor).toBe(ta.user.platformInstructor);
    const capabilities = await (await ta.context.request.get(`${base}/capabilities/me`)).json();
    expect(capabilities['question.approve']).toBe(false); expect(capabilities['flag.resolve']).toBe(false);
    const coInstructor = await teacher.context.request.post(`${base}/instructor-invitations`, { data: { identifier: staff.user.uid } });
    expect(coInstructor.status(), await coInstructor.text()).toBe(200);
    const enrolled = await student.context.request.get('/api/enrollments');
    expect((await enrolled.json()).some((course: { courseId: string }) => course.courseId === String(courseId))).toBe(true);
    const directory = await teacher.context.request.get(`${base}/students?q=`);
    expect(directory.status()).toBe(200);
    expect((await directory.json()).some((user: { puid: string }) => user.puid === student.user.puid)).toBe(true);
  } finally {
    await registrationCodeBatchesCol().deleteMany({ courseId });
    await coursePeopleImportsCol().deleteMany({ courseId }); await taInvitesCol().deleteMany({ courseId });
    await courseInstructorSharesCol().deleteMany({ courseId }); await capabilitySettingsCol().deleteMany({ courseId });
    await auditCol().deleteMany({ courseId });
    await usersCol().updateMany({ 'courseRoles.courseId': courseId }, { $pull: { courseRoles: { courseId } } });
    await coursesCol().deleteOne({ _id: courseId });
    await Promise.all(contexts.map(context => context.close())); await closeMongo();
  }
});
