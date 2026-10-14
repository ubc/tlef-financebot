import { randomInt } from 'node:crypto';
import type { ObjectId, WithId } from 'mongodb';
import { assessmentAttemptsCol, builderExamsCol, examPublicationsCol, coursesCol } from '../components/mongodb/collections';
import type { AssessmentAttempt, AssessmentSubmissionReason, ExamPublication } from '../types/exam-builder';
import { examError } from './question-variant.service';
import { assessmentWindowLease, requireWindowOwner, validateAssessmentWindowId, windowCas, windowDueReason, windowReceipt } from './assessment-window';

async function studentCourse(courseId: ObjectId) {
  const course = await coursesCol().findOne({ _id: courseId });
  if (!course || course.lifecycle === 'archived' || !(course.lifecycle === 'published' || course.published)) examError('This course is not available to students.', 403);
}
export async function listAssessments(courseId: ObjectId, puid: string) {
  await studentCourse(courseId);
  const exams = await builderExamsCol().find({ courseId, publicationId: { $exists: true }, deletingAt: { $exists: false } }).toArray();
  let attempts = await assessmentAttemptsCol().find({ courseId, puid }).toArray();
  await Promise.all(attempts.filter(a => !a.submittedAt && windowDueReason(a)).map(a => expireAssessmentWindow(courseId, a._id, puid)));
  attempts = await assessmentAttemptsCol().find({ courseId, puid }).toArray();
  const publications = await examPublicationsCol().find({ _id: { $in: exams.map(e => e.publicationId!) }, courseId }).toArray();
  return publications.map(publication => {
    const attempt = attempts.find(a => a.examId.equals(publication.examId));
    return { id: publication.examId.toHexString(), title: exams.find(exam => exam._id.equals(publication.examId))?.displayTitle ?? publication.settings.title, kind: publication.settings.kind, purpose: publication.settings.purpose, durationMinutes: publication.settings.durationMinutes,
      opensAt: publication.settings.opensAt, closesAt: publication.settings.closesAt, timeZone: publication.settings.timeZone, feedback: publication.settings.feedback, questionCount: publication.items.length,
      ...(attempt ? { attemptId: attempt._id.toHexString(), submitted: Boolean(attempt.submittedAt) } : {}) };
  });
}
export async function startAssessment(courseId: ObjectId, examId: ObjectId, puid: string, windowId?: string) {
  if (windowId !== undefined) validateAssessmentWindowId(windowId);
  await studentCourse(courseId);
  const existing = await assessmentAttemptsCol().findOne({ examId, courseId, puid });
  if (existing) { if (windowId) await bindAssessmentWindow(courseId, existing._id, puid, windowId); return assessmentState(courseId, existing._id, puid); }
  // The same document CAS used by publication serializes first start against
  // replacing a paper. Once a student starts, this exam cannot be republished.
  const exam = await builderExamsCol().findOne({ _id: examId, courseId, publicationId: { $exists: true }, deletingAt: { $exists: false } });
  if (!exam?.publicationId) examError('Published exam not found.', 404);
  const publication = await examPublicationsCol().findOne({ _id: exam.publicationId, courseId, examId });
  if (!publication) examError('Published exam not found.', 404);
  const now = new Date();
  if (now.getTime() < Date.parse(publication.settings.opensAt) || now.getTime() >= Date.parse(publication.settings.closesAt)) examError('This exam is outside its availability window.');
  const pinned = await builderExamsCol().updateOne({ _id: examId, courseId, publicationId: publication._id, deletingAt: { $exists: false } }, { $set: { startedAt: now } });
  if (!pinned.matchedCount) examError('The paper changed before your attempt started. Please try again.');
  const extra = publication.settings.accommodations.find(a => a.puid === puid)?.extraMinutes ?? 0;
  const order = publication.items.map(i => i.id);
  if (publication.settings.shuffle) for (let i = order.length - 1; i > 0; i--) { const j = randomInt(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  const attempt: AssessmentAttempt = { ...(windowId ? { window: assessmentWindowLease(windowId, now) } : {}), courseId, examId, publicationId: publication._id, puid, answerRevision: 0, revision: publication.revision, order, answers: {}, startedAt: now,
    deadline: new Date(Math.min(Date.parse(publication.settings.closesAt), now.getTime() + (publication.settings.durationMinutes + extra) * 60_000)), maxScore: publication.items.reduce((n, q) => n + q.points, 0) };
  let attemptId: ObjectId;
  try { attemptId = (await assessmentAttemptsCol().insertOne(attempt)).insertedId; }
  catch (error) { if ((error as { code?: number }).code !== 11000) throw error; const winner = await assessmentAttemptsCol().findOne({ courseId, examId, puid }); if (!winner) throw error; attemptId = winner._id; }
  if (windowId) await bindAssessmentWindow(courseId, attemptId, puid, windowId);
  return assessmentState(courseId, attemptId, puid);
}
async function loadAttempt(courseId: ObjectId, attemptId: ObjectId, puid: string) {
  const attempt = await assessmentAttemptsCol().findOne({ _id: attemptId, courseId, puid });
  if (!attempt) examError('Attempt not found.', 404);
  const publication = await examPublicationsCol().findOne({ _id: attempt.publicationId, courseId });
  if (!publication) examError('Published paper not found.', 404);
  const exam = await builderExamsCol().findOne({ _id: attempt.examId, courseId });
  return { attempt, publication, title: exam?.displayTitle ?? publication.settings.title };
}
export function gradeAssessment(attempt: Pick<AssessmentAttempt, 'answers'>, publication: Pick<ExamPublication, 'items'>): number {
  return publication.items.reduce((score, question) => score + (question.options.find(option => option.key === attempt.answers[question.id])?.role === 'correct' ? question.points : 0), 0);
}
/** The sweeper does not depend on enrollment still being active. It finalizes
 * only this exact owned sitting and never creates attempts or changes release. */
export async function expireAssessmentWindow(courseId: ObjectId, attemptId: ObjectId, puid: string): Promise<boolean> {
  return finishAssessment(courseId, attemptId, puid, undefined, undefined, true);
}
async function finishAssessment(courseId: ObjectId, attemptId: ObjectId, puid: string, windowId?: string, requestedReason?: AssessmentSubmissionReason, dueOnly = false): Promise<boolean> {
  for (let retry = 0; retry < 5; retry++) {
    const { attempt, publication } = await loadAttempt(courseId, attemptId, puid);
    if (!dueOnly) requireWindowOwner(attempt, windowId);
    if (attempt.submittedAt) return false;
    const due = windowDueReason(attempt);
    if (dueOnly && !due) return false;
    const submissionReason = due ?? requestedReason ?? 'submitted';
    const done = await assessmentAttemptsCol().updateOne({ _id: attemptId, courseId, puid, answerRevision: attempt.answerRevision, ...windowCas(attempt), submittedAt: { $exists: false } }, { $set: { submittedAt: new Date(), submissionReason, score: gradeAssessment(attempt, publication) } });
    if (done.matchedCount) return true;
  }
  examError('An answer or exam window was still being saved. Please try again.');
}
export async function submitAssessment(courseId: ObjectId, attemptId: ObjectId, puid: string, windowId?: string) {
  await finishAssessment(courseId, attemptId, puid, windowId);
  const { attempt } = await loadAttempt(courseId, attemptId, puid);
  return { submitted: true, ...(attempt.submissionReason ? { submissionReason: attempt.submissionReason } : {}) };
}
export async function bindAssessmentWindow(courseId: ObjectId, attemptId: ObjectId, puid: string, windowId: string) {
  validateAssessmentWindowId(windowId);
  for (let retry = 0; retry < 5; retry++) {
    let { attempt } = await loadAttempt(courseId, attemptId, puid);
    requireWindowOwner(attempt, windowId);
    if (!attempt.submittedAt && windowDueReason(attempt)) { await expireAssessmentWindow(courseId, attemptId, puid); ({ attempt } = await loadAttempt(courseId, attemptId, puid)); }
    if (attempt.submittedAt) return windowReceipt(attempt);
    const window = assessmentWindowLease(windowId);
    const saved = await assessmentAttemptsCol().updateOne({ _id: attemptId, courseId, puid, ...windowCas(attempt), ...(attempt.window ? { 'window.expiresAt': { $eq: attempt.window.expiresAt, $gt: new Date() } } : {}), submittedAt: { $exists: false }, deadline: { $gt: new Date() } }, { $set: { window } });
    if (saved.matchedCount) return windowReceipt({ ...attempt, window });
  }
  examError('The exam window changed. Please reload.');
}
export async function heartbeatAssessmentWindow(courseId: ObjectId, attemptId: ObjectId, puid: string, windowId: string) {
  const { attempt } = await loadAttempt(courseId, attemptId, puid);
  if (!attempt.window) examError('Open an exam window before sending a heartbeat.');
  requireWindowOwner(attempt, windowId);
  return bindAssessmentWindow(courseId, attemptId, puid, windowId);
}
export async function closeAssessmentWindow(courseId: ObjectId, attemptId: ObjectId, puid: string, windowId: string) {
  const { attempt } = await loadAttempt(courseId, attemptId, puid);
  if (!attempt.window) examError('This attempt has no active exam window.');
  requireWindowOwner(attempt, windowId);
  await finishAssessment(courseId, attemptId, puid, windowId, 'window-closed');
  return { submitted: true };
}
export async function assessmentState(courseId: ObjectId, attemptId: ObjectId, puid: string) {
  let { attempt, publication, title } = await loadAttempt(courseId, attemptId, puid);
  if (!attempt.submittedAt && windowDueReason(attempt)) { await expireAssessmentWindow(courseId, attemptId, puid); ({ attempt, publication, title } = await loadAttempt(courseId, attemptId, puid)); }
  // Explicit allowlist: no answer key, explanation, provenance, lease id or score.
  return { id: attempt._id.toHexString(), title, ...windowReceipt(attempt), deadline: attempt.deadline.toISOString(), answerRevision: attempt.answerRevision,
    questions: attempt.order.map(id => { const item = publication.items.find(i => i.id === id)!; return { id, stem: item.stem, type: item.type, points: item.points, options: item.options.map(o => ({ key: o.key, text: o.text })), selectedKey: attempt.answers[id] ?? null }; }) };
}
export async function answerAssessment(courseId: ObjectId, attemptId: ObjectId, puid: string, itemId: string, selectedKey: string, answerRevision: number, windowId?: string) {
  const { attempt, publication } = await loadAttempt(courseId, attemptId, puid);
  requireWindowOwner(attempt, windowId);
  const item = publication.items.find(i => i.id === itemId);
  if (!item || !item.options.some(o => o.key === selectedKey)) examError('Invalid question or option.', 400);
  if (windowDueReason(attempt)) { await expireAssessmentWindow(courseId, attemptId, puid); examError('This exam has ended.'); }
  const now = new Date();
  const saved = await assessmentAttemptsCol().updateOne({ _id: attemptId, courseId, puid, answerRevision, ...windowCas(attempt), ...(attempt.window ? { 'window.expiresAt': { $gt: now } } : {}), submittedAt: { $exists: false }, deadline: { $gt: now } }, { $set: { [`answers.${itemId}`]: selectedKey }, $inc: { answerRevision: 1 } });
  if (!saved.matchedCount) examError('This attempt changed or was submitted. Reload to see saved answers.');
  return { answerRevision: answerRevision + 1 };
}
export function answersReleased(publication: WithId<ExamPublication>, now = new Date()): boolean {
  return Boolean(publication.releasedAt) || (publication.settings.feedback === 'immediate' && publication.settings.purpose === 'practice')
    || (publication.settings.feedback === 'after-close' && now.getTime() >= Date.parse(publication.settings.closesAt));
}
export async function assessmentResults(courseId: ObjectId, attemptId: ObjectId, puid: string) {
  await assessmentState(courseId, attemptId, puid);
  const { attempt, publication, title } = await loadAttempt(courseId, attemptId, puid);
  if (!attempt.submittedAt) examError('Submit the exam before requesting results.');
  if (!answersReleased(publication)) return { released: false as const, title, message: publication.settings.feedback === 'after-close' ? 'Results will be available after the exam closes.' : 'Your Instructor will release the results.' };
  return { released: true as const, title, score: attempt.score, maxScore: attempt.maxScore,
    questions: attempt.order.map(id => { const q = publication.items.find(i => i.id === id)!; return { id, stem: q.stem, points: q.points, selectedKey: attempt.answers[id] ?? null, options: q.options.map(o => ({ key: o.key, text: o.text, explanation: o.explanation, correct: o.role === 'correct' })) }; }) };
}
