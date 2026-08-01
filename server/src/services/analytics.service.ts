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

export async function failureRates(courseId: ObjectId, mode: Extract<PracticeMode, 'topic-practice' | 'exam-prep'>): Promise<Array<RateMetric & {
  themeId: string;
  name: string;
  los: Array<RateMetric & { loId: string; name: string }>;
}>> {
  const rows = await attemptsCol().aggregate<{
    _id: { themeId: ObjectId; loId: ObjectId };
    attempts: number;
    misses: number;
  }>([
    { $match: { courseId, mode } },
    { $group: {
      _id: { themeId: '$themeId', loId: '$loId' },
      attempts: { $sum: 1 },
      misses: { $sum: { $cond: ['$correct', 0, 1] } },
    } },
  ]).toArray();
  const [themes, los] = await Promise.all([
    themesCol().find({ courseId }).sort({ order: 1 }).toArray(),
    losCol().find({ courseId }).sort({ order: 1 }).toArray(),
  ]);
  const loName = new Map(los.map((lo) => [lo._id.toHexString(), lo.name]));
  const byTheme = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row._id.themeId.toHexString();
    byTheme.set(key, [...(byTheme.get(key) ?? []), row]);
  }
  return themes.map((theme) => {
    const themeId = theme._id.toHexString();
    const themeRows = byTheme.get(themeId) ?? [];
    const attempts = themeRows.reduce((sum, row) => sum + row.attempts, 0);
    const misses = themeRows.reduce((sum, row) => sum + row.misses, 0);
    return {
      themeId,
      name: theme.name,
      ...rate(attempts, misses),
      los: themeRows.map((row) => ({
        loId: row._id.loId.toHexString(),
        name: loName.get(row._id.loId.toHexString()) ?? 'Unknown LO',
        ...rate(row.attempts, row.misses),
      })),
    };
  });
}

export async function answerDistributions(courseId: ObjectId, questionId: ObjectId): Promise<{
  attempts: number;
  insufficient: boolean;
  options: Array<{ key: string; role: string; count: number; pct?: number }>;
  misconceptionHighlight: boolean;
}> {
  const question = await questionsCol().findOne({ _id: questionId, courseId });
  if (!question) throw new Error('question-not-found');
  const [version, rows] = await Promise.all([
    questionVersionsCol().findOne({ _id: question.currentVersionId }),
    attemptsCol().aggregate<{ _id: { key: string; role: string }; count: number }>([
      { $match: { courseId, questionId } },
      { $group: { _id: { key: '$selectedKey', role: '$selectedRole' }, count: { $sum: 1 } } },
    ]).toArray(),
  ]);
  const attempts = rows.reduce((sum, row) => sum + row.count, 0);
  const insufficient = attempts < ANALYTICS_MIN_ATTEMPTS;
  const countByKey = new Map(rows.map((row) => [row._id.key, row]));
  const options = (version?.options ?? []).map((option) => {
    const count = countByKey.get(option.key)?.count ?? 0;
    return {
      key: option.key,
      role: option.role,
      count,
      ...(insufficient ? {} : { pct: count / attempts }),
    };
  });
  const uniform = options.length ? 1 / options.length : 1;
  const misconceptionShare = attempts
    ? rows.filter((row) => row._id.role === 'common-misconception')
        .reduce((sum, row) => sum + row.count, 0) / attempts
    : 0;
  return {
    attempts,
    insufficient,
    options,
    misconceptionHighlight: !insufficient && misconceptionShare > 1.5 * uniform,
  };
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

export async function engagement(courseId: ObjectId, range: { from: Date; to: Date }): Promise<{
  totals: { questionsAttempted: number; avgSessionMinutes: number; sessionsPerStudent: number; loCoverageRate: number; reviewBookActivityRate: number };
  weeks: Array<{ week: string; questionsAttempted: number; sessions: number; activeStudents: number; avgSessionMinutes: number; loCoverageRate: number; reviewBookActivityRate: number }>;
}> {
  const [attempts, reviewEntries, loCount] = await Promise.all([
    attemptsCol().find({ courseId, createdAt: { $gte: range.from, $lte: range.to } }).sort({ createdAt: 1 }).toArray(),
    reviewBookCol().find({ courseId, addedAt: { $gte: range.from, $lte: range.to } }).toArray(),
    losCol().countDocuments({ courseId, archivedAt: { $exists: false } }),
  ]);
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
      loCoverageRate: loCount ? new Set(weekAttempts.map((attempt) => attempt.loId.toHexString())).size / loCount : 0,
      reviewBookActivityRate: students.size ? bookStudents.size / students.size : 0,
    };
  });
  return {
    totals: {
      questionsAttempted: attempts.length,
      avgSessionMinutes: average(sessionMinutes),
      sessionsPerStudent: activeStudents.size ? sessions.length / activeStudents.size : 0,
      loCoverageRate: loCount ? new Set(attempts.map((attempt) => attempt.loId.toHexString())).size / loCount : 0,
      reviewBookActivityRate: activeStudents.size
        ? new Set(reviewEntries.map((entry) => entry.puid)).size / activeStudents.size
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
