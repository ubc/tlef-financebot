import { createHash } from 'node:crypto';
import { ObjectId, type WithId } from 'mongodb';
import { contentRunsCol, coursesCol, structureReviewAttemptsCol, structureReviewCheckpointsCol, structureReviewProgressCol } from '../components/mongodb/collections';
import type { StructureGenerationRun } from '../types/domain';
import type { OutlineGroundingFinding, StructureResult } from '../types/structure';
import type { StructureReviewCheckpointBody, StructureReviewCorpus } from '../types/structure-review';
import { authoringCollection, currentAuthoringSession, withCourseAuthoringWrite } from './authoring-commit.service';
import { resolveSourcePassagePolicy } from './source-passages';
import { finalizeCapabilityStructureProposal, outlineCapabilityGroundingReceipt, planCapabilityOutlineGrounding, selectCapabilityOutlineGroundingBatch,
  structureOutlineReviewProtocolHash, validateCapabilityOutlineGroundingRows } from './structure-capability-grounding';

const PROTOCOL = 'outline-capability-distinctness-v1';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Checkpoint and transcript bindings use persisted JSON content, not realm-
// specific Array/Object prototypes introduced by structuredClone in test VMs.
const equal = (first: unknown, second: unknown) => JSON.stringify(first) === JSON.stringify(second);
function fail(reason: string): never { throw new Error(`structure-capability-adoption-${reason}`); }
const objectId = (value: unknown): value is ObjectId => value instanceof ObjectId;

export interface StructureCapabilityAdoptionRuntime {
  loadCorpus(body: StructureReviewCheckpointBody): Promise<StructureReviewCorpus>;
  finalize(body: StructureReviewCheckpointBody, themes: StructureResult['themes'], budget: StructureResult['coverage']['budget'],
    grounding: NonNullable<StructureResult['coverage']['outlineGrounding']>): StructureResult;
}

export interface StructureCapabilityReviewAuthority {
  protocol: typeof PROTOCOL;
  reviewedObjectives: number;
  withheldObjectives: number;
  parentState: 'completed' | 'failed-all-held';
  terminalBudget: StructureResult['coverage']['budget'];
  rawHistoryHash: string;
  rawHistoryRecords: number;
  sourceFindings: OutlineGroundingFinding[];
}

function sourceSelectionIdentity(corpus: StructureReviewCorpus): unknown {
  const selection = corpus.sourceSelection;
  return { sourceBatchId: selection.sourceBatchId, replacements: selection.replacements, excluded: selection.excluded,
    included: selection.included.map(({ revision: _revision, ...source }) => source),
    requested: selection.requested.map(row => ({ materialId: row.materialId, clientFileId: row.clientFileId,
      name: row.name, ready: row.ready, state: row.state })), ready: selection.ready };
}

/** Match Mongo's historical absent optional synthesis receipt only. No other
 * receipt, model finding or hierarchy value has a nullable equivalent. */
function finalizedResultHash(result: StructureResult): string {
  const coverage = { ...result.coverage };
  if (coverage.synthesisInput === undefined || coverage.synthesisInput === null) delete coverage.synthesisInput;
  return hash({ ...result, coverage });
}

/** Replay ordinary new-policy Apply inside the caller's course transaction.
 * Instructor labels are applied later; this validates the exact stored model
 * proposal and admission, never claims to review subsequent teacher wording. */
export async function assertStructureCapabilityAdoptable(courseId: ObjectId, run: WithId<StructureGenerationRun>,
  runtime: StructureCapabilityAdoptionRuntime): Promise<{ protocol: typeof PROTOCOL; reviewedObjectives: number; withheldObjectives: number } | undefined> {
  const authority = await replayStructureCapabilityAuthority(courseId, run, runtime, false);
  if (!authority) return;
  return { protocol: authority.protocol, reviewedObjectives: authority.reviewedObjectives, withheldObjectives: authority.withheldObjectives };
}

/** A terminal all-held review can seed a repair, but cannot become an ordinary
 * completed Apply result. Keep its failed state and authenticate its actual raw
 * history/diagnostics rather than manufacturing a successful result. */
export async function assertStructureCapabilityConsolidationParent(courseId: ObjectId, run: WithId<StructureGenerationRun>,
  runtime: StructureCapabilityAdoptionRuntime): Promise<StructureCapabilityReviewAuthority> {
  const authority = await replayStructureCapabilityAuthority(courseId, run, runtime, true);
  if (!authority) fail('protocol-required');
  return authority;
}

async function replayStructureCapabilityAuthority(courseId: ObjectId, run: WithId<StructureGenerationRun>,
  runtime: StructureCapabilityAdoptionRuntime, allowFailedAllHeld: boolean): Promise<StructureCapabilityReviewAuthority | undefined> {
  const protocol = run.input.capabilityDistinctnessProtocol;
  if (protocol === undefined) return;
  if (protocol !== PROTOCOL) fail('protocol-unsupported');
  if (!currentAuthoringSession()) fail('transaction-required');
  return withCourseAuthoringWrite(courseId, async () => {
    const failedAllHeld = allowFailedAllHeld && run.status === 'failed' &&
      run.error?.code === 'structure-capability-no-distinct-supported-objectives' && !Object.hasOwn(run, 'structureResult');
    if (!objectId(run._id) || !objectId(run.courseId) || !run.courseId.equals(courseId) ||
      (!failedAllHeld && (run.status !== 'completed' || !run.structureResult)) ||
      Object.hasOwn(run, 'structureRepair') || !run.structureReview) fail('run-unavailable');
    const current = await authoringCollection(contentRunsCol()).findOne({ _id: run._id, courseId, kind: 'structure-generation', status: run.status });
    if (!current || current.kind !== 'structure-generation' || !equal(current, run)) fail('run-changed');
    if (!await authoringCollection(coursesCol()).findOne({ _id: courseId, authoringDeletionStartedAt: { $exists: false },
      archivedAt: { $exists: false }, lifecycle: { $ne: 'archived' } })) fail('course-unavailable');
    const link = run.structureReview;
    if (!objectId(link.checkpointId) || typeof link.checkpointHash !== 'string' || !/^[a-f0-9]{64}$/.test(link.checkpointHash) ||
      link.parentRunId !== undefined && !objectId(link.parentRunId)) fail('checkpoint-unavailable');
    const checkpoint = await authoringCollection(structureReviewCheckpointsCol()).findOne({ _id: link.checkpointId });
    if (!checkpoint || !objectId(checkpoint.courseId) || !objectId(checkpoint.runId) || !checkpoint.courseId.equals(courseId) ||
      !checkpoint.runId.equals(link.parentRunId ?? run._id) || checkpoint.hash !== link.checkpointHash || hash(checkpoint.body) !== checkpoint.hash) fail('checkpoint-changed');
    const body = checkpoint.body;
    if (body.version !== 'exact-outline-review-v1' || body.origin !== 'production-proposal-v1' || body.importedAuthority !== undefined ||
      body.rootRunId !== checkpoint.runId.toHexString() || body.courseId !== courseId.toHexString() ||
      body.options.capabilityDistinctnessProtocol !== PROTOCOL || !equal(body.options, run.input) ||
      body.protocolHash !== structureOutlineReviewProtocolHash(PROTOCOL) || Buffer.byteLength(JSON.stringify(body), 'utf8') > 8_000_000 ||
      body.baseBudget.pendingSends !== 0 || body.baseBudget.accounting !== 'conservative-reservations-v1') fail('checkpoint-binding');
    const corpus = await runtime.loadCorpus(body);
    resolveSourcePassagePolicy(body.corpus.passagePolicy); resolveSourcePassagePolicy(corpus.passagePolicy);
    if (body.corpus.fingerprint !== corpus.fingerprint || !equal(body.corpus.sections, corpus.sections) ||
      !equal(body.corpus.materials, corpus.materials) || !equal(sourceSelectionIdentity(body.corpus), sourceSelectionIdentity(corpus))) fail('source-changed');
    const extractionIds = body.extractions.map(row => row.sectionId);
    if (extractionIds.length !== body.corpus.sections.length || new Set(extractionIds).size !== extractionIds.length ||
      body.corpus.sections.some(section => !extractionIds.includes(section.id))) fail('extraction-incomplete');
    const batches = planCapabilityOutlineGrounding(body.themes, body.evidence, body.corpus.sections,
      body.reviewInputLimit, PROTOCOL);
    if (!equal(batches, body.batches)) fail('proposal-changed');
    const expected = batches.flatMap(batch => batch.objectives), ids = expected.map(row => row.id);
    if (!ids.length || new Set(ids).size !== ids.length) fail('proposal-identity');
    const progress = await authoringCollection(structureReviewProgressCol()).findOne({ checkpointId: checkpoint._id });
    if (!progress || !objectId(progress.courseId) || !objectId(progress.checkpointId) || !objectId(progress.ownerRunId) ||
      !progress.courseId.equals(courseId) || !progress.checkpointId.equals(checkpoint._id) || progress.checkpointHash !== checkpoint.hash ||
      !progress.ownerRunId.equals(run._id) || progress.pendingNative.length || progress.unresolvedDispatchIds.length || progress.failures.length ||
      progress.findings.length !== ids.length || new Set(progress.findings.map(row => row.id)).size !== ids.length ||
      progress.findings.some(row => !ids.includes(row.id))) fail('review-incomplete');
    if (link.parentRunId) {
      const continuation = progress.continuationBaseBudget, start = progress.continuationStartReservations;
      if (!objectId(progress.continuationRunId) || !progress.continuationRunId.equals(run._id) || !continuation ||
        continuation.accounting !== 'conservative-reservations-v1' || continuation.pendingSends !== 0 ||
        !equal(continuation.limits, body.baseBudget.limits) || !Number.isSafeInteger(start) || start! < body.baseBudget.observedSends ||
        start !== continuation.observedSends || progress.reservations - start! < 0 || progress.reservations - start! > 18 ||
        !Number.isSafeInteger(continuation.admissionTokens) || continuation.admissionTokens! < (body.baseBudget.admissionTokens ?? 0) ||
        progress.usedTokens < continuation.admissionTokens! || progress.usedTokens - continuation.admissionTokens! > 972000) fail('continuation-budget-changed');
    } else if (progress.continuationRunId !== undefined || progress.continuationBaseBudget !== undefined ||
      progress.continuationStartReservations !== undefined) fail('continuation-binding-changed');
    const history = await authoringCollection(structureReviewAttemptsCol()).find({ checkpointId: checkpoint._id })
      .sort({ createdAt: 1, _id: 1 }).limit(ids.length * 2 + 1).toArray();
    if (history.length > ids.length * 2) fail('review-history-changed');
    const replayed = new Map<string, typeof progress.findings[number]>(), attempts = new Map(ids.map(id => [id, 0]));
    const dispatchIds = new Set<string>();
    const reviewValidationFailures: NonNullable<NonNullable<StructureReviewCheckpointBody['synthesisInput']>['validationFailures']> = [];
    for (const entry of history) {
      if (!objectId(entry.courseId) || !objectId(entry.checkpointId) || !objectId(entry.runId) || !entry.courseId.equals(courseId) ||
        !entry.checkpointId.equals(checkpoint._id) || ![checkpoint.runId, run._id].some(id => id.equals(entry.runId)) ||
        entry.status !== 'validated' || !Object.hasOwn(entry, 'raw') || entry.raw === undefined || entry.rawHash !== hash(entry.raw) ||
        typeof entry.dispatchId !== 'string' || !entry.dispatchId || dispatchIds.has(entry.dispatchId) ||
        !Number.isSafeInteger(entry.item) || entry.item < 0 || !Number.isSafeInteger(entry.attempt) || entry.attempt < 0 || entry.attempt > 1 ||
        !Array.isArray(entry.ids) || !entry.ids.length || new Set(entry.ids).size !== entry.ids.length ||
        entry.ids.some(id => !attempts.has(id) || replayed.has(id) || attempts.get(id) !== entry.attempt) ||
        !Array.isArray(entry.findings) || !Array.isArray(entry.failures)) fail('review-history-identity');
      const batch = batches[entry.item];
      if (!batch || entry.ids.some(id => !batch.objectives.some(row => row.id === id))) fail('review-history-dispatch');
      const pending = selectCapabilityOutlineGroundingBatch(batch, entry.ids);
      if (!equal(pending.objectives.map(row => row.id), entry.ids)) fail('review-history-dispatch');
      const checked = validateCapabilityOutlineGroundingRows(entry.raw, pending, [...replayed.values()]);
      if (!equal(checked.findings, entry.findings) || !equal(checked.failures, entry.failures) ||
        checked.failures.some(row => !entry.ids.includes(row.id)) || entry.attempt === 1 && checked.failures.length) fail('review-history-replay');
      if (checked.failures.length) reviewValidationFailures.push({ stage: 'outline-source-review', item: entry.item,
        attempt: entry.attempt, reason: checked.failures[0].reason.slice(0, 600) });
      dispatchIds.add(entry.dispatchId);
      entry.ids.forEach(id => attempts.set(id, entry.attempt + 1));
      checked.findings.forEach(finding => replayed.set(finding.id, finding));
    }
    if (replayed.size !== ids.length || !equal(Object.fromEntries(attempts), progress.attempts) ||
      progress.findings.some(finding => !equal(finding, replayed.get(finding.id)))) fail('review-history-incomplete');
    const findings = ids.map(id => replayed.get(id)!);
    let admitted: ReturnType<typeof finalizeCapabilityStructureProposal>;
    if (failedAllHeld) {
      const diagnostics = run.structureDiagnostics;
      // Fresh generation appends one first-failure diagnostic per logical
      // dispatch after cloning the checkpoint. Continuation uses the frozen
      // receipt without that callback. Derive only this exact delta from raw
      // replay; no unrelated metadata or unrecorded failure can be accepted.
      let synthesisInput = body.synthesisInput;
      if (!link.parentRunId && reviewValidationFailures.length) {
        if (!synthesisInput || synthesisInput.validationFailures !== undefined && !Array.isArray(synthesisInput.validationFailures)) fail('failed-terminal-diagnostics-changed');
        synthesisInput = { ...synthesisInput, validationFailures: [...(synthesisInput.validationFailures ?? []), ...reviewValidationFailures] };
      }
      if (!diagnostics || !equal(diagnostics.sourceSelection, body.corpus.sourceSelection) || !equal(diagnostics.cache, body.cache) ||
        !equal(diagnostics.synthesisInput ?? null, synthesisInput ?? null) ||
        !Array.isArray(diagnostics.unprocessedSections) || diagnostics.unprocessedSections.length) fail('failed-terminal-diagnostics-changed');
      const receipt = outlineCapabilityGroundingReceipt(findings, ids.length, batches);
      if (!receipt.capabilityDistinctness?.complete || receipt.capabilityDistinctness.eligibleIds.length ||
        !findings.some(row => row.status === 'supported')) fail('failed-terminal-not-all-held');
      let exactFailure = false;
      try { finalizeCapabilityStructureProposal(body.themes, findings, expected, batches); }
      catch (error) {
        if (!(error instanceof Error) || error.message !== 'structure-capability-no-distinct-supported-objectives') throw error;
        exactFailure = true;
      }
      if (!exactFailure) fail('failed-terminal-finalizer-changed');
      admitted = { themes: [], receipt };
    } else admitted = finalizeCapabilityStructureProposal(body.themes, findings, expected, batches);
    const result = run.structureResult, budget = failedAllHeld ? run.structureDiagnostics?.budget : result?.coverage.budget, base = body.baseBudget;
    if (!budget || budget.accounting !== 'conservative-reservations-v1' || budget.pendingSends !== 0 ||
      !equal(budget.limits, base.limits) || ![budget.admissionTokens, budget.observedSends, budget.estimatedInputTokens,
        budget.reservedOutputTokens, progress.usedTokens, progress.reservations, progress.maxTokens, progress.maxSends]
        .every(value => Number.isSafeInteger(value) && value! >= 0) ||
      budget.admissionTokens !== progress.usedTokens || budget.observedSends !== progress.reservations ||
      progress.maxTokens !== budget.limits.maxEstimatedTokens || progress.maxSends !== budget.limits.maxSends ||
      progress.usedTokens < base.admissionTokens! || progress.usedTokens > progress.maxTokens ||
      progress.reservations < base.observedSends + history.length || progress.reservations > progress.maxSends ||
      budget.estimatedInputTokens < base.estimatedInputTokens || budget.reservedOutputTokens < base.reservedOutputTokens ||
      budget.estimatedInputTokens + budget.reservedOutputTokens > progress.usedTokens || !run.structureDiagnostics ||
      !equal(run.structureDiagnostics.budget, budget) || !equal(run.structureDiagnostics.outlineGrounding, admitted.receipt)) fail('budget-or-diagnostics-changed');
    // Fresh generation appends review diagnostics after persisting its frozen
    // checkpoint. Rebuild only the exact suffix from validated logical history;
    // continuation keeps its frozen receipt and all other result fields bind.
    // Checkpoints without this optional receipt retain exact legacy replay.
    let completedBody = body;
    if (!failedAllHeld && !link.parentRunId && reviewValidationFailures.length && body.synthesisInput !== undefined) {
      if (!body.synthesisInput || body.synthesisInput.validationFailures !== undefined && !Array.isArray(body.synthesisInput.validationFailures)) fail('result-changed');
      completedBody = { ...body, synthesisInput: { ...body.synthesisInput,
        validationFailures: [...(body.synthesisInput.validationFailures ?? []), ...reviewValidationFailures] } };
      if (!equal(run.structureDiagnostics.synthesisInput ?? null, completedBody.synthesisInput ?? null)) fail('result-changed');
    }
    if (!failedAllHeld && (!result || finalizedResultHash(runtime.finalize(completedBody, admitted.themes, budget, admitted.receipt)) !== finalizedResultHash(result))) fail('result-changed');
    const capability = admitted.receipt.capabilityDistinctness;
    if (!capability || !capability.complete) fail('capability-review-incomplete');
    return { protocol: PROTOCOL, reviewedObjectives: admitted.receipt.reviewedObjectives, withheldObjectives: capability.held.length,
      parentState: failedAllHeld ? 'failed-all-held' : 'completed', terminalBudget: structuredClone(budget),
      rawHistoryHash: hash(history), rawHistoryRecords: history.length, sourceFindings: structuredClone(findings) };
  }, { required: true });
}
