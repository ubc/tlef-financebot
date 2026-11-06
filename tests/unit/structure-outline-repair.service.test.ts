jest.mock('../../server/src/components/mongodb/collections', () => Object.fromEntries([
  'coursesCol', 'structureRepairBranchesCol', 'structureReviewProgressCol', 'structureReviewCheckpointsCol',
  'contentRunsCol',
].map(name => [name, jest.fn()])));
jest.mock('../../server/src/services/authoring-commit.service', () => ({ authoringCollection: jest.fn(value => value),
  withCourseAuthoringWrite: jest.fn((_course, work) => work()), authoringCommitAvailable: jest.fn(), currentAuthoringSession: jest.fn() }));
jest.mock('../../server/src/services/content-runs.service', () => ({ assertContentRunActive: jest.fn(), createStructureGenerationRun: jest.fn(), getContentRun: jest.fn(), updateContentRun: jest.fn() }));
// Import the actual pure finalizer without loading provider or queue clients.
jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn(() => { throw new Error('test-provider-denied'); }) }));
jest.mock('../../server/src/components/jobs', () => ({ defineJob: jest.fn(), enqueueJob: jest.fn(() => { throw new Error('test-job-denied'); }) }));
jest.mock('../../server/src/services/admin.service', () => ({ utilityStepConfig: jest.fn(() => { throw new Error('test-model-config-denied'); }) }));

import { BSON, ObjectId, type WithId } from 'mongodb';
import { contentRunsCol, coursesCol, structureRepairBranchesCol, structureReviewProgressCol, structureReviewCheckpointsCol } from '../../server/src/components/mongodb/collections';
import { assertContentRunActive, createStructureGenerationRun, getContentRun, updateContentRun } from '../../server/src/services/content-runs.service';
import { authoringCollection, authoringCommitAvailable, currentAuthoringSession, withCourseAuthoringWrite } from '../../server/src/services/authoring-commit.service';
import { admitAuthoringSend, type ModelSendAdmission } from '../../server/src/components/genai/llm/authoring-budget';
import type { ModelCallEvent } from '../../server/src/components/genai/llm/model-call';
import type { StructureGenerationRun } from '../../server/src/types/domain';
import type { StructureRepairBranch } from '../../server/src/types/structure-repair';
import type { StructureReviewCorpus } from '../../server/src/types/structure-review';
import type { StructureResult } from '../../server/src/types/structure';
import { assertStructureRepairAdoptable, getStructureOutlineRepairView, createStructureOutlineCoverageRepair, createStructureOutlineRepair, reserveStructureRepairSend, runStructureOutlineRepair, type StructureRepairRuntime } from '../../server/src/services/structure-outline-repair.service';
import { structureRepairFixture } from './fixtures/structure-repair';
import { outlineGroundingReceipt, planOutlineGrounding, validateOutlineGroundingRows } from '../../server/src/services/structure-outline-grounding';
import { structureReviewHash } from '../../server/src/services/structure-review-checkpoint.service';
import { finalizeStructureCoverage } from '../../server/src/services/structure-generation.service';

function copy<T>(value: T): T {
  if (value instanceof ObjectId) return new ObjectId(value.toHexString()) as T;
  if (value instanceof Date) return new Date(value) as T;
  if (Array.isArray(value)) return Array.from(value, item => copy(item)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)])) as T;
  return value;
}
let fixture: ReturnType<typeof structureRepairFixture>;
let branches: Map<string, WithId<StructureRepairBranch>>;
let runs: Map<string, WithId<StructureGenerationRun>>;
let corpus: StructureReviewCorpus;
let courseAvailable: boolean;
let calls: string[];
let behavior: 'positive' | 'negative' | 'no-repair' | 'unknown' | 'bad-schema-json-correction' | 'drift-after-proposal' | 'drift-after-review' | 'cancel-after-proposal'
  | 'coverage-missing-requested' | 'coverage-lost-preserved' | 'coverage-missing-review';
const branch = () => [...branches.values()][0];
const requestRows = [{ id: 'L1', status: 'proposed', name: 'Value the rental alternative using expected present value of after-tax rental or lease revenues.', reason: 'Clarify the taught valuation basis.' },
  { id: 'L2', status: 'proposed', name: 'Explain financing irrelevance under the stated assumptions and evaluate the interpretations posed in the unmarked activity.', reason: 'Avoid asserting a uniquely marked answer.' }];

beforeEach(() => {
  jest.clearAllMocks(); fixture = structureRepairFixture(); branches = new Map(); runs = new Map([[fixture.parentId.toHexString(), copy(fixture.parent)]]);
  jest.mocked(withCourseAuthoringWrite).mockImplementation(async (_course, work) => work());
  corpus = copy(fixture.body.corpus); courseAvailable = true; calls = []; behavior = 'positive';
  jest.mocked(authoringCommitAvailable).mockReturnValue(true); jest.mocked(currentAuthoringSession).mockReturnValue(undefined);
  jest.mocked(contentRunsCol).mockReturnValue({ findOne: jest.fn(async (filter: { _id: ObjectId; courseId?: ObjectId; status?: string }) => {
    const run = runs.get(filter._id.toHexString());
    return run && (!filter.courseId || run.courseId.equals(filter.courseId)) && (!filter.status || run.status === filter.status) ? copy(run) : null;
  }) } as never);
  jest.mocked(coursesCol).mockReturnValue({ findOne: jest.fn(async () => courseAvailable ? { _id: fixture.courseId } : null) } as never);
  jest.mocked(structureReviewCheckpointsCol).mockReturnValue({ findOne: jest.fn(async () => copy(fixture.checkpoint)) } as never);
  jest.mocked(structureReviewProgressCol).mockReturnValue({ findOne: jest.fn(async () => copy(fixture.progress)) } as never);
  jest.mocked(getContentRun).mockImplementation(async id => copy(runs.get(id.toHexString()) ?? null));
  jest.mocked(assertContentRunActive).mockImplementation(async id => {
    if (runs.get(id.toHexString())?.status !== 'running') throw new Error('content-run-conflict');
  });
  jest.mocked(createStructureGenerationRun).mockImplementation(async input => {
    const now = new Date(); const run: WithId<StructureGenerationRun> = { _id: new ObjectId(), courseId: input.courseId, requestedBy: input.requestedBy,
      kind: 'structure-generation', status: 'queued', stage: 'queued', input: input.options, structureRepair: input.structureRepair,
      revision: 0, completedUnits: 0, events: [], warnings: [], createdAt: now, updatedAt: now };
    runs.set(run._id.toHexString(), copy(run)); return copy(run);
  });
  jest.mocked(updateContentRun).mockImplementation(async (id, update) => {
    const run = runs.get(id.toHexString())!; if (run.status === 'failed') throw new Error('terminal-diagnostics-write');
    Object.assign(run, copy(update)); return copy(run);
  });
  jest.mocked(structureRepairBranchesCol).mockReturnValue({
    findOne: jest.fn(async (filter: Record<string, unknown>) => copy(filter._id instanceof ObjectId ? branches.get(filter._id.toHexString()) ?? null :
      [...branches.values()].find(row => row.input.parentCheckpointId === filter['input.parentCheckpointId'] && row.input.parentCheckpointHash === filter['input.parentCheckpointHash']) ?? null)),
    insertOne: jest.fn(async document => {
      const id = document._id as ObjectId; if ([...branches.values()].some(row => row.input.parentCheckpointId === document.input.parentCheckpointId)) throw Object.assign(new Error('duplicate'), { code: 11000 });
      branches.set(id.toHexString(), copy(document)); return { insertedId: id };
    }),
    findOneAndUpdate: jest.fn(async (filter, update) => {
      const current = branches.get(filter._id.toHexString());
      if (!current || current.revision !== filter.revision || !current.runId.equals(filter.runId)) return null;
      Object.assign(current, copy(update.$set)); return copy(current);
    }),
  } as never);
});

function engine(): StructureRepairRuntime {
  return {
    loadCorpus: jest.fn(async () => copy(corpus)),
    complete: jest.fn(async (prompt, request, stage) => {
      calls.push(stage);
      const rounds = behavior === 'bad-schema-json-correction' && stage === 'outline-source-repair' ? 2 : 1;
      for (let jsonAttempt = 0; jsonAttempt < rounds; jsonAttempt++) {
        const actual = jsonAttempt ? `${prompt}\nYour previous reply was not valid JSON. Return only JSON.` : prompt;
        const admission: ModelSendAdmission = { prompt: actual, provider: 'test-provider', model: request.model!, systemPrompt: request.systemPrompt,
          options: { model: request.model, reasoning_effort: request.reasoningEffort, maxTokens: request.maxTokens }, outputCap: request.maxTokens!, jsonAttempt };
        const hookRelease = await request.beforeRequest?.(admission); const finish = await admitAuthoringSend(admission); const callId = `native-${calls.length}-${jsonAttempt}`;
        const started = { type: 'started', callId, provider: admission.provider, requestedModel: admission.model, actualModel: null, responseId: null,
          startedAt: new Date().toISOString(), retryVisibility: 'unknown', requestOptions: {}, usageContext: { stage, jsonAttempt } } as ModelCallEvent;
        try {
          await request.onAttempt?.(started);
          if (behavior === 'unknown') throw new Error('transport-dispatch-unknown');
          finish({ promptTokens: 100, completionTokens: 50 }, 'succeeded');
          await request.onAttempt?.({ ...started, type: 'finished', finishedAt: new Date().toISOString(), durationMs: 1, outcome: 'succeeded',
            usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, reasoningTokens: null, cachedInputTokens: null, cacheWriteTokens: null, countSource: 'provider-reported', totalOrigin: 'provider' } } as ModelCallEvent);
        } finally { finish(undefined, 'failed'); if (hookRelease) await hookRelease(); }
      }
      if (stage === 'outline-source-repair') {
        if (behavior === 'cancel-after-proposal') { runs.get(branch().runId.toHexString())!.status = 'failed'; throw new Error('original-cancellation-fault'); }
        if (behavior === 'bad-schema-json-correction') return { repairs: [{ id: 'foreign', status: 'supported' }] };
        if (behavior === 'drift-after-proposal') corpus.fingerprint = 'changed-ingest';
        const ids = JSON.parse(prompt.split('\n').filter(line => line.startsWith('{')).at(-1)!).objectives.map((row: { id: string }) => row.id) as string[];
        return { repairs: behavior === 'no-repair' ? ids.map(id => ({ id, status: 'no-repair', reason: 'Keep the recorded uncertainty.' })) :
          [...requestRows, { id: 'L3', status: 'proposed', name: 'Explain diversification of firm-specific risk and distinguish the remaining systematic market risk.', reason: 'Make the assigned missing capability explicit without replacing the previously credited one.' }].filter(row => ids.includes(row.id)) };
      }
      const payload = JSON.parse(prompt.split('\n').filter(line => line.startsWith('{')).at(-1)!);
      if (behavior === 'drift-after-review') corpus.fingerprint = 'changed-after-review';
      return { reviews: behavior === 'coverage-missing-review' ? [] : payload.objectives.map((row: { id: string; sourceIds: string[]; learningPoints: Array<{ id: string }> }) => ({ id: row.id,
        sourceStatus: behavior === 'negative' ? 'unsupported' : 'supported', sourceIds: row.sourceIds, coveredEvidenceIds: behavior === 'negative' ? [] : row.learningPoints.map(point => point.id)
          .filter(id => !(behavior === 'coverage-missing-requested' && id === 'E4') && !(behavior === 'coverage-lost-preserved' && id === 'E3')),
        sourceReason: behavior === 'negative' ? 'Still lacks source support.' : 'The exact originals support this minimally changed capability.', topicFit: 'fits', topicReason: 'Fits the original topic.' })) };
    }),
    finalize: jest.fn((body, themes, budget, grounding) => ({ themes, evidence: body.evidence, coverage: { ...fixture.parent.structureResult!.coverage,
      budget, outlineGrounding: grounding } } as StructureResult)),
  };
}
async function start(ids = ['L1', 'L2']) {
  const runtime = engine(); const child = await createStructureOutlineRepair(fixture.courseId, fixture.parentId, 'owner', ids, runtime.loadCorpus);
  runs.get(child._id.toHexString())!.status = 'running'; return { child, runtime };
}

/** Scripted capability labels verify the service gate, not semantic source support. */
function coverageFixture(): void {
  fixture.body.evidence.push({ ...copy(fixture.body.evidence[2]), id: 'E4', objective: 'Distinguish the risk remaining after diversification.' });
  fixture.body.themes[0].los[2].evidenceIds!.push('E4');
  fixture.body.batches = planOutlineGrounding(fixture.body.themes, fixture.body.evidence, fixture.body.corpus.sections, fixture.body.reviewInputLimit);
  fixture.progress.findings = fixture.body.batches.flatMap(batch => validateOutlineGroundingRows({ reviews: batch.objectives.map(row => ({
    id: row.id, sourceStatus: row.id === 'L3' ? 'supported' : 'uncertain', sourceIds: row.sourceIds,
    coveredEvidenceIds: row.id === 'L3' ? ['E3'] : [], sourceReason: 'Scripted original source-bound finding; E4 remains uncredited.', topicFit: 'fits', topicReason: 'Fits.' })) }, batch).findings);
  fixture.checkpoint.hash = structureReviewHash(fixture.body); fixture.progress.checkpointHash = fixture.checkpoint.hash;
  fixture.parent.structureReview!.checkpointHash = fixture.checkpoint.hash;
  const grounding = outlineGroundingReceipt(fixture.progress.findings, 3);
  fixture.parent.structureResult!.themes[0].los[0] = copy(fixture.body.themes[0].los[2]);
  fixture.parent.structureResult!.coverage.outlineGrounding = grounding;
  fixture.parent.structureResult!.coverage.unmappedEvidenceIds = ['E1', 'E2', 'E4'];
  fixture.parent.structureDiagnostics!.outlineGrounding = grounding;
  runs.set(fixture.parentId.toHexString(), copy(fixture.parent));
}

async function startCoverage() {
  coverageFixture(); const runtime = engine();
  const child = await createStructureOutlineCoverageRepair(fixture.courseId, fixture.parentId, 'owner', [{ id: 'L3', evidenceIds: ['E4'] }], runtime.loadCorpus);
  runs.get(child._id.toHexString())!.status = 'running'; return { child, runtime };
}

it('creates one immutable branch and reuses it without resetting target attempts or buying a second selection', async () => {
  const runtime = engine(); const before = JSON.stringify(fixture.parent);
  const first = await createStructureOutlineRepair(fixture.courseId, fixture.parentId, 'owner', ['L1', 'L2'], runtime.loadCorpus);
  const again = await createStructureOutlineRepair(fixture.courseId, fixture.parentId, 'owner', ['L2', 'L1'], runtime.loadCorpus);
  expect(first._id.equals(again._id)).toBe(true); expect(branches.size).toBe(1); expect(createStructureGenerationRun).toHaveBeenCalledTimes(1);
  await expect(createStructureOutlineRepair(fixture.courseId, fixture.parentId, 'owner', ['L1'], runtime.loadCorpus)).rejects.toThrow('cycle-already-used');
  expect(JSON.stringify(fixture.parent)).toBe(before); expect(calls).toEqual([]);
  expect(withCourseAuthoringWrite).toHaveBeenCalledWith(fixture.courseId, expect.any(Function), { required: true });
});

it('rejects an oversized exact two-target proposal before any run, cycle or course-fence write', async () => {
  for (const source of fixture.body.corpus.sections.slice(0, 2)) source.text += 'x'.repeat(24000);
  fixture.body.batches = planOutlineGrounding(fixture.body.themes, fixture.body.evidence, fixture.body.corpus.sections, fixture.body.reviewInputLimit);
  const original = fixture.progress.findings;
  fixture.progress.findings = fixture.body.batches.flatMap(batch => validateOutlineGroundingRows({ reviews: batch.objectives.map(row => ({
    id: row.id, sourceStatus: original.find(item => item.id === row.id)!.status, sourceIds: row.sourceIds,
    coveredEvidenceIds: row.id === 'L3' ? row.evidenceIds : [], sourceReason: 'Recorded source-bound judgment.', topicFit: 'fits', topicReason: 'Fits.' })) }, batch).findings);
  fixture.checkpoint.hash = structureReviewHash(fixture.body); fixture.progress.checkpointHash = fixture.checkpoint.hash;
  fixture.parent.structureReview!.checkpointHash = fixture.checkpoint.hash;
  fixture.parent.structureResult!.coverage.outlineGrounding = outlineGroundingReceipt(fixture.progress.findings, 3);
  fixture.parent.structureDiagnostics!.outlineGrounding = fixture.parent.structureResult!.coverage.outlineGrounding;
  runs.set(fixture.parentId.toHexString(), copy(fixture.parent)); corpus = copy(fixture.body.corpus);
  await expect(createStructureOutlineRepair(fixture.courseId, fixture.parentId, 'owner', ['L1', 'L2'], engine().loadCorpus)).rejects.toThrow('proposal-input-cap');
  expect(createStructureGenerationRun).not.toHaveBeenCalled(); expect(withCourseAuthoringWrite).not.toHaveBeenCalled();
  expect(structureRepairBranchesCol().insertOne).not.toHaveBeenCalled(); expect(branches.size).toBe(0); expect(calls).toEqual([]);
});

it('refuses a known-insufficient first proposal budget before consuming the one cycle', async () => {
  fixture.parent.structureDiagnostics!.budget = { ...fixture.parent.structureDiagnostics!.budget, admissionTokens: 1999999 };
  fixture.progress.usedTokens = 1999999; runs.set(fixture.parentId.toHexString(), copy(fixture.parent));
  await expect(createStructureOutlineRepair(fixture.courseId, fixture.parentId, 'owner', ['L1'], engine().loadCorpus)).rejects.toThrow('budget-exhausted');
  expect(createStructureGenerationRun).not.toHaveBeenCalled(); expect(withCourseAuthoringWrite).not.toHaveBeenCalled(); expect(branches.size).toBe(0);
});

it('runs proposal then independent shared validation, preserves siblings/old negatives, and has no extraction or Apply path', async () => {
  const { child, runtime } = await start(); const oldParent = JSON.stringify(runs.get(fixture.parentId.toHexString()));
  const result = await runStructureOutlineRepair(child._id, runtime);
  expect(calls).toEqual(['outline-source-repair', 'outline-source-review']); expect(result.coverage.outlineGrounding?.supportedObjectives).toBe(3);
  expect(branch().findings.find(row => row.id === 'L3')).toEqual(fixture.progress.findings[2]);
  expect(branch().proposalBody!.batches[0].objectives[2]).toEqual(fixture.body.batches[0].objectives[2]);
  expect(JSON.stringify(runs.get(fixture.parentId.toHexString()))).toBe(oldParent);
  expect(fixture.progress.findings[0].status).toBe('uncertain'); expect(branch().attempts.L2).toBe(1); expect(fixture.progress.attempts.L2).toBe(2);
  expect(branch().newReservations).toBe(2); expect(branch().usedTokens).toBeGreaterThan(1454173); expect(branch().pendingNative).toEqual([]);
  expect(Object.keys(runtime).sort()).toEqual(['complete', 'finalize', 'loadCorpus']);
});

it('keeps a repaired source-negative verdict withheld rather than converting it into acceptance', async () => {
  const { child, runtime } = await start(); behavior = 'negative';
  const result = await runStructureOutlineRepair(child._id, runtime);
  expect(result.coverage.outlineGrounding).toMatchObject({ supportedObjectives: 1, withheldObjectives: 2 });
  expect(result.themes[0].los).toHaveLength(1); expect(branch().findings.filter(row => row.status === 'unsupported').every(row => row.coveredEvidenceIds.length === 0)).toBe(true);
});

it('records an honest no-repair response and buys no review for unchanged bindings', async () => {
  const { child, runtime } = await start(); behavior = 'no-repair';
  const result = await runStructureOutlineRepair(child._id, runtime);
  expect(calls).toEqual(['outline-source-repair']); expect(branch().changedIds).toEqual([]);
  expect(result.coverage.outlineGrounding?.supportedObjectives).toBe(1); expect(branch().findings).toEqual(fixture.progress.findings);
});

it('refuses a validated branch replay rather than omitting prior new calls/usage from a fresh receipt', async () => {
  const { child, runtime } = await start(); await runStructureOutlineRepair(child._id, runtime);
  const before = copy(branch()); const count = calls.length;
  await expect(runStructureOutlineRepair(child._id, runtime)).rejects.toThrow('resume-requires-audited-reconciliation');
  expect(branch()).toEqual(before); expect(calls).toHaveLength(count);
});

it('keeps the original cancellation fault when writing diagnostics is no longer allowed', async () => {
  const { child, runtime } = await start(); behavior = 'cancel-after-proposal';
  await expect(runStructureOutlineRepair(child._id, runtime)).rejects.toThrow('original-cancellation-fault');
  expect(calls).toEqual(['outline-source-repair']); expect(branch().usedTokens).toBeGreaterThan(1454173);
});

it.each(['drift-after-proposal', 'drift-after-review'] as const)('refuses %s without admitting stale output', async mode => {
  const { child, runtime } = await start(); behavior = mode;
  await expect(runStructureOutlineRepair(child._id, runtime)).rejects.toThrow('source-changed');
  expect(runtime.finalize).not.toHaveBeenCalled(); expect(branch().usedTokens).toBeGreaterThan(1454173);
  expect(branch().proposalRaw).toBeDefined();
  if (mode === 'drift-after-review') { expect(branch().reviewAttempts[0].raw).toBeDefined(); expect(branch().unresolvedDispatchIds).toEqual(['L1', 'L2']); }
  else expect(calls).toEqual(['outline-source-repair']);
});

it('retains uncertain native reservation and proposal claim, and refuses blind replay', async () => {
  const { child, runtime } = await start(); behavior = 'unknown';
  await expect(runStructureOutlineRepair(child._id, runtime)).rejects.toThrow('transport-dispatch-unknown');
  const charged = branch().usedTokens; expect(branch().pendingNative).toHaveLength(1); expect(branch().proposalState).toBe('claimed');
  await expect(runStructureOutlineRepair(child._id, runtime)).rejects.toThrow('unknown-dispatch');
  expect(branch().usedTokens).toBe(charged); expect(calls).toHaveLength(1);
});

it('charges native JSON correction twice and does not add an automatic semantic proposal retry', async () => {
  const { child, runtime } = await start(); behavior = 'bad-schema-json-correction';
  await expect(runStructureOutlineRepair(child._id, runtime)).rejects.toThrow('proposal-schema');
  expect(branch().newReservations).toBe(2); expect(branch().pendingNative).toEqual([]); expect(branch().proposalRaw).toBeDefined(); expect(calls).toEqual(['outline-source-repair']);
});

it('preserves the31/1,454,173 prefix and admits at most ten54k reservations including unknown sends', async () => {
  const { child } = await start(); branch().proposalState = 'claimed';
  const overhead = Buffer.byteLength(JSON.stringify([{ role: 'user', content: '' }]), 'utf8');
  const send: ModelSendAdmission = { prompt: 'x'.repeat(47968 - overhead), provider: 'test', model: 'gpt-6-luna', options: {}, outputCap: 6000, jsonAttempt: 0 };
  for (let i = 0; i < 10; i++) await reserveStructureRepairSend(child._id, send, 'outline-source-repair');
  expect(branch().usedTokens).toBe(1994173); expect(branch().reservations).toBe(41);
  await expect(reserveStructureRepairSend(child._id, send, 'outline-source-repair')).rejects.toThrow('budget-or-stage');
  expect(branch().usedTokens).toBe(1994173);
});

it('fails a losing reservation CAS rather than overwriting another unknown charge', async () => {
  const { child } = await start(); branch().proposalState = 'claimed';
  const send: ModelSendAdmission = { prompt: 'One actual request', provider: 'test', model: 'gpt-6-luna', options: {}, outputCap: 6000, jsonAttempt: 0 };
  const result = await Promise.allSettled([reserveStructureRepairSend(child._id, send, 'outline-source-repair'), reserveStructureRepairSend(child._id, send, 'outline-source-repair')]);
  expect(result.filter(row => row.status === 'fulfilled')).toHaveLength(1);
  expect(result.filter(row => row.status === 'rejected')).toHaveLength(1); expect(branch().newReservations).toBe(1); expect(branch().pendingNative).toHaveLength(1);
});

it('rejects cancellation, course deletion, parent cost changes and protocol tampering before a model send', async () => {
  const { child, runtime } = await start(); const initial = copy(branch());
  runs.get(child._id.toHexString())!.status = 'failed';
  await expect(runStructureOutlineRepair(child._id, runtime)).rejects.toThrow('content-run-conflict');
  runs.get(child._id.toHexString())!.status = 'running'; courseAvailable = false;
  await expect(runStructureOutlineRepair(child._id, runtime)).rejects.toThrow('course-unavailable');
  courseAvailable = true; branches.set(initial._id.toHexString(), copy(initial)); fixture.progress.usedTokens++;
  await expect(runStructureOutlineRepair(child._id, runtime)).rejects.toThrow('parent-budget-unreconciled');
  fixture.progress.usedTokens--; branch().input.protocolHash = 'forged';
  await expect(runStructureOutlineRepair(child._id, runtime)).rejects.toThrow('branch-changed');
  expect(calls).toEqual([]);
});

it('derives missing-capability targets from the supported parent and shares the one-cycle claim with the old pilot', async () => {
  coverageFixture(); const runtime = engine(); const original = JSON.stringify(runs.get(fixture.parentId.toHexString()));
  await expect(createStructureOutlineRepair(fixture.courseId, fixture.parentId, 'owner', ['L3'], runtime.loadCorpus)).rejects.toThrow('target-not-withheld');
  const child = await createStructureOutlineCoverageRepair(fixture.courseId, fixture.parentId, 'owner', [{ id: 'L3', evidenceIds: ['E4'] }], runtime.loadCorpus);
  const replay = await createStructureOutlineCoverageRepair(fixture.courseId, fixture.parentId, 'owner', [{ id: 'L3', evidenceIds: ['E4'] }], runtime.loadCorpus);
  expect(child._id.equals(replay._id)).toBe(true); expect(branch().input).toMatchObject({ version: 'coverage-wording-outline-repair-v1', targetIds: ['L3'],
    coverageTargets: [{ id: 'L3', evidenceIds: ['E4'], preserveEvidenceIds: ['E3'], contentHash: fixture.body.batches[0].objectives[2].contentHash }] });
  await expect(createStructureOutlineRepair(fixture.courseId, fixture.parentId, 'owner', ['L1'], runtime.loadCorpus)).rejects.toThrow('cycle-already-used');
  expect(createStructureGenerationRun).toHaveBeenCalledTimes(1); expect(JSON.stringify(runs.get(fixture.parentId.toHexString()))).toBe(original); expect(calls).toEqual([]);
});

it('persists a passed coverage receipt by CAS before finalization without overwriting parent or unchanged findings', async () => {
  const { child, runtime } = await startCoverage(); const parent = JSON.stringify(runs.get(fixture.parentId.toHexString()));
  const finish = runtime.finalize; runtime.finalize = jest.fn((...args) => {
    expect(branch().coverageAssessment).toMatchObject({ status: 'passed', targets: [{ id: 'L3', requestedEvidenceIds: ['E4'], preservedEvidenceIds: ['E3'], missingEvidenceIds: [], lostEvidenceIds: [] }] });
    return finish(...args);
  });
  await runStructureOutlineRepair(child._id, runtime);
  expect(calls).toEqual(['outline-source-repair', 'outline-source-review']); expect(runtime.finalize).toHaveBeenCalledTimes(1);
  expect(branch().findings.find(row => row.id === 'L3')?.coveredEvidenceIds).toEqual(['E3', 'E4']);
  expect(branch().findings.find(row => row.id === 'L1')).toEqual(fixture.progress.findings[0]);
  expect(branch().findings.find(row => row.id === 'L2')).toEqual(fixture.progress.findings[1]);
  expect(JSON.stringify(runs.get(fixture.parentId.toHexString()))).toBe(parent); expect(branch().pendingNative).toEqual([]);
});

it.each(['no-repair', 'negative', 'coverage-missing-requested', 'coverage-lost-preserved', 'coverage-missing-review'] as const)(
  'retains coverage diagnostics and refuses finalization for %s', async mode => {
    const { child, runtime } = await startCoverage(); behavior = mode;
    const parent = JSON.stringify(runs.get(fixture.parentId.toHexString()));
    await expect(runStructureOutlineRepair(child._id, runtime)).rejects.toThrow('structure-repair-coverage-shortfall');
    expect(runtime.finalize).not.toHaveBeenCalled(); expect(branch().coverageAssessment?.status).toBe('shortfall');
    expect(branch().coverageAssessment?.targets[0].reasons.length).toBeGreaterThan(0);
    expect(branch().proposalRaw).toBeDefined(); expect(branch().usedTokens).toBeGreaterThan(fixture.body.baseBudget.admissionTokens!);
    expect(JSON.stringify(runs.get(fixture.parentId.toHexString()))).toBe(parent);
    if (mode === 'no-repair') { expect(calls).toEqual(['outline-source-repair']); expect(branch().changedIds).toEqual([]); }
    if (mode === 'coverage-lost-preserved') expect(branch().coverageAssessment?.targets[0].lostEvidenceIds).toEqual(['E3']);
    if (mode === 'coverage-missing-requested') expect(branch().coverageAssessment?.targets[0].missingEvidenceIds).toEqual(['E4']);
  },
);

it.each([
  [], [{ id: 'L3', evidenceIds: [] }], [{ id: 'L3', evidenceIds: ['E4', 'E4'] }],
  [{ id: 'L3', evidenceIds: ['E4'] }, { id: 'L3', evidenceIds: ['E4'] }],
  [{ id: 'L3', evidenceIds: ['E3'] }], [{ id: 'L3', evidenceIds: ['E1'] }],
  [{ id: 'foreign', evidenceIds: ['E4'] }], [{ id: 'L1', evidenceIds: ['E1'] }],
].map(requests => ({ requests })))('rejects invalid coverage targets before a child or cycle write: $requests', async ({ requests }) => {
  coverageFixture();
  await expect(createStructureOutlineCoverageRepair(fixture.courseId, fixture.parentId, 'owner', requests, engine().loadCorpus)).rejects.toThrow();
  expect(createStructureGenerationRun).not.toHaveBeenCalled(); expect(withCourseAuthoringWrite).not.toHaveBeenCalled(); expect(branches.size).toBe(0); expect(calls).toEqual([]);
});

function rebindTamperedBranch(): void {
  branch().inputHash = structureReviewHash(branch().input);
  runs.get(branch().runId.toHexString())!.structureRepair!.inputHash = branch().inputHash;
}

it('rejects an unknown explicit repair mode before any completion', async () => {
  const { child, runtime } = await start(); Object.assign(branch().input, { version: 'unknown-repair-mode' }); rebindTamperedBranch();
  await expect(runStructureOutlineRepair(child._id, runtime)).rejects.toThrow('branch-mode'); expect(calls).toEqual([]); expect(runtime.finalize).not.toHaveBeenCalled();
});

it('rederives preserved point bindings before claiming a proposal or reserving a native send', async () => {
  const { child, runtime } = await startCoverage(); const input = branch().input;
  if (input.version !== 'coverage-wording-outline-repair-v1') throw new Error('fixture-mode');
  input.coverageTargets[0].preserveEvidenceIds = []; rebindTamperedBranch();
  await expect(runStructureOutlineRepair(child._id, runtime)).rejects.toThrow('coverage-targets-changed');
  expect(branch().proposalState).toBe('unclaimed'); expect(calls).toEqual([]);
  branch().proposalState = 'claimed';
  await expect(reserveStructureRepairSend(child._id, { prompt: 'Actual proposed request', model: 'gpt-6-luna', provider: 'test', options: {}, outputCap: 6000, jsonAttempt: 0 }, 'outline-source-repair')).rejects.toThrow('coverage-targets-changed');
  expect(branch().newReservations).toBe(0); expect(branch().pendingNative).toEqual([]);
});

it('requires a durable coverage-assessment CAS before finalization', async () => {
  const { child, runtime } = await startCoverage();
  const write = structureRepairBranchesCol().findOneAndUpdate as jest.Mock;
  const existing = write.getMockImplementation()!;
  write.mockImplementation((filter, update, options) => update.$set.coverageAssessment ? Promise.resolve(null) : existing(filter, update, options));
  await expect(runStructureOutlineRepair(child._id, runtime)).rejects.toThrow('branch-conflict');
  expect(branch().coverageAssessment).toBeUndefined(); expect(branch().findings.find(row => row.id === 'L3')?.coveredEvidenceIds).toEqual(['E3', 'E4']);
  expect(runtime.finalize).not.toHaveBeenCalled(); expect(branch().proposalRaw).toBeDefined(); expect(branch().reviewAttempts[0].raw).toBeDefined();
});

it('rejects oversized unchanged teacher constraints before a coverage branch or course-fence claim', async () => {
  coverageFixture(); fixture.body.options.guidance = 'x'.repeat(48000);
  fixture.checkpoint.hash = structureReviewHash(fixture.body); fixture.progress.checkpointHash = fixture.checkpoint.hash;
  fixture.parent.structureReview!.checkpointHash = fixture.checkpoint.hash;
  runs.set(fixture.parentId.toHexString(), copy(fixture.parent));
  await expect(createStructureOutlineCoverageRepair(fixture.courseId, fixture.parentId, 'owner', [{ id: 'L3', evidenceIds: ['E4'] }], engine().loadCorpus)).rejects.toThrow('proposal-input-cap');
  expect(createStructureGenerationRun).not.toHaveBeenCalled(); expect(withCourseAuthoringWrite).not.toHaveBeenCalled(); expect(branches.size).toBe(0); expect(calls).toEqual([]);
});

it.each(['drift-after-proposal', 'drift-after-review'] as const)('retains coverage raw evidence but never assesses or finalizes after %s', async mode => {
  const { child, runtime } = await startCoverage(); behavior = mode;
  await expect(runStructureOutlineRepair(child._id, runtime)).rejects.toThrow('source-changed');
  expect(runtime.finalize).not.toHaveBeenCalled(); expect(branch().coverageAssessment).toBeUndefined(); expect(branch().proposalRaw).toBeDefined();
  expect(branch().usedTokens).toBeGreaterThan(fixture.body.baseBudget.admissionTokens!);
});

describe('Instructor repair workspace projection and explicit adoption', () => {
  async function completeCoverage() {
    const { child, runtime } = await startCoverage();
    const result = await runStructureOutlineRepair(child._id, runtime);
    const stored = runs.get(child._id.toHexString())!;
    Object.assign(stored, { status: 'completed', structureResult: result });
    return { child: copy(stored), runtime };
  }

  it('lists canonical withheld and supported-gap identities with exact complete quote excerpts, without raw private authority', async () => {
    coverageFixture(); const runtime = engine();
    const view = await getStructureOutlineRepairView(fixture.courseId, fixture.parentId, runtime.loadCorpus, runtime.finalize);
    expect(view).toMatchObject({ version: 'outline-wording-repair-view-v1', parentRunId: fixture.parentId.toHexString(), availability: { canStart: true },
      budget: { accounting: 'conservative-units-v1', remainingSends: 10, remainingUnits: 540000 }, cycle: { used: false }, targets: { total: 3 } });
    expect(view.targets.items.map(row => [row.id, row.mode])).toEqual([['L1', 'wording-only-outline-repair-v1'], ['L2', 'wording-only-outline-repair-v1'], ['L3', 'coverage-wording-outline-repair-v1']]);
    expect(view.targets.items[2]).toMatchObject({ preservedEvidenceIds: ['E3'], missingEvidenceIds: ['E4'], points: [{ id: 'E3' }, { id: 'E4' }] });
    expect(view.targets.items[2].points[0].quotes).toEqual([{ text: fixture.body.evidence[2].quote }]);
    const serialized = JSON.stringify(view);
    for (const privateKey of ['providerIdentityHash', 'checkpointHash', 'proposalRaw', 'apiKey', 'model', 'baseBudget', 'contentHash']) expect(serialized).not.toContain(`"${privateKey}"`);
    expect(calls).toEqual([]); expect(createStructureGenerationRun).not.toHaveBeenCalled();
  });

  it('paginates targets without changing canonical IDs or silently losing quote text', async () => {
    coverageFixture(); const runtime = engine();
    const first = await getStructureOutlineRepairView(fixture.courseId, fixture.parentId, runtime.loadCorpus, runtime.finalize, { page: 1, pageSize: 2 });
    const second = await getStructureOutlineRepairView(fixture.courseId, fixture.parentId, runtime.loadCorpus, runtime.finalize, { page: 2, pageSize: 2 });
    expect(first.targets.items.map(row => row.id)).toEqual(['L1', 'L2']); expect(second.targets.items.map(row => row.id)).toEqual(['L3']);
    expect(second.targets).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    await expect(getStructureOutlineRepairView(fixture.courseId, fixture.parentId, runtime.loadCorpus, runtime.finalize, { pageSize: 11 })).rejects.toThrow('view-page-invalid');
  });

  it('returns an explicit unavailable historical receipt and refuses foreign run identities', async () => {
    const runtime = engine(); delete runs.get(fixture.parentId.toHexString())!.structureReview;
    await expect(getStructureOutlineRepairView(fixture.courseId, fixture.parentId, runtime.loadCorpus, runtime.finalize)).resolves.toMatchObject({ availability: { canStart: false, reason: 'checkpoint-unavailable' }, targets: { items: [], total: 0 } });
    await expect(getStructureOutlineRepairView(new ObjectId(), fixture.parentId, runtime.loadCorpus, runtime.finalize)).rejects.toThrow('view-run-unavailable');
    expect(runtime.loadCorpus).not.toHaveBeenCalled(); expect(calls).toEqual([]);
  });

  it.each(['source', 'transaction', 'course', 'budget'] as const)('does not offer a new repair with unavailable %s authority', async kind => {
    coverageFixture(); const runtime = engine();
    if (kind === 'source') corpus.fingerprint = 'new-source';
    if (kind === 'transaction') jest.mocked(authoringCommitAvailable).mockReturnValue(false);
    if (kind === 'course') courseAvailable = false;
    if (kind === 'budget') { fixture.parent.structureDiagnostics!.budget = { ...fixture.parent.structureDiagnostics!.budget, admissionTokens: 2000000 };
      fixture.progress.usedTokens = 2000000; runs.set(fixture.parentId.toHexString(), copy(fixture.parent)); }
    const view = await getStructureOutlineRepairView(fixture.courseId, fixture.parentId, runtime.loadCorpus, runtime.finalize);
    expect(view.availability.canStart).toBe(false); expect(view.availability.reason).toBe(kind === 'source' ? 'source-unavailable' : kind === 'transaction' ? 'coordinated-commit-unavailable' : kind === 'course' ? 'course-unavailable' : 'budget-exhausted');
    expect(calls).toEqual([]);
  });

  it('recovers the parent from a failed child and exposes shortfall reasons while keeping the cycle used', async () => {
    const { child, runtime } = await startCoverage(); behavior = 'coverage-lost-preserved';
    await expect(runStructureOutlineRepair(child._id, runtime)).rejects.toThrow('coverage-shortfall');
    Object.assign(runs.get(child._id.toHexString())!, { status: 'failed', error: { code: 'structure-repair-coverage-shortfall', message: 'The independent review lost an old credit.', atStage: 'checking', retryable: false } });
    const beforeCalls = [...calls];
    const view = await getStructureOutlineRepairView(fixture.courseId, child._id, runtime.loadCorpus, runtime.finalize, { page: 2, pageSize: 1 });
    expect(view).toMatchObject({ parentRunId: fixture.parentId.toHexString(), availability: { canStart: false, reason: 'cycle-used' },
      cycle: { used: true, childRunId: child._id.toHexString(), mode: 'coverage-wording-outline-repair-v1' },
      child: { canApply: false, status: 'failed', coverageAssessment: { status: 'shortfall', targets: [{ lostEvidenceIds: ['E3'] }] } } });
    expect(view.child!.targets[0]).toMatchObject({ id: 'L3', before: fixture.body.themes[0].los[2].name, proposalStatus: 'proposed', after: expect.stringContaining('remaining systematic') });
    expect(view.targets).toMatchObject({ page: 1, total: 1, items: [{ id: 'L3', points: [{ id: 'E3' }, { id: 'E4' }] }] });
    expect(calls).toEqual(beforeCalls); expect(runs.get(fixture.parentId.toHexString())!.status).toBe('completed');
  });

  it('keeps malformed failed proposals visible as pending rather than inventing a replacement or verdict', async () => {
    const { child, runtime } = await start(); behavior = 'bad-schema-json-correction';
    await expect(runStructureOutlineRepair(child._id, runtime)).rejects.toThrow('proposal-schema');
    runs.get(child._id.toHexString())!.status = 'failed';
    const view = await getStructureOutlineRepairView(fixture.courseId, child._id, runtime.loadCorpus, runtime.finalize);
    expect(view.child).toMatchObject({ status: 'failed', canApply: false, unknownWork: true });
    expect(view.child!.targets.every(row => row.proposalStatus === 'pending' && row.after === undefined)).toBe(true);
  });

  it('replays a completed child with every authority read inside the caller session and returns trusted identity', async () => {
    const { child, runtime } = await completeCoverage();
    jest.mocked(currentAuthoringSession).mockReturnValue({} as never);
    jest.mocked(getContentRun).mockClear().mockImplementation(async () => { throw new Error('unfenced authority read'); });
    jest.mocked(authoringCollection).mockClear();
    await expect(assertStructureRepairAdoptable(fixture.courseId, child, runtime.loadCorpus, runtime.finalize)).resolves.toEqual({ parentRunId: fixture.parentId.toHexString(), mode: 'coverage-wording-outline-repair-v1' });
    expect(getContentRun).not.toHaveBeenCalled();
    for (const col of [contentRunsCol(), coursesCol(), structureRepairBranchesCol(), structureReviewCheckpointsCol(), structureReviewProgressCol()]) expect(authoringCollection).toHaveBeenCalledWith(col);
  });

  it('offers a locally replayed completed child but refuses its course after archival or deletion begins', async () => {
    const { child, runtime } = await completeCoverage();
    expect((await getStructureOutlineRepairView(fixture.courseId, child._id, runtime.loadCorpus, runtime.finalize)).child?.canApply).toBe(true);
    courseAvailable = false;
    const view = await getStructureOutlineRepairView(fixture.courseId, child._id, runtime.loadCorpus, runtime.finalize);
    expect(view.availability).toMatchObject({ canStart: false, reason: 'course-unavailable' });
    expect(view.child?.canApply).toBe(false);
  });

  it.each(['omitted', 'legacy-bson-null'] as const)('adopts the actual complete finalizer after BSON persistence with %s optional synthesis context', async representation => {
    const { child, runtime } = await startCoverage(); runtime.finalize = jest.fn(finalizeStructureCoverage);
    const result = await runStructureOutlineRepair(child._id, runtime);
    expect(Object.hasOwn(branch().proposalBody!, 'synthesisInput')).toBe(false);
    expect(Object.hasOwn(result.coverage, 'synthesisInput')).toBe(false);
    // Reproduce the former finalizer's own undefined property using the actual
    // Mongo driver's serializer. No invented synthesis receipt or DB is used.
    if (representation === 'legacy-bson-null') Object.assign(result.coverage, { synthesisInput: undefined });
    const stored = BSON.deserialize(BSON.serialize({ ...runs.get(child._id.toHexString())!, status: 'completed', structureResult: result },
      { ignoreUndefined: false })) as WithId<StructureGenerationRun>;
    if (representation === 'legacy-bson-null') expect(stored.structureResult!.coverage.synthesisInput).toBeNull();
    else expect(Object.hasOwn(stored.structureResult!.coverage, 'synthesisInput')).toBe(false);
    runs.set(child._id.toHexString(), stored);
    jest.mocked(currentAuthoringSession).mockReturnValue({} as never);
    await expect(assertStructureRepairAdoptable(fixture.courseId, copy(stored), runtime.loadCorpus, runtime.finalize)).resolves.toMatchObject({ mode: 'coverage-wording-outline-repair-v1' });
  });

  it.each(['non-null-synthesis', 'unexpected-null-field', 'required-field-null'] as const)('keeps full finalized authority when BSON representation is changed: %s', async changed => {
    const { child, runtime } = await startCoverage(); runtime.finalize = jest.fn(finalizeStructureCoverage);
    const result = await runStructureOutlineRepair(child._id, runtime);
    const stored = BSON.deserialize(BSON.serialize({ ...runs.get(child._id.toHexString())!, status: 'completed', structureResult: result },
      { ignoreUndefined: false })) as WithId<StructureGenerationRun>;
    if (changed === 'non-null-synthesis') Object.assign(stored.structureResult!.coverage, { synthesisInput: { version: 'forged' } });
    if (changed === 'unexpected-null-field') Object.assign(stored.structureResult!.coverage, { unexpectedReceipt: null });
    if (changed === 'required-field-null') Object.assign(stored.structureResult!.coverage, { mappedObjectives: null });
    runs.set(child._id.toHexString(), stored);
    jest.mocked(currentAuthoringSession).mockReturnValue({} as never);
    await expect(assertStructureRepairAdoptable(fixture.courseId, copy(stored), runtime.loadCorpus, runtime.finalize)).rejects.toThrow('adoption-result-changed');
  });

  it('replays corrected independent review history without erasing the first malformed response', async () => {
    const { child, runtime } = await startCoverage(); const complete = runtime.complete; let reviews = 0;
    runtime.complete = jest.fn(async (...args) => { const raw = await complete(...args); return args[2] === 'outline-source-review' && reviews++ === 0 ? { reviews: [] } : raw; });
    const result = await runStructureOutlineRepair(child._id, runtime);
    const stored = runs.get(child._id.toHexString())!; Object.assign(stored, { status: 'completed', structureResult: result });
    expect(branch().reviewAttempts).toHaveLength(2); expect(branch().reviewAttempts[0].failures?.length).toBeGreaterThan(0);
    // Resolved historical diagnostics are not fresh unresolved work.
    branch().failures = copy(branch().reviewAttempts[0].failures!);
    jest.mocked(currentAuthoringSession).mockReturnValue({} as never);
    await expect(assertStructureRepairAdoptable(fixture.courseId, copy(stored), runtime.loadCorpus, runtime.finalize)).resolves.toMatchObject({ mode: 'coverage-wording-outline-repair-v1' });
  });

  it('preserves ordinary historical adoption without any new authority read', async () => {
    const runtime = engine(); jest.mocked(getContentRun).mockClear();
    await expect(assertStructureRepairAdoptable(fixture.courseId, fixture.parent, runtime.loadCorpus, runtime.finalize)).resolves.toBeUndefined();
    expect(getContentRun).not.toHaveBeenCalled(); expect(runtime.loadCorpus).not.toHaveBeenCalled();
  });

  it.each([null, undefined, {}, { branchId: 'bad', parentRunId: 'bad', inputHash: 'bad' }])('does not treat an explicit corrupt repair link as historical absence: %p', async value => {
    const runtime = engine(); Object.assign(fixture.parent, { structureRepair: value });
    await expect(assertStructureRepairAdoptable(fixture.courseId, fixture.parent, runtime.loadCorpus, runtime.finalize)).rejects.toThrow('adoption-run-unavailable');
    expect(runtime.loadCorpus).not.toHaveBeenCalled();
  });

  it('requires a transaction for repaired adoption and does not invent one around model work', async () => {
    const { child, runtime } = await completeCoverage(); const old = [...calls];
    await expect(assertStructureRepairAdoptable(fixture.courseId, child, runtime.loadCorpus, runtime.finalize)).rejects.toThrow('adoption-transaction-required');
    expect(calls).toEqual(old);
  });

  it('checks the existing course scope through the nested required fence before any adoption read', async () => {
    const { child, runtime } = await completeCoverage(); const owner = fixture.courseId;
    jest.mocked(currentAuthoringSession).mockReturnValue({} as never);
    jest.mocked(withCourseAuthoringWrite).mockImplementation(async (id, work) => {
      if (!id.equals(owner)) throw new Error('authoring-cross-course-transaction'); return work({} as never);
    });
    const reads = jest.mocked(contentRunsCol()).findOne as jest.Mock; reads.mockClear();
    await expect(assertStructureRepairAdoptable(new ObjectId(), child, runtime.loadCorpus, runtime.finalize)).rejects.toThrow('authoring-cross-course-transaction');
    expect(reads).not.toHaveBeenCalled();
    await expect(assertStructureRepairAdoptable(owner, child, runtime.loadCorpus, runtime.finalize)).resolves.toMatchObject({ parentRunId: fixture.parentId.toHexString() });
  });

  it.each(['sends', 'units'] as const)('rejects consistently rebound fractional terminal %s counters', async kind => {
    const { child, runtime } = await completeCoverage(); const stored = runs.get(child._id.toHexString())!;
    if (kind === 'sends') { branch().reservations += 0.5; branch().newReservations += 0.5; }
    else branch().usedTokens += 0.5;
    // Rebind both copies so this tests integer authority rather than a simple
    // diagnostic/result mismatch, without changing the valid review transcript.
    for (const receipt of new Set([stored.structureResult!.coverage.budget!, stored.structureDiagnostics!.budget])) {
      if (kind === 'sends') receipt.observedSends = branch().reservations;
      else receipt.admissionTokens = branch().usedTokens;
    }
    jest.mocked(currentAuthoringSession).mockReturnValue({} as never);
    await expect(assertStructureRepairAdoptable(fixture.courseId, copy(stored), runtime.loadCorpus, runtime.finalize)).rejects.toThrow('adoption-budget-unreconciled');
  });

  it.each(['result-name', 'result-evidence', 'result-count', 'coverage-receipt', 'proposal-raw', 'unknown-work', 'budget', 'source', 'checkpoint-origin', 'parent-role',
    'progress-course', 'empty-review-history', 'review-raw', 'review-raw-hash', 'review-findings', 'review-attempt', 'unchanged-finding'] as const)(
    'rejects changed repaired adoption authority: %s', async kind => {
      const { child, runtime } = await completeCoverage(); const stored = runs.get(child._id.toHexString())!;
      if (kind === 'result-name') stored.structureResult!.themes[0].los[0].name = 'Forged rewritten wording';
      if (kind === 'result-evidence') stored.structureResult!.evidence[0].quote = 'Changed original quote';
      if (kind === 'result-count') stored.structureResult!.coverage.mappedObjectives++;
      if (kind === 'coverage-receipt') branch().coverageAssessment!.targets[0].preservedEvidenceIds = [];
      if (kind === 'proposal-raw') (branch().proposalRaw as { repairs: Array<{ name: string }> }).repairs[0].name = 'Changed unreviewed proposal';
      if (kind === 'unknown-work') branch().pendingNative.push({ id: 'unknown', input: 1, output: 1, stage: 'outline-source-review' });
      if (kind === 'budget') branch().usedTokens++;
      if (kind === 'source') corpus.fingerprint = 'changed';
      if (kind === 'checkpoint-origin') fixture.checkpoint.runId = new ObjectId();
      if (kind === 'parent-role') fixture.progress.ownerRunId = new ObjectId();
      if (kind === 'progress-course') fixture.progress.courseId = new ObjectId();
      if (kind === 'empty-review-history') branch().reviewAttempts = [];
      if (kind === 'review-raw') branch().reviewAttempts[0].raw = { reviews: [] };
      if (kind === 'review-raw-hash') branch().reviewAttempts[0].rawHash = 'changed';
      if (kind === 'review-findings') branch().reviewAttempts[0].findings = [];
      if (kind === 'review-attempt') branch().reviewAttempts[0].attempt = 1;
      if (kind === 'unchanged-finding') branch().findings[0].reason = 'A different unreviewed reason';
      jest.mocked(currentAuthoringSession).mockReturnValue({} as never);
      const old = [...calls];
      await expect(assertStructureRepairAdoptable(fixture.courseId, copy(stored), runtime.loadCorpus, runtime.finalize)).rejects.toThrow();
      expect(calls).toEqual(old);
    });

  it('does not call an old-mode no-repair outcome a coverage shortfall or silently exclude its remaining supported siblings', async () => {
    const { child, runtime } = await start(['L1']); behavior = 'no-repair';
    const result = await runStructureOutlineRepair(child._id, runtime);
    const stored = runs.get(child._id.toHexString())!; Object.assign(stored, { status: 'completed', structureResult: result });
    jest.mocked(currentAuthoringSession).mockReturnValue({} as never);
    await expect(assertStructureRepairAdoptable(fixture.courseId, copy(stored), runtime.loadCorpus, runtime.finalize)).resolves.toMatchObject({ mode: 'wording-only-outline-repair-v1' });
  });
});

it.each(['outline-capability-distinctness-v1', 'unknown', undefined])('refuses explicit capability parent %s before legacy repair claim or spend', async selector => {
  const parent = runs.get(fixture.parentId.toHexString())!;
  Object.assign(parent.input, { capabilityDistinctnessProtocol: selector });
  await expect(createStructureOutlineRepair(fixture.courseId, fixture.parentId, 'owner', ['L1'], engine().loadCorpus)).rejects.toThrow('structure-repair-capability-parent-unsupported');
  expect(createStructureGenerationRun).not.toHaveBeenCalled(); expect(branches.size).toBe(0); expect(calls).toEqual([]);
});
