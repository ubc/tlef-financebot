import type { ObjectId, WithId } from 'mongodb';
import * as Y from 'yjs';
import { coursesCol, questionsCol, questionVersionsCol, questionDraftsCol, questionPresenceCol } from '../components/mongodb/collections';
import type { QuestionDraft } from '../types/collaboration';
import type { Difficulty, OptionRole, QuestionVersion } from '../types/domain';
import { findUserByPuid } from './users.service';
import { hasCapability } from './capabilities.service';
import { courseLifecycle } from './courses.service';
import { editQuestion } from './questions.service';
import { optionValueNamesForVerification, verifyQuestionNumerics } from './numeric-verification.service';

const fail = (message: string, status = 409): never => { throw Object.assign(new Error(message), { status }); };
const encode = (doc: Y.Doc): string => Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
function decode(state: string): Y.Doc {
  const doc = new Y.Doc();
  try { Y.applyUpdate(doc, new Uint8Array(Buffer.from(state, 'base64'))); return doc; }
  catch { doc.destroy(); return fail('Invalid shared draft update.', 400); }
}

/** Re-read authorization for every update and stream tick, including already-open sessions. */
export async function authorizeQuestionDraft(courseId: ObjectId, questionId: ObjectId, puid: string) {
  const user = await findUserByPuid(puid);
  if (!user || (!user.isAdmin && !user.courseRoles.some(role => role.role === 'instructor' && role.courseId.equals(courseId)))
    || !await hasCapability(user, courseId, 'question.approve')) return fail('Course editing access is no longer available.', 403);
  const [question, course] = await Promise.all([questionsCol().findOne({ _id: questionId, courseId }), coursesCol().findOne({ _id: courseId })]);
  if (!question || !course) return fail('Question not found.', 404);
  if (question.state === 'archived' || courseLifecycle(course) === 'archived') return fail('Restore this question and course before editing.');
  return { user, question };
}

function seed(version: WithId<QuestionVersion>): string {
  const doc = new Y.Doc();
  doc.getText('stem').insert(0, version.stem);
  doc.getMap<string>('settings').set('difficulty', version.difficulty);
  for (const option of version.options) {
    doc.getText(`option:${option.key}:text`).insert(0, option.text);
    doc.getText(`option:${option.key}:explanation`).insert(0, option.explanation);
    doc.getMap<string>('settings').set(`role:${option.key}`, option.role);
  }
  const state = encode(doc); doc.destroy(); return state;
}

async function draftFor(courseId: ObjectId, questionId: ObjectId, puid: string): Promise<WithId<QuestionDraft>> {
  let { question } = await authorizeQuestionDraft(courseId, questionId, puid);
  let draft = await questionDraftsCol().findOne({ questionId });
  if (draft) {
    // Finish an explicit save interrupted after the immutable version insert.
    // Only the unchanged parent can advance; every recovered shared version
    // returns to review. A racing original writer recognizes this same version
    // as committed instead of deleting a version now referenced by the head.
    if (draft.baseVersionId.equals(question.currentVersionId)) {
      const prepared = await questionVersionsCol().findOne({ questionId, collaborationDraftId: draft._id,
        'provenance.kind': 'edited', 'provenance.parentVersionId': draft.baseVersionId,
        collaborationCommitId: { $exists: true } });
      if (prepared) {
        await questionsCol().updateOne({ _id: questionId, currentVersionId: draft.baseVersionId, state: question.state }, {
          $set: { currentVersionId: prepared._id, currentVersion: prepared.version, state: 'pending-review', updatedAt: new Date() },
          $addToSet: { labels: 'manually-edited' }, $unset: { agentDecision: '' },
        });
        const refreshed = await questionsCol().findOne({ _id: questionId, courseId });
        if (!refreshed || refreshed.state === 'archived') return fail('Question editing is no longer available.');
        question = refreshed;
      }
    }
    // Recover an acknowledged head write even if the process stopped before
    // advancing the draft. The immutable version is the recovery journal.
    if (!draft.baseVersionId.equals(question.currentVersionId)) {
      const saved = await questionVersionsCol().findOne({ _id: question.currentVersionId });
      if (saved?.collaborationDraftId?.equals(draft._id) && saved.collaborationCommitId
        && saved.provenance?.kind === 'edited' && saved.provenance.parentVersionId.equals(draft.baseVersionId)) {
        await questionDraftsCol().updateOne({ _id: draft._id, baseVersionId: draft.baseVersionId }, {
          $set: { baseVersionId: saved._id, lastCommit: { id: saved.collaborationCommitId, versionId: saved._id } },
          $inc: { revision: 1 }, $unset: { commit: '' },
        });
        draft = await questionDraftsCol().findOne({ _id: draft._id }) ?? draft;
      }
    }
    return draft;
  }
  const current = await questionVersionsCol().findOne({ _id: question.currentVersionId });
  if (!current) return fail('Question version not found.', 404);
  try {
    await questionDraftsCol().updateOne({ questionId }, { $setOnInsert: {
      questionId, courseId, baseVersionId: current._id, state: seed(current), revision: 0,
      updatedAt: new Date(), updatedBy: puid,
    } }, { upsert: true });
  } catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
  draft = await questionDraftsCol().findOne({ questionId });
  if (!draft) return fail('Shared draft could not be opened. Please retry.', 503);
  return draft;
}

export async function getQuestionDraft(courseId: ObjectId, questionId: ObjectId, puid: string) {
  const draft = await draftFor(courseId, questionId, puid);
  const [question, base] = await Promise.all([
    questionsCol().findOne({ _id: questionId, courseId }),
    questionVersionsCol().findOne({ _id: draft.baseVersionId, questionId }),
  ]);
  if (!question) return fail('Question not found.', 404);
  if (!base) return fail('Shared draft base version not found.', 404);
  const presence = await questionPresenceCol().find({ questionId, expiresAt: { $gt: new Date() } }).toArray();
  return { state: draft.state, revision: draft.revision, baseVersionId: draft.baseVersionId.toHexString(),
    questionType: base.type, optionKeys: base.options.map(option => option.key),
    currentVersionId: question.currentVersionId.toHexString(), conflict: !draft.baseVersionId.equals(question.currentVersionId),
    updatedAt: draft.updatedAt, committing: Boolean(draft.commit && draft.commit.until > new Date()),
    collaborators: presence.map(item => ({ clientId: item.clientId, name: item.name, field: item.field })) };
}

export async function updateQuestionPresence(courseId: ObjectId, questionId: ObjectId, puid: string, clientId: string, field: string): Promise<void> {
  const { user } = await authorizeQuestionDraft(courseId, questionId, puid);
  await questionPresenceCol().updateOne({ questionId, clientId, puid }, { $set: {
    courseId, name: user.displayName, field: field.slice(0, 100), expiresAt: new Date(Date.now() + 30_000),
  }, $setOnInsert: { questionId, clientId, puid } }, { upsert: true });
}

export async function leaveQuestionDraft(questionId: ObjectId, puid: string, clientId: string): Promise<void> {
  await questionPresenceCol().deleteOne({ questionId, puid, clientId });
}

/** Binary CRDT updates are merged against durable state under CAS. Retrying an
 * acknowledged update is idempotent, including after a lost HTTP response. */
export async function mergeQuestionDraft(courseId: ObjectId, questionId: ObjectId, puid: string, update: string) {
  if (update.length > 90_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(update)) return fail('Shared edit is too large or invalid.', 400);
  for (let attempt = 0; attempt < 12; attempt++) {
    const draft = await draftFor(courseId, questionId, puid);
    if (draft.commit && draft.commit.until > new Date()) return fail('A teammate is submitting this draft. Your changes are retained; retry shortly.');
    const doc = decode(draft.state);
    let state: string;
    try {
      Y.applyUpdate(doc, new Uint8Array(Buffer.from(update, 'base64')));
      state = encode(doc);
      if (state.length > 2_000_000 || doc.share.size > 32) return fail('Shared draft is too large.', 413);
    } catch (error) { if ((error as { status?: number }).status) throw error; return fail('Invalid shared draft update.', 400); }
    finally { doc.destroy(); }
    if (state === draft.state) return getQuestionDraft(courseId, questionId, puid);
    const result = await questionDraftsCol().updateOne({ _id: draft._id, revision: draft.revision,
      $or: [{ commit: { $exists: false } }, { 'commit.until': { $lte: new Date() } }] },
    { $set: { state, updatedAt: new Date(), updatedBy: puid }, $inc: { revision: 1 }, $unset: { commit: '' } });
    if (result.matchedCount === 1) return getQuestionDraft(courseId, questionId, puid);
  }
  return fail('The draft is busy. Your changes are retained; retry shortly.');
}

/** Saving a shared draft is an explicit version boundary. A short persisted
 * lease prevents edits being acknowledged while that exact snapshot commits. */
export async function commitQuestionDraft(courseId: ObjectId, questionId: ObjectId, puid: string, expectedRevision: number, requestId: string) {
  const draft = await draftFor(courseId, questionId, puid);
  const { question } = await authorizeQuestionDraft(courseId, questionId, puid);
  if (draft.lastCommit?.id === requestId) return { versionId: draft.lastCommit.versionId.toHexString() };
  const previousCommit = await questionVersionsCol().findOne({ questionId, collaborationDraftId: draft._id, collaborationCommitId: requestId });
  if (previousCommit && question.currentVersion >= previousCommit.version) return { versionId: previousCommit._id.toHexString() };
  if (previousCommit) return fail('A previous save is still recovering. Your shared draft is retained; retry shortly.');
  if (draft.revision !== expectedRevision) return fail('A teammate updated this draft. Review the latest changes and submit again.');
  if (!draft.baseVersionId.equals(question.currentVersionId)) return fail('The saved question changed outside this draft. Your shared draft is retained; compare it with the latest version before continuing.');
  const claimed = await questionDraftsCol().updateOne({ _id: draft._id, revision: expectedRevision,
    $or: [{ commit: { $exists: false } }, { 'commit.until': { $lte: new Date() } }] },
  { $set: { commit: { id: requestId, by: puid, until: new Date(Date.now() + 60_000) } } });
  if (claimed.matchedCount !== 1) return fail('A teammate is submitting this draft. Please retry.');
  const doc = decode(draft.state);
  try {
    const current = await questionVersionsCol().findOne({ _id: draft.baseVersionId });
    if (!current) return fail('Question version not found.', 404);
    const settings = doc.getMap<string>('settings');
    const difficulty = settings.get('difficulty') as Difficulty;
    const stem = doc.getText('stem').toString();
    const options = current.options.map(option => ({ ...option,
      text: doc.getText(`option:${option.key}:text`).toString(),
      explanation: doc.getText(`option:${option.key}:explanation`).toString(),
      role: settings.get(`role:${option.key}`) as OptionRole,
    }));
    if (!stem.trim() || stem.length > 50_000 || !['easy', 'medium', 'hard'].includes(difficulty)
      || options.some(option => !option.text.trim() || option.text.length > 30_000 || option.explanation.length > 50_000
        || !['correct', 'common-misconception', 'partially-correct', 'clearly-wrong'].includes(option.role))
      || options.filter(option => option.role === 'correct').length !== 1) return fail('Complete the question and choose exactly one correct answer before submitting.', 400);
    let verification: QuestionVersion['verification'];
    if (current.numericKind === 'numeric' || current.derivedValues?.length) {
      const names = optionValueNamesForVerification(options.map(option => option.text), (current.derivedValues ?? []).map(value => value.name));
      if (!names.ok) return fail(names.error, 400);
      const verified = verifyQuestionNumerics({ slots: current.paramSlots ?? [], derivedValues: current.derivedValues ?? [], optionValueNames: names.names, optionCurrency: names.currency });
      if (!verified.ok) return fail(verified.error, 400);
      verification = verified.verification;
    }
    const version = await editQuestion(questionId, { stem, options, difficulty, expectedVersionId: draft.baseVersionId,
      collaborationDraftId: draft._id, collaborationCommitId: requestId,
      expectedState: question.state, submitForReview: true, ...(verification ? { verification } : {}) }, puid);
    await questionDraftsCol().updateOne({ _id: draft._id, 'commit.id': requestId }, {
      $set: { baseVersionId: version._id, updatedAt: new Date(), updatedBy: puid, lastCommit: { id: requestId, versionId: version._id } },
      $inc: { revision: 1 }, $unset: { commit: '' },
    });
    return { versionId: version._id.toHexString() };
  } finally {
    doc.destroy();
    await questionDraftsCol().updateOne({ _id: draft._id, 'commit.id': requestId }, { $unset: { commit: '' } });
  }
}

/** An explicit comparison/confirmation is required before retaining shared
 * content over a separately saved version. Both revisions must still match. */
export async function rebaseQuestionDraft(courseId: ObjectId, questionId: ObjectId, puid: string, expectedRevision: number, expectedVersionId: ObjectId) {
  const draft = await draftFor(courseId, questionId, puid);
  const { question } = await authorizeQuestionDraft(courseId, questionId, puid);
  if (!question.currentVersionId.equals(expectedVersionId)) return fail('The saved question changed again. Compare the latest version first.');
  const [base, current] = await Promise.all([
    questionVersionsCol().findOne({ _id: draft.baseVersionId }), questionVersionsCol().findOne({ _id: expectedVersionId }),
  ]);
  if (!base || !current || base.type !== current.type || base.options.map(o => o.key).sort().join(',') !== current.options.map(o => o.key).sort().join(','))
    return fail('The question structure changed. Download this draft and merge it in the full editor.');
  const result = await questionDraftsCol().updateOne({ _id: draft._id, revision: expectedRevision,
    $or: [{ commit: { $exists: false } }, { 'commit.until': { $lte: new Date() } }] }, {
    $set: { baseVersionId: expectedVersionId, updatedAt: new Date(), updatedBy: puid },
    $inc: { revision: 1 }, $unset: { commit: '' },
  });
  if (result.matchedCount !== 1) return fail('The shared draft changed. Review it again before continuing.');
  return getQuestionDraft(courseId, questionId, puid);
}
