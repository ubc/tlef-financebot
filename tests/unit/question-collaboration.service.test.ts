import { ObjectId, type WithId } from 'mongodb';
import * as Y from 'yjs';
import type { QuestionDraft } from '../../server/src/types/collaboration';
import type { Question, QuestionLabel, QuestionVersion, User } from '../../server/src/types/domain';

jest.mock('../../server/src/components/mongodb/collections', () => ({
  coursesCol: jest.fn(), questionsCol: jest.fn(), questionVersionsCol: jest.fn(), questionDraftsCol: jest.fn(), questionPresenceCol: jest.fn(),
}));
jest.mock('../../server/src/services/users.service', () => ({ findUserByPuid: jest.fn() }));
jest.mock('../../server/src/services/capabilities.service', () => ({ hasCapability: jest.fn() }));
jest.mock('../../server/src/services/questions.service', () => ({ editQuestion: jest.fn() }));
jest.mock('../../server/src/services/numeric-verification.service', () => ({ optionValueNamesForVerification: jest.fn(), verifyQuestionNumerics: jest.fn() }));

import { coursesCol, questionsCol, questionVersionsCol, questionDraftsCol, questionPresenceCol } from '../../server/src/components/mongodb/collections';
import { findUserByPuid } from '../../server/src/services/users.service';
import { hasCapability } from '../../server/src/services/capabilities.service';
import { editQuestion } from '../../server/src/services/questions.service';
import { commitQuestionDraft, getQuestionDraft, leaveQuestionDraft, mergeQuestionDraft, rebaseQuestionDraft, updateQuestionPresence } from '../../server/src/services/question-collaboration.service';

const courseId = new ObjectId();
const questionId = new ObjectId();
const versionId = new ObjectId();
const puid = 'INSTRUCTOR';
const otherPuid = 'CO-INSTRUCTOR';
const requestId = '11111111-1111-4111-8111-111111111111';
const current: WithId<QuestionVersion> = {
  _id: versionId, questionId, version: 1, type: 'mcq', stem: 'A shared question', difficulty: 'medium',
  options: [
    { key: 'A', text: 'First', role: 'correct', explanation: 'Correct answer' },
    { key: 'B', text: 'Second', role: 'clearly-wrong', explanation: 'Not correct' },
  ],
  sourceRefs: [], createdBy: puid, createdAt: new Date(),
};
const instructor: User = {
  puid, uid: 'instructor', displayName: 'Course Instructor', email: 'instructor@ubc.ca', affiliations: ['faculty'],
  isAdmin: false, platformInstructor: false, courseRoles: [{ courseId, role: 'instructor' }], createdAt: new Date(), lastLoginAt: new Date(),
};
type Update = { $set?: Record<string, unknown>; $setOnInsert?: Record<string, unknown>; $inc?: Record<string, number>; $unset?: Record<string, unknown> };
type DraftFilter = { _id?: ObjectId; questionId?: ObjectId; revision?: number; baseVersionId?: ObjectId; 'commit.id'?: string; $or?: unknown[] };
let draft: WithId<QuestionDraft> | undefined;
let head: WithId<Question>;
let versions: Array<WithId<QuestionVersion>>;
let gate: (() => Promise<void>) | undefined;
const matchedResults: number[] = [];
const updateDraft = jest.fn(async (filter: DraftFilter, update: Update, options?: { upsert?: boolean }) => {
  if (!draft && options?.upsert && update.$setOnInsert) {
    draft = { _id: new ObjectId(), ...update.$setOnInsert } as unknown as WithId<QuestionDraft>;
    return { matchedCount: 0, upsertedCount: 1 };
  }
  if (gate && update.$set?.state) await gate();
  if (!draft || (filter.revision !== undefined && draft.revision !== filter.revision)
    || (filter.baseVersionId !== undefined && !draft.baseVersionId.equals(filter.baseVersionId))
    || (filter['commit.id'] !== undefined && draft.commit?.id !== filter['commit.id'])
    || (filter.$or && draft.commit && draft.commit.until > new Date())) {
    matchedResults.push(0); return { matchedCount: 0 };
  }
  Object.assign(draft, update.$set ?? {});
  const row = draft as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(update.$inc ?? {})) row[key] = Number(row[key] ?? 0) + value;
  for (const key of Object.keys(update.$unset ?? {})) delete row[key];
  matchedResults.push(1);
  return { matchedCount: 1 };
});
const presenceUpdate = jest.fn();
const presenceDelete = jest.fn();
const updateQuestionHead = jest.fn();
type VersionFilter = { _id?: ObjectId; questionId?: ObjectId; collaborationDraftId?: ObjectId; collaborationCommitId?: string | { $exists: boolean }; 'provenance.kind'?: string; 'provenance.parentVersionId'?: ObjectId };

function matchesVersion(version: WithId<QuestionVersion>, filter: VersionFilter): boolean {
  if (filter._id && !version._id.equals(filter._id)) return false;
  if (filter.questionId && !version.questionId.equals(filter.questionId)) return false;
  if (filter.collaborationDraftId && !version.collaborationDraftId?.equals(filter.collaborationDraftId)) return false;
  if (typeof filter.collaborationCommitId === 'string' && version.collaborationCommitId !== filter.collaborationCommitId) return false;
  if (typeof filter.collaborationCommitId === 'object' && Boolean(version.collaborationCommitId) !== filter.collaborationCommitId.$exists) return false;
  if (filter['provenance.kind'] && version.provenance?.kind !== filter['provenance.kind']) return false;
  if (filter['provenance.parentVersionId'] && (version.provenance?.kind !== 'edited'
    || !version.provenance.parentVersionId.equals(filter['provenance.parentVersionId']))) return false;
  return true;
}

function fromState(state: string): Y.Doc { const doc = new Y.Doc(); Y.applyUpdate(doc, Buffer.from(state, 'base64')); return doc; }
function change(state: string, edit: (doc: Y.Doc) => void): string {
  const doc = fromState(state);
  const vector = Y.encodeStateVector(doc);
  edit(doc);
  const update = Buffer.from(Y.encodeStateAsUpdate(doc, vector)).toString('base64');
  doc.destroy(); return update;
}
function textOf(state: string): string { const doc = fromState(state); const text = doc.getText('stem').toString(); doc.destroy(); return text; }

beforeEach(() => {
  jest.clearAllMocks(); draft = undefined; gate = undefined; matchedResults.length = 0;
  head = { _id: questionId, courseId, state: 'approved', currentVersionId: versionId, currentVersion: 1 } as WithId<Question>;
  versions = [{ ...current }];
  jest.mocked(findUserByPuid).mockImplementation(async identity => ({ ...instructor, puid: identity }));
  jest.mocked(hasCapability).mockResolvedValue(true);
  jest.mocked(coursesCol).mockReturnValue({ findOne: jest.fn(async () => ({ _id: courseId, lifecycle: 'published' })) } as never);
  updateQuestionHead.mockImplementation(async (filter: { currentVersionId?: ObjectId; state?: Question['state'] }, update: Update & { $addToSet?: { labels: QuestionLabel } }) => {
    if ((filter.currentVersionId && !head.currentVersionId.equals(filter.currentVersionId))
      || (filter.state && head.state !== filter.state)) return { matchedCount: 0 };
    Object.assign(head, update.$set ?? {});
    if (update.$addToSet?.labels) head.labels = [...new Set([...(head.labels ?? []), update.$addToSet.labels])];
    for (const key of Object.keys(update.$unset ?? {})) delete (head as unknown as Record<string, unknown>)[key];
    return { matchedCount: 1 };
  });
  jest.mocked(questionsCol).mockReturnValue({ findOne: jest.fn(async () => ({ ...head })), updateOne: updateQuestionHead } as never);
  jest.mocked(questionVersionsCol).mockReturnValue({ findOne: jest.fn(async (filter: VersionFilter) => versions.find(version => matchesVersion(version, filter)) ?? null) } as never);
  jest.mocked(questionDraftsCol).mockReturnValue({ findOne: jest.fn(async () => draft ? { ...draft } : null), updateOne: updateDraft } as never);
  jest.mocked(questionPresenceCol).mockReturnValue({ find: jest.fn(() => ({ toArray: async () => [] })), updateOne: presenceUpdate, deleteOne: presenceDelete } as never);
  jest.mocked(editQuestion).mockImplementation(async (_questionId, patch, by) => {
    const savedId = new ObjectId(); head.currentVersionId = savedId; head.currentVersion = 2;
    const saved: WithId<QuestionVersion> = { ...current, _id: savedId, version: 2, createdBy: by,
      collaborationDraftId: patch.collaborationDraftId, collaborationCommitId: patch.collaborationCommitId,
      provenance: { kind: 'edited', parentVersionId: patch.expectedVersionId ?? versionId },
    };
    versions.push(saved); return saved;
  });
});

describe('durable collaborative question drafts', () => {
  it('describes the draft base schema even when an external save changes the current schema', async () => {
    versions[0] = { ...current, options: [current.options[1], current.options[0]] };
    const initial = await getQuestionDraft(courseId, questionId, puid);
    const externalId = new ObjectId();
    versions.push({ ...current, _id: externalId, version: 2, type: 'true-false', options: [
      { ...current.options[0], key: 'T' }, { ...current.options[1], key: 'F' },
    ] });
    head.currentVersionId = externalId;

    const snapshot = await getQuestionDraft(courseId, questionId, puid);

    expect(initial).toMatchObject({ questionType: 'mcq', optionKeys: ['B', 'A'] });
    expect(snapshot).toMatchObject({ questionType: 'mcq', optionKeys: ['B', 'A'], conflict: true,
      baseVersionId: versionId.toHexString(), currentVersionId: externalId.toHexString() });
    expect(snapshot.state).toBe(initial.state);
  });

  it('returns not found without changing the draft when its persisted base version is missing', async () => {
    const initial = await getQuestionDraft(courseId, questionId, puid);
    versions = [];
    await expect(getQuestionDraft(courseId, questionId, puid)).rejects.toMatchObject({ status: 404 });
    expect(draft!.state).toBe(initial.state); expect(draft!.revision).toBe(0);
  });

  it('rejects editing legacy archived courses that only have archivedAt', async () => {
    jest.mocked(coursesCol).mockReturnValue({ findOne: jest.fn(async () => ({ _id: courseId, published: true, archivedAt: new Date() })) } as never);
    await expect(getQuestionDraft(courseId, questionId, puid)).rejects.toMatchObject({ status: 409 });
    await expect(updateQuestionPresence(courseId, questionId, puid, requestId, 'stem')).rejects.toMatchObject({ status: 409 });
    expect(updateDraft).not.toHaveBeenCalled(); expect(presenceUpdate).not.toHaveBeenCalled();
  });

  it('merges two concurrent text inserts after CAS contention without dropping either edit', async () => {
    const initial = await getQuestionDraft(courseId, questionId, puid);
    const first = change(initial.state, doc => doc.getText('stem').insert(0, 'Alice '));
    const second = change(initial.state, doc => doc.getText('stem').insert(0, 'Bob '));
    const expected = fromState(initial.state);
    Y.applyUpdate(expected, Buffer.from(first, 'base64'));
    Y.applyUpdate(expected, Buffer.from(second, 'base64'));
    let arrivals = 0; let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    gate = async () => { if (++arrivals === 2) release(); if (arrivals <= 2) await barrier; };

    await Promise.all([
      mergeQuestionDraft(courseId, questionId, puid, first),
      mergeQuestionDraft(courseId, questionId, otherPuid, second),
    ]);

    expect(textOf(draft!.state)).toBe(expected.getText('stem').toString());
    expect(draft!.revision).toBe(2);
    expect(matchedResults).toContain(0);
    expect(textOf(draft!.state)).toContain('Alice'); expect(textOf(draft!.state)).toContain('Bob');
    expected.destroy();
  });

  it('replaying an acknowledged binary update does not duplicate text or increment revision', async () => {
    const initial = await getQuestionDraft(courseId, questionId, puid);
    const update = change(initial.state, doc => doc.getText('stem').insert(0, 'One '));
    await mergeQuestionDraft(courseId, questionId, puid, update);
    const savedState = draft!.state;
    await mergeQuestionDraft(courseId, questionId, puid, update);
    expect(draft!.state).toBe(savedState);
    expect(draft!.revision).toBe(1);
    expect(textOf(savedState)).toBe('One A shared question');
  });

  it('rechecks current identity and course capability before allowing updates or presence', async () => {
    const initial = await getQuestionDraft(courseId, questionId, puid);
    const update = change(initial.state, doc => doc.getText('stem').insert(0, 'Blocked '));
    jest.mocked(findUserByPuid).mockResolvedValue({ ...instructor, courseRoles: [] });
    await expect(mergeQuestionDraft(courseId, questionId, puid, update)).rejects.toMatchObject({ status: 403 });
    await expect(updateQuestionPresence(courseId, questionId, puid, requestId, 'stem')).rejects.toMatchObject({ status: 403 });
    jest.mocked(findUserByPuid).mockResolvedValue(instructor);
    jest.mocked(hasCapability).mockResolvedValue(false);
    await expect(getQuestionDraft(courseId, questionId, puid)).rejects.toMatchObject({ status: 403 });
    expect(draft!.state).toBe(initial.state); expect(draft!.revision).toBe(0);
    expect(presenceUpdate).not.toHaveBeenCalled();
  });

  it('retains the draft on stale revision or an externally changed saved version', async () => {
    const initial = await getQuestionDraft(courseId, questionId, puid);
    await mergeQuestionDraft(courseId, questionId, puid, change(initial.state, doc => doc.getText('stem').insert(0, 'Saved draft ')));
    const state = draft!.state;
    await expect(commitQuestionDraft(courseId, questionId, puid, 0, requestId)).rejects.toMatchObject({ status: 409 });
    head.currentVersionId = new ObjectId();
    expect((await getQuestionDraft(courseId, questionId, puid)).conflict).toBe(true);
    await expect(commitQuestionDraft(courseId, questionId, puid, 1, requestId)).rejects.toMatchObject({ status: 409 });
    expect(draft!.state).toBe(state); expect(editQuestion).not.toHaveBeenCalled();
  });

  it('an unexpired commit lease blocks edits and a second submit until it expires', async () => {
    const initial = await getQuestionDraft(courseId, questionId, puid);
    draft!.commit = { id: requestId, by: otherPuid, until: new Date(Date.now() + 30_000) };
    const update = change(initial.state, doc => doc.getText('stem').insert(0, 'After lease '));
    await expect(mergeQuestionDraft(courseId, questionId, puid, update)).rejects.toMatchObject({ status: 409 });
    await expect(commitQuestionDraft(courseId, questionId, puid, 0, '22222222-2222-4222-8222-222222222222')).rejects.toMatchObject({ status: 409 });
    expect(draft!.state).toBe(initial.state);
    draft!.commit.until = new Date(0);
    await mergeQuestionDraft(courseId, questionId, puid, update);
    expect(draft!.revision).toBe(1); expect(draft!.commit).toBeUndefined();
  });

  it('commits the exact draft once and supports retry after a lost response', async () => {
    await getQuestionDraft(courseId, questionId, puid);
    const first = await commitQuestionDraft(courseId, questionId, puid, 0, requestId);
    const retry = await commitQuestionDraft(courseId, questionId, puid, 0, requestId);
    expect(retry).toEqual(first);
    expect(editQuestion).toHaveBeenCalledTimes(1);
    expect(editQuestion).toHaveBeenCalledWith(questionId, expect.objectContaining({ stem: current.stem, expectedVersionId: versionId, submitForReview: true }), puid);
    expect(draft!.commit).toBeUndefined(); expect(draft!.revision).toBe(1);
  });

  it('recovers a saved version after failure to advance the draft, without committing twice', async () => {
    await getQuestionDraft(courseId, questionId, puid);
    const normal = updateDraft.getMockImplementation()!;
    let failed = false;
    updateDraft.mockImplementation(async (filter, update, options) => {
      if (!failed && filter['commit.id'] === requestId && update.$set?.baseVersionId) {
        failed = true; throw new Error('Simulated storage interruption');
      }
      return normal(filter, update, options);
    });
    try {
      await expect(commitQuestionDraft(courseId, questionId, puid, 0, requestId)).rejects.toThrow('Simulated storage interruption');
      const snapshot = await getQuestionDraft(courseId, questionId, puid);
      expect(snapshot.conflict).toBe(false);
      expect(snapshot.baseVersionId).toBe(head.currentVersionId.toHexString());
      expect(snapshot.revision).toBe(1);
      await expect(commitQuestionDraft(courseId, questionId, puid, 0, requestId)).resolves.toEqual({ versionId: head.currentVersionId.toHexString() });
      expect(editQuestion).toHaveBeenCalledTimes(1);
    } finally { updateDraft.mockImplementation(normal); }
  });

  it('recovers an inserted shared version after interruption before advancing the question head', async () => {
    await getQuestionDraft(courseId, questionId, puid);
    const preparedId = new ObjectId();
    jest.mocked(editQuestion).mockImplementationOnce(async (_questionId, patch) => {
      versions.push({ ...current, _id: preparedId, version: 2,
        collaborationDraftId: patch.collaborationDraftId, collaborationCommitId: patch.collaborationCommitId,
        provenance: { kind: 'edited', parentVersionId: patch.expectedVersionId! },
      });
      throw new Error('Interrupted before head update');
    });
    await expect(commitQuestionDraft(courseId, questionId, puid, 0, requestId)).rejects.toThrow('Interrupted before head update');
    expect(head.currentVersionId).toEqual(versionId);

    const recovered = await getQuestionDraft(courseId, questionId, puid);

    expect(head).toMatchObject({ currentVersionId: preparedId, currentVersion: 2, state: 'pending-review', labels: ['manually-edited'] });
    expect(recovered).toMatchObject({ baseVersionId: preparedId.toHexString(), currentVersionId: preparedId.toHexString(), revision: 1, conflict: false });
    await expect(commitQuestionDraft(courseId, questionId, puid, 0, requestId)).resolves.toEqual({ versionId: preparedId.toHexString() });
    expect(editQuestion).toHaveBeenCalledTimes(1); expect(versions).toHaveLength(2);
  });

  it.each(['before read', 'during recovery CAS'])('does not recover an interrupted save when question archival intervenes %s', async stage => {
    const initial = await getQuestionDraft(courseId, questionId, puid);
    const preparedId = new ObjectId();
    versions.push({ ...current, _id: preparedId, version: 2, collaborationDraftId: draft!._id, collaborationCommitId: requestId,
      provenance: { kind: 'edited', parentVersionId: versionId },
    });
    if (stage === 'before read') head.state = 'archived';
    else updateQuestionHead.mockImplementationOnce(async () => { head.state = 'archived'; return { matchedCount: 0 }; });

    await expect(getQuestionDraft(courseId, questionId, puid)).rejects.toMatchObject({ status: 409 });

    expect(head.currentVersionId).toEqual(versionId); expect(head.state).toBe('archived');
    expect(draft!.state).toBe(initial.state); expect(draft!.revision).toBe(0);
    expect(draft!.baseVersionId).toEqual(versionId); expect(editQuestion).not.toHaveBeenCalled();
  });

  it('rebases only the confirmed saved version and draft revision while retaining shared text', async () => {
    const initial = await getQuestionDraft(courseId, questionId, puid);
    const savedId = new ObjectId();
    versions.push({ ...current, _id: savedId, version: 2, stem: 'External edit' });
    head.currentVersionId = savedId;
    await expect(rebaseQuestionDraft(courseId, questionId, puid, 0, versionId)).rejects.toMatchObject({ status: 409 });
    await expect(rebaseQuestionDraft(courseId, questionId, puid, 1, savedId)).rejects.toMatchObject({ status: 409 });
    const result = await rebaseQuestionDraft(courseId, questionId, puid, 0, savedId);
    expect(result.conflict).toBe(false); expect(result.revision).toBe(1);
    expect(result.state).toBe(initial.state); expect(result.baseVersionId).toBe(savedId.toHexString());
    expect(editQuestion).not.toHaveBeenCalled();
  });

  it('refuses rebase when external changes alter answer keys or question type', async () => {
    const initial = await getQuestionDraft(courseId, questionId, puid);
    const savedId = new ObjectId();
    versions.push({ ...current, _id: savedId, version: 2, options: [current.options[0]] });
    head.currentVersionId = savedId;
    await expect(rebaseQuestionDraft(courseId, questionId, puid, 0, savedId)).rejects.toMatchObject({ status: 409 });
    expect(draft!.state).toBe(initial.state); expect(draft!.revision).toBe(0);
  });

  it('rejects invalid binary updates without damaging state', async () => {
    const initial = await getQuestionDraft(courseId, questionId, puid);
    await expect(mergeQuestionDraft(courseId, questionId, puid, 'not base64!')).rejects.toMatchObject({ status: 400 });
    await expect(mergeQuestionDraft(courseId, questionId, puid, Buffer.from('bad binary').toString('base64'))).rejects.toMatchObject({ status: 400 });
    expect(draft!.state).toBe(initial.state); expect(draft!.revision).toBe(0);
  });

  it('preserves invalid answer edits while rejecting commit and releasing its lease', async () => {
    const initial = await getQuestionDraft(courseId, questionId, puid);
    await mergeQuestionDraft(courseId, questionId, puid, change(initial.state, doc => doc.getMap<string>('settings').set('role:B', 'correct')));
    const state = draft!.state;
    await expect(commitQuestionDraft(courseId, questionId, puid, 1, requestId)).rejects.toMatchObject({ status: 400 });
    expect(draft!.state).toBe(state); expect(draft!.commit).toBeUndefined();
    expect(editQuestion).not.toHaveBeenCalled();
  });

  it('keeps presence attributable to the signed-in user and expires it', async () => {
    const started = Date.now();
    await updateQuestionPresence(courseId, questionId, puid, requestId, 'stem');
    expect(presenceUpdate).toHaveBeenCalledWith({ questionId, clientId: requestId, puid }, expect.objectContaining({ $set: expect.objectContaining({ courseId, name: instructor.displayName, field: 'stem', expiresAt: expect.any(Date) }) }), { upsert: true });
    expect(presenceUpdate.mock.calls[0][1].$set.expiresAt.getTime()).toBeGreaterThanOrEqual(started + 30_000);
    await leaveQuestionDraft(questionId, puid, requestId);
    expect(presenceDelete).toHaveBeenCalledWith({ questionId, puid, clientId: requestId });
  });
});
