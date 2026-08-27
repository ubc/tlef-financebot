import type { Collection, Document, IndexSpecification, CreateIndexesOptions } from 'mongodb';
import { getDb } from './index';
import type {
  User, PlatformInstructorGrant, Course, Theme, LearningObjective, Question, QuestionVersion, AttemptRecord,
  PreviewAttemptRecord, PreviewStudentSession,
  Material, MaterialChunk, MasteryProfile, ReviewBookEntry, ExamTemplate, ExamAttempt, Flag,
  Notification, AuditLog, RosterEntry, SessionSummaryRecord, LmsRosterEntry,
  ContentRun,
  GenerationBlueprint, CapabilitySettings, TaInvite, PlatformSettings,
} from '../../types/domain';

// Central, typed access to every collection (PRD §2 Data Model). Services must
// import these accessors instead of calling getDb().collection() with strings.

export const usersCol = (): Collection<User> => getDb().collection<User>('users');
export const platformInstructorGrantsCol = (): Collection<PlatformInstructorGrant> =>
  getDb().collection<PlatformInstructorGrant>('platformInstructorPuidGrants');
export const coursesCol = (): Collection<Course> => getDb().collection<Course>('courses');
export const themesCol = (): Collection<Theme> => getDb().collection<Theme>('themes');
export const losCol = (): Collection<LearningObjective> => getDb().collection<LearningObjective>('learningObjectives');
export const questionsCol = (): Collection<Question> => getDb().collection<Question>('questions');
export const questionVersionsCol = (): Collection<QuestionVersion> => getDb().collection<QuestionVersion>('questionVersions');
export const attemptsCol = (): Collection<AttemptRecord> => getDb().collection<AttemptRecord>('attemptRecords');
export const previewAttemptsCol = (): Collection<PreviewAttemptRecord> =>
  getDb().collection<PreviewAttemptRecord>('previewAttemptRecords');
export const previewStudentSessionsCol = (): Collection<PreviewStudentSession> =>
  getDb().collection<PreviewStudentSession>('previewStudentSessions');
export const materialsCol = (): Collection<Material> => getDb().collection<Material>('materials');
export const materialChunksCol = (): Collection<MaterialChunk> => getDb().collection<MaterialChunk>('materialChunks');
export const masteryCol = (): Collection<MasteryProfile> => getDb().collection<MasteryProfile>('masteryProfiles');
export const reviewBookCol = (): Collection<ReviewBookEntry> => getDb().collection<ReviewBookEntry>('reviewBookEntries');
export const examTemplatesCol = (): Collection<ExamTemplate> => getDb().collection<ExamTemplate>('examTemplates');
export const examAttemptsCol = (): Collection<ExamAttempt> => getDb().collection<ExamAttempt>('examAttempts');
export const flagsCol = (): Collection<Flag> => getDb().collection<Flag>('flags');
export const notificationsCol = (): Collection<Notification> => getDb().collection<Notification>('notifications');
export const auditCol = (): Collection<AuditLog> => getDb().collection<AuditLog>('auditLogs');
export const rosterCol = (): Collection<RosterEntry> => getDb().collection<RosterEntry>('rosterEntries');
export const lmsRosterEntriesCol = (): Collection<LmsRosterEntry> => getDb().collection<LmsRosterEntry>('lmsRosterEntries'); // Phase 6
export const sessionSummariesCol = (): Collection<SessionSummaryRecord> => getDb().collection<SessionSummaryRecord>('sessionSummaries');
export const contentRunsCol = (): Collection<ContentRun> => getDb().collection<ContentRun>('contentRuns');
export const generationBlueprintsCol = (): Collection<GenerationBlueprint> =>
  getDb().collection<GenerationBlueprint>('generationBlueprints');
export const capabilitySettingsCol = (): Collection<CapabilitySettings> =>
  getDb().collection<CapabilitySettings>('capabilitySettings');
export const taInvitesCol = (): Collection<TaInvite> => getDb().collection<TaInvite>('taInvites');
export const platformSettingsCol = (): Collection<PlatformSettings> =>
  getDb().collection<PlatformSettings>('platformSettings');

export interface IndexSpec {
  collection: string;
  keys: IndexSpecification;
  options?: CreateIndexesOptions;
}

/** Exported for tests; applied by ensureIndexes(). */
export const INDEX_SPECS: IndexSpec[] = [
  { collection: 'users', keys: { puid: 1 }, options: { unique: true } },
  { collection: 'platformInstructorPuidGrants', keys: { puid: 1 }, options: { unique: true } },
  { collection: 'courses', keys: { registrationCode: 1 }, options: { unique: true } },
  {
    collection: 'courses',
    keys: { identityKey: 1 },
    options: {
      unique: true,
      partialFilterExpression: { identityKey: { $type: 'string' } },
    },
  },
  { collection: 'themes', keys: { courseId: 1, order: 1 } },
  { collection: 'learningObjectives', keys: { courseId: 1, themeId: 1, order: 1 } },
  { collection: 'questions', keys: { courseId: 1, state: 1 } },
  { collection: 'questions', keys: { loIds: 1 } },
  { collection: 'questionVersions', keys: { questionId: 1, version: 1 }, options: { unique: true } },
  { collection: 'attemptRecords', keys: { puid: 1, courseId: 1, loId: 1, createdAt: -1 } },
  { collection: 'attemptRecords', keys: { questionVersionId: 1 } },
  { collection: 'previewAttemptRecords', keys: { instructorPuid: 1, courseId: 1, previewSessionId: 1, createdAt: -1 } },
  { collection: 'previewAttemptRecords', keys: { questionVersionId: 1 } },
  { collection: 'previewAttemptRecords', keys: { createdAt: 1 }, options: { expireAfterSeconds: 86_400 } },
  {
    collection: 'previewStudentSessions',
    keys: { instructorPuid: 1, courseId: 1, previewSessionId: 1 },
    options: { unique: true },
  },
  { collection: 'previewStudentSessions', keys: { updatedAt: 1 }, options: { expireAfterSeconds: 86_400 } },
  { collection: 'materials', keys: { courseId: 1, uploadedAt: -1 } },
  { collection: 'materialChunks', keys: { materialId: 1, index: 1 }, options: { unique: true } },
  { collection: 'materialChunks', keys: { courseId: 1, materialId: 1 } },
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
  { collection: 'contentRuns', keys: { courseId: 1, createdAt: -1 } },
  { collection: 'contentRuns', keys: { courseId: 1, kind: 1, status: 1, createdAt: -1 } },
  { collection: 'generationBlueprints', keys: { courseId: 1, name: 1 }, options: { unique: true } },
  { collection: 'generationBlueprints', keys: { courseId: 1, updatedAt: -1 } },
  {
    collection: 'examAttempts',
    keys: { puid: 1, courseId: 1, templateId: 1, open: 1 },
    options: {
      unique: true,
      partialFilterExpression: { open: true },
    },
  },
  { collection: 'capabilitySettings', keys: { scope: 1, courseId: 1 }, options: { unique: true } },
  { collection: 'taInvites', keys: { courseId: 1, email: 1 }, options: { unique: true } },
  { collection: 'taInvites', keys: { status: 1, email: 1 } },
  // Phase 6: one import per Canvas file per course. Name and filter are fixed
  // once deployed — MongoDB refuses startup if a partial filter changes under
  // the same index name.
  {
    collection: 'materials',
    keys: { courseId: 1, 'origin.provider': 1, 'origin.externalCourseId': 1, 'origin.externalFileId': 1 },
    options: { unique: true, partialFilterExpression: { 'origin.provider': { $type: 'string' } }, name: 'materials_origin_unique' },
  },
];

/** Idempotent: createIndex is a no-op when the index already exists. Called
 * once during startup, after connectMongo(). */
export async function ensureIndexes(): Promise<void> {
  for (const spec of INDEX_SPECS) {
    await getDb().collection<Document>(spec.collection).createIndex(spec.keys, spec.options ?? {});
  }
}
