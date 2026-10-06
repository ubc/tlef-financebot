jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../server/src/components/mongodb/collections', () => ({
  questionsCol: jest.fn(), questionVersionsCol: jest.fn(), modelCallReceiptsCol: jest.fn(),
}));
jest.mock('../../server/src/services/content-runs.service', () => ({ getCourseContentRun: jest.fn() }));
jest.mock('../../server/src/services/model-usage.service', () => ({ summarizeModelUsage: jest.fn() }));

import { ObjectId, type WithId } from 'mongodb';
import { completeJson } from '../../server/src/components/genai/llm';
import { modelCallReceiptsCol, questionsCol, questionVersionsCol } from '../../server/src/components/mongodb/collections';
import { getCourseContentRun } from '../../server/src/services/content-runs.service';
import { summarizeModelUsage } from '../../server/src/services/model-usage.service';
import { exportGenerationEvaluation } from '../../server/src/services/generation-evaluation.service';
import type { QuestionGenerationRun, QuestionVersion } from '../../server/src/types/domain';
import type { ModelCallReceipt, ModelUsageSummary } from '../../server/src/types/model-usage';
import type { GenerationQualityAssessment } from '../../server/src/types/generation-quality';
import type { GenerationEvidencePacket } from '../../server/src/types/generation-evidence';

const courseId = new ObjectId(); const runId = new ObjectId(); const questionId = new ObjectId(); const loId = new ObjectId();
const materialId = new ObjectId(); const versionId = new ObjectId();
const now = new Date('2026-10-03T18:00:00Z');
let run: WithId<QuestionGenerationRun>;
let versions: WithId<QuestionVersion>[];
let heads: Array<{ _id: ObjectId }>;
let receipts: ModelCallReceipt[];
let totalCalls: number;
let summary: ModelUsageSummary;
let versionFilter: unknown; let headFilter: unknown; let receiptFilter: unknown;
let receiptLimit: jest.Mock;

function cursor<T>(rows: () => T[]) {
  const result = { sort: jest.fn(), limit: jest.fn(), toArray: jest.fn(async () => rows()) };
  result.sort.mockReturnValue(result); result.limit.mockReturnValue(result); return result;
}
function assessment(item: number): GenerationQualityAssessment {
  return { policy: 'grounded-memory-v1', item, status: 'withheld', sourceSupport: 'unsupported', notation: 'consistent', novelty: 'uncertain',
    reasons: ['The notes do not teach this dependency.'], citations: [], matchedEntryIds: [], comparedEntryIds: [],
    evidencePacketId: 'snapshot', memoryDigest: 'memory', checkedAt: now,
    candidate: { type: 'mcq', stem: 'Withheld candidate', options: [], numericKind: 'conceptual', contentHash: 'hash', truncated: false },
    coverage: { evidenceTruncated: false, memoryTruncated: false, shownEntries: 0, totalEntries: 0, missingVersions: 0, consistency: 'best-effort' } };
}
function evidence(): GenerationEvidencePacket {
  return { id: 'snapshot', schemaVersion: 'source-passages-v1', policyVersion: 'grounded-memory-v1', courseId: courseId.toHexString(), loIds: [loId.toHexString()],
    sourceFingerprint: 'source-digest', parsingProvenance: 'unrecorded', materials: [{ materialId: materialId.toHexString(), role: 'primary', name: 'Notes.txt', revision: 2,
      activeRunId: null, contentHash: 'source-hash', chunkCount: 1 }], passages: [{ id: 'E1', materialId: materialId.toHexString(), materialName: 'Notes.txt', role: 'primary',
      chunkIndex: 0, start: 0, end: 7, text: 'Source.', selection: 'retrieved' }], coverage: { sourceChunks: 1, selectedChunks: 1, selectedCharacters: 7,
      omittedPassages: 0, truncated: false, searchScope: 'retrieved-chunks-and-immediate-neighbors' }, findings: [] };
}
beforeEach(() => {
  run = { _id: runId, courseId, kind: 'question-generation', requestedBy: 'PRIVATE-INSTRUCTOR-PUID', status: 'partial', stage: 'persisting',
    completedUnits: 3, totalUnits: 3, revision: 8, events: [], warnings: [], createdAt: now, startedAt: now, completedAt: now, updatedAt: now,
    input: { loId, count: 3, type: 'mcq', difficulty: 'medium', prompt: 'Use course notation.', models: { embedding: 'embed', generator: 'gen', validator: 'val', reviewer: 'review' } },
    result: { createdQuestionIds: [questionId], failures: [{ item: 0, stage: 'generating', code: 'generation-invalid-options', message: 'No valid options.' }],
      quality: { policy: 'grounded-memory-v1', assessments: [assessment(2)], evidence: evidence() } } };
  versions = [{ _id: versionId, questionId, version: 1, type: 'mcq', difficulty: 'medium', stem: 'Original generated content',
    options: [{ key: 'A', text: 'Beta', role: 'correct', explanation: 'Systematic risk.' }], sourceRefs: [{ materialId, chunk: 'Original source excerpt.' }],
    createdBy: 'PRIVATE-INSTRUCTOR-PUID', createdAt: now, provenance: { kind: 'generated', runId, item: 1 },
    verification: { evaluatorVersion: 1, sampleSeeds: [123], verifiedAt: now } }];
  heads = [{ _id: questionId }];
  receipts = [{ _id: 'call-id', trackingSessionId: 'PRIVATE-SESSION', operationId: 'PRIVATE-REQUEST', runId: runId.toHexString(), courseId,
    actor: { puid: 'PRIVATE-INSTRUCTOR-PUID' }, stage: 'generation', item: 1, candidateAttempt: 2, jsonAttempt: 0,
    provider: 'test-provider', requestedModel: 'requested-model', actualModel: 'actual-model', responseId: 'PRIVATE-RESPONSE',
    requestOptions: { temperature: 0.2, stream: true, maxTokens: 2000, apiKey: 'PRIVATE-CREDENTIAL', messages: 'PRIVATE-PROMPT-BODY' },
    startedAt: now, finishedAt: now, durationMs: 2, outcome: 'succeeded', retryVisibility: 'unknown',
    usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, reasoningTokens: null, cachedInputTokens: null, cacheWriteTokens: null,
      totalOrigin: 'provider', countSource: 'provider-reported' } }];
  totalCalls = 1;
  summary = { status: 'complete', scope: 'llm-calls', coverageGaps: 0, untracked: false, retryVisibility: 'unknown',
    inputTokens: 100, outputTokens: 20, totalTokens: 120, reasoningTokens: null, cachedInputTokens: null, cacheWriteTokens: null,
    observedCalls: 1, reportedCalls: 1, callsWithKnownTotal: 1, pendingCalls: 0, unknownCalls: 0, stages: [], models: [] };
  jest.mocked(getCourseContentRun).mockReset(); jest.mocked(getCourseContentRun).mockImplementation(async () => run);
  jest.mocked(summarizeModelUsage).mockImplementation(async () => summary);
  jest.mocked(questionVersionsCol).mockReturnValue({ find: (filter: unknown) => { versionFilter = filter; return cursor(() => versions); } } as never);
  jest.mocked(questionsCol).mockReturnValue({ find: (filter: unknown) => { headFilter = filter; return cursor(() => heads); } } as never);
  const callCursor = cursor(() => receipts); receiptLimit = callCursor.limit;
  jest.mocked(modelCallReceiptsCol).mockReturnValue({ find: (filter: unknown) => { receiptFilter = filter; return callCursor; }, countDocuments: jest.fn(async () => totalCalls) } as never);
});
afterEach(() => expect(completeJson).not.toHaveBeenCalled());

it('exports exact immutable slot-bound generated versions, not current content or created-ID array positions', async () => {
  const result = await exportGenerationEvaluation(courseId, runId);
  expect(result.slots.map(slot => [slot.item, slot.outcome])).toEqual([[0, 'failed'], [1, 'saved'], [2, 'withheld']]);
  expect(result.slots[1]).toMatchObject({ questionVersionId: versionId.toHexString(), candidate: { stem: 'Original generated content', truncated: false },
    recordedSourceRefs: [{ materialId: materialId.toHexString(), chunk: 'Original source excerpt.' }], numericVerification: { sampleSeeds: [123], verifiedAt: now.toISOString() } });
  expect(versionFilter).toEqual({ version: 1, 'provenance.kind': 'generated', 'provenance.runId': runId });
  expect(headFilter).toEqual({ courseId, _id: { $in: [questionId] } });
  expect(result.slots[2].candidate?.stem).toBe('Withheld candidate');
  expect(result.evidence).toEqual(run.result!.quality!.evidence);
});

it('does not include actors, request/session/provider-response IDs or arbitrary receipt options', async () => {
  const result = await exportGenerationEvaluation(courseId, runId);
  expect(JSON.stringify(result)).not.toContain('PRIVATE-');
  expect(result.usage.calls[0]).toEqual({ id: 'call-id', stage: 'generation', item: 1, candidateAttempt: 2, jsonAttempt: 0, provider: 'test-provider',
    requestedModel: 'requested-model', actualModel: 'actual-model', requestOptions: { temperature: 0.2, stream: true, maxTokens: 2000 },
    startedAt: now.toISOString(), finishedAt: now.toISOString(), durationMs: 2, outcome: 'succeeded', retryVisibility: 'unknown', usage: receipts[0].usage });
  expect(receiptFilter).toEqual({ courseId, runId: runId.toHexString() });
  expect(summarizeModelUsage).toHaveBeenCalledWith({ courseId: courseId.toHexString(), runId: runId.toHexString() });
});

it('preserves recorded secondary objectives, construction choices and explicit false pin state', async () => {
  const secondary = new ObjectId();
  run.input.secondaryLoIds = [secondary]; run.input.hardnessMove = 'chain'; run.input.kind = 'calculation';
  run.grounding = { allowedMaterialIds: [materialId], retrievedChunkCount: 3, pinned: false };
  const result = await exportGenerationEvaluation(courseId, runId);
  expect(result.run).toMatchObject({ secondaryLoIds: [secondary.toHexString()], hardnessMove: 'chain', kind: 'calculation',
    grounding: { allowedMaterialIds: [materialId.toHexString()], retrievedChunkCount: 3, pinned: false } });
});

it('defaults legacy policy to baseline and never reconstructs missing source, Bank, objective text, or labels', async () => {
  delete run.result!.quality;
  run.preview = { item: 2, attempt: 1, stem: 'Do not promote this unverified preview into an original candidate.' };
  const result = await exportGenerationEvaluation(courseId, runId);
  expect(result.run.policy).toBe('baseline'); expect(result.evidence).toBeUndefined();
  expect(result.slots[2]).toEqual({ item: 2, outcome: 'unavailable', failureCodes: ['export-unrecorded-slot'] });
  expect(JSON.stringify(result)).not.toContain('Do not promote');
  expect(result).not.toHaveProperty('labels');
  expect(result.limitations.join(' ')).toContain('retrospective');
  expect(result.limitations.join(' ')).toContain('No frozen source evidence packet');
});

it('marks deleted original records unavailable without inferring their item from the created ID list', async () => {
  versions = [];
  const result = await exportGenerationEvaluation(courseId, runId);
  expect(result.slots[1].outcome).toBe('unavailable'); expect(result.slots[1].candidate).toBeUndefined();
  expect(result.limitations.join(' ')).toContain('saved questions whose exact original versions');
});

it('omits foreign-course or wrong-provenance versions rather than leaking their content', async () => {
  heads = [];
  let result = await exportGenerationEvaluation(courseId, runId);
  expect(result.slots[1].outcome).toBe('unavailable'); expect(JSON.stringify(result)).not.toContain('Original generated content');
  heads = [{ _id: questionId }]; versions[0].provenance = { kind: 'generated', runId: new ObjectId(), item: 1 };
  result = await exportGenerationEvaluation(courseId, runId);
  expect(result.slots[1].outcome).toBe('unavailable');
  versions[0].provenance = { kind: 'generated', runId, item: 1 }; versions[0].version = 2;
  result = await exportGenerationEvaluation(courseId, runId);
  expect(result.slots[1].outcome).toBe('unavailable');
});

it('does not choose an arbitrary original version or assessment when slot bindings are ambiguous', async () => {
  versions.push({ ...versions[0], _id: new ObjectId() });
  run.result!.quality!.assessments.push(assessment(2));
  const result = await exportGenerationEvaluation(courseId, runId);
  expect(result.slots[1]).toEqual({ item: 1, outcome: 'unavailable', failureCodes: ['export-ambiguous-original-version'] });
  expect(result.slots[2].assessment).toBeUndefined();
  expect(result.limitations.join(' ')).toContain('Multiple assessments');
});

it('preserves withheld outcome even if a historical assessment has no candidate content', async () => {
  delete run.result!.quality!.assessments[0].candidate;
  const result = await exportGenerationEvaluation(courseId, runId);
  expect(result.slots[2].outcome).toBe('withheld'); expect(result.slots[2].candidate).toBeUndefined();
});

it('reports candidate and source-reference truncation while retaining original diagnostic hashes', async () => {
  versions[0].stem = 'x'.repeat(13000);
  versions[0].sourceRefs[0].chunk = 's'.repeat(40000);
  const result = await exportGenerationEvaluation(courseId, runId);
  expect(result.slots[1].candidate!.stem).toHaveLength(12000); expect(result.slots[1].candidate!.truncated).toBe(true);
  expect(result.slots[1].recordedSourceRefs![0].chunk).toHaveLength(30000); expect(result.slots[1].recordedSourceRefsTruncated).toBe(true);
  expect(result.limitations.join(' ')).toContain('source-reference list was truncated');
});

it('returns authoritative usage totals independently from the bounded call-row export', async () => {
  totalCalls = 1005; summary = { ...summary, observedCalls: 1005, totalTokens: 999999 };
  const result = await exportGenerationEvaluation(courseId, runId);
  expect(receiptLimit).toHaveBeenCalledWith(1000);
  expect(result.usage).toMatchObject({ totalCalls: 1005, callsTruncated: true, summary: { totalTokens: 999999, observedCalls: 1005 } });
  expect(result.limitations.join(' ')).toContain('independently over all retained receipts');
});

it('retains unavailable and pending usage instead of inventing zero or a settled invoice', async () => {
  receipts = []; totalCalls = 0;
  summary = { ...summary, status: 'unavailable', untracked: true, inputTokens: null, outputTokens: null, totalTokens: null, observedCalls: 0, reportedCalls: 0, callsWithKnownTotal: 0 };
  let result = await exportGenerationEvaluation(courseId, runId);
  expect(result.usage.summary).toMatchObject({ status: 'unavailable', totalTokens: null, untracked: true });
  summary = { ...summary, status: 'pending', pendingCalls: 1 };
  result = await exportGenerationEvaluation(courseId, runId);
  expect(result.limitations.join(' ')).toContain('Late provider usage');
});

it('rejects missing, active, non-generation and oversized runs before reading export records', async () => {
  jest.mocked(getCourseContentRun).mockResolvedValueOnce(null);
  await expect(exportGenerationEvaluation(courseId, runId)).rejects.toMatchObject({ status: 404 });
  run.status = 'running';
  await expect(exportGenerationEvaluation(courseId, runId)).rejects.toMatchObject({ message: 'content-run-not-terminal', status: 409 });
  jest.mocked(getCourseContentRun).mockResolvedValueOnce({ ...run, kind: 'structure-generation' } as never);
  await expect(exportGenerationEvaluation(courseId, runId)).rejects.toMatchObject({ message: 'content-run-not-generation', status: 409 });
  run.status = 'completed'; run.input.count = 101;
  await expect(exportGenerationEvaluation(courseId, runId)).rejects.toMatchObject({ message: 'evaluation-export-slot-limit', status: 409 });
  expect(questionVersionsCol).not.toHaveBeenCalled();
});

it('returns the same missing-run response if a malformed lookup supplies a foreign course run', async () => {
  jest.mocked(getCourseContentRun).mockResolvedValueOnce({ ...run, courseId: new ObjectId() });
  await expect(exportGenerationEvaluation(courseId, runId)).rejects.toMatchObject({ message: 'content-run-not-found', status: 404 });
  expect(questionVersionsCol).not.toHaveBeenCalled();
});

it('rejects an export if the terminal run revision changes while records are assembled', async () => {
  jest.mocked(getCourseContentRun).mockResolvedValueOnce(run).mockResolvedValueOnce({ ...run, revision: 9 });
  await expect(exportGenerationEvaluation(courseId, runId)).rejects.toMatchObject({ message: 'evaluation-export-run-changed', status: 409 });
});
