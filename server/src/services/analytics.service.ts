import type { ObjectId } from 'mongodb';
import {
  attemptsCol,
  flagsCol,
  losCol,
  masteryCol,
  questionVersionsCol,
  questionsCol,
  reviewBookCol,
  themesCol,
  usersCol,
} from '../components/mongodb/collections';
import type { AttemptRecord, PracticeMode } from '../types/domain';

export const ANALYTICS_MIN_ATTEMPTS = 5;
const SESSION_GAP_MS = 30 * 60 * 1000;

export interface RateMetric {
  attempts: number;
  insufficient: boolean;
  failureRate?: number;
}

function rate(attempts: number, misses: number): RateMetric {
  return attempts < ANALYTICS_MIN_ATTEMPTS
    ? { attempts, insufficient: true }
    : { attempts, insufficient: false, failureRate: misses / attempts };
}

export type AnalyticsMode = Extract<PracticeMode, 'topic-practice' | 'exam-prep'>;
export interface AnalyticsFilter { from?: Date; to?: Date; loId?: ObjectId; mode?: AnalyticsMode }
function attemptFilter(courseId: ObjectId, filter: AnalyticsFilter): Record<string, unknown> {
  return { courseId, ...(filter.mode ? { mode: filter.mode } : {}),
    ...(filter.loId ? { loId: filter.loId } : {}),
    ...(filter.from || filter.to ? { createdAt: {
      ...(filter.from ? { $gte: filter.from } : {}), ...(filter.to ? { $lte: filter.to } : {}),
    } } : {}),
  };
}

export async function failureRates(courseId: ObjectId, mode: AnalyticsMode, filter: AnalyticsFilter = {}): Promise<Array<RateMetric & {
  themeId: string; name: string; los: Array<RateMetric & { loId: string; name: string }>;
}>> {
  const [rows, themes, los] = await Promise.all([
    attemptsCol().aggregate<{ _id: { themeId: ObjectId; loId: ObjectId }; attempts: number; misses: number }>([
      { $match: attemptFilter(courseId, { ...filter, mode }) },
      { $group: { _id: { themeId: '$themeId', loId: '$loId' }, attempts: { $sum: 1 }, misses: { $sum: { $cond: ['$correct', 0, 1] } } } },
    ]).toArray(),
    themesCol().find({ courseId, archivedAt: { $exists: false } }).sort({ order: 1 }).toArray(),
    losCol().find({ courseId, archivedAt: { $exists: false } }).sort({ order: 1 }).toArray(),
  ]);
  // Attribute each attempt to its recorded objective once, using the active hierarchy.
  return themes.map((theme) => {
    const objectives = los.filter((lo) => lo.themeId.equals(theme._id) && (!filter.loId || lo._id.equals(filter.loId))).map((lo) => {
      const evidence = rows.filter((row) => row._id.loId.equals(lo._id));
      return { loId: lo._id.toHexString(), name: lo.name,
        attempts: evidence.reduce((n, row) => n + row.attempts, 0), misses: evidence.reduce((n, row) => n + row.misses, 0) };
    });
    return { themeId: theme._id.toHexString(), name: theme.name,
      ...rate(objectives.reduce((n, lo) => n + lo.attempts, 0), objectives.reduce((n, lo) => n + lo.misses, 0)),
      los: objectives.map((lo) => ({ loId: lo.loId, name: lo.name, ...rate(lo.attempts, lo.misses) })),
    };
  }).filter((theme) => !filter.loId || theme.los.length > 0);
}

export interface QuestionPattern extends RateMetric {
  questionId: string; versionId: string; stem: string; loId: string; loName: string;
  themeId: string; themeName: string; misconceptionRate?: number;
  version?: number; isCurrent: boolean; available: boolean; objectiveCount: number;
}
export async function questionPatterns(courseId: ObjectId, filter: AnalyticsFilter, limit = 20): Promise<{ items: QuestionPattern[]; total: number; limit: number }> {
  const [result] = await attemptsCol().aggregate<{
    items: Array<{ _id: { questionId: ObjectId; versionId: ObjectId }; loId: ObjectId; themeId: ObjectId; objectiveIds: ObjectId[]; attempts: number; misses: number; misconceptions: number }>;
    count: Array<{ total: number }>;
  }>([
    { $match: attemptFilter(courseId, filter) },
    { $group: { _id: { questionId: '$questionId', versionId: '$questionVersionId' },
      loId: { $first: '$loId' }, themeId: { $first: '$themeId' }, objectiveIds: { $addToSet: '$loId' }, attempts: { $sum: 1 },
      misses: { $sum: { $cond: ['$correct', 0, 1] } },
      misconceptions: { $sum: { $cond: [{ $eq: ['$selectedRole', 'common-misconception'] }, 1, 0] } },
    } },
    { $sort: { attempts: -1, '_id.questionId': 1, '_id.versionId': 1 } },
    { $facet: { items: [{ $limit: limit }], count: [{ $count: 'total' }] } },
  ]).toArray();
  const rows = result?.items ?? [];
  const [questions, los, themes] = await Promise.all([
    questionsCol().find({ courseId, _id: { $in: rows.map((row) => row._id.questionId) } }).toArray(),
    losCol().find({ courseId, _id: { $in: rows.map((row) => row.loId) } }).toArray(),
    themesCol().find({ courseId, _id: { $in: rows.map((row) => row.themeId) } }).toArray(),
  ]);
  const versions = await questionVersionsCol().find({
    questionId: { $in: questions.map((question) => question._id) },
    _id: { $in: rows.map((row) => row._id.versionId) },
  }).toArray();
  return { total: result?.count[0]?.total ?? 0, limit, items: rows.map((row) => {
    const question = questions.find((item) => item._id.equals(row._id.questionId));
    const version = versions.find((item) => item._id.equals(row._id.versionId) && item.questionId.equals(row._id.questionId));
    const lo = los.find((item) => item._id.equals(row.loId));
    const theme = themes.find((item) => item._id.equals(row.themeId));
    return { questionId: row._id.questionId.toHexString(), versionId: row._id.versionId?.toHexString() ?? '',
      stem: version?.stem ?? 'Historical question content unavailable', loId: row.loId.toHexString(),
      loName: lo ? `${lo.name}${lo.archivedAt ? ' (archived)' : ''}` : 'Historical objective',
      themeId: row.themeId.toHexString(), themeName: theme?.name ?? 'Historical theme',
      ...rate(row.attempts, row.misses), objectiveCount: row.objectiveIds?.length ?? 1,
      ...(row.attempts >= ANALYTICS_MIN_ATTEMPTS ? { misconceptionRate: row.misconceptions / row.attempts } : {}),
      ...(version ? { version: version.version } : {}), available: !!version,
      isCurrent: !!question?.currentVersionId.equals(row._id.versionId),
    };
  }) };
}

export async function answerDistributions(courseId: ObjectId, questionId: ObjectId, filter: AnalyticsFilter & { versionId?: ObjectId } = {}): Promise<{
  questionId: string; versionId: string; version: number; stem: string; isCurrent: boolean;
  attempts: number; insufficient: boolean;
  options: Array<{ key: string; text: string; role: string; count: number; pct?: number }>;
  misconceptionHighlight: boolean;
}> {
  const question = await questionsCol().findOne({ _id: questionId, courseId });
  if (!question) throw new Error('question-not-found');
  const versionId = filter.versionId ?? question.currentVersionId;
  const version = await questionVersionsCol().findOne({ _id: versionId, questionId });
  if (!version) throw new Error('question-version-not-found');
  const rows = await attemptsCol().aggregate<{ _id: { key: string; role: string }; count: number }>([
    { $match: { ...attemptFilter(courseId, filter), questionId, questionVersionId: versionId } },
    { $group: { _id: { key: '$selectedKey', role: '$selectedRole' }, count: { $sum: 1 } } },
  ]).toArray();
  const attempts = rows.reduce((sum, row) => sum + row.count, 0);
  const insufficient = attempts < ANALYTICS_MIN_ATTEMPTS;
  const options = version.options.map((option) => {
    const count = rows.filter((row) => row._id.key === option.key).reduce((sum, row) => sum + row.count, 0);
    return { key: option.key, text: option.text, role: option.role, count, ...(insufficient ? {} : { pct: count / attempts }) };
  });
  const uniform = options.length ? 1 / options.length : 1;
  const misconceptionShare = attempts ? rows.filter((row) => row._id.role === 'common-misconception').reduce((sum, row) => sum + row.count, 0) / attempts : 0;
  return { questionId: questionId.toHexString(), versionId: versionId.toHexString(), version: version.version,
    stem: version.stem, isCurrent: question.currentVersionId.equals(versionId), attempts, insufficient, options,
    misconceptionHighlight: !insufficient && misconceptionShare > 1.5 * uniform };
}

export interface SessionCluster {
  puid: string;
  startedAt: Date;
  endedAt: Date;
  attempts: number;
}

export function clusterSessions(attempts: Array<Pick<AttemptRecord, 'puid' | 'createdAt'>>): SessionCluster[] {
  const sorted = [...attempts].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const latest = new Map<string, SessionCluster>();
  const sessions: SessionCluster[] = [];
  for (const attempt of sorted) {
    let session = latest.get(attempt.puid);
    if (!session || attempt.createdAt.getTime() - session.endedAt.getTime() > SESSION_GAP_MS) {
      session = { puid: attempt.puid, startedAt: attempt.createdAt, endedAt: attempt.createdAt, attempts: 0 };
      sessions.push(session);
      latest.set(attempt.puid, session);
    }
    session.endedAt = attempt.createdAt;
    session.attempts += 1;
  }
  return sessions;
}

function weekStart(date: Date): string {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - day.getUTCDay());
  return day.toISOString().slice(0, 10);
}

export async function engagement(courseId: ObjectId, range: { from: Date; to: Date; mode?: AnalyticsMode }): Promise<{
  totals: { questionsAttempted: number; avgSessionMinutes: number; sessionsPerStudent: number; loCoverageRate: number; reviewBookActivityRate: number };
  weeks: Array<{ week: string; questionsAttempted: number; sessions: number; activeStudents: number; avgSessionMinutes: number; loCoverageRate: number; reviewBookActivityRate: number }>;
}> {
  const [attempts, reviewEntries, activeLos] = await Promise.all([
    attemptsCol().find(attemptFilter(courseId, range)).sort({ createdAt: 1 }).toArray(),
    reviewBookCol().find({ courseId, addedAt: { $gte: range.from, $lte: range.to } }).toArray(),
    losCol().find({ courseId, archivedAt: { $exists: false } }).toArray(),
  ]);
  const activeLoIds = new Set(activeLos.map((lo) => lo._id.toHexString()));
  const loCount = activeLoIds.size;
  const coverage = (items: typeof attempts): number => loCount ? new Set(items.map((item) => item.loId.toHexString()).filter((id) => activeLoIds.has(id))).size / loCount : 0;
  const sessions = clusterSessions(attempts);
  const activeStudents = new Set(attempts.map((attempt) => attempt.puid));
  const average = (values: number[]): number => values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
  const sessionMinutes = sessions.map((session) =>
    (session.endedAt.getTime() - session.startedAt.getTime()) / 60_000,
  );
  const byWeek = new Map<string, typeof attempts>();
  for (const attempt of attempts) {
    const key = weekStart(attempt.createdAt);
    byWeek.set(key, [...(byWeek.get(key) ?? []), attempt]);
  }
  // A bounded selected range includes weeks with no activity. All-time begins at first evidence.
  const first = range.from.getTime() === 0 ? (attempts[0]?.createdAt ?? range.to) : range.from;
  for (let date = new Date(weekStart(first)); date <= range.to; date = new Date(date.getTime() + 7 * 86_400_000)) {
    if (!byWeek.has(weekStart(date))) byWeek.set(weekStart(date), []);
  }
  const weeks = [...byWeek].sort(([a], [b]) => a.localeCompare(b)).map(([week, weekAttempts]) => {
    const weekSessions = clusterSessions(weekAttempts);
    const students = new Set(weekAttempts.map((attempt) => attempt.puid));
    const bookStudents = new Set(reviewEntries.filter((entry) => weekStart(entry.addedAt) === week).map((entry) => entry.puid));
    return {
      week,
      questionsAttempted: weekAttempts.length,
      sessions: weekSessions.length,
      activeStudents: students.size,
      avgSessionMinutes: average(weekSessions.map((session) => (session.endedAt.getTime() - session.startedAt.getTime()) / 60_000)),
      loCoverageRate: coverage(weekAttempts),
      reviewBookActivityRate: students.size ? [...bookStudents].filter((puid) => students.has(puid)).length / students.size : 0,
    };
  });
  return {
    totals: {
      questionsAttempted: attempts.length,
      avgSessionMinutes: average(sessionMinutes),
      sessionsPerStudent: activeStudents.size ? sessions.length / activeStudents.size : 0,
      loCoverageRate: coverage(attempts),
      reviewBookActivityRate: activeStudents.size
        ? new Set(reviewEntries.filter((entry) => activeStudents.has(entry.puid)).map((entry) => entry.puid)).size / activeStudents.size
        : 0,
    },
    weeks,
  };
}

export async function lowEngagement(courseId: ObjectId, inactiveDays: number, now = new Date()): Promise<Array<{
  puid: string; uid: string; displayName: string; email: string; lastAttemptAt?: Date; inactiveDays: number;
}>> {
  const students = await usersCol().find({ courseRoles: { $elemMatch: { courseId, role: 'student' } } }).toArray();
  const puids = students.map((student) => student.puid);
  const recent = puids.length
    ? await attemptsCol().aggregate<{ _id: string; lastAttemptAt: Date }>([
        { $match: { courseId, puid: { $in: puids } } },
        { $group: { _id: '$puid', lastAttemptAt: { $max: '$createdAt' } } },
      ]).toArray()
    : [];
  const lastByPuid = new Map(recent.map((row) => [row._id, row.lastAttemptAt]));
  return students.flatMap((student) => {
    const lastAttemptAt = lastByPuid.get(student.puid);
    const days = lastAttemptAt
      ? Math.floor((now.getTime() - lastAttemptAt.getTime()) / 86_400_000)
      : Number.POSITIVE_INFINITY;
    return days >= inactiveDays ? [{
      puid: student.puid,
      uid: student.uid,
      displayName: student.displayName,
      email: student.email,
      ...(lastAttemptAt ? { lastAttemptAt } : {}),
      inactiveDays: days,
    }] : [];
  });
}

export async function searchStudents(courseId: ObjectId, query: string): Promise<Array<{
  puid: string; uid: string; displayName: string; email: string;
}>> {
  const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = escaped ? new RegExp(escaped, 'i') : /.*/;
  const users = await usersCol().find({
    courseRoles: { $elemMatch: { courseId, role: 'student' } },
    $or: [{ uid: match }, { displayName: match }, { email: match }],
  }).sort({ displayName: 1 }).limit(50).toArray();
  return users.map(({ puid, uid, displayName, email }) => ({ puid, uid, displayName, email }));
}

export async function studentProfile(courseId: ObjectId, puid: string): Promise<Record<string, unknown>> {
  const user = await usersCol().findOne({
    puid,
    courseRoles: { $elemMatch: { courseId, role: 'student' } },
  });
  if (!user) throw new Error('student-not-found');
  const [history, mastery, reviewBook, flags] = await Promise.all([
    attemptsCol().find({ courseId, puid }).sort({ createdAt: 1 }).toArray(),
    masteryCol().find({ courseId, puid }).toArray(),
    reviewBookCol().find({ courseId, puid }).sort({ updatedAt: -1 }).toArray(),
    flagsCol().find({ courseId, puid }).sort({ createdAt: -1 }).toArray(),
  ]);
  const sessions = clusterSessions(history);
  return {
    student: { puid: user.puid, uid: user.uid, displayName: user.displayName, email: user.email },
    history,
    mastery,
    reviewBook,
    flags,
    engagement: {
      attempts: history.length,
      sessions: sessions.length,
      lastAttemptAt: history.at(-1)?.createdAt,
      examPrepAttempts: history.filter((attempt) => attempt.mode === 'exam-prep').length,
      topicPracticeAttempts: history.filter((attempt) => attempt.mode === 'topic-practice').length,
    },
  };
}

export function csvSerialize(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '';
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const escape = (value: unknown): string => {
    const text = value === undefined || value === null ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [columns.map(escape).join(','), ...rows.map((row) => columns.map((column) => escape(row[column])).join(','))].join('\r\n');
}
