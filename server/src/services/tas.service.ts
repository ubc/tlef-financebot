import { ObjectId, type WithId } from 'mongodb';
import {
  coursesCol,
  flagsCol,
  questionsCol,
  taInvitesCol,
  usersCol,
} from '../components/mongodb/collections';
import { defineJob, scheduleRecurring } from '../components/jobs';
import type {
  Capability,
  Flag,
  Question,
  TaInvite,
  User,
} from '../types/domain';
import { setCourseUserCapabilities } from './capabilities.service';
import { editQuestion } from './questions.service';

const UBC_EMAIL = /^[^\s@]+@(?:[^\s@.]+\.)*ubc\.ca$/i;

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!UBC_EMAIL.test(normalized)) throw new Error('ta-invalid-ubc-email');
  return normalized;
}

export async function addTa(
  courseId: ObjectId,
  email: string,
): Promise<WithId<TaInvite>> {
  const normalized = normalizeEmail(email);
  const existing = await taInvitesCol().findOne({ courseId, email: normalized });
  if (existing && existing.status !== 'expired') throw new Error('ta-invite-duplicate');
  const now = new Date();
  if (existing) {
    const updated = await taInvitesCol().findOneAndUpdate(
      { _id: existing._id },
      {
        $set: { status: 'pending', invitedAt: now, updatedAt: now },
        $unset: { activatedPuid: '' },
      },
      { returnDocument: 'after' },
    );
    if (!updated) throw new Error('ta-invite-save-failed');
    return updated;
  }
  const doc: TaInvite = {
    courseId,
    email: normalized,
    status: 'pending',
    invitedAt: now,
    updatedAt: now,
  };
  const { insertedId } = await taInvitesCol().insertOne(doc);
  return { _id: insertedId, ...doc };
}

export async function listTas(courseId: ObjectId): Promise<Array<WithId<TaInvite> & {
  displayName?: string;
}>> {
  const invites = await taInvitesCol().find({ courseId }).sort({ invitedAt: -1 }).toArray();
  const puids = invites.flatMap((invite) => invite.activatedPuid ? [invite.activatedPuid] : []);
  const users = puids.length ? await usersCol().find({ puid: { $in: puids } }).toArray() : [];
  const nameByPuid = new Map(users.map((user) => [user.puid, user.displayName]));
  return invites.map((invite) => ({
    ...invite,
    ...(invite.activatedPuid && nameByPuid.get(invite.activatedPuid)
      ? { displayName: nameByPuid.get(invite.activatedPuid) }
      : {}),
  }));
}

/** Activate every pending invitation matching the canonical SAML email. */
export async function activatePendingTaInvites(user: User): Promise<User> {
  const email = (user.email ?? '').trim().toLowerCase();
  if (!email) return user;
  const invites = await taInvitesCol().find({ email, status: 'pending' }).toArray();
  if (invites.length === 0) return user;
  const now = new Date();
  for (const invite of invites) {
    await usersCol().updateOne(
      { puid: user.puid },
      { $addToSet: { courseRoles: { courseId: invite.courseId, role: 'ta' } } },
    );
    await taInvitesCol().updateOne(
      { _id: invite._id, status: 'pending' },
      { $set: { status: 'active', activatedPuid: user.puid, updatedAt: now } },
    );
    if (invite.permissions) {
      await setCourseUserCapabilities(invite.courseId, user.puid, invite.permissions, user.puid);
    }
  }
  return (await usersCol().findOne({ puid: user.puid })) ?? user;
}

export async function setTaPermissions(
  courseId: ObjectId,
  puid: string,
  permissions: Partial<Record<Capability, boolean>>,
  actorPuid: string,
): Promise<void> {
  const user = await usersCol().findOne({
    puid,
    courseRoles: { $elemMatch: { courseId, role: 'ta' } },
  });
  if (!user) throw new Error('ta-not-active');
  await setCourseUserCapabilities(courseId, puid, permissions, actorPuid);
  await taInvitesCol().updateOne(
    { courseId, activatedPuid: puid },
    { $set: { permissions, updatedAt: new Date() } },
  );
}

export async function expireTas(courseId: ObjectId): Promise<number> {
  const active = await taInvitesCol().find({ courseId, status: { $in: ['active', 'pending'] } }).toArray();
  await taInvitesCol().updateMany(
    { courseId, status: { $in: ['active', 'pending'] } },
    { $set: { status: 'expired', updatedAt: new Date() } },
  );
  await usersCol().updateMany(
    { courseRoles: { $elemMatch: { courseId, role: 'ta' } } },
    { $pull: { courseRoles: { courseId, role: 'ta' } } },
  );
  return active.length;
}

export async function expireEndedCourseTas(now = new Date()): Promise<number> {
  const ended = await coursesCol().find({ termEnd: { $lte: now } }, { projection: { _id: 1 } }).toArray();
  let expired = 0;
  for (const course of ended) expired += await expireTas(course._id);
  return expired;
}

const TA_EXPIRY_JOB = 'tas.term-expiry';

/** Register only after Agenda starts; term-end expiration is intentionally idempotent. */
export async function registerTaJobs(): Promise<void> {
  defineJob(TA_EXPIRY_JOB, async () => { await expireEndedCourseTas(); });
  await scheduleRecurring(TA_EXPIRY_JOB, '24 hours');
}

export async function reinviteTa(courseId: ObjectId, puid: string): Promise<WithId<TaInvite>> {
  const invite = await taInvitesCol().findOne({ courseId, activatedPuid: puid });
  if (!invite) throw new Error('ta-invite-not-found');
  const now = new Date();
  await usersCol().updateOne(
    { puid },
    { $addToSet: { courseRoles: { courseId, role: 'ta' } } },
  );
  const updated = await taInvitesCol().findOneAndUpdate(
    { _id: invite._id },
    { $set: { status: 'active', invitedAt: now, updatedAt: now } },
    { returnDocument: 'after' },
  );
  if (!updated) throw new Error('ta-invite-save-failed');
  if (updated.permissions) {
    await setCourseUserCapabilities(courseId, puid, updated.permissions, puid);
  }
  return updated;
}

export async function suggestQuestionEdit(
  questionId: ObjectId,
  puid: string,
  patch: Record<string, unknown>,
): Promise<NonNullable<Question['suggestions']>[number]> {
  if (Object.keys(patch).length === 0) throw new Error('suggestion-patch-required');
  const suggestion: NonNullable<Question['suggestions']>[number] = {
    id: new ObjectId(),
    puid,
    patch,
    status: 'pending',
    at: new Date(),
  };
  const result = await questionsCol().updateOne(
    { _id: questionId },
    { $push: { suggestions: suggestion }, $set: { updatedAt: suggestion.at } },
  );
  if (result.matchedCount !== 1) throw new Error('question-not-found');
  return suggestion;
}

export async function resolveQuestionSuggestion(
  questionId: ObjectId,
  suggestionId: ObjectId,
  action: 'accept' | 'discard',
  byPuid: string,
): Promise<void> {
  const question = await questionsCol().findOne({ _id: questionId });
  if (!question) throw new Error('question-not-found');
  const suggestion = question.suggestions?.find((item) => item.id.equals(suggestionId));
  if (!suggestion) throw new Error('suggestion-not-found');
  if (suggestion.status !== 'pending') throw new Error('suggestion-already-resolved');
  if (action === 'accept') {
    await editQuestion(
      questionId,
      suggestion.patch as Parameters<typeof editQuestion>[1],
      byPuid,
    );
  }
  const result = await questionsCol().updateOne(
    { _id: questionId, 'suggestions.id': suggestionId, 'suggestions.status': 'pending' },
    {
      $set: {
        'suggestions.$.status': action === 'accept' ? 'accepted' : 'discarded',
        'suggestions.$.resolvedAt': new Date(),
        'suggestions.$.resolvedBy': byPuid,
      },
    },
  );
  if (result.matchedCount !== 1) throw new Error('suggestion-conflict');
}

export async function escalateFlag(
  flagId: ObjectId,
  puid: string,
  recommendation: 'correct' | 'archive' | 'clear',
  note?: string,
): Promise<WithId<Flag>> {
  const at = new Date();
  const flag = await flagsCol().findOneAndUpdate(
    { _id: flagId, state: 'open' },
    {
      $set: {
        state: 'escalated',
        taRecommendation: { recommendation, ...(note?.trim() ? { note: note.trim() } : {}), puid, at },
      },
    },
    { returnDocument: 'after' },
  );
  if (!flag) throw new Error('invalid-flag-transition');
  return flag;
}

export async function proactivelyEscalateQuestion(
  questionId: ObjectId,
  puid: string,
  reasonCategory: string,
  note?: string,
): Promise<WithId<Flag>> {
  const question = await questionsCol().findOne({ _id: questionId });
  if (!question) throw new Error('question-not-found');
  const _id = new ObjectId();
  const flag: Flag = {
    courseId: question.courseId,
    questionId,
    questionVersionId: question.currentVersionId,
    puid: `ta:${puid}`,
    source: 'ta',
    raisedBy: 'ta',
    reason: `${reasonCategory}${note?.trim() ? `: ${note.trim()}` : ''}`,
    state: 'escalated',
    createdAt: new Date(),
  };
  await flagsCol().insertOne({ _id, ...flag });
  return { _id, ...flag };
}
