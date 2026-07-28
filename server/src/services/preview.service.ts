import { ObjectId, type WithId } from 'mongodb';
import {
  coursesCol,
  losCol,
  materialsCol,
  previewAttemptsCol,
  previewStudentSessionsCol,
  questionsCol,
  questionVersionsCol,
  themesCol,
} from '../components/mongodb/collections';
import type {
  AttemptRecord,
  LearningObjective,
  MasteryProfile,
  MasteryStatus,
  PracticeMode,
  PreviewAttemptRecord,
  PreviewReviewBookEntry,
  QuestionVersion,
  Theme,
} from '../types/domain';
import { gradeAnswer, type AttemptResult } from './attempts.service';
import { flagQuestion } from './flags.service';
import { computeProfile } from './mastery.service';
import { drawSeed, resolveParamValues, substituteParams } from './params.service';
import { getRedirectMaterialSource, hasRepeatedFailureCluster } from './progression.service';
import {
  selectPreviewQuestion,
  selectPreviewRetryQuestion,
  type SelectResult,
} from './serving.service';

const PREVIEW_PUID = 'anonymous-preview';
const MASTERY_WINDOW = 10;

export interface PreviewContext {
  instructorPuid: string;
  previewSessionId: string;
}

export interface PreviewHomeLo {
  lo: WithId<LearningObjective>;
  status: MasteryStatus;
  approvedCount: number;
}

export interface PreviewHomeTheme {
  theme: WithId<Theme>;
  available: true;
  los: PreviewHomeLo[];
}

export interface PreviewQuestion {
  questionId: string;
  questionVersionId: string;
  type: QuestionVersion['type'];
  stem: string;
  difficulty: QuestionVersion['difficulty'];
  degraded: SelectResult['degraded'];
  options: Array<{ key: string; text: string }>;
  watermark: string;
  paramValues?: Record<string, number>;
  seed?: number;
}

export interface PreviewReviewBookGroup {
  theme: WithId<Theme>;
  entries: Array<{
    _id: ObjectId;
    puid: typeof PREVIEW_PUID;
    courseId: ObjectId;
    questionId: ObjectId;
    sources: Array<'auto' | 'bookmark'>;
    triggeringAttemptId: ObjectId;
    loId: ObjectId;
    themeId: ObjectId;
    addedAt: Date;
    updatedAt: Date;
    question: { stem: string; type: string; difficulty: string };
  }>;
}

export interface PreviewSessionEndSummary {
  losCovered: string[];
  questionsAttempted: number;
  accuracyByLo: Array<{ loId: string; attempted: number; correct: number; accuracy: number }>;
  reviewBookAdditions: Array<{ entryId: string; questionId: string; loId: string; themeId: string }>;
  missedQuestions: string[];
}

function sessionFilter(courseId: ObjectId, context: PreviewContext) {
  return {
    courseId,
    instructorPuid: context.instructorPuid,
    previewSessionId: context.previewSessionId,
  };
}

async function ensurePreviewSession(courseId: ObjectId, context: PreviewContext): Promise<void> {
  const now = new Date();
  await previewStudentSessionsCol().updateOne(
    sessionFilter(courseId, context),
    {
      $set: { updatedAt: now },
      $setOnInsert: {
        ...sessionFilter(courseId, context),
        reviewBookEntries: [],
        flags: [],
        createdAt: now,
      },
    },
    { upsert: true },
  );
}

async function assertPreviewLo(courseId: ObjectId, loId: ObjectId): Promise<WithId<LearningObjective>> {
  const lo = await losCol().findOne({ _id: loId, courseId, archivedAt: { $exists: false } });
  if (!lo) throw new Error('lo-not-available');
  const theme = await themesCol().findOne({
    _id: lo.themeId,
    courseId,
    archivedAt: { $exists: false },
  });
  if (!theme || (theme.availableFrom && theme.availableFrom > new Date())) {
    throw new Error('lo-not-available');
  }
  return lo;
}

async function sanitizeQuestion(
  selected: SelectResult,
  watermarkUid: string,
): Promise<PreviewQuestion> {
  const seed = drawSeed();
  const paramValues = await resolveParamValues(selected.version, seed);
  return {
    questionId: selected.question._id.toHexString(),
    questionVersionId: selected.version._id.toHexString(),
    type: selected.version.type,
    stem: paramValues
      ? substituteParams(selected.version.stem, paramValues)
      : selected.version.stem,
    difficulty: selected.version.difficulty,
    degraded: selected.degraded,
    options: selected.version.options.map((option) => ({
      key: option.key,
      text: paramValues ? substituteParams(option.text, paramValues) : option.text,
    })),
    watermark: watermarkUid,
    ...(paramValues !== undefined ? { paramValues, seed } : {}),
  };
}

function asAttempt(record: WithId<PreviewAttemptRecord>): AttemptRecord {
  return {
    puid: PREVIEW_PUID,
    courseId: record.courseId,
    questionId: record.questionId,
    questionVersionId: record.questionVersionId,
    loId: record.loId,
    themeId: record.themeId,
    mode: record.mode,
    strategy: record.strategy,
    selectedKey: record.selectedKey,
    correct: record.correct,
    selectedRole: record.selectedRole,
    difficulty: record.difficulty,
    ...(record.paramValues !== undefined ? { paramValues: record.paramValues } : {}),
    isRetry: record.isRetry,
    createdAt: record.createdAt,
  };
}

function replayProfile(records: Array<WithId<PreviewAttemptRecord>>): MasteryProfile | null {
  let prior: MasteryProfile | null = null;
  let window: AttemptRecord[] = [];
  for (const record of records) {
    window = [...window, asAttempt(record)].slice(-MASTERY_WINDOW);
    prior = computeProfile(window, prior);
  }
  return prior;
}

async function previewAttempts(
  courseId: ObjectId,
  context: PreviewContext,
  loId?: ObjectId,
): Promise<Array<WithId<PreviewAttemptRecord>>> {
  return previewAttemptsCol()
    .find({
      ...sessionFilter(courseId, context),
      ...(loId ? { loId } : {}),
    })
    .sort({ createdAt: 1 })
    .toArray();
}

async function previewStatuses(
  courseId: ObjectId,
  context?: PreviewContext,
): Promise<Map<string, MasteryStatus>> {
  const statuses = new Map<string, MasteryStatus>();
  if (!context) return statuses;
  const attempts = await previewAttempts(courseId, context);
  const byLo = new Map<string, Array<WithId<PreviewAttemptRecord>>>();
  for (const attempt of attempts) {
    const key = attempt.loId.toHexString();
    byLo.set(key, [...(byLo.get(key) ?? []), attempt]);
  }
  for (const [loId, records] of byLo) {
    statuses.set(loId, replayProfile(records)?.status ?? 'not-attempted');
  }
  return statuses;
}

/**
 * Student-visible hierarchy for preview. Course publication is intentionally
 * ignored, while question publication and progressive release match the real
 * student home. Statuses are computed only from this anonymous preview
 * session's isolated attempts.
 */
export async function getPreviewHome(
  courseId: ObjectId,
  context?: PreviewContext,
): Promise<PreviewHomeTheme[]> {
  if (context) await ensurePreviewSession(courseId, context);
  const [course, themes, los, approvedQuestions, statuses] = await Promise.all([
    coursesCol().findOne({ _id: courseId }),
    themesCol().find({ courseId, archivedAt: { $exists: false } }).toArray(),
    losCol().find({ courseId, archivedAt: { $exists: false } }).toArray(),
    questionsCol().find({ courseId, state: 'approved' }).toArray(),
    previewStatuses(courseId, context),
  ]);
  if (!course) throw new Error('course-not-found');

  const approvedCountByLo = new Map<string, number>();
  for (const question of approvedQuestions) {
    for (const id of question.loIds) {
      const key = id.toHexString();
      approvedCountByLo.set(key, (approvedCountByLo.get(key) ?? 0) + 1);
    }
  }

  const now = new Date();
  const home: PreviewHomeTheme[] = [];
  for (const theme of themes.sort((a, b) => a.order - b.order)) {
    if (theme.availableFrom && theme.availableFrom > now) continue;
    const visibleLos = los
      .filter((lo) => lo.themeId.equals(theme._id))
      .sort((a, b) => a.order - b.order)
      .flatMap((lo): PreviewHomeLo[] => {
        const approvedCount = approvedCountByLo.get(lo._id.toHexString()) ?? 0;
        return approvedCount === 0
          ? []
          : [{
              lo,
              status: statuses.get(lo._id.toHexString()) ?? 'not-attempted',
              approvedCount,
            }];
      });
    if (visibleLos.length > 0) home.push({ theme, available: true, los: visibleLos });
  }
  return home;
}

export async function getNextPreviewQuestion(input: PreviewContext & {
  courseId: ObjectId;
  loId: ObjectId;
  sessionServedIds: ObjectId[];
  watermarkUid: string;
}): Promise<PreviewQuestion> {
  await ensurePreviewSession(input.courseId, input);
  await assertPreviewLo(input.courseId, input.loId);
  const profile = replayProfile(await previewAttempts(input.courseId, input, input.loId));
  const selected = await selectPreviewQuestion({
    courseId: input.courseId,
    loId: input.loId,
    sessionServedIds: input.sessionServedIds,
    tier: profile?.currentTier ?? 'easy',
  });
  if (!selected) throw new Error('no-question-available');
  return sanitizeQuestion(selected, input.watermarkUid);
}

async function updatePreviewReviewBook(
  courseId: ObjectId,
  context: PreviewContext,
  updater: (entries: PreviewReviewBookEntry[]) => PreviewReviewBookEntry[],
): Promise<void> {
  await ensurePreviewSession(courseId, context);
  const current = await previewStudentSessionsCol().findOne(sessionFilter(courseId, context));
  const next = updater(current?.reviewBookEntries ?? []);
  await previewStudentSessionsCol().updateOne(
    sessionFilter(courseId, context),
    { $set: { reviewBookEntries: next, updatedAt: new Date() } },
  );
}

async function addMissToPreviewReviewBook(
  courseId: ObjectId,
  context: PreviewContext,
  attempt: WithId<PreviewAttemptRecord>,
): Promise<boolean> {
  const session = await previewStudentSessionsCol().findOne(sessionFilter(courseId, context));
  const existing = session?.reviewBookEntries.find((entry) => entry.questionId.equals(attempt.questionId));
  const now = new Date();
  await updatePreviewReviewBook(courseId, context, (entries) => {
    if (!existing) {
      return [...entries, {
        _id: new ObjectId(),
        questionId: attempt.questionId,
        sources: ['auto'],
        triggeringAttemptId: attempt._id,
        loId: attempt.loId,
        themeId: attempt.themeId,
        addedAt: now,
        updatedAt: now,
      }];
    }
    return entries.map((entry) => entry._id.equals(existing._id)
      ? {
          ...entry,
          sources: entry.sources.includes('auto') ? entry.sources : [...entry.sources, 'auto'],
          triggeringAttemptId: attempt._id,
          loId: attempt.loId,
          themeId: attempt.themeId,
          updatedAt: now,
        }
      : entry);
  });
  return !existing;
}

async function previewRedirect(
  courseId: ObjectId,
  context: PreviewContext,
  loId: ObjectId,
  threshold: number,
): Promise<AttemptResult['redirect']> {
  const recent = (await previewAttempts(courseId, context, loId)).reverse();
  if (!hasRepeatedFailureCluster(recent, threshold)) return undefined;
  const materials = await materialsCol()
    .find({
      courseId,
      status: 'ready',
      assignments: { $elemMatch: { loId } },
    })
    .sort({ uploadedAt: -1 })
    .toArray();
  return {
    materials: materials.map((material) => ({
      name: material.name,
      materialId: material._id.toHexString(),
    })),
    message: materials.length > 0
      ? 'A quick review of these course materials may help before you continue.'
      : 'Take a short pause and review this learning objective, then continue when you are ready.',
  };
}

export async function submitPreviewAttempt(input: PreviewContext & {
  courseId: ObjectId;
  questionVersionId: ObjectId;
  loId: ObjectId;
  mode: PracticeMode;
  selectedKey: string;
  sessionServedIds: ObjectId[];
  isRetry?: boolean;
  paramValues?: Record<string, number>;
}): Promise<AttemptResult> {
  await ensurePreviewSession(input.courseId, input);
  const [version, lo, course, priorRecords] = await Promise.all([
    questionVersionsCol().findOne({ _id: input.questionVersionId }),
    assertPreviewLo(input.courseId, input.loId),
    coursesCol().findOne({ _id: input.courseId }),
    previewAttempts(input.courseId, input, input.loId),
  ]);
  if (!version || !course) throw new Error('question-not-servable');

  const question = await questionsCol().findOne({
    _id: version.questionId,
    courseId: input.courseId,
    state: 'approved',
  });
  if (!question || !question.loIds.some((id) => id.equals(input.loId))) {
    throw new Error('question-not-servable');
  }

  const graded = gradeAnswer(
    version.options,
    input.selectedKey,
    course.feedbackStrategy,
    input.paramValues,
  );
  const attemptId = new ObjectId();
  const record: WithId<PreviewAttemptRecord> = {
    _id: attemptId,
    instructorPuid: input.instructorPuid,
    previewSessionId: input.previewSessionId,
    preview: true,
    courseId: input.courseId,
    questionId: question._id,
    questionVersionId: version._id,
    loId: input.loId,
    themeId: lo.themeId,
    mode: input.mode,
    strategy: graded.appliedStrategy,
    selectedKey: input.selectedKey,
    correct: graded.correct,
    selectedRole: graded.selectedOption.role,
    difficulty: version.difficulty,
    ...(input.paramValues !== undefined ? { paramValues: input.paramValues } : {}),
    isRetry: input.isRetry ?? false,
    versionSnapshot: {
      version: version.version,
      type: version.type,
      stem: version.stem,
      options: version.options,
      difficulty: version.difficulty,
    },
    createdAt: new Date(),
  };
  const priorStatus = replayProfile(priorRecords)?.status ?? 'not-attempted';
  await previewAttemptsCol().insertOne(record);
  const profile = replayProfile([...priorRecords, record]);

  let reviewBookAdded = false;
  let redirect: AttemptResult['redirect'];
  if (!graded.correct) {
    reviewBookAdded = await addMissToPreviewReviewBook(input.courseId, input, record);
    redirect = await previewRedirect(
      input.courseId,
      input,
      input.loId,
      course.redirectFailureThreshold ?? 3,
    );
  }

  let recommendation: 'advance-lo' | 'advance-theme' | undefined;
  if (priorStatus !== 'covered' && profile?.status === 'covered') {
    const home = await getPreviewHome(input.courseId, input);
    const group = home.find((candidate) => candidate.theme._id.equals(lo.themeId));
    recommendation = group?.los.every((entry) => entry.status === 'covered')
      ? 'advance-theme'
      : 'advance-lo';
  }

  let revealed = redirect
    ? graded.chosenReveal
    : graded.correct || graded.appliedStrategy === 'b'
      ? graded.fullReveal
      : graded.chosenReveal;
  let retry: AttemptResult['feedback']['retry'];

  if (!redirect && !graded.correct && graded.appliedStrategy === 'a') {
    const selected = await selectPreviewRetryQuestion({
      courseId: input.courseId,
      loId: input.loId,
      excludeQuestionId: question._id,
      sessionServedIds: input.sessionServedIds,
      tier: profile?.currentTier ?? 'easy',
    });
    if (selected) {
      const sanitized = await sanitizeQuestion(selected, '');
      retry = {
        questionId: sanitized.questionId,
        questionVersionId: sanitized.questionVersionId,
        type: sanitized.type,
        stem: sanitized.stem,
        options: sanitized.options,
        ...(sanitized.paramValues !== undefined
          ? { paramValues: sanitized.paramValues, seed: sanitized.seed }
          : {}),
      };
    } else {
      revealed = graded.fullReveal;
    }
  }

  return {
    correct: graded.correct,
    feedback: {
      strategy: graded.appliedStrategy,
      revealed,
      ...(retry ? { retry } : {}),
    },
    mastery: {
      loStatus: profile?.status ?? 'not-attempted',
      ...(recommendation ? { recommendation } : {}),
    },
    reviewBook: { added: reviewBookAdded },
    ...(redirect ? { redirect } : {}),
  };
}

export async function flagPreviewQuestion(
  courseId: ObjectId,
  context: PreviewContext,
  questionId: ObjectId,
  reason?: string,
  sendToInstructorQueue = false,
): Promise<{ flagged: true; testQueued: boolean }> {
  await ensurePreviewSession(courseId, context);
  const question = await questionsCol().findOne({ _id: questionId, courseId, state: 'approved' });
  if (!question) throw new Error('question-not-servable');
  const session = await previewStudentSessionsCol().findOne(sessionFilter(courseId, context));
  if (!session?.flags.some((flag) => flag.questionId.equals(questionId))) {
    await previewStudentSessionsCol().updateOne(
      sessionFilter(courseId, context),
      {
        $push: {
          flags: {
            questionId,
            ...(reason?.trim() ? { reason: reason.trim() } : {}),
            createdAt: new Date(),
          },
        },
        $set: { updatedAt: new Date() },
      },
    );
  }
  if (sendToInstructorQueue) {
    await flagQuestion({
      puid: context.instructorPuid,
      questionId,
      source: 'instructor-preview-test',
      ...(reason?.trim() ? { reason: reason.trim() } : {}),
    });
  }
  return { flagged: true, testQueued: sendToInstructorQueue };
}

export async function listPreviewReviewBook(
  courseId: ObjectId,
  context: PreviewContext,
  sort: 'theme' | 'date',
): Promise<PreviewReviewBookGroup[]> {
  await ensurePreviewSession(courseId, context);
  const session = await previewStudentSessionsCol().findOne(sessionFilter(courseId, context));
  const entries = session?.reviewBookEntries ?? [];
  if (entries.length === 0) return [];

  const questionIds = entries.map((entry) => entry.questionId);
  const themeIds = entries.map((entry) => entry.themeId);
  const attemptIds = entries.map((entry) => entry.triggeringAttemptId);
  const [questions, themes, attempts] = await Promise.all([
    questionsCol().find({ _id: { $in: questionIds } }).toArray(),
    themesCol().find({ _id: { $in: themeIds } }).toArray(),
    previewAttemptsCol().find({ _id: { $in: attemptIds } }).toArray(),
  ]);
  const versions = await questionVersionsCol()
    .find({ _id: { $in: questions.map((question) => question.currentVersionId) } })
    .toArray();
  const questionById = new Map(questions.map((question) => [question._id.toHexString(), question]));
  const versionById = new Map(versions.map((version) => [version._id.toHexString(), version]));
  const attemptById = new Map(attempts.map((attempt) => [attempt._id.toHexString(), attempt]));
  const groups = new Map<string, PreviewReviewBookGroup>();
  const sortedEntries = [...entries].sort((a, b) =>
    sort === 'date' ? b.addedAt.getTime() - a.addedAt.getTime() : 0);

  for (const entry of sortedEntries) {
    const theme = themes.find((candidate) => candidate._id.equals(entry.themeId));
    const question = questionById.get(entry.questionId.toHexString());
    const version = question ? versionById.get(question.currentVersionId.toHexString()) : undefined;
    if (!theme || !question || !version) continue;
    const attempt = attemptById.get(entry.triggeringAttemptId.toHexString());
    const stem = attempt?.paramValues
      ? substituteParams(version.stem, attempt.paramValues)
      : version.stem;
    const key = theme._id.toHexString();
    const group = groups.get(key) ?? { theme, entries: [] };
    group.entries.push({
      ...entry,
      puid: PREVIEW_PUID,
      courseId,
      question: { stem, type: version.type, difficulty: version.difficulty },
    });
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.theme.order - b.theme.order);
}

export async function togglePreviewBookmark(
  courseId: ObjectId,
  context: PreviewContext,
  questionId: ObjectId,
  bookmarked: boolean,
): Promise<{ bookmarked: boolean }> {
  await ensurePreviewSession(courseId, context);
  const attempts = await previewAttemptsCol()
    .find({ ...sessionFilter(courseId, context), questionId })
    .sort({ createdAt: -1 })
    .limit(1)
    .toArray();
  const attempt = attempts[0];
  if (!attempt) throw new Error('no-attempt-context');
  const session = await previewStudentSessionsCol().findOne(sessionFilter(courseId, context));
  const existing = session?.reviewBookEntries.find((entry) => entry.questionId.equals(questionId));
  const now = new Date();

  await updatePreviewReviewBook(courseId, context, (entries) => {
    if (bookmarked && !existing) {
      return [...entries, {
        _id: new ObjectId(),
        questionId,
        sources: ['bookmark'],
        triggeringAttemptId: attempt._id,
        loId: attempt.loId,
        themeId: attempt.themeId,
        addedAt: now,
        updatedAt: now,
      }];
    }
    if (!existing) return entries;
    const sources: Array<'auto' | 'bookmark'> = bookmarked
      ? [...new Set<Array<'auto' | 'bookmark'>[number]>([
          ...existing.sources,
          'bookmark',
        ])]
      : existing.sources.filter((source) => source !== 'bookmark');
    if (sources.length === 0) return entries.filter((entry) => !entry._id.equals(existing._id));
    return entries.map((entry) => entry._id.equals(existing._id)
      ? { ...entry, sources, updatedAt: now }
      : entry);
  });
  return { bookmarked };
}

export async function removePreviewReviewBookEntry(
  courseId: ObjectId,
  context: PreviewContext,
  entryId: ObjectId,
): Promise<void> {
  await updatePreviewReviewBook(
    courseId,
    context,
    (entries) => entries.filter((entry) => !entry._id.equals(entryId)),
  );
}

export async function skipPreviewLo(
  courseId: ObjectId,
  context: PreviewContext,
  loId: ObjectId,
): Promise<void> {
  await Promise.all([
    ensurePreviewSession(courseId, context),
    assertPreviewLo(courseId, loId),
  ]);
}

export async function getPreviewSessionSummary(
  courseId: ObjectId,
  context: PreviewContext,
  since?: Date,
): Promise<PreviewSessionEndSummary> {
  await ensurePreviewSession(courseId, context);
  const attempts = (await previewAttempts(courseId, context))
    .filter((attempt) => !since || attempt.createdAt >= since);
  const byLo = new Map<string, { attempted: number; correct: number }>();
  for (const attempt of attempts) {
    const key = attempt.loId.toHexString();
    const current = byLo.get(key) ?? { attempted: 0, correct: 0 };
    current.attempted += 1;
    if (attempt.correct) current.correct += 1;
    byLo.set(key, current);
  }
  const statuses = await previewStatuses(courseId, context);
  const session = await previewStudentSessionsCol().findOne(sessionFilter(courseId, context));
  const entries = (session?.reviewBookEntries ?? []).filter((entry) => !since || entry.addedAt >= since);
  return {
    losCovered: [...statuses.entries()]
      .filter(([, status]) => status === 'covered')
      .map(([loId]) => loId),
    questionsAttempted: attempts.length,
    accuracyByLo: [...byLo.entries()].map(([loId, value]) => ({
      loId,
      ...value,
      accuracy: value.attempted === 0 ? 0 : value.correct / value.attempted,
    })),
    reviewBookAdditions: entries.map((entry) => ({
      entryId: entry._id.toHexString(),
      questionId: entry.questionId.toHexString(),
      loId: entry.loId.toHexString(),
      themeId: entry.themeId.toHexString(),
    })),
    missedQuestions: [...new Set(
      attempts.filter((attempt) => !attempt.correct).map((attempt) => attempt.questionId.toHexString()),
    )],
  };
}

export async function getPreviewSessionStart(
  courseId: ObjectId,
  context: PreviewContext,
): Promise<{ welcome: boolean; deferred?: PreviewSessionEndSummary }> {
  const summary = await getPreviewSessionSummary(courseId, context);
  return summary.questionsAttempted === 0
    ? { welcome: true }
    : { welcome: false, deferred: summary };
}

export async function getPreviewRedirectMaterialSource(
  courseId: ObjectId,
  loId: ObjectId,
  materialId: ObjectId,
) {
  return getRedirectMaterialSource(courseId, loId, materialId);
}
