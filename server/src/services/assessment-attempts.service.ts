import { randomInt } from 'node:crypto';
import type { ObjectId, WithId } from 'mongodb';
import { assessmentAttemptsCol, builderExamsCol, examPublicationsCol, coursesCol } from '../components/mongodb/collections';
import type { AssessmentAttempt, ExamPublication } from '../types/exam-builder';
import { examError } from './question-variant.service';

async function studentCourse(courseId: ObjectId) {
  const course = await coursesCol().findOne({ _id: courseId });
  if (!course || course.lifecycle === 'archived' || !(course.lifecycle === 'published' || course.published)) examError('This course is not available to students.', 403);
}
export async function listAssessments(courseId: ObjectId, puid: string) {
  await studentCourse(courseId);
  const exams = await builderExamsCol().find({ courseId, publicationId: { $exists: true }, deletingAt: { $exists: false } }).toArray();
  const attempts = await assessmentAttemptsCol().find({ courseId, puid }).toArray();
  const publications = await examPublicationsCol().find({ _id: { $in: exams.map(e => e.publicationId!) }, courseId }).toArray();
  return publications.map(publication => {
    const attempt = attempts.find(a => a.examId.equals(publication.examId));
    return { id: publication.examId.toHexString(), title: exams.find(exam => exam._id.equals(publication.examId))?.displayTitle ?? publication.settings.title, kind: publication.settings.kind, purpose: publication.settings.purpose, durationMinutes: publication.settings.durationMinutes,
      opensAt: publication.settings.opensAt, closesAt: publication.settings.closesAt, timeZone: publication.settings.timeZone, feedback: publication.settings.feedback, questionCount: publication.items.length,
      ...(attempt ? { attemptId: attempt._id.toHexString(), submitted: Boolean(attempt.submittedAt) } : {}) };
  });
}
export async function startAssessment(courseId: ObjectId, examId: ObjectId, puid: string) {
  await studentCourse(courseId);
  const existing = await assessmentAttemptsCol().findOne({ examId, courseId, puid });
  if (existing) return assessmentState(courseId, existing._id, puid);
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
  const attempt: AssessmentAttempt = { courseId, examId, publicationId: publication._id, puid, answerRevision: 0, revision: publication.revision, order, answers: {}, startedAt: now,
    deadline: new Date(Math.min(Date.parse(publication.settings.closesAt), now.getTime() + (publication.settings.durationMinutes + extra) * 60_000)), maxScore: publication.items.reduce((n, q) => n + q.points, 0) };
  let attemptId: ObjectId;
  try { attemptId = (await assessmentAttemptsCol().insertOne(attempt)).insertedId; }
  catch (error) { if ((error as { code?: number }).code !== 11000) throw error; const winner = await assessmentAttemptsCol().findOne({ courseId, examId, puid }); if (!winner) throw error; attemptId = winner._id; }
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
export async function submitAssessment(courseId: ObjectId, attemptId: ObjectId, puid: string) {
  for (let retry = 0; retry < 5; retry++) {
    const { attempt, publication } = await loadAttempt(courseId, attemptId, puid);
    if (attempt.submittedAt) return { submitted: true };
    const done = await assessmentAttemptsCol().updateOne({ _id: attemptId, courseId, puid, answerRevision: attempt.answerRevision, submittedAt: { $exists: false } }, { $set: { submittedAt: new Date(), score: gradeAssessment(attempt, publication) } });
    if (done.matchedCount) return { submitted: true };
  }
  examError('An answer was still being saved. Please submit again.');
}
export async function assessmentState(courseId: ObjectId, attemptId: ObjectId, puid: string) {
  let { attempt, publication, title } = await loadAttempt(courseId, attemptId, puid);
  if (!attempt.submittedAt && attempt.deadline.getTime() <= Date.now()) { await submitAssessment(courseId, attemptId, puid); ({ attempt, publication, title } = await loadAttempt(courseId, attemptId, puid)); }
  // Explicit allowlist: no answer key, explanation, provenance or score.
  return { id: attempt._id.toHexString(), title, submitted: Boolean(attempt.submittedAt), deadline: attempt.deadline.toISOString(), serverTime: new Date().toISOString(), answerRevision: attempt.answerRevision,
    questions: attempt.order.map(id => { const item = publication.items.find(i => i.id === id)!; return { id, stem: item.stem, type: item.type, points: item.points, options: item.options.map(o => ({ key: o.key, text: o.text })), selectedKey: attempt.answers[id] ?? null }; }) };
}
export async function answerAssessment(courseId: ObjectId, attemptId: ObjectId, puid: string, itemId: string, selectedKey: string, answerRevision: number) {
  const { attempt, publication } = await loadAttempt(courseId, attemptId, puid);
  const item = publication.items.find(i => i.id === itemId);
  if (!item || !item.options.some(o => o.key === selectedKey)) examError('Invalid question or option.', 400);
  if (attempt.deadline.getTime() <= Date.now()) { await submitAssessment(courseId, attemptId, puid); examError('The exam time has ended.'); }
  const saved = await assessmentAttemptsCol().updateOne({ _id: attemptId, courseId, puid, answerRevision, submittedAt: { $exists: false }, deadline: { $gt: new Date() } }, { $set: { [`answers.${itemId}`]: selectedKey }, $inc: { answerRevision: 1 } });
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
