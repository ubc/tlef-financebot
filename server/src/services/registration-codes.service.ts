import { canUseStudentCode } from './course-people-access.service';
import { randomInt, randomUUID } from 'node:crypto';
import type { ObjectId, WithId } from 'mongodb';
import { coursesCol, registrationCodeBatchesCol, usersCol } from '../components/mongodb/collections';
import type { Course, User } from '../types/domain';
import type { CourseRegistrationCodeBatch, RegistrationCodePage, RegistrationCodeRow } from '../types/registration-code';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function fail(message: string, status: number): never { throw Object.assign(new Error(message), { status }); }
function codeValue(): string { return Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''); }
function duplicate(error: unknown): boolean { return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 11000); }
function expired(course: Course, now = new Date()): boolean {
  return course.lifecycle === 'archived' || Boolean(course.archivedAt) || Boolean(course.termEnd && course.termEnd <= now);
}
async function courseForCodes(courseId: ObjectId): Promise<WithId<Course>> {
  const course = await coursesCol().findOne({ _id: courseId });
  if (!course) fail('Course not found.', 404);
  return course;
}

export async function createRegistrationCodes(courseId: ObjectId, actorPuid: string, count: number, requestId: string) {
  if (!Number.isInteger(count) || count < 1 || count > 50) fail('Generate between 1 and 50 codes at a time.', 400);
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requestId)) fail('A valid batch request ID is required.', 400);
  const course = await courseForCodes(courseId);
  if (expired(course)) fail('Restore the course and update its term dates before generating codes.', 409);
  const existing = await registrationCodeBatchesCol().findOne({ courseId, requestId });
  if (existing) {
    if (existing.codes.length !== count) fail('This batch request was already used with a different count.', 409);
    return { ids: existing.codes.map(code => code.id) };
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const values = new Set<string>();
    while (values.size < count) values.add(codeValue());
    const batch: CourseRegistrationCodeBatch = { courseId, requestId, createdByPuid: actorPuid, createdAt: new Date(),
      codes: [...values].map(code => ({ id: randomUUID(), code, status: 'available' })) };
    try {
      await registrationCodeBatchesCol().insertOne(batch);
      return { ids: batch.codes.map(code => code.id) };
    } catch (error) {
      if (!duplicate(error)) throw error;
      const saved = await registrationCodeBatchesCol().findOne({ courseId, requestId });
      if (saved) {
        if (saved.codes.length !== count) fail('This batch request was already used with a different count.', 409);
        return { ids: saved.codes.map(code => code.id) };
      }
    }
  }
  fail('Could not generate unique codes. Try again.', 503);
}

export async function listRegistrationCodes(courseId: ObjectId, options: { page?: number; pageSize?: number; status?: RegistrationCodeRow['status'] } = {}): Promise<RegistrationCodePage> {
  const course = await courseForCodes(courseId);
  const pageSize = options.pageSize ?? 25;
  const requestedPage = options.page ?? 1;
  if (!Number.isInteger(requestedPage) || requestedPage < 1 || requestedPage > 1000000 || ![10, 25, 50].includes(pageSize)
    || (options.status && !['available', 'claimed', 'used', 'revoked', 'expired'].includes(options.status))) fail('Invalid code page or status.', 400);
  const isExpired = expired(course);
  // Count and fetch only the requested code page in Mongo, rather than loading
  // whole batches into the client. Deterministic code IDs break timestamp ties.
  const pipeline = [
    { $match: { courseId } }, { $unwind: '$codes' }, { $match: { 'codes.deletedAt': { $exists: false } } },
    { $set: { displayStatus: { $cond: [{ $and: [{ $eq: ['$codes.status', 'available'] }, isExpired] }, 'expired', '$codes.status'] } } },
    ...(options.status ? [{ $match: { displayStatus: options.status } }] : []),
  ];
  const [counts] = await registrationCodeBatchesCol().aggregate<{ total: number }>([...pipeline, { $count: 'total' }]).toArray();
  const total = counts?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, pageCount);
  const selected = await registrationCodeBatchesCol().aggregate<WithId<CourseRegistrationCodeBatch>>([
    ...pipeline, { $sort: { createdAt: -1, _id: -1, 'codes.id': 1 } }, { $skip: (page - 1) * pageSize }, { $limit: pageSize },
    { $set: { codes: ['$codes'] } },
  ]).toArray();
  const puids = [...new Set(selected.flatMap(batch => batch.codes.flatMap(code => code.claimedByPuid ? [code.claimedByPuid] : [])))];
  const users = puids.length ? await usersCol().find({ puid: { $in: puids } }, {
    projection: { puid: 1, uid: 1, displayName: 1, email: 1, lastLoginAt: 1 },
  }).toArray() : [];
  const byPuid = new Map(users.map(user => [user.puid, user]));
  return { total, page, pageSize, pageCount, codes: selected.flatMap(batch => batch.codes.map(code => {
    const user = code.claimedByPuid ? byPuid.get(code.claimedByPuid) : undefined;
    return { id: code.id, code: code.code, status: code.status === 'available' && expired(course) ? 'expired' as const : code.status,
      createdAt: batch.createdAt.toISOString(), claimedAt: code.claimedAt?.toISOString() ?? null, usedAt: code.usedAt?.toISOString() ?? null,
      recipient: code.claimedByPuid ? { puid: code.claimedByPuid, cwl: user?.uid ?? '', displayName: user?.displayName ?? code.claimedByPuid,
        email: user?.email ?? '', lastLoginAt: user?.lastLoginAt?.toISOString() ?? null } : null };
  })) };
}

/** Hide a record, preserving its claim receipt and existing Student access. */
export async function deleteRegistrationCode(courseId: ObjectId, id: string, actorPuid: string): Promise<void> {
  await courseForCodes(courseId);
  const deleted = { 'codes.$.deletedAt': new Date(), 'codes.$.deletedByPuid': actorPuid };
  // Unused deletion and redemption compete on the same status predicate.
  const unused = await registrationCodeBatchesCol().findOneAndUpdate({ courseId, codes: { $elemMatch: { id, status: 'available', deletedAt: { $exists: false } } } }, {
    $set: { ...deleted, 'codes.$.status': 'revoked', 'codes.$.revokedAt': new Date(), 'codes.$.revokedByPuid': actorPuid },
  }, { returnDocument: 'after' });
  if (unused) return;
  const terminal = await registrationCodeBatchesCol().findOneAndUpdate({ courseId, codes: { $elemMatch: { id, status: { $in: ['used', 'revoked'] }, deletedAt: { $exists: false } } } }, {
    $set: deleted,
  }, { returnDocument: 'after' });
  if (!terminal) fail('This record is unavailable or enrollment is still pending. Refresh the list.', 409);
}

export async function revokeRegistrationCode(courseId: ObjectId, id: string, actorPuid: string): Promise<void> {
  await courseForCodes(courseId);
  const saved = await registrationCodeBatchesCol().findOneAndUpdate({ courseId, codes: { $elemMatch: { id, status: 'available' } } }, {
    $set: { 'codes.$.status': 'revoked', 'codes.$.revokedAt': new Date(), 'codes.$.revokedByPuid': actorPuid },
  }, { returnDocument: 'after' });
  if (!saved) fail('This code is no longer unused. Refresh the list.', 409);
}

function assertStudentAccess(course: Course): void {
  if (expired(course)) fail('This course has ended or is archived.', 410);
  if (!course.published || course.lifecycle === 'draft' || (course.termStart && course.termStart > new Date())) {
    fail('This course is not open for enrollment yet.', 409);
  }
}

async function finishClaim(batch: WithId<CourseRegistrationCodeBatch>, id: string, user: User): Promise<void> {
  // Keep the claim reserved if a write fails. The same CWL account can resume;
  // another account can never claim the code between these two durable writes.
  if (!await canUseStudentCode(batch.courseId, user.puid)) fail('This account cannot enroll in this course.', 403);
  const changed = await usersCol().updateOne({ puid: user.puid, deactivatedAt: { $exists: false } }, {
    $addToSet: { courseRoles: { courseId: batch.courseId, role: 'student' } },
  });
  if (!changed.matchedCount) fail('This account cannot enroll. Contact your instructor.', 403);
  await registrationCodeBatchesCol().updateOne({ _id: batch._id, codes: { $elemMatch: { id, status: 'claimed', claimedByPuid: user.puid } } }, {
    $set: { 'codes.$.status': 'used', 'codes.$.usedAt': new Date() },
  });
}

export async function redeemRegistrationCode(user: User, rawCode: string) {
  if (user.deactivatedAt) fail('This account cannot enroll.', 403);
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-Z2-9]{12}$/.test(code)) fail('Code not recognized. Ask your instructor for an unused one-time code.', 404);
  const batch = await registrationCodeBatchesCol().findOne({ 'codes.code': code });
  const entry = batch?.codes.find(entry => entry.code === code);
  if (!batch || !entry) fail('Code not recognized.', 404);
  const course = await courseForCodes(batch.courseId);
  assertStudentAccess(course);
  if (!await canUseStudentCode(batch.courseId, user.puid)) fail('Your course access is managed by the instructor. This code cannot change it.', 403);
  if (entry.status === 'revoked') fail('This code has been revoked. Ask your instructor for a new code.', 410);
  if (entry.status === 'used' || (entry.status === 'claimed' && entry.claimedByPuid !== user.puid)) fail('This code has already been used.', 409);
  if (entry.status === 'available') {
    if (user.courseRoles.some(role => role.role === 'student' && role.courseId.equals(batch.courseId))) fail("You're already enrolled in this course. The code was not used.", 409);
    const claimed = await registrationCodeBatchesCol().findOneAndUpdate({ _id: batch._id, codes: { $elemMatch: { id: entry.id, status: 'available' } } }, {
      $set: { 'codes.$.status': 'claimed', 'codes.$.claimedByPuid': user.puid, 'codes.$.claimedAt': new Date() },
    }, { returnDocument: 'after' });
    if (!claimed) fail('This code is no longer available.', 409);
  }
  await finishClaim(batch, entry.id, user);
  return { courseId: course._id, name: course.name, courseCode: course.courseCode };
}

/** Recover interrupted claims on authenticated session reload, never used codes. */
export async function resumeClaimedRegistrations(user: User): Promise<User> {
  if (user.deactivatedAt) return user;
  const batches = await registrationCodeBatchesCol().find({ codes: { $elemMatch: { status: 'claimed', claimedByPuid: user.puid } } }).toArray();
  for (const batch of batches) {
    const course = await coursesCol().findOne({ _id: batch.courseId });
    if (!course || expired(course) || !course.published || course.lifecycle === 'draft' || (course.termStart && course.termStart > new Date())) continue;
    if (!await canUseStudentCode(batch.courseId, user.puid)) continue;
    for (const code of batch.codes.filter(code => code.status === 'claimed' && code.claimedByPuid === user.puid)) await finishClaim(batch, code.id, user);
  }
  return batches.length ? await usersCol().findOne({ puid: user.puid }) ?? user : user;
}
