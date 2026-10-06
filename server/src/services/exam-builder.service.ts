import { createHash, randomUUID } from 'node:crypto';
import { cancelJobsByDataIds } from '../components/jobs';
import { ObjectId, type WithId } from 'mongodb';
import { builderExamsCol, examCandidatesCol, examBuildRunsCol, examPublicationsCol, assessmentAttemptsCol, coursesCol, losCol, questionsCol, questionVersionsCol } from '../components/mongodb/collections';
import type { BuilderExam, ExamSettings } from '../types/exam-builder';
import { examError, freezeExamQuestion, QuestionVariantService } from './question-variant.service';

export async function requireExamCourse(courseId: ObjectId): Promise<void> {
  const course = await coursesCol().findOne({ _id: courseId });
  if (!course || course.lifecycle === 'archived') examError('The course is unavailable.', 404);
}
export async function getBuilderExam(courseId: ObjectId, examId: ObjectId) {
  const exam = await builderExamsCol().findOne({ _id: examId, courseId });
  if (!exam) examError('Exam not found.', 404);
  return exam;
}
export function assertEditable(exam: WithId<BuilderExam>, revision: number): void {
  if (exam.deletingAt) examError('This exam is being deleted.');
  if (exam.revision !== revision) examError('This exam changed in another session. Reload before saving.');
  if (exam.publishedRevision === exam.revision) examError('Published papers are locked. Create a revised draft first.');
}
export async function validateExamLos(courseId: ObjectId, ids: string[]): Promise<void> {
  const unique = [...new Set(ids)];
  if (!unique.length || unique.some(id => !ObjectId.isValid(id))) examError('Select active learning objectives in this course.', 400);
  if (await losCol().countDocuments({ _id: { $in: unique.map(id => new ObjectId(id)) }, courseId, archivedAt: { $exists: false } }) !== unique.length) examError('A learning objective is unavailable or belongs to another course.', 400);
}
export function validateSettings(settings: ExamSettings, publishing = false): void {
  if (!settings.title.trim()) examError('An exam title is required.', 400);
  if (settings.purpose === 'formal' && settings.feedback === 'immediate') examError('Immediate answer release is available only for practice exams.', 400);
  try { new Intl.DateTimeFormat('en-CA', { timeZone: settings.timeZone }); } catch { examError('Choose a valid timezone.', 400); }
  if (new Set(settings.accommodations.map(a => a.puid)).size !== settings.accommodations.length) examError('Each student can have only one accommodation.', 400);
  if (publishing && (!settings.opensAt || !settings.closesAt || !Number.isFinite(Date.parse(settings.opensAt)) || Date.parse(settings.closesAt) <= Date.parse(settings.opensAt))) examError('Choose a valid opening and closing time.', 400);
}
export async function createBuilderExam(courseId: ObjectId, title: string, by: string) {
  await requireExamCourse(courseId);
  const now = new Date();
  const exam: BuilderExam = { courseId, revision: 0, settings: { title, kind: 'midterm', purpose: 'formal', durationMinutes: 60, opensAt: '', closesAt: '', timeZone: 'America/Vancouver', feedback: 'instructor', shuffle: false, accommodations: [] }, items: [], createdBy: by, createdAt: now, updatedAt: now };
  const { insertedId } = await builderExamsCol().insertOne(exam);
  return { ...exam, _id: insertedId };
}
export const examTitle = (exam: Pick<BuilderExam, 'displayTitle' | 'settings'>) => exam.displayTitle ?? exam.settings.title;

export async function listBuilderExams(courseId: ObjectId) {
  return builderExamsCol().find({ courseId }, { projection: { items: 0 } }).sort({ updatedAt: -1 }).toArray();
}
export async function builderDetail(courseId: ObjectId, examId: ObjectId) {
  const exam = await getBuilderExam(courseId, examId);
  const [candidates, runs] = await Promise.all([
    examCandidatesCol().find({ courseId, examId }).sort({ createdAt: -1 }).limit(100).toArray(),
    examBuildRunsCol().find({ courseId, examId }).sort({ createdAt: -1 }).limit(30).toArray(),
  ]);
  return { exam, candidates, runs };
}
async function writeExam(exam: WithId<BuilderExam>, patch: Partial<BuilderExam>) {
  const saved = await builderExamsCol().findOneAndUpdate({ _id: exam._id, courseId: exam.courseId, revision: exam.revision, deletingAt: { $exists: false } }, { $set: { ...patch, updatedAt: new Date() }, $inc: { revision: 1 } }, { returnDocument: 'after' });
  if (!saved) examError('This exam changed in another session. Reload before saving.');
  return saved;
}
export async function saveExamSettings(courseId: ObjectId, examId: ObjectId, revision: number, settings: ExamSettings) {
  const exam = await getBuilderExam(courseId, examId); assertEditable(exam, revision); validateSettings(settings);
  return writeExam(exam, { settings, displayTitle: settings.title });
}
/** Title is mutable metadata. Published question/settings snapshots stay immutable. */
export async function renameBuilderExam(courseId: ObjectId, examId: ObjectId, revision: number, title: string) {
  const exam = await getBuilderExam(courseId, examId);
  if (exam.deletingAt) examError('This exam is being deleted.');
  if (exam.revision !== revision) examError('This exam changed in another session. Reload before renaming.');
  const nextTitle = title.trim();
  if (!nextTitle || nextTitle.length > 150) examError('Enter a title of up to 150 characters.', 400);
  if (nextTitle === examTitle(exam)) return exam;
  const locked = exam.publishedRevision === exam.revision;
  const saved = await builderExamsCol().findOneAndUpdate(
    { _id: examId, courseId, revision, deletingAt: { $exists: false } },
    { $set: { displayTitle: nextTitle, updatedAt: new Date(), ...(locked ? { publishedRevision: revision + 1 } : {}) }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  );
  if (!saved) examError('This exam changed in another session. Reload before renaming.');
  return saved;
}

/** Permanently remove only a paper with no sitting or active generation. The
 * exam marker serializes deletion against student start and generation confirm. */
export async function deleteBuilderExam(courseId: ObjectId, examId: ObjectId, revision: number) {
  const exam = await getBuilderExam(courseId, examId);
  if (exam.revision !== revision) examError('This exam changed in another session. Reload before deleting.');
  if (exam.startedAt || await assessmentAttemptsCol().countDocuments({ courseId, examId })) examError('Students have started this exam, so it cannot be deleted.');
  if (exam.activeRunIds?.length || await examBuildRunsCol().countDocuments({ courseId, examId, status: { $in: ['queued', 'running'] } })) examError('Cancel active generation before deleting this exam.');
  if (!exam.deletingAt) {
    const marked = await builderExamsCol().findOneAndUpdate(
      { _id: examId, courseId, revision, startedAt: { $exists: false }, deletingAt: { $exists: false }, 'activeRunIds.0': { $exists: false } },
      { $set: { deletingAt: new Date(), updatedAt: new Date() } }, { returnDocument: 'after' },
    );
    if (!marked) examError('This exam changed. Reload before deleting.');
  }
  // If a previous cleanup was interrupted, this sequence is safe to retry.
  const runs = await examBuildRunsCol().find({ courseId, examId }, { projection: { _id: 1 } }).toArray();
  await cancelJobsByDataIds(runs.map(run => run._id.toHexString()), []);
  await examCandidatesCol().deleteMany({ courseId, examId });
  await examBuildRunsCol().deleteMany({ courseId, examId });
  await examPublicationsCol().deleteMany({ courseId, examId });
  await builderExamsCol().deleteOne({ _id: examId, courseId, deletingAt: { $exists: true } });
  return { deleted: true };
}

export async function addBankItems(courseId: ObjectId, examId: ObjectId, revision: number, refs: Array<{ questionId: string; versionId: string }>, by: string) {
  const exam = await getBuilderExam(courseId, examId); assertEditable(exam, revision);
  const items = [...exam.items];
  for (const ref of refs) {
    if (items.some(i => i.source === 'bank' && i.questionId === ref.questionId)) continue;
    const { question, version } = await new QuestionVariantService().source(courseId, ref.questionId, ref.versionId);
    await validateExamLos(courseId, question.loIds.map(id => id.toHexString()));
    const frozen = await freezeExamQuestion(version, ref.questionId);
    items.push({ ...frozen, id: randomUUID(), source: 'bank', ...ref, familyId: (question.templateFamilyId ?? question._id).toHexString(), loIds: question.loIds.map(id => id.toHexString()), points: 1, minutes: version.type === 'mcq' ? 3 : 1, practiceExposure: true,
      ...(question.state === 'approved' && question.currentVersionId.equals(version._id) ? { approval: { by, at: new Date().toISOString() } } : {}) });
  }
  if (items.length > 100) examError('An exam can contain at most 100 questions.', 400);
  return writeExam(exam, { items });
}
export async function addExamCandidate(courseId: ObjectId, examId: ObjectId, revision: number, candidateId: ObjectId) {
  const exam = await getBuilderExam(courseId, examId); assertEditable(exam, revision);
  const candidate = await examCandidatesCol().findOne({ _id: candidateId, courseId, examId });
  if (!candidate) examError('Candidate not found.', 404);
  if (exam.items.some(i => i.id === candidate.item.id)) return exam;
  await validateExamLos(courseId, candidate.item.loIds);
  if (exam.items.length >= 100) examError('An exam can contain at most 100 questions.', 400);
  return writeExam(exam, { items: [...exam.items, candidate.item] });
}
export async function arrangeExamItems(courseId: ObjectId, examId: ObjectId, revision: number, input: Array<{ id: string; points: number; minutes: number }>) {
  const exam = await getBuilderExam(courseId, examId); assertEditable(exam, revision);
  if (new Set(input.map(i => i.id)).size !== input.length) examError('Duplicate exam item.', 400);
  const items = input.map(row => { const item = exam.items.find(i => i.id === row.id); if (!item) examError('Unknown exam item.', 400); return { ...item, points: row.points, minutes: row.minutes }; });
  return writeExam(exam, { items });
}
export async function approveExamItem(courseId: ObjectId, examId: ObjectId, revision: number, itemId: string, by: string) {
  const exam = await getBuilderExam(courseId, examId); assertEditable(exam, revision);
  const item = exam.items.find(i => i.id === itemId);
  if (!item) examError('Question not found.', 404);
  if (!item.validated || item.assessment?.decision === 'reject') examError('Resolve failed automated checks by generating a new candidate.');
  await validateExamLos(courseId, item.loIds);
  return writeExam(exam, { items: exam.items.map(i => i.id === itemId ? { ...i, approval: { by, at: new Date().toISOString() } } : i) });
}
export function examReadiness(exam: Pick<BuilderExam, 'items' | 'settings'>): { blockers: string[]; warnings: string[] } {
  const blockers: string[] = [], warnings: string[] = [];
  if (!exam.items.length) blockers.push('Add at least one question.');
  if (exam.items.some(i => !i.approval || !i.validated || i.assessment?.decision === 'reject')) blockers.push('Every question needs valid checks and Instructor approval.');
  if (exam.items.some(i => !Number.isFinite(i.points) || i.points <= 0)) blockers.push('All questions need positive points.');
  try { validateSettings(exam.settings, true); } catch (error) { blockers.push((error as Error).message); }
  if (exam.items.some(i => i.practiceExposure)) warnings.push('Some selected questions or their source families may have appeared in practice.');
  if (new Set(exam.items.map(i => i.familyId)).size < exam.items.length) warnings.push('Related question families appear more than once.');
  if (exam.items.reduce((n, i) => n + i.minutes, 0) > exam.settings.durationMinutes) warnings.push('Estimated completion time exceeds the exam duration.');
  return { blockers, warnings };
}
export async function publishBuilderExam(courseId: ObjectId, examId: ObjectId, revision: number, by: string) {
  await requireExamCourse(courseId);
  const exam = await getBuilderExam(courseId, examId); assertEditable(exam, revision);
  if (exam.activeRunIds?.length) examError('Finish or cancel active generation before publishing.');
  const { blockers } = examReadiness(exam); if (blockers.length) examError(blockers.join(' '));
  await validateExamLos(courseId, exam.items.flatMap(i => i.loIds));
  if (await examBuildRunsCol().countDocuments({ courseId, examId, status: { $in: ['queued', 'running'] } })) examError('Finish or cancel active generation before publishing.');
  if (await assessmentAttemptsCol().countDocuments({ courseId, examId })) examError('Students have already started this exam. Duplicate it to publish another paper.');
  for (const item of exam.items.filter(i => i.source === 'bank')) {
    const question = await questionsCol().findOne({ _id: new ObjectId(item.questionId!), courseId });
    const version = await questionVersionsCol().findOne({ _id: new ObjectId(item.versionId!), questionId: new ObjectId(item.questionId!) });
    if (!question || !version || question.state === 'archived' || question.state === 'paused') examError('A pinned bank question is no longer available.');
    await freezeExamQuestion(version, item.questionId!);
  }
  const publicationId = new ObjectId(createHash('sha256').update(`${examId}:${revision}`).digest('hex').slice(0, 24));
  const publicationSettings = { ...exam.settings, title: examTitle(exam) };
  const data = { courseId, examId, revision, settings: publicationSettings, items: exam.items, publishedBy: by, publishedAt: new Date(), hash: createHash('sha256').update(JSON.stringify({ settings: publicationSettings, items: exam.items })).digest('hex') };
  await examPublicationsCol().updateOne({ _id: publicationId }, { $setOnInsert: data }, { upsert: true });
  const saved = await builderExamsCol().findOneAndUpdate({ _id: examId, courseId, revision, startedAt: { $exists: false }, deletingAt: { $exists: false } }, { $set: { publicationId, publishedRevision: revision + 1, updatedAt: new Date() }, $inc: { revision: 1 } }, { returnDocument: 'after' });
  if (!saved) examError('The exam changed or a student started it. Reload before publishing.');
  return saved;
}
export async function reviseBuilderExam(courseId: ObjectId, examId: ObjectId, revision: number) {
  const exam = await getBuilderExam(courseId, examId);
  if (exam.revision !== revision) examError('Reload the latest exam first.');
  if (exam.startedAt) examError('Students have started this exam. Duplicate it to make a new paper.');
  return writeExam(exam, {});
}
export async function duplicateBuilderExam(courseId: ObjectId, examId: ObjectId, by: string) {
  const exam = await getBuilderExam(courseId, examId);
  const copy = await createBuilderExam(courseId, `${examTitle(exam)} (copy)`, by);
  return writeExam(copy, { settings: { ...exam.settings, title: `${examTitle(exam)} (copy)`, opensAt: '', closesAt: '', accommodations: [] }, items: exam.items.map(i => ({ ...i, id: randomUUID() })) });
}
export async function releaseExamResults(courseId: ObjectId, examId: ObjectId) {
  const exam = await getBuilderExam(courseId, examId);
  if (!exam.publicationId) examError('Publish an exam first.');
  const publication = await examPublicationsCol().findOne({ _id: exam.publicationId, courseId, examId });
  if (!publication) examError('Publication not found.', 404);
  if (Date.now() < Date.parse(publication.settings.closesAt)) examError('Wait until the exam closes before releasing answers.');
  await examPublicationsCol().updateOne({ _id: publication._id }, { $set: { releasedAt: new Date() } });
  return { released: true };
}
