import { lstat, rm } from 'node:fs/promises';
import path from 'node:path';
import type { ObjectId } from 'mongodb';
import { cancelJobsByDataIds } from '../components/jobs';
import {
  attemptsCol,
  auditCol,
  capabilitySettingsCol,
  contentRunsCol,
  coursesCol,
  examAttemptsCol,
  examTemplatesCol,
  flagsCol,
  generationBlueprintsCol,
  losCol,
  masteryCol,
  materialChunksCol,
  materialsCol,
  notificationsCol,
  previewAttemptsCol,
  previewStudentSessionsCol,
  questionVersionsCol,
  questionsCol,
  reviewBookCol,
  rosterCol,
  sessionSummariesCol,
  taInvitesCol,
  themesCol,
  usersCol,
} from '../components/mongodb/collections';
import { deleteCollectionIfExists } from '../components/qdrant';
import type { Course } from '../types/domain';

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const UPLOAD_ROOTS = [
  path.join(REPOSITORY_ROOT, 'uploads'),
  // Before July 17, 2026 multer used the process-relative `uploads/` path.
  // Deployments whose working directory was `server/` therefore persisted
  // files here. Keep this narrowly allow-listed for legacy course cleanup.
  path.join(REPOSITORY_ROOT, 'server', 'uploads'),
];
const HISTORICAL_WORKTREE_ROOT = path.join(REPOSITORY_ROOT, '.claude', 'worktrees');
const HISTORICAL_TEMP_ROOTS = ['/private/tmp', '/tmp'];
const GENERATED_UPLOAD_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|docx|pptx|txt|md)$/i;

export interface CourseDeletionActor {
  puid: string;
  isAdmin: boolean;
}

export interface CourseDeletionResult {
  deleted: true;
  courseId: string;
  deletedFiles: number;
  missingFiles: number;
  deletedVectorCollection: boolean;
  cancelledJobs: number;
  deletedDocuments: Record<string, number>;
}

/** Human-entered phrase used by both the API and Settings UI. It deliberately
 * includes the section so similarly named course projects are distinguishable. */
export function permanentDeletionConfirmation(course: Pick<Course, 'courseCode' | 'section'>): string {
  const identity = [course.courseCode.trim(), course.section?.trim()].filter(Boolean).join(' ');
  return `DELETE ${identity}`;
}

function directChildPath(root: string, candidate: string): string[] | null {
  const relative = path.relative(root, candidate);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative.split(path.sep);
}

function allowedStoredFile(candidate: string): boolean {
  const currentOrServerUpload = UPLOAD_ROOTS.some((root) => {
    const relative = path.relative(root, candidate);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  });
  if (currentOrServerUpload) return true;

  // Test courses created from historical Claude worktrees stored an absolute
  // path inside `<repo>/.claude/worktrees/<worktree>/uploads/<uuid>.<ext>`.
  // Accept only that exact shape, never arbitrary files elsewhere in a worktree.
  const worktreeParts = directChildPath(HISTORICAL_WORKTREE_ROOT, candidate);
  if (
    worktreeParts?.length === 3
    && worktreeParts[1] === 'uploads'
    && GENERATED_UPLOAD_NAME.test(worktreeParts[2])
  ) return true;

  // Some pre-release regression fixtures ran from /private/tmp/tlef-*/ (or
  // /tmp/tlef-* on Linux). Keep the allowance equally narrow and file-scoped.
  return HISTORICAL_TEMP_ROOTS.some((root) => {
    const parts = directChildPath(root, candidate);
    return Boolean(
      parts?.length === 3
      && parts[0].startsWith('tlef-')
      && parts[1] === 'uploads'
      && GENERATED_UPLOAD_NAME.test(parts[2]),
    );
  });
}

async function exists(candidate: string): Promise<boolean> {
  try {
    await lstat(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Resolve both current and historical relative storage paths. An absent file
 * contains no remaining data and is reported as missing; an existing file
 * outside the two known upload roots remains a hard safety failure. */
async function safeStoredFile(storagePath: string): Promise<string | null> {
  const candidates = path.isAbsolute(storagePath)
    ? [path.normalize(storagePath)]
    : [
        path.resolve(REPOSITORY_ROOT, storagePath),
        path.resolve(REPOSITORY_ROOT, 'server', storagePath),
        path.resolve(process.cwd(), storagePath),
      ];
  const uniqueCandidates = [...new Set(candidates)];

  for (const candidate of uniqueCandidates.filter(allowedStoredFile)) {
    if (await exists(candidate)) return candidate;
  }
  for (const candidate of uniqueCandidates.filter((value) => !allowedStoredFile(value))) {
    if (await exists(candidate)) throw new Error('course-delete-unsafe-storage-path');
  }
  return null;
}

/**
 * Irreversibly delete one complete course project. The course document is
 * deleted last, so a partial Mongo failure remains discoverable and retryable.
 * External resources are removed first and every step is idempotent.
 */
export async function permanentlyDeleteCourse(
  courseId: ObjectId,
  actor: CourseDeletionActor,
  confirmation: string,
): Promise<CourseDeletionResult> {
  const course = await coursesCol().findOne({ _id: courseId });
  if (!course) throw new Error('course-not-found');
  if (!actor.isAdmin && course.ownerPuid !== actor.puid) {
    throw new Error('course-delete-owner-required');
  }
  if (confirmation !== permanentDeletionConfirmation(course)) {
    throw new Error('course-delete-confirmation-mismatch');
  }

  const [materials, questions, flags, runs, examAttempts] = await Promise.all([
    materialsCol().find({ courseId }).toArray(),
    questionsCol().find({ courseId }).toArray(),
    flagsCol().find({ courseId }).toArray(),
    contentRunsCol().find({ courseId }).toArray(),
    examAttemptsCol().find({ courseId }).toArray(),
  ]);

  const hasActiveWork = runs.some((run) => run.status === 'queued' || run.status === 'running')
    || examAttempts.some((attempt) => attempt.masteryPassQueuedAt && !attempt.masteryPassCompletedAt);
  if (hasActiveWork) throw new Error('course-delete-active-work');

  // Validate every filesystem target before mutating any resource. A corrupt
  // or malicious path must never turn this course-scoped operation into a
  // broad filesystem deletion.
  const storedPaths = materials
    .map((material) => material.storagePath)
    .filter((value): value is string => Boolean(value));
  const resolvedFiles = await Promise.all(storedPaths.map(safeStoredFile));
  const storedFiles = [...new Set(resolvedFiles.filter((value): value is string => value !== null))];
  const missingFiles = resolvedFiles.filter((value) => value === null).length;

  const cancelledJobs = await cancelJobsByDataIds(
    runs.map((run) => run._id.toHexString()),
    examAttempts.map((attempt) => attempt._id.toHexString()),
  );
  const deletedVectorCollection = await deleteCollectionIfExists(`course-${courseId.toHexString()}`);

  let deletedFiles = 0;
  for (const file of storedFiles) {
    await rm(file, { force: true });
    deletedFiles += 1;
  }

  const questionIds = questions.map((question) => question._id);
  const flagIds = flags.map((flag) => flag._id);
  const auditTargets: Array<Record<string, unknown>> = [{ courseId }];
  if (questionIds.length > 0) {
    auditTargets.push({ targetType: 'question', targetId: { $in: questionIds } });
  }
  if (flagIds.length > 0) {
    auditTargets.push({ targetType: 'flag', targetId: { $in: flagIds } });
  }

  const deletions = await Promise.all([
    themesCol().deleteMany({ courseId }),
    losCol().deleteMany({ courseId }),
    questionVersionsCol().deleteMany({ questionId: { $in: questionIds } }),
    questionsCol().deleteMany({ courseId }),
    attemptsCol().deleteMany({ courseId }),
    previewAttemptsCol().deleteMany({ courseId }),
    previewStudentSessionsCol().deleteMany({ courseId }),
    materialChunksCol().deleteMany({ courseId }),
    materialsCol().deleteMany({ courseId }),
    masteryCol().deleteMany({ courseId }),
    reviewBookCol().deleteMany({ courseId }),
    examTemplatesCol().deleteMany({ courseId }),
    examAttemptsCol().deleteMany({ courseId }),
    flagsCol().deleteMany({ courseId }),
    notificationsCol().deleteMany({ courseId }),
    auditCol().deleteMany({ $or: auditTargets }),
    rosterCol().deleteMany({ courseId }),
    sessionSummariesCol().deleteMany({ courseId }),
    contentRunsCol().deleteMany({ courseId }),
    generationBlueprintsCol().deleteMany({ courseId }),
    capabilitySettingsCol().deleteMany({ scope: 'course', courseId }),
    taInvitesCol().deleteMany({ courseId }),
  ]);

  await usersCol().updateMany(
    { courseRoles: { $elemMatch: { courseId } } },
    { $pull: { courseRoles: { courseId } } },
  );

  const courseDeletion = await coursesCol().deleteOne({ _id: courseId });
  if (courseDeletion.deletedCount !== 1) throw new Error('course-not-found');

  const names = [
    'themes', 'learningObjectives', 'questionVersions', 'questions', 'attemptRecords',
    'previewAttemptRecords', 'previewStudentSessions', 'materialChunks', 'materials',
    'masteryProfiles', 'reviewBookEntries', 'examTemplates', 'examAttempts', 'flags',
    'notifications', 'auditLogs', 'rosterEntries', 'sessionSummaries', 'contentRuns',
    'generationBlueprints', 'capabilitySettings', 'taInvites',
  ];
  return {
    deleted: true,
    courseId: courseId.toHexString(),
    deletedFiles,
    missingFiles,
    deletedVectorCollection,
    cancelledJobs,
    deletedDocuments: Object.fromEntries(names.map((name, index) => [name, deletions[index].deletedCount])),
  };
}
