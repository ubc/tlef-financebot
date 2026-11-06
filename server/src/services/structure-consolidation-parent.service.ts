import { createHash } from 'node:crypto';
import { ObjectId, type WithId } from 'mongodb';
import { structureReviewAttemptsCol, structureReviewCheckpointsCol, structureReviewProgressCol } from '../components/mongodb/collections';
import type { StructureGenerationRun } from '../types/domain';
import type { AuthoringBudgetReceipt } from '../types/authoring-budget';
import type { OutlineGroundingFinding } from '../types/structure';
import type { OutlineCapabilityContext } from '../types/structure-distinctness';
import type { OutlineConsolidationPlan } from '../types/structure-consolidation';
import { authoringCollection, currentAuthoringSession, withCourseAuthoringWrite } from './authoring-commit.service';
import { assertStructureCapabilityConsolidationParent, type StructureCapabilityAdoptionRuntime } from './structure-capability-adoption.service';
import type { CapabilityOutlineGroundingBatch } from './structure-capability-grounding';
import { planOutlineCapabilityDistinctness } from './structure-capability-distinctness';
import { deriveOutlineConsolidationPlan } from './structure-outline-consolidation';

const PROTOCOL = 'outline-capability-distinctness-v1' as const;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const equal = (first: unknown, second: unknown) => JSON.stringify(first) === JSON.stringify(second);
function fail(reason: string): never { throw new Error(`structure-consolidation-parent-${reason}`); }

/** Internal snapshot, usable only after fresh authenticated rereads. This is
 * neither a browser-supplied proof nor permission to send, retire or Apply. */
export interface StructureConsolidationParent {
  version: 'authenticated-consolidation-parent-v1';
  courseId: string;
  runId: string;
  checkpointId: string;
  runHash: string;
  checkpointHash: string;
  progressHash: string;
  rawHistoryHash: string;
  rawHistoryRecords: number;
  parentState: 'completed' | 'failed-all-held';
  sourceFingerprint: string;
  parentProtocolHash: string;
  providerIdentityHash: string;
  context: OutlineCapabilityContext;
  sourceFindings: OutlineGroundingFinding[];
  /** Exact terminal accounting, never checkpoint.baseBudget or a new ceiling. */
  terminalBudget: AuthoringBudgetReceipt;
  authorityHash: string;
}

export interface PreparedStructureConsolidation {
  parent: StructureConsolidationParent;
  plan: OutlineConsolidationPlan;
  /** A private binding, never a replacement for fresh durable authentication. */
  bindingHash: string;
}

export async function prepareStructureOutlineConsolidation(courseId: ObjectId, run: WithId<StructureGenerationRun>,
  selectedIds: string[], runtime: StructureCapabilityAdoptionRuntime): Promise<PreparedStructureConsolidation> {
  const parent = await readStructureConsolidationParent(courseId, run, runtime);
  const plan = deriveOutlineConsolidationPlan(parent.context, parent.sourceFindings, selectedIds);
  return { parent, plan, bindingHash: hash({ parentAuthorityHash: parent.authorityHash, planHash: plan.planHash }) };
}

/** Caller owns the matching-course transaction. The existing full Apply guard
 * replays actual native history, current sources, finalized result and budget.
 * No provider work, child write or hierarchy mutation occurs here. */
export async function readStructureConsolidationParent(courseId: ObjectId,
  run: WithId<StructureGenerationRun>, runtime: StructureCapabilityAdoptionRuntime): Promise<StructureConsolidationParent> {
  if (!currentAuthoringSession()) fail('transaction-required');
  return withCourseAuthoringWrite(courseId, async () => {
    if (!(courseId instanceof ObjectId) || !(run?._id instanceof ObjectId) || !(run.courseId instanceof ObjectId) ||
      !run.courseId.equals(courseId) || run.input.capabilityDistinctnessProtocol !== PROTOCOL ||
      !['completed', 'failed'].includes(run.status) || Object.hasOwn(run, 'structureRepair') || !run.structureReview) fail('run-unavailable');
    const link = run.structureReview;
    if (!(link.checkpointId instanceof ObjectId)) fail('checkpoint-unavailable');
    const checkpoint = await authoringCollection(structureReviewCheckpointsCol()).findOne({ _id: link.checkpointId });
    const progress = await authoringCollection(structureReviewProgressCol()).findOne({ checkpointId: link.checkpointId });
    if (!checkpoint || !progress) fail('parent-unavailable');
    const readHistory = () => authoringCollection(structureReviewAttemptsCol()).find({ checkpointId: link.checkpointId })
      .sort({ createdAt: 1, _id: 1 }).limit(801).toArray();
    const history = await readHistory(), rawHistoryHash = hash(history);
    const checkpointSnapshot = hash(checkpoint), progressSnapshot = hash(progress);
    const checked = await assertStructureCapabilityConsolidationParent(courseId, run, runtime);
    if (!checked || checked.protocol !== PROTOCOL) fail('protocol-unavailable');
    const afterCheckpoint = await authoringCollection(structureReviewCheckpointsCol()).findOne({ _id: link.checkpointId });
    const afterProgress = await authoringCollection(structureReviewProgressCol()).findOne({ checkpointId: link.checkpointId });
    if (!afterCheckpoint || !afterProgress || hash(afterCheckpoint) !== checkpointSnapshot || hash(afterProgress) !== progressSnapshot ||
      hash(await readHistory()) !== rawHistoryHash || checked.rawHistoryHash !== rawHistoryHash || checked.rawHistoryRecords !== history.length) fail('snapshot-changed');
    // The guard above authenticates the production origin and exact rebuilt
    // batches. Their private projected contexts retain both alias and corpus
    // identity even though the stored prompt/source fields are deliberately lazy.
    const body = checkpoint.body;
    const context = planOutlineCapabilityDistinctness(body.batches.map(batch => {
      const selected = (batch as CapabilityOutlineGroundingBatch).capabilityContext;
      if (!selected) fail('context-unavailable');
      const own = new Set(batch.objectives.flatMap(row => row.sourceIds));
      return { objectives: batch.objectives, sources: selected.sources.filter(row => own.has(row.alias)), prompt: '' };
    }), PROTOCOL);
    if (!context || checked.reviewedObjectives !== context.candidateIds.length || progress.findings.length !== context.candidateIds.length) fail('review-incomplete');
    const budget = checked.terminalBudget;
    if (budget.accounting !== 'conservative-reservations-v1' || budget.pendingSends !== 0 ||
      budget.admissionTokens !== progress.usedTokens || budget.observedSends !== progress.reservations ||
      !equal(budget.limits, body.baseBudget.limits)) fail('terminal-budget-changed');
    const receipt = { version: 'authenticated-consolidation-parent-v1' as const, courseId: courseId.toHexString(),
      runId: run._id.toHexString(), checkpointId: link.checkpointId.toHexString(), runHash: hash(run),
      checkpointHash: checkpoint.hash, progressHash: progressSnapshot, sourceFingerprint: body.corpus.fingerprint,
      rawHistoryHash, rawHistoryRecords: history.length,
      parentState: checked.parentState,
      parentProtocolHash: body.protocolHash, providerIdentityHash: body.providerIdentityHash,
      context, sourceFindings: checked.sourceFindings, terminalBudget: budget };
    return structuredClone({ ...receipt, authorityHash: hash(receipt) });
  }, { required: true });
}
