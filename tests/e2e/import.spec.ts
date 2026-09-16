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

    await expect(page.getByRole('heading', { name: 'import-sample.csv' })).toBeVisible();
    await expect(page.getByLabel('Question file')).toBeHidden();
    await page.getByText('1 row needs attention', { exact: true }).click();
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

    await page.getByRole('button', { name: 'Open Review Queue' }).click();
    await expect(page.getByRole('heading', { name: 'Review Queue' })).toBeVisible();

  });
});


test.describe('remaining file formats against the real import API', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test('JSON, XML and QTI preview and commit persisted Drafts', async ({ page }) => {
    await login(page, 'faculty');
    const response = await page.request.post('/api/courses', { data: { name: `Format import ${Date.now()}`, courseCode: 'FORMAT-TEST', term: '2026W' } });
    expect(response.status()).toBe(201);
    const id = (await response.json())._id;
    try {
      for (const [filename, fixtureName] of [['questions.json','import-sample.json'], ['questions.xml','import-sample-qti.xml'], ['questions.qti','import-sample-qti.xml']]) {
        const fs = await import('node:fs');
        const preview = await page.request.post(`/api/courses/${id}/import/preview`, { multipart: { file: { name: filename, mimeType: 'application/octet-stream', buffer: fs.readFileSync(path.resolve(__dirname, '../fixtures', fixtureName)) } } });
        expect(preview.status()).toBe(200);
        const data = await preview.json();
        const candidates = data.candidates.filter((c: {type:string}) => c.type !== 'other');
        expect(candidates.length).toBeGreaterThan(0);
        const commit = await page.request.post(`/api/courses/${id}/import/commit`, { data: { candidates, format: data.format, sourceName: filename } });
        expect(commit.ok()).toBe(true);
        expect((await commit.json()).imported).toBe(candidates.length);
      }
      await connectMongo();
      expect(await questionsCol().countDocuments({courseId:new ObjectId(id),state:'draft'})).toBeGreaterThan(0);
      const head = await questionsCol().findOne({courseId:new ObjectId(id),state:'draft'});
      const version = await questionVersionsCol().findOne({_id:head!.currentVersionId});
      const csv = await page.evaluate(async current => { const {bankCsv} = await import('/js/bank-csv.js'); return bankCsv([{current}]); }, JSON.parse(JSON.stringify(version)));
      const exportedPreview = await page.request.post(`/api/courses/${id}/import/preview`, { multipart: { file: {name:'question-bank.csv',mimeType:'text/csv',buffer:Buffer.from(csv)} } });
      expect(exportedPreview.ok()).toBe(true);
      const exported = await exportedPreview.json(); expect(exported.failures).toEqual([]);
      expect(exported.candidates[0].stem).toBe(version!.stem);
      const roundTrip = await page.request.post(`/api/courses/${id}/import/commit`, {data:{candidates:exported.candidates,format:'csv'}});
      expect(roundTrip.ok()).toBe(true); expect((await roundTrip.json()).imported).toBe(1);

    } finally {
      await connectMongo(); const c = new ObjectId(id); const qs = await questionsCol().distinct('_id',{courseId:c});
      await questionVersionsCol().deleteMany({questionId:{$in:qs}}); await questionsCol().deleteMany({courseId:c}); await coursesCol().deleteOne({_id:c});
      await usersCol().updateMany({},{$pull:{courseRoles:{courseId:c}}});
    }
  });
});
