import { createHash } from 'node:crypto';
import { ObjectId, type ClientSession } from 'mongodb';
import { materialsCol, questionsCol, losCol } from '../components/mongodb/collections';
import type { AuthoringRequirements } from '../types/generation-quality';
import type { GenerationEvidenceInput, GenerationEvidencePacket } from '../types/generation-evidence';
import { buildGenerationEvidence, assertGenerationEvidenceCurrent } from './generation-evidence.service';
import { compactAuthoringPromptEnabled } from './generation-planning-evidence';
import { loadGenerationMemory, reloadGenerationMemory, assertTaskRetrievalReady, type GenerationMemorySnapshot } from './generation-memory.service';

export interface AuthoringContext {
  id: string;
  evidence: GenerationEvidencePacket;
  memory: GenerationMemorySnapshot;
  requirements: AuthoringRequirements;
}
export function authoringHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Public authoring and regeneration share originals, identity and bounded
 * current Bank/Queue memory. Source scope is resolved before calling this. */
export async function buildAuthoringContext(input: GenerationEvidenceInput & {
  requirements: AuthoringRequirements;
  excludeQuestionId?: ObjectId;
  pinnedOriginal?: { questionId: ObjectId; versionId: ObjectId };
}): Promise<AuthoringContext> {
  if (compactAuthoringPromptEnabled(input.requirements) && input.policyVersion !== 'grounded-memory-v2') throw new Error('generation-quality-protocol-invalid');
  if (input.requirements.taskRetrievalProtocol !== undefined && input.policyVersion !== 'grounded-memory-v2') throw new Error('generation-task-retrieval-policy-invalid');
  const needsOriginal = input.requirements.intent === 'create-independent-task' && Boolean(input.requirements.original && input.excludeQuestionId);
  const pinnedOriginal = needsOriginal ? input.pinnedOriginal : undefined;
  if (needsOriginal && (!pinnedOriginal || !pinnedOriginal.questionId.equals(input.excludeQuestionId!))) throw new Error('authoring-original-comparison-required');
  const [evidence, memory] = await Promise.all([
    buildGenerationEvidence({ ...input, query: input.query ?? (input.requirements.plannedTask ? `${input.requirements.plannedTask.concepts.join(' ')} ${input.requirements.plannedTask.requiredInference} ${input.requirements.plannedTask.solutionPath.join(' ')}` : input.requirements.requiredChanges.join(' ')) }),
    loadGenerationMemory({ courseId: input.courseId, loIds: input.loIds, excludeQuestionId: input.excludeQuestionId, includeCrossLo: input.policyVersion === 'grounded-memory-v2',
      // Only the retrieval locator is bounded; full teacher/source/original
      // content remains in its existing validated authoring payload.
      query: input.requirements.taskRetrievalProtocol !== undefined ? (input.query ?? input.requirements.requiredChanges.join(' ')).slice(0, 8000) : input.query ?? input.requirements.requiredChanges.join(' '),
      ...(input.requirements.taskRetrievalProtocol !== undefined ? { taskRetrievalProtocol: input.requirements.taskRetrievalProtocol } : {}),
      ...(pinnedOriginal ? { pinnedOriginal } : {}) }),
  ]);
  return { id: authoringHash({ evidence: evidence.id, memory: memory.snapshotDigest, requirements: input.requirements }),
    evidence, memory, requirements: input.requirements };
}

/** This is a currentness check. Commit serialization is owned separately by
 * the authoring coordinator; this read must never be described as a fence. */
export async function assertAuthoringContextCurrent(context: AuthoringContext, input: {
  courseId: ObjectId; loIds: ObjectId[]; excludeQuestionId?: ObjectId; session?: ClientSession; includeCrossLo?: boolean;
}): Promise<void> {
  const pin = context.memory.pinnedOriginal;
  const needsOriginal = context.requirements.intent === 'create-independent-task' && Boolean(context.requirements.original && input.excludeQuestionId);
  if (needsOriginal && (!pin || pin.questionId !== input.excludeQuestionId!.toHexString())) throw new Error('authoring-original-comparison-required');
  if (pin && context.requirements.intent !== 'create-independent-task') throw new Error('authoring-original-comparison-invalid');
  if (context.requirements.taskRetrievalProtocol !== undefined) assertTaskRetrievalReady(context.memory, context.requirements.taskRetrievalProtocol);
  await assertGenerationEvidenceCurrent(context.evidence, input.session);
  const reloadInput = { ...input, includeCrossLo: context.evidence.policyVersion === 'grounded-memory-v2',
    ...(pin ? { pinnedOriginal: { questionId: new ObjectId(pin.questionId), versionId: new ObjectId(pin.versionId) } } : {}) };
  const memory = context.requirements.taskRetrievalProtocol !== undefined
    ? await reloadGenerationMemory(context.memory, reloadInput) : await loadGenerationMemory(reloadInput);
  if (context.requirements.taskRetrievalProtocol !== undefined) assertTaskRetrievalReady(memory, context.requirements.taskRetrievalProtocol);
  if (memory.snapshotDigest !== context.memory.snapshotDigest) throw new Error('authoring-memory-changed');
}

export const EDIT_DEFAULT_INVARIANTS = [
  'Preserve the learning task and correct-answer semantics except for the explicitly requested changes.',
  'Preserve unrelated wording, option order and roles.',
  'Preserve parameter distributions and the underlying formulas; consistent symbol renaming is allowed.',
];
export function normalizeAuthoringRequirements(input: {
  intent?: AuthoringRequirements['intent']; requiredChanges?: string[]; preserve?: string[]; prompt: string;
  original?: AuthoringRequirements['original']; requestedDifficulty?: AuthoringRequirements['requestedDifficulty'];
}): AuthoringRequirements {
  const intent = input.intent ?? 'create-variant';
  return { intent, requiredChanges: input.requiredChanges?.length ? input.requiredChanges : [input.prompt],
    preserve: input.preserve?.length ? input.preserve : intent === 'edit-existing' ? [...EDIT_DEFAULT_INVARIANTS]
      : intent === 'create-variant' ? ['Preserve the learning task, required inference and solution path of the original.'] : [],
    ...(input.original ? { original: input.original } : {}), ...(input.requestedDifficulty ? { requestedDifficulty: input.requestedDifficulty } : {}) };
}

/** The enclosing transaction already holds the course creation/assignment
 * fence. Document writes additionally conflict with older unfenced writers. */
export async function fenceAuthoringContext(context: AuthoringContext, input: {
  courseId: ObjectId; loIds: ObjectId[]; excludeQuestionId?: ObjectId; session: ClientSession;
}): Promise<void> {
  await assertAuthoringContextCurrent(context, input);
  for (const source of context.evidence.materials) {
    const filter = { _id: new ObjectId(source.materialId), courseId: input.courseId, status: 'ready' as const, deletedAt: { $exists: false },
      ...(source.revision === null ? { revision: { $exists: false } } : { revision: source.revision }),
      ...(source.activeRunId ? { activeRunId: new ObjectId(source.activeRunId) } : { activeRunId: { $exists: false } }) };
    if ((await materialsCol().updateOne(filter, { $inc: { authoringFence: 1 } }, { session: input.session })).matchedCount !== 1) throw new Error('generation-evidence-source-changed');
  }
  for (const entry of context.memory.entries.filter(entry => entry.source === 'bank')) {
    if ((await questionsCol().updateOne({ _id: new ObjectId(entry.questionId), courseId: input.courseId, currentVersionId: new ObjectId(entry.versionId), state: entry.state }, { $inc: { authoringFence: 1 } }, { session: input.session })).matchedCount !== 1) throw new Error('authoring-memory-changed');
  }
  for (const loId of input.loIds) {
    const name = context.evidence.materials.find(source => source.loId === loId.toHexString())?.loName;
    if ((await losCol().updateOne({ _id: loId, courseId: input.courseId, ...(name ? { name } : {}), archivedAt: { $exists: false } }, { $inc: { authoringFence: 1 } }, { session: input.session })).matchedCount !== 1) throw new Error('authoring-objective-changed');
  }
}
