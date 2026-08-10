import { expect, test, type Route } from '@playwright/test';
import { ObjectId } from 'mongodb';
import path from 'node:path';
import { AUTH_FILE } from './global-setup';
import { connectMongo } from '../../server/src/components/mongodb';
import {
  contentRunsCol,
  coursesCol,
  losCol,
  materialChunksCol,
  materialsCol,
  themesCol,
  usersCol,
} from '../../server/src/components/mongodb/collections';

/**
 * Guided Course Preparation's materials-first journey uses the real app,
 * authenticated course guards and hierarchy application. Only the expensive
 * asynchronous boundaries are deterministic browser fixtures:
 *
 * - upload/retry never enqueue an ingest job;
 * - EventSource emits persisted-looking progress, failure, reconnect, retry,
 *   and completion events;
 * - hierarchy suggestion never calls an LLM.
 *
 * This keeps the test safe to run against a developer environment while still
 * exercising the accessible UI that consumes those contracts.
 */

const FIXTURE_PATH = path.join(__dirname, '../fixtures/sample-material.md');
const MATERIAL_NAME = 'sample-material.md';
const PROPOSED_TOPIC = 'AI-proposed capital budgeting';
const EDITED_TOPIC = 'Capital budgeting decisions';
const PROPOSED_LO = 'Compare projects using discounted cash flow';
const EDITED_LO = 'Evaluate projects using discounted cash flow';

const courseObjectId = new ObjectId();
const courseId = courseObjectId.toHexString();
let facultyPuid = '';
let materialId: ObjectId | undefined;
let uploadRunId: ObjectId | undefined;
let retryRunId: ObjectId | undefined;

function json(value: unknown): string {
  return JSON.stringify(value);
}

function sseBody(events: Array<{ event: 'snapshot' | 'run'; data: unknown }>, retryMs = 100): string {
  return [
    `retry: ${retryMs}\n`,
    ...events.map(({ event, data }) => `event: ${event}\ndata: ${json(data)}\n`),
    '',
  ].join('\n');
}

function materialRun(input: {
  id: ObjectId;
  status: 'running' | 'completed' | 'failed';
  stage: 'parsing' | 'classifying';
  revision: number;
  error?: { code: string; message: string; atStage: string; retryable: boolean };
}): Record<string, unknown> {
  if (!materialId) throw new Error('Material run requested before upload fixture exists.');
  const now = new Date().toISOString();
  return {
    _id: input.id.toHexString(),
    courseId,
    kind: 'material-ingest',
    requestedBy: facultyPuid,
    status: input.status,
    stage: input.stage,
    completedUnits: input.status === 'completed' ? 1 : 0,
    totalUnits: 1,
    revision: input.revision,
    warnings: [],
    ...(input.error ? { error: input.error } : {}),
    ...(input.status === 'completed'
      ? {
          result: {
            characterCount: 720,
            chunkCount: 2,
            vectorCount: 2,
            indexedCount: 2,
            classification: 'suggested',
          },
          completedAt: now,
        }
      : {}),
    input: {
      materialId: materialId.toHexString(),
      sourceName: MATERIAL_NAME,
      sourceFormat: 'md',
      trigger: input.id.equals(retryRunId) ? 'retry' : 'upload',
      ...(input.id.equals(retryRunId) && uploadRunId
        ? { previousRunId: uploadRunId.toHexString() }
        : {}),
    },
    createdAt: now,
    updatedAt: now,
  };
}

async function fulfillJson(route: Route, status: number, value: unknown): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: json(value),
  });
}

test.describe('course setup guide — materials first', () => {
  test.use({ storageState: AUTH_FILE });
  test.setTimeout(45_000);

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: AUTH_FILE });
    const me = await context.request.get('/api/auth/me');
    const auth = (await me.json()) as { user?: { puid: string } };
    if (!auth.user) throw new Error('Guided materials E2E requires the authenticated faculty fixture.');
    facultyPuid = auth.user.puid;
    await context.close();

    await connectMongo();
    const now = new Date();
    await coursesCol().insertOne({
      _id: courseObjectId,
      name: 'Guided Materials-first E2E Course',
      courseCode: `GUIDE-${courseId.slice(-6).toUpperCase()}`,
      section: '201',
      term: 'Winter Term 1, 2026/27',
      ownerPuid: facultyPuid,
      registrationCode: `GM${courseId.slice(-6).toUpperCase()}`,
      termStart: new Date('2026-09-08T00:00:00.000Z'),
      termEnd: new Date('2026-12-07T23:59:59.999Z'),
      published: false,
      lifecycle: 'draft',
      feedbackStrategy: 'adaptive',
      autoPause: { minAttempts: 5, flagPercent: 30, flagCount: 15 },
      redirectFailureThreshold: 3,
      reviewBacklogThreshold: 10,
      createdAt: now,
      updatedAt: now,
    });
    await usersCol().updateOne(
      { puid: facultyPuid },
      { $addToSet: { courseRoles: { courseId: courseObjectId, role: 'instructor' } } },
    );
  });

  test.afterAll(async () => {
    await connectMongo();
    await Promise.all([
      contentRunsCol().deleteMany({ courseId: courseObjectId }),
      materialChunksCol().deleteMany({ courseId: courseObjectId }),
      materialsCol().deleteMany({ courseId: courseObjectId }),
      losCol().deleteMany({ courseId: courseObjectId }),
      themesCol().deleteMany({ courseId: courseObjectId }),
      coursesCol().deleteOne({ _id: courseObjectId }),
      usersCol().updateOne(
        { puid: facultyPuid },
        { $pull: { courseRoles: { courseId: courseObjectId } } },
      ),
    ]);
  });

  test('recovers source processing and applies a reviewed, editable AI outline', async ({ page }) => {
    let uploadCalls = 0;
    let retryCalls = 0;
    let hierarchyCalls = 0;
    let sseConnections = 0;
    let allowUploadFailure = false;
    let uploadFailureSent = false;
    let retryRequested = false;
    let retryCompletionSent = false;

    await page.route(`**/api/courses/${courseId}/materials`, async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      uploadCalls += 1;
      await expect(route.request().headerValue('content-type')).resolves.toContain('multipart/form-data');
      materialId = new ObjectId();
      uploadRunId = new ObjectId();
      const uploadedAt = new Date();
      await materialsCol().insertOne({
        _id: materialId,
        courseId: courseObjectId,
        name: MATERIAL_NAME,
        format: 'md',
        kind: 'lecture',
        status: 'processing',
        activeRunId: uploadRunId,
        assignments: [],
        uploadedAt,
      });
      await fulfillJson(route, 201, [{
        _id: materialId.toHexString(),
        courseId,
        name: MATERIAL_NAME,
        format: 'md',
        kind: 'lecture',
        status: 'processing',
        activeRunId: uploadRunId.toHexString(),
        assignments: [],
        uploadedAt: uploadedAt.toISOString(),
      }]);
    });

    await page.route(/\/api\/materials\/[0-9a-f]{24}\/retry$/, async (route) => {
      if (!materialId || route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      retryCalls += 1;
      retryRequested = true;
      retryRunId = new ObjectId();
      const updatedAt = new Date();
      await materialsCol().updateOne(
        { _id: materialId, courseId: courseObjectId },
        {
          $set: { status: 'processing', activeRunId: retryRunId, uploadedAt: updatedAt },
          $unset: { error: '' },
        },
      );
      await fulfillJson(route, 200, {
        _id: materialId.toHexString(),
        courseId,
        name: MATERIAL_NAME,
        format: 'md',
        kind: 'lecture',
        status: 'processing',
        activeRunId: retryRunId.toHexString(),
        assignments: [],
        uploadedAt: updatedAt.toISOString(),
      });
    });

    await page.route(`**/api/courses/${courseId}/content-runs/events`, async (route) => {
      sseConnections += 1;
      const headers = {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      };
      if (!materialId || !uploadRunId) {
        await route.fulfill({ status: 200, headers, body: sseBody([{ event: 'snapshot', data: { runs: [] } }]) });
        return;
      }

      const uploadRunning = materialRun({
        id: uploadRunId,
        status: 'running',
        stage: 'parsing',
        revision: 1,
      });
      if (!allowUploadFailure) {
        await route.fulfill({
          status: 200,
          headers,
          body: sseBody([{ event: 'snapshot', data: { runs: [uploadRunning] } }]),
        });
        return;
      }

      if (!uploadFailureSent) {
        uploadFailureSent = true;
        const error = {
          code: 'fixture-parse-failure',
          message: 'Temporary fixture parse failure.',
          atStage: 'parsing',
          retryable: true,
        };
        await materialsCol().updateOne(
          { _id: materialId, courseId: courseObjectId },
          { $set: { status: 'failed', error: error.message } },
        );
        await route.fulfill({
          status: 200,
          headers,
          body: sseBody([
            { event: 'snapshot', data: { runs: [uploadRunning] } },
            {
              event: 'run',
              data: materialRun({
                id: uploadRunId,
                status: 'failed',
                stage: 'parsing',
                revision: 2,
                error,
              }),
            },
          ]),
        });
        return;
      }

      if (!retryRequested || !retryRunId) {
        await route.fulfill({
          status: 200,
          headers,
          body: sseBody([{
            event: 'snapshot',
            data: {
              runs: [materialRun({
                id: uploadRunId,
                status: 'failed',
                stage: 'parsing',
                revision: 2,
                error: {
                  code: 'fixture-parse-failure',
                  message: 'Temporary fixture parse failure.',
                  atStage: 'parsing',
                  retryable: true,
                },
              })],
            },
          }], 250),
        });
        return;
      }

      const retryRunning = materialRun({
        id: retryRunId,
        status: 'running',
        stage: 'parsing',
        revision: 1,
      });
      const retryCompleted = materialRun({
        id: retryRunId,
        status: 'completed',
        stage: 'classifying',
        revision: 2,
      });
      if (!retryCompletionSent) {
        retryCompletionSent = true;
        await materialsCol().updateOne(
          { _id: materialId, courseId: courseObjectId },
          { $set: { status: 'ready' }, $unset: { error: '' } },
        );
      }
      await route.fulfill({
        status: 200,
        headers,
        body: sseBody([
          { event: 'snapshot', data: { runs: [retryRunning] } },
          { event: 'run', data: retryCompleted },
        ], 500),
      });
    });

    await page.route(`**/api/courses/${courseId}/suggest-hierarchy`, async (route) => {
      hierarchyCalls += 1;
      if (!materialId) throw new Error('Hierarchy requested before material fixture exists.');
      await fulfillJson(route, 200, {
        themes: [
          { name: PROPOSED_TOPIC, los: [PROPOSED_LO, 'Estimate a project payback period'] },
          { name: 'Exclude this suggested Topic', los: ['This LO must not be applied'] },
        ],
        assignments: [
          { themeIndex: 0, loIndex: 0, materialIds: [materialId.toHexString()] },
          { themeIndex: 0, loIndex: 1, materialIds: [materialId.toHexString()] },
          { themeIndex: 1, loIndex: 0, materialIds: [materialId.toHexString()] },
        ],
      });
    });

    await test.step('choose the materials-first path without triggering AI', async () => {
      await page.goto(`/#/instructor/course/${courseId}`);
      await expect(page.getByRole('heading', { name: 'Guided Materials-first E2E Course' })).toBeVisible();
      await page.getByRole('button', { name: /Start building course knowledge/ }).click();
      const guide = page.getByRole('dialog', { name: 'Prepare this course, one step at a time' });
      await expect(guide.getByRole('heading', { name: 'How do you want to define the course?' })).toBeVisible();
      await guide.getByRole('button', { name: /Create them from my course materials/ }).click();
      await expect(guide.getByRole('heading', { name: 'Add the sources the course should trust' })).toBeVisible();
      expect(hierarchyCalls).toBe(0);
    });

    const guide = page.getByRole('dialog', { name: 'Prepare this course, one step at a time' });
    await test.step('show durable SSE reconnect, failure, retry, and terminal completion', async () => {
      await expect.poll(() => sseConnections).toBeGreaterThan(0);
      await expect(guide.locator('.course-setup-guide__live')).toContainText('Live progress is reconnecting');

      await guide.locator('.upload-zone__input').setInputFiles(FIXTURE_PATH);
      const materialCard = guide.locator('.course-setup-guide__source', { hasText: MATERIAL_NAME });
      await expect(materialCard).toBeVisible();
      await expect(materialCard).toContainText(/processing|Parsing|Queued/);
      expect(uploadCalls).toBe(1);

      allowUploadFailure = true;
      await expect(materialCard).toContainText('Temporary fixture parse failure.');
      await expect(materialCard.getByRole('button', { name: 'Retry' })).toBeVisible();
      await materialCard.getByRole('button', { name: 'Retry' }).click();

      await expect(materialCard).toContainText('Ready for course setup');
      await expect(materialCard).toContainText('ready');
      await expect(guide.getByRole('button', { name: 'Create a draft structure' })).toBeEnabled();
      expect(retryCalls).toBe(1);
      expect(retryCompletionSent).toBe(true);
      expect(sseConnections).toBeGreaterThan(1);
    });

    await test.step('review, select, edit, and apply the AI-proposed hierarchy', async () => {
      await guide.getByRole('button', { name: 'Create a draft structure' }).click();
      await expect(guide.getByRole('heading', { name: 'Build and confirm the course structure' })).toBeVisible();
      await expect(guide.getByText(/AI action and may incur model cost/)).toBeVisible();
      await guide.getByRole('button', { name: 'Generate an AI draft' }).click();
      expect(hierarchyCalls).toBe(1);

      await expect(guide.getByLabel('Suggested Topic 1 name')).toHaveValue(PROPOSED_TOPIC);
      await guide.getByLabel('Suggested Topic 1 name').fill(EDITED_TOPIC);
      await guide.getByLabel('Suggested Topic 1 Learning Objective 1 name').fill(EDITED_LO);
      await guide.getByLabel('Include suggested Topic 1 Learning Objective 2').uncheck();
      await guide.getByLabel('Include suggested Topic 2', { exact: true }).uncheck();
      await guide.getByRole('button', { name: 'Apply selected structure' }).click();

      await expect(guide.getByRole('heading', { name: 'Generate a small starter set of questions' })).toBeVisible();
      const themes = await themesCol().find({ courseId: courseObjectId }).toArray();
      const los = await losCol().find({ courseId: courseObjectId }).toArray();
      const material = materialId ? await materialsCol().findOne({ _id: materialId }) : null;
      expect(themes.map((theme) => theme.name)).toEqual([EDITED_TOPIC]);
      expect(los.map((lo) => lo.name)).toEqual([EDITED_LO]);
      expect(material?.assignments).toEqual([{ themeId: themes[0]._id, loId: los[0]._id }]);
      await guide.getByRole('button', { name: 'Close course setup guide' }).click();
    });

    expect({ uploadCalls, retryCalls, hierarchyCalls }).toEqual({
      uploadCalls: 1,
      retryCalls: 1,
      hierarchyCalls: 1,
    });
  });
});
