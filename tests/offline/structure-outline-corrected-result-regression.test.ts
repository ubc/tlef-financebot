// Read-only production regression: actual generation/review/Apply exports,
// retained ten-PDF excerpts, scripted labels and mocked storage/transactions.
jest.mock('../../server/src/config/env', () => ({ env: { llmProvider: 'openai', llmEndpoint: '', authoringStructureMaxInputTokens: 200000,
  authoringMaxInputTokens: 24000, authoringMaxOutputTokens: 24000, authoringMaxEstimatedTokens: 2000000, authoringMaxSends: 100 } }));
jest.mock('../../server/src/components/mongodb', () => ({ getDb: jest.fn(), getMongoClient: jest.fn() }));
jest.mock('../../server/src/components/mongodb/collections', () => Object.fromEntries(['materialsCol', 'materialChunksCol', 'themesCol', 'losCol', 'contentRunsCol',
  'sourceEvidenceExtractionsCol', 'coursesCol', 'structureReviewCheckpointsCol', 'structureReviewProgressCol', 'structureReviewAttemptsCol'].map(key => [key, jest.fn()])));
jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../server/src/components/jobs', () => ({ defineJob: jest.fn(), enqueueJob: jest.fn() }));
jest.mock('../../server/src/services/admin.service', () => ({ utilityStepConfig: jest.fn(async () => ({ model: 'gpt-6-luna', reasoningEffort: 'none' })) }));
jest.mock('../../server/src/services/content-runs.service', () => ({ assertContentRunActive: jest.fn(), updateContentRun: jest.fn(), getContentRun: jest.fn() }));
jest.mock('../../server/src/services/model-usage.service', () => ({ withModelUsage: async (_scope: unknown, work: () => unknown) => work() }));
jest.mock('../../server/src/services/source-readiness.service', () => ({ ...jest.requireActual('../../server/src/services/source-readiness.service'),
  assertSourceSelectionReady: jest.fn(), getMaterialSourceReadiness: jest.fn() }));
jest.mock('../../server/src/services/structure-review-checkpoint.service', () => ({ ...jest.requireActual('../../server/src/services/structure-review-checkpoint.service'),
  createStructureReviewCheckpoint: jest.fn(), getStructureReviewProgress: jest.fn(), claimStructureReviewDispatch: jest.fn(), finishStructureReviewDispatch: jest.fn(),
  reserveStructureReviewSend: jest.fn(async () => 'mock-native'), recordStructureReviewSend: jest.fn() }));

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { BSON, ObjectId, type ClientSession, type WithId } from 'mongodb';
import { getDb, getMongoClient } from '../../server/src/components/mongodb';
import * as cols from '../../server/src/components/mongodb/collections';
import { completeJson } from '../../server/src/components/genai/llm';
import { currentAuthoringBudget } from '../../server/src/components/genai/llm/authoring-budget';
import { assertSourceSelectionReady, getMaterialSourceReadiness, hashSourceChunks } from '../../server/src/services/source-readiness.service';
import { generateStructure, finalizeStructureCoverage } from '../../server/src/services/structure-generation.service';
import * as checkpoints from '../../server/src/services/structure-review-checkpoint.service';
import { assertStructureCapabilityAdoptable, type StructureCapabilityAdoptionRuntime } from '../../server/src/services/structure-capability-adoption.service';
import { initializeAuthoringCommitSupport, withCourseAuthoringWrite } from '../../server/src/services/authoring-commit.service';
import type { StructureReviewCheckpoint, StructureReviewCheckpointBody, StructureReviewAttempt, StructureReviewProgress } from '../../server/src/types/structure-review';
import type { StructureGenerationRun, MaterialChunk } from '../../server/src/types/domain';
import type { OutlineCapabilityComparison } from '../../server/src/types/structure-distinctness';
import type { CapabilityOutlineGroundingBatch } from '../../server/src/services/structure-capability-grounding';
import type * as AdoptionModule from '../../server/src/services/structure-capability-adoption.service';

const root = process.cwd(), output = path.join(root, 'audit-results/outline-runtime-continuation-2026-10-17/independent-regression');
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const restored = <T extends object>(value: T): T => BSON.deserialize(BSON.serialize(value)) as T;
const cursor = (value: () => unknown[]) => { const row = { sort: () => row, limit: () => row, toArray: async () => value() }; return row; };

async function generatedFixture(correction: boolean | 2) {
  jest.clearAllMocks();
  const retained = JSON.parse(fs.readFileSync(path.join(root, 'audit-results/quality-lab-outline-continuation-2026-10-17/checkpoint-body.json'), 'utf8')) as StructureReviewCheckpointBody;
  const originals = retained.corpus.materials.map(material => retained.corpus.sections.find(section => section.materialId === material.materialId)!);
  expect(originals).toHaveLength(10);
  const courseId = new ObjectId(), runId = new ObjectId(), checkpointId = new ObjectId(), now = new Date('2026-10-17T12:00:00Z');
  const materials = originals.map(row => ({ _id: new ObjectId(row.materialId), name: row.materialName }));
  const chunks: MaterialChunk[] = originals.map(row => ({ courseId, materialId: new ObjectId(row.materialId), index: 0, text: row.text,
    characterCount: row.text.length, createdAt: now }));
  const snapshots = materials.map(material => ({ materialId: material._id.toHexString(), name: material.name, revision: 1,
    sourceTextHash: hashSourceChunks(chunks.filter(chunk => chunk.materialId.equals(material._id))), chunkCount: 1,
    characterCount: chunks.find(chunk => chunk.materialId.equals(material._id))!.text.length, parserVersion: 'retained-excerpt-test', chunkerVersion: 'retained-section-test' }));
  jest.mocked(cols.materialsCol).mockReturnValue({ find: () => cursor(() => materials) } as never);
  jest.mocked(cols.materialChunksCol).mockReturnValue({ find: () => cursor(() => chunks) } as never);
  jest.mocked(cols.themesCol).mockReturnValue({ find: () => cursor(() => []) } as never);
  jest.mocked(cols.losCol).mockReturnValue({ find: () => cursor(() => []) } as never);
  jest.mocked(cols.sourceEvidenceExtractionsCol).mockReturnValue({ findOne: async () => null, updateOne: async () => ({ matchedCount: 1 }) } as never);
  jest.mocked(assertSourceSelectionReady).mockResolvedValue({ ready: true, requested: [], included: snapshots, excluded: [] });
  jest.mocked(getMaterialSourceReadiness).mockImplementation(async (_course, id) => ({ materialId: id.toHexString(), name: snapshots.find(row => row.materialId === id.toHexString())!.name,
    ready: true, state: 'indexed', classification: 'completed', snapshot: snapshots.find(row => row.materialId === id.toHexString())! }));
  const session = { withTransaction: async (work: () => unknown) => work(), endSession() {} } as unknown as ClientSession;
  jest.mocked(getDb).mockReturnValue({ admin: () => ({ command: async () => ({ setName: 'mock-replica' }) }),
    collection: () => ({ updateOne: async () => ({ matchedCount: 1 }) }) } as never);
  jest.mocked(getMongoClient).mockReturnValue({ startSession: () => session } as never);
  jest.mocked(cols.coursesCol).mockReturnValue({ findOne: async () => ({ _id: courseId }) } as never);
  let checkpoint: WithId<StructureReviewCheckpoint> | undefined;
  const history: Array<WithId<StructureReviewAttempt>> = [];
  let dispatch: WithId<StructureReviewAttempt> | undefined;
  jest.mocked(cols.contentRunsCol).mockReturnValue({ find: () => cursor(() => []), findOne: async () => null } as never);
  jest.mocked(checkpoints.createStructureReviewCheckpoint).mockImplementation(async (_run, body) => {
    checkpoint = restored({ _id: checkpointId, runId, courseId, body, hash: hash(body), createdAt: now });
    return checkpoint;
  });
  jest.mocked(checkpoints.getStructureReviewProgress).mockResolvedValue({ findings: [], attempts: {}, failures: [], unresolvedDispatchIds: [] } as never);
  jest.mocked(checkpoints.claimStructureReviewDispatch).mockImplementation(async (_checkpoint, _run, ids, attempt, item) => {
    dispatch = { _id: new ObjectId(), courseId, checkpointId, runId, dispatchId: `scripted-${history.length}`, ids, attempt, item, status: 'claimed', createdAt: now };
    history.push(dispatch); return dispatch.dispatchId;
  });
  jest.mocked(checkpoints.finishStructureReviewDispatch).mockImplementation(async (_checkpoint, _run, _dispatch, checked) => {
    Object.assign(dispatch!, checked, { rawHash: hash(checked.raw), status: 'validated', completedAt: now });
  });
  const correctedItems = new Set<number>(); let correctedSynthesis = false;
  jest.mocked(completeJson).mockImplementation(async (prompt, options = {}) => {
    const admission = { prompt, provider: 'openai', model: 'gpt-6-luna', options, outputCap: options.maxTokens!, jsonAttempt: 0 };
    const budget = currentAuthoringBudget()!, reservation = budget.reserve(admission);
    try {
      await options.beforeRequest?.(admission);
      if (options.usageContext?.stage === 'source-extraction') {
        const rows = JSON.parse(prompt.split('\n').find(line => line.startsWith('[{'))!) as Array<{ sectionId: string; material: string; passages: Array<{ id: string }> }>;
        return { sections: rows.map(row => ({ sectionId: row.sectionId, objectives: [{ name: `Explain the original course section in ${row.material}.`, passageId: row.passages[0].id }],
          passageDispositions: row.passages.slice(1).map(passage => ({ passageId: passage.id, disposition: 'context', reason: 'Scripted extraction shape only; all other passages explicitly retained as context.' })) })) } as never;
      }
      if (options.usageContext?.stage === 'outline-synthesis') {
        if (correction === 2 && !correctedSynthesis) { correctedSynthesis = true; return { themes: [] } as never; }
        const ledger = JSON.parse(prompt.split('Evidence ledger:\n')[1].split('\nCorrect')[0]) as { learningPoints: Array<{ id: string; objective: string }> };
        return { themes: ledger.learningPoints.map((point, index) => ({ name: `Retained chapter ${index + 1}`, los: [{ name: point.objective, evidenceIds: [point.id] }] })) } as never;
      }
      if (options.usageContext?.stage !== 'outline-source-review' || !checkpoint || !dispatch) throw new Error('unexpected-scripted-stage');
      const packet = (checkpoint.body.batches[dispatch.item] as CapabilityOutlineGroundingBatch).capabilityContext;
      const pendingIds = dispatch.ids;
      const comparisons: OutlineCapabilityComparison[] = packet.nominations.filter(row => pendingIds.includes(row.objectiveId)).flatMap(row => row.peerIds.map(peerId => {
        const own = packet.objectives.find(objective => objective.id === row.objectiveId)!, peer = packet.objectives.find(objective => objective.id === peerId)!;
        const quote = (objective: typeof own) => ({ sourceId: objective.sourceIds[0], quote: packet.sources.find(source => source.alias === objective.sourceIds[0])!.text.slice(0, 200) });
        return { objectiveId: own.id, peerId, pairId: packet.pairs.find(pair => [pair.firstId, pair.secondId].includes(own.id) && [pair.firstId, pair.secondId].includes(peerId))!.id,
          relation: 'distinct' as const, candidateOperation: own.name, peerOperation: peer.name, sharedCapabilities: [],
          candidateUniqueCapabilities: [{ operation: own.name, quotes: [quote(own)] }], peerUniqueCapabilities: [{ operation: peer.name, quotes: [quote(peer)] }],
          reason: 'SCRIPTED independent operations for mechanical replay; no semantic assertion.' };
      }));
      const reviews = packet.objectives.filter(row => pendingIds.includes(row.id)).map(row => ({ id: row.id, sourceStatus: 'supported', sourceIds: row.sourceIds,
        coveredEvidenceIds: row.evidenceIds, sourceReason: 'SCRIPTED support label; no semantic assertion.', topicFit: 'fits', topicReason: 'SCRIPTED grouping label.' }));
      if (correction && dispatch.attempt === 0 && correctedItems.size < (correction === 2 ? 2 : 1)) {
        correctedItems.add(dispatch.item); return { reviews: [], capabilityComparisons: comparisons } as never;
      }
      return { reviews, capabilityComparisons: comparisons } as never;
    } finally { budget.finish(reservation); }
  });
  const options = { materialIds: materials.map(row => row._id.toHexString()), capabilityDistinctnessProtocol: 'outline-capability-distinctness-v1' as const };
  const result = await generateStructure(courseId, options, runId);
  expect(checkpoint).toBeDefined();
  const body = checkpoint!.body, expected = body.batches.flatMap(batch => batch.objectives), ids = expected.map(row => row.id);
  const findings = ids.map(id => history.flatMap(row => row.findings ?? []).find(row => row.id === id)!);
  const progress: WithId<StructureReviewProgress> = { _id: new ObjectId(), courseId, checkpointId, checkpointHash: checkpoint!.hash, ownerRunId: runId,
    revision: 1, findings, attempts: Object.fromEntries(ids.map(id => [id, Math.max(...history.filter(row => row.ids.includes(id)).map(row => row.attempt + 1))])),
    failures: [], unresolvedDispatchIds: [], pendingNative: [], reservations: result.coverage.budget.observedSends, usedTokens: result.coverage.budget.admissionTokens!,
    maxTokens: result.coverage.budget.limits.maxEstimatedTokens, maxSends: result.coverage.budget.limits.maxSends, updatedAt: now };
  const run: WithId<StructureGenerationRun> = { _id: runId, courseId, kind: 'structure-generation', status: 'completed', stage: 'checking', requestedBy: 'scripted-owner', input: options,
    structureReview: { checkpointId, checkpointHash: checkpoint!.hash }, structureResult: result,
    structureDiagnostics: { sourceSelection: result.coverage.sourceSelection, cache: result.coverage.cache, budget: result.coverage.budget,
      synthesisInput: result.coverage.synthesisInput, outlineGrounding: result.coverage.outlineGrounding, unprocessedSections: [] },
    completedUnits: 0, revision: 1, events: [], warnings: [], createdAt: now, updatedAt: now, completedAt: now };
  const persisted = restored({ run, checkpoint: checkpoint!, progress, history });
  jest.mocked(cols.contentRunsCol).mockReturnValue({ findOne: async () => persisted.run } as never);
  jest.mocked(cols.structureReviewCheckpointsCol).mockReturnValue({ findOne: async () => persisted.checkpoint } as never);
  jest.mocked(cols.structureReviewProgressCol).mockReturnValue({ findOne: async () => persisted.progress } as never);
  jest.mocked(cols.structureReviewAttemptsCol).mockReturnValue({ find: () => cursor(() => persisted.history) } as never);
  await initializeAuthoringCommitSupport();
  const runtime: StructureCapabilityAdoptionRuntime = { loadCorpus: async () => persisted.checkpoint.body.corpus, finalize: finalizeStructureCoverage };
  return { ...persisted, courseId, runtime, adopt: () => withCourseAuthoringWrite(courseId,
    () => assertStructureCapabilityAdoptable(courseId, persisted.run, runtime), { required: true }) };
}

it('accepts an uncorrected actual ten-excerpt generation through the real Apply replay/finalizer', async () => {
  const fixture = await generatedFixture(false);
  await expect(fixture.adopt()).resolves.toMatchObject({ reviewedObjectives: 10, withheldObjectives: 0 });
  expect(fixture.run.structureResult!.coverage.materials).toHaveLength(10);
});

function candidateAdopter(): typeof AdoptionModule.assertStructureCapabilityAdoptable {
  const original = path.join(root, 'server/src/services/structure-capability-adoption.service.ts');
  const source = fs.readFileSync(path.join(output, 'adoption-patch-candidate.ts'), 'utf8');
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  // Resolve dependencies through Jest's existing mocks and actual parsers;
  // only this copied, unintegrated module body differs from production.
  const boundRequire = (name: string) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Synchronous transpiled CommonJS module evaluation under the existing Jest mocks.
    return require(name.startsWith('.') ? path.resolve(path.dirname(original), name) : name);
  };
  new Function('module', 'exports', 'require', '__filename', '__dirname', javascript)(module, module.exports, boundRequire, original, path.dirname(original));
  return (module.exports as typeof AdoptionModule).assertStructureCapabilityAdoptable;
}

it('the copied minimal patch accepts an exact actual-worker suffix and preserves the frozen prefix', async () => {
  const fixture = await generatedFixture(2), patch = candidateAdopter();
  const frozen = hash(fixture.checkpoint), failures = fixture.run.structureResult!.coverage.synthesisInput!.validationFailures!;
  expect(fixture.checkpoint.body.synthesisInput!.validationFailures).toHaveLength(1); expect(failures).toHaveLength(3);
  await expect(fixture.adopt()).rejects.toThrow('structure-capability-adoption-result-changed');
  await expect(withCourseAuthoringWrite(fixture.courseId, () => patch(fixture.courseId, fixture.run, fixture.runtime), { required: true }))
    .resolves.toMatchObject({ reviewedObjectives: 10, withheldObjectives: 0 });
  expect(hash(fixture.checkpoint)).toBe(frozen);
});

it.each(['missing', 'extra', 'reordered', 'reason', 'item', 'attempt', 'prefix', 'metadata', 'diagnostics-only'] as const)(
  'the copied patch refuses a %s mutation rather than ignoring synthesis drift', async mutation => {
    const fixture = await generatedFixture(2), patch = candidateAdopter();
    const synthesis = fixture.run.structureResult!.coverage.synthesisInput!;
    const failures = synthesis.validationFailures!;
    if (mutation === 'missing') failures.pop();
    if (mutation === 'extra') failures.push({ ...failures[1] });
    if (mutation === 'reordered') [failures[1], failures[2]] = [failures[2], failures[1]];
    if (mutation === 'reason') failures[1].reason += ' forged';
    if (mutation === 'item') failures[1].item = 999;
    if (mutation === 'attempt') failures[1].attempt = 1;
    if (mutation === 'prefix') failures[0].reason += ' forged';
    if (mutation === 'metadata') synthesis.packCount = 999;
    fixture.run.structureDiagnostics!.synthesisInput = structuredClone(synthesis);
    if (mutation === 'diagnostics-only') fixture.run.structureDiagnostics!.synthesisInput!.validationFailures!.pop();
    await expect(withCourseAuthoringWrite(fixture.courseId, () => patch(fixture.courseId, fixture.run, fixture.runtime), { required: true }))
      .rejects.toThrow('structure-capability-adoption-result-changed');
  });

it('the copied patch retains exact frozen continuation semantics and refuses an appended fresh-style suffix', async () => {
  const fixture = await generatedFixture(2), patch = candidateAdopter(), childId = new ObjectId();
  fixture.run._id = childId; fixture.run.structureReview!.parentRunId = fixture.checkpoint.runId;
  fixture.progress.ownerRunId = childId; fixture.progress.continuationRunId = childId;
  fixture.progress.continuationBaseBudget = structuredClone(fixture.checkpoint.body.baseBudget);
  fixture.progress.continuationStartReservations = fixture.checkpoint.body.baseBudget.observedSends;
  const actualFreshResult = fixture.run.structureResult!;
  fixture.run.structureResult = finalizeStructureCoverage(fixture.checkpoint.body, actualFreshResult.themes,
    actualFreshResult.coverage.budget, actualFreshResult.coverage.outlineGrounding);
  fixture.run.structureDiagnostics!.synthesisInput = structuredClone(fixture.checkpoint.body.synthesisInput);
  await expect(withCourseAuthoringWrite(fixture.courseId, () => patch(fixture.courseId, fixture.run, fixture.runtime), { required: true }))
    .resolves.toMatchObject({ reviewedObjectives: 10 });
  fixture.run.structureResult = actualFreshResult;
  fixture.run.structureDiagnostics!.synthesisInput = structuredClone(actualFreshResult.coverage.synthesisInput);
  await expect(withCourseAuthoringWrite(fixture.courseId, () => patch(fixture.courseId, fixture.run, fixture.runtime), { required: true }))
    .rejects.toThrow('structure-capability-adoption-result-changed');
});

it('reproduces completed Apply false refusal after an actual worker logical correction appends synthesis diagnostics', async () => {
  const fixture = await generatedFixture(true);
  const suffix = fixture.run.structureResult!.coverage.synthesisInput!.validationFailures!;
  expect(suffix).toHaveLength(1); expect(fixture.checkpoint.body.synthesisInput!.validationFailures).toBeUndefined();
  expect(fixture.history.filter(row => row.failures?.length)).toHaveLength(1);
  await expect(fixture.adopt()).rejects.toThrow('structure-capability-adoption-result-changed');
  const frozenProjection = finalizeStructureCoverage(fixture.checkpoint.body, fixture.run.structureResult!.themes,
    fixture.run.structureResult!.coverage.budget, fixture.run.structureResult!.coverage.outlineGrounding);
  const difference = { ...fixture.run.structureResult!, coverage: { ...fixture.run.structureResult!.coverage,
    synthesisInput: frozenProjection.coverage.synthesisInput } };
  expect(difference).toEqual(frozenProjection);
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'actual-wrapper-red-r1.json'), JSON.stringify({ status: 'reproduced',
    source: 'Ten unchanged first-section excerpts from the retained ten-PDF corpus; not a full599-page review.',
    sourceMaterialCount: 10, outputObjectives: 10, preservedEvidence: fixture.run.structureResult!.coverage.mappedObjectives,
    logicalReviewRecords: fixture.history.length, correctedLogicalRecords: fixture.history.filter(row => row.failures?.length).length,
    frozenSynthesis: fixture.checkpoint.body.synthesisInput, actualWorkerSynthesis: fixture.run.structureResult!.coverage.synthesisInput,
    onlyResultDifferenceIsExactLogicalReviewDiagnosticSuffix: true, expectedRefusal: 'structure-capability-adoption-result-changed',
    providerNetworkDatabaseCalls: 0, actualJudgments: 'scripted only', saved: 0, adopted: 0 }, null, 2) + '\n');
});
