import type { WithId } from 'mongodb';
import { ObjectId } from 'mongodb';
import { questionsCol, questionVersionsCol, auditCol } from '../components/mongodb/collections';
import { canTransition } from '../types/domain';
import type {
  Question,
  QuestionVersion,
  QuestionOption,
  QuestionType,
  PublicationState,
  QuestionLabel,
  Difficulty,
} from '../types/domain';

// -----------------------------------------------------------------------------
// Question service (IN-Q03, IN-Q04, IN-Q07, IN-Q13): versioning, option
// invariants, and publication-state transitions. Every edit creates a NEW
// QuestionVersion — prior versions are never mutated or deleted (PRD §2).
// Generation never publishes: questions always enter as 'draft'. Only the
// routes layer (Task 5) talks HTTP; this file is pure service logic. See
// server/src/services/AGENTS.md.
// -----------------------------------------------------------------------------

type ContentKey = 'stem' | 'options' | 'difficulty' | 'paramSlots';

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
  agentDecision?: Question['agentDecision'];
  labels?: QuestionLabel[];
}): Promise<{ questionId: ObjectId; version: WithId<QuestionVersion> }> {
  const options = assertOptionInvariants(input.type, input.options);

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
    createdBy: input.createdBy,
    createdAt: now,
  };

  const question: Question = {
    courseId: input.courseId,
    currentVersionId: versionId,
    currentVersion: 1,
    state: 'draft',
    loIds: input.loIds,
    themeIds: input.themeIds,
    labels: input.labels ?? [],
    internalNotes: [],
    createdAt: now,
    updatedAt: now,
    ...(input.generationPrompt !== undefined ? { generationPrompt: input.generationPrompt } : {}),
    ...(input.agentDecision !== undefined ? { agentDecision: input.agentDecision } : {}),
  };

  // Version first, then head — an orphan version (insert failed on the head)
  // is invisible to every query path, but an orphan head (insert failed on
  // the version) would point at a nonexistent currentVersionId and be
  // discoverable/repairable. No transactions/sessions here — no service in
  // this repo uses them, and both _ids are pre-generated so there's no
  // read-after-write dependency between the two inserts.
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
 * A patch that contains NO content key (stem/options/difficulty/paramSlots)
 * — e.g. an IN-Q13 retag that only touches loIds/themeIds, or an empty patch
 * — is content-identical to the head, so it must not version, must not add
 * the 'manually-edited' label, and must not stamp an unedited question as
 * manually edited. It only updates the head's loIds/themeIds (+ updatedAt)
 * and returns the CURRENT version unchanged (human decision, see task-4
 * review finding #2).
 */
export async function editQuestion(
  questionId: ObjectId,
  patch: Partial<Pick<QuestionVersion, 'stem' | 'options' | 'difficulty' | 'paramSlots'>> & {
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

  const headPatch: Partial<Pick<Question, 'loIds' | 'themeIds'>> = {};
  if (patch.loIds !== undefined) headPatch.loIds = patch.loIds;
  if (patch.themeIds !== undefined) headPatch.themeIds = patch.themeIds;

  // Tagging-only (or empty) patch: no content changed, so no new version and
  // no 'manually-edited' label — just the head's tags, if any were given.
  if (editedFields.length === 0) {
    await questionsCol().updateOne({ _id: questionId }, { $set: { updatedAt: new Date(), ...headPatch } });
    return current;
  }

  // Drop _id — this is a new version document, not an update of `current`.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, ...currentContent } = current;
  const next: QuestionVersion = {
    ...currentContent,
    ...contentPatch,
    version: current.version + 1,
    editedFields,
    createdBy: byPuid,
    createdAt: new Date(),
  };

  const { insertedId } = await questionVersionsCol().insertOne(next);

  await questionsCol().updateOne(
    { _id: questionId },
    {
      $set: { currentVersionId: insertedId, currentVersion: next.version, updatedAt: new Date(), ...headPatch },
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
): Promise<Question> {
  const question = await questionsCol().findOne({ _id: questionId });
  if (!question) throw new Error('question-not-found');
  if (!canTransition(question.state, to)) throw new Error(`invalid-transition:${question.state}->${to}`);
  const now = new Date();
  await questionsCol().updateOne({ _id: questionId }, { $set: { state: to, updatedAt: now } });
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

/**
 * Applies transitionQuestion to each id; only the two expected domain
 * errors — a missing question, or a transition `canTransition` rejects —
 * are skipped. Anything else (e.g. Mongo unreachable, or the audit
 * `insertOne` throwing after the state `updateOne` already succeeded)
 * propagates: swallowing it would under-report the count while leaving an
 * unaudited state change in place.
 */
export async function bulkTransition(questionIds: ObjectId[], to: PublicationState, byPuid: string): Promise<number> {
  let count = 0;
  for (const questionId of questionIds) {
    try {
      await transitionQuestion(questionId, to, byPuid);
      count += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg !== 'question-not-found' && !msg.startsWith('invalid-transition:')) throw err;
    }
  }
  return count;
}
