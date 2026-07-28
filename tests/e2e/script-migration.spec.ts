import path from 'node:path';
import { expect, test } from '@playwright/test';
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

const AUTH_FILE = path.resolve(__dirname, '.auth/user.json');
const courseName = `Script Migration E2E ${Date.now()}`;
const generateScript =
  'function generate(random) { return { vars: { principal: 1000, rate: 5 } }; }';
let courseId = '';

test.describe('parameterized-script migration', () => {
  test.use({ storageState: AUTH_FILE });

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
    expect(await questionsCol().countDocuments({ courseId: cId })).toBe(0);
    expect(await questionVersionsCol().countDocuments({ questionId: { $in: questionIds } })).toBe(0);
  });

  test('previews in the sandbox and imports exactly one working Draft from the UI', async ({
    page,
  }) => {
    const browserErrors: string[] = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });

    const courseResponse = await page.request.post('/api/courses', {
      data: { name: courseName, courseCode: 'SCRIPT-E2E', term: '2026W' },
    });
    expect(courseResponse.status()).toBe(201);
    courseId = ((await courseResponse.json()) as { _id: string })._id;

    await page.goto(`/#/instructor/course/${courseId}/import`);
    await expect(page.getByRole('heading', { name: 'Import Questions' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Migrate a parameterized script' }),
    ).toBeVisible();

    await page
      .getByLabel('Question stem template')
      .fill('What is the return on {{principal}} at {{rate}}%?');
    await page.getByLabel('Option A').fill('{{principal}} × {{rate}}%');
    await page.getByLabel('Option B').fill('{{principal}} + {{rate}}');
    await page.getByLabel('Option C').fill('{{principal}} ÷ {{rate}}');
    await page.getByLabel('Option D').fill('{{principal}} − {{rate}}');
    await page.getByLabel('Correct option').selectOption('A');
    await page.getByLabel('Generate script').fill(generateScript);

    const importButton = page.getByRole('button', {
      name: 'Import parameterized Draft',
    });
    await expect(importButton).toBeDisabled();
    await page.getByRole('button', { name: 'Run sandbox preview' }).click();

    await expect(page.getByText('Sandbox preview passed')).toBeVisible();
    await expect(page.getByText('principal = 1000, rate = 5')).toBeVisible();
    await expect(
      page.getByText('What is the return on 1000 at 5%?'),
    ).toBeVisible();
    await expect(importButton).toBeEnabled();

    await importButton.click();
    await expect(
      page.getByText('Imported 1 parameterized Draft question.'),
    ).toBeVisible();
    await expect(importButton).toBeDisabled();

    await connectMongo();
    const cId = new ObjectId(courseId);
    const question = await questionsCol().findOne({ courseId: cId });
    expect(question).toMatchObject({ state: 'draft', currentVersion: 1 });
    expect(await questionsCol().countDocuments({ courseId: cId })).toBe(1);
    const version = await questionVersionsCol().findOne({
      _id: question!.currentVersionId,
    });
    expect(version).toMatchObject({
      stem: 'What is the return on {{principal}} at {{rate}}%?',
      generateScript,
      createdBy: expect.any(String),
    });

    await page.getByRole('button', { name: 'Open Draft question' }).click();
    await expect(
      page.getByRole('heading', { name: 'Question', exact: true }),
    ).toBeVisible();
    await expect(browserErrors).toEqual([]);
  });
});
