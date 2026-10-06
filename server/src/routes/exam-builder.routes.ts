import { notifyExamChanged, subscribeExamChanges } from '../services/exam-events.service';
import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { ensureCourseInstructor, ensureCourseStudent } from '../components/auth/course-guards';
import { validate } from '../middleware/validate';
import * as builder from '../services/exam-builder.service';
import * as generation from '../services/exam-generation.service';
import * as attempts from '../services/assessment-attempts.service';

export const examBuilderRouter = Router();
const oid = z.string().regex(/^[0-9a-f]{24}$/);
const course = z.object({ courseId: oid });
const exam = course.extend({ examId: oid });
const run = exam.extend({ runId: oid });
const attempt = course.extend({ attemptId: oid });
const revision = z.object({ revision: z.number().int().min(0) });
const settings = z.object({ title: z.string().trim().min(1).max(150), kind: z.enum(['midterm', 'final']), purpose: z.enum(['formal', 'practice']), durationMinutes: z.number().int().min(1).max(1440), opensAt: z.union([z.literal(''), z.string().datetime()]), closesAt: z.union([z.literal(''), z.string().datetime()]), timeZone: z.string().min(1).max(80), feedback: z.enum(['instructor', 'after-close', 'immediate']), shuffle: z.boolean(), accommodations: z.array(z.object({ puid: z.string().trim().min(1).max(128), extraMinutes: z.number().int().min(0).max(1440) })).max(1000) });
const plan = revision.extend({ requestId: z.string().uuid(), loIds: z.array(oid).max(20), types: z.array(z.enum(['mcq', 'true-false'])).max(2), count: z.number().int().min(1).max(20), difficulty: z.enum(['easy', 'medium', 'hard']), prompt: z.string().trim().max(2000), parent: z.object({ questionId: oid, versionId: oid, mode: z.enum(['parameters', 'context']) }).optional() });
const id = (value: unknown) => new ObjectId(String(value));
const base = '/courses/:courseId/exam-builder';
const detail = `${base}/:examId`;

// Notify connected co-authors after successful mutations, including cancellation.
examBuilderRouter.use(`${detail}`, (req, res, next) => {
  if (req.method !== 'GET' && /^[0-9a-f]{24}$/.test(String(req.params.courseId)) && /^[0-9a-f]{24}$/.test(String(req.params.examId))) {
    const courseId = id(req.params.courseId), examId = id(req.params.examId);
    res.once('finish', () => { if (res.statusCode < 400) notifyExamChanged(courseId, examId); });
  }
  next();
});

// Subscribe before reading: changes during the initial snapshot trigger a second
// serialized read. Reconnects replay terminal history and saved candidates too.
examBuilderRouter.get(`${detail}/events`, validate({ params: exam }), ensureCourseInstructor(), async (req, res, next) => {
  const courseId = id(req.params.courseId), examId = id(req.params.examId);
  let closed = false, dirty = false, reading = false, ready = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const cleanup = () => { closed = true; unsubscribe(); if (heartbeat) clearInterval(heartbeat); };
  const refresh = async () => {
    dirty = true; if (reading || closed) return; reading = true;
    try {
      while (dirty && !closed) {
        dirty = false;
        const snapshot = await builder.builderDetail(courseId, examId);
        if (closed) break;
        if (!ready) {
          res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
          res.flushHeaders(); ready = true;
          res.write('retry: 2000\n\n');
        }
        if (!res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`)) {
          await new Promise<void>(resolve => {
            const done = () => { res.off('drain', done); res.off('close', done); resolve(); };
            res.once('drain', done); res.once('close', done);
          });
        }
      }
    } catch (error) {
      cleanup();
      if (ready) {
        if ((error as { status?: number }).status === 404) res.write('event: unavailable\ndata: {}\n\n');
        res.end(); // Native EventSource retries transient failures.
      } else next(error);
    } finally { reading = false; }
  };
  const unsubscribe = subscribeExamChanges(courseId, examId, () => { void refresh(); });
  res.once('close', cleanup);
  await refresh();
  if (!closed) heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
    // Durable reconciliation also supports changes made by another worker process.
    void refresh();
  }, 20000);
});

examBuilderRouter.get(base, validate({ params: course }), ensureCourseInstructor(), async (req, res) => { res.json(await builder.listBuilderExams(id(req.params.courseId))); });
examBuilderRouter.post(base, validate({ params: course }), ensureCourseInstructor(), validate({ body: z.object({ title: z.string().trim().min(1).max(150) }) }), async (req, res) => { res.status(201).json(await builder.createBuilderExam(id(req.params.courseId), req.body.title, req.user!.puid)); });
examBuilderRouter.get(detail, validate({ params: exam }), ensureCourseInstructor(), async (req, res) => { res.json(await builder.builderDetail(id(req.params.courseId), id(req.params.examId))); });
examBuilderRouter.put(`${detail}/title`, validate({ params: exam }), ensureCourseInstructor(), validate({ body: revision.extend({ title: z.string().trim().min(1).max(150) }) }), async (req, res) => { res.json(await builder.renameBuilderExam(id(req.params.courseId), id(req.params.examId), req.body.revision, req.body.title)); });
examBuilderRouter.delete(detail, validate({ params: exam }), ensureCourseInstructor(), validate({ body: revision }), async (req, res) => { res.json(await builder.deleteBuilderExam(id(req.params.courseId), id(req.params.examId), req.body.revision)); });
examBuilderRouter.put(`${detail}/settings`, validate({ params: exam }), ensureCourseInstructor(), validate({ body: revision.extend({ settings }) }), async (req, res) => { res.json(await builder.saveExamSettings(id(req.params.courseId), id(req.params.examId), req.body.revision, req.body.settings)); });
examBuilderRouter.post(`${detail}/bank-items`, validate({ params: exam }), ensureCourseInstructor(), validate({ body: revision.extend({ questions: z.array(z.object({ questionId: oid, versionId: oid })).min(1).max(100) }) }), async (req, res) => { res.json(await builder.addBankItems(id(req.params.courseId), id(req.params.examId), req.body.revision, req.body.questions, req.user!.puid)); });
examBuilderRouter.post(`${detail}/candidate-items`, validate({ params: exam }), ensureCourseInstructor(), validate({ body: revision.extend({ candidateId: oid }) }), async (req, res) => { res.json(await builder.addExamCandidate(id(req.params.courseId), id(req.params.examId), req.body.revision, id(req.body.candidateId))); });
examBuilderRouter.put(`${detail}/items`, validate({ params: exam }), ensureCourseInstructor(), validate({ body: revision.extend({ items: z.array(z.object({ id: z.string().uuid(), points: z.number().positive().max(1000), minutes: z.number().positive().max(240) })).max(100) }) }), async (req, res) => { res.json(await builder.arrangeExamItems(id(req.params.courseId), id(req.params.examId), req.body.revision, req.body.items)); });
examBuilderRouter.post(`${detail}/approve`, validate({ params: exam }), ensureCourseInstructor(), validate({ body: revision.extend({ itemId: z.string().uuid() }) }), async (req, res) => { res.json(await builder.approveExamItem(id(req.params.courseId), id(req.params.examId), req.body.revision, req.body.itemId, req.user!.puid)); });
examBuilderRouter.post(`${detail}/publish`, validate({ params: exam }), ensureCourseInstructor(), validate({ body: revision }), async (req, res) => { res.json(await builder.publishBuilderExam(id(req.params.courseId), id(req.params.examId), req.body.revision, req.user!.puid)); });
examBuilderRouter.post(`${detail}/revise`, validate({ params: exam }), ensureCourseInstructor(), validate({ body: revision }), async (req, res) => { res.json(await builder.reviseBuilderExam(id(req.params.courseId), id(req.params.examId), req.body.revision)); });
examBuilderRouter.post(`${detail}/duplicate`, validate({ params: exam }), ensureCourseInstructor(), async (req, res) => { res.status(201).json(await builder.duplicateBuilderExam(id(req.params.courseId), id(req.params.examId), req.user!.puid)); });
examBuilderRouter.post(`${detail}/release-results`, validate({ params: exam }), ensureCourseInstructor(), async (req, res) => { res.json(await builder.releaseExamResults(id(req.params.courseId), id(req.params.examId))); });
examBuilderRouter.post(`${detail}/plans`, validate({ params: exam }), ensureCourseInstructor(), validate({ body: plan }), async (req, res) => { res.status(201).json(await generation.planExamGeneration(id(req.params.courseId), id(req.params.examId), req.body.revision, req.body, req.user!.puid)); });
examBuilderRouter.post(`${detail}/runs/:runId/confirm`, validate({ params: run }), ensureCourseInstructor(), validate({ body: revision }), async (req, res) => { res.json(await generation.confirmExamGeneration(id(req.params.courseId), id(req.params.examId), id(req.params.runId), req.body.revision)); });
examBuilderRouter.post(`${detail}/runs/:runId/cancel`, validate({ params: run }), ensureCourseInstructor(), async (req, res) => { res.json(await generation.cancelExamGeneration(id(req.params.courseId), id(req.params.examId), id(req.params.runId))); });
examBuilderRouter.post(`${detail}/runs/:runId/retry`, validate({ params: run }), ensureCourseInstructor(), validate({ body: z.object({ requestId: z.string().uuid() }) }), async (req, res) => { res.json(await generation.retryExamGeneration(id(req.params.courseId), id(req.params.examId), id(req.params.runId), req.body.requestId, req.user!.puid)); });

const student = '/courses/:courseId/assessments';
examBuilderRouter.get(student, validate({ params: course }), ensureCourseStudent(), async (req, res) => { res.json(await attempts.listAssessments(id(req.params.courseId), req.user!.puid)); });
examBuilderRouter.post(`${student}/:examId/start`, validate({ params: exam }), ensureCourseStudent(), async (req, res) => { res.json(await attempts.startAssessment(id(req.params.courseId), id(req.params.examId), req.user!.puid)); });
const sitting = '/courses/:courseId/assessment-attempts/:attemptId';
examBuilderRouter.get(sitting, validate({ params: attempt }), ensureCourseStudent(), async (req, res) => { res.json(await attempts.assessmentState(id(req.params.courseId), id(req.params.attemptId), req.user!.puid)); });
examBuilderRouter.put(`${sitting}/answer`, validate({ params: attempt }), ensureCourseStudent(), validate({ body: z.object({ itemId: z.string().uuid(), selectedKey: z.string().min(1).max(10), answerRevision: z.number().int().min(0) }) }), async (req, res) => { res.json(await attempts.answerAssessment(id(req.params.courseId), id(req.params.attemptId), req.user!.puid, req.body.itemId, req.body.selectedKey, req.body.answerRevision)); });
examBuilderRouter.post(`${sitting}/submit`, validate({ params: attempt }), ensureCourseStudent(), async (req, res) => { res.json(await attempts.submitAssessment(id(req.params.courseId), id(req.params.attemptId), req.user!.puid)); });
examBuilderRouter.get(`${sitting}/results`, validate({ params: attempt }), ensureCourseStudent(), async (req, res) => { res.json(await attempts.assessmentResults(id(req.params.courseId), id(req.params.attemptId), req.user!.puid)); });
