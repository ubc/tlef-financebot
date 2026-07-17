import type { Collection, Document, IndexSpecification, CreateIndexesOptions } from 'mongodb';
import { getDb } from './index';
import type {
  User, Course, Theme, LearningObjective, Question, QuestionVersion, AttemptRecord,
  Material, MasteryProfile, ReviewBookEntry, ExamTemplate, ExamAttempt, Flag,
  Notification, AuditLog, RosterEntry, SessionSummaryRecord,
} from '../../types/domain';

// Central, typed access to every collection (PRD §2 Data Model). Services must
// import these accessors instead of calling getDb().collection() with strings.

export const usersCol = (): Collection<User> => getDb().collection<User>('users');
export const coursesCol = (): Collection<Course> => getDb().collection<Course>('courses');
export const themesCol = (): Collection<Theme> => getDb().collection<Theme>('themes');
export const losCol = (): Collection<LearningObjective> => getDb().collection<LearningObjective>('learningObjectives');
export const questionsCol = (): Collection<Question> => getDb().collection<Question>('questions');
export const questionVersionsCol = (): Collection<QuestionVersion> => getDb().collection<QuestionVersion>('questionVersions');
export const attemptsCol = (): Collection<AttemptRecord> => getDb().collection<AttemptRecord>('attemptRecords');
export const materialsCol = (): Collection<Material> => getDb().collection<Material>('materials');
export const masteryCol = (): Collection<MasteryProfile> => getDb().collection<MasteryProfile>('masteryProfiles');
export const reviewBookCol = (): Collection<ReviewBookEntry> => getDb().collection<ReviewBookEntry>('reviewBookEntries');
export const examTemplatesCol = (): Collection<ExamTemplate> => getDb().collection<ExamTemplate>('examTemplates');
export const examAttemptsCol = (): Collection<ExamAttempt> => getDb().collection<ExamAttempt>('examAttempts');
export const flagsCol = (): Collection<Flag> => getDb().collection<Flag>('flags');
export const notificationsCol = (): Collection<Notification> => getDb().collection<Notification>('notifications');
export const auditCol = (): Collection<AuditLog> => getDb().collection<AuditLog>('auditLogs');
export const rosterCol = (): Collection<RosterEntry> => getDb().collection<RosterEntry>('rosterEntries');
export const sessionSummariesCol = (): Collection<SessionSummaryRecord> => getDb().collection<SessionSummaryRecord>('sessionSummaries');

export interface IndexSpec {
  collection: string;
  keys: IndexSpecification;
  options?: CreateIndexesOptions;
}

/** Exported for tests; applied by ensureIndexes(). */
export const INDEX_SPECS: IndexSpec[] = [
  { collection: 'users', keys: { puid: 1 }, options: { unique: true } },
  { collection: 'courses', keys: { registrationCode: 1 }, options: { unique: true } },
  { collection: 'themes', keys: { courseId: 1, order: 1 } },
  { collection: 'learningObjectives', keys: { courseId: 1, themeId: 1, order: 1 } },
  { collection: 'questions', keys: { courseId: 1, state: 1 } },
  { collection: 'questions', keys: { loIds: 1 } },
  { collection: 'questionVersions', keys: { questionId: 1, version: 1 }, options: { unique: true } },
  { collection: 'attemptRecords', keys: { puid: 1, courseId: 1, loId: 1, createdAt: -1 } },
  { collection: 'attemptRecords', keys: { questionVersionId: 1 } },
  { collection: 'materials', keys: { courseId: 1, uploadedAt: -1 } },
  { collection: 'masteryProfiles', keys: { puid: 1, courseId: 1, loId: 1 }, options: { unique: true } },
  { collection: 'reviewBookEntries', keys: { puid: 1, courseId: 1, questionId: 1 }, options: { unique: true } },
  { collection: 'examTemplates', keys: { courseId: 1, kind: 1 } },
  { collection: 'examAttempts', keys: { puid: 1, courseId: 1, startedAt: -1 } },
  { collection: 'flags', keys: { questionVersionId: 1, state: 1 } },
  { collection: 'flags', keys: { courseId: 1, state: 1 } },
  { collection: 'notifications', keys: { recipientPuid: 1, createdAt: -1 } },
  { collection: 'auditLogs', keys: { courseId: 1, createdAt: -1 } },
  { collection: 'rosterEntries', keys: { courseId: 1, identifier: 1 }, options: { unique: true } },
  { collection: 'sessionSummaries', keys: { puid: 1, courseId: 1 }, options: { unique: true } },
];

/** Idempotent: createIndex is a no-op when the index already exists. Called
 * once during startup, after connectMongo(). */
export async function ensureIndexes(): Promise<void> {
  for (const spec of INDEX_SPECS) {
    await getDb().collection<Document>(spec.collection).createIndex(spec.keys, spec.options ?? {});
  }
}
