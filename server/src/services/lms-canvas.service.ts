import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ObjectId, WithId } from 'mongodb';
import { canvas, rosterFieldCoverage, type LmsRosterFieldCoverage, type LmsRosterMatchReport } from '@ubc/ubc-genai-toolkit-lms-integration';
import { coursesCol, lmsRosterEntriesCol, materialsCol, usersCol } from '../components/mongodb/collections';
import type { LmsRosterEntry, Material } from '../types/domain';
import { getCourse } from './courses.service';
import { createMaterials, detectUploadFormat, MAX_UPLOAD_BYTES, type UploadedFile } from './materials.service';

// Canvas integration service (Phase 6). Owns the course link, file import
// (Task 3), and roster sync (Task 4). The package owns every Canvas call;
// this file owns FinanceBot's decisions about them. Design:
// docs/superpowers/specs/2026-08-27-canvas-integration-design.md

export interface CourseLink {
  courseId: string;
  name: string;
  code: string;
  linkedAt: Date;
  linkedBy: string;
}

/** Courses the connected Canvas identity TEACHES — the only linkable ones. */
export async function listTeacherCourses(
  api: canvas.ApiClient,
): Promise<Array<{ id: string; name: string; code: string }>> {
  const courses = await canvas.getCourses(api, { enrollment_type: 'teacher' });
  return courses.map((c) => ({ id: c.id, name: c.name, code: c.code }));
}

export async function getLink(courseId: ObjectId): Promise<CourseLink | null> {
  const course = await getCourse(courseId);
  return course.canvas ?? null;
}

/** Throws `not-linked`. Every course-scoped Canvas read starts here so the
 * external course id can only ever come from the stored link. */
export async function requireLink(courseId: ObjectId): Promise<CourseLink> {
  const link = await getLink(courseId);
  if (!link) throw new Error('not-linked');
  return link;
}

/**
 * Link a Canvas course. Refused (`not-teacher`) unless the id appears in the
 * connected identity's teacher list — a stored token proves a credential,
 * not instructor status on that course. Name/code are taken from Canvas's
 * row, never from the caller.
 */
export async function linkCourse(
  api: canvas.ApiClient,
  courseId: ObjectId,
  canvasCourseId: string,
  byPuid: string,
): Promise<CourseLink> {
  const teaching = await listTeacherCourses(api);
  const match = teaching.find((c) => c.id === canvasCourseId);
  if (!match) throw new Error('not-teacher');
  const link: CourseLink = { courseId: match.id, name: match.name, code: match.code, linkedAt: new Date(), linkedBy: byPuid };
  await coursesCol().updateOne({ _id: courseId }, { $set: { canvas: link } });
  return link;
}

/** Clear the link and the course's synced Canvas roster. Imported materials
 * stay — they are FinanceBot's now. */
export async function unlinkCourse(courseId: ObjectId): Promise<void> {
  await coursesCol().updateOne({ _id: courseId }, { $unset: { canvas: '' } });
  await lmsRosterEntriesCol().deleteMany({ courseId });
}

// --- File import (Task 3) ----------------------------------------------------

export interface ImportableFile {
  id: string;
  name: string;
  size?: number;
  updatedAt?: string;
  alreadyImported: boolean;
}

export type ImportFailure = 'download-failed' | 'too-large' | 'unsupported-format' | 'not-found';

export interface ImportResult {
  created: WithId<Material>[];
  skipped: string[];
  failed: Array<{ id: string; reason: ImportFailure }>;
}

async function importedFileIds(courseId: ObjectId, externalCourseId: string): Promise<Set<string>> {
  const rows = await materialsCol()
    .find({ courseId, 'origin.provider': 'canvas', 'origin.externalCourseId': externalCourseId })
    .project<{ origin: { externalFileId: string } }>({ 'origin.externalFileId': 1 })
    .toArray();
  return new Set(rows.map((r) => r.origin.externalFileId));
}

/** Canvas Files the upload path could accept, with duplicates flagged. */
export async function listImportableFiles(api: canvas.ApiClient, courseId: ObjectId): Promise<ImportableFile[]> {
  const link = await requireLink(courseId);
  const [files, imported] = await Promise.all([
    canvas.getCourseFiles(api, link.courseId),
    importedFileIds(courseId, link.courseId),
  ]);
  return files
    .filter((f) => detectUploadFormat(f.name) !== undefined && (f.size === undefined || f.size <= MAX_UPLOAD_BYTES))
    .map((f) => ({ id: f.id, name: f.name, size: f.size, updatedAt: f.updatedAt, alreadyImported: imported.has(f.id) }));
}

/**
 * Import Canvas Files into materials. Per-file independent (IN-S04): one
 * failure lands in `failed`, the rest proceed. Already-imported ids are
 * skipped and reported, never refused — a retry is safe. Bytes are written
 * under `uploadDir` with the same naming multer uses, so the existing
 * "Open original" realpath check and retry path work unchanged.
 */
export async function importFiles(
  api: canvas.ApiClient,
  courseId: ObjectId,
  fileIds: string[],
  byPuid: string,
  uploadDir: string,
): Promise<ImportResult> {
  const link = await requireLink(courseId);
  const [files, imported] = await Promise.all([
    canvas.getCourseFiles(api, link.courseId),
    importedFileIds(courseId, link.courseId),
  ]);
  const byId = new Map(files.map((f) => [f.id, f]));
  const result: ImportResult = { created: [], skipped: [], failed: [] };

  for (const id of fileIds) {
    const file = byId.get(id);
    if (!file) {
      result.failed.push({ id, reason: 'not-found' });
      continue;
    }
    if (imported.has(id)) {
      result.skipped.push(id);
      continue;
    }
    if (detectUploadFormat(file.name) === undefined) {
      result.failed.push({ id, reason: 'unsupported-format' });
      continue;
    }
    if (file.size !== undefined && file.size > MAX_UPLOAD_BYTES) {
      result.failed.push({ id, reason: 'too-large' });
      continue;
    }

    const target = path.join(uploadDir, `${randomUUID()}${path.extname(file.name)}`);
    try {
      // maxBytes bounds the download; an over-limit body surfaces here as a
      // download failure, so the size pre-check above is the cheap path only.
      const downloaded = await canvas.downloadFile(api, link.courseId, id, { maxBytes: MAX_UPLOAD_BYTES });
      await fs.writeFile(target, downloaded.data);
    } catch {
      await fs.rm(target, { force: true });
      result.failed.push({ id, reason: 'download-failed' });
      continue;
    }

    const uploaded: UploadedFile = { originalname: file.name, path: target };
    const [material] = await createMaterials(courseId, [uploaded], byPuid);
    const origin: NonNullable<Material['origin']> = {
      provider: 'canvas',
      externalCourseId: link.courseId,
      externalFileId: id,
      ...(file.updatedAt ? { sourceUpdatedAt: new Date(file.updatedAt) } : {}),
      importedAt: new Date(),
    };
    await materialsCol().updateOne({ _id: material._id }, { $set: { origin } });
    result.created.push({ ...material, origin });
    imported.add(id);
  }
  return result;
}

// --- Roster sync (Task 4) ----------------------------------------------------

export interface SyncResult {
  report: LmsRosterMatchReport;
  coverage: LmsRosterFieldCoverage;
  syncedAt: Date;
  stored: number;
}

/**
 * Sync the linked Canvas roster. Two independent outputs from one read:
 *
 * 1. A match report, for display — `appUsers` are the students already
 *    enrolled in this FinanceBot course, keyed by PUID, so `matched` means
 *    "enrolled and on Canvas", `rosterOnly` "on Canvas, not yet enrolled"
 *    (normal), `appOnly` "enrolled here, gone from Canvas" (explained as
 *    enrollment-ended vs not-enrolled).
 * 2. The stored entries: every Canvas user WITH an integrationId, whether or
 *    not they have ever logged in — that is what makes them enrollable.
 *
 * The package throws `roster-coverage` when a non-empty roster carries no
 * integrationId at all; that propagates and nothing is written, because the
 * state is indistinguishable from an empty class and must not be recorded
 * as one.
 *
 * Two roster reads per sync (getCourseUsers, then matchCourseRoster reads
 * again). Acceptable for a manual action; matchRosterByIntegrationId would
 * avoid it but loses the package's course-id stamping guarantee.
 */
export async function syncRoster(api: canvas.ApiClient, courseId: ObjectId): Promise<SyncResult> {
  const link = await requireLink(courseId);
  const students = await usersCol()
    .find({ courseRoles: { $elemMatch: { courseId, role: 'student' } } })
    .project<{ puid: string }>({ puid: 1 })
    .toArray();
  const appUsers = students.map((s) => ({ appUserId: s.puid, key: s.puid }));

  const users = await canvas.getCourseUsers(api, link.courseId);
  const coverage = rosterFieldCoverage(users);
  const matched = await canvas.matchCourseRoster(api, link.courseId, appUsers); // throws roster-coverage
  const report = await canvas.explainUnmatched(api, link.courseId, matched);

  const syncedAt = new Date();
  const entries: LmsRosterEntry[] = users
    .filter((u): u is typeof u & { integrationId: string } => typeof u.integrationId === 'string' && u.integrationId.trim() !== '')
    .map((u) => ({
      courseId,
      provider: 'canvas',
      externalCourseId: link.courseId,
      externalUserId: u.id,
      puid: u.integrationId.trim(),
      name: u.name,
      matchedBy: 'integrationId',
      syncedAt,
    }));

  await lmsRosterEntriesCol().deleteMany({ courseId });
  if (entries.length > 0) await lmsRosterEntriesCol().insertMany(entries);
  return { report, coverage, syncedAt, stored: entries.length };
}

export async function getCanvasRoster(
  courseId: ObjectId,
): Promise<{ syncedAt: Date | null; entries: Array<{ puid: string; name: string }> }> {
  const rows = await lmsRosterEntriesCol().find({ courseId }).sort({ name: 1 }).toArray();
  return {
    syncedAt: rows.reduce<Date | null>((latest, r) => (!latest || r.syncedAt > latest ? r.syncedAt : latest), null),
    entries: rows.map((r) => ({ puid: r.puid, name: r.name })),
  };
}
