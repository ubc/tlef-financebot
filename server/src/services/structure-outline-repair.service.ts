import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { ObjectId, type WithId } from 'mongodb';
import { env } from '../config/env';
import type { StructureGenerationRun } from '../types/domain';
import type { StructureResult } from '../types/structure';
import type { StructureReviewCheckpointBody, StructureReviewCorpus } from '../types/structure-review';
import type { StructureCoverageRepairRequest, StructureRepairBranch, StructureRepairInput } from '../types/structure-repair';
import type { StructureRepairChildView, StructureRepairPointView, StructureRepairTargetView, StructureRepairView } from '../types/structure-repair-view';
import type { CompleteJsonOptions, ModelCallEvent, ModelSendAdmission } from '../components/genai/llm';
import type { AuthoringBudgetReceipt } from '../types/authoring-budget';
import { contentRunsCol, coursesCol, structureRepairBranchesCol, structureReviewCheckpointsCol, structureReviewProgressCol } from '../components/mongodb/collections';
import { authoringCollection, authoringCommitAvailable, currentAuthoringSession, withCourseAuthoringWrite } from './authoring-commit.service';
import { assertContentRunActive, createStructureGenerationRun, getContentRun, updateContentRun } from './content-runs.service';
import { readStructureReviewCheckpoint, structureReviewHash, validateCheckpointFinding, validateStructureReviewCheckpoint } from './structure-review-checkpoint.service';
import { AuthoringBudget, withAuthoringBudget } from './authoring-budget.service';
import { outlineGroundingReceipt, selectOutlineGroundingBatch, validateOutlineGroundingRows } from './structure-outline-grounding';
import { finalizeStructureProposal, reviewStructureProposal } from './structure-outline-review';
import { buildOutlineWordingRepairBody, createOutlineWordingRepairPrompt, outlineWordingRepairProtocolHash,
  assessOutlineCoverageRepair, createOutlineCoverageRepairPrompt, outlineCoverageRepairProtocolHash, resolveOutlineCoverageRepairTargets,
  estimateOutlineRepairInput, STRUCTURE_REPAIR_LIMITS, validateOutlineWordingRepairProposal } from './structure-outline-repair';

export interface StructureRepairRuntime {
  loadCorpus(body: StructureReviewCheckpointBody): Promise<StructureReviewCorpus>;
  complete(prompt: string, request: CompleteJsonOptions, stage: 'outline-source-repair' | 'outline-source-review', attempt: number, item?: number): Promise<unknown>;
  finalize(body: StructureReviewCheckpointBody, themes: StructureResult['themes'], budget: AuthoringBudgetReceipt,
    grounding: NonNullable<StructureResult['coverage']['outlineGrounding']>): StructureResult;
}
const MAX_BYTES = 8_000_000;
function fail(reason: string): never { throw new Error(`structure-repair-${reason}`); }
const providerHash = () => structureReviewHash({ provider: env.llmProvider, endpoint: env.llmEndpoint });
function repairProtocolHash(version: unknown): string {
  if (version === 'wording-only-outline-repair-v1') return outlineWordingRepairProtocolHash();
  if (version === 'coverage-wording-outline-repair-v1') return outlineCoverageRepairProtocolHash();
  return fail('branch-mode');
}

async function parentAuthority(parentRunId: ObjectId, fenced = false) {
  const parent = fenced ? await authoringCollection(contentRunsCol()).findOne({ _id: parentRunId }) : await getContentRun(parentRunId);
  if (!parent || parent.kind !== 'structure-generation' || parent.status !== 'completed' || Object.hasOwn(parent, 'structureRepair') || !parent.structureReview ||
    !parent.structureResult?.coverage.outlineGrounding?.complete || !parent.structureDiagnostics) fail('parent-not-complete');
  // Source-only wording repair cannot buy a second, source-incomplete branch
  // from a capability-reviewed parent's inherited allowance. Absence retains
  // the historical contract; every explicit selector is refused here.
  if (Object.hasOwn(parent.input, 'capabilityDistinctnessProtocol')) fail('capability-parent-unsupported');
  const checkpoint = fenced ? await authoringCollection(structureReviewCheckpointsCol()).findOne({ _id: parent.structureReview.checkpointId })
    : await readStructureReviewCheckpoint(parent.structureReview.checkpointId, parent.structureReview.checkpointHash);
  if (!checkpoint || checkpoint.hash !== parent.structureReview.checkpointHash || structureReviewHash(checkpoint.body) !== checkpoint.hash) fail('parent-checkpoint-changed');
  validateStructureReviewCheckpoint(checkpoint.body);
  if (!checkpoint.courseId.equals(parent.courseId)) fail('parent-course');
  if (!(checkpoint.runId instanceof ObjectId) || !checkpoint.runId.equals(parent.structureReview.parentRunId ?? parent._id) || checkpoint.body.rootRunId !== checkpoint.runId.toHexString() ||
    checkpoint.body.courseId !== parent.courseId.toHexString()) fail('parent-checkpoint-changed');
  const progress = await (fenced ? authoringCollection(structureReviewProgressCol()) : structureReviewProgressCol()).findOne({ checkpointId: checkpoint._id });
  const expected = checkpoint.body.batches.flatMap(batch => batch.objectives);
  if (!progress || !(progress.courseId instanceof ObjectId) || !(progress.ownerRunId instanceof ObjectId) || !(progress.checkpointId instanceof ObjectId) ||
    !progress.courseId.equals(parent.courseId) || !progress.checkpointId.equals(checkpoint._id) || progress.checkpointHash !== checkpoint.hash || !progress.ownerRunId.equals(parent._id) ||
    progress.pendingNative.length || progress.unresolvedDispatchIds.length || progress.findings.length !== expected.length ||
    new Set(progress.findings.map(row => row.id)).size !== expected.length ||
    structureReviewHash(progress.findings) !== structureReviewHash(parent.structureResult.coverage.outlineGrounding.findings)) fail('parent-review-incomplete');
  for (const finding of progress.findings) validateCheckpointFinding(checkpoint.body, finding);
  const budget = parent.structureDiagnostics.budget;
  if (![budget.admissionTokens, budget.observedSends, budget.limits.maxEstimatedTokens, budget.limits.maxSends, progress.usedTokens, progress.reservations]
    .every(value => Number.isSafeInteger(value) && value! >= 0) || budget.accounting !== 'conservative-reservations-v1' || budget.pendingSends !== 0 || budget.observedSends !== progress.reservations ||
    budget.admissionTokens !== progress.usedTokens || budget.limits.maxEstimatedTokens !== progress.maxTokens || budget.limits.maxSends !== progress.maxSends) fail('parent-budget-unreconciled');
  const progressHash = structureReviewHash({ checkpointHash: progress.checkpointHash, ownerRunId: progress.ownerRunId,
    findings: progress.findings, attempts: progress.attempts, usedTokens: progress.usedTokens, reservations: progress.reservations,
    pendingNative: progress.pendingNative, unresolvedDispatchIds: progress.unresolvedDispatchIds, maxTokens: progress.maxTokens, maxSends: progress.maxSends });
  return { parent, checkpoint, progress, budget, progressHash };
}

function assertCoverageTargets(input: StructureRepairInput, authority: Awaited<ReturnType<typeof parentAuthority>>): void {
  if (input.version !== 'coverage-wording-outline-repair-v1') return;
  if (structureReviewHash(authority.parent) !== input.parentRunHash || authority.progressHash !== input.parentProgressHash ||
    authority.checkpoint.hash !== input.parentCheckpointHash || authority.checkpoint._id.toHexString() !== input.parentCheckpointId ||
    providerHash() !== input.providerIdentityHash || authority.checkpoint.body.corpus.fingerprint !== input.sourceFingerprint) fail('parent-or-provider-changed');
  if (!Array.isArray(input.coverageTargets)) fail('coverage-targets-changed');
  const derived = resolveOutlineCoverageRepairTargets(authority.checkpoint.body, authority.progress.findings,
    input.coverageTargets.map(({ id, evidenceIds }) => ({ id, evidenceIds })));
  if (!isDeepStrictEqual(derived, input.coverageTargets) || !isDeepStrictEqual(derived.map(row => row.id), input.targetIds)) fail('coverage-targets-changed');
}

/** Internal Instructor/Admin workflow. The caller supplies the production
 * original-source loader, never a browser eligibility verdict. No paid work. */
export async function createStructureOutlineRepair(courseId: ObjectId, parentRunId: ObjectId, requestedBy: string, targetIds: string[],
  loadCorpus: StructureRepairRuntime['loadCorpus']): Promise<WithId<StructureGenerationRun>> {
  return createStructureOutlineRepairBranch(courseId, parentRunId, requestedBy, { version: 'wording-only-outline-repair-v1', targetIds }, loadCorpus);
}

/** Internal bounded repair of explicitly requested missing assigned capability.
 * Target preservation is derived from the authoritative parent, not the caller. */
export async function createStructureOutlineCoverageRepair(courseId: ObjectId, parentRunId: ObjectId, requestedBy: string,
  requests: StructureCoverageRepairRequest[], loadCorpus: StructureRepairRuntime['loadCorpus']): Promise<WithId<StructureGenerationRun>> {
  return createStructureOutlineRepairBranch(courseId, parentRunId, requestedBy, { version: 'coverage-wording-outline-repair-v1', requests }, loadCorpus);
}

async function createStructureOutlineRepairBranch(courseId: ObjectId, parentRunId: ObjectId, requestedBy: string,
  selection: { version: 'wording-only-outline-repair-v1'; targetIds: string[] } | { version: 'coverage-wording-outline-repair-v1'; requests: StructureCoverageRepairRequest[] },
  loadCorpus: StructureRepairRuntime['loadCorpus']): Promise<WithId<StructureGenerationRun>> {
  const authority = await parentAuthority(parentRunId); const body = authority.checkpoint.body;
  const coverageTargets = selection.version === 'coverage-wording-outline-repair-v1'
    ? resolveOutlineCoverageRepairTargets(body, authority.progress.findings, selection.requests) : undefined;
  const targetIds = coverageTargets ? coverageTargets.map(row => row.id) : selection.version === 'wording-only-outline-repair-v1' ? selection.targetIds : [];
  if (!authority.parent.courseId.equals(courseId) || !targetIds.length || targetIds.length > 2 || new Set(targetIds).size !== targetIds.length) fail('target-identity');
  const ordered = body.batches.flatMap(batch => batch.objectives).filter(row => targetIds.includes(row.id)).map(row => row.id);
  if (ordered.length !== targetIds.length || !coverageTargets && ordered.some(id => authority.progress.findings.find(row => row.id === id)?.status === 'supported')) fail('target-not-withheld');
  validateStructureReviewCheckpoint(body, await loadCorpus(body));
  if (providerHash() !== body.providerIdentityHash) fail('provider-changed');
  const proposalPrompt = coverageTargets ? createOutlineCoverageRepairPrompt(body, authority.progress.findings, coverageTargets)
    : createOutlineWordingRepairPrompt(body, authority.progress.findings.filter(row => ordered.includes(row.id)));
  // Initial internal two-target pilot: reject full-original input before even
  // the course fence/run/cycle claim writes. Do not trim or enlarge the cap.
  if (estimateOutlineRepairInput(proposalPrompt) > STRUCTURE_REPAIR_LIMITS.maxInputTokens) fail('proposal-input-cap');
  if (authority.budget.observedSends >= authority.budget.limits.maxSends || authority.budget.admissionTokens! +
    estimateOutlineRepairInput(proposalPrompt) + STRUCTURE_REPAIR_LIMITS.maxOutputTokens > authority.budget.limits.maxEstimatedTokens) fail('budget-exhausted');
  const input: StructureRepairInput = { ...(coverageTargets ? { version: 'coverage-wording-outline-repair-v1' as const, coverageTargets }
    : { version: 'wording-only-outline-repair-v1' as const }), cycle: 1, parentRunId: parentRunId.toHexString(),
    parentRunHash: structureReviewHash(authority.parent), parentCheckpointId: authority.checkpoint._id.toHexString(), parentCheckpointHash: authority.checkpoint.hash,
    parentProgressHash: authority.progressHash, targetIds: ordered, model: body.model, providerIdentityHash: body.providerIdentityHash,
    protocolHash: repairProtocolHash(selection.version), sourceFingerprint: body.corpus.fingerprint, baseBudget: structuredClone(authority.budget), limits: STRUCTURE_REPAIR_LIMITS };
  const inputHash = structureReviewHash(input);
  return withCourseAuthoringWrite(courseId, async () => {
    if (!await authoringCollection(coursesCol()).findOne({ _id: courseId, authoringDeletionStartedAt: { $exists: false }, archivedAt: { $exists: false }, lifecycle: { $ne: 'archived' } })) fail('course-unavailable');
    validateStructureReviewCheckpoint(body, await loadCorpus(body));
    const latest = await parentAuthority(parentRunId);
    if (structureReviewHash(latest.parent) !== input.parentRunHash || latest.progressHash !== input.parentProgressHash) fail('parent-changed');
    assertCoverageTargets(input, latest);
    const existing = await authoringCollection(structureRepairBranchesCol()).findOne({ 'input.parentCheckpointId': input.parentCheckpointId, 'input.parentCheckpointHash': input.parentCheckpointHash, 'input.cycle': 1 });
    if (existing) {
      if (existing.inputHash !== inputHash || structureReviewHash(existing.input) !== inputHash) fail('cycle-already-used');
      const run = await getContentRun(existing.runId);
      if (!run || run.kind !== 'structure-generation' || !run.structureRepair?.branchId.equals(existing._id)) fail('run-unavailable');
      return run;
    }
    if (input.baseBudget.admissionTokens! >= input.baseBudget.limits.maxEstimatedTokens || input.baseBudget.observedSends >= input.baseBudget.limits.maxSends) fail('budget-exhausted');
    const branchId = new ObjectId();
    const run = await createStructureGenerationRun({ courseId, requestedBy, options: authority.parent.input,
      structureRepair: { branchId, inputHash, parentRunId } });
    const now = new Date();
    await authoringCollection(structureRepairBranchesCol()).insertOne({ _id: branchId, courseId, runId: run._id, requestedBy, input, inputHash,
      revision: 0, createdAt: now, updatedAt: now, proposalState: 'unclaimed', findings: [], attempts: {}, failures: [], unresolvedDispatchIds: [], reviewAttempts: [],
      usedTokens: input.baseBudget.admissionTokens!, reservations: input.baseBudget.observedSends, newReservations: 0, pendingNative: [],
      inputEstimator: 'max-raw-or-single-user-envelope-utf8-bytes-plus32-v1' });
    return run;
  }, { required: true });
}

async function readBranch(runId: ObjectId, fenced = false): Promise<WithId<StructureRepairBranch>> {
  const run = fenced ? await authoringCollection(contentRunsCol()).findOne({ _id: runId }) : await getContentRun(runId);
  if (!run || run.kind !== 'structure-generation' || !run.structureRepair) fail('run-unavailable');
  const branch = await (fenced ? authoringCollection(structureRepairBranchesCol()) : structureRepairBranchesCol()).findOne({ _id: run.structureRepair.branchId });
  if (!branch || !branch.input || !(branch.runId instanceof ObjectId) || !(branch.courseId instanceof ObjectId) || !branch.runId.equals(runId) || !branch.courseId.equals(run.courseId) || branch.inputHash !== run.structureRepair.inputHash ||
    structureReviewHash(branch.input) !== branch.inputHash || branch.input.protocolHash !== repairProtocolHash(branch.input.version) ||
    !isDeepStrictEqual(branch.input.limits, STRUCTURE_REPAIR_LIMITS) || branch.input.cycle !== 1 ||
    branch.proposalBody && structureReviewHash(branch.proposalBody) !== branch.proposalBodyHash) fail('branch-changed');
  return branch;
}

/** A stored positive finding alone is not its independent review transcript.
 * Replay every completed response against the exact own-original dispatch and
 * keep earlier failed rows as diagnostics, without purchasing another attempt. */
function validateRepairReviewHistory(branch: WithId<StructureRepairBranch>, authority: Awaited<ReturnType<typeof parentAuthority>>): void {
  const body = branch.proposalBody!;
  const changed = branch.changedIds!;
  const attempts = new Map(changed.map(id => [id, 0]));
  const resolved = new Set<string>(), dispatchIds = new Set<string>();
  for (const entry of branch.reviewAttempts) {
    if (entry.status !== 'validated' || !entry.raw || structureReviewHash(entry.raw) !== entry.rawHash ||
      typeof entry.id !== 'string' || !entry.id || dispatchIds.has(entry.id) || !Number.isSafeInteger(entry.item) || entry.item < 0 ||
      !Number.isSafeInteger(entry.attempt) || entry.attempt < 0 || entry.attempt > 1 || !Array.isArray(entry.ids) || !entry.ids.length ||
      new Set(entry.ids).size !== entry.ids.length || entry.ids.some(id => !attempts.has(id) || resolved.has(id) || attempts.get(id) !== entry.attempt) ||
      !Array.isArray(entry.findings) || !Array.isArray(entry.failures)) fail('adoption-review-history-changed');
    const batch = body.batches[entry.item];
    if (!batch || entry.ids.some(id => !batch.objectives.some(objective => objective.id === id))) fail('adoption-review-history-changed');
    const pending = selectOutlineGroundingBatch(batch, entry.ids);
    if (structureReviewHash(pending.objectives.map(row => row.id)) !== structureReviewHash(entry.ids)) fail('adoption-review-history-changed');
    const checked = validateOutlineGroundingRows(entry.raw, pending);
    if (structureReviewHash(checked.findings) !== structureReviewHash(entry.findings) || structureReviewHash(checked.failures) !== structureReviewHash(entry.failures) ||
      checked.failures.some(row => !entry.ids.includes(row.id)) || entry.attempt === 1 && checked.failures.length) fail('adoption-review-history-changed');
    dispatchIds.add(entry.id);
    for (const id of entry.ids) attempts.set(id, entry.attempt + 1);
    for (const finding of checked.findings) {
      const final = branch.findings.find(row => row.id === finding.id);
      if (!final || structureReviewHash(final) !== structureReviewHash(finding)) fail('adoption-review-history-changed');
      resolved.add(finding.id);
    }
  }
  if (changed.some(id => !resolved.has(id)) || branch.newReservations < branch.reviewAttempts.length + 1) fail('adoption-review-history-changed');
  const expectedAttempts = { ...Object.fromEntries(Object.entries(authority.progress.attempts).filter(([id]) => !changed.includes(id))),
    ...Object.fromEntries(attempts) };
  if (!isDeepStrictEqual(expectedAttempts, branch.attempts)) fail('adoption-review-history-changed');
  for (const finding of authority.progress.findings) if (!changed.includes(finding.id)) {
    const retained = branch.findings.find(row => row.id === finding.id);
    if (!retained || structureReviewHash(retained) !== structureReviewHash(finding)) fail('adoption-review-history-changed');
  }
}

/** Older finalizers emitted this optional own property with undefined, which
 * the default Mongo BSON writer persisted as null. Only that absent optional
 * receipt has equivalent representations; every other result key stays bound. */
function finalizedRepairResultHash(result: StructureResult): string {
  const coverage = { ...result.coverage };
  if (coverage.synthesisInput === undefined || coverage.synthesisInput === null) delete coverage.synthesisInput;
  return structureReviewHash({ ...result, coverage });
}

/** Replay the completed model result, never the instructor's later text edits.
 * Adoption supplies fenced=true so every authority read participates in the
 * caller's existing course transaction. No model work belongs in this path. */
async function checkedRepairResult(courseId: ObjectId, run: WithId<StructureGenerationRun>,
  loadCorpus: StructureRepairRuntime['loadCorpus'], finalize: StructureRepairRuntime['finalize'], fenced: boolean): Promise<WithId<StructureRepairBranch>> {
  if (!run.courseId.equals(courseId) || run.status !== 'completed' || !run.structureRepair || !run.structureResult) fail('adoption-run-unavailable');
  const branch = await readBranch(run._id, fenced);
  const authority = await parentAuthority(new ObjectId(branch.input.parentRunId), fenced);
  const parent = authority.checkpoint.body;
  if (!authority.parent.courseId.equals(courseId) || !run.structureRepair.parentRunId.equals(authority.parent._id) ||
    structureReviewHash(authority.parent) !== branch.input.parentRunHash || authority.progressHash !== branch.input.parentProgressHash ||
    authority.checkpoint.hash !== branch.input.parentCheckpointHash || authority.checkpoint._id.toHexString() !== branch.input.parentCheckpointId ||
    parent.corpus.fingerprint !== branch.input.sourceFingerprint || providerHash() !== branch.input.providerIdentityHash ||
    !isDeepStrictEqual(branch.input.model, parent.model) || !isDeepStrictEqual(branch.input.baseBudget, authority.budget)) fail('parent-or-provider-changed');
  if (!await (fenced ? authoringCollection(coursesCol()) : coursesCol()).findOne({ _id: courseId, authoringDeletionStartedAt: { $exists: false },
    archivedAt: { $exists: false }, lifecycle: { $ne: 'archived' } })) fail('course-unavailable');
  assertCoverageTargets(branch.input, authority);
  const current = await loadCorpus(parent);
  validateStructureReviewCheckpoint(parent, current);
  if (branch.proposalState !== 'validated' || !branch.proposalBody || !branch.proposalRaw ||
    structureReviewHash(branch.proposalRaw) !== branch.proposalRawHash || branch.pendingNative.length || branch.unresolvedDispatchIds.length ||
    branch.reviewAttempts.some(row => row.status !== 'validated')) fail('adoption-review-incomplete');
  const proposal = validateOutlineWordingRepairProposal(branch.proposalRaw, parent, branch.input.targetIds);
  const replacements = proposal.filter(row => row.status === 'proposed').map(({ id, name }) => ({ id, name }));
  const expectedBody = buildOutlineWordingRepairBody(parent, replacements, run._id.toHexString(), branch.proposalBody.baseBudget);
  if (structureReviewHash(expectedBody) !== structureReviewHash(branch.proposalBody) || !isDeepStrictEqual(replacements.map(row => row.id), branch.changedIds)) fail('adoption-proposal-changed');
  validateStructureReviewCheckpoint(branch.proposalBody, current);
  validateRepairReviewHistory(branch, authority);
  for (const finding of branch.findings) validateCheckpointFinding(branch.proposalBody, finding);
  const admitted = finalizeStructureProposal(branch.proposalBody.themes, branch.findings, branch.proposalBody.batches.flatMap(batch => batch.objectives));
  if (branch.input.version === 'coverage-wording-outline-repair-v1') {
    const assessment = assessOutlineCoverageRepair(parent, branch.proposalBody, authority.progress.findings,
      branch.findings, branch.input.coverageTargets, branch.changedIds ?? []);
    if (assessment.status !== 'passed' || !isDeepStrictEqual(assessment, branch.coverageAssessment)) fail('adoption-coverage-changed');
  } else if (branch.coverageAssessment !== undefined) fail('adoption-coverage-changed');
  const result = run.structureResult;
  if (!result.coverage?.outlineGrounding || !result.coverage.sourceSelection || !Array.isArray(result.themes) || !Array.isArray(result.evidence) ||
    structureReviewHash(result.themes) !== structureReviewHash(admitted.themes) || structureReviewHash(result.evidence) !== structureReviewHash(parent.evidence) ||
    structureReviewHash(result.coverage.outlineGrounding) !== structureReviewHash(admitted.receipt) || result.coverage.sourceFingerprint !== parent.corpus.fingerprint ||
    structureReviewHash(result.coverage.sourceSelection) !== structureReviewHash(parent.corpus.sourceSelection)) fail('adoption-result-changed');
  const budget = result.coverage.budget, base = branch.input.baseBudget;
  if (!budget || !run.structureDiagnostics?.outlineGrounding || !isDeepStrictEqual(run.structureDiagnostics.budget, budget) ||
    structureReviewHash(run.structureDiagnostics.outlineGrounding) !== structureReviewHash(admitted.receipt) || budget.accounting !== 'conservative-reservations-v1' ||
    budget.pendingSends !== 0 || budget.observedSends !== branch.reservations || budget.admissionTokens !== branch.usedTokens ||
    ![budget.estimatedInputTokens, budget.reservedOutputTokens, budget.admissionTokens, budget.observedSends,
      branch.usedTokens, branch.reservations, branch.newReservations].every(value => Number.isSafeInteger(value) && value! >= 0) ||
    budget.estimatedInputTokens < base.estimatedInputTokens || budget.reservedOutputTokens < base.reservedOutputTokens ||
    budget.estimatedInputTokens + budget.reservedOutputTokens > branch.usedTokens ||
    !isDeepStrictEqual(budget.limits, base.limits) || branch.newReservations !== branch.reservations - base.observedSends ||
    branch.newReservations < 1 || branch.newReservations > branch.input.limits.maxSends || branch.reservations > base.limits.maxSends ||
    branch.usedTokens < base.admissionTokens! || branch.usedTokens > Math.min(base.limits.maxEstimatedTokens, base.admissionTokens! + branch.input.limits.maxEstimatedTokens)) fail('adoption-budget-unreconciled');
  if (finalizedRepairResultHash(finalize(branch.proposalBody, admitted.themes, budget, admitted.receipt)) !== finalizedRepairResultHash(result)) fail('adoption-result-changed');
  return branch;
}

/** Called inside the required short course fence immediately before Apply.
 * Ordinary historical/manual runs keep their original adoption contract. */
export async function assertStructureRepairAdoptable(courseId: ObjectId, run: WithId<StructureGenerationRun>,
  loadCorpus: StructureRepairRuntime['loadCorpus'], finalize: StructureRepairRuntime['finalize']): Promise<{ parentRunId: string; mode: StructureRepairInput['version'] } | undefined> {
  if (!Object.hasOwn(run, 'structureRepair')) return;
  if (!run.structureRepair || !(run.structureRepair.branchId instanceof ObjectId) || !(run.structureRepair.parentRunId instanceof ObjectId) ||
    typeof run.structureRepair.inputHash !== 'string' || !/^[a-f0-9]{64}$/.test(run.structureRepair.inputHash)) fail('adoption-run-unavailable');
  if (!currentAuthoringSession()) fail('adoption-transaction-required');
  return withCourseAuthoringWrite(courseId, async () => {
    const current = await authoringCollection(contentRunsCol()).findOne({ _id: run._id, courseId, kind: 'structure-generation', status: 'completed' });
    if (!current || current.kind !== 'structure-generation' || !isDeepStrictEqual(current, run)) fail('adoption-run-changed');
    const branch = await checkedRepairResult(courseId, current, loadCorpus, finalize, true);
    return { parentRunId: branch.input.parentRunId, mode: branch.input.version };
  }, { required: true });
}

const REPAIR_VIEW_LIMITS = { maxTargets: 2, maxPointsPerTarget: 8, maxSends: 10,
  maxInputUnits: 48000, maxOutputUnits: 6000, maxNewUnits: 540000 } as const;
const MAX_REPAIR_VIEW_BYTES = 2_000_000;
const viewMessage = (reason: string | null) => ({
  'checkpoint-unavailable': 'This historical outline has no complete original-source review checkpoint. Generate a new reviewed outline to request a bounded repair.',
  'parent-not-complete': 'A complete, reconciled original-source review is required before repair.',
  'source-unavailable': 'The retained original-source bindings are no longer current. The saved parent remains available for inspection.',
  'course-unavailable': 'This course is archived or unavailable for authoring.',
  'coordinated-commit-unavailable': 'Bounded repairs require transaction support on this server.',
  'cycle-used': 'The single repair cycle for this parent has already been used. Changing mode or targets cannot start another cycle.',
  'budget-exhausted': 'The inherited conservative request allowance is exhausted. No extra model work will be started.',
  'no-targets': 'No supported-objective coverage gaps or withheld wording targets are available in this review.',
  'response-too-large': 'The complete retained quote projection exceeds the bounded response size. No quotes have been shortened; request a smaller page.',
}[reason ?? ''] ?? (reason ? 'The retained repair authority is unavailable or has changed. No repair will be started.'
  : 'Choose one repair mode and at most two objectives. Model review remains independent, and adding a reviewed child to the course is a separate action.'));

function pointView(body: StructureReviewCheckpointBody, id: string): StructureRepairPointView {
  const point = body.evidence.find(row => row.id === id);
  if (!point) fail('view-point-unavailable');
  return { id: point.id, objective: point.objective, materialId: point.materialId, materialName: point.materialName, chunkIndex: point.chunkIndex,
    quotes: [{ ...(point.sourcePassageId ? { passageId: point.sourcePassageId } : {}), text: point.quote },
      ...(point.supportingPassages ?? []).map(row => ({ passageId: row.passageId, text: row.quote }))] };
}

/** Read-only Instructor projection. Gap IDs nominate review work, never taught
 * truth. Full original evidence is still reread before any future dispatch. */
export async function getStructureOutlineRepairView(courseId: ObjectId, requestedRunId: ObjectId,
  loadCorpus: StructureRepairRuntime['loadCorpus'], finalize: StructureRepairRuntime['finalize'], options: { page?: number; pageSize?: number } = {}): Promise<StructureRepairView> {
  const page = options.page ?? 1, pageSize = options.pageSize ?? 10;
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 10) fail('view-page-invalid');
  const requested = await getContentRun(requestedRunId);
  if (!requested || requested.kind !== 'structure-generation' || !requested.courseId.equals(courseId)) fail('view-run-unavailable');
  if (Object.hasOwn(requested, 'structureRepair') && (!requested.structureRepair || !(requested.structureRepair.branchId instanceof ObjectId) ||
    !(requested.structureRepair.parentRunId instanceof ObjectId) || typeof requested.structureRepair.inputHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(requested.structureRepair.inputHash))) fail('view-run-unavailable');
  const parentId = requested.structureRepair?.parentRunId ?? requested._id;
  const parent = requested.structureRepair ? await getContentRun(parentId) : requested;
  if (!parent || parent.kind !== 'structure-generation' || !parent.courseId.equals(courseId) || parent.structureRepair) fail('view-parent-unavailable');
  const view: StructureRepairView = { version: 'outline-wording-repair-view-v1', requestedRunId: requestedRunId.toHexString(), parentRunId: parentId.toHexString(),
    parentStatus: parent.status, availability: { canStart: false, reason: null, message: '' }, limits: REPAIR_VIEW_LIMITS,
    budget: { accounting: 'conservative-units-v1', remainingSends: 0, remainingUnits: 0 }, cycle: { used: false }, targets: { items: [], total: 0, page, pageSize } };
  const unavailable = (reason: string): StructureRepairView => ({ ...view, availability: { canStart: false, reason, message: viewMessage(reason) } });
  if (!parent.structureReview) return unavailable('checkpoint-unavailable');
  if (parent.status !== 'completed') return unavailable('parent-not-complete');
  let authority: Awaited<ReturnType<typeof parentAuthority>>;
  try {
    authority = await parentAuthority(parentId);
    validateStructureReviewCheckpoint(authority.checkpoint.body, await loadCorpus(authority.checkpoint.body));
    if (providerHash() !== authority.checkpoint.body.providerIdentityHash) return unavailable('source-unavailable');
  } catch { return unavailable('source-unavailable'); }
  const body = authority.checkpoint.body;
  const budget = authority.budget;
  view.budget.remainingSends = Math.max(0, Math.min(STRUCTURE_REPAIR_LIMITS.maxSends, budget.limits.maxSends - budget.observedSends));
  view.budget.remainingUnits = Math.max(0, Math.min(STRUCTURE_REPAIR_LIMITS.maxEstimatedTokens, budget.limits.maxEstimatedTokens - budget.admissionTokens!));
  const mapped = new Set(authority.progress.findings.filter(row => row.status === 'supported').flatMap(row => row.coveredEvidenceIds));
  const objectives = body.batches.flatMap(batch => batch.objectives);
  const targets: Array<Omit<StructureRepairTargetView, 'points'>> = [];
  for (const objective of objectives) {
    const finding = authority.progress.findings.find(row => row.id === objective.id)!;
    const missing = objective.evidenceIds.filter(id => !mapped.has(id));
    if (finding.status === 'supported' && !missing.length) continue;
    targets.push({ id: objective.id, topic: objective.topic, name: objective.name, status: finding.status,
      mode: finding.status === 'supported' ? 'coverage-wording-outline-repair-v1' : 'wording-only-outline-repair-v1', reason: finding.reason,
      preservedEvidenceIds: [...finding.coveredEvidenceIds], missingEvidenceIds: missing });
  }
  let projectedTargets = targets.slice((page - 1) * pageSize, page * pageSize);
  view.targets.total = targets.length;
  const existing = await structureRepairBranchesCol().findOne({ 'input.parentCheckpointId': authority.checkpoint._id.toHexString(),
    'input.parentCheckpointHash': authority.checkpoint.hash, 'input.cycle': 1 });
  if (existing) {
    const childRun = await getContentRun(existing.runId);
    const branch = await readBranch(existing.runId);
    if (!childRun || childRun.kind !== 'structure-generation' || !childRun.courseId.equals(courseId) || !childRun.structureRepair?.parentRunId.equals(parentId)) fail('view-child-unavailable');
    if (branch.input.parentRunId !== parentId.toHexString() || structureReviewHash(authority.parent) !== branch.input.parentRunHash ||
      authority.progressHash !== branch.input.parentProgressHash) fail('view-child-unavailable');
    for (const finding of branch.findings) validateCheckpointFinding(branch.proposalBody ?? body, finding);
    const selectedTargets = targets.filter(row => branch.input.targetIds.includes(row.id));
    if (selectedTargets.length !== branch.input.targetIds.length) fail('view-target-unavailable');
    projectedTargets = selectedTargets;
    view.targets = { items: [], total: selectedTargets.length, page: 1, pageSize: Math.max(pageSize, selectedTargets.length) };
    view.cycle = { used: true, childRunId: childRun._id.toHexString(), childStatus: childRun.status, mode: branch.input.version };
    let proposed: ReturnType<typeof validateOutlineWordingRepairProposal> = [];
    try {
      if (branch.proposalRaw && structureReviewHash(branch.proposalRaw) === branch.proposalRawHash)
        proposed = validateOutlineWordingRepairProposal(branch.proposalRaw, body, branch.input.targetIds);
    } catch { /* A failed model proposal is not a reviewed replacement or a no-repair verdict. */ }
    const child: StructureRepairChildView = { runId: childRun._id.toHexString(), parentRunId: parentId.toHexString(), mode: branch.input.version,
      status: childRun.status, canApply: false, unknownWork: Boolean(branch.pendingNative.length || branch.unresolvedDispatchIds.length || branch.proposalState === 'claimed'),
      ...(childRun.error ? { error: { code: childRun.error.code, message: childRun.error.message } } : {}),
      targets: branch.input.targetIds.map(id => {
        const original = body.batches.flatMap(batch => batch.objectives).find(row => row.id === id);
        if (!original) fail('view-target-unavailable');
        const proposal = proposed.find(row => row.id === id), finding = branch.findings.find(row => row.id === id);
        return { id, topic: original.topic, before: original.name,
          ...(proposal?.status === 'proposed' ? { after: proposal.name } : {}), proposalStatus: proposal?.status ?? 'pending',
          ...(proposal ? { proposalReason: proposal.reason } : {}),
          ...(finding ? { finding: { status: finding.status, reason: finding.reason, coveredEvidenceIds: [...finding.coveredEvidenceIds], citedSourceIds: [...finding.citedSourceIds] } } : {}) };
      }) };
    if (branch.coverageAssessment && branch.input.version === 'coverage-wording-outline-repair-v1' && branch.proposalBody) {
      const checked = assessOutlineCoverageRepair(body, branch.proposalBody, authority.progress.findings, branch.findings,
        branch.input.coverageTargets, branch.changedIds ?? []);
      if (!isDeepStrictEqual(checked, branch.coverageAssessment)) fail('view-child-review-changed');
      child.coverageAssessment = { status: checked.status, targets: structuredClone(checked.targets) };
    }
    if (childRun.status === 'completed' && (authoringCommitAvailable() || currentAuthoringSession())) {
      try { await checkedRepairResult(courseId, childRun, loadCorpus, finalize, false); child.canApply = true; }
      catch { child.error = { code: 'structure-repair-adoption-unavailable', message: 'The completed child does not pass its current local authority checks. It cannot be applied.' }; }
    }
    view.child = child;
  } else if (requested.structureRepair) fail('view-child-unavailable');
  // Project only the requested page (or two already-selected targets), not
  // every repeated quote in a large curriculum. The response bound refuses
  // full quotes explicitly rather than shortening evidence to fit.
  let pointBytes = 0;
  for (const target of projectedTargets) {
    const objective = objectives.find(row => row.id === target.id)!;
    const points: StructureRepairPointView[] = [];
    for (const id of objective.evidenceIds) {
      const point = pointView(body, id);
      pointBytes += Buffer.byteLength(JSON.stringify(point), 'utf8');
      if (pointBytes > MAX_REPAIR_VIEW_BYTES) { view.targets.items = []; view.child = undefined; return unavailable('response-too-large'); }
      points.push(point);
    }
    view.targets.items.push({ ...target, points });
  }
  const course = await coursesCol().findOne({ _id: courseId, authoringDeletionStartedAt: { $exists: false }, archivedAt: { $exists: false }, lifecycle: { $ne: 'archived' } });
  const reason = !course ? 'course-unavailable' : view.cycle.used ? 'cycle-used' : !authoringCommitAvailable() && !currentAuthoringSession() ? 'coordinated-commit-unavailable'
    : !view.budget.remainingSends || view.budget.remainingUnits <= STRUCTURE_REPAIR_LIMITS.maxOutputTokens ? 'budget-exhausted' : !targets.length ? 'no-targets' : null;
  view.availability = { canStart: reason === null, reason, message: viewMessage(reason) };
  if (Buffer.byteLength(JSON.stringify(view), 'utf8') > MAX_REPAIR_VIEW_BYTES) {
    view.targets.items = []; view.child = undefined; return unavailable('response-too-large');
  }
  return view;
}

async function mutateBranch(runId: ObjectId, change: (row: WithId<StructureRepairBranch>) => Partial<StructureRepairBranch> | Promise<Partial<StructureRepairBranch>>): Promise<WithId<StructureRepairBranch>> {
  const first = await readBranch(runId);
  return withCourseAuthoringWrite(first.courseId, async () => {
    await assertContentRunActive(runId);
    if (!await authoringCollection(coursesCol()).findOne({ _id: first.courseId, authoringDeletionStartedAt: { $exists: false }, archivedAt: { $exists: false }, lifecycle: { $ne: 'archived' } })) fail('course-unavailable');
    const current = await readBranch(runId); const set = { ...await change(current), revision: current.revision + 1, updatedAt: new Date() };
    if (Buffer.byteLength(JSON.stringify({ ...current, ...set }), 'utf8') > MAX_BYTES) fail('branch-too-large');
    const next = await authoringCollection(structureRepairBranchesCol()).findOneAndUpdate({ _id: current._id, runId, revision: current.revision }, { $set: set }, { returnDocument: 'after' });
    if (!next) fail('branch-conflict'); return next;
  }, { required: true });
}

/** This fence exists before a repaired proposal/checkpoint has been produced. */
export async function reserveStructureRepairSend(runId: ObjectId, send: ModelSendAdmission, stage: 'outline-source-repair' | 'outline-source-review'): Promise<string> {
  const id = randomUUID(); const input = estimateOutlineRepairInput(send.prompt, send.systemPrompt);
  await mutateBranch(runId, async branch => {
    if (branch.input.version === 'coverage-wording-outline-repair-v1') assertCoverageTargets(branch.input, await parentAuthority(new ObjectId(branch.input.parentRunId)));
    const maximum = branch.input.limits; const base = branch.input.baseBudget;
    if (send.model !== branch.input.model.model || !Number.isSafeInteger(send.outputCap) || send.outputCap <= 0 || send.outputCap > maximum.maxOutputTokens ||
      input > maximum.maxInputTokens || branch.newReservations >= maximum.maxSends || branch.reservations >= base.limits.maxSends ||
      branch.usedTokens + input + send.outputCap > Math.min(base.limits.maxEstimatedTokens, base.admissionTokens! + maximum.maxEstimatedTokens) ||
      stage === 'outline-source-repair' && branch.proposalState !== 'claimed' || stage === 'outline-source-review' && !branch.unresolvedDispatchIds.length) fail('budget-or-stage');
    return { usedTokens: branch.usedTokens + input + send.outputCap, reservations: branch.reservations + 1, newReservations: branch.newReservations + 1,
      pendingNative: [...branch.pendingNative, { id, input, output: send.outputCap, stage }] };
  });
  return id;
}
async function recordSend(runId: ObjectId, id: string, event: ModelCallEvent): Promise<void> {
  await mutateBranch(runId, branch => {
    const entry = branch.pendingNative.find(row => row.id === id);
    if (!entry || entry.callId && entry.callId !== event.callId) fail('native-identity');
    return { pendingNative: event.type === 'finished' ? branch.pendingNative.filter(row => row.id !== id) : branch.pendingNative.map(row => row.id === id ? { ...row, callId: event.callId } : row) };
  });
}

/** Atomic worker ownership is acquired by runStructureGeneration. This service
 * has no extraction/organization/Apply callback and accepts no source verdict. */
export async function runStructureOutlineRepair(runId: ObjectId, runtime: StructureRepairRuntime): Promise<StructureResult> {
  const initial = await readBranch(runId); const authority = await parentAuthority(new ObjectId(initial.input.parentRunId));
  const parentBody = authority.checkpoint.body; const base = initial.input.baseBudget;
  const assertCurrent = async () => {
    await assertContentRunActive(runId); const branch = await readBranch(runId);
    const current = await parentAuthority(new ObjectId(branch.input.parentRunId));
    if (structureReviewHash(current.parent) !== branch.input.parentRunHash || current.progressHash !== branch.input.parentProgressHash ||
      current.checkpoint.hash !== branch.input.parentCheckpointHash || current.checkpoint._id.toHexString() !== branch.input.parentCheckpointId ||
      providerHash() !== branch.input.providerIdentityHash || current.checkpoint.body.corpus.fingerprint !== branch.input.sourceFingerprint) fail('parent-or-provider-changed');
    assertCoverageTargets(branch.input, current);
    validateStructureReviewCheckpoint(parentBody, await runtime.loadCorpus(parentBody));
  };
  await assertCurrent();
  if (initial.pendingNative.length || initial.unresolvedDispatchIds.length || initial.proposalState === 'claimed') fail('unknown-dispatch');
  // One worker invocation owns this cycle. The branch retains exact raw and
  // cost evidence after a crash, but no hydration/reconciliation API currently
  // exists to restore native usage. Refuse replay rather than report only the
  // newest invocation as all work or reset consumed corrections.
  if (initial.proposalState !== 'unclaimed' || initial.newReservations !== 0 || initial.reviewAttempts.length || initial.proposalBody || initial.proposalRaw ||
    initial.usedTokens !== base.admissionTokens || initial.reservations !== base.observedSends) fail('resume-requires-audited-reconciliation');
  const remaining = Math.min(STRUCTURE_REPAIR_LIMITS.maxEstimatedTokens - (initial.usedTokens - base.admissionTokens!), base.limits.maxEstimatedTokens - initial.usedTokens);
  const sends = Math.min(STRUCTURE_REPAIR_LIMITS.maxSends - initial.newReservations, base.limits.maxSends - initial.reservations);
  if (remaining <= 0 || sends <= 0) fail('budget-exhausted');
  const budget = new AuthoringBudget(`outline-repair:${runId.toHexString()}`, { maxSends: sends, maxInputTokens: 48000, maxOutputTokens: 6000, maxEstimatedTokens: remaining }, assertCurrent);
  const receipt = async (): Promise<AuthoringBudgetReceipt> => {
    const branch = await readBranch(runId); const fresh = budget.snapshot();
    const sum = (left: number | null, right: number | null) => left === null && right === null ? null : (left ?? 0) + (right ?? 0);
    return { ...fresh, limits: base.limits, observedSends: base.observedSends + fresh.observedSends, admissionTokens: branch.usedTokens,
      estimatedInputTokens: base.estimatedInputTokens + fresh.estimatedInputTokens, reservedOutputTokens: base.reservedOutputTokens + fresh.reservedOutputTokens,
      pendingSends: Math.max(fresh.pendingSends ?? 0, branch.pendingNative.length),
      reportedInputTokens: sum(base.reportedInputTokens, fresh.reportedInputTokens), reportedOutputTokens: sum(base.reportedOutputTokens, fresh.reportedOutputTokens),
      usageCompleteness: base.usageCompleteness === 'complete' && fresh.usageCompleteness === 'complete' ? 'complete' : 'partial',
      queueWaitMs: base.queueWaitMs + fresh.queueWaitMs, executionMs: base.executionMs + fresh.executionMs,
      conservativeFinishedSends: (base.conservativeFinishedSends ?? 0) + (fresh.conservativeFinishedSends ?? 0) };
  };
  const send = async (prompt: string, stage: 'outline-source-repair' | 'outline-source-review', attempt: number, item?: number): Promise<unknown> => {
    let reservation: string | undefined;
    return runtime.complete(prompt, { ...initial.input.model, maxTokens: 6000,
      beforeRequest: async admission => { await assertCurrent(); if (!admission) fail('native-admission-unavailable'); reservation = await reserveStructureRepairSend(runId, admission, stage); },
      onAttempt: async event => { if (!reservation) fail('native-reservation-unavailable'); await recordSend(runId, reservation, event); },
      usageContext: { stage, ...(item === undefined ? {} : { item }), candidateAttempt: attempt } }, stage, attempt, item);
  };
  const diagnostics = async () => {
    const branch = await readBranch(runId); const body = branch.proposalBody ?? parentBody;
    await updateContentRun(runId, { stage: branch.proposalBody ? 'checking' : 'synthesizing', message: branch.proposalBody ? `Reviewing repaired bindings: ${branch.findings.length}/${body.batches.flatMap(batch => batch.objectives).length}` : 'Proposing one source-bound wording repair',
      structureDiagnostics: { sourceSelection: body.corpus.sourceSelection, cache: body.cache, budget: await receipt(), synthesisInput: body.synthesisInput,
        ...(branch.proposalBody ? { outlineGrounding: outlineGroundingReceipt(branch.findings, body.batches.flatMap(batch => batch.objectives).length) } : {}), unprocessedSections: [] } });
  };
  const recordCoverageAssessment = async () => mutateBranch(runId, async branch => {
    if (branch.input.version !== 'coverage-wording-outline-repair-v1' || !branch.proposalBody || branch.pendingNative.length || branch.unresolvedDispatchIds.length) fail('coverage-assessment-state');
    const current = await parentAuthority(new ObjectId(branch.input.parentRunId));
    assertCoverageTargets(branch.input, current);
    return { coverageAssessment: assessOutlineCoverageRepair(parentBody, branch.proposalBody, current.progress.findings,
      branch.findings, branch.input.coverageTargets, branch.changedIds ?? []) };
  });
  try {
    return await withAuthoringBudget(budget, async () => {
      if (initial.proposalState === 'unclaimed') {
        await mutateBranch(runId, async branch => {
          if (branch.proposalState !== 'unclaimed') fail('proposal-already-claimed');
          if (branch.input.version === 'coverage-wording-outline-repair-v1') assertCoverageTargets(branch.input, await parentAuthority(new ObjectId(branch.input.parentRunId)));
          return { proposalState: 'claimed' };
        });
        await diagnostics();
        const proposalPrompt = initial.input.version === 'coverage-wording-outline-repair-v1'
          ? createOutlineCoverageRepairPrompt(parentBody, authority.progress.findings, initial.input.coverageTargets)
          : createOutlineWordingRepairPrompt(parentBody, authority.progress.findings.filter(row => initial.input.targetIds.includes(row.id)));
        const raw = await send(proposalPrompt, 'outline-source-repair', 0);
        await mutateBranch(runId, () => ({ proposalRaw: raw, proposalRawHash: structureReviewHash(raw) }));
        await assertCurrent();
        const proposal = validateOutlineWordingRepairProposal(raw, parentBody, initial.input.targetIds);
        const replacements = proposal.filter(row => row.status === 'proposed').map(({ id, name }) => ({ id, name }));
        const branch = await readBranch(runId); if (branch.pendingNative.length) fail('unknown-dispatch');
        const body = buildOutlineWordingRepairBody(parentBody, replacements, runId.toHexString(), await receipt());
        validateStructureReviewCheckpoint(body, await runtime.loadCorpus(parentBody));
        const changedIds = replacements.map(row => row.id); const retained = authority.progress.findings.filter(row => !changedIds.includes(row.id));
        for (const finding of retained) validateCheckpointFinding(body, finding);
        await mutateBranch(runId, row => {
          if (row.proposalState !== 'claimed' || row.proposalBody || row.pendingNative.length) fail('proposal-state');
          return { proposalState: 'validated', proposalBody: body, proposalBodyHash: structureReviewHash(body), changedIds,
            findings: structuredClone(retained), attempts: Object.fromEntries(Object.entries(authority.progress.attempts).filter(([id]) => !changedIds.includes(id))) };
        });
      }
      const stored = await readBranch(runId); const body = stored.proposalBody; if (!body || stored.proposalState !== 'validated') fail('proposal-unavailable');
      validateStructureReviewCheckpoint(body, await runtime.loadCorpus(parentBody));
      let dispatchId: string | undefined;
      const findings = await reviewStructureProposal({ batches: body.batches,
        progress: { findings: stored.findings, attempts: stored.attempts, failures: stored.failures, unresolvedDispatchIds: stored.unresolvedDispatchIds }, assertCurrent,
        beforeDispatch: async (ids, attempt, item) => {
          dispatchId = randomUUID(); const id = dispatchId;
          await mutateBranch(runId, branch => {
            if (branch.unresolvedDispatchIds.length || ids.some(objective => !branch.changedIds?.includes(objective) || branch.findings.some(row => row.id === objective) || (branch.attempts[objective] ?? 0) !== attempt || attempt >= 2)) fail('review-claim');
            return { unresolvedDispatchIds: [...ids], attempts: { ...branch.attempts, ...Object.fromEntries(ids.map(objective => [objective, attempt + 1])) },
              reviewAttempts: [...branch.reviewAttempts, { id, ids, attempt, item, status: 'claimed' }] };
          });
        },
        complete: async (prompt, item, attempt) => {
          const raw = await send(prompt, 'outline-source-review', attempt, item);
          await mutateBranch(runId, branch => ({ reviewAttempts: branch.reviewAttempts.map(row => row.id === dispatchId ? { ...row, raw, rawHash: structureReviewHash(raw) } : row) }));
          return raw;
        },
        afterValidation: async input => { await mutateBranch(runId, branch => {
          if (!dispatchId || structureReviewHash(branch.unresolvedDispatchIds) !== structureReviewHash(input.ids) || branch.pendingNative.length || input.findings.some(row => branch.findings.some(old => old.id === row.id))) fail('review-result');
          return { unresolvedDispatchIds: [], findings: [...branch.findings, ...input.findings], failures: [...branch.failures.filter(row => !input.ids.includes(row.id)), ...input.failures],
            reviewAttempts: branch.reviewAttempts.map(row => row.id === dispatchId ? { ...row, status: 'validated' as const, raw: input.raw, rawHash: structureReviewHash(input.raw), findings: input.findings, failures: input.failures } : row) };
        }); dispatchId = undefined; },
        onReceipt: async () => diagnostics(),
      });
      if (initial.input.version === 'coverage-wording-outline-repair-v1') {
        await assertCurrent();
        const assessed = await recordCoverageAssessment();
        if (assessed.coverageAssessment?.status !== 'passed') { await diagnostics(); fail('coverage-shortfall'); }
      }
      const admitted = finalizeStructureProposal(body.themes, findings, body.batches.flatMap(batch => batch.objectives));
      await assertCurrent(); const terminal = await readBranch(runId); if (terminal.pendingNative.length || terminal.unresolvedDispatchIds.length) fail('unknown-dispatch');
      await diagnostics(); return runtime.finalize(body, admitted.themes, await receipt(), admitted.receipt);
    });
  } catch (error) {
    // Completed malformed/missing review rows can retain an explicit coverage
    // shortfall. Transport, cancellation, source drift and budget faults retain
    // their original failure and unknown native reservations.
    if (initial.input.version === 'coverage-wording-outline-repair-v1' && error instanceof Error && error.message.startsWith('structure-grounding-')) {
      try {
        await assertCurrent(); const branch = await readBranch(runId);
        if (branch.proposalBody && !branch.pendingNative.length && !branch.unresolvedDispatchIds.length) {
          const assessed = await recordCoverageAssessment();
          if (assessed.coverageAssessment?.status === 'shortfall') { await diagnostics(); fail('coverage-shortfall'); }
        }
      } catch (diagnosticError) {
        if (diagnosticError instanceof Error && diagnosticError.message === 'structure-repair-coverage-shortfall') throw diagnosticError;
      }
    }
    // Cancellation/terminal CAS can make telemetry unwritable. Keep the real
    // failure and its existing durable reservations rather than masking it.
    try { await diagnostics(); } catch { /* Existing branch/native receipts remain available. */ }
    throw error;
  }
}
