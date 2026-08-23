import type { WithId } from 'mongodb';
import { ObjectId } from 'mongodb';
import {
  attemptsCol,
  auditCol,
  examAttemptsCol,
  flagsCol,
  questionsCol,
  questionVersionsCol,
  reviewBookCol,
} from '../components/mongodb/collections';
import { drawSeed } from './params.service';
import { shuffleOptions } from './option-order.service';
import { canTransition } from '../types/domain';
import type {
  Question,
  QuestionVersion,
  QuestionOption,
  QuestionType,
  PublicationState,
  QuestionLabel,
  Difficulty,
  ParamSlot,
  DerivedValue,
  NumericVerification,
} from '../types/domain';

// -----------------------------------------------------------------------------
// Question service (IN-Q03, IN-Q04, IN-Q07, IN-Q13): versioning, option
// invariants, and publication-state transitions. Every edit creates a NEW
// QuestionVersion — prior versions are never mutated or deleted (PRD §2).
// Generation never publishes: questions always enter as 'draft'. Only the
// routes layer (Task 5) talks HTTP; this file is pure service logic. See
// server/src/services/AGENTS.md.
// -----------------------------------------------------------------------------

type ContentKey = 'stem' | 'options' | 'difficulty' | 'paramSlots' | 'generateScript'
  | 'derivedValues' | 'numericKind';

/** Enforces MCQ/T-F option shape (PRD §9.1). T/F wrong-role is coerced, never rejected. */
function assertOptionInvariants(type: QuestionType, options: QuestionOption[]): QuestionOption[] {
  const expected = type === 'mcq' ? 4 : 2;
  if (options.length !== expected) throw new Error(`invalid-options:expected-${expected}-options`);
  const correct = options.filter((o) => o.role === 'correct');
  if (correct.length !== 1) throw new Error('invalid-options:exactly-one-correct');
  if (type === 'true-false') {
    // A T/F distractor is by design a plausible wrong statement (PRD §9.1).
    return options.map((o) => (o.role === 'correct' ? o : { ...o, role: 'common-misconception' as const }));
  }
  return options;
}

/**
 * Generation pipeline entry point (and manual authoring): inserts a Question
 * head (always 'draft') and its QuestionVersion v1. Both ids are pre-generated
 * so neither insert has to go second (Question.currentVersionId and
 * QuestionVersion.questionId are both required, non-optional).
 */
export async function createQuestion(input: {
  courseId: ObjectId;
  loIds: ObjectId[];
  themeIds: ObjectId[];
  type: QuestionType;
  stem: string;
  options: QuestionOption[];
  difficulty: Difficulty;
  sourceRefs?: QuestionVersion['sourceRefs'];
  createdBy: string;
  generationPrompt?: string;
  generateScript?: string;
  // Parameterization + its verification proof (design spec 2026-08-05). A
  // numerical question without `verification` never serves — see
  // numeric-gate.service.ts — so callers that build one must verify it and
  // pass the proof through here.
  paramSlots?: ParamSlot[];
  derivedValues?: DerivedValue[];
  numericKind?: 'numeric' | 'conceptual';
  verification?: NumericVerification;
  agentDecision?: Question['agentDecision'];
  labels?: QuestionLabel[];
  templateFamilyId?: ObjectId;
  provenance?: QuestionVersion['provenance'];
  // Set by callers that have ALREADY shuffled, so the order they shuffled is
  // the order stored. The generation pipeline needs this: its validator and
  // reviewer cite options by letter, so they must read the final order, which
  // means the shuffle has to happen upstream of them (generateValidQuestion).
  // Defaults to false, so a caller that forgets it still gets a shuffle — the
  // safe direction, since shuffling twice is harmless but never shuffling is
  // the bug this exists to prevent.
  optionsAlreadyShuffled?: boolean;
}): Promise<{ questionId: ObjectId; version: WithId<QuestionVersion> }> {
  const validated = assertOptionInvariants(input.type, input.options);
  // Shuffled HERE, at version creation, and nowhere else. The hook that reads
  // naturally is approval, and it is the wrong one: PUBLICATION_TRANSITIONS
  // allows approved -> paused -> approved, so a re-approval would reorder a
  // version that has already been served and already has AttemptRecords. That
  // silently corrupts answerDistributions (analytics.service.ts), which maps
  // historical `selectedKey` counts onto the CURRENT version's options and
  // roles — the counts survive, their pairing with roles does not, and the
  // chart still renders. Versions are immutable and nothing is served before
  // approval, so shuffling at creation is once-and-only-once by construction:
  // no guard is needed, and it can never touch a version that has attempts.
  // True/False keeps T then F — "False. True." reads as a mistake, and with two
  // positions a shuffle buys nothing anyway.
  const options = input.type === 'mcq' && !input.optionsAlreadyShuffled
    ? shuffleOptions(validated, drawSeed())
    : validated;

  const questionId = new ObjectId();
  const versionId = new ObjectId();
  const now = new Date();

  const version: QuestionVersion = {
    questionId,
    version: 1,
    type: input.type,
    stem: input.stem,
    options,
    difficulty: input.difficulty,
    sourceRefs: input.sourceRefs ?? [],
    provenance: input.provenance ?? { kind: 'manual' },
    createdBy: input.createdBy,
    createdAt: now,
    ...(input.generateScript !== undefined ? { generateScript: input.generateScript } : {}),
    ...(input.paramSlots !== undefined ? { paramSlots: input.paramSlots } : {}),
    ...(input.derivedValues !== undefined ? { derivedValues: input.derivedValues } : {}),
    ...(input.numericKind !== undefined ? { numericKind: input.numericKind } : {}),
    ...(input.verification !== undefined ? { verification: input.verification } : {}),
  };

  const question: Question = {
    courseId: input.courseId,
    currentVersionId: versionId,
    currentVersion: 1,
    state: 'draft',
    loIds: input.loIds,
    themeIds: input.themeIds,
    templateFamilyId: input.templateFamilyId ?? questionId,
    labels: input.labels ?? [],
    internalNotes: [],
    createdAt: now,
    updatedAt: now,
    ...(input.generationPrompt !== undefined ? { generationPrompt: input.generationPrompt } : {}),
    ...(input.agentDecision !== undefined ? { agentDecision: input.agentDecision } : {}),
  };

  // Version first, then head: an orphan version (head insert fails) is
  // invisible to every query path, whereas an orphan head (version insert
  // fails) is discoverable and points to a nonexistent currentVersionId — the
  // worse failure mode. No transactions/sessions here; both _ids are
  // pre-generated so neither has a read-after-write dependency.
  await questionVersionsCol().insertOne({ _id: versionId, ...version });
  await questionsCol().insertOne({ _id: questionId, ...question });

  return { questionId, version: { _id: versionId, ...version } };
}

/**
 * Every edit that changes CONTENT creates a new version (n+1) — the current
 * version is copied and patched, never mutated in place. `loIds`/`themeIds`
 * are head fields, not version content, so they update the head directly and
 * never appear in `editedFields`. Adds the 'manually-edited' label via
 * $addToSet (exactly once, no matter how many times a question is edited).
 *
 * A patch that contains NO content key (stem/options/difficulty/paramSlots/
 * generateScript)
 * — e.g. an IN-Q13 retag that only touches loIds/themeIds, or an empty patch
 * — is content-identical to the head, so it must not version, must not add
 * the 'manually-edited' label, and must not stamp an unedited question as
 * manually edited. It only updates the head's loIds/themeIds (+ updatedAt)
 * and returns the CURRENT version unchanged (human decision, see task-4
 * review finding #2).
 */
export async function editQuestion(
  questionId: ObjectId,
  // `verification` is deliberately part of the patch surface even though it is
  // machine-written rather than instructor-authored: a save that fails
  // verification must be able to write it as `undefined`, actively clearing any
  // proof the previous version carried. Leaving a stale proof in place would
  // let the numeric gate keep serving numbers the current formulas no longer
  // produce (R4).
  patch: Partial<Pick<
    QuestionVersion,
    'stem' | 'options' | 'difficulty' | 'paramSlots' | 'generateScript'
    | 'derivedValues' | 'numericKind' | 'verification'
  >> & {
    loIds?: ObjectId[];
    themeIds?: ObjectId[];
  },
  byPuid: string,
): Promise<WithId<QuestionVersion>> {
  const question = await questionsCol().findOne({ _id: questionId });
  if (!question) throw new Error('question-not-found');

  const current = await questionVersionsCol().findOne({ _id: question.currentVersionId });
  if (!current) throw new Error('version-not-found');

  // Only the content keys actually present in the patch are recorded/applied —
  // validated against the version's existing (unpatchable) type.
  const contentPatch: Partial<Pick<QuestionVersion, ContentKey>> = {};
  const editedFields: ContentKey[] = [];
  if (patch.stem !== undefined) {
    contentPatch.stem = patch.stem;
    editedFields.push('stem');
  }
  if (patch.options !== undefined) {
    // Deliberately NOT shuffled here. Every question originates in
    // createQuestion (generation and import are its only callers), so it has
    // already been shuffled once; an edit is a human stating the order they
    // want, and re-randomizing that on every save would undo a deliberate
    // reorder and move the options out from under the form that submitted them.
    contentPatch.options = assertOptionInvariants(current.type, patch.options);
    editedFields.push('options');
  }
  if (patch.difficulty !== undefined) {
    contentPatch.difficulty = patch.difficulty;
    editedFields.push('difficulty');
  }
  if (patch.paramSlots !== undefined) {
    contentPatch.paramSlots = patch.paramSlots;
    editedFields.push('paramSlots');
  }
  if (patch.generateScript !== undefined) {
    contentPatch.generateScript = patch.generateScript;
    editedFields.push('generateScript');
  }
  if (patch.derivedValues !== undefined) {
    contentPatch.derivedValues = patch.derivedValues;
    editedFields.push('derivedValues');
  }
  if (patch.numericKind !== undefined) {
    contentPatch.numericKind = patch.numericKind;
    editedFields.push('numericKind');
  }

  const headPatch: Partial<Pick<Question, 'loIds' | 'themeIds'>> = {};
  if (patch.loIds !== undefined) headPatch.loIds = patch.loIds;
  if (patch.themeIds !== undefined) headPatch.themeIds = patch.themeIds;

  // Tagging-only (or empty) patch: no content changed, so no new version and
  // no 'manually-edited' label — just the head's tags, if any were given.
  if (editedFields.length === 0) {
    // Skip head update entirely if no head patch and no content change.
    if (Object.keys(headPatch).length === 0) {
      return current;
    }
    await questionsCol().updateOne({ _id: questionId }, { $set: { updatedAt: new Date(), ...headPatch } });
    return current;
  }

  // Drop _id — this is a new version document, not an update of `current`.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, ...currentContent } = current;
  const now = new Date();
  const next: QuestionVersion = {
    ...currentContent,
    ...contentPatch,
    version: current.version + 1,
    editedFields,
    provenance: { kind: 'edited', parentVersionId: current._id },
    createdBy: byPuid,
    createdAt: now,
  };

  // R4: a verification proof belongs to the exact content it was computed
  // over. `next` spreads the PREVIOUS version, so without this the old proof
  // would ride along through any edit — letting the numeric gate keep serving
  // numbers the current formulas no longer produce. The caller either supplies
  // a freshly-computed proof or the question loses the one it had.
  if (patch.verification !== undefined) next.verification = patch.verification;
  else delete next.verification;

  const { insertedId } = await questionVersionsCol().insertOne(next);

  await questionsCol().updateOne(
    { _id: questionId },
    {
      $set: { currentVersionId: insertedId, currentVersion: next.version, updatedAt: now, ...headPatch },
      $addToSet: { labels: 'manually-edited' },
    },
  );

  return { _id: insertedId, ...next };
}

/** IN-Q07: validates with canTransition; audits every successful transition. */
export async function transitionQuestion(
  questionId: ObjectId,
  to: PublicationState,
  byPuid: string,
  expectedVersionId?: ObjectId,
): Promise<WithId<Question>> {
  const question = await questionsCol().findOne({ _id: questionId });
  if (!question) throw new Error('question-not-found');
  // Callers that rendered a specific QuestionVersion may pin that version in
  // the transition request. Reject before checking the state when the head has
  // already moved, so a stale review cannot approve somebody else's newer
  // edit. The same version id is also part of the update CAS below to cover an
  // edit racing between this read and the write.
  if (expectedVersionId !== undefined && !question.currentVersionId.equals(expectedVersionId)) {
    throw new Error('question-conflict');
  }
  if (!canTransition(question.state, to)) throw new Error(`invalid-transition:${question.state}->${to}`);
  const now = new Date();
  const result = await questionsCol().updateOne(
    {
      _id: questionId,
      state: question.state,
      ...(expectedVersionId !== undefined ? { currentVersionId: expectedVersionId } : {}),
    },
    { $set: { state: to, updatedAt: now } },
  );
  if (result.matchedCount !== 1) throw new Error('question-conflict');
  await auditCol().insertOne({
    actorPuid: byPuid,
    action: 'question.transition',
    targetType: 'question',
    targetId: questionId,
    courseId: question.courseId,
    detail: { from: question.state, to },
    createdAt: now,
  });
  return { ...question, state: to, updatedAt: now };
}

/** Append-only teaching-team note. Notes never create content versions and
 * are never exposed by browse/student response shapes. */
export async function addQuestionInternalNote(
  questionId: ObjectId,
  text: string,
  byPuid: string,
): Promise<{ puid: string; text: string; at: Date }> {
  const normalized = text.trim();
  if (!normalized) throw new Error('internal-note-required');
  const note = { puid: byPuid, text: normalized, at: new Date() };
  const result = await questionsCol().updateOne(
    { _id: questionId },
    { $push: { internalNotes: note }, $set: { updatedAt: note.at } },
  );
  if (result.matchedCount !== 1) throw new Error('question-not-found');
  await auditCol().insertOne({
    actorPuid: byPuid,
    action: 'question.internal-note.add',
    targetType: 'question',
    targetId: questionId,
    detail: { length: normalized.length },
    createdAt: note.at,
  });
  return note;
}

/**
 * Applies transitionQuestion to each id; only the expected domain
 * errors — a missing question, a transition `canTransition` rejects, or an
 * expected-state CAS conflict — are skipped. Anything else (e.g. Mongo
 * unreachable, or the audit
 * `insertOne` throwing after the state `updateOne` already succeeded)
 * propagates: swallowing it would under-report the count while leaving an
 * unaudited state change in place.
 */
/** States a question can be hard-deleted from: it has never been approved,
 * so it has never been served. Everything else ends at `archived`, which is
 * restorable and keeps attempt, flag and review-book history coherent. */
const DELETABLE_STATES: ReadonlySet<PublicationState> = new Set(['draft', 'pending-review', 'reviewed']);

export type BulkDeleteSkipReason = 'not-found' | 'ever-approved' | 'has-history';

/**
 * Hard-delete questions that have never been served (Saurav, 2026-08-23: the
 * review queue's "Delete selected"). Refuses, per question, anything that has
 * ever been approved or that any attempt, exam attempt, flag or review-book
 * entry references -- those records would dangle -- and reports why. The
 * question document and every version go; an audit entry records it.
 */
export async function bulkDeleteUnserved(
  questionIds: ObjectId[],
  byPuid: string,
): Promise<{ deleted: number; skipped: Array<{ questionId: ObjectId; reason: BulkDeleteSkipReason }> }> {
  let deleted = 0;
  const skipped: Array<{ questionId: ObjectId; reason: BulkDeleteSkipReason }> = [];
  for (const questionId of questionIds) {
    const question = await questionsCol().findOne({ _id: questionId });
    if (!question) { skipped.push({ questionId, reason: 'not-found' }); continue; }
    if (!DELETABLE_STATES.has(question.state)) { skipped.push({ questionId, reason: 'ever-approved' }); continue; }
    const [attempts, examAttempts, flags, reviewBook] = await Promise.all([
      attemptsCol().countDocuments({ questionId }, { limit: 1 }),
      examAttemptsCol().countDocuments({ 'questions.questionId': questionId }, { limit: 1 }),
      flagsCol().countDocuments({ questionId }, { limit: 1 }),
      reviewBookCol().countDocuments({ questionId }, { limit: 1 }),
    ]);
    if (attempts + examAttempts + flags + reviewBook > 0) { skipped.push({ questionId, reason: 'has-history' }); continue; }
    await questionVersionsCol().deleteMany({ questionId });
    const result = await questionsCol().deleteOne({ _id: questionId, state: question.state });
    if (result.deletedCount !== 1) { skipped.push({ questionId, reason: 'not-found' }); continue; }
    await auditCol().insertOne({
      actorPuid: byPuid,
      action: 'question.delete',
      targetType: 'question',
      targetId: questionId,
      courseId: question.courseId,
      detail: { from: question.state, versions: question.currentVersion },
      createdAt: new Date(),
    });
    deleted += 1;
  }
  return { deleted, skipped };
}

export async function bulkTransition(questionIds: ObjectId[], to: PublicationState, byPuid: string): Promise<number> {
  let count = 0;
  for (const questionId of questionIds) {
    try {
      await transitionQuestion(questionId, to, byPuid);
      count += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg !== 'question-not-found' && msg !== 'question-conflict' && !msg.startsWith('invalid-transition:')) {
        throw err;
      }
    }
  }
  return count;
}
