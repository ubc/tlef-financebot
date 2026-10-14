import { randomInt } from 'node:crypto';
import { ObjectId, type WithId } from 'mongodb';
import { builderExamsCol, coursesCol, examBuildRunsCol, examPublicationsCol, losCol, previewAssessmentAttemptsCol } from '../components/mongodb/collections';
import type { AssessmentPreviewContext, PreviewAssessmentAttempt } from '../types/assessment-preview';
import type { AssessmentSubmissionReason, BuilderExam, ExamSettings, PaperQuestion } from '../types/exam-builder';
import { gradeAssessment } from './assessment-attempts.service';
import { courseLifecycle } from './courses.service';
import { examError } from './question-variant.service';
import { assessmentWindowLease, requireWindowOwner, validateAssessmentWindowId, windowCas, windowDueReason, windowReceipt } from './assessment-window';

const PREVIEW_LIFETIME_MS = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function scope(courseId: ObjectId, context: AssessmentPreviewContext) {
  return { courseId, instructorPuid: context.instructorPuid, previewSessionId: context.previewSessionId, access: context.access };
}
async function assertCourse(courseId: ObjectId, context: AssessmentPreviewContext) {
  if (!context.instructorPuid || !UUID.test(context.previewSessionId) || !['restricted', 'unrestricted'].includes(context.access)) examError('Invalid assessment preview context.', 400);
  const course = await coursesCol().findOne({ _id: courseId });
  if (!course || course.archivedAt || courseLifecycle(course) === 'archived' || (context.access === 'restricted' && courseLifecycle(course) !== 'published')) examError('Course is not available to students.', 404);
}
function itemProblem(items: PaperQuestion[]): string | undefined {
  if (!items.length) return 'Add at least one question before previewing this draft.';
  if (new Set(items.map(item => item.id)).size !== items.length || items.some(item => !UUID.test(item.id))) return 'The paper has invalid question identifiers.';
  if (items.some(item => !item.validated || !item.approval || item.assessment?.decision === 'reject')) return 'Every question needs valid checks and Instructor approval.';
  if (items.some(item => !Number.isFinite(item.points) || item.points <= 0 || !item.options.length || item.options.filter(option => option.role === 'correct').length !== 1 || new Set(item.options.map(option => option.key)).size !== item.options.length)) return 'Resolve invalid points or answer options before previewing.';
  return undefined;
}
function settingsProblem(settings: ExamSettings): string | undefined {
  if (!settings.title.trim() || !Number.isFinite(settings.durationMinutes) || settings.durationMinutes <= 0) return 'Set an exam title and a positive duration before previewing.';
  if (settings.feedback === 'immediate' && settings.purpose !== 'practice') return 'Immediate answer release is available only for practice exams.';
  return undefined;
}
async function draftProblem(exam: WithId<BuilderExam>): Promise<string | undefined> {
  const problem = itemProblem(exam.items) ?? settingsProblem(exam.settings);
  if (problem) return problem;
  if (exam.activeRunIds?.length || await examBuildRunsCol().countDocuments({ courseId: exam.courseId, examId: exam._id, status: { $in: ['queued', 'running'] } })) return 'Finish or cancel active generation before previewing this draft.';
  const loIds = [...new Set(exam.items.flatMap(item => item.loIds))];
  if (!loIds.length || loIds.some(id => !ObjectId.isValid(id)) || await losCol().countDocuments({ _id: { $in: loIds.map(id => new ObjectId(id)) }, courseId: exam.courseId, archivedAt: { $exists: false } }) !== loIds.length) return 'A learning objective is unavailable or belongs to another course.';
  return undefined;
}
function availabilityProblem(settings: ExamSettings, now = Date.now()): string | undefined {
  const opens = Date.parse(settings.opensAt), closes = Date.parse(settings.closesAt);
  if (!Number.isFinite(opens) || !Number.isFinite(closes) || closes <= opens) return 'The exam availability window is invalid.';
  if (now < opens) return 'This exam has not opened yet.';
  if (now >= closes) return 'This exam is closed.';
  return undefined;
}
function title(exam: WithId<BuilderExam>, settings: ExamSettings) { return exam.displayTitle ?? settings.title; }

/** No student records are consulted; only this actor/session/mode's receipts. */
export async function listPreviewAssessments(courseId: ObjectId, context: AssessmentPreviewContext) {
  await assertCourse(courseId, context);
  const exams = await builderExamsCol().find({ courseId, deletingAt: { $exists: false } }).toArray();
  const publications = await examPublicationsCol().find({ courseId, _id: { $in: exams.flatMap(exam => exam.publicationId ? [exam.publicationId] : []) } }).toArray();
  let attempts = await previewAssessmentAttemptsCol().find({ ...scope(courseId, context), expiresAt: { $gt: new Date() } }).toArray();
  await Promise.all(attempts.filter(a => !a.submittedAt && windowDueReason(a)).map(a => expirePreviewAssessmentWindow(courseId, a._id, context)));
  attempts = await previewAssessmentAttemptsCol().find({ ...scope(courseId, context), expiresAt: { $gt: new Date() } }).toArray();
  const rows = await Promise.all(exams.map(async exam => {
    const publication = publications.find(item => item.examId.equals(exam._id) && item._id.equals(exam.publicationId!));
    const draft = context.access === 'unrestricted' && (!publication || exam.publishedRevision !== exam.revision);
    if (!draft && !publication) return null;
    const attempt = attempts.find(item => item.examId.equals(exam._id));
    const source = attempt?.sourceStatus ?? (draft ? 'draft' as const : 'published' as const);
    const settings = attempt?.snapshot.settings ?? (draft ? exam.settings : publication!.settings);
    const items = attempt?.snapshot.items ?? (draft ? exam.items : publication!.items);
    const problem = attempt ? undefined : draft ? await draftProblem(exam) : itemProblem(items) ?? settingsProblem(settings) ?? (context.access === 'restricted' ? availabilityProblem(settings) : undefined);
    return {
      id: exam._id.toHexString(), title: attempt?.snapshot.title ?? title(exam, settings), kind: settings.kind, purpose: settings.purpose, durationMinutes: settings.durationMinutes,
      opensAt: settings.opensAt, closesAt: settings.closesAt, timeZone: settings.timeZone, feedback: settings.feedback, questionCount: items.length,
      source, sourceStatus: source, preview: true as const, previewMode: context.access, canStart: Boolean(attempt) || !problem,
      ...(problem && !attempt ? { unavailableReason: problem } : {}),
      ...(attempt ? { attemptId: attempt._id.toHexString(), submitted: Boolean(attempt.submittedAt) } : {}),
    };
  }));
  return rows.filter((row): row is NonNullable<typeof row> => row !== null);
}

export async function startPreviewAssessment(courseId: ObjectId, examId: ObjectId, context: AssessmentPreviewContext, windowId?: string) {
  if (windowId !== undefined) validateAssessmentWindowId(windowId);
  await assertCourse(courseId, context);
  const filter = { ...scope(courseId, context), examId };
  const existing = await previewAssessmentAttemptsCol().findOne({ ...filter, expiresAt: { $gt: new Date() } });
  if (existing) { if (windowId) await bindPreviewAssessmentWindow(courseId, existing._id, context, windowId); return previewAssessmentState(courseId, existing._id, context); }
  // TTL cleanup is asynchronous. Only the expired receipt can be removed here.
  await previewAssessmentAttemptsCol().deleteOne({ ...filter, expiresAt: { $lte: new Date() } });
  const exam = await builderExamsCol().findOne({ _id: examId, courseId, deletingAt: { $exists: false } });
  if (!exam) examError('Exam not found.', 404);
  const publication = exam.publicationId ? await examPublicationsCol().findOne({ _id: exam.publicationId, courseId, examId }) : null;
  const draft = context.access === 'unrestricted' && (!publication || exam.publishedRevision !== exam.revision);
  if (!draft && !publication) examError('Published exam not found.', 404);
  const settings = draft ? exam.settings : publication!.settings;
  const items = draft ? exam.items : publication!.items;
  const problem = draft ? await draftProblem(exam) : itemProblem(items) ?? settingsProblem(settings) ?? (context.access === 'restricted' ? availabilityProblem(settings) : undefined);
  if (problem) examError(problem);
  // A second read rejects a changed/deleting head without taking the live first-start lock.
  const current = await builderExamsCol().findOne({ _id: examId, courseId, revision: exam.revision, deletingAt: { $exists: false } });
  if (!current) examError('The paper changed before preview started. Please try again.');
  const now = new Date();
  const order = items.map(item => item.id);
  if (settings.shuffle) for (let i = order.length - 1; i > 0; i--) { const j = randomInt(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  // Anonymous Preview has no real student's timing accommodations.
  const durationDeadline = now.getTime() + settings.durationMinutes * 60_000;
  const attempt: PreviewAssessmentAttempt = {
    ...filter, ...(windowId ? { window: assessmentWindowLease(windowId, now) } : {}), sourceStatus: draft ? 'draft' : 'published', sourceRevision: draft ? exam.revision : publication!.revision,
    ...(!draft ? { publicationId: publication!._id } : {}),
    snapshot: structuredClone({ title: title(exam, settings), settings, items, ...(!draft && publication!.releasedAt ? { releasedAt: publication!.releasedAt } : {}) }),
    answerRevision: 0, order, answers: {}, startedAt: now,
    deadline: new Date(context.access === 'restricted' ? Math.min(durationDeadline, Date.parse(settings.closesAt)) : durationDeadline),
    expiresAt: new Date(now.getTime() + PREVIEW_LIFETIME_MS), maxScore: items.reduce((score, item) => score + item.points, 0),
  };
  let attemptId: ObjectId;
  try { attemptId = (await previewAssessmentAttemptsCol().insertOne(attempt)).insertedId; }
  catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    const winner = await previewAssessmentAttemptsCol().findOne({ ...filter, expiresAt: { $gt: new Date() } });
    if (!winner) throw error;
    attemptId = winner._id;
  }
  if (windowId) await bindPreviewAssessmentWindow(courseId, attemptId, context, windowId);
  return previewAssessmentState(courseId, attemptId, context);
}
async function loadReceipt(courseId: ObjectId, attemptId: ObjectId, context: AssessmentPreviewContext) {
  const attempt = await previewAssessmentAttemptsCol().findOne({ _id: attemptId, ...scope(courseId, context), expiresAt: { $gt: new Date() } });
  if (!attempt) examError('Preview attempt not found or expired.', 404);
  return attempt;
}
async function loadAttempt(courseId: ObjectId, attemptId: ObjectId, context: AssessmentPreviewContext) {
  await assertCourse(courseId, context);
  return loadReceipt(courseId, attemptId, context);
}
export async function expirePreviewAssessmentWindow(courseId: ObjectId, attemptId: ObjectId, context: AssessmentPreviewContext): Promise<boolean> {
  return finishPreviewAssessment(courseId, attemptId, context, undefined, undefined, true);
}
async function finishPreviewAssessment(courseId: ObjectId, attemptId: ObjectId, context: AssessmentPreviewContext, windowId?: string, requestedReason?: AssessmentSubmissionReason, dueOnly = false): Promise<boolean> {
  for (let retry = 0; retry < 5; retry++) {
    const attempt = await (dueOnly ? loadReceipt : loadAttempt)(courseId, attemptId, context);
    if (!dueOnly) requireWindowOwner(attempt, windowId);
    if (attempt.submittedAt) return false;
    const due = windowDueReason(attempt);
    if (dueOnly && !due) return false;
    const saved = await previewAssessmentAttemptsCol().updateOne({ _id: attemptId, ...scope(courseId, context), answerRevision: attempt.answerRevision, ...windowCas(attempt), expiresAt: { $gt: new Date() }, submittedAt: { $exists: false } }, { $set: { submittedAt: new Date(), submissionReason: due ?? requestedReason ?? 'submitted', score: gradeAssessment(attempt, attempt.snapshot) } });
    if (saved.matchedCount) return true;
  }
  examError('An answer or exam window was still being saved. Please try again.');
}
export async function submitPreviewAssessment(courseId: ObjectId, attemptId: ObjectId, context: AssessmentPreviewContext, windowId?: string) {
  await finishPreviewAssessment(courseId, attemptId, context, windowId);
  const attempt = await loadAttempt(courseId, attemptId, context);
  return { submitted: true as const, preview: true as const, ...(attempt.submissionReason ? { submissionReason: attempt.submissionReason } : {}) };
}
export async function bindPreviewAssessmentWindow(courseId: ObjectId, attemptId: ObjectId, context: AssessmentPreviewContext, windowId: string) {
  validateAssessmentWindowId(windowId);
  for (let retry = 0; retry < 5; retry++) {
    let attempt = await loadAttempt(courseId, attemptId, context);
    requireWindowOwner(attempt, windowId);
    if (!attempt.submittedAt && windowDueReason(attempt)) { await expirePreviewAssessmentWindow(courseId, attemptId, context); attempt = await loadAttempt(courseId, attemptId, context); }
    if (attempt.submittedAt) return windowReceipt(attempt);
    const window = assessmentWindowLease(windowId);
    const saved = await previewAssessmentAttemptsCol().updateOne({ _id: attemptId, ...scope(courseId, context), ...windowCas(attempt), ...(attempt.window ? { 'window.expiresAt': { $eq: attempt.window.expiresAt, $gt: new Date() } } : {}), submittedAt: { $exists: false }, deadline: { $gt: new Date() }, expiresAt: { $gt: new Date() } }, { $set: { window } });
    if (saved.matchedCount) return windowReceipt({ ...attempt, window });
  }
  examError('The exam window changed. Please reload.');
}
export async function heartbeatPreviewAssessmentWindow(courseId: ObjectId, attemptId: ObjectId, context: AssessmentPreviewContext, windowId: string) {
  const attempt = await loadAttempt(courseId, attemptId, context);
  if (!attempt.window) examError('Open an exam window before sending a heartbeat.');
  requireWindowOwner(attempt, windowId);
  return bindPreviewAssessmentWindow(courseId, attemptId, context, windowId);
}
export async function closePreviewAssessmentWindow(courseId: ObjectId, attemptId: ObjectId, context: AssessmentPreviewContext, windowId: string) {
  const attempt = await loadAttempt(courseId, attemptId, context);
  if (!attempt.window) examError('This attempt has no active exam window.');
  requireWindowOwner(attempt, windowId);
  await finishPreviewAssessment(courseId, attemptId, context, windowId, 'window-closed');
  return { submitted: true as const, preview: true as const };
}
export async function previewAssessmentState(courseId: ObjectId, attemptId: ObjectId, context: AssessmentPreviewContext) {
  let attempt = await loadAttempt(courseId, attemptId, context);
  if (!attempt.submittedAt && windowDueReason(attempt)) { await expirePreviewAssessmentWindow(courseId, attemptId, context); attempt = await loadAttempt(courseId, attemptId, context); }
  return {
    id: attempt._id.toHexString(), title: attempt.snapshot.title, ...windowReceipt(attempt), deadline: attempt.deadline.toISOString(), answerRevision: attempt.answerRevision,
    preview: true as const, previewMode: context.access,
    questions: attempt.order.map(id => { const item = attempt.snapshot.items.find(question => question.id === id)!; return { id, stem: item.stem, type: item.type, points: item.points, options: item.options.map(option => ({ key: option.key, text: option.text })), selectedKey: attempt.answers[id] ?? null }; }),
  };
}
export async function answerPreviewAssessment(courseId: ObjectId, attemptId: ObjectId, context: AssessmentPreviewContext, itemId: string, selectedKey: string, answerRevision: number, windowId?: string) {
  const attempt = await loadAttempt(courseId, attemptId, context);
  requireWindowOwner(attempt, windowId);
  const item = attempt.snapshot.items.find(question => question.id === itemId);
  if (!item || !item.options.some(option => option.key === selectedKey)) examError('Invalid question or option.', 400);
  if (windowDueReason(attempt)) { await expirePreviewAssessmentWindow(courseId, attemptId, context); examError('This exam has ended.'); }
  const now = new Date();
  const saved = await previewAssessmentAttemptsCol().updateOne({ _id: attemptId, ...scope(courseId, context), answerRevision, ...windowCas(attempt), ...(attempt.window ? { 'window.expiresAt': { $gt: now } } : {}), submittedAt: { $exists: false }, deadline: { $gt: now }, expiresAt: { $gt: now } }, { $set: { [`answers.${itemId}`]: selectedKey }, $inc: { answerRevision: 1 } });
  if (!saved.matchedCount) examError('This preview changed or was submitted. Reload to see saved answers.');
  return { answerRevision: answerRevision + 1 };
}
async function released(attempt: WithId<PreviewAssessmentAttempt>): Promise<boolean> {
  const settings = attempt.snapshot.settings;
  if (attempt.snapshot.releasedAt || (settings.feedback === 'immediate' && settings.purpose === 'practice') || (settings.feedback === 'after-close' && Date.now() >= Date.parse(settings.closesAt))) return true;
  if (!attempt.publicationId) return false;
  // Observe only manual release on the exact pinned publication, not a replacement.
  const publication = await examPublicationsCol().findOne({ _id: attempt.publicationId, courseId: attempt.courseId, examId: attempt.examId });
  return Boolean(publication?.releasedAt);
}
export async function previewAssessmentResults(courseId: ObjectId, attemptId: ObjectId, context: AssessmentPreviewContext) {
  await previewAssessmentState(courseId, attemptId, context);
  const attempt = await loadAttempt(courseId, attemptId, context);
  if (!attempt.submittedAt) examError('Submit the exam before requesting results.');
  const base = { title: attempt.snapshot.title, preview: true as const, previewMode: context.access };
  if (context.access === 'restricted' && !await released(attempt)) return { ...base, released: false as const, message: attempt.snapshot.settings.feedback === 'after-close' ? 'Results will be available after the exam closes.' : 'Your Instructor will release the results.' };
  return {
    ...base, released: true as const, score: attempt.score, maxScore: attempt.maxScore,
    ...(context.access === 'unrestricted' ? { simulatedRelease: true as const, message: 'Preview only: answer release is simulated so you can review the full result. Student release settings are unchanged.' } : {}),
    questions: attempt.order.map(id => { const item = attempt.snapshot.items.find(question => question.id === id)!; return { id, stem: item.stem, points: item.points, selectedKey: attempt.answers[id] ?? null, options: item.options.map(option => ({ key: option.key, text: option.text, explanation: option.explanation, correct: option.role === 'correct' })) }; }),
  };
}
