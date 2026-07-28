import type { ObjectId, WithId } from 'mongodb';
import {
  coursesCol,
  losCol,
  previewAttemptsCol,
  questionsCol,
  questionVersionsCol,
  themesCol,
} from '../components/mongodb/collections';
import type {
  LearningObjective,
  MasteryStatus,
  PreviewAttemptRecord,
  QuestionVersion,
  Theme,
} from '../types/domain';
import { gradeAnswer, type AttemptResult } from './attempts.service';
import { drawSeed, resolveParamValues, substituteParams } from './params.service';
import {
  selectPreviewQuestion,
  selectPreviewRetryQuestion,
  type SelectResult,
} from './serving.service';

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

/**
 * Student-visible hierarchy for preview. Course publication is intentionally
 * ignored, while question publication and progressive release match the real
 * student home.
 */
export async function getPreviewHome(courseId: ObjectId): Promise<PreviewHomeTheme[]> {
  const [course, themes, los, approvedQuestions] = await Promise.all([
    coursesCol().findOne({ _id: courseId }),
    themesCol().find({ courseId, archivedAt: { $exists: false } }).toArray(),
    losCol().find({ courseId, archivedAt: { $exists: false } }).toArray(),
    questionsCol().find({ courseId, state: 'approved' }).toArray(),
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
          : [{ lo, status: 'not-attempted', approvedCount }];
      });
    if (visibleLos.length > 0) home.push({ theme, available: true, los: visibleLos });
  }
  return home;
}

export async function getNextPreviewQuestion(input: {
  courseId: ObjectId;
  loId: ObjectId;
  sessionServedIds: ObjectId[];
  watermarkUid: string;
}): Promise<PreviewQuestion> {
  await assertPreviewLo(input.courseId, input.loId);
  const selected = await selectPreviewQuestion({
    courseId: input.courseId,
    loId: input.loId,
    sessionServedIds: input.sessionServedIds,
  });
  if (!selected) throw new Error('no-question-available');
  return sanitizeQuestion(selected, input.watermarkUid);
}

export async function submitPreviewAttempt(input: {
  instructorPuid: string;
  courseId: ObjectId;
  questionVersionId: ObjectId;
  loId: ObjectId;
  selectedKey: string;
  sessionServedIds: ObjectId[];
  isRetry?: boolean;
  paramValues?: Record<string, number>;
}): Promise<AttemptResult> {
  const [version, lo, course] = await Promise.all([
    questionVersionsCol().findOne({ _id: input.questionVersionId }),
    assertPreviewLo(input.courseId, input.loId),
    coursesCol().findOne({ _id: input.courseId }),
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
  const record: PreviewAttemptRecord = {
    instructorPuid: input.instructorPuid,
    preview: true,
    courseId: input.courseId,
    questionId: question._id,
    questionVersionId: version._id,
    loId: input.loId,
    themeId: lo.themeId,
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
  await previewAttemptsCol().insertOne(record);

  let revealed = graded.correct || graded.appliedStrategy === 'b'
    ? graded.fullReveal
    : graded.chosenReveal;
  let retry: AttemptResult['feedback']['retry'];

  if (!graded.correct && graded.appliedStrategy === 'a') {
    const selected = await selectPreviewRetryQuestion({
      courseId: input.courseId,
      loId: input.loId,
      excludeQuestionId: question._id,
      sessionServedIds: input.sessionServedIds,
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
    mastery: { loStatus: 'not-attempted' },
    reviewBook: { added: false },
  };
}
