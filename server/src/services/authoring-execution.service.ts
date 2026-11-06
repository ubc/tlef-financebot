import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { ObjectId } from 'mongodb';
import { contentRunsCol, coursesCol } from '../components/mongodb/collections';
import { assertContentRunActive } from './content-runs.service';
const LEASE_MS = 30 * 60 * 1000;
const scopes = new AsyncLocalStorage<{ runId: ObjectId; token: string; courseId?: ObjectId }>();

/** CAS ownership fences duplicate Agenda delivery. The lease cannot be revived
 * after expiry; recorded candidates remain available for explicit retry. */
export async function withAuthoringExecution<T>(runId: ObjectId, work: () => Promise<T>, courseId?: ObjectId): Promise<T> {
  const token = randomUUID(); const now = new Date();
  const claimed = await contentRunsCol().updateOne({ _id: runId, kind: 'question-generation', status: 'queued', workerExecution: { $exists: false } },
    { $set: { workerExecution: { token, expiresAt: new Date(now.getTime() + LEASE_MS) } } });
  if (!claimed.matchedCount) throw new Error('authoring-run-already-owned');
  return scopes.run({ runId, token, ...(courseId ? { courseId } : {}) }, work);
}
export async function assertAuthoringExecutionActive(runId: ObjectId): Promise<void> {
  await assertContentRunActive(runId);
  const scope = scopes.getStore(); if (!scope) return;
  if (!scope.runId.equals(runId)) throw new Error('authoring-run-owner-conflict');
  if (scope.courseId && !await coursesCol().findOne({ _id: scope.courseId, authoringDeletionStartedAt: { $exists: false }, lifecycle: { $ne: 'archived' }, archivedAt: { $exists: false } })) throw new Error('course-authoring-unavailable');
  const now = new Date();
  const renewed = await contentRunsCol().updateOne({ _id: runId, kind: 'question-generation', status: { $in: ['queued', 'running'] },
    'workerExecution.token': scope.token, 'workerExecution.expiresAt': { $gt: now } }, { $set: { 'workerExecution.expiresAt': new Date(now.getTime() + LEASE_MS) } });
  if (!renewed.matchedCount) throw new Error('authoring-run-owner-expired');
}
export function authoringExecutionToken(): string | undefined { return scopes.getStore()?.token; }
