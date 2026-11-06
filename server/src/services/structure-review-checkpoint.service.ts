import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { ObjectId, type WithId } from 'mongodb';
import { contentRunsCol, coursesCol, structureReviewCheckpointsCol, structureReviewProgressCol, structureReviewAttemptsCol } from '../components/mongodb/collections';
import type { ModelSendAdmission, ModelCallEvent } from '../components/genai/llm';
import type { StructureReviewCheckpointBody, StructureReviewCheckpoint, StructureReviewProgress, StructureReviewCorpus } from '../types/structure-review';
import type { OutlineGroundingFinding } from '../types/structure';
import type { StructureGenerationRun } from '../types/domain';
import type { AuthoringBudgetReceipt } from '../types/authoring-budget';
import type { OutlineGroundingRowFailure } from './structure-outline-grounding';
import { planCapabilityOutlineGrounding as planOutlineGrounding, structureOutlineReviewProtocolHash as outlineGroundingProtocolHash,
  selectCapabilityOutlineGroundingBatch as selectOutlineGroundingBatch, validateCapabilityOutlineGroundingRows as validateOutlineGroundingRows } from './structure-capability-grounding';
import { authoringCollection, withCourseAuthoringWrite } from './authoring-commit.service';
import { assertContentRunActive, createStructureGenerationRun, getContentRun, updateContentRun } from './content-runs.service';
import { projectRetainedStructureReviews, type RetainedStructureReviewAuthority } from './structure-review-retained-import';
import { resolveSourcePassagePolicy } from './source-passages';

const MAX_DOCUMENT_BYTES = 8_000_000;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const structureReviewHash = digest;
/** Compatibility projection changes representation, never historical raw hashes. */
export const sameProjectedStructureFinding = (first: OutlineGroundingFinding, second: OutlineGroundingFinding): boolean => isDeepStrictEqual(first, second);
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
function fail(reason: string): never { throw new Error(`structure-review-${reason}`); }

/** Immutable checkpoint limits, not a prior diagnostic, own the inherited
 * ceiling. Check values independently of BSON/object key order; never repair a
 * historical receipt by replacing its limits or creating a fresh allowance. */
export function assertStructureReviewBudgetCoherence(body: StructureReviewCheckpointBody,
  progress: Pick<StructureReviewProgress, 'maxSends' | 'maxTokens' | 'continuationBaseBudget'>,
  receipt?: AuthoringBudgetReceipt): void {
  const expected = body.baseBudget?.limits;
  const keys = ['maxSends', 'maxInputTokens', 'maxOutputTokens', 'maxEstimatedTokens'] as const;
  const valid = (limits: AuthoringBudgetReceipt['limits'] | undefined) => !!limits &&
    Object.keys(limits).length === keys.length && keys.every(key => Object.hasOwn(limits, key) && Number.isSafeInteger(limits[key]) && limits[key] > 0);
  if (!valid(expected) || progress.maxSends !== expected.maxSends || progress.maxTokens !== expected.maxEstimatedTokens) fail('budget-limits-changed');
  for (const value of [receipt, progress.continuationBaseBudget]) {
    if (value !== undefined && (!valid(value.limits) || keys.some(key => value.limits[key] !== expected[key]))) fail('budget-limits-changed');
  }
}
function selectionIdentity(corpus: StructureReviewCorpus): unknown {
  const selection = corpus.sourceSelection;
  return { sourceBatchId: selection.sourceBatchId, replacements: selection.replacements, excluded: selection.excluded,
    included: selection.included.map(({ revision: _revision, ...source }) => source),
    requested: selection.requested.map(row => ({ materialId: row.materialId, clientFileId: row.clientFileId, name: row.name, ready: row.ready, state: row.state })),
    ready: selection.ready };
}

export function validateStructureReviewCheckpoint(body: StructureReviewCheckpointBody, current?: StructureReviewCorpus): void {
  resolveSourcePassagePolicy(body.corpus.passagePolicy);
  if (current) resolveSourcePassagePolicy(current.passagePolicy);
  if (body.version !== 'exact-outline-review-v1' || !ObjectId.isValid(body.courseId) || !ObjectId.isValid(body.rootRunId)) fail('checkpoint-version');
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_DOCUMENT_BYTES) fail('checkpoint-too-large');
  if (body.protocolHash !== outlineGroundingProtocolHash(body.options.capabilityDistinctnessProtocol)) fail('protocol-changed');
  if (body.baseBudget.pendingSends !== 0 || body.baseBudget.accounting === 'reported-usage-settlement-v1') fail('budget-not-terminal-conservative');
  if (current && (body.corpus.fingerprint !== current.fingerprint || !equal(body.corpus.sections, current.sections) ||
      !equal(body.corpus.materials, current.materials) || !equal(selectionIdentity(body.corpus), selectionIdentity(current)))) fail('source-changed');
  const batches = planOutlineGrounding(body.themes, body.evidence, body.corpus.sections, body.reviewInputLimit, body.options.capabilityDistinctnessProtocol);
  if (!equal(batches, body.batches)) fail('binding-changed');
  const extractionIds = body.extractions.map(row => row.sectionId);
  if (extractionIds.length !== body.corpus.sections.length || new Set(extractionIds).size !== extractionIds.length ||
      body.corpus.sections.some(section => !extractionIds.includes(section.id))) fail('extraction-incomplete');
}

/** Validate canonical findings with the same current original-source validator. */
export function validateCheckpointFinding(body: StructureReviewCheckpointBody, finding: OutlineGroundingFinding): void {
  const batch = body.batches.find(row => row.objectives.some(objective => objective.id === finding.id));
  if (!batch) fail('finding-identity');
  const own = selectOutlineGroundingBatch(batch!, [finding.id]);
  const raw = { id: finding.id, sourceStatus: finding.status, sourceIds: finding.citedSourceIds,
    sourceReason: finding.reason, coveredEvidenceIds: finding.ignoredModelCoverage?.evidenceIds ?? finding.coveredEvidenceIds,
    topicFit: finding.topicFit, topicReason: finding.topicReason };
  const checked = validateOutlineGroundingRows({ reviews: [raw], ...(body.options.capabilityDistinctnessProtocol ? { capabilityComparisons: finding.capabilityComparisons ?? [] } : {}) }, own);
  if (checked.failures.length || !equal(checked.findings[0], finding)) fail('finding-changed');
}

/** The new contract replays the whole same-call response, not just a stored
 * positive row. A matching hash alone cannot authorize edited parse results. */
function assertCapabilityDispatch(body: StructureReviewCheckpointBody, ids: string[], item: number, raw: unknown,
  findings: OutlineGroundingFinding[], failures: OutlineGroundingRowFailure[], priorFindings: OutlineGroundingFinding[]): void {
  if (body.options.capabilityDistinctnessProtocol === undefined) return;
  const batch = Number.isSafeInteger(item) && item >= 0 ? body.batches[item] : undefined;
  if (!batch) fail('dispatch-binding');
  const checked = validateOutlineGroundingRows(raw, selectOutlineGroundingBatch(batch!, ids), priorFindings);
  if (!equal(checked.findings, findings) || !equal(checked.failures, failures)) fail('dispatch-reply-changed');
}

async function currentProgress(checkpoint: WithId<StructureReviewCheckpoint>, runId: ObjectId): Promise<WithId<StructureReviewProgress>> {
  await assertContentRunActive(runId);
  if (!await coursesCol().findOne({ _id: checkpoint.courseId, authoringDeletionStartedAt: { $exists: false }, archivedAt: { $exists: false }, lifecycle: { $ne: 'archived' } })) fail('course-unavailable');
  const progress = await structureReviewProgressCol().findOne({ checkpointId: checkpoint._id });
  if (!progress || progress.checkpointHash !== checkpoint.hash || !progress.ownerRunId.equals(runId)) fail('ownership-conflict');
  // A linked continuation has a different run ID from its immutable root.
  // Guard before raw recovery, CAS writes and native reservations, while the
  // original-run/historical-absence branch keeps its existing contract.
  if (!checkpoint.runId.equals(runId)) {
    if (!progress.continuationBaseBudget) fail('parent-budget-unreconciled');
    assertStructureReviewBudgetCoherence(checkpoint.body, progress, progress.continuationBaseBudget);
  }
  return progress;
}

async function mutateProgress(checkpoint: WithId<StructureReviewCheckpoint>, runId: ObjectId,
  change: (current: WithId<StructureReviewProgress>) => Partial<StructureReviewProgress>): Promise<WithId<StructureReviewProgress>> {
  return withCourseAuthoringWrite(checkpoint.courseId, async () => {
    const current = await currentProgress(checkpoint, runId);
    const set = { ...change(current), revision: current.revision + 1, updatedAt: new Date() };
    if (Buffer.byteLength(JSON.stringify({ ...current, ...set }), 'utf8') > MAX_DOCUMENT_BYTES) fail('progress-too-large');
    const updated = await authoringCollection(structureReviewProgressCol()).findOneAndUpdate(
      { _id: current._id, revision: current.revision, ownerRunId: runId }, { $set: set }, { returnDocument: 'after' });
    if (!updated) fail('progress-conflict');
    return updated!;
  });
}

export async function createStructureReviewCheckpoint(runId: ObjectId, body: StructureReviewCheckpointBody): Promise<WithId<StructureReviewCheckpoint>> {
  validateStructureReviewCheckpoint(body);
  if (body.rootRunId !== runId.toHexString()) fail('parent-changed');
  const courseId = new ObjectId(body.courseId); const hash = digest(body);
  const run = await getContentRun(runId);
  if (!run || run.kind !== 'structure-generation' || !run.courseId.equals(courseId) || run.status !== 'running') fail('parent-unavailable');
  return withCourseAuthoringWrite(courseId, async () => {
    if (!await authoringCollection(coursesCol()).findOne({ _id: courseId, authoringDeletionStartedAt: { $exists: false }, archivedAt: { $exists: false }, lifecycle: { $ne: 'archived' } })) fail('course-unavailable');
    let stored = await authoringCollection(structureReviewCheckpointsCol()).findOne({ courseId, runId });
    if (!stored) {
      try {
        const document: StructureReviewCheckpoint = { courseId, runId, hash, body: structuredClone(body), createdAt: new Date() };
        const inserted = await authoringCollection(structureReviewCheckpointsCol()).insertOne(document);
        stored = { ...document, _id: inserted.insertedId };
      } catch (error) { if ((error as { code?: number }).code !== 11000) throw error; stored = await authoringCollection(structureReviewCheckpointsCol()).findOne({ courseId, runId }); }
    }
    if (!stored || stored.hash !== hash || digest(stored.body) !== hash) fail('checkpoint-conflict');
    const base = body.baseBudget;
    await authoringCollection(structureReviewProgressCol()).updateOne({ checkpointId: stored!._id }, { $setOnInsert: {
      courseId, checkpointId: stored!._id, checkpointHash: hash, ownerRunId: runId, revision: 0, findings: [], attempts: {}, failures: [], unresolvedDispatchIds: [],
      usedTokens: base.admissionTokens ?? base.estimatedInputTokens + base.reservedOutputTokens,
      reservations: base.observedSends, pendingNative: [], maxTokens: base.limits.maxEstimatedTokens, maxSends: base.limits.maxSends, updatedAt: new Date(),
    } }, { upsert: true });
    await updateContentRun(runId, { structureReview: { checkpointId: stored!._id, checkpointHash: hash } });
    return stored!;
  });
}

export async function readStructureReviewCheckpoint(checkpointId: ObjectId, expectedHash: string): Promise<WithId<StructureReviewCheckpoint>> {
  const checkpoint = await structureReviewCheckpointsCol().findOne({ _id: checkpointId });
  if (!checkpoint || checkpoint.hash !== expectedHash || digest(checkpoint.body) !== expectedHash) fail('checkpoint-changed');
  validateStructureReviewCheckpoint(checkpoint!.body);
  return checkpoint!;
}

export async function findStructureReviewCheckpoint(runId: ObjectId): Promise<WithId<StructureReviewCheckpoint> | null> {
  const checkpoint = await structureReviewCheckpointsCol().findOne({ runId });
  return checkpoint ? readStructureReviewCheckpoint(checkpoint._id, checkpoint.hash) : null;
}

/** Internal controlled loader only; never exposed as an HTTP JSON import.
 * Authoritative parent findings are reread here, not accepted from a browser. */
export async function importRetainedStructureReviewCheckpoint(body: StructureReviewCheckpointBody, authority: RetainedStructureReviewAuthority,
  assertCurrent: () => Promise<void>): Promise<WithId<StructureReviewCheckpoint>> {
  validateStructureReviewCheckpoint(body);
  const projection = projectRetainedStructureReviews(body, authority);
  const runId = new ObjectId(body.rootRunId); const courseId = new ObjectId(body.courseId);
  const parent = await getContentRun(runId);
  if (!parent || parent.kind !== 'structure-generation' || parent.status !== 'failed' || !parent.courseId.equals(courseId) ||
      body.origin !== 'retained-artifact-import-v1' || !body.importedAuthority ||
      parent.structureDiagnostics?.outlineGrounding?.version !== 'original-final-lo-review-v2') fail('retained-parent-unavailable');
  const original = parent.structureDiagnostics.outlineGrounding.findings;
  if (!equal(original, body.importedAuthority.originalFindings) || !equal(original.map(row => ({ id: row.id, hash: digest(row) })), body.importedAuthority.parentFindingHashes)) fail('retained-parent-changed');
  const budget = parent.structureDiagnostics.budget;
  if (budget.pendingSends !== 0 || body.baseBudget.observedSends !== budget.observedSends ||
      body.baseBudget.admissionTokens !== budget.admissionTokens || body.baseBudget.limits.maxEstimatedTokens > budget.limits.maxEstimatedTokens ||
      body.baseBudget.limits.maxSends > budget.limits.maxSends) fail('retained-budget-changed');
  const expected = body.batches.flatMap(batch => batch.objectives);
  if (new Set(projection.findings.map(row => row.id)).size !== projection.findings.length) fail('retained-finding-identity');
  projection.findings.forEach(row => validateCheckpointFinding(body, row));
  for (const old of original) {
    const canonical = structuredClone(old);
    if (old.status !== 'supported' && old.coveredEvidenceIds.length) {
      canonical.coveredEvidenceIds = [];
      canonical.ignoredModelCoverage = { authoritative: false, reason: 'negative-source-verdict', evidenceIds: [...old.coveredEvidenceIds] };
    }
    const projected = projection.findings.find(row => row.id === old.id);
    if (!projected || !sameProjectedStructureFinding(canonical, projected)) fail('retained-finding-changed');
  }
  const added = projection.findings.filter(row => !original.some(old => old.id === row.id));
  if (added.length !== 1 || added[0].id !== 'L96' || added[0].status === 'supported' || projection.attempts.L96 !== 2 ||
      original.length !== 102 || expected.length !== 142 || projection.findings.length !== 103 ||
      Object.entries(projection.attempts).some(([id, count]) => !projection.findings.some(row => row.id === id) || ![1, 2].includes(count))) fail('retained-import-scope');
  const hash = digest(body);
  return withCourseAuthoringWrite(courseId, async () => {
    await assertCurrent();
    if (!await authoringCollection(coursesCol()).findOne({ _id: courseId, authoringDeletionStartedAt: { $exists: false }, archivedAt: { $exists: false }, lifecycle: { $ne: 'archived' } })) fail('course-unavailable');
    let checkpoint = await authoringCollection(structureReviewCheckpointsCol()).findOne({ courseId, runId });
    if (!checkpoint) {
      const document: StructureReviewCheckpoint = { courseId, runId, hash, body: structuredClone(body), createdAt: new Date() };
      const inserted = await authoringCollection(structureReviewCheckpointsCol()).insertOne(document);
      checkpoint = { ...document, _id: inserted.insertedId };
    }
    if (checkpoint.hash !== hash || digest(checkpoint.body) !== hash) fail('checkpoint-conflict');
    await authoringCollection(structureReviewProgressCol()).updateOne({ checkpointId: checkpoint._id }, { $setOnInsert: {
      courseId, checkpointId: checkpoint._id, checkpointHash: hash, ownerRunId: runId, revision: 0,
      findings: structuredClone(projection.findings), attempts: { ...projection.attempts }, failures: [], unresolvedDispatchIds: [],
      usedTokens: body.baseBudget.admissionTokens ?? body.baseBudget.estimatedInputTokens + body.baseBudget.reservedOutputTokens,
      reservations: body.baseBudget.observedSends, pendingNative: [], maxTokens: body.baseBudget.limits.maxEstimatedTokens,
      maxSends: body.baseBudget.limits.maxSends, updatedAt: new Date(),
    } }, { upsert: true });
    return checkpoint;
  });
}

/** Claims a single linked child. Different request UUIDs cannot reset this proposal. */
export async function createStructureReviewContinuation(parentRunId: ObjectId, requestedBy: string, assertCurrent: () => Promise<void>): Promise<WithId<StructureGenerationRun>> {
  const parent = await getContentRun(parentRunId);
  if (!parent || parent.kind !== 'structure-generation' || !['failed', 'completed'].includes(parent.status) || parent.structureReview?.parentRunId) fail('parent-not-terminal');
  const ref = parent!.kind === 'structure-generation' ? parent!.structureReview : undefined;
  const checkpoint = ref ? await readStructureReviewCheckpoint(ref.checkpointId, ref.checkpointHash) : await findStructureReviewCheckpoint(parentRunId);
  if (!checkpoint) fail('checkpoint-unavailable');
  if (!checkpoint.runId.equals(parentRunId) || !checkpoint.courseId.equals(parent!.courseId)) fail('parent-changed');
  return withCourseAuthoringWrite(checkpoint.courseId, async () => {
    await assertCurrent();
    if (!await authoringCollection(coursesCol()).findOne({ _id: checkpoint.courseId, authoringDeletionStartedAt: { $exists: false }, archivedAt: { $exists: false }, lifecycle: { $ne: 'archived' } })) fail('course-unavailable');
    const progress = await authoringCollection(structureReviewProgressCol()).findOne({ checkpointId: checkpoint._id });
    if (!progress || progress.pendingNative.length || progress.unresolvedDispatchIds.length) fail('pending-dispatch');
    const parentBudget = parent.kind === 'structure-generation' ? parent.structureDiagnostics?.budget : undefined;
    if (!parentBudget || parentBudget.pendingSends !== 0) fail('parent-budget-unreconciled');
    assertStructureReviewBudgetCoherence(checkpoint.body, progress, parentBudget);
    if (progress.continuationRunId) {
      if (!progress.continuationBaseBudget) fail('parent-budget-unreconciled');
      const child = await getContentRun(progress.continuationRunId);
      if (!child || child.kind !== 'structure-generation') fail('child-unavailable');
      return child as WithId<StructureGenerationRun>;
    }
    if (progress.findings.length >= checkpoint.body.batches.flatMap(batch => batch.objectives).length) fail('already-resolved');
    if (progress.usedTokens >= progress.maxTokens || progress.reservations >= progress.maxSends) fail('budget-exhausted');
    if (parentBudget.observedSends !== progress.reservations ||
        (parentBudget.admissionTokens ?? parentBudget.estimatedInputTokens + parentBudget.reservedOutputTokens) !== progress.usedTokens) fail('parent-budget-unreconciled');
    let child: WithId<StructureGenerationRun>;
    const existing = await authoringCollection(contentRunsCol()).findOne({ 'structureReview.checkpointId': checkpoint._id, 'structureReview.parentRunId': parentRunId });
    if (existing?.kind === 'structure-generation') child = existing;
    else {
      try {
        child = await createStructureGenerationRun({ courseId: checkpoint.courseId, requestedBy,
          options: { ...checkpoint.body.options, materialIds: checkpoint.body.corpus.materials.map(material => material.materialId) },
          structureReview: { checkpointId: checkpoint._id, checkpointHash: checkpoint.hash, parentRunId } });
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
        const winner = await authoringCollection(contentRunsCol()).findOne({ 'structureReview.checkpointId': checkpoint._id, 'structureReview.parentRunId': parentRunId });
        if (!winner || winner.kind !== 'structure-generation') throw error;
        child = winner;
      }
    }
    const claimed = await authoringCollection(structureReviewProgressCol()).updateOne({ _id: progress._id, revision: progress.revision, continuationRunId: { $exists: false } },
      { $set: { ownerRunId: child._id, continuationRunId: child._id, continuationStartReservations: progress.reservations,
        continuationBaseBudget: parentBudget, updatedAt: new Date() }, $inc: { revision: 1 } });
    if (claimed.modifiedCount !== 1) {
      const winner = await authoringCollection(structureReviewProgressCol()).findOne({ checkpointId: checkpoint._id });
      if (!winner?.continuationRunId?.equals(child._id)) fail('continuation-conflict');
    }
    return child;
  });
}

export async function getStructureReviewProgress(checkpoint: WithId<StructureReviewCheckpoint>, runId: ObjectId): Promise<WithId<StructureReviewProgress>> {
  let progress = await currentProgress(checkpoint, runId);
  if (progress.unresolvedDispatchIds.length && !progress.pendingNative.length) {
    const retained = await structureReviewAttemptsCol().find({ checkpointId: checkpoint._id, runId, status: 'validated' }).toArray();
    const matches = retained.filter(row => equal(row.ids, progress.unresolvedDispatchIds));
    if (matches.length === 1) {
      const row = matches[0];
      if (!row.findings || !row.failures || row.rawHash !== digest(row.raw)) fail('retained-reply-changed');
      assertCapabilityDispatch(checkpoint.body, row.ids, row.item, row.raw, row.findings, row.failures, progress.findings);
      row.findings.forEach(finding => validateCheckpointFinding(checkpoint.body, finding));
      progress = await mutateProgress(checkpoint, runId, current => {
        if (!equal(current.unresolvedDispatchIds, row.ids) || row.findings!.some(finding => current.findings.some(old => old.id === finding.id))) fail('dispatch-conflict');
        return { unresolvedDispatchIds: [], findings: [...current.findings, ...row.findings!],
          failures: [...current.failures.filter(failure => !row.ids.includes(failure.id)), ...row.failures!] };
      });
    }
  }
  progress.findings.forEach(finding => validateCheckpointFinding(checkpoint.body, finding));
  return progress;
}

export async function claimStructureReviewDispatch(checkpoint: WithId<StructureReviewCheckpoint>, runId: ObjectId, ids: string[], attempt: number, item: number): Promise<string> {
  const dispatchId = randomUUID();
  await mutateProgress(checkpoint, runId, current => {
    if (current.unresolvedDispatchIds.length || !ids.length || new Set(ids).size !== ids.length) fail('pending-dispatch');
    const expected = checkpoint.body.batches.flatMap(batch => batch.objectives);
    if (ids.some(id => !expected.some(row => row.id === id) || current.findings.some(row => row.id === id) || (current.attempts[id] ?? 0) !== attempt || attempt >= 2)) fail('attempt-exhausted');
    return { unresolvedDispatchIds: [...ids], attempts: { ...current.attempts, ...Object.fromEntries(ids.map(id => [id, attempt + 1])) } };
  });
  await structureReviewAttemptsCol().insertOne({ courseId: checkpoint.courseId, checkpointId: checkpoint._id, runId, dispatchId, ids, attempt, item, status: 'claimed', createdAt: new Date() });
  return dispatchId;
}

export async function finishStructureReviewDispatch(checkpoint: WithId<StructureReviewCheckpoint>, runId: ObjectId, dispatchId: string,
  input: { ids: string[]; raw: unknown; findings: OutlineGroundingFinding[]; failures: OutlineGroundingRowFailure[] }): Promise<void> {
  input.findings.forEach(finding => validateCheckpointFinding(checkpoint.body, finding));
  if (Buffer.byteLength(JSON.stringify(input.raw), 'utf8') > MAX_DOCUMENT_BYTES) fail('reply-too-large');
  const attempt = await structureReviewAttemptsCol().findOne({ checkpointId: checkpoint._id, runId, dispatchId, status: 'claimed' });
  if (!attempt || !equal(attempt.ids, input.ids)) fail('dispatch-conflict');
  if (checkpoint.body.options.capabilityDistinctnessProtocol) {
    const progress = await currentProgress(checkpoint, runId);
    assertCapabilityDispatch(checkpoint.body, input.ids, attempt!.item, input.raw, input.findings, input.failures, progress.findings);
  }
  const replyHash = digest(input.raw);
  await structureReviewAttemptsCol().updateOne({ _id: attempt!._id, status: 'claimed' }, { $set: { status: 'validated', raw: input.raw, rawHash: replyHash, findings: input.findings, failures: input.failures, completedAt: new Date() } });
  await mutateProgress(checkpoint, runId, current => {
    if (!equal(current.unresolvedDispatchIds, input.ids) || input.findings.some(row => current.findings.some(old => old.id === row.id))) fail('dispatch-conflict');
    return { unresolvedDispatchIds: [], findings: [...current.findings, ...input.findings],
      failures: [...current.failures.filter(row => !input.ids.includes(row.id)), ...input.failures] };
  });
}

/** Before SDK entry, conservatively cover both raw sendMessage and the native
 * single-user streaming envelope. CompleteJson has not exposed transport at
 * this hook, so nonstreaming is intentionally overreserved. Unknown work stays
 * charged; this is not a provider tokenizer or billed-usage estimate. */
export async function reserveStructureReviewSend(checkpoint: WithId<StructureReviewCheckpoint>, runId: ObjectId, send: ModelSendAdmission): Promise<string> {
  const id = randomUUID(); const system = send.systemPrompt ?? '';
  const input = Math.max(Buffer.byteLength(send.prompt + system, 'utf8'),
    Buffer.byteLength(JSON.stringify([{ role: 'user', content: send.prompt }]) + system, 'utf8')) + 32;
  await mutateProgress(checkpoint, runId, current => {
    const child = current.continuationStartReservations !== undefined;
    const continuation = !checkpoint.runId.equals(runId);
    const maximumInput = child ? Math.min(48000, checkpoint.body.baseBudget.limits.maxInputTokens) : checkpoint.body.baseBudget.limits.maxInputTokens;
    const maximumOutput = continuation ? Math.min(6000, checkpoint.body.baseBudget.limits.maxOutputTokens) : 6000;
    if (!current.unresolvedDispatchIds.length || send.model !== checkpoint.body.model.model ||
        input > maximumInput || !Number.isSafeInteger(send.outputCap) || send.outputCap > maximumOutput || send.outputCap <= 0 ||
        current.usedTokens + input + send.outputCap > current.maxTokens || current.reservations >= current.maxSends ||
        (child && current.reservations - current.continuationStartReservations! >= 18)) fail('budget-exhausted');
    return { usedTokens: current.usedTokens + input + send.outputCap, reservations: current.reservations + 1,
      inputEstimator: 'max-raw-or-single-user-envelope-utf8-bytes-plus32-v1',
      pendingNative: [...current.pendingNative, { id, input, output: send.outputCap }] };
  });
  return id;
}

export async function recordStructureReviewSend(checkpoint: WithId<StructureReviewCheckpoint>, runId: ObjectId, reservationId: string, event: ModelCallEvent): Promise<void> {
  await mutateProgress(checkpoint, runId, current => {
    const reservation = current.pendingNative.find(row => row.id === reservationId);
    if (!reservation || (reservation.callId && reservation.callId !== event.callId)) fail('send-identity');
    return { pendingNative: event.type === 'finished' ? current.pendingNative.filter(row => row.id !== reservationId) :
      current.pendingNative.map(row => row.id === reservationId ? { ...row, callId: event.callId } : row) };
  });
}
