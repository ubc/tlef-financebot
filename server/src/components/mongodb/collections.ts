import type { CoursePeopleAccess } from '../../types/course-people';
import type { ModelCallReceipt, ModelUsageSession } from '../../types/model-usage';
import type { BuilderExam, ExamPublication, ExamCandidate, ExamBuildRun, AssessmentAttempt } from '../../types/exam-builder';
import type { CoursePeopleImport } from '../../types/people-import';
import type { CourseRegistrationCodeBatch } from '../../types/registration-code';
import type { OperationEvent } from '../../types/domain';
import type { CourseInstructorShare } from '../../types/course-sharing';
import type { QuestionDraft, QuestionPresence } from '../../types/collaboration';
import type { Collection, Document, ObjectId, IndexSpecification, CreateIndexesOptions } from 'mongodb';
import { getDb } from './index';
import type {
  User, PlatformInstructorGrant, Course, Theme, LearningObjective, Question, QuestionVersion, AttemptRecord,
  PreviewAttemptRecord, PreviewStudentSession,
  Material, MaterialChunk, MasteryProfile, ReviewBookEntry, ExamTemplate, ExamAttempt, Flag,
  Notification, AuditLog, RosterEntry, SessionSummaryRecord,
  ContentRun,
  GenerationBlueprint, CapabilitySettings, TaInvite, PlatformSettings,
  TutorialProgress,
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
export const sessionSummariesCol = (): Collection<SessionSummaryRecord> => getDb().collection<SessionSummaryRecord>('sessionSummaries');
export const contentRunsCol = (): Collection<ContentRun> => getDb().collection<ContentRun>('contentRuns');
export const generationBlueprintsCol = (): Collection<GenerationBlueprint> =>
  getDb().collection<GenerationBlueprint>('generationBlueprints');
export const capabilitySettingsCol = (): Collection<CapabilitySettings> =>
  getDb().collection<CapabilitySettings>('capabilitySettings');
export const taInvitesCol = (): Collection<TaInvite> => getDb().collection<TaInvite>('taInvites');
export const platformSettingsCol = (): Collection<PlatformSettings> =>
  getDb().collection<PlatformSettings>('platformSettings');
export const tutorialProgressCol = (): Collection<TutorialProgress> =>
  getDb().collection<TutorialProgress>('tutorialProgress');

export const operationEventsCol = (): Collection<OperationEvent> => getDb().collection<OperationEvent>('operationEvents');
export const courseInstructorSharesCol = (): Collection<CourseInstructorShare> =>
  getDb().collection<CourseInstructorShare>('courseInstructorShares');
export const coursePeopleImportsCol = (): Collection<CoursePeopleImport> =>
  getDb().collection<CoursePeopleImport>('coursePeopleImports');
export const questionDraftsCol = (): Collection<QuestionDraft> => getDb().collection<QuestionDraft>('questionDrafts');
export const questionPresenceCol = (): Collection<QuestionPresence> => getDb().collection<QuestionPresence>('questionPresence');

export const modelCallReceiptsCol = (): Collection<ModelCallReceipt> => getDb().collection<ModelCallReceipt>('modelCallReceipts');
export const modelUsageSessionsCol = (): Collection<ModelUsageSession> => getDb().collection<ModelUsageSession>('modelUsageSessions');
export const registrationCodeBatchesCol = (): Collection<CourseRegistrationCodeBatch> => getDb().collection<CourseRegistrationCodeBatch>('courseRegistrationCodeBatches');

export interface IndexSpec {
  collection: string;
  keys: IndexSpecification;
  options?: CreateIndexesOptions;
}

/** Exported for tests; applied by ensureIndexes(). */
export const INDEX_SPECS: IndexSpec[] = [
  { collection: 'courseRegistrationCodeBatches', keys: { 'codes.code': 1 }, options: { unique: true } },
  { collection: 'courseRegistrationCodeBatches', keys: { courseId: 1, requestId: 1 }, options: { unique: true } },
  { collection: 'courseRegistrationCodeBatches', keys: { 'codes.claimedByPuid': 1, 'codes.status': 1 } },
  { collection: 'courseRegistrationCodeBatches', keys: { courseId: 1, createdAt: -1 } },
  { collection: 'modelCallReceipts', keys: { courseId: 1, runId: 1, startedAt: -1 } },
  { collection: 'modelCallReceipts', keys: { operationId: 1, startedAt: -1 } },
  { collection: 'modelCallReceipts', keys: { 'actor.puid': 1, startedAt: -1 } },
  { collection: 'modelUsageSessions', keys: { courseId: 1, runId: 1 } },
  { collection: 'modelUsageSessions', keys: { operationId: 1 } },
  { collection: 'modelUsageSessions', keys: { 'actor.puid': 1, startedAt: -1 } },
  { collection: 'coursePeopleImports', keys: { 'members.puid': 1 } },
  { collection: 'questionDrafts', keys: { questionId: 1 }, options: { unique: true } },
  { collection: 'questionPresence', keys: { questionId: 1, clientId: 1, puid: 1 }, options: { unique: true } },
  { collection: 'questionPresence', keys: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } },
  { collection: 'courseInstructorShares', keys: { courseId: 1, email: 1 }, options: { unique: true } },
  { collection: 'courseInstructorShares', keys: { status: 1, recipientPuid: 1 } },
  { collection: 'courseInstructorShares', keys: { status: 1, email: 1 } },
  { collection: 'operationEvents', keys: { requestId: 1 }, options: { unique: true } },
  { collection: 'operationEvents', keys: { createdAt: -1, _id: -1 } },
  { collection: 'operationEvents', keys: { 'actor.puid': 1, createdAt: -1 } },
  { collection: 'operationEvents', keys: { outcome: 1, createdAt: -1 } },
  { collection: 'operationEvents', keys: { 'targets.courseId': 1, createdAt: -1 } },
  { collection: 'contentRuns', keys: { operationId: 1 } },
  { collection: 'contentRuns', keys: { requestedBy: 1, createdAt: -1 } },

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
  { collection: 'contentRuns', keys: { courseId: 1, kind: 1 }, options: { unique: true, name: 'one_active_structure_run', partialFilterExpression: { kind: 'structure-generation', status: { $in: ['queued', 'running'] } } } },
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
  {
    collection: 'tutorialProgress',
    keys: { puid: 1, role: 1, tutorialId: 1 },
    options: { unique: true },
  },
];

/** Idempotent: createIndex is a no-op when the index already exists. Called
 * once during startup, after connectMongo(). */
export async function ensureIndexes(): Promise<void> {
  for (const spec of INDEX_SPECS) {
    await getDb().collection<Document>(spec.collection).createIndex(spec.keys, spec.options ?? {});
  }
}

/** Immutable request manifest for retry-safe guided generation submissions. */
export interface GenerationSubmission {
  _id: string;
  courseId: ObjectId;
  requestedBy: string;
  fingerprint: string;
  createdAt: Date;
}
export const generationSubmissionsCol = (): Collection<GenerationSubmission> =>
  getDb().collection<GenerationSubmission>('generationSubmissions');

export const builderExamsCol = (): Collection<BuilderExam> => getDb().collection<BuilderExam>('builderExams');
export const examPublicationsCol = (): Collection<ExamPublication> => getDb().collection<ExamPublication>('examPublications');
export const examCandidatesCol = (): Collection<ExamCandidate> => getDb().collection<ExamCandidate>('examCandidates');
export const examBuildRunsCol = (): Collection<ExamBuildRun> => getDb().collection<ExamBuildRun>('examBuildRuns');
export const assessmentAttemptsCol = (): Collection<AssessmentAttempt> => getDb().collection<AssessmentAttempt>('assessmentAttempts');

INDEX_SPECS.push(
  { collection: 'builderExams', keys: { courseId: 1, updatedAt: -1 } },
  { collection: 'examPublications', keys: { examId: 1, revision: 1 }, options: { unique: true } },
  { collection: 'examCandidates', keys: { examId: 1, 'item.id': 1 }, options: { unique: true } },
  { collection: 'examBuildRuns', keys: { examId: 1, requestId: 1 }, options: { unique: true } },
  { collection: 'examBuildRuns', keys: { courseId: 1, status: 1 } },
  { collection: 'assessmentAttempts', keys: { examId: 1, puid: 1 }, options: { unique: true } },
  { collection: 'assessmentAttempts', keys: { courseId: 1, publicationId: 1 } },
);

export const coursePeopleAccessCol = (): Collection<CoursePeopleAccess> => getDb().collection<CoursePeopleAccess>('coursePeopleAccess');
INDEX_SPECS.push(
  { collection: 'coursePeopleAccess', keys: { courseId: 1, subject: 1 }, options: { unique: true } },
  { collection: 'coursePeopleAccess', keys: { puid: 1 } },
  { collection: 'coursePeopleAccess', keys: { email: 1, status: 1 } },
);

// Student learning v2: Preview records are structurally separate and expire.
import type { LearningSettings, LearningSession, ReviewMetadata, DiscussionPost } from '../../types/student-learning';
export const learningSettingsCol = (): Collection<LearningSettings> => getDb().collection<LearningSettings>('learningSettings');
export const learningSessionsCol = (): Collection<LearningSession> => getDb().collection<LearningSession>('learningSessions');
export const previewLearningSessionsCol = (): Collection<LearningSession> => getDb().collection<LearningSession>('previewLearningSessions');
export const reviewMetadataCol = (): Collection<ReviewMetadata> => getDb().collection<ReviewMetadata>('reviewMetadata');
export const previewReviewMetadataCol = (): Collection<ReviewMetadata> => getDb().collection<ReviewMetadata>('previewReviewMetadata');
export const discussionPostsCol = (): Collection<DiscussionPost> => getDb().collection<DiscussionPost>('discussionPosts');
export const previewDiscussionPostsCol = (): Collection<DiscussionPost> => getDb().collection<DiscussionPost>('previewDiscussionPosts');
INDEX_SPECS.push(
  { collection: 'learningSettings', keys: { courseId: 1 }, options: { unique: true } },
  { collection: 'learningSessions', keys: { courseId: 1, owner: 1, kind: 1, scope: 1 }, options: { unique: true } },
  { collection: 'previewLearningSessions', keys: { courseId: 1, owner: 1, previewSessionId: 1, kind: 1, scope: 1 }, options: { unique: true } },
  { collection: 'previewLearningSessions', keys: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } },
  { collection: 'reviewMetadata', keys: { courseId: 1, owner: 1, questionId: 1 }, options: { unique: true } },
  { collection: 'previewReviewMetadata', keys: { courseId: 1, owner: 1, previewSessionId: 1, questionId: 1 }, options: { unique: true } },
  { collection: 'previewReviewMetadata', keys: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } },
  { collection: 'discussionPosts', keys: { courseId: 1, pinned: -1, updatedAt: -1 } },
  { collection: 'previewDiscussionPosts', keys: { courseId: 1, previewOwner: 1, previewSessionId: 1 } },
  { collection: 'previewDiscussionPosts', keys: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } },
);
