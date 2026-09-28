import type { ObjectId } from 'mongodb';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { LmsRosterUser } from '@ubc/ubc-genai-toolkit-lms-integration';
import { canvas, canvasApi, canvasEnabled, tokenStore } from '../components/canvas';
import { getDb } from '../components/mongodb';
import { coursesCol, usersCol, materialsCol } from '../components/mongodb/collections';
import { defineJob, scheduleRecurring } from '../components/jobs';
import { env } from '../config/env';
import { createMaterials } from './materials.service';

import { projectCourseInstructorShares } from './course-sharing.service';

export class CanvasError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
interface Source { id: string; name: string; code: string; }
interface Member { puid: string; canvasUserId: string; name: string; sourceIds: string[]; }
interface CanvasLink {
  _id: ObjectId; domain: string; connectionPuid: string; sources: Source[];
  revision: string; members: Member[]; syncedAt?: Date; validUntil?: Date;
  syncError?: string; autoEnroll: boolean;
}
export const canvasLinks = () => getDb().collection<CanvasLink>('canvasLinks');
const FRESHNESS_MS = 30 * 60 * 1000;

export async function listCanvasCourses(puid: string): Promise<Source[]> {
  const list = await canvas.getCourses(await canvasApi(puid), { enrollment_type: 'teacher', enrollment_state: 'active' });
  return list.map(({ id, name, code }) => ({ id, name, code }));
}
export async function validateCanvasSources(puid: string, ids: string[]): Promise<Source[]> {
  const unique = [...new Set(ids)];
  if (!unique.length || unique.length > 20) throw new CanvasError('Select between 1 and 20 Canvas courses.');
  const available = await listCanvasCourses(puid);
  const selected = unique.map(id => available.find(c => c.id === id));
  if (selected.some(c => !c)) throw new CanvasError('You must be an active Canvas teacher in every selected course.', 403);
  return selected as Source[];
}

/** Exact, opaque PUIDs. Names/emails/student numbers never grant access. */
export function mergeCanvasRosters(sources: Array<{ id: string; users: LmsRosterUser[] }>): Member[] {
  const members = new Map<string, Member>();
  const canvasIds = new Map<string, string>();
  for (const source of sources) for (const user of source.users) {
    const puid = user.integrationId?.trim();
    if (!puid) throw new CanvasError('Canvas did not release a PUID for every student. Check SIS-data permissions; the previous roster was retained.');
    const existing = members.get(puid);
    if ((existing && existing.canvasUserId !== user.id) || (canvasIds.has(user.id) && canvasIds.get(user.id) !== puid)) {
      throw new CanvasError('Canvas contains conflicting identity records. Resolve them before synchronizing; the previous roster was retained.');
    }
    canvasIds.set(user.id, puid);
    if (existing) { if (!existing.sourceIds.includes(source.id)) existing.sourceIds.push(source.id); }
    else members.set(puid, { puid, canvasUserId: user.id, name: user.name, sourceIds: [source.id] });
  }
  if (members.size > 5000) throw new CanvasError('The linked roster exceeds the 5,000-student limit.');
  return [...members.values()];
}
async function readRoster(puid: string, sources: Source[]): Promise<Member[]> {
  const api = await canvasApi(puid);
  const rosters = [];
  for (const source of sources) {
    const users = await canvas.getCourseUsers(api, source.id, { enrollmentTypes: ['student'], enrollmentStates: ['active'] });
    rosters.push({ id: source.id, users });
  }
  return mergeCanvasRosters(rosters);
}
export async function saveCanvasLink(courseId: ObjectId, puid: string, ids: string[], revision: string | null, autoEnroll: boolean): Promise<void> {
  const course = await coursesCol().findOne({ _id: courseId });
  if (!course || course.lifecycle === 'archived') throw new CanvasError('Select a non-archived FinanceBot course.');
  const sources = await validateCanvasSources(puid, ids);
  const members = await readRoster(puid, sources);
  const now = new Date();
  const value = { domain: env.canvasDomain, connectionPuid: puid, sources, members, revision: randomUUID(), syncedAt: now,
    validUntil: new Date(now.getTime() + FRESHNESS_MS), autoEnroll, syncError: '' };
  try {
    if (revision === null) await canvasLinks().insertOne({ _id: courseId, ...value });
    else {
      const result = await canvasLinks().updateOne({ _id: courseId, revision }, { $set: value });
      if (!result.matchedCount) throw new CanvasError('The Canvas link changed. Reload and try again.', 409);
    }
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw new CanvasError('One of these Canvas courses is already linked, or this course changed. Reload to review.', 409);
    throw error;
  }
}
export async function syncCanvasLink(courseId: ObjectId): Promise<void> {
  const link = await canvasLinks().findOne({ _id: courseId, domain: env.canvasDomain });
  if (!link) throw new CanvasError('No Canvas courses linked.', 404);
  try {
    const stored = await usersCol().findOne({ puid: link.connectionPuid });
    const manager = stored && !stored.deactivatedAt ? (await projectCourseInstructorShares([stored]))[0] : null;
    if (!manager || (!manager.isAdmin && !manager.courseRoles.some(r => r.role === 'instructor' && r.courseId.equals(courseId)))) {
      await canvasLinks().updateOne({ _id: courseId, revision: link.revision }, { $unset: { validUntil: '' } });
      throw new CanvasError('The connected instructor no longer manages this FinanceBot course. Relink with an authorized instructor.');
    }
    await validateCanvasSources(link.connectionPuid, link.sources.map(s => s.id));
    const members = await readRoster(link.connectionPuid, link.sources);
    const now = new Date();
    await canvasLinks().updateOne({ _id: courseId, revision: link.revision }, { $set: { members, syncedAt: now,
      validUntil: new Date(now.getTime() + FRESHNESS_MS), syncError: '', revision: randomUUID() } });
  } catch (error) {
    const message = error instanceof CanvasError ? error.message : 'Canvas could not be read. Reconnect or check Canvas permissions, then retry. The previous roster was retained.';
    await canvasLinks().updateOne({ _id: courseId, revision: link.revision }, { $set: { syncError: message } });
    throw new CanvasError(message, 502);
  }
}

export { projectCanvasEnrollment } from './canvas-enrollment.service';
export async function canvasLinkStatus(courseId: ObjectId) {
  const link = await canvasLinks().findOne({ _id: courseId, domain: env.canvasDomain });
  if (!link) return null;
  const users = await usersCol().find({ puid: { $in: link.members.map(m => m.puid) } }, { projection: { puid: 1, deactivatedAt: 1 } }).toArray();
  const known = new Set(users.filter(u => !u.deactivatedAt).map(u => u.puid));
  return { revision: link.revision, sources: link.sources, syncedAt: link.syncedAt, validUntil: link.validUntil,
    syncError: link.syncError, autoEnroll: link.autoEnroll,
    students: link.members.map(m => ({ canvasUserId: m.canvasUserId, name: m.name, sourceIds: m.sourceIds,
      identity: `…${m.puid.slice(-4)}`, status: known.has(m.puid) ? 'CWL account matched' : 'Awaiting first CWL login' })) };
}
export async function unlinkCanvas(courseId: ObjectId, revision: string): Promise<void> {
  const result = await canvasLinks().deleteOne({ _id: courseId, revision });
  if (!result.deletedCount) throw new CanvasError('The Canvas link changed. Reload and try again.', 409);
}
export async function disconnectCanvas(puid: string): Promise<void> {
  const tokens = await tokenStore.get(puid);
  await tokenStore.delete(puid);
  await canvasLinks().updateMany({ connectionPuid: puid, domain: env.canvasDomain }, { $unset: { validUntil: '' }, $set: { syncError: 'Canvas disconnected. Reconnect and synchronize to resume automatic enrollment.', revision: randomUUID() } });
  if (tokens) { try { await canvas.revokeToken({ canvasDomain: env.canvasDomain }, tokens.accessToken); } catch { /* Local disconnect remains effective. */ } }
}
async function authorizedLink(courseId: ObjectId, puid: string) {
  const link = await canvasLinks().findOne({ _id: courseId, domain: env.canvasDomain });
  if (!link) throw new CanvasError('Link Canvas courses first.');
  // Reads/imports use the requesting instructor's connection, never another teacher's token.
  await validateCanvasSources(puid, link.sources.map(s => s.id));
  return link;
}
export async function listCanvasFiles(courseId: ObjectId, puid: string) {
  const link = await authorizedLink(courseId, puid);
  const api = await canvasApi(puid);
  const files = [];
  for (const source of link.sources) for (const f of await canvas.getCourseFiles(api, source.id)) {
    files.push({ id: f.id, sourceId: source.id, sourceName: source.name, name: f.name, size: f.size,
      supported: /\.(pdf|docx|pptx|txt|md)$/i.test(f.name), updatedAt: f.updatedAt });
  }
  return files;
}
export async function importCanvasFile(courseId: ObjectId, puid: string, sourceId: string, fileId: string) {
  const link = await authorizedLink(courseId, puid);
  if (!link.sources.some(s => s.id === sourceId)) throw new CanvasError('This file is not from a linked Canvas course.', 403);
  const files = await canvas.getCourseFiles(await canvasApi(puid), sourceId);
  const file = files.find(f => f.id === fileId);
  if (!file || !/\.(pdf|docx|pptx|txt|md)$/i.test(file.name)) throw new CanvasError('Choose a supported Canvas document.');
  const source = { key: JSON.stringify([env.canvasDomain, sourceId, fileId, file.updatedAt || 'unknown']), domain: env.canvasDomain, courseId: sourceId, fileId, updatedAt: file.updatedAt };
  const existing = await materialsCol().findOne({ courseId, 'canvasSource.key': source.key });
  if (existing?.deletedAt) throw new CanvasError('This file was already imported and is in Trash. Restore it in Course Materials.');
  if (existing) return { materialId: existing._id, name: existing.name, status: existing.status, reused: true };
  const downloaded = await canvas.downloadFile(await canvasApi(puid), sourceId, fileId, { maxBytes: 50 * 1024 * 1024, via: 'public-url' });
  const dir = path.resolve(__dirname, '../../../uploads');
  await fs.mkdir(dir, { recursive: true });
  const filename = path.join(dir, `${randomUUID()}${path.extname(file.name)}`);
  await fs.writeFile(filename, downloaded.data);
  // The existing durable ingestion pipeline owns this file after creation.
  try {
    const [material] = await createMaterials(courseId, [{ originalname: file.name, path: filename }], puid, source);
    return { materialId: material._id, name: material.name, status: material.status, reused: false };
  } catch (error) {
    if (!await materialsCol().findOne({ storagePath: filename })) await fs.rm(filename, { force: true });
    if ((error as { code?: number }).code === 11000) {
      const duplicate = await materialsCol().findOne({ courseId, 'canvasSource.key': source.key });
      if (duplicate) return { materialId: duplicate._id, name: duplicate.name, status: duplicate.status, reused: true };
    }
    throw error;
  }
}
export async function registerCanvasJobs(): Promise<void> {
  if (!canvasEnabled()) return;
  await materialsCol().createIndex({ courseId: 1, 'canvasSource.key': 1 }, { unique: true, partialFilterExpression: { 'canvasSource.key': { $type: 'string' } } });
  await canvasLinks().createIndex({ domain: 1, 'sources.id': 1 }, { unique: true });
  await canvasLinks().createIndex({ 'members.puid': 1, validUntil: 1 });
  defineJob('canvas.roster-sync', async () => {
    for (const link of await canvasLinks().find({ domain: env.canvasDomain }).toArray()) {
      if (!await coursesCol().findOne({ _id: link._id })) { await canvasLinks().deleteOne({ _id: link._id }); continue; }
      try { await syncCanvasLink(link._id); } catch { /* Sanitized status is persisted and shown in the course. */ }
    }
  });
  await scheduleRecurring('canvas.roster-sync', '5 minutes');
}
