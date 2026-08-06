import { test, expect } from '@playwright/test';
import { ObjectId } from 'mongodb';
import { AUTH_FILE } from './global-setup';
import { connectMongo } from '../../server/src/components/mongodb';
import { coursesCol, rosterCol, usersCol } from '../../server/src/components/mongodb/collections';

// Roster CSV import (2026-08-06). Instructors asked to upload a Workday roster
// instead of copy-pasting, believing the roster took student numbers.
//
// The upload is the smaller half of this. The half worth testing is that a
// student-number file is REJECTED and explained, because a roster entry is only
// ever matched against `user.uid` / `user.email` (enrollment.service.ts:36) and
// a CWL login releases no student number — so the old silent accept produced a
// roster that looked saved and then failed every enrolment.
//
// Jest cannot cover this: it runs testEnvironment 'node' with no jsdom
// (tests/AGENTS.md:66-69), so the parser is unit-tested (roster-import.service
// .test.ts) but the upload widget and its preview only exist in a browser.

test.use({ storageState: AUTH_FILE });

const RUN = Date.now();
const COURSE_NAME = `Roster Import E2E ${RUN}`;
const COURSE_CODE = `ROS-${RUN % 100000}`;

let courseId = '';
let facultyPuid = '';

/** A file for the hidden input inside `uploadZone`. */
function csv(name: string, body: string): { name: string; mimeType: string; buffer: Buffer } {
  return { name, mimeType: 'text/csv', buffer: Buffer.from(body, 'utf8') };
}

test.describe('Roster CSV import', () => {
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: AUTH_FILE });
    try {
      const course = (await (
        await context.request.post('/api/courses', {
          data: { name: COURSE_NAME, courseCode: COURSE_CODE, term: '2026W' },
        })
      ).json()) as { _id: string };
      courseId = course._id;

      await connectMongo();
      facultyPuid = (await coursesCol().findOne({ _id: new ObjectId(courseId) }))?.createdBy ?? '';
    } finally {
      await context.close();
    }
  });

  test.afterAll(async () => {
    if (!courseId) return;
    await connectMongo();
    const cId = new ObjectId(courseId);
    await Promise.all([
      rosterCol().deleteMany({ courseId: cId }),
      coursesCol().deleteOne({ _id: cId }),
      usersCol().updateMany({ puid: facultyPuid }, { $pull: { courseRoles: { courseId: cId } } }),
    ]);
  });

  test('a Workday-shaped export loads the email column and saves the roster', async ({ page }) => {
    await page.goto(`/#/instructor/course/${courseId}/settings`);
    await expect(page.getByRole('heading', { name: 'Course Settings' })).toBeVisible();

    await page.locator('.upload-zone__input').setInputFiles(
      csv(
        'workday-roster.csv',
        [
          'Student Number,Name,Email',
          '12345678,Jane Smith,rosterjane@student.ubc.ca',
          '87654321,Bo Jones,rosterbo@student.ubc.ca',
        ].join('\n'),
      ),
    );

    // The column it chose is stated, not silent — picking 'Student Number'
    // here would save a roster that matches nobody.
    await expect(page.locator('.roster-import__summary')).toContainText('2 of 2 rows ready');
    await expect(page.locator('.roster-import__summary')).toContainText('Email');
    await expect(page.locator('.roster-textarea')).toHaveValue(
      'rosterjane@student.ubc.ca\nrosterbo@student.ubc.ca',
    );
    await expect(page.locator('.roster-rejects')).toHaveCount(0);

    await page.getByRole('button', { name: 'Save Roster' }).click();
    await expect(page.locator('.roster-list__rows')).toContainText('rosterjane@student.ubc.ca');
    await expect(page.locator('.roster-list__rows')).toContainText('rosterbo@student.ubc.ca');
  });

  test('a student-number-only file saves nobody and explains why', async ({ page }) => {
    await page.goto(`/#/instructor/course/${courseId}/settings`);
    await expect(page.getByRole('heading', { name: 'Course Settings' })).toBeVisible();

    await page.locator('.upload-zone__input').setInputFiles(
      csv('student-numbers.csv', ['Student Number', '12345678', '87654321', '11223344'].join('\n')),
    );

    await expect(page.locator('.roster-import__summary')).toContainText('0 of 3 rows ready');
    // The constraint has to be named. "Invalid" would leave the instructor with
    // no idea that a CWL/email column is what they need to re-export.
    await expect(page.locator('.roster-rejects__explanation')).toContainText('never their student number');
    await expect(page.locator('.roster-rejects__row').first()).toContainText('Looks like a student number');
    await expect(page.locator('.roster-textarea')).toHaveValue('');
    // A diagnosis-only preview must not turn into an accidental destructive
    // replace: with zero usable rows the existing roster remains untouched.
    await expect(page.getByRole('button', { name: 'Save Roster' })).toBeDisabled();
    await expect(page.locator('.roster-list__row')).toHaveCount(2);
  });

  test('the identifier column can be overridden when detection guesses wrong', async ({ page }) => {
    await page.goto(`/#/instructor/course/${courseId}/settings`);
    await expect(page.getByRole('heading', { name: 'Course Settings' })).toBeVisible();

    await page.locator('.upload-zone__input').setInputFiles(
      csv('two-columns.csv', ['Student Number,CWL', '12345678,rosterjsmith', '87654321,rosterbjones'].join('\n')),
    );
    await expect(page.locator('.roster-import__summary')).toContainText('CWL');

    // Force the wrong column: the preview must turn red rather than accept it.
    await page.selectOption('#settings-roster-column', 'Student Number');
    await expect(page.locator('.roster-import__summary')).toContainText('0 of 2 rows ready');
    await expect(page.locator('.roster-rejects__explanation')).toBeVisible();

    await page.selectOption('#settings-roster-column', 'CWL');
    await expect(page.locator('.roster-textarea')).toHaveValue('rosterjsmith\nrosterbjones');
  });

  test('pasted student numbers are dropped on save and reported, not stored silently', async ({ page }) => {
    await page.goto(`/#/instructor/course/${courseId}/settings`);
    await expect(page.getByRole('heading', { name: 'Course Settings' })).toBeVisible();

    // The path that existed before this change: type into the textarea and save.
    await page.locator('.roster-textarea').fill('rosterkeep@ubc.ca\n12345678\n87654321');
    await page.getByRole('button', { name: 'Save Roster' }).click();

    await expect(page.locator('.roster-import__summary--warn')).toContainText('Saved 1 student.');
    await expect(page.locator('.roster-import__summary--warn')).toContainText('2 entries were skipped');
    await expect(page.locator('.roster-rejects__row').first()).toContainText('12345678');

    // And the roster genuinely holds only the usable one.
    await expect(page.locator('.roster-list__row')).toHaveCount(1);
    await expect(page.locator('.roster-list__rows')).toContainText('rosterkeep@ubc.ca');
  });
});
