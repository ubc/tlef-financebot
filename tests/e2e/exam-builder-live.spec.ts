/** Opt-in live-provider exercise. Uses only synthetic course text and removes
 * the temporary course, exam, runs, vectors and role through the course API. */
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { test, expect, type BrowserContext } from '@playwright/test';
import { ObjectId } from 'mongodb';
import { AUTH_FILE, RELEASED } from './global-setup';
import { connectMongo } from '../../server/src/components/mongodb';
import { materialChunksCol, materialsCol, questionsCol } from '../../server/src/components/mongodb/collections';
import { embedOne } from '../../server/src/components/genai/embeddings';
import { deleteCollectionIfExists, ensureCollection, upsertPoints } from '../../server/src/components/qdrant';
import { courseCollection } from '../../server/src/services/materials.service';

const enabled = process.env.EXAM_BUILDER_LIVE_E2E === 'true';
const evidence = 'Newton’s first law: an object continues at constant velocity when the net force on it is zero. Constant velocity means zero acceleration, whether the object is moving or at rest. Balanced forces may act on an object while their vector sum is zero. A force is needed to change velocity, not to sustain constant velocity.';

test.describe('Exam Builder live question generation', () => {
  test.skip(!enabled, 'Set EXAM_BUILDER_LIVE_E2E=true to call the configured LLM and Qdrant.');
  test.use({ storageState: AUTH_FILE });

  test('generates and publishes a paper, then a real student sits and reviews it', async ({ page, browser }) => {
    test.setTimeout(420_000);
    const api = page.context().request;
    let courseId = '';
    const courseCode = `EBLIVE${Date.now()}`;
    let collection = '';
    let runId = '';
    let studentContext: BrowserContext | undefined;
    const screenshotsDir = path.join(process.cwd(), 'audit-results/exam-builder/student-flow');
    await mkdir(screenshotsDir, { recursive: true });
    const started = Date.now();
    const checked = async (response: Awaited<ReturnType<typeof api.get>>, label: string) => {
      const body = await response.json();
      expect(response.ok(), `${label}: ${JSON.stringify(body)}`).toBeTruthy();
      return body;
    };
    try {
      const me = await checked(await api.get('/api/auth/me'), 'auth');
      expect(me.authenticated).toBe(true);
      const course = await checked(await api.post('/api/courses', {
        data: { name: `Exam Builder Live E2E ${Date.now()}`, courseCode, term: '2026W' },
      }), 'create course');
      courseId = course._id;
      const courseObjectId = new ObjectId(courseId);
      collection = courseCollection(courseObjectId);
      const theme = await checked(await api.post(`/api/courses/${courseId}/themes`, {
        data: { name: 'Newtonian motion', availableFrom: RELEASED },
      }), 'create theme');
      const lo = await checked(await api.post(`/api/themes/${theme._id}/los`, {
        data: { name: 'Explain Newton’s first law and constant velocity' },
      }), 'create learning objective');

      // Seed the smallest possible synthetic source through the same Mongo and
      // Qdrant contracts that material ingestion supplies to the generator.
      await connectMongo();
      const materialId = new ObjectId();
      await materialsCol().insertOne({ _id: materialId, courseId: courseObjectId,
        name: 'Synthetic first-law teaching note', format: 'txt', status: 'ready',
        assignments: [{ themeId: new ObjectId(theme._id), loId: new ObjectId(lo._id) }],
        uploadedAt: new Date(), excerpt: evidence });
      await materialChunksCol().insertOne({ courseId: courseObjectId, materialId, index: 0,
        text: evidence, characterCount: evidence.length, createdAt: new Date() });
      const vector = await embedOne(evidence);
      await ensureCollection(collection, vector.length);
      await upsertPoints(collection, [{ id: randomUUID(), vector,
        payload: { materialId: materialId.toHexString(), chunk: evidence } }]);

      const exam = await checked(await api.post(`/api/courses/${courseId}/exam-builder`, {
        data: { title: 'Synthetic first-law midterm' },
      }), 'create exam');
      const base = `/api/courses/${courseId}/exam-builder/${exam._id}`;
      await page.goto(`/#/instructor/course/${courseId}/exam-builder/${exam._id}`);
      await expect(page.getByRole('heading', { level: 1, name: 'Synthetic first-law midterm' })).toBeVisible();
      await page.evaluate((url) => {
        const state = window as typeof window & { liveExamSnapshots?: unknown[]; liveExamSource?: EventSource };
        state.liveExamSnapshots = [];
        state.liveExamSource = new EventSource(url);
        state.liveExamSource.addEventListener('snapshot', (event) => {
          state.liveExamSnapshots?.push(JSON.parse((event as MessageEvent).data));
        });
      }, `${base}/events`);
      await page.waitForFunction(() => ((window as typeof window & { liveExamSnapshots?: unknown[] }).liveExamSnapshots?.length ?? 0) > 0);

      const plan = await checked(await api.post(`${base}/plans`, { data: {
        revision: 0, requestId: randomUUID(), loIds: [lo._id], types: ['true-false'],
        count: 1, difficulty: 'easy',
        prompt: 'Create a qualitative question testing the misconception that a moving object needs a continuing net force.',
      } }), 'plan generation');
      runId = plan._id;
      expect(plan.status).toBe('planned');
      expect(plan.conflicts).toEqual([]);
      await checked(await api.post(`${base}/runs/${runId}/confirm`, { data: { revision: 0 } }), 'confirm generation');
      await page.waitForFunction((id) => {
        const snapshots = (window as typeof window & { liveExamSnapshots?: Array<{ runs: Array<{ _id: string; status: string }> }> }).liveExamSnapshots ?? [];
        return snapshots.some(snapshot => snapshot.runs.some(run => run._id === id && ['completed', 'partial', 'failed'].includes(run.status)));
      }, runId, { timeout: 360_000 });
      const snapshots = await page.evaluate(() => {
        const state = window as typeof window & { liveExamSnapshots?: Array<{ runs: Array<{ _id: string; status: string; progress?: { stage: string; preview?: { stem?: string } } }> }>; liveExamSource?: EventSource };
        state.liveExamSource?.close();
        return state.liveExamSnapshots ?? [];
      });
      const stages = [...new Set(snapshots.flatMap(snapshot => snapshot.runs.filter(run => run._id === runId).map(run => run.progress?.stage).filter(Boolean)))];
      expect(snapshots.length).toBeGreaterThan(1);
      expect(stages).toContain('generating');
      const detail = await checked(await api.get(base), 'read generated candidates');
      const run = detail.runs.find((entry: { _id: string }) => entry._id === runId);
      expect(run?.status, `generation failures: ${JSON.stringify(run?.failures ?? [])}`).toBe('completed');
      expect(detail.candidates).toHaveLength(1);
      const candidate = detail.candidates[0];
      expect(candidate.item.source).toBe('generated');
      expect(candidate.item.validated).toBe(true);
      expect(candidate.item.type).toBe('true-false');
      expect(candidate.item.loIds).toEqual([lo._id]);
      expect(candidate.item.sourceRefs.some((ref: { materialId: string }) => ref.materialId === materialId.toHexString())).toBe(true);
      expect(await questionsCol().countDocuments({ courseId: courseObjectId })).toBe(0);

      const added = await checked(await api.post(`${base}/candidate-items`, {
        data: { revision: detail.exam.revision, candidateId: candidate._id },
      }), 'add candidate to paper');
      const approved = await checked(await api.post(`${base}/approve`, {
        data: { revision: added.revision, itemId: candidate.item.id },
      }), 'approve paper item');
      const now = Date.now();
      const closesAt = now + 45_000;
      const saved = await checked(await api.put(`${base}/settings`, { data: { revision: approved.revision,
        settings: { ...approved.settings, opensAt: new Date(now - 60_000).toISOString(), closesAt: new Date(closesAt).toISOString() },
      } }), 'save exam schedule');
      const published = await checked(await api.post(`${base}/publish`, { data: { revision: saved.revision } }), 'publish exam');
      expect(published.publicationId).toBeTruthy();
      await checked(await api.put(`/api/courses/${courseId}/roster`, {
        data: { identifiers: ['student-user'] },
      }), 'add test student to roster');
      await checked(await api.post(`/api/courses/${courseId}/publish`), 'publish course');

      studentContext = await browser.newContext({
        baseURL: new URL(page.url()).origin,
        storageState: { cookies: [], origins: [] },
        viewport: { width: 1440, height: 900 },
        reducedMotion: 'reduce',
      });
      const studentPage = await studentContext.newPage();
      await studentPage.goto('/auth/ubcshib');
      await studentPage.fill('input[name="username"]', 'student');
      await studentPage.fill('input[name="password"]', 'student');
      await studentPage.getByRole('button', { name: /login|log in|sign in|yes/i }).first().click();
      await studentPage.waitForURL('**/', { timeout: 30_000 });
      await studentPage.goto('/#/');
      await studentPage.getByPlaceholder('Registration code').fill(course.registrationCode);
      await studentPage.getByRole('button', { name: /join/i }).click();
      await expect(studentPage.getByText(course.name)).toBeVisible();

      await studentPage.goto(`/#/course/${courseId}/assessments`);
      await expect(studentPage.getByRole('heading', { level: 1, name: 'Assessments' })).toBeVisible();
      await expect(studentPage.getByRole('heading', { level: 2, name: 'Synthetic first-law midterm' })).toBeVisible();
      await studentPage.screenshot({ path: path.join(screenshotsDir, '01-assessments.png'), fullPage: true });
      studentPage.once('dialog', dialog => void dialog.accept());
      await studentPage.getByRole('button', { name: 'Start exam' }).click();
      await expect(studentPage.getByRole('heading', { level: 1, name: 'Synthetic first-law midterm' })).toBeVisible();
      await expect(studentPage.getByRole('timer')).toBeVisible();
      await studentPage.screenshot({ path: path.join(screenshotsDir, '02-question-unanswered.png'), fullPage: true });
      const attemptId = studentPage.url().match(/\/assessment\/([0-9a-f]{24})/)?.[1];
      expect(attemptId).toBeTruthy();
      const privateState = await checked(await studentPage.request.get(`/api/courses/${courseId}/assessment-attempts/${attemptId}`), 'student attempt state');
      expect(JSON.stringify(privateState)).not.toMatch(/"(?:role|explanation|sourceRefs|score)"/);

      const correctKey = candidate.item.options.find((option: { role: string }) => option.role === 'correct')?.key;
      expect(correctKey).toBeTruthy();
      await studentPage.getByRole('radio', { name: `Option ${correctKey}` }).check();
      await expect(studentPage.getByText('Answer saved.', { exact: true })).toBeVisible();
      await studentPage.screenshot({ path: path.join(screenshotsDir, '03-answer-saved.png'), fullPage: true });
      await studentPage.reload();
      await expect(studentPage.getByRole('radio', { name: `Option ${correctKey}` })).toBeChecked();
      await studentPage.screenshot({ path: path.join(screenshotsDir, '04-resumed-attempt.png'), fullPage: true });

      studentPage.once('dialog', dialog => void dialog.accept());
      await studentPage.getByRole('button', { name: 'Submit exam' }).click();
      await expect(studentPage.getByText('Your Instructor will release the results.')).toBeVisible();
      await studentPage.screenshot({ path: path.join(screenshotsDir, '05-submitted-awaiting-release.png'), fullPage: true });
      await expect.poll(() => Date.now(), { timeout: 75_000 }).toBeGreaterThan(closesAt);
      await checked(await api.post(`${base}/release-results`), 'release formal exam results');
      await studentPage.reload();
      await expect(studentPage.getByRole('heading', { level: 2, name: '1 / 1 points' })).toBeVisible();
      await expect(studentPage.locator('.eb-option.correct')).toHaveCount(1);
      await studentPage.screenshot({ path: path.join(screenshotsDir, '06-released-results.png'), fullPage: true });
      console.log(JSON.stringify({ result: 'passed', seconds: Math.round((Date.now() - started) / 1000),
        sseSnapshots: snapshots.length, stages, runStatus: run.status,
        candidateId: candidate._id, stem: candidate.item.stem, published: true,
        studentAttempt: 'submitted', studentScore: '1 / 1', screenshotsDir }));
    } finally {
      await studentContext?.close();
      await page.evaluate(() => (window as typeof window & { liveExamSource?: EventSource }).liveExamSource?.close()).catch(() => undefined);
      if (courseId) {
        if (runId) {
          const state = await api.get(`/api/courses/${courseId}/exam-builder`).catch(() => undefined);
          if (state?.ok()) {
            const exams = await state.json() as Array<{ _id: string; activeRunIds?: string[] }>;
            for (const exam of exams) if (exam.activeRunIds?.includes(runId)) {
              await api.post(`/api/courses/${courseId}/exam-builder/${exam._id}/runs/${runId}/cancel`).catch(() => undefined);
            }
          }
        }
        let removed: Awaited<ReturnType<typeof api.delete>> | undefined;
        for (let attempt = 0; attempt < 10; attempt += 1) {
          removed = await api.delete(`/api/courses/${courseId}`, { data: { confirmation: `DELETE ${courseCode}` } }).catch(() => undefined);
          if (removed?.ok()) break;
          await page.waitForTimeout(1000);
        }
        if (collection) {
          const lingeringCollection = await deleteCollectionIfExists(collection);
          expect(lingeringCollection, 'Course deletion should remove its Qdrant collection').toBe(false);
        }
        expect(removed?.ok(), `Temporary course ${courseId} was not deleted: ${removed?.status() ?? 'request failed'}`).toBe(true);
      }
    }
  });
});
