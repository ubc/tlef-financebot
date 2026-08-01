import type { ObjectId, WithId } from 'mongodb';
import {
  examTemplatesCol,
  questionsCol,
  questionVersionsCol,
  themesCol,
} from '../components/mongodb/collections';
import type { ExamTemplate, QuestionType } from '../types/domain';

export type ExamTemplateInput = Omit<ExamTemplate, 'courseId' | 'updatedAt'>;

export interface ExamTemplateSupplyWarning {
  themeId: ObjectId;
  themeName: string;
  requested: number;
  available: number;
}

export interface SaveExamTemplateResult {
  template: WithId<ExamTemplate>;
  warnings: ExamTemplateSupplyWarning[];
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function validateTemplateInput(input: ExamTemplateInput): void {
  if (input.kind !== 'midterm' && input.kind !== 'final') {
    throw new Error('exam-template-invalid-kind');
  }
  if (!Array.isArray(input.themes) || input.themes.length === 0) {
    throw new Error('exam-template-themes-required');
  }
  const themeIds = new Set<string>();
  for (const theme of input.themes) {
    if (
      !Number.isInteger(theme.mcqCount)
      || theme.mcqCount < 0
      || !Number.isInteger(theme.tfCount)
      || theme.tfCount < 0
      || theme.mcqCount + theme.tfCount === 0
    ) {
      throw new Error('exam-template-invalid-counts');
    }
    if (!Number.isFinite(theme.pointsPerQuestion) || theme.pointsPerQuestion <= 0) {
      throw new Error('exam-template-invalid-points');
    }
    const key = theme.themeId.toHexString();
    if (themeIds.has(key)) throw new Error('exam-template-duplicate-theme');
    themeIds.add(key);
  }
  if (
    input.timeLimitMinutes !== undefined
    && (!Number.isInteger(input.timeLimitMinutes) || input.timeLimitMinutes <= 0)
  ) {
    throw new Error('exam-template-invalid-time-limit');
  }
  if (
    !validDate(input.availabilityStart)
    || !validDate(input.availabilityEnd)
    || input.availabilityEnd < input.availabilityStart
  ) {
    throw new Error('exam-template-invalid-availability');
  }
  if (typeof input.loBreakdown !== 'boolean') {
    throw new Error('exam-template-invalid-lo-breakdown');
  }
}

async function supplyWarnings(
  courseId: ObjectId,
  input: ExamTemplateInput,
): Promise<ExamTemplateSupplyWarning[]> {
  const requestedThemeIds = input.themes.map((theme) => theme.themeId);
  const themeDocs = await themesCol().find({
    _id: { $in: requestedThemeIds },
    courseId,
    archivedAt: { $exists: false },
  }).toArray();
  if (themeDocs.length !== requestedThemeIds.length) {
    throw new Error('exam-template-theme-not-in-course');
  }

  const approved = await questionsCol().find({
    courseId,
    state: 'approved',
    themeIds: { $in: requestedThemeIds },
  }).toArray();
  const versionIds = approved.map((question) => question.currentVersionId);
  const versions = versionIds.length
    ? await questionVersionsCol().find({ _id: { $in: versionIds } }).toArray()
    : [];
  const typeByVersion = new Map(
    versions.map((version) => [version._id.toHexString(), version.type] as const),
  );
  const nameByTheme = new Map(
    themeDocs.map((theme) => [theme._id.toHexString(), theme.name] as const),
  );

  const warnings: ExamTemplateSupplyWarning[] = [];
  for (const requested of input.themes) {
    const counts: Record<QuestionType, number> = { mcq: 0, 'true-false': 0 };
    for (const question of approved) {
      if (!question.themeIds.some((id) => id.equals(requested.themeId))) continue;
      const type = typeByVersion.get(question.currentVersionId.toHexString());
      if (type) counts[type] += 1;
    }
    const requestedTotal = requested.mcqCount + requested.tfCount;
    const availableForSplit = Math.min(requested.mcqCount, counts.mcq)
      + Math.min(requested.tfCount, counts['true-false']);
    if (availableForSplit < requestedTotal) {
      warnings.push({
        themeId: requested.themeId,
        themeName: nameByTheme.get(requested.themeId.toHexString()) ?? 'Unknown Theme',
        requested: requestedTotal,
        available: availableForSplit,
      });
    }
  }
  return warnings;
}

export async function saveTemplate(
  courseId: ObjectId,
  input: ExamTemplateInput,
): Promise<SaveExamTemplateResult> {
  validateTemplateInput(input);
  const warnings = await supplyWarnings(courseId, input);
  const updatedAt = new Date();
  const template = await examTemplatesCol().findOneAndUpdate(
    { courseId, kind: input.kind },
    {
      $set: {
        courseId,
        kind: input.kind,
        themes: input.themes,
        ...(input.timeLimitMinutes !== undefined
          ? { timeLimitMinutes: input.timeLimitMinutes }
          : {}),
        availabilityStart: input.availabilityStart,
        availabilityEnd: input.availabilityEnd,
        loBreakdown: input.loBreakdown,
        updatedAt,
      },
      ...(input.timeLimitMinutes === undefined
        ? { $unset: { timeLimitMinutes: '' } }
        : {}),
    },
    { upsert: true, returnDocument: 'after' },
  );
  if (!template) throw new Error('exam-template-save-failed');
  return { template, warnings };
}

export async function listTemplates(courseId: ObjectId): Promise<Array<WithId<ExamTemplate>>> {
  return examTemplatesCol().find({ courseId }).sort({ kind: 1 }).toArray();
}

export async function activeTemplates(
  courseId: ObjectId,
  now = new Date(),
): Promise<Array<WithId<ExamTemplate>>> {
  return examTemplatesCol().find({
    courseId,
    availabilityStart: { $lte: now },
    availabilityEnd: { $gte: now },
  }).sort({ kind: 1 }).toArray();
}
