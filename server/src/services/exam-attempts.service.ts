import { ObjectId, type WithId } from 'mongodb';
import {
  attemptsCol,
  coursesCol,
  examAttemptsCol,
  examTemplatesCol,
  losCol,
  questionsCol,
  questionVersionsCol,
  themesCol,
} from '../components/mongodb/collections';
import type {
  AttemptRecord,
  ExamAttempt,
  ExamTemplate,
  Question,
  QuestionVersion,
  User,
} from '../types/domain';
import { decideStrategy, upsertReviewBookEntry } from './attempts.service';
import { enqueueExamMasteryPass } from './exam-mastery.service';
import { notifyCourseStaff } from './notifications.service';
import { drawSeed, resolveParamValues, substituteParams } from './params.service';

type QuestionHead = WithId<Question>;
type Version = WithId<QuestionVersion>;

interface Candidate {
  question: QuestionHead;
  version: Version;
  loId: ObjectId;
}

export interface ExamStateQuestion {
  index: number;
  type: QuestionVersion['type'];
  stem: string;
  options: Array<{ key: string; text: string }>;
  points: number;
  answered: boolean;
}

export interface ExamState {
  attemptId: ObjectId;
  templateId: ObjectId;
  kind: ExamTemplate['kind'];
  questions: ExamStateQuestion[];
  answers: Array<string | null>;
  shortfalls: ExamAttempt['shortfalls'];
  startedAt: Date;
  submitted: boolean;
  submittedAt?: Date;
  remainingSeconds?: number;
}

export interface ExamResultBreakdown {
  earned: number;
  possible: number;
  practiceLink?: { courseId: ObjectId; themeId?: ObjectId; loId?: ObjectId };
}

export interface ExamResults {
  attemptId: ObjectId;
  kind: ExamTemplate['kind'];
  submittedAt: Date;
  score: number;
  maxScore: number;
  byTheme: Array<ExamResultBreakdown & { themeId: ObjectId; name: string }>;
  byLo?: Array<ExamResultBreakdown & { loId: ObjectId; themeId: ObjectId; name: string }>;
  questions: Array<{
    index: number;
    questionId: ObjectId;
    questionVersionId: ObjectId;
    themeId: ObjectId;
    loId: ObjectId;
    type: QuestionVersion['type'];
    stem: string;
    options: Array<{
      key: string;
      text: string;
      role: QuestionVersion['options'][number]['role'];
      explanation: string;
      correct: boolean;
    }>;
    selectedKey: string | null;
    correct: boolean;
    points: number;
  }>;
}

export interface ExamHistoryItem {
  attemptId: ObjectId;
  kind: ExamTemplate['kind'];
  date: Date;
  score: number;
  maxScore: number;
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rand() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function expired(attempt: WithId<ExamAttempt>, now = new Date()): boolean {
  if (attempt.submittedAt || attempt.timeLimitMinutes === undefined) return false;
  return now.getTime() >= attempt.startedAt.getTime() + attempt.timeLimitMinutes * 60_000;
}

async function loadBank(
  courseId: ObjectId,
  template: WithId<ExamTemplate>,
): Promise<{ candidates: Candidate[]; versions: Map<string, Version> }> {
  const themeIds = template.themes.map((theme) => theme.themeId);
  const questions = await questionsCol().find({
    courseId,
    state: 'approved',
    themeIds: { $in: themeIds },
  }).toArray();
  const versionIds = questions.map((question) => question.currentVersionId);
  const allLoIds = questions.flatMap((question) => question.loIds);
  const [versionsList, los] = await Promise.all([
    versionIds.length
      ? questionVersionsCol().find({ _id: { $in: versionIds } }).toArray()
      : Promise.resolve([]),
    allLoIds.length
      ? losCol().find({ _id: { $in: allLoIds }, courseId }).toArray()
      : Promise.resolve([]),
  ]);
  const versions = new Map(versionsList.map((version) => [version._id.toHexString(), version]));
  const loById = new Map(los.map((lo) => [lo._id.toHexString(), lo]));
  const candidates: Candidate[] = [];

  for (const question of questions) {
    const version = versions.get(question.currentVersionId.toHexString());
    if (!version) continue;
    for (const themeId of themeIds) {
      if (!question.themeIds.some((id) => id.equals(themeId))) continue;
      const loId = question.loIds.find((id) => loById.get(id.toHexString())?.themeId.equals(themeId));
      if (loId) candidates.push({ question, version, loId });
    }
  }
  return { candidates, versions };
}

async function createAttempt(
  user: User,
  courseId: ObjectId,
  template: WithId<ExamTemplate>,
  rand: () => number,
): Promise<WithId<ExamAttempt>> {
  const { candidates } = await loadBank(courseId, template);
  const selectedIds = new Set<string>();
  const selected: ExamAttempt['questions'] = [];
  const shortfalls: ExamAttempt['shortfalls'] = [];

  for (const config of template.themes) {
    const before = selected.length;
    for (const [type, count] of [
      ['mcq', config.mcqCount],
      ['true-false', config.tfCount],
    ] as const) {
      const pool = candidates.filter((candidate) => (
        candidate.version.type === type
        && candidate.question.themeIds.some((id) => id.equals(config.themeId))
        && !selectedIds.has(candidate.question._id.toHexString())
      ));
      for (const candidate of shuffle(pool, rand).slice(0, count)) {
        const paramValues = await resolveParamValues(candidate.version, drawSeed());
        selectedIds.add(candidate.question._id.toHexString());
        selected.push({
          questionId: candidate.question._id,
          questionVersionId: candidate.version._id,
          loId: candidate.loId,
          themeId: config.themeId,
          points: config.pointsPerQuestion,
          ...(paramValues ? { paramValues } : {}),
        });
      }
    }
    const requested = config.mcqCount + config.tfCount;
    const assembled = selected.length - before;
    if (assembled < requested) shortfalls.push({ themeId: config.themeId, requested, assembled });
  }

  const doc: ExamAttempt = {
    puid: user.puid,
    courseId,
    templateId: template._id,
    templateKind: template.kind,
    ...(template.timeLimitMinutes !== undefined
      ? { timeLimitMinutes: template.timeLimitMinutes }
      : {}),
    loBreakdown: template.loBreakdown,
    questions: selected,
    shortfalls,
    startedAt: new Date(),
    maxScore: selected.reduce((sum, question) => sum + question.points, 0),
  };
  const { insertedId } = await examAttemptsCol().insertOne(doc);
  const attempt: WithId<ExamAttempt> = { _id: insertedId, ...doc };

  if (shortfalls.length > 0) {
    const missing = shortfalls.reduce((sum, item) => sum + item.requested - item.assembled, 0);
    await notifyCourseStaff(courseId, {
      kind: 'review-backlog',
      priority: 'standard',
      body: `${template.kind} Exam Prep attempt assembled with ${missing} question${missing === 1 ? '' : 's'} missing from the configured Approved supply.`,
      refType: 'exam-attempt',
      refId: insertedId,
    });
  }
  return attempt;
}

export async function startExam(
  user: User,
  courseId: ObjectId,
  templateId: ObjectId,
  rand: () => number = Math.random,
): Promise<WithId<ExamAttempt>> {
  const open = await examAttemptsCol().findOne({
    puid: user.puid,
    courseId,
    templateId,
    submittedAt: { $exists: false },
  });
  if (open && !expired(open)) return open;
  if (open) await submitExam(open._id, user.puid, { auto: true });

  const template = await examTemplatesCol().findOne({ _id: templateId, courseId });
  if (!template) throw new Error('exam-template-not-found');
  const now = new Date();
  if (template.availabilityStart > now || template.availabilityEnd < now) {
    throw new Error('exam-template-not-active');
  }
  return createAttempt(user, courseId, template, rand);
}

export async function getExamAttemptCourseId(attemptId: ObjectId): Promise<ObjectId | null> {
  return (await examAttemptsCol().findOne({ _id: attemptId }))?.courseId ?? null;
}

export async function answerQuestion(
  attemptId: ObjectId,
  puid: string,
  index: number,
  selectedKey: string,
): Promise<void> {
  const attempt = await examAttemptsCol().findOne({ _id: attemptId, puid });
  if (!attempt) throw new Error('exam-attempt-not-found');
  if (attempt.submittedAt) throw new Error('exam-already-submitted');
  if (expired(attempt)) {
    await submitExam(attemptId, puid, { auto: true });
    throw new Error('exam-already-submitted');
  }
  const question = attempt.questions[index];
  if (!question) throw new Error('exam-question-not-found');
  const version = await questionVersionsCol().find({ _id: { $in: [question.questionVersionId] } }).toArray();
  if (!version[0]?.options.some((option) => option.key === selectedKey)) {
    throw new Error('invalid-selected-key');
  }
  const updated = await examAttemptsCol().findOneAndUpdate(
    { _id: attemptId, puid, submittedAt: { $exists: false } },
    { $set: { [`questions.${index}.selectedKey`]: selectedKey } },
    { returnDocument: 'after' },
  );
  if (!updated) throw new Error('exam-already-submitted');
}

export async function submitExam(
  attemptId: ObjectId,
  puid: string,
  _opts: { auto?: boolean } = {},
): Promise<{ score: number; maxScore: number }> {
  const attempt = await examAttemptsCol().findOne({ _id: attemptId, puid });
  if (!attempt) throw new Error('exam-attempt-not-found');
  if (attempt.submittedAt) {
    return { score: attempt.score ?? 0, maxScore: attempt.maxScore };
  }
  const versionIds = attempt.questions.map((question) => question.questionVersionId);
  const versions = versionIds.length
    ? await questionVersionsCol().find({ _id: { $in: versionIds } }).toArray()
    : [];
  const versionById = new Map(versions.map((version) => [version._id.toHexString(), version]));
  const course = await coursesCol().findOne({ _id: attempt.courseId });
  if (!course) throw new Error('course-not-found');
  const createdAt = new Date();
  let score = 0;
  const records: Array<AttemptRecord & { _id: ObjectId }> = [];

  for (const question of attempt.questions) {
    const version = versionById.get(question.questionVersionId.toHexString());
    if (!version) throw new Error('exam-version-not-found');
    const selected = version.options.find((option) => option.key === question.selectedKey);
    const correct = selected?.role === 'correct';
    const selectedRole = selected?.role ?? 'clearly-wrong';
    if (correct) score += question.points;
    records.push({
      _id: new ObjectId(),
      puid,
      courseId: attempt.courseId,
      questionId: question.questionId,
      questionVersionId: question.questionVersionId,
      loId: question.loId,
      themeId: question.themeId,
      mode: 'exam-prep',
      strategy: decideStrategy(course.feedbackStrategy, selectedRole),
      selectedKey: question.selectedKey ?? '',
      correct,
      selectedRole,
      difficulty: version.difficulty,
      ...(question.paramValues ? { paramValues: question.paramValues } : {}),
      isRetry: false,
      examAttemptId: attemptId,
      createdAt,
    });
  }

  const submittedAt = new Date();
  const claimed = await examAttemptsCol().findOneAndUpdate(
    { _id: attemptId, puid, submittedAt: { $exists: false } },
    { $set: { score, submittedAt } },
    { returnDocument: 'after' },
  );
  if (!claimed) {
    const latest = await examAttemptsCol().findOne({ _id: attemptId, puid });
    if (!latest?.submittedAt) throw new Error('exam-submit-conflict');
    return { score: latest.score ?? 0, maxScore: latest.maxScore };
  }
  if (records.length > 0) await attemptsCol().insertMany(records);
  for (const record of records) {
    if (record.correct) continue;
    await upsertReviewBookEntry({
      puid: record.puid,
      courseId: record.courseId,
      questionId: record.questionId,
      loId: record.loId,
      themeId: record.themeId,
      attemptId: record._id,
    });
  }
  await enqueueExamMasteryPass(attemptId);
  await examAttemptsCol().updateOne(
    { _id: attemptId, puid },
    { $set: { masteryPassQueuedAt: new Date() } },
  );
  return { score, maxScore: attempt.maxScore };
}

export async function examResults(attemptId: ObjectId, puid: string): Promise<ExamResults> {
  const attempt = await examAttemptsCol().findOne({ _id: attemptId, puid });
  if (!attempt) throw new Error('exam-attempt-not-found');
  if (!attempt.submittedAt) throw new Error('exam-not-submitted');

  const versionIds = attempt.questions.map((question) => question.questionVersionId);
  const themeIds = [...new Map(
    attempt.questions.map((question) => [question.themeId.toHexString(), question.themeId]),
  ).values()];
  const loIds = [...new Map(
    attempt.questions.map((question) => [question.loId.toHexString(), question.loId]),
  ).values()];
  const [versions, themes, los] = await Promise.all([
    versionIds.length
      ? questionVersionsCol().find({ _id: { $in: versionIds } }).toArray()
      : Promise.resolve([]),
    themeIds.length
      ? themesCol().find({ _id: { $in: themeIds }, courseId: attempt.courseId }).toArray()
      : Promise.resolve([]),
    loIds.length
      ? losCol().find({ _id: { $in: loIds }, courseId: attempt.courseId }).toArray()
      : Promise.resolve([]),
  ]);
  const versionById = new Map(versions.map((version) => [version._id.toHexString(), version]));
  const themeName = new Map(themes.map((theme) => [theme._id.toHexString(), theme.name]));
  const loName = new Map(los.map((lo) => [lo._id.toHexString(), lo.name]));
  const themeTotals = new Map<string, ExamResultBreakdown & { themeId: ObjectId; name: string }>();
  const loTotals = new Map<string, ExamResultBreakdown & {
    loId: ObjectId;
    themeId: ObjectId;
    name: string;
  }>();

  const questions = attempt.questions.map((question, index) => {
    const version = versionById.get(question.questionVersionId.toHexString());
    if (!version) throw new Error('exam-version-not-found');
    const selected = version.options.find((option) => option.key === question.selectedKey);
    const correct = selected?.role === 'correct';
    const earned = correct ? question.points : 0;
    const themeKey = question.themeId.toHexString();
    const loKey = question.loId.toHexString();
    const theme = themeTotals.get(themeKey) ?? {
      themeId: question.themeId,
      name: themeName.get(themeKey) ?? 'Unknown Theme',
      earned: 0,
      possible: 0,
    };
    theme.earned += earned;
    theme.possible += question.points;
    themeTotals.set(themeKey, theme);
    const lo = loTotals.get(loKey) ?? {
      loId: question.loId,
      themeId: question.themeId,
      name: loName.get(loKey) ?? 'Unknown Learning Objective',
      earned: 0,
      possible: 0,
    };
    lo.earned += earned;
    lo.possible += question.points;
    loTotals.set(loKey, lo);
    const substitute = (text: string) => question.paramValues
      ? substituteParams(text, question.paramValues)
      : text;
    return {
      index,
      questionId: question.questionId,
      questionVersionId: question.questionVersionId,
      themeId: question.themeId,
      loId: question.loId,
      type: version.type,
      stem: substitute(version.stem),
      options: version.options.map((option) => ({
        key: option.key,
        text: substitute(option.text),
        role: option.role,
        explanation: substitute(option.explanation),
        correct: option.role === 'correct',
      })),
      selectedKey: question.selectedKey ?? null,
      correct,
      points: question.points,
    };
  });
  const byTheme = [...themeTotals.values()].map((item) => ({
    ...item,
    ...(item.earned < item.possible
      ? { practiceLink: { courseId: attempt.courseId, themeId: item.themeId } }
      : {}),
  }));
  const byLo = [...loTotals.values()].map((item) => ({
    ...item,
    ...(item.earned < item.possible
      ? { practiceLink: { courseId: attempt.courseId, loId: item.loId } }
      : {}),
  }));
  return {
    attemptId: attempt._id,
    kind: attempt.templateKind,
    submittedAt: attempt.submittedAt,
    score: attempt.score ?? 0,
    maxScore: attempt.maxScore,
    byTheme,
    ...(attempt.loBreakdown ? { byLo } : {}),
    questions,
  };
}

export async function examHistory(puid: string, courseId: ObjectId): Promise<ExamHistoryItem[]> {
  const attempts = await examAttemptsCol().find({
    puid,
    courseId,
    submittedAt: { $exists: true },
  }).sort({ submittedAt: -1 }).toArray();
  return attempts.flatMap((attempt) => attempt.submittedAt ? [{
    attemptId: attempt._id,
    kind: attempt.templateKind,
    date: attempt.submittedAt,
    score: attempt.score ?? 0,
    maxScore: attempt.maxScore,
  }] : []);
}

export async function examState(attemptId: ObjectId, puid: string): Promise<ExamState> {
  let attempt = await examAttemptsCol().findOne({ _id: attemptId, puid });
  if (!attempt) throw new Error('exam-attempt-not-found');
  if (expired(attempt)) {
    await submitExam(attemptId, puid, { auto: true });
    attempt = await examAttemptsCol().findOne({ _id: attemptId, puid });
    if (!attempt) throw new Error('exam-attempt-not-found');
  }
  const versionIds = attempt.questions.map((question) => question.questionVersionId);
  const versions = versionIds.length
    ? await questionVersionsCol().find({ _id: { $in: versionIds } }).toArray()
    : [];
  const versionById = new Map(versions.map((version) => [version._id.toHexString(), version]));
  const questions = attempt.questions.map((question, index): ExamStateQuestion => {
    const version = versionById.get(question.questionVersionId.toHexString());
    if (!version) throw new Error('exam-version-not-found');
    const substitute = (text: string) => question.paramValues
      ? substituteParams(text, question.paramValues)
      : text;
    return {
      index,
      type: version.type,
      stem: substitute(version.stem),
      options: version.options.map((option) => ({ key: option.key, text: substitute(option.text) })),
      points: question.points,
      answered: question.selectedKey !== undefined,
    };
  });
  const remainingSeconds = attempt.timeLimitMinutes !== undefined && !attempt.submittedAt
    ? Math.max(0, Math.ceil(
        (attempt.startedAt.getTime() + attempt.timeLimitMinutes * 60_000 - Date.now()) / 1000,
      ))
    : undefined;
  return {
    attemptId: attempt._id,
    templateId: attempt.templateId,
    kind: attempt.templateKind,
    questions,
    answers: attempt.questions.map((question) => question.selectedKey ?? null),
    shortfalls: attempt.shortfalls,
    startedAt: attempt.startedAt,
    submitted: attempt.submittedAt !== undefined,
    ...(attempt.submittedAt ? { submittedAt: attempt.submittedAt } : {}),
    ...(remainingSeconds !== undefined ? { remainingSeconds } : {}),
  };
}
