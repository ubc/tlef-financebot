import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { ObjectId } from 'mongodb';
import { connectMongo } from '../../server/src/components/mongodb';
import {
  coursesCol,
  losCol,
  questionsCol,
  questionVersionsCol,
  themesCol,
  usersCol,
} from '../../server/src/components/mongodb/collections';

async function login(page: Page, username: string): Promise<void> {
  await page.goto('/auth/ubcshib');
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', username);
  await page.getByRole('button', { name: /login|log in|sign in|yes/i }).first().click();
  await page.waitForURL('**/', { timeout: 30_000 });
}

const fixture = path.resolve(__dirname, '../fixtures/import-sample.csv');
const courseName = `Import E2E ${Date.now()}`;
let courseId = '';

test.describe('question import', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.afterAll(async () => {
    if (!courseId) return;
    await connectMongo();
    const cId = new ObjectId(courseId);
    const questionIds = await questionsCol().distinct('_id', { courseId: cId });
    await Promise.all([
      questionVersionsCol().deleteMany({ questionId: { $in: questionIds } }),
      questionsCol().deleteMany({ courseId: cId }),
      losCol().deleteMany({ courseId: cId }),
      themesCol().deleteMany({ courseId: cId }),
      coursesCol().deleteOne({ _id: cId }),
      usersCol().updateOne(
        { uid: 'faculty-user' },
        { $pull: { courseRoles: { courseId: cId } } },
      ),
    ]);
    expect(await coursesCol().countDocuments({ _id: cId })).toBe(0);
    expect(await questionsCol().countDocuments({ courseId: cId })).toBe(0);
    expect(await questionVersionsCol().countDocuments({ questionId: { $in: questionIds } })).toBe(0);
    expect(await usersCol().countDocuments({ courseRoles: { $elemMatch: { courseId: cId } } })).toBe(0);
  });

  test('uploads, previews partial success, and confirms Drafts from the instructor UI', async ({
    page,
  }) => {
    await login(page, 'faculty');
    const courseRes = await page.request.post('/api/courses', {
      data: { name: courseName, courseCode: 'IMPORT-E2E', term: '2026W' },
    });
    expect(courseRes.status()).toBe(201);
    courseId = ((await courseRes.json()) as { _id: string })._id;

    // Course creation grants the role in Mongo; entering the isolated app
    // performs a fresh /auth/me request before the instructor-only route.
    await page.goto(`/#/instructor/course/${courseId}/import`);
    await expect(page.getByRole('heading', { name: 'Import Questions' })).toBeVisible();

    await page.getByLabel('Question file').setInputFiles(fixture);
    await page.getByRole('button', { name: 'Preview import' }).click();

    await expect(page.getByRole('heading', { name: 'Preview · 4 valid' })).toBeVisible();
    await expect(page.getByText('1 row could not be imported')).toBeVisible();
    await expect(page.getByText('Row/item 6: expected-4-options')).toBeVisible();
    await expect(page.getByText('Convertible', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Import 4 Drafts' }).click();
    await expect(page.getByText('Imported 4 Draft questions.')).toBeVisible();

    await connectMongo();
    const cId = new ObjectId(courseId);
    expect(await questionsCol().countDocuments({ courseId: cId, state: 'draft' })).toBe(4);
    expect(
      await questionsCol().countDocuments({
        courseId: cId,
        labels: 'convertible-to-parameterized',
      }),
    ).toBe(1);

    await page.getByRole('button', { name: 'Open Question Bank' }).click();
    await expect(page.getByRole('heading', { name: 'Question Bank' })).toBeVisible();
    await expect(page.getByText('4 questions')).toBeVisible();
  });
});
