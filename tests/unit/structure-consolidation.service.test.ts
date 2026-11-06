import { createHash } from 'node:crypto';
import { BSON, ObjectId } from 'mongodb';
import type { GroundingObjective, StructureResult } from '../../server/src/types/structure';
import type { AuthoringBudgetReceipt } from '../../server/src/types/authoring-budget';
import type { ModelCallEvent } from '../../server/src/components/genai/llm';
import { planOutlineCapabilityDistinctness } from '../../server/src/services/structure-capability-distinctness';
import { validateOutlineGroundingRows } from '../../server/src/services/structure-outline-grounding';
import { deriveOutlineConsolidationPlan } from '../../server/src/services/structure-outline-consolidation';
import { prepareConsolidationReview } from '../../server/src/services/structure-consolidation-review';
import { selectCapabilityOutlineGroundingBatch, type CapabilityOutlineGroundingBatch } from '../../server/src/services/structure-capability-grounding';
import type { StructureConsolidationParent } from '../../server/src/services/structure-consolidation-parent.service';
import { createStructureConsolidationProposal, createStructureConsolidationReview, runStructureConsolidation,
  assertStructureConsolidationAdoptable, readStructureConsolidationView, nominateStructureConsolidationIds,
  type StructureConsolidationRuntime } from '../../server/src/services/structure-consolidation.service';

jest.mock('../../server/src/config/env', () => ({ env: { llmProvider: 'openai', llmEndpoint: 'DENIED-TEST-ENDPOINT' } }));
jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: () => { throw new Error('PROVIDER DENIED'); } }));
jest.mock('../../server/src/components/jobs', () => ({ enqueueJob: () => { throw new Error('QUEUE DENIED'); } }));
jest.mock('../../server/src/components/mongodb/collections', () => ({
  contentRunsCol: () => mockStore.runs, structureReviewCheckpointsCol: () => mockStore.parents,
  structureConsolidationsCol: () => mockStore.heads, structureConsolidationDispatchesCol: () => mockStore.dispatches,
  structureConsolidationNativeCol: () => mockStore.natives, structureRepairBranchesCol: () => mockStore.repairs,
}));
jest.mock('../../server/src/services/authoring-commit.service', () => ({
  currentAuthoringSession: () => mockScope ? {} : undefined, authoringCollection: (value: unknown) => value,
  withCourseAuthoringWrite: async (course: ObjectId, work: () => unknown) => {
    if (mockScope && mockScope !== course.toHexString()) throw new Error('authoring-cross-course-transaction');
    const previous = mockScope; mockScope = course.toHexString(); try { return await work(); } finally { mockScope = previous; }
  },
}));
jest.mock('../../server/src/services/structure-consolidation-parent.service', () => ({
  readStructureConsolidationParent: async () => { mockParentReads++; if (mockParentError) throw new Error(mockParentError); return mockAuthority; },
}));
jest.mock('../../server/src/services/content-runs.service', () => ({
  createStructureGenerationRun: async (input: { courseId: ObjectId; requestedBy: string; options: object; structureConsolidation: object }) => {
    const row = { _id: new ObjectId(), courseId: input.courseId, requestedBy: input.requestedBy, input: input.options,
      structureConsolidation: input.structureConsolidation, kind: 'structure-generation', status: 'queued', revision: 0, stage: 'queued' };
    mockStore.runs.rows.push(row); return row;
  },
  updateContentRun: async (id: ObjectId, update: object) => { const row = mockStore.runs.rows.find(row => row._id.equals(id))!; Object.assign(row, update); return row; },
  assertContentRunActive: async (id: ObjectId) => { const row = mockStore.runs.rows.find(row => row._id.equals(id)); if (row?.status !== 'running') throw new Error('content-run-conflict'); },
}));

// Scripted storage/transactions and semantic judgments only; all provider,
// native network, queue and real Mongo boundaries are denied.
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const copy = <T>(row: T): T => BSON.deserialize(BSON.serialize({ row })).row as T;
const identity = (row: unknown) => row instanceof ObjectId ? row.toHexString() : JSON.stringify(row);
const at = (row: Row, path: string): unknown => path.split('.').reduce((value, key) => value?.[key], row);
function matches(row: Row, query: Row): boolean {
  return Object.entries(query).every(([key, value]) => {
    const current = at(row, key);
    if (value && typeof value === 'object' && !(value instanceof ObjectId)) {
      if ('$exists' in value) return Object.hasOwn(value, '$exists') && (current !== undefined) === value.$exists;
      if ('$ne' in value) return identity(current) !== identity(value.$ne);
    }
    return identity(current) === identity(value);
  });
}
function collection() {
  return { rows: [] as Row[], async findOne(query: Row) { const row = this.rows.find(row => matches(row, query)); return row ? copy(row) : null; },
    find(query: Row) { let rows = this.rows.filter(row => matches(row, query)); const cursor = {
      sort(spec: Row) { rows = rows.sort((a, b) => { for (const key of Object.keys(spec)) { if (a[key] < b[key]) return -spec[key]; if (a[key] > b[key]) return spec[key]; } return 0; }); return cursor; },
      limit(count: number) { rows = rows.slice(0, count); return cursor; }, async toArray() { return copy(rows); } }; return cursor; },
    async insertOne(row: Row) { const stored = copy({ ...row, _id: row._id ?? new ObjectId() }); this.rows.push(stored); return { insertedId: stored._id }; },
    async countDocuments(query: Row) { return this.rows.filter(row => matches(row, query)).length; },
    async updateOne(query: Row, update: Row) { const row = this.rows.find(row => matches(row, query)); if (row) Object.assign(row, copy(update.$set)); return { matchedCount: row ? 1 : 0 }; },
    async findOneAndUpdate(query: Row, update: Row) { const row = this.rows.find(row => matches(row, query)); if (!row) return null; Object.assign(row, copy(update.$set)); return copy(row); },
  };
}
let mockStore: Record<'runs' | 'parents' | 'heads' | 'dispatches' | 'natives' | 'repairs', ReturnType<typeof collection>>;
let mockScope: string | undefined, mockAuthority: StructureConsolidationParent, mockParentError: string | undefined, mockParentReads: number;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function budget(): AuthoringBudgetReceipt {
  return { version: 1, estimator: 'utf8-bytes-conservative-v1', retryVisibility: 'unknown', limitScope: 'process',
    observedSends: 2, estimatedInputTokens: 1000, reservedOutputTokens: 12000, admissionTokens: 13000,
    accounting: 'conservative-reservations-v1', pendingSends: 0, settledSends: 0, conservativeFinishedSends: 2,
    reportedInputTokens: null, reportedOutputTokens: null, usageCompleteness: 'unknown', queueWaitMs: 0, executionMs: 0, rejectedSends: 0,
    logical: { generatorAttempts: 0, repairCycles: 0, evidenceExpansions: 0, limits: { generatorAttempts: 1, repairCycles: 1, evidenceExpansions: 1 } },
    limits: { maxSends: 100, maxInputTokens: 48000, maxOutputTokens: 6000, maxEstimatedTokens: 2000000 } };
}
function setup() {
  mockStore = { runs: collection(), parents: collection(), heads: collection(), dispatches: collection(), natives: collection(), repairs: collection() };
  mockScope = undefined; mockParentError = undefined; mockParentReads = 0;
  const courseId = new ObjectId(), parentRunId = new ObjectId(), parentCheckpointId = new ObjectId(), materialId = new ObjectId().toHexString();
  const text = 'Classify financing choices. Explain dividends. Calculate price appreciation. Identify risk inputs. Compare portfolio outcomes.';
  const sources = [{ id: 'S444', alias: 'S1', materialId, materialName: 'Complete chapter.pdf', localId: 'C1.S1', chunkIndex: 0, text }];
  const points = ['Classify financing choices.', 'Explain dividends.', 'Calculate price appreciation.', 'Identify risk inputs.', 'Compare portfolio outcomes.']
    .map((objective, i) => ({ id: `E${i + 1}`, objective, sourceIds: ['S1'], materialId }));
  const objectives: GroundingObjective[] = points.map((point, i) => {
    const assigned = i === 1 ? [points[1]!, points[2]!] : i === 2 ? points.slice(0, 3) : [point];
    return { id: `L${(i + 1) * 10}`, themeIndex: 0, loIndex: i * 2, topic: 'Finance',
      name: i === 1 ? 'Explain dividends and calculate price appreciation.' : i === 2 ? 'Classify financing and explain dividends.' : point.objective,
      contentHash: digest(i), evidenceIds: assigned.map(row => row.id), materialIds: [materialId], sourceIds: ['S1'], learningPoints: assigned };
  });
  const context = planOutlineCapabilityDistinctness([{ objectives, sources, prompt: '' }], 'outline-capability-distinctness-v1')!;
  const findings = objectives.map(row => validateOutlineGroundingRows({ reviews: [{ id: row.id, sourceStatus: 'supported', sourceIds: ['S1'],
    coveredEvidenceIds: row.id === 'L30' ? ['E1', 'E2'] : row.evidenceIds, sourceReason: 'SCRIPTED support.', topicFit: 'fits', topicReason: 'SCRIPTED grouping.' }] },
  { objectives: [row], sources, prompt: '' }).findings[0]!);
  const model = { model: 'gpt-6-luna', reasoningEffort: 'none' as const }, receipt = budget();
  mockAuthority = { version: 'authenticated-consolidation-parent-v1', courseId: courseId.toHexString(), runId: parentRunId.toHexString(),
    checkpointId: parentCheckpointId.toHexString(), checkpointHash: digest('parent'), runHash: digest('run'), progressHash: digest('progress'),
    rawHistoryHash: digest('history'), rawHistoryRecords: 2, parentState: 'completed', sourceFingerprint: digest('source'),
    parentProtocolHash: digest('protocol'), providerIdentityHash: digest({ provider: 'openai', endpoint: 'DENIED-TEST-ENDPOINT' }),
    context, sourceFindings: findings, terminalBudget: receipt, authorityHash: digest('AUTHENTICATED SCRIPTED PARENT') };
  const run = { _id: parentRunId, courseId, kind: 'structure-generation', status: 'completed', input: { materialIds: [materialId], capabilityDistinctnessProtocol: 'outline-capability-distinctness-v1' } };
  mockStore.runs.rows.push(run);
  const parentBody = { model, reviewInputLimit: 46500, baseBudget: receipt, options: run.input,
    corpus: { fingerprint: mockAuthority.sourceFingerprint }, evidence: [], extractions: [], cache: {}, excludedSections: [] };
  mockStore.parents.rows.push({ _id: parentCheckpointId, courseId, hash: mockAuthority.checkpointHash, body: parentBody });
  const ids = ['L10', 'L20', 'L30'], plan = deriveOutlineConsolidationPlan(context, findings, ids);
  const proposal = { version: 'source-preserving-outline-consolidation-v1' as const, planHash: plan.planHash,
    replacements: [{ id: 'L10', name: 'Classify financing choices.', evidenceIds: ['E1'] },
      { id: 'L30', name: 'Explain dividends and calculate price appreciation.', evidenceIds: ['E2', 'E3'] }],
    lineage: [{ previousId: 'L10', successorIds: ['L10'] }, { previousId: 'L20', successorIds: ['L30'] }, { previousId: 'L30', successorIds: ['L10', 'L30'] }] };
  const behavior = { jsonRetry: false, invalidSourceOnce: false, dropCredit: false, sourceChangeAfterFirst: false, unobserved: false, swallowedFailure: false };
  let sends = 0, logical = 0;
  const runtime: StructureConsolidationRuntime = {
    loadCorpus: async () => parentBody.corpus as never,
    finalize: (_body, themes, finalBudget, grounding) => ({ themes, evidence: [], coverage: {
      sourceFingerprint: mockAuthority.sourceFingerprint, sourceSelection: { included: [{ materialId }] }, budget: finalBudget, outlineGrounding: grounding,
      synthesisInput: undefined } } as unknown as StructureResult),
    complete: async (prompt, request, stage, attempt, item) => {
      logical++;
      let raw: unknown = proposal;
      if (stage === 'outline-source-review') {
        const head = mockStore.heads.rows[0]!;
        const review = prepareConsolidationReview({ parentContext: mockAuthority.context, parentSourceFindings: mockAuthority.sourceFindings,
          selectedIds: ids, proposal: head.acceptedProposal, terminalBudget: head.reviewBaseBudget, expectedBudgetLimits: receipt.limits, inputLimit: 46500 });
        const pending = mockStore.dispatches.rows.find(row => row.status === 'claimed' && row.phase === 'review')!;
        const batch = selectCapabilityOutlineGroundingBatch(review.batches[item!]!, pending.ids) as CapabilityOutlineGroundingBatch;
        const ctx = batch.capabilityContext;
        raw = { reviews: batch.objectives.map(row => ({ id: row.id, sourceStatus: 'supported', sourceIds: row.sourceIds,
          coveredEvidenceIds: behavior.dropCredit && row.id === 'L30' ? ['E2'] : row.evidenceIds,
          sourceReason: 'SCRIPTED fresh source.', topicFit: 'fits', topicReason: 'SCRIPTED grouping.' })),
        capabilityComparisons: ctx.nominations.flatMap(row => row.peerIds.map(peerId => {
          const candidate = ctx.objectives.find(value => value.id === row.objectiveId)!, peer = ctx.objectives.find(value => value.id === peerId)!;
          const quote = { sourceId: 'S1', quote: text };
          return { objectiveId: candidate.id, peerId, pairId: ctx.pairs.find(pair => [pair.firstId, pair.secondId].includes(candidate.id) && [pair.firstId, pair.secondId].includes(peerId))!.id,
            relation: 'distinct', candidateOperation: candidate.name, peerOperation: peer.name, sharedCapabilities: [],
            candidateUniqueCapabilities: [{ operation: candidate.name, quotes: [quote] }], peerUniqueCapabilities: [{ operation: peer.name, quotes: [quote] }], reason: 'SCRIPTED distinct operations.' };
        })) };
        if (behavior.invalidSourceOnce && attempt === 0 && item === 0) (raw as Row).reviews[0].sourceIds = ['S999'];
      }
      if (behavior.unobserved) return raw;
      const native = async (jsonAttempt: number, visible: string) => {
        await request.beforeRequest!({ prompt: prompt + (jsonAttempt ? '\n\nYour previous reply was not valid JSON. Respond with ONLY the JSON value — no prose, no explanation, no code fences.' : ''),
          provider: 'openai', model: model.model, jsonAttempt, options: { model: model.model, maxTokens: request.maxTokens }, outputCap: request.maxTokens! });
        sends++;
        const event = { callId: new ObjectId().toHexString(), provider: 'openai', requestedModel: model.model, actualModel: null, responseId: null,
          startedAt: '2026-10-17T00:00:00Z', retryVisibility: 'unknown', requestOptions: {}, usageContext: { jsonAttempt } };
        await request.onAttempt!({ ...event, type: 'started' } as ModelCallEvent);
        request.onText!(visible);
        await request.onAttempt!({ ...event, type: 'finished', outcome: 'succeeded', finishedAt: '2026-10-17T00:00:01Z', durationMs: 1000,
          usage: { inputTokens: null, outputTokens: null } } as ModelCallEvent);
      };
      if (behavior.jsonRetry && logical === 1) await native(0, 'INVALID JSON');
      if (behavior.swallowedFailure) {
        try { await request.beforeRequest!(); } catch { /* Simulated swallowed boundary failure. */ }
      }
      await native(behavior.jsonRetry && logical === 1 ? 1 : 0, JSON.stringify(raw));
      if (behavior.sourceChangeAfterFirst) mockParentError = 'structure-capability-adoption-corpus-changed';
      return raw;
    },
  };
  const start = async (manual = false) => createStructureConsolidationProposal(courseId, parentRunId, 'teacher', ids, manual ? proposal : undefined, runtime);
  const work = async (run: Awaited<ReturnType<typeof start>>) => { mockStore.runs.rows.find(row => row._id.equals(run._id))!.status = 'running'; await runStructureConsolidation({ ...run, status: 'running' }, runtime); };
  const propose = async (manual = false) => { const run = await start(manual); await work(run); return run; };
  const review = async () => { const head = mockStore.heads.rows[0]!; return createStructureConsolidationReview(courseId, parentRunId, 'teacher', head.revision, head.proposalHash, undefined, runtime); };
  const apply = async (runId: ObjectId) => { mockScope = courseId.toHexString(); try { return await assertStructureConsolidationAdoptable(courseId, await mockStore.runs.findOne({ _id: runId }) as never, runtime); } finally { mockScope = undefined; } };
  return { courseId, parentRunId, ids, proposal, runtime, behavior, start, work, propose, review, apply, sends: () => sends };
}

describe('durable two-run outline consolidation (all external boundaries denied)', () => {
  it('proposes automatically without a result, separately reviews all child IDs and replays full BSON history before Apply', async () => {
    const f = setup(), proposalRun = await f.propose();
    expect(mockStore.runs.rows.find(row => row._id.equals(proposalRun._id))!.structureResult).toBeUndefined();
    const preview = await readStructureConsolidationView(f.courseId, f.parentRunId, f.runtime);
    expect(preview.proposalStatus).toBe('unreviewed'); expect(preview.canReview).toBe(true); expect(preview.canApply).toBe(false);
    const child = await f.review(); await f.work(child);
    const authority = await f.apply(child._id);
    expect(authority!.retiredIds).toEqual(['L20']); expect(authority!.stableIndex.map(row => row.id)).toEqual(['L10', 'L30', 'L40', 'L50']);
    expect(mockStore.heads.rows[0]!.findings).toHaveLength(4);
    expect(mockStore.natives.rows).toHaveLength(2); expect(f.sends()).toBe(2); expect(mockParentReads).toBeGreaterThan(10);
    expect((await readStructureConsolidationView(f.courseId, child._id, f.runtime)).canApply).toBe(true);
    expect(mockStore.runs.rows[0]!.status).toBe('completed');
  });
  it('supports an optional teacher proposal without spending proposer allowance', async () => {
    const f = setup(); await f.propose(true); expect(f.sends()).toBe(0);
    const child = await f.review(); await f.work(child); expect((await f.apply(child._id))!.retiredIds).toEqual(['L20']); expect(f.sends()).toBe(1);
  });
  it('uses only source-supported nominated relation groups and never evidence overlap alone', () => {
    setup(); expect(() => nominateStructureConsolidationIds(mockAuthority)).toThrow('no-nominated-group');
    mockAuthority.sourceFindings[0]!.capabilityComparisons = [{ objectiveId: 'L10', peerId: 'L20', pairId: 'P1', relation: 'partial-overlap' } as never];
    expect(nominateStructureConsolidationIds(mockAuthority)).toEqual(['L10', 'L20']);
    mockAuthority.sourceFindings[1]!.status = 'uncertain'; expect(() => nominateStructureConsolidationIds(mockAuthority)).toThrow('no-nominated-group');
  });
  it('refuses an ineligible historical parent before any native call or child creation', async () => {
    const f = setup(); mockParentError = 'structure-capability-adoption-origin';
    await expect(f.start()).rejects.toThrow('origin'); expect(f.sends()).toBe(0); expect(mockStore.heads.rows).toHaveLength(0);
  });
  it('refuses an impossible inherited full-review floor before proposing', async () => {
    const f = setup(); mockAuthority.terminalBudget.limits.maxEstimatedTokens = 14000;
    await expect(f.start()).rejects.toThrow('review-floor-cannot-fit'); expect(f.sends()).toBe(0);
  });
  it('refuses an already-used legacy repair allowance before creating a consolidation child', async () => {
    const f = setup(); mockStore.repairs.rows.push({ input: { parentCheckpointId: mockAuthority.checkpointId, parentCheckpointHash: mockAuthority.checkpointHash, cycle: 1 } });
    await expect(f.start()).rejects.toThrow('parent-allowance-claimed');
    expect(f.sends()).toBe(0); expect(mockStore.heads.rows).toHaveLength(0); expect(mockStore.runs.rows).toHaveLength(1);
  });
  it('keeps one shared cycle and refuses stale teacher confirmation', async () => {
    const f = setup(); await f.propose(); await expect(f.start()).rejects.toThrow('cycle-used');
    await expect(createStructureConsolidationReview(f.courseId, f.parentRunId, 'teacher', 0, '0'.repeat(64), undefined, f.runtime)).rejects.toThrow('proposal-changed');
    await f.review(); await expect(f.review()).rejects.toThrow('proposal-changed');
  });
  it('records both native JSON attempts and retains all conservative reservations', async () => {
    const f = setup(); f.behavior.jsonRetry = true; await f.propose(); const head = mockStore.heads.rows[0]!;
    expect(mockStore.natives.rows.map(row => row.jsonAttempt)).toEqual([0, 1]); expect(head.nativeCount).toBe(2);
    const child = await f.review(); await f.work(child); await f.apply(child._id);
    expect(mockStore.natives.rows).toHaveLength(3); expect(f.sends()).toBe(3);
  });
  it('runs correction only for invalid child rows while keeping valid siblings and all raw attempts', async () => {
    const f = setup(); await f.propose(); f.behavior.invalidSourceOnce = true; const child = await f.review(); await f.work(child);
    expect(mockStore.dispatches.rows.filter(row => row.phase === 'review').map(row => row.ids.length)).toEqual([4, 1]);
    expect(mockStore.dispatches.rows[2]!.prompt).toContain('Correct ONLY the remaining objectives');
    await f.apply(child._id); expect(f.sends()).toBe(3);
  });
  it('refuses current source drift after the actual proposal send and preserves its reservation', async () => {
    const f = setup(); const run = await f.start(); f.behavior.sourceChangeAfterFirst = true;
    await expect(f.work(run)).rejects.toThrow('corpus-changed'); expect(f.sends()).toBe(1); expect(mockStore.natives.rows).toHaveLength(1); expect(mockStore.heads.rows[0]!.state).toBe('failed');
  });
  it('refuses fresh old-credit loss without forcing acceptance or losing raw history', async () => {
    const f = setup(); await f.propose(); f.behavior.dropCredit = true; const child = await f.review();
    await expect(f.work(child)).rejects.toThrow('review-shortfall'); expect(mockStore.heads.rows[0]!.state).toBe('failed');
    expect(mockStore.dispatches.rows[1]!.raw).toBeDefined(); expect(mockStore.heads.rows[0]!.findings).toHaveLength(4);
  });
  it('never accepts an unobserved facade result or swallowed admission failure', async () => {
    let f = setup(); f.behavior.unobserved = true; await expect(f.work(await f.start())).rejects.toThrow('native-result-unobserved'); expect(f.sends()).toBe(0);
    f = setup(); f.behavior.swallowedFailure = true; await expect(f.work(await f.start())).rejects.toThrow('native-request-binding'); expect(f.sends()).toBe(0);
  });
  it.each(['raw', 'prompt', 'native', 'result', 'projection', 'review-binding'])('refuses %s tampering at transactional Apply', async damage => {
    const f = setup(); await f.propose(); const child = await f.review(); await f.work(child);
    if (damage === 'raw') mockStore.dispatches.rows[1]!.raw.reviews[0].sourceReason = 'Changed';
    if (damage === 'prompt') mockStore.dispatches.rows[1]!.prompt += 'Changed';
    if (damage === 'native') mockStore.natives.rows[1]!.inputUnits--;
    if (damage === 'result') mockStore.runs.rows.find(row => row._id.equals(child._id))!.structureResult.themes[0].los[0].name = 'Changed';
    if (damage === 'projection') mockStore.heads.rows[0]!.projectionHash = '0'.repeat(64);
    if (damage === 'review-binding') mockStore.runs.rows.find(row => row._id.equals(child._id))!.structureConsolidation.reviewBindingHash = '0'.repeat(64);
    await expect(f.apply(child._id)).rejects.toThrow();
  });
  it('requires the matching course transaction, refuses own malformed links, and stays lazy for absence', async () => {
    const f = setup(); await expect(assertStructureConsolidationAdoptable(f.courseId, {} as never, f.runtime)).resolves.toBeUndefined();
    await expect(assertStructureConsolidationAdoptable(f.courseId, { structureConsolidation: null } as never, f.runtime)).rejects.toThrow('transaction-required');
    mockScope = new ObjectId().toHexString(); await expect(assertStructureConsolidationAdoptable(f.courseId, { structureConsolidation: null } as never, f.runtime)).rejects.toThrow('cross-course'); mockScope = undefined;
  });
});
