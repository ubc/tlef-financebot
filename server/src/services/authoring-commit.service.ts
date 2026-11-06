import { AsyncLocalStorage } from 'node:async_hooks';
import type { ObjectId, ClientSession, Collection, Document } from 'mongodb';
import { getDb, getMongoClient } from '../components/mongodb';

let transactionSupport = false;
let audited = false;
const scopes = new AsyncLocalStorage<{ courseId: string; session: ClientSession }>();
export function authoringCommitAvailable(): boolean { return audited && transactionSupport; }
export function currentAuthoringSession(): ClientSession | undefined { return scopes.getStore()?.session; }

/** First-write diagnostic records participate in the course transaction when
 * available. Standalone mode only offers checked cleanup, not an atomic fence. */
export async function withCourseAuthoringFirstWrite<T>(courseId: ObjectId, work: () => Promise<T>, cleanup: () => Promise<unknown>): Promise<T> {
  if (authoringCommitAvailable() || currentAuthoringSession()) return withCourseAuthoringWrite(courseId, work, { required: true });
  const eligible = () => getDb().collection('courses').findOne({ _id: courseId, authoringDeletionStartedAt: { $exists: false }, lifecycle: { $ne: 'archived' }, archivedAt: { $exists: false } });
  if (!await eligible()) throw new Error('course-not-found');
  const result = await work();
  if (!await eligible()) {
    await cleanup();
    throw new Error('course-not-found');
  }
  return result;
}

/** Narrow adapter for ordinary Mongo collection operations inside the shared
 * transaction. Outside a scope, the original collection is returned unchanged. */
export function authoringCollection<T extends Document>(collection: Collection<T>): Collection<T> {
  const session = currentAuthoringSession();
  if (!session) return collection;
  const optionsIndex: Record<string, number> = { find: 1, findOne: 1, insertOne: 1, insertMany: 1, updateOne: 2, updateMany: 2,
    replaceOne: 2, findOneAndUpdate: 2, deleteOne: 1, deleteMany: 1, countDocuments: 1, aggregate: 1, bulkWrite: 1 };
  return new Proxy(collection, { get(target, key) {
    const value = Reflect.get(target, key);
    if (typeof key !== 'string' || typeof value !== 'function') return value;
    const index = optionsIndex[key];
    if (index === undefined) return value.bind(target);
    return (...args: unknown[]) => {
      args[index] = { ...(args[index] && typeof args[index] === 'object' ? args[index] as Record<string, unknown> : {}), session };
      return Reflect.apply(value, target, args);
    };
  } });
}

/** Called at startup. A standalone mongod cannot safely enable concurrent v2
 * persistence; diagnostic candidates remain available without claiming a fence. */
export async function initializeAuthoringCommitSupport(): Promise<{ available: boolean; topology: 'replica-set' | 'sharded' | 'standalone' | 'unavailable' }> {
  try {
    const hello = await getDb().admin().command({ hello: 1 });
    transactionSupport = Boolean(hello.setName || hello.msg === 'isdbgrid'); audited = true;
    return { available: transactionSupport, topology: hello.setName ? 'replica-set' : hello.msg === 'isdbgrid' ? 'sharded' : 'standalone' };
  } catch {
    transactionSupport = false; audited = true;
    return { available: false, topology: 'unavailable' };
  }
}

/** All Bank/Queue head creation and active-source metadata writes share this
 * atomic course fence. No paid/external work belongs inside the transaction. */
export async function withCourseAuthoringWrite<T>(courseId: ObjectId, work: (session?: ClientSession) => Promise<T>, options: { required?: boolean } = {}): Promise<T> {
  const current = scopes.getStore();
  if (current) {
    if (current.courseId !== courseId.toHexString()) throw new Error('authoring-cross-course-transaction');
    return work(current.session);
  }
  if (!authoringCommitAvailable()) {
    if (options.required) throw new Error('authoring-coordinated-commit-unavailable');
    return work(undefined);
  }
  const session = getMongoClient().startSession();
  try {
    return await session.withTransaction(async () => {
      const fenced = await getDb().collection('courses').updateOne({ _id: courseId, authoringDeletionStartedAt: { $exists: false }, ...(options.required ? { lifecycle: { $ne: 'archived' }, archivedAt: { $exists: false } } : {}) }, { $inc: { authoringRevision: 1 } }, { session });
      if (fenced.matchedCount !== 1) throw new Error('course-not-found');
      return scopes.run({ courseId: courseId.toHexString(), session }, () => work(session));
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
  } finally { await session.endSession(); }
}
