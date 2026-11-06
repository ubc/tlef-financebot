jest.mock('../../server/src/config/env', () => ({ env: { llmProvider: 'openai', llmEndpoint: '', authoringStructureMaxInputTokens: 200000,
  authoringMaxInputTokens: 24000, authoringMaxOutputTokens: 24000, authoringMaxEstimatedTokens: 2000000, authoringMaxSends: 100 } }));
jest.mock('../../server/src/components/mongodb', () => ({ getDb: jest.fn(), getMongoClient: jest.fn() }));
jest.mock('../../server/src/components/mongodb/collections', () => ({ contentRunsCol: jest.fn(), coursesCol: jest.fn(),
  structureReviewCheckpointsCol: jest.fn(), structureReviewProgressCol: jest.fn(), structureReviewAttemptsCol: jest.fn(),
  materialsCol: jest.fn(), materialChunksCol: jest.fn(), themesCol: jest.fn(), losCol: jest.fn(), sourceEvidenceExtractionsCol: jest.fn() }));
jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn(() => { throw new Error('unexpected-provider-call'); }) }));
jest.mock('../../server/src/components/jobs', () => ({ defineJob: jest.fn(() => { throw new Error('unexpected-job-definition'); }),
  enqueueJob: jest.fn(() => { throw new Error('unexpected-job-enqueue'); }) }));
jest.mock('../../server/src/services/content-runs.service', () => ({
  ...jest.requireActual('../../server/src/services/content-runs.service'), assertContentRunActive: jest.fn(), updateContentRun: jest.fn(), getContentRun: jest.fn(),
}));
jest.mock('../../server/src/services/source-readiness.service', () => ({ ...jest.requireActual('../../server/src/services/source-readiness.service'),
  assertSourceSelectionReady: jest.fn(), getMaterialSourceReadiness: jest.fn() }));

import { createHash } from 'node:crypto';
import { BSON, ObjectId, type ClientSession, type WithId } from 'mongodb';
import { getDb, getMongoClient } from '../../server/src/components/mongodb';
import { contentRunsCol, coursesCol, structureReviewCheckpointsCol, structureReviewProgressCol, structureReviewAttemptsCol,
  materialsCol, materialChunksCol, themesCol, losCol, sourceEvidenceExtractionsCol } from '../../server/src/components/mongodb/collections';
import { initializeAuthoringCommitSupport, withCourseAuthoringWrite } from '../../server/src/services/authoring-commit.service';
import { currentAuthoringBudget, estimateAuthoringTokens } from '../../server/src/components/genai/llm/authoring-budget';
import type { completeJson } from '../../server/src/components/genai/llm';
import { assertStructureCapabilityAdoptable, type StructureCapabilityAdoptionRuntime } from '../../server/src/services/structure-capability-adoption.service';
import { prepareStructureOutlineConsolidation, readStructureConsolidationParent } from '../../server/src/services/structure-consolidation-parent.service';
import { validateOutlineConsolidationProposal } from '../../server/src/services/structure-outline-consolidation';
import { finalizeStructureCoverage, generateStructure } from '../../server/src/services/structure-generation.service';
import { assertSourceSelectionReady, getMaterialSourceReadiness, hashSourceChunks } from '../../server/src/services/source-readiness.service';
import * as checkpointService from '../../server/src/services/structure-review-checkpoint.service';
import { claimStructureReviewDispatch, finishStructureReviewDispatch, getStructureReviewProgress,
  validateStructureReviewCheckpoint } from '../../server/src/services/structure-review-checkpoint.service';
import { assertContentRunActive } from '../../server/src/services/content-runs.service';
import { finalizeCapabilityStructureProposal, planCapabilityOutlineGrounding, selectCapabilityOutlineGroundingBatch,
  outlineCapabilityGroundingReceipt, structureOutlineReviewProtocolHash, validateCapabilityOutlineGroundingRows } from '../../server/src/services/structure-capability-grounding';
import type { CapabilityOutlineGroundingBatch } from '../../server/src/services/structure-capability-grounding';
import type { StructureGenerationRun, MaterialChunk } from '../../server/src/types/domain';
import type { OutlineCapabilityComparison } from '../../server/src/types/structure-distinctness';
import type { StructureResult } from '../../server/src/types/structure';
import type { StructureReviewAttempt, StructureReviewCheckpoint, StructureReviewCheckpointBody, StructureReviewProgress } from '../../server/src/types/structure-review';

const PROTOCOL = 'outline-capability-distinctness-v1';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const courseId = new ObjectId(), runId = new ObjectId(), checkpointId = new ObjectId();
const session = { withTransaction: jest.fn(async (work: () => Promise<unknown>) => work()), endSession: jest.fn() } as unknown as ClientSession;
const reads: Array<{ collection: string; options: unknown }> = [];
let run: WithId<StructureGenerationRun>, checkpoint: WithId<StructureReviewCheckpoint>, progress: WithId<StructureReviewProgress>;
let history: Array<WithId<StructureReviewAttempt>>;
let body: StructureReviewCheckpointBody, courseAvailable: boolean;

const finalize: StructureCapabilityAdoptionRuntime['finalize'] = (proposal, themes, budget, grounding): StructureResult => {
  // This callback isolates authority replay. Production finalizer behavior is
  // covered by its own integration suite, not duplicated in this fixture.
  const mapped = new Set(themes.flatMap(theme => theme.los.flatMap(lo => lo.evidenceIds)));
  return { themes, evidence: proposal.evidence, coverage: { sourceFingerprint: proposal.corpus.fingerprint,
    sourceSelection: proposal.corpus.sourceSelection, cache: proposal.cache, budget, outlineGrounding: grounding,
    materials: [], analyzedSections: proposal.corpus.sections.length, extractedObjectives: proposal.evidence.length,
    mappedObjectives: mapped.size, unmappedEvidenceIds: proposal.evidence.filter(row => !mapped.has(row.id)).map(row => row.id),
    excludedSections: proposal.excludedSections, warnings: [] } };
};
const runtime: StructureCapabilityAdoptionRuntime = { loadCorpus: jest.fn(async () => body.corpus), finalize: jest.fn(finalize) };

function collection(name: string, value: () => unknown) {
  return { findOne: jest.fn(async (_filter: unknown, options: unknown) => { reads.push({ collection: name, options }); return value(); }) };
}

function comparisonRows(batch: CapabilityOutlineGroundingBatch): OutlineCapabilityComparison[] {
  return batch.capabilityContext.nominations.flatMap(nomination => nomination.peerIds.map(peerId => {
    const own = batch.capabilityContext.objectives.find(row => row.id === nomination.objectiveId)!;
    const peer = batch.capabilityContext.objectives.find(row => row.id === peerId)!;
    const quote = (row: typeof own) => ({ sourceId: row.sourceIds[0], quote: batch.capabilityContext.sources.find(source => source.alias === row.sourceIds[0])!.text });
    return { objectiveId: own.id, peerId, pairId: batch.capabilityContext.pairs.find(pair =>
      [pair.firstId, pair.secondId].includes(own.id) && [pair.firstId, pair.secondId].includes(peerId))!.id,
    relation: 'distinct' as const, candidateOperation: own.name, peerOperation: peer.name, sharedCapabilities: [],
    candidateUniqueCapabilities: [{ operation: own.name, quotes: [quote(own)] }],
    peerUniqueCapabilities: [{ operation: peer.name, quotes: [quote(peer)] }], reason: 'The source teaches different required student operations.' };
  }));
}

function rawFor(batch: CapabilityOutlineGroundingBatch) {
  return { reviews: batch.objectives.map(row => ({ id: row.id, sourceStatus: 'supported', sourceIds: row.sourceIds,
    coveredEvidenceIds: row.evidenceIds, sourceReason: 'The own original teaches this operation.', topicFit: 'fits', topicReason: 'The course heading fits.' })),
  capabilityComparisons: comparisonRows(batch) };
}

function setTerminalFromHistory() {
  const ids = body.batches.flatMap(batch => batch.objectives.map(row => row.id));
  const findings = ids.map(id => history.flatMap(row => row.findings ?? []).find(row => row.id === id)!);
  progress.findings = findings; progress.attempts = Object.fromEntries(ids.map(id => [id,
    Math.max(...history.filter(row => row.ids.includes(id)).map(row => row.attempt + 1))]));
  const budget = { ...body.baseBudget, observedSends: history.length, estimatedInputTokens: history.length * 20000,
    reservedOutputTokens: history.length * 6000, admissionTokens: history.length * 26000 };
  progress.reservations = budget.observedSends; progress.usedTokens = budget.admissionTokens;
  const admitted = finalizeCapabilityStructureProposal(body.themes, findings, body.batches.flatMap(batch => batch.objectives), body.batches);
  run.structureResult = finalize(body, admitted.themes, budget, admitted.receipt);
  run.structureDiagnostics = { sourceSelection: body.corpus.sourceSelection, cache: body.cache, budget,
    outlineGrounding: admitted.receipt, unprocessedSections: [] };
}

beforeEach(async () => {
  jest.clearAllMocks(); reads.length = 0; courseAvailable = true;
  const sections = [
    'Calculate the debt leverage ratio by dividing debt by firm value.',
    'Explain why the debt leverage ratio increases when debt rises.',
    'A coupon bond pays a periodic coupon cash flow to its holder.',
  ].map((text, index) => ({ id: `original-${index + 1}`, materialId: new ObjectId().toHexString(),
    materialName: `Chapter ${index + 1}.pdf`, chunkIndex: 0, text }));
  const evidence = sections.map((row, index) => ({ id: `E${index + 1}`, objective: row.text, materialId: row.materialId,
    materialName: row.materialName, chunkIndex: 0, quote: row.text }));
  const names = ['Calculate the debt leverage ratio using firm value.', 'Explain the debt leverage ratio effect of rising borrowing.', 'Identify the periodic coupon cash flow of a bond.'];
  const themes = evidence.map((point, index) => ({ name: `Topic ${index + 1}`, los: [{ name: names[index], evidenceIds: [point.id], materialIds: [point.materialId] }] }));
  const now = new Date('2026-10-17T12:00:00Z');
  const options: StructureGenerationRun['input'] = { materialIds: sections.map(row => row.materialId), capabilityDistinctnessProtocol: PROTOCOL };
  const baseBudget = { version: 1 as const, estimator: 'utf8-bytes-conservative-v1' as const, retryVisibility: 'unknown' as const, limitScope: 'process' as const,
    observedSends: 0, estimatedInputTokens: 0, reservedOutputTokens: 0, admissionTokens: 0, pendingSends: 0,
    accounting: 'conservative-reservations-v1' as const, reportedInputTokens: null, reportedOutputTokens: null, usageCompleteness: 'unknown' as const,
    queueWaitMs: 0, executionMs: 0, rejectedSends: 0, logical: { generatorAttempts: 0, repairCycles: 0, evidenceExpansions: 0,
      limits: { generatorAttempts: 2, repairCycles: 1, evidenceExpansions: 1 } },
    limits: { maxSends: 100, maxInputTokens: 48000, maxOutputTokens: 6000, maxEstimatedTokens: 2000000 } };
  body = { version: 'exact-outline-review-v1', origin: 'production-proposal-v1', courseId: courseId.toHexString(), rootRunId: runId.toHexString(),
    options, corpus: { sections, fingerprint: 'original-bytes-and-selection', materials: sections.map(row => ({ materialId: row.materialId, name: row.materialName,
      chunks: 1, sections: 1, sourceTextHash: hash(row.text), parserVersion: 'native-test', chunkerVersion: 'whole-test' })),
    sourceSelection: { ready: true, requested: [], excluded: [], included: sections.map(row => ({ materialId: row.materialId, name: row.materialName,
      revision: 1, sourceTextHash: hash(row.text), chunkCount: 1, characterCount: row.text.length, parserVersion: 'native-test', chunkerVersion: 'whole-test' })) } },
    themes, evidence, extractions: sections.map(row => ({ sectionId: row.id, reused: false,
      row: { sectionId: row.id, objectives: [{ name: row.text, passageId: `${row.id}.P1`, quote: row.text }], knowledge: [] } })),
    excludedSections: [], cache: { hits: 0, misses: 3, reusedSections: 0, extractedSections: 3 },
    reviewInputLimit: 46500, batches: planCapabilityOutlineGrounding(themes, evidence, sections, 46500, PROTOCOL),
    model: { model: 'gpt-6-luna', reasoningEffort: 'none' }, providerIdentityHash: 'a'.repeat(64),
    protocolHash: structureOutlineReviewProtocolHash(PROTOCOL), baseBudget };
  checkpoint = { _id: checkpointId, courseId, runId, hash: hash(body), body, createdAt: now };
  progress = { _id: new ObjectId(), courseId, checkpointId, checkpointHash: checkpoint.hash, ownerRunId: runId, revision: 1,
    findings: [], attempts: {}, failures: [], unresolvedDispatchIds: [], usedTokens: 0, reservations: 0, pendingNative: [],
    maxTokens: baseBudget.limits.maxEstimatedTokens, maxSends: baseBudget.limits.maxSends, updatedAt: now };
  run = { _id: runId, courseId, kind: 'structure-generation', status: 'completed', stage: 'checking', requestedBy: 'test-owner',
    input: options, structureReview: { checkpointId, checkpointHash: checkpoint.hash },
    completedUnits: 0, revision: 1, events: [], warnings: [], createdAt: now, updatedAt: now, completedAt: now };
  history = body.batches.map((batch, item) => {
    const raw = rawFor(batch as CapabilityOutlineGroundingBatch), checked = validateCapabilityOutlineGroundingRows(raw, batch);
    expect(checked.failures).toEqual([]);
    return { _id: new ObjectId(), courseId, checkpointId, runId, dispatchId: `dispatch-${item}`, ids: batch.objectives.map(row => row.id),
      attempt: 0, item, status: 'validated', raw, rawHash: hash(raw), findings: checked.findings, failures: checked.failures, createdAt: now, completedAt: now };
  });
  setTerminalFromHistory();
  jest.mocked(contentRunsCol).mockReturnValue(collection('runs', () => run) as never);
  jest.mocked(coursesCol).mockReturnValue(collection('courses', () => courseAvailable ? { _id: courseId } : null) as never);
  jest.mocked(structureReviewCheckpointsCol).mockReturnValue(collection('checkpoints', () => checkpoint) as never);
  jest.mocked(structureReviewProgressCol).mockReturnValue(collection('progress', () => progress) as never);
  jest.mocked(structureReviewAttemptsCol).mockReturnValue({ find: jest.fn((_filter: unknown, queryOptions: unknown) => {
    reads.push({ collection: 'attempts', options: queryOptions });
    return { sort: () => ({ limit: () => ({ toArray: async () => history }) }) };
  }) } as never);
  jest.mocked(getDb).mockReturnValue({ admin: () => ({ command: async () => ({ setName: 'owned-unit-replica' }) }),
    collection: () => ({ updateOne: async () => ({ matchedCount: 1 }) }) } as never);
  jest.mocked(getMongoClient).mockReturnValue({ startSession: () => session } as never);
  jest.mocked(runtime.loadCorpus).mockImplementation(async () => body.corpus);
  jest.mocked(runtime.finalize).mockImplementation(finalize);
  await initializeAuthoringCommitSupport();
});

const adopt = () => withCourseAuthoringWrite(courseId, () => assertStructureCapabilityAdoptable(courseId, run, runtime), { required: true });

/** Portable synthetic ten-chapter input through the actual fresh generator,
 * review driver, raw validators and coverage finalizer. Only source/storage,
 * model labels and native reservation adapters are scripted; no audit files. */
async function completedCorrectedWorkerResult() {
  const now = new Date('2026-10-17T12:00:00Z');
  const materials = Array.from({ length: 10 }, (_, index) => ({ _id: new ObjectId(), name: `Portable chapter ${index + 1}.pdf` }));
  const chunks: MaterialChunk[] = materials.map((material, index) => {
    const text = `Chapter ${index + 1} teaches financing operation ${index + 1} under its stated conditions.\n`
      + `For financing operation ${index + 1}, apply the stated relationship and explain its effect on the corresponding cash flow.\n`.repeat(32);
    return { courseId, materialId: material._id, index: 0, text, characterCount: text.length, createdAt: now };
  });
  const snapshots = materials.map(material => {
    const own = chunks.filter(chunk => chunk.materialId.equals(material._id));
    return { materialId: material._id.toHexString(), name: material.name, revision: 1,
      sourceTextHash: hashSourceChunks(own), chunkCount: 1, characterCount: own[0].text.length,
      parserVersion: 'portable-scripted-parser', chunkerVersion: 'portable-whole-section' };
  });
  const cursor = (rows: unknown[]) => { const result = { sort: () => result, limit: () => result, toArray: async () => rows }; return result; };
  jest.mocked(materialsCol).mockReturnValue({ find: () => cursor(materials) } as never);
  jest.mocked(materialChunksCol).mockReturnValue({ find: () => cursor(chunks) } as never);
  jest.mocked(themesCol).mockReturnValue({ find: () => cursor([]) } as never);
  jest.mocked(losCol).mockReturnValue({ find: () => cursor([]) } as never);
  jest.mocked(sourceEvidenceExtractionsCol).mockReturnValue({ findOne: async () => null,
    updateOne: async () => ({ matchedCount: 1 }) } as never);
  jest.mocked(assertSourceSelectionReady).mockResolvedValue({ ready: true, requested: [], included: snapshots, excluded: [] });
  jest.mocked(getMaterialSourceReadiness).mockImplementation(async (_course, id) => ({ materialId: id.toHexString(),
    name: snapshots.find(row => row.materialId === id.toHexString())!.name, ready: true, state: 'indexed', classification: 'completed',
    snapshot: snapshots.find(row => row.materialId === id.toHexString())! }));
  jest.mocked(assertContentRunActive).mockResolvedValue(undefined);
  const restored = <T extends object>(value: T): T => BSON.deserialize(BSON.serialize(value)) as T;
  let dispatch: WithId<StructureReviewAttempt> | undefined;
  history = [];
  const spies = [
    jest.spyOn(checkpointService, 'createStructureReviewCheckpoint').mockImplementation(async (_run, proposal) => {
      checkpoint = restored({ _id: checkpointId, runId, courseId, body: proposal, hash: hash(proposal), createdAt: now }); return checkpoint;
    }),
    jest.spyOn(checkpointService, 'getStructureReviewProgress').mockResolvedValue({ findings: [], attempts: {}, failures: [], unresolvedDispatchIds: [] } as never),
    jest.spyOn(checkpointService, 'claimStructureReviewDispatch').mockImplementation(async (_checkpoint, _run, ids, attempt, item) => {
      dispatch = { _id: new ObjectId(), courseId, checkpointId, runId, dispatchId: `portable-worker-${history.length}`,
        ids, attempt, item, status: 'claimed', createdAt: now }; history.push(dispatch); return dispatch.dispatchId;
    }),
    jest.spyOn(checkpointService, 'finishStructureReviewDispatch').mockImplementation(async (_checkpoint, _run, _id, checked) => {
      Object.assign(dispatch!, checked, { rawHash: hash(checked.raw), status: 'validated', completedAt: now });
    }),
    jest.spyOn(checkpointService, 'reserveStructureReviewSend').mockResolvedValue('scripted-native-reservation'),
    jest.spyOn(checkpointService, 'recordStructureReviewSend').mockResolvedValue(undefined),
  ];
  let synthesisCorrected = false;
  const reviewCorrections = new Set<number>();
  const complete: typeof completeJson = async (prompt, options = {}) => {
    const admission = { prompt, provider: 'openai', model: 'gpt-6-luna', options, outputCap: options.maxTokens!, jsonAttempt: 0 };
    const budget = currentAuthoringBudget()!, reservation = budget.reserve(admission);
    try {
      await options.beforeRequest?.(admission);
      if (options.usageContext?.stage === 'source-extraction') {
        const sections = JSON.parse(prompt.split('\n').find(line => line.startsWith('[{'))!) as Array<{
          sectionId: string; material: string; passages: Array<{ id: string }> }>;
        return { sections: sections.map(row => ({ sectionId: row.sectionId, objectives: [{
          name: `Explain the financing operation in ${row.material}.`, passageId: row.passages[0].id }],
        passageDispositions: row.passages.slice(1).map(passage => ({ passageId: passage.id, disposition: 'context',
          reason: 'Scripted complete passage accounting for an authority regression.' })) })) } as never;
      }
      if (options.usageContext?.stage === 'outline-synthesis') {
        if (!synthesisCorrected) { synthesisCorrected = true; return { themes: [] } as never; }
        const ledger = JSON.parse(prompt.split('Evidence ledger:\n')[1].split('\nCorrect')[0]) as {
          learningPoints: Array<{ id: string; objective: string }> };
        return { themes: ledger.learningPoints.map((point, index) => ({ name: `Portable topic ${index + 1}`,
          los: [{ name: point.objective, evidenceIds: [point.id] }] })) } as never;
      }
      if (options.usageContext?.stage !== 'outline-source-review' || !dispatch) throw new Error('unexpected-scripted-stage');
      const sent = selectCapabilityOutlineGroundingBatch(checkpoint.body.batches[dispatch.item], dispatch.ids) as CapabilityOutlineGroundingBatch;
      const raw = rawFor(sent);
      if (dispatch.attempt === 0 && reviewCorrections.size < 2) {
        reviewCorrections.add(dispatch.item); raw.reviews = [];
      }
      return raw as never;
    } finally { budget.finish(reservation); }
  };
  const options: StructureGenerationRun['input'] = { materialIds: materials.map(row => row._id.toHexString()), capabilityDistinctnessProtocol: PROTOCOL };
  let result: StructureResult;
  try { result = await generateStructure(courseId, options, runId, { model: { model: 'gpt-6-luna', reasoningEffort: 'none' }, complete, record: () => {} }); }
  finally { spies.forEach(spy => spy.mockRestore()); }
  body = checkpoint.body;
  expect(body.batches.length).toBeGreaterThan(1); expect(reviewCorrections.size).toBe(2);
  const ids = body.batches.flatMap(batch => batch.objectives.map(row => row.id));
  const findings = ids.map(id => history.flatMap(entry => entry.findings ?? []).find(row => row.id === id)!);
  progress = { ...progress, checkpointHash: checkpoint.hash, ownerRunId: runId, findings,
    attempts: Object.fromEntries(ids.map(id => [id, Math.max(...history.filter(entry => entry.ids.includes(id)).map(entry => entry.attempt + 1))])),
    failures: [], unresolvedDispatchIds: [], pendingNative: [], reservations: result.coverage.budget.observedSends,
    usedTokens: result.coverage.budget.admissionTokens!, maxTokens: result.coverage.budget.limits.maxEstimatedTokens,
    maxSends: result.coverage.budget.limits.maxSends };
  run = { ...run, input: options, structureReview: { checkpointId, checkpointHash: checkpoint.hash }, structureResult: result,
    structureDiagnostics: { sourceSelection: result.coverage.sourceSelection, cache: result.coverage.cache, budget: result.coverage.budget,
      synthesisInput: result.coverage.synthesisInput, outlineGrounding: result.coverage.outlineGrounding, unprocessedSections: [] } };
  const durable = restored({ run, checkpoint, progress, history });
  run = durable.run; checkpoint = durable.checkpoint; progress = durable.progress; history = durable.history; body = checkpoint.body;
  jest.mocked(runtime.finalize).mockImplementation(finalizeStructureCoverage);
  expect(run.structureResult!.themes).toHaveLength(10); expect(run.structureResult!.coverage.materials).toHaveLength(10);
  expect(body.synthesisInput!.validationFailures).toHaveLength(1);
  expect(run.structureResult!.coverage.synthesisInput!.validationFailures).toHaveLength(3);
  expect(history.filter(entry => entry.failures!.length)).toHaveLength(2);
  expect(history.flatMap(entry => entry.failures!).length).toBeGreaterThan(2);
  reads.length = 0; jest.mocked(runtime.finalize).mockClear();
  return run.structureResult!.themes;
}

it('applies an actual completed corrected worker result after BSON while keeping its checkpoint prefix immutable', async () => {
  const themes = await completedCorrectedWorkerResult(), frozen = hash({ run, checkpoint, progress, history });
  const hierarchyWrite = jest.fn();
  await expect(withCourseAuthoringWrite(courseId, async () => {
    const admission = await assertStructureCapabilityAdoptable(courseId, run, runtime); hierarchyWrite(admission); return admission;
  }, { required: true })).resolves.toMatchObject({ reviewedObjectives: 10, withheldObjectives: 0 });
  expect(hierarchyWrite).toHaveBeenCalledTimes(1); expect(hash({ run, checkpoint, progress, history })).toBe(frozen);
  expect(run.structureResult!.themes).toEqual(themes);
  expect(reads.every(row => (row.options as { session?: ClientSession })?.session === session)).toBe(true);
  expect(runtime.finalize).toHaveBeenCalledWith(expect.objectContaining({ synthesisInput: run.structureDiagnostics!.synthesisInput }),
    themes, run.structureResult!.coverage.budget, run.structureResult!.coverage.outlineGrounding);
});

it.each(['missing', 'extra', 'duplicate', 'reordered', 'reason', 'item', 'attempt', 'prefix', 'metadata', 'diagnostics-only'] as const)(
  'refuses a %s mutation of the completed worker correction receipt before the hierarchy write', async change => {
    await completedCorrectedWorkerResult();
    const synthesis = run.structureResult!.coverage.synthesisInput!, failures = synthesis.validationFailures!;
    if (change === 'missing') failures.pop();
    if (change === 'extra') failures.push({ ...failures[1], reason: 'Unrecorded review.' });
    if (change === 'duplicate') failures.push({ ...failures[1] });
    if (change === 'reordered') [failures[1], failures[2]] = [failures[2], failures[1]];
    if (change === 'reason') failures[1].reason += ' Changed.';
    if (change === 'item') failures[1].item = 999;
    if (change === 'attempt') failures[1].attempt = 1;
    if (change === 'prefix') failures[0].reason += ' Changed prefix.';
    if (change === 'metadata') synthesis.completedPacks = 0;
    run.structureDiagnostics!.synthesisInput = structuredClone(synthesis);
    if (change === 'diagnostics-only') run.structureDiagnostics!.synthesisInput!.validationFailures!.pop();
    const hierarchyWrite = jest.fn();
    await expect(withCourseAuthoringWrite(courseId, async () => {
      const admission = await assertStructureCapabilityAdoptable(courseId, run, runtime); hierarchyWrite(admission);
    }, { required: true })).rejects.toThrow('structure-capability-adoption-result-changed');
    expect(hierarchyWrite).not.toHaveBeenCalled();
  });

it('keeps completed continuation synthesis frozen and refuses the fresh-worker suffix on a continuation', async () => {
  await completedCorrectedWorkerResult();
  const freshResult = run.structureResult!, childId = new ObjectId();
  run._id = childId; run.structureReview!.parentRunId = checkpoint.runId;
  progress.ownerRunId = childId; progress.continuationRunId = childId;
  progress.continuationBaseBudget = structuredClone(body.baseBudget); progress.continuationStartReservations = body.baseBudget.observedSends;
  run.structureResult = finalizeStructureCoverage(body, freshResult.themes, freshResult.coverage.budget, freshResult.coverage.outlineGrounding);
  run.structureDiagnostics!.synthesisInput = structuredClone(body.synthesisInput);
  await expect(adopt()).resolves.toMatchObject({ reviewedObjectives: 10, withheldObjectives: 0 });
  run.structureResult = freshResult; run.structureDiagnostics!.synthesisInput = structuredClone(freshResult.coverage.synthesisInput);
  await expect(adopt()).rejects.toThrow('structure-capability-adoption-result-changed');
});

/** In-memory persistence models the exact durable checkpoint operations and
 * real BSON codec, while the model labels and transaction topology are mocked. */
async function recoveredReorderedTenObjectiveReview() {
  const sections = Array.from({ length: 3 }, (_, index) => ({ id: `packed-source-${index + 1}`,
    materialId: new ObjectId().toHexString(), materialName: `Packed chapter ${index + 1}.pdf`, chunkIndex: 0,
    text: `Source ${index + 1}: dividends reduce equity value; expected appreciation equals equity return less dividend yield.\n`
      + 'Complete original teaching conditions. '.repeat(64) }));
  const evidence = Array.from({ length: 10 }, (_, index) => {
    const source = sections[index % sections.length];
    return { id: `E${index + 1}`, objective: `Assess taught financing operation ${index + 1} from chapter ${index % 3 + 1}.`,
      materialId: source.materialId, materialName: source.materialName, chunkIndex: 0, quote: source.text };
  });
  const themes = evidence.map((point, index) => ({ name: `Topic ${index + 1}`, los: [{
    name: `Assess financing operation ${index + 1} using the stated chapter ${index % 3 + 1} conditions.`,
    evidenceIds: [point.id], materialIds: [point.materialId],
  }] }));
  body = { ...body, options: { materialIds: sections.map(row => row.materialId), capabilityDistinctnessProtocol: PROTOCOL },
    themes, evidence, reviewInputLimit: 16000,
    corpus: { sections, fingerprint: 'ten-objective-packed-source-authority', materials: sections.map(row => ({
      materialId: row.materialId, name: row.materialName, chunks: 1, sections: 1, sourceTextHash: hash(row.text), parserVersion: 'parser-v1', chunkerVersion: 'chunker-v1',
    })), sourceSelection: { ready: true, requested: [], excluded: [], included: sections.map(row => ({
      materialId: row.materialId, name: row.materialName, sourceTextHash: hash(row.text), chunkCount: 1, characterCount: row.text.length,
      parserVersion: 'parser-v1', chunkerVersion: 'chunker-v1', revision: 1,
    })) } },
    extractions: sections.map(row => ({ sectionId: row.id, reused: true, row: { sectionId: row.id,
      objectives: [{ name: 'Scripted taught financing operations', passageId: `${row.id}.P1`, quote: row.text }], knowledge: [] } })),
    cache: { hits: 3, misses: 0, reusedSections: 3, extractedSections: 0 },
    batches: planCapabilityOutlineGrounding(themes, evidence, sections, 16000, PROTOCOL), protocolHash: structureOutlineReviewProtocolHash(PROTOCOL) };
  const expectedThemes = structuredClone(themes), scheduled = body.batches.flatMap(batch => batch.objectives.map(row => row.id));
  expect(scheduled).not.toEqual(Array.from({ length: 10 }, (_, index) => `L${index + 1}`));
  expect(body.batches.some(batch => batch.objectives.some((row, index, rows) => index > 0 &&
    Number(row.id.slice(1)) - Number(rows[index - 1].id.slice(1)) > 1))).toBe(true);
  checkpoint = { ...checkpoint, body, hash: hash(body) };
  run = { ...run, status: 'running', input: { ...body.options, materialIds: sections.map(row => row.materialId) },
    structureReview: { checkpointId, checkpointHash: checkpoint.hash } };
  progress = { ...progress, checkpointHash: checkpoint.hash, findings: [], attempts: {}, failures: [], unresolvedDispatchIds: [],
    pendingNative: [], revision: 0, usedTokens: 0, reservations: 0 };
  history = [];
  const roundTrip = <T extends object>(value: T): T => BSON.deserialize(BSON.serialize(value)) as T;
  jest.mocked(assertContentRunActive).mockImplementation(async id => {
    expect(id.equals(runId)).toBe(true); expect(run.status).toBe('running');
  });
  jest.mocked(structureReviewProgressCol).mockReturnValue({
    ...collection('progress', () => progress),
    findOneAndUpdate: jest.fn(async (filter: { revision: number }, update: { $set: Partial<StructureReviewProgress> }, options: { session?: ClientSession }) => {
      expect(options.session).toBe(session); expect(filter.revision).toBe(progress.revision);
      progress = roundTrip({ ...progress, ...update.$set }); return progress;
    }),
  } as never);
  const attemptCollection = {
    findOne: jest.fn(async (filter: { dispatchId: string; status?: string }) => history.find(row =>
      row.dispatchId === filter.dispatchId && (!filter.status || row.status === filter.status)) ?? null),
    insertOne: jest.fn(async (value: StructureReviewAttempt) => {
      const row = roundTrip({ ...value, _id: new ObjectId() }); history.push(row); return { insertedId: row._id };
    }),
    updateOne: jest.fn(async (filter: { _id: ObjectId; status: string }, update: { $set: Partial<StructureReviewAttempt> }) => {
      const index = history.findIndex(row => row._id.equals(filter._id) && row.status === filter.status);
      if (index < 0) return { matchedCount: 0 };
      history[index] = roundTrip({ ...history[index], ...update.$set }); return { matchedCount: 1 };
    }),
    find: jest.fn((_filter: unknown, options?: { session?: ClientSession }) => {
      reads.push({ collection: 'attempts', options });
      const rows = () => [...history].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a._id.toHexString().localeCompare(b._id.toHexString()));
      return { toArray: async () => rows(), sort: () => ({ limit: () => ({ toArray: async () => rows() }) }) };
    }),
  };
  jest.mocked(structureReviewAttemptsCol).mockReturnValue(attemptCollection as never);
  expect(() => validateStructureReviewCheckpoint(body)).not.toThrow();
  for (const [item, stored] of body.batches.entries()) {
    const ids = stored.objectives.map(row => row.id), dispatchId = await claimStructureReviewDispatch(checkpoint, runId, ids, 0, item);
    const sent = selectCapabilityOutlineGroundingBatch(stored, ids) as CapabilityOutlineGroundingBatch;
    const raw = rawFor(sent), checked = validateCapabilityOutlineGroundingRows(raw, sent, progress.findings);
    expect(checked.failures).toEqual([]);
    if (item === 0) {
      // Simulate a durable native reply followed by interruption before the
      // progress append. Recovery must replay this exact item/IDs/raw envelope.
      const pending = history.find(row => row.dispatchId === dispatchId)!;
      await attemptCollection.updateOne({ _id: pending._id, status: 'claimed' }, { $set: {
        status: 'validated', raw, rawHash: hash(raw), findings: checked.findings, failures: checked.failures,
      } });
      expect(progress.unresolvedDispatchIds).toEqual(ids); expect(progress.findings).toEqual([]);
      const recovered = await getStructureReviewProgress(checkpoint, runId);
      expect(recovered.unresolvedDispatchIds).toEqual([]); expect(recovered.findings.map(row => row.id)).toEqual(ids);
    } else {
      await finishStructureReviewDispatch(checkpoint, runId, dispatchId, { ids, raw, findings: checked.findings, failures: checked.failures });
    }
  }
  expect(progress.findings.map(row => row.id)).toEqual(scheduled);
  expect(progress.attempts).toEqual(Object.fromEntries(scheduled.map(id => [id, 1])));
  expect(attemptCollection.insertOne).toHaveBeenCalledTimes(body.batches.length);
  setTerminalFromHistory();
  const admitted = finalizeCapabilityStructureProposal(body.themes, progress.findings,
    body.batches.flatMap(batch => batch.objectives), body.batches);
  run.structureResult = finalizeStructureCoverage(body, admitted.themes, run.structureResult!.coverage.budget, admitted.receipt);
  run.status = 'completed'; jest.mocked(runtime.finalize).mockImplementation(finalizeStructureCoverage);
  const restored = roundTrip({ run, checkpoint, progress, history });
  run = restored.run; checkpoint = restored.checkpoint; progress = restored.progress; history = restored.history; body = checkpoint.body;
  expect(run.structureResult!.themes).toEqual(expectedThemes);
  reads.length = 0;
  return expectedThemes;
}

it('recovers a real noncontiguous ten-objective checkpoint and applies its replay without reordering the curriculum', async () => {
  const expectedThemes = await recoveredReorderedTenObjectiveReview();
  await expect(adopt()).resolves.toEqual({ protocol: PROTOCOL, reviewedObjectives: 10, withheldObjectives: 0 });
  expect(run.structureResult!.themes).toEqual(expectedThemes);
  expect(reads.every(row => (row.options as { session?: ClientSession })?.session === session)).toBe(true);
  expect(runtime.finalize).toHaveBeenCalledWith(body, expectedThemes, run.structureResult!.coverage.budget,
    run.structureResult!.coverage.outlineGrounding);
});

it('authenticates a consolidation parent through actual raw-history replay and keeps terminal accounting separate from the prefix', async () => {
  await recoveredReorderedTenObjectiveReview();
  const beforeRun = hash(run), beforeProgress = hash(progress);
  expect(run.structureResult!.coverage.budget.admissionTokens).toBeGreaterThan(body.baseBudget.admissionTokens!);
  const parent = await withCourseAuthoringWrite(courseId, () => readStructureConsolidationParent(courseId, run, runtime), { required: true });
  expect(parent.context.candidateIds).toEqual(Array.from({ length: 10 }, (_, i) => `L${i + 1}`));
  expect(parent.terminalBudget).toEqual(run.structureResult!.coverage.budget);
  expect(parent.terminalBudget.admissionTokens).toBe(progress.usedTokens);
  expect(parent.terminalBudget.observedSends).toBe(progress.reservations);
  expect(parent.sourceFindings).toEqual(progress.findings);
  expect(parent.context.sources.some(row => row.alias !== row.id)).toBe(true);
  expect(reads.every(row => (row.options as { session?: ClientSession })?.session === session)).toBe(true);
  parent.sourceFindings[0].name = 'Caller mutation'; parent.terminalBudget.admissionTokens = 0;
  expect(hash(run)).toBe(beforeRun); expect(hash(progress)).toBe(beforeProgress);
});

it('requires a transaction and refuses a changed raw dispatch before exposing consolidation parent authority', async () => {
  await recoveredReorderedTenObjectiveReview();
  await expect(readStructureConsolidationParent(courseId, run, runtime)).rejects.toThrow('transaction-required');
  [history[0].item, history[1].item] = [history[1].item, history[0].item];
  await expect(withCourseAuthoringWrite(courseId, () => readStructureConsolidationParent(courseId, run, runtime),
    { required: true })).rejects.toThrow('review-history-dispatch');
});

it('rejects imported or absent-selector parents rather than treating file observations as authenticated consolidation inputs', async () => {
  body.origin = 'retained-artifact-import-v1'; checkpoint.hash = hash(body);
  run.structureReview!.checkpointHash = checkpoint.hash; progress.checkpointHash = checkpoint.hash;
  await expect(withCourseAuthoringWrite(courseId, () => readStructureConsolidationParent(courseId, run, runtime),
    { required: true })).rejects.toThrow('checkpoint-binding');
  delete run.input.capabilityDistinctnessProtocol;
  await expect(withCourseAuthoringWrite(courseId, () => readStructureConsolidationParent(courseId, run, runtime),
    { required: true })).rejects.toThrow('run-unavailable');
});

it('binds the exact raw transcript even when a key-order edit has the same canonical model findings', async () => {
  const first = await withCourseAuthoringWrite(courseId, () => readStructureConsolidationParent(courseId, run, runtime), { required: true });
  history[0].raw = Object.fromEntries(Object.entries(history[0].raw as object).reverse());
  history[0].rawHash = hash(history[0].raw);
  const second = await withCourseAuthoringWrite(courseId, () => readStructureConsolidationParent(courseId, run, runtime), { required: true });
  expect(second.sourceFindings).toEqual(first.sourceFindings);
  expect(second.runHash).toBe(first.runHash); expect(second.progressHash).toBe(first.progressHash);
  expect(second.rawHistoryHash).not.toBe(first.rawHistoryHash);
  expect(second.authorityHash).not.toBe(first.authorityHash);
});

/** Full raw comparisons remain scripted. The real finalizer must independently
 * reproduce the genuine failure; no completed result is manufactured. */
async function failedAllHeldConsolidationParent() {
  await recoveredReorderedTenObjectiveReview();
  const terminalBudget = structuredClone(run.structureResult!.coverage.budget);
  const retained: StructureReviewProgress['findings'] = [];
  for (const entry of history) {
    const batch = selectCapabilityOutlineGroundingBatch(body.batches[entry.item], entry.ids) as CapabilityOutlineGroundingBatch;
    expect(batch.capabilityContext.nominations.every(row => row.peerIds.length > 0)).toBe(true);
    const raw = rawFor(batch);
    for (const comparison of raw.capabilityComparisons) {
      comparison.relation = 'equivalent';
      comparison.sharedCapabilities = [{ operation: 'Scripted common financing operation.',
        candidateQuotes: comparison.candidateUniqueCapabilities[0].quotes,
        peerQuotes: comparison.peerUniqueCapabilities[0].quotes }];
      comparison.candidateUniqueCapabilities = []; comparison.peerUniqueCapabilities = [];
      comparison.reason = 'Scripted all-held review for terminal authority controls.';
    }
    const checked = validateCapabilityOutlineGroundingRows(raw, batch, retained);
    expect(checked.failures).toEqual([]); retained.push(...checked.findings);
    entry.raw = raw; entry.rawHash = hash(raw); entry.findings = checked.findings; entry.failures = checked.failures;
  }
  const ids = body.batches.flatMap(batch => batch.objectives.map(row => row.id));
  progress.findings = ids.map(id => retained.find(row => row.id === id)!);
  const receipt = outlineCapabilityGroundingReceipt(progress.findings, ids.length, body.batches);
  expect(receipt.capabilityDistinctness).toMatchObject({ complete: true, eligibleIds: [] });
  expect(() => finalizeCapabilityStructureProposal(body.themes, progress.findings,
    body.batches.flatMap(batch => batch.objectives), body.batches)).toThrow('no-distinct-supported-objectives');
  run.status = 'failed'; run.stage = 'synthesizing'; delete run.structureResult; delete run.completedAt;
  run.error = { code: 'structure-capability-no-distinct-supported-objectives', message: 'Scripted exact failure.',
    atStage: 'synthesizing', retryable: true };
  run.structureDiagnostics = { sourceSelection: body.corpus.sourceSelection, cache: body.cache,
    budget: terminalBudget, outlineGrounding: receipt, unprocessedSections: [],
    ...(body.synthesisInput === undefined ? {} : { synthesisInput: body.synthesisInput }) };
  jest.mocked(runtime.finalize).mockClear();
}

/** Match the fresh worker's immutable checkpoint plus appended logical-review
 * diagnostics. Two logical failures can each contain several rejected LO rows;
 * the worker records only their first reason, once per dispatch. */
async function correctedFailedAllHeldConsolidationParent(continuation = false) {
  await failedAllHeldConsolidationParent();
  body.synthesisInput = { originalLedgerCharacters: 9000, deduplicatedLedgerCharacters: 8000,
    originalPassageReferences: 10, distinctOriginalPassages: 3, originalLedgerInputEstimate: 3000,
    deduplicatedLedgerInputEstimate: 2700, packCount: 2, completedPacks: 2,
    validationFailures: [{ stage: 'outline-organization', attempt: 0, reason: 'Retained pre-review organization correction.' }] };
  checkpoint.hash = hash(body); run.structureReview!.checkpointHash = checkpoint.hash; progress.checkpointHash = checkpoint.hash;
  const originalHistory = history, retained: StructureReviewProgress['findings'] = [];
  const suffix: NonNullable<NonNullable<StructureReviewCheckpointBody['synthesisInput']>['validationFailures']> = [];
  history = [];
  expect(originalHistory.length).toBeGreaterThan(1);
  for (const [index, original] of originalHistory.entries()) {
    const batch = selectCapabilityOutlineGroundingBatch(body.batches[original.item], original.ids);
    if (index < 2) {
      const invalid = structuredClone(original.raw) as ReturnType<typeof rawFor>;
      invalid.reviews = [];
      const checked = validateCapabilityOutlineGroundingRows(invalid, batch, retained);
      expect(checked.failures).toHaveLength(original.ids.length); expect(checked.findings).toEqual([]);
      history.push({ ...original, _id: new ObjectId(), dispatchId: `failed-logical-${index}`, raw: invalid,
        rawHash: hash(invalid), findings: checked.findings, failures: checked.failures });
      suffix.push({ stage: 'outline-source-review', item: original.item, attempt: 0, reason: checked.failures[0].reason.slice(0, 600) });
    }
    const checked = validateCapabilityOutlineGroundingRows(original.raw, batch, retained);
    expect(checked.failures).toEqual([]); retained.push(...checked.findings);
    history.push({ ...original, _id: new ObjectId(), dispatchId: `resolved-logical-${index}`, attempt: index < 2 ? 1 : 0,
      findings: checked.findings, failures: checked.failures });
  }
  const ids = body.batches.flatMap(batch => batch.objectives.map(row => row.id));
  progress.findings = ids.map(id => retained.find(row => row.id === id)!);
  progress.attempts = Object.fromEntries(ids.map(id => [id, Math.max(...history.filter(row => row.ids.includes(id)).map(row => row.attempt + 1))]));
  const receipt = outlineCapabilityGroundingReceipt(progress.findings, ids.length, body.batches);
  expect(receipt.capabilityDistinctness).toMatchObject({ complete: true, eligibleIds: [] });
  const budget = { ...run.structureDiagnostics!.budget, observedSends: history.length, admissionTokens: history.length * 26000,
    estimatedInputTokens: history.length * 20000, reservedOutputTokens: history.length * 6000 };
  progress.reservations = budget.observedSends; progress.usedTokens = budget.admissionTokens;
  const synthesisInput = structuredClone(body.synthesisInput);
  if (!continuation) synthesisInput.validationFailures!.push(...suffix);
  run.structureDiagnostics = { ...run.structureDiagnostics!, budget, outlineGrounding: receipt, synthesisInput };
  if (continuation) {
    const continuationId = new ObjectId();
    run._id = continuationId; run.structureReview!.parentRunId = checkpoint.runId;
    progress.ownerRunId = continuationId; progress.continuationRunId = continuationId;
    progress.continuationStartReservations = 1;
    progress.continuationBaseBudget = { ...budget, observedSends: 1, estimatedInputTokens: 20000,
      reservedOutputTokens: 6000, admissionTokens: 26000 };
    history.slice(1).forEach(entry => { entry.runId = continuationId; });
  }
  const restored = BSON.deserialize(BSON.serialize({ run, checkpoint, progress, history }));
  run = restored.run; checkpoint = restored.checkpoint; progress = restored.progress; history = restored.history; body = checkpoint.body;
  expect(hash(body)).toBe(checkpoint.hash);
  expect(history.filter(entry => entry.failures!.length).length).toBe(suffix.length);
  expect(history.flatMap(entry => entry.failures!).length).toBeGreaterThan(suffix.length);
  return suffix;
}

it('replays the fresh worker correction suffix from actual logical failures without mutating its frozen synthesis receipt', async () => {
  const suffix = await correctedFailedAllHeldConsolidationParent();
  expect(body.synthesisInput!.validationFailures).toHaveLength(1);
  expect(run.structureDiagnostics!.synthesisInput!.validationFailures).toEqual([...body.synthesisInput!.validationFailures!, ...suffix]);
  const before = hash({ run, checkpoint, progress, history });
  const parent = await withCourseAuthoringWrite(courseId, () => readStructureConsolidationParent(courseId, run, runtime), { required: true });
  expect(parent.parentState).toBe('failed-all-held'); expect(parent.rawHistoryRecords).toBe(history.length);
  expect(parent.terminalBudget.observedSends).toBe(history.length);
  expect(hash({ run, checkpoint, progress, history })).toBe(before);
  await expect(adopt()).rejects.toThrow('run-unavailable'); expect(runtime.finalize).not.toHaveBeenCalled();
});

it.each(['missing', 'extra', 'duplicate', 'reordered', 'reason', 'item', 'attempt', 'prefix', 'metadata'] as const)(
  'refuses a %s change to the exactly derived fresh-worker correction diagnostics', async change => {
    await correctedFailedAllHeldConsolidationParent();
    const synthesis = run.structureDiagnostics!.synthesisInput!, failures = synthesis.validationFailures!;
    if (change === 'missing') failures.pop();
    if (change === 'extra') failures.push({ ...failures[1], reason: 'Unrecorded failure.' });
    if (change === 'duplicate') failures.push({ ...failures[1] });
    if (change === 'reordered') [failures[1], failures[2]] = [failures[2], failures[1]];
    if (change === 'reason') failures[1].reason += ' Changed.';
    if (change === 'item') failures[1].item = 999;
    if (change === 'attempt') failures[1].attempt = 1;
    if (change === 'prefix') failures[0].reason = 'Changed frozen organization reason.';
    if (change === 'metadata') synthesis.completedPacks = 1;
    await expect(withCourseAuthoringWrite(courseId, () => readStructureConsolidationParent(courseId, run, runtime),
      { required: true })).rejects.toThrow('failed-terminal-diagnostics-changed');
    expect(run.status).toBe('failed'); expect(run.structureResult).toBeUndefined(); expect(runtime.finalize).not.toHaveBeenCalled();
  });

it('keeps continuation diagnostics frozen even when raw history includes logical corrections', async () => {
  const suffix = await correctedFailedAllHeldConsolidationParent(true);
  expect(run.structureDiagnostics!.synthesisInput).toEqual(body.synthesisInput);
  await expect(withCourseAuthoringWrite(courseId, () => readStructureConsolidationParent(courseId, run, runtime),
    { required: true })).resolves.toMatchObject({ parentState: 'failed-all-held', rawHistoryRecords: history.length });
  run.structureDiagnostics!.synthesisInput!.validationFailures!.push(...suffix);
  await expect(withCourseAuthoringWrite(courseId, () => readStructureConsolidationParent(courseId, run, runtime),
    { required: true })).rejects.toThrow('failed-terminal-diagnostics-changed');
});

it('authenticates an actual failed all-held review without allowing ordinary Apply or changing its state', async () => {
  await failedAllHeldConsolidationParent();
  const before = hash(run); progress.findings.reverse(); // Durable insertion order need not equal dispatch order.
  await expect(adopt()).rejects.toThrow('run-unavailable');
  const parent = await withCourseAuthoringWrite(courseId, () => readStructureConsolidationParent(courseId, run, runtime), { required: true });
  expect(parent.parentState).toBe('failed-all-held'); expect(parent.rawHistoryRecords).toBe(history.length);
  expect(parent.sourceFindings.map(row => row.id)).toEqual(body.batches.flatMap(batch => batch.objectives.map(row => row.id)));
  expect(parent.terminalBudget.admissionTokens).toBe(progress.usedTokens);
  expect(hash(run)).toBe(before); expect(run.structureResult).toBeUndefined();
  expect(runtime.finalize).not.toHaveBeenCalled();
});

it('derives only unreviewed replacement obligations from an authenticated failed parent', async () => {
  await failedAllHeldConsolidationParent();
  const prepared = await withCourseAuthoringWrite(courseId, () => prepareStructureOutlineConsolidation(courseId, run, ['L1', 'L2'], runtime),
    { required: true });
  const draft = validateOutlineConsolidationProposal({ version: 'source-preserving-outline-consolidation-v1',
    planHash: prepared.plan.planHash, replacements: [{ id: 'L1', name: 'Calculate and explain the financing effect using the supplied evidence.',
      evidenceIds: [...new Set(prepared.plan.members.flatMap(row => row.objective.evidenceIds))] }],
    lineage: [{ previousId: 'L1', successorIds: ['L1'] }, { previousId: 'L2', successorIds: ['L1'] }] },
  prepared.parent.context, prepared.parent.sourceFindings, prepared.plan);
  expect(draft.retiredIds).toEqual(['L2']); expect(draft.freshSourceTargetIds).toEqual(['L1']);
  expect(draft.reviewAuthority).toBe('unreviewed-child-no-credit-or-adoption-authority');
  expect(draft.oldCreditObligations.map(row => row.evidenceId).sort()).toEqual(prepared.plan.oldCreditObligations.map(row => row.evidenceId).sort());
  expect(run.status).toBe('failed'); expect(run.structureResult).toBeUndefined();
});

it.each(['code', 'partial-diagnostics', 'source-selection', 'prefix-budget', 'stale-result'] as const)(
  'refuses %s on the dedicated failed-terminal parent path', async changed => {
    await failedAllHeldConsolidationParent();
    if (changed === 'code') run.error!.code = 'structure-budget-exhausted';
    if (changed === 'partial-diagnostics') run.structureDiagnostics!.unprocessedSections = [{} as never];
    if (changed === 'source-selection') run.structureDiagnostics!.sourceSelection = { ...body.corpus.sourceSelection, ready: false };
    if (changed === 'prefix-budget') run.structureDiagnostics!.budget = structuredClone(body.baseBudget);
    if (changed === 'stale-result') Object.assign(run, { structureResult: {} });
    await expect(withCourseAuthoringWrite(courseId, () => readStructureConsolidationParent(courseId, run, runtime),
      { required: true })).rejects.toThrow();
    expect(run.status).toBe('failed'); expect(runtime.finalize).not.toHaveBeenCalled();
  });

it.each(['item', 'ids'] as const)('refuses swapped %s authority from a reordered ten-objective raw history before the hierarchy continuation', async field => {
  await recoveredReorderedTenObjectiveReview();
  expect(history.length).toBeGreaterThan(1);
  if (field === 'item') [history[0].item, history[1].item] = [history[1].item, history[0].item];
  else [history[0].ids, history[1].ids] = [history[1].ids, history[0].ids];
  const hierarchyWrite = jest.fn();
  await expect(withCourseAuthoringWrite(courseId, async () => {
    const admission = await assertStructureCapabilityAdoptable(courseId, run, runtime);
    hierarchyWrite(admission);
  }, { required: true })).rejects.toThrow('structure-capability-adoption-review-history-dispatch');
  expect(hierarchyWrite).not.toHaveBeenCalled(); expect(runtime.finalize).not.toHaveBeenCalled();
  // The resumable checkpoint path must independently reject the same altered
  // dispatch binding rather than append findings from the wrong packed group.
  run.status = 'running';
  progress.unresolvedDispatchIds = [...history[0].ids];
  progress.findings = progress.findings.filter(row => !progress.unresolvedDispatchIds.includes(row.id));
  const beforeRecovery = hash(progress);
  await expect(getStructureReviewProgress(checkpoint, runId)).rejects.toThrow('structure-grounding-review-identity');
  expect(hash(progress)).toBe(beforeRecovery);
});

/** Scripted negative labels exercise authority, not semantic model accuracy.
 * Raw rows use the actual parser, both finalizers are production functions,
 * and BSON is the real driver codec; database/session boundaries stay mocked. */
function sourceNegativePeerAfterBson() {
  const retained: StructureReviewProgress['findings'] = [];
  history = body.batches.map((value, item) => {
    const batch = value as CapabilityOutlineGroundingBatch, raw = rawFor(batch);
    const negative = raw.reviews.find(row => row.id === 'L2');
    if (negative) {
      negative.sourceStatus = 'unsupported';
      negative.sourceReason = 'Scripted resolved source-ineligible peer; not a model-quality observation.';
      // Retain the raw model's point claims so canonical negative diagnostics
      // must replay without receiving any source coverage credit.
    }
    for (const comparison of raw.capabilityComparisons) {
      if (![comparison.objectiveId, comparison.peerId].every(id => ['L1', 'L2'].includes(id))) continue;
      comparison.relation = 'equivalent';
      comparison.sharedCapabilities = [{ operation: 'Assess the debt leverage ratio.',
        candidateQuotes: comparison.candidateUniqueCapabilities[0].quotes,
        peerQuotes: comparison.peerUniqueCapabilities[0].quotes }];
      comparison.candidateUniqueCapabilities = []; comparison.peerUniqueCapabilities = [];
      comparison.reason = 'Scripted overlap against a separately resolved source-ineligible peer.';
    }
    const checked = validateCapabilityOutlineGroundingRows(raw, batch, retained);
    expect(checked.failures).toEqual([]); retained.push(...checked.findings);
    return { _id: new ObjectId(), courseId, checkpointId, runId, dispatchId: `source-negative-peer-${item}`,
      ids: batch.objectives.map(row => row.id), attempt: 0, item, status: 'validated' as const,
      raw, rawHash: hash(raw), findings: checked.findings, failures: checked.failures, createdAt: new Date() };
  });
  setTerminalFromHistory();
  const admitted = finalizeCapabilityStructureProposal(body.themes, progress.findings,
    body.batches.flatMap(batch => batch.objectives), body.batches);
  run.structureResult = finalizeStructureCoverage(body, admitted.themes, run.structureResult!.coverage.budget, admitted.receipt);
  jest.mocked(runtime.finalize).mockImplementation(finalizeStructureCoverage);
  const serialized = BSON.serialize({ run, checkpoint, progress, history });
  const restored = BSON.deserialize(serialized) as { run: typeof run; checkpoint: typeof checkpoint; progress: typeof progress; history: typeof history };
  run = restored.run; checkpoint = restored.checkpoint; progress = restored.progress; history = restored.history; body = checkpoint.body;
  expect(run.courseId).toBeInstanceOf(ObjectId); expect(run.courseId.equals(courseId)).toBe(true);
  expect(run.structureResult!.coverage.outlineGrounding!.capabilityDistinctness).toMatchObject({
    complete: true, eligibleIds: ['L1', 'L3'], nonBlockingSourceIneligiblePeers: {
      version: 'resolved-source-ineligible-peers-v1', comparisons: [expect.objectContaining({ objectiveId: 'L1', peerId: 'L2',
        relation: 'equivalent', peerSourceStatus: 'unsupported', peerSourceFindingHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        comparisonHash: expect.stringMatching(/^[a-f0-9]{64}$/) })],
    },
  });
  expect(progress.findings.find(row => row.id === 'L2')).toMatchObject({ status: 'unsupported', coveredEvidenceIds: [],
    ignoredModelCoverage: { authoritative: false, reason: 'negative-source-verdict', evidenceIds: ['E2'] } });
  expect(run.structureResult!.coverage.unmappedEvidenceIds).toContain('E2');
  expect(run.structureResult!.coverage.sourceInventory).toBeDefined();
}

it('applies the canonical source-negative-peer receipt after real BSON round-trip inside the matching course session', async () => {
  sourceNegativePeerAfterBson();
  const hierarchyWrite = jest.fn();
  await expect(withCourseAuthoringWrite(courseId, async () => {
    const admission = await assertStructureCapabilityAdoptable(courseId, run, runtime);
    hierarchyWrite(admission); return admission;
  }, { required: true })).resolves.toEqual({ protocol: PROTOCOL, reviewedObjectives: 3, withheldObjectives: 1 });
  expect(hierarchyWrite).toHaveBeenCalledTimes(1);
  expect(reads.every(row => (row.options as { session?: ClientSession })?.session === session)).toBe(true);
  expect(runtime.finalize).toHaveBeenCalledWith(body, run.structureResult!.themes, run.structureResult!.coverage.budget,
    run.structureResult!.coverage.outlineGrounding);
});

it.each(['peerSourceFindingHash', 'comparisonHash'] as const)('refuses a changed source-negative-peer %s after BSON before the hierarchy write', async field => {
  sourceNegativePeerAfterBson();
  // Change both stored result and diagnostics so agreement between two forged
  // receipts alone cannot authorize adoption; immutable raw replay must win.
  for (const receipt of [run.structureResult!.coverage.outlineGrounding!, run.structureDiagnostics!.outlineGrounding!]) {
    receipt.capabilityDistinctness!.nonBlockingSourceIneligiblePeers!.comparisons[0][field] = '0'.repeat(64);
  }
  const hierarchyWrite = jest.fn();
  await expect(withCourseAuthoringWrite(courseId, async () => {
    const admission = await assertStructureCapabilityAdoptable(courseId, run, runtime);
    hierarchyWrite(admission); return admission;
  }, { required: true })).rejects.toThrow('structure-capability-adoption-budget-or-diagnostics-changed');
  expect(hierarchyWrite).not.toHaveBeenCalled();
  expect(runtime.finalize).not.toHaveBeenCalled();
});

it('replays cross-topic full-peer judgments and attaches the same real scope session to every authority read', async () => {
  expect((body.batches[0] as CapabilityOutlineGroundingBatch).capabilityContext.nominations.some(row => row.peerIds.length)).toBe(true);
  await expect(adopt()).resolves.toEqual({ protocol: PROTOCOL, reviewedObjectives: 3, withheldObjectives: 0 });
  expect(reads.map(row => row.collection)).toEqual(['runs', 'courses', 'checkpoints', 'progress', 'attempts']);
  expect(reads.every(row => (row.options as { session?: ClientSession })?.session === session)).toBe(true);
  expect(runtime.finalize).toHaveBeenCalledTimes(1);
});

it('rehydrates full send packets from lazy stored batches and rejects a self-rebound cached representation', async () => {
  for (const stored of body.batches) {
    expect(stored.prompt).toBe(''); expect(stored.sources).toEqual([]);
    const sent = selectCapabilityOutlineGroundingBatch(stored, stored.objectives.map(row => row.id)) as CapabilityOutlineGroundingBatch;
    expect(sent.prompt.length).toBeGreaterThan(0);
    expect(estimateAuthoringTokens(sent.prompt)).toBeLessThanOrEqual(body.reviewInputLimit);
    for (const objective of sent.objectives) for (const sourceId of objective.sourceIds) {
      expect(sent.sources.some(source => source.alias === sourceId)).toBe(true);
    }
    for (const original of sent.capabilityContext.sources) expect(sent.prompt).toContain(original.text);
    expect(validateCapabilityOutlineGroundingRows(rawFor(sent), sent).failures).toEqual([]);
  }
  await expect(adopt()).resolves.toMatchObject({ protocol: PROTOCOL });
  const stored = body.batches[0], sent = selectCapabilityOutlineGroundingBatch(stored, stored.objectives.map(row => row.id));
  stored.sources = sent.sources; stored.prompt = sent.prompt;
  checkpoint.hash = hash(body); run.structureReview!.checkpointHash = checkpoint.hash; progress.checkpointHash = checkpoint.hash;
  await expect(adopt()).rejects.toThrow('proposal-changed');
});

it('keeps absent historical selectors a no-op, even without transaction support or review records', async () => {
  delete run.input.capabilityDistinctnessProtocol; delete run.structureReview;
  await expect(assertStructureCapabilityAdoptable(courseId, run, runtime)).resolves.toBeUndefined();
  expect(reads).toEqual([]); expect(runtime.loadCorpus).not.toHaveBeenCalled();
});

it('denies unknown explicit selectors before reads', async () => {
  (run.input as unknown as Record<string, unknown>).capabilityDistinctnessProtocol = 'unknown-policy';
  await expect(assertStructureCapabilityAdoptable(courseId, run, runtime)).rejects.toThrow('protocol-unsupported'); expect(reads).toEqual([]);
});

it('requires an existing session for new-policy ordinary Apply', async () => {
  await expect(assertStructureCapabilityAdoptable(courseId, run, runtime)).rejects.toThrow('transaction-required'); expect(reads).toEqual([]);
});

it('refuses a foreign course transaction before requested-course authority reads', async () => {
  await expect(withCourseAuthoringWrite(new ObjectId(), () => assertStructureCapabilityAdoptable(courseId, run, runtime), { required: true }))
    .rejects.toThrow('authoring-cross-course-transaction'); expect(reads).toEqual([]);
});

it.each(['structureRepair', 'missing-result', 'missing-link', 'cross-course-run', 'changed-checkpoint', 'changed-options', 'archived-course',
  'pending-native', 'unresolved-dispatch', 'missing-final-row', 'missing-history', 'changed-raw', 'forged-comparison', 'changed-peer-original',
  'unreplayed-extra-attempt', 'changed-budget', 'changed-final-projection', 'changed-diagnostics', 'changed-capability-receipt',
  'foreign-continuation-owner', 'orphan-continuation-ledger'])('refuses %s', async name => {
  if (name === 'structureRepair') (run as unknown as Record<string, unknown>).structureRepair = null;
  if (name === 'missing-result') delete run.structureResult;
  if (name === 'missing-link') delete run.structureReview;
  if (name === 'cross-course-run') run.courseId = new ObjectId();
  if (name === 'changed-checkpoint') checkpoint.hash = 'b'.repeat(64);
  if (name === 'changed-options') body.options.guidance = 'silently changed';
  if (name === 'archived-course') courseAvailable = false;
  if (name === 'pending-native') progress.pendingNative.push({ id: 'pending', input: 1, output: 1 });
  if (name === 'unresolved-dispatch') progress.unresolvedDispatchIds.push('L1');
  if (name === 'missing-final-row') progress.findings.pop();
  if (name === 'missing-history') history = [];
  if (name === 'changed-raw') (history[0].raw as { capabilityComparisons: unknown[] }).capabilityComparisons = [];
  if (name === 'forged-comparison') { progress.findings[0].capabilityComparisons![0].reason = 'Forged stored comparison.'; }
  if (name === 'changed-peer-original') jest.mocked(runtime.loadCorpus).mockResolvedValue({ ...body.corpus,
    sections: body.corpus.sections.map((row, index) => index === 1 ? { ...row, text: row.text + ' Changed current original.' } : row) });
  if (name === 'unreplayed-extra-attempt') history.push({ ...history[0], _id: new ObjectId(), dispatchId: 'extra' });
  if (name === 'changed-budget') progress.usedTokens++;
  if (name === 'changed-final-projection') run.structureResult!.themes[0].los[0].name = 'Unreviewed stored answer.';
  if (name === 'changed-diagnostics') run.structureDiagnostics!.outlineGrounding = undefined;
  if (name === 'changed-capability-receipt') run.structureResult!.coverage.outlineGrounding!.capabilityDistinctness!.eligibleIds = [];
  if (name === 'foreign-continuation-owner') { run.structureReview!.parentRunId = checkpoint.runId; progress.continuationRunId = new ObjectId(); }
  if (name === 'orphan-continuation-ledger') progress.continuationStartReservations = 0;
  await expect(adopt()).rejects.toThrow(/structure-(capability-adoption|capability|distinctness)/);
});

it('accepts only the documented Mongo null/absence synthesis receipt normalization', async () => {
  (run.structureResult!.coverage as unknown as Record<string, unknown>).synthesisInput = null;
  await expect(adopt()).resolves.toMatchObject({ protocol: PROTOCOL });
  (run.structureResult!.coverage as unknown as Record<string, unknown>).synthesisInput = { invented: true };
  await expect(adopt()).rejects.toThrow('result-changed');
});

it('accepts a corrected subset while retaining the earlier failed row and valid sibling history', async () => {
  const batch = body.batches[0] as CapabilityOutlineGroundingBatch;
  const invalid = rawFor(batch); invalid.capabilityComparisons = invalid.capabilityComparisons.filter(row => row.objectiveId !== 'L1');
  const first = validateCapabilityOutlineGroundingRows(invalid, batch);
  expect(first.failures.map(row => row.id)).toEqual(['L1']); expect(first.findings.map(row => row.id)).toContain('L2');
  history[0] = { ...history[0], raw: invalid, rawHash: hash(invalid), findings: first.findings, failures: first.failures };
  const pending = selectCapabilityOutlineGroundingBatch(batch, ['L1']) as CapabilityOutlineGroundingBatch;
  const raw = rawFor(pending), checked = validateCapabilityOutlineGroundingRows(raw, pending);
  expect(checked.failures).toEqual([]);
  history.push({ ...history[0], _id: new ObjectId(), dispatchId: 'correction', ids: ['L1'], attempt: 1, raw,
    rawHash: hash(raw), findings: checked.findings, failures: checked.failures });
  setTerminalFromHistory();
  // Persistence appends the correction after retained siblings. Admission is
  // bound to IDs, not accidental append order.
  progress.findings = [...progress.findings].reverse();
  await expect(adopt()).resolves.toMatchObject({ protocol: PROTOCOL, reviewedObjectives: 3 });
  const beforeContinuation = { ...run.structureResult!.coverage.budget, observedSends: 1, estimatedInputTokens: 20000,
    reservedOutputTokens: 6000, admissionTokens: 26000 };
  const continuationId = new ObjectId();
  run._id = continuationId; run.structureReview!.parentRunId = checkpoint.runId;
  progress.ownerRunId = continuationId; progress.continuationRunId = continuationId;
  progress.continuationStartReservations = 1; progress.continuationBaseBudget = beforeContinuation;
  history[1].runId = continuationId;
  await expect(adopt()).resolves.toMatchObject({ protocol: PROTOCOL, reviewedObjectives: 3 });
  progress.continuationStartReservations = 0;
  await expect(adopt()).rejects.toThrow('continuation-budget-changed');
});

it('replays a cross-batch reciprocal contradiction and the existing single correction against the retained peer', async () => {
  const initial = body.batches;
  // Use the actual final prompt estimator to force separate candidate packets;
  // the complete globally nominated peer and both originals remain unchanged.
  body.reviewInputLimit = Math.max(...initial.flatMap(batch => batch.objectives.map(objective =>
    estimateAuthoringTokens(selectCapabilityOutlineGroundingBatch(batch, [objective.id]).prompt))));
  body.batches = planCapabilityOutlineGrounding(body.themes, body.evidence, body.corpus.sections, body.reviewInputLimit, PROTOCOL);
  expect(body.batches.findIndex(batch => batch.objectives.some(row => row.id === 'L1')))
    .not.toBe(body.batches.findIndex(batch => batch.objectives.some(row => row.id === 'L2')));
  checkpoint.hash = hash(body); run.structureReview!.checkpointHash = checkpoint.hash; progress.checkpointHash = checkpoint.hash;
  history = [];
  const retained: StructureReviewProgress['findings'] = [];
  for (const [item, value] of body.batches.entries()) {
    const batch = value as CapabilityOutlineGroundingBatch, raw = rawFor(batch);
    const second = raw.capabilityComparisons.find(row => row.objectiveId === 'L2' && row.peerId === 'L1');
    if (second) {
      expect(retained.some(row => row.id === 'L1')).toBe(true);
      const own = batch.capabilityContext.objectives.find(row => row.id === second.objectiveId)!;
      const peer = batch.capabilityContext.objectives.find(row => row.id === second.peerId)!;
      const quote = (objective: typeof own) => ({ sourceId: objective.sourceIds[0],
        quote: batch.capabilityContext.sources.find(source => source.alias === objective.sourceIds[0])!.text });
      second.relation = 'equivalent'; second.candidateUniqueCapabilities = []; second.peerUniqueCapabilities = [];
      second.sharedCapabilities = [{ operation: 'Explain the debt leverage ratio.', candidateQuotes: [quote(own)], peerQuotes: [quote(peer)] }];
      const checked = validateCapabilityOutlineGroundingRows(raw, batch, retained);
      expect(checked.findings.some(row => row.id === 'L2')).toBe(false);
      expect(checked.failures.map(row => row.id)).toEqual(['L2']);
      history.push({ _id: new ObjectId(), courseId, checkpointId, runId, dispatchId: 'conflicting-second-direction',
        ids: batch.objectives.map(row => row.id), attempt: 0, item, status: 'validated', raw, rawHash: hash(raw),
        findings: checked.findings, failures: checked.failures, createdAt: new Date() });
      retained.push(...checked.findings);
      const retry = selectCapabilityOutlineGroundingBatch(batch, ['L2']) as CapabilityOutlineGroundingBatch;
      expect(retry.capabilityContext.sources).toEqual(batch.capabilityContext.sources);
      expect(estimateAuthoringTokens(retry.prompt)).toBeLessThanOrEqual(body.reviewInputLimit);
      const corrected = rawFor(retry), resolved = validateCapabilityOutlineGroundingRows(corrected, retry, retained);
      expect(resolved.failures).toEqual([]);
      history.push({ _id: new ObjectId(), courseId, checkpointId, runId, dispatchId: 'consistent-single-correction', ids: ['L2'],
        attempt: 1, item, status: 'validated', raw: corrected, rawHash: hash(corrected), findings: resolved.findings,
        failures: resolved.failures, createdAt: new Date() });
      retained.push(...resolved.findings);
    } else {
      const checked = validateCapabilityOutlineGroundingRows(raw, batch, retained);
      expect(checked.failures).toEqual([]);
      history.push({ _id: new ObjectId(), courseId, checkpointId, runId, dispatchId: `source-batch-${item}`,
        ids: batch.objectives.map(row => row.id), attempt: 0, item, status: 'validated', raw, rawHash: hash(raw),
        findings: checked.findings, failures: checked.failures, createdAt: new Date() });
      retained.push(...checked.findings);
    }
  }
  setTerminalFromHistory();
  expect(progress.attempts.L1).toBe(1); expect(progress.attempts.L2).toBe(2);
  expect(history.filter(row => row.ids.includes('L2'))).toHaveLength(2);
  expect(run.structureResult!.coverage.budget.limits).toEqual(body.baseBudget.limits);
  await expect(adopt()).resolves.toMatchObject({ protocol: PROTOCOL, reviewedObjectives: 3, withheldObjectives: 0 });
  history.find(row => row.dispatchId === 'conflicting-second-direction')!.failures = [];
  await expect(adopt()).rejects.toThrow('review-history-replay');
});
