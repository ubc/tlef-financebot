jest.mock('../../server/src/config/env', () => ({ env: {
  llmModelGenerator: 'generator-fixture', llmModelValidator: 'validator-fixture',
  llmModelReviewer: 'reviewer-fixture', embeddingsModel: 'embedding-fixture',
} }));
jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../server/src/components/genai/embeddings', () => ({ embedOne: jest.fn() }));
jest.mock('../../server/src/components/qdrant', () => ({ search: jest.fn() }));
jest.mock('../../server/src/components/jobs', () => ({ defineJob: jest.fn(), enqueueJob: jest.fn() }));
jest.mock('../../server/src/components/mongodb/collections', () => ({
  losCol: jest.fn(), materialsCol: jest.fn(), contentRunsCol: jest.fn(), examBuildRunsCol: jest.fn(), themesCol: jest.fn(),
}));
jest.mock('../../server/src/services/questions.service', () => ({ createQuestion: jest.fn() }));
jest.mock('../../server/src/services/materials.service', () => ({ courseCollection: () => 'synthetic-course' }));
jest.mock('../../server/src/services/admin.service', () => ({ getPlatformSettings: jest.fn() }));
jest.mock('../../server/src/services/model-usage.service', () => ({
  withModelUsage: (_scope: unknown, work: () => Promise<unknown>) => work(),
}));
jest.mock('../../server/src/services/content-runs.service', () => ({
  assertContentRunActive: jest.fn(), createQuestionGenerationRun: jest.fn(), failContentRun: jest.fn(),
  getContentRun: jest.fn(), updateContentRun: jest.fn(),
}));
jest.mock('../../server/src/services/generation-evidence.service', () => ({
  buildGenerationEvidence: jest.fn(), assertGenerationEvidenceCurrent: jest.fn(),
}));
jest.mock('../../server/src/services/generation-memory.service', () => ({
  ...jest.requireActual('../../server/src/services/generation-memory.service'), loadGenerationMemory: jest.fn(),
}));
jest.mock('../../server/src/services/generation-quality.service', () => ({
  generationQualityInstruction: jest.fn(), assessGenerationQuality: jest.fn(),
}));

import { ObjectId, type WithId } from 'mongodb';
import { completeJson } from '../../server/src/components/genai/llm';
import { embedOne } from '../../server/src/components/genai/embeddings';
import { search } from '../../server/src/components/qdrant';
import { defineJob, enqueueJob } from '../../server/src/components/jobs';
import { contentRunsCol, examBuildRunsCol, losCol, materialsCol, themesCol } from '../../server/src/components/mongodb/collections';
import { getPlatformSettings } from '../../server/src/services/admin.service';
import { assertContentRunActive, createQuestionGenerationRun, failContentRun, getContentRun, updateContentRun } from '../../server/src/services/content-runs.service';
import { assertGenerationEvidenceCurrent, buildGenerationEvidence } from '../../server/src/services/generation-evidence.service';
import { loadGenerationMemory, withBatchGenerationMemory } from '../../server/src/services/generation-memory.service';
import { assessGenerationQuality, generationQualityInstruction } from '../../server/src/services/generation-quality.service';
import { enqueueGenerationRun, registerGenerationJobs, runGenerationPipeline } from '../../server/src/services/generation.service';
import { createQuestion } from '../../server/src/services/questions.service';
import type { GenerationEvidencePacket } from '../../server/src/services/generation-evidence.service';
import type { GenerationMemorySnapshot } from '../../server/src/services/generation-memory.service';
import type { PlatformSettings, QuestionGenerationRun, QuestionOption } from '../../server/src/types/domain';
import type { GenerationQualityAssessment } from '../../server/src/types/generation-quality';

const courseId = new ObjectId();
const loId = new ObjectId();
const themeId = new ObjectId();
const materialId = new ObjectId();
let run: WithId<QuestionGenerationRun>;
let settings: PlatformSettings;
let produced: number;

function candidate(index: number) {
  const options: QuestionOption[] = [
    { key: 'A', role: 'correct', text: 'Systematic risk', explanation: 'Beta describes systematic risk.' },
    { key: 'B', role: 'common-misconception', text: 'Total risk', explanation: 'Total risk also includes diversifiable risk.' },
    { key: 'C', role: 'partially-correct', text: 'Diversifiable risk', explanation: 'Diversifiable risk is not systematic risk.' },
    { key: 'D', role: 'clearly-wrong', text: 'No risk', explanation: 'Beta does not indicate absence of risk.' },
  ];
  return { stem: `Synthetic independent task ${index}: What does beta describe?`, options, difficulty: 'easy', numericKind: 'conceptual' as const };
}

function memory(digest = 'unchanged-memory'): GenerationMemorySnapshot {
  return { entries: [], truncated: false, missingVersions: 0, snapshotDigest: digest, consistency: 'best-effort' };
}

function evidence(): GenerationEvidencePacket {
  const text = 'Beta describes systematic risk.';
  return {
    id: 'evidence-v1', schemaVersion: 'source-passages-v1', policyVersion: 'grounded-memory-v1', courseId: courseId.toHexString(),
    loIds: [loId.toHexString()], sourceFingerprint: 'fingerprint', parsingProvenance: 'unrecorded',
    materials: [{ materialId: materialId.toHexString(), name: 'Synthetic.pdf', role: 'primary', loId: loId.toHexString(), revision: 1, activeRunId: null, contentHash: 'hash', chunkCount: 1 }],
    passages: [
      { id: 'E-supported', materialId: materialId.toHexString(), materialName: 'Synthetic.pdf', role: 'primary', loId: loId.toHexString(), chunkIndex: 0, start: 0, end: text.length, text, selection: 'retrieved' },
      { id: 'E-uncited', materialId: materialId.toHexString(), materialName: 'Synthetic.pdf', role: 'primary', loId: loId.toHexString(), chunkIndex: 1, start: 0, end: 25, text: 'Unused neighboring passage.', selection: 'neighbor' },
    ],
    coverage: { sourceChunks: 2, selectedChunks: 2, selectedCharacters: 54, omittedPassages: 0, truncated: false, searchScope: 'retrieved-chunks-and-immediate-neighbors' },
    findings: [],
  };
}

function assessment(item: number, patch: Partial<GenerationQualityAssessment> = {}): GenerationQualityAssessment {
  return {
    policy: 'grounded-memory-v1', item, status: 'eligible', sourceSupport: 'supported', notation: 'consistent', novelty: 'independent',
    reasons: ['The selected passage supports the intended concept.'],
    citations: [{ kind: 'premise', claim: 'Beta describes systematic risk.', passageId: 'E-supported', quote: 'Beta describes systematic risk.' },
      { kind: 'solution', claim: 'Use the systematic risk option.', passageId: 'E-supported', quote: 'Beta describes systematic risk.' }],
    matchedEntryIds: [], evidencePacketId: 'evidence-v1', memoryDigest: 'unchanged-memory', checkedAt: new Date(),
    coverage: { evidenceTruncated: false, memoryTruncated: false, shownEntries: 0, totalEntries: 0, missingVersions: 0, consistency: 'best-effort' },
    ...patch,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  produced = 0;
  settings = {
    _id: 'platform',
    models: { generator: { model: 'generator-fixture' }, validator: { model: 'validator-fixture' }, reviewer: { model: 'reviewer-fixture' }, masteryEvaluator: { model: 'mastery-fixture' }, utility: { model: 'utility-fixture' } },
    costControls: { maxGenerationsPerDay: 100 },
    featureFlags: { reviewerAgent: true, layer2Evaluator: true, retryOnReject: false },
    updatedBy: 'admin-fixture', updatedAt: new Date(),
  };
  run = {
    _id: new ObjectId(), courseId, kind: 'question-generation', requestedBy: 'teacher-fixture', status: 'queued', stage: 'queued',
    completedUnits: 0, totalUnits: 1, revision: 0, events: [], warnings: [], createdAt: new Date(), updatedAt: new Date(),
    input: { loId, count: 1, type: 'mcq', difficulty: 'easy', qualityPolicy: 'grounded-memory-v1',
      models: { embedding: 'embedding-fixture', generator: 'generator-fixture', validator: 'validator-fixture', reviewer: 'reviewer-fixture' } },
    grounding: { allowedMaterialIds: [materialId], retrievedChunkCount: 0, pinned: true },
    result: { createdQuestionIds: [], failures: [] },
  };
  jest.mocked(getPlatformSettings).mockImplementation(async () => settings);
  jest.mocked(getContentRun).mockImplementation(async () => run);
  jest.mocked(createQuestionGenerationRun).mockImplementation(async () => run);
  jest.mocked(assertContentRunActive).mockResolvedValue(undefined);
  jest.mocked(updateContentRun).mockResolvedValue(run);
  jest.mocked(losCol).mockReturnValue({ findOne: async () => ({ _id: loId, courseId, themeId, name: 'Describe systematic risk' }) } as never);
  jest.mocked(materialsCol).mockReturnValue({ find: () => ({ toArray: async () => [{ _id: materialId, courseId, status: 'ready', assignments: [{ themeId, loId }] }] }) } as never);
  jest.mocked(contentRunsCol).mockReturnValue({ aggregate: () => ({ toArray: async () => [] }) } as never);
  jest.mocked(examBuildRunsCol).mockReturnValue({ find: () => ({ toArray: async () => [] }) } as never);
  jest.mocked(themesCol).mockReturnValue({ find: () => ({ toArray: async () => [] }) } as never);
  jest.mocked(embedOne).mockResolvedValue([0.1, 0.2]);
  jest.mocked(search).mockResolvedValue([{ id: 'source-locator', score: 1, payload: { materialId: materialId.toHexString(), chunkIndex: 0, chunk: 'Beta describes systematic risk.' } }]);
  jest.mocked(buildGenerationEvidence).mockResolvedValue(evidence());
  jest.mocked(assertGenerationEvidenceCurrent).mockResolvedValue(undefined);
  jest.mocked(loadGenerationMemory).mockResolvedValue(memory());
  jest.mocked(generationQualityInstruction).mockImplementation((_packet, snapshot) => `QUALITY MEMORY: ${snapshot.entries.map(entry => entry.content.stem).join(' | ')}`);
  jest.mocked(assessGenerationQuality).mockImplementation(async ({ item }) => assessment(item));
  jest.mocked(createQuestion).mockImplementation(async () => ({ questionId: new ObjectId(), version: { _id: new ObjectId() } }) as never);
  jest.mocked(completeJson).mockImplementation(async (_prompt, options) => {
    await options?.beforeRequest?.();
    switch (options?.usageContext?.stage) {
      case 'generation': return candidate(produced++) as never;
      case 'validation': return { roleAssessment: 'Roles are valid.' } as never;
      case 'review': return { decision: 'pass', reasoning: 'Supported conceptual question.' } as never;
      default: throw new Error(`Unexpected fixture stage: ${options?.usageContext?.stage}`);
    }
  });
});

async function execute(): Promise<void> {
  registerGenerationJobs();
  const handler = jest.mocked(defineJob).mock.calls.at(-1)![1] as (data: { runId: string }) => Promise<void>;
  await handler({ runId: run._id.toHexString() });
}

function finalResult() {
  const terminal = [...jest.mocked(updateContentRun).mock.calls].reverse().find(([, update]) => update.status === 'completed' || update.status === 'partial');
  return terminal?.[1].result ?? jest.mocked(failContentRun).mock.calls.at(-1)?.[2];
}

describe('grounded memory public generation pilot', () => {
  it('freezes opt-in policy on enqueue and carries the stored policy through Agenda execution', async () => {
    await enqueueGenerationRun({ courseId, loId, count: 1, byPuid: 'teacher-fixture', qualityPolicy: 'grounded-memory-v1' });
    expect(createQuestionGenerationRun).toHaveBeenCalledWith(expect.objectContaining({ qualityPolicy: 'grounded-memory-v1' }));
    expect(enqueueJob).toHaveBeenCalledWith('generation.run', { runId: run._id.toHexString() });
    await execute();
    expect(buildGenerationEvidence).toHaveBeenCalledWith(expect.objectContaining({ policyVersion: 'grounded-memory-v1', courseId, loIds: [loId] }));
    expect(assessGenerationQuality).toHaveBeenCalledWith(expect.objectContaining({ item: 0, step: { model: 'reviewer-fixture' } }));
    expect(finalResult()).toMatchObject({ quality: { policy: 'grounded-memory-v1', evidence: { id: 'evidence-v1' }, assessments: [expect.objectContaining({ status: 'eligible' })] } });
  });

  it.each([false, true])('preserves an explicit grounding pin flag (%s) when re-enqueueing frozen material IDs', async groundingPinned => {
    await enqueueGenerationRun({ courseId, loId, count: 1, byPuid: 'teacher-fixture', qualityPolicy: 'grounded-memory-v1', pinnedMaterialIds: [materialId], groundingPinned });
    expect(createQuestionGenerationRun).toHaveBeenCalledWith(expect.objectContaining({ grounding: expect.objectContaining({ allowedMaterialIds: [materialId], pinned: groundingPinned }) }));
  });

  it('passes earlier same-batch candidates to the next generator and retains only cited evidence at save', async () => {
    run.input.count = 2;
    await execute();
    expect(generationQualityInstruction).toHaveBeenCalledTimes(2);
    const secondMemory = jest.mocked(generationQualityInstruction).mock.calls[1][1];
    expect(secondMemory.entries).toHaveLength(1);
    expect(secondMemory.entries[0].id).toBe(`batch:${run._id.toHexString()}:0`);
    expect(secondMemory.entries[0].content.stem).toContain('task 0');
    const generationPrompts = jest.mocked(completeJson).mock.calls.filter(([, options]) => options?.usageContext?.stage === 'generation').map(([prompt]) => prompt);
    expect(generationPrompts[1]).toContain('QUALITY MEMORY: Synthetic independent task 0');
    expect(createQuestion).toHaveBeenCalledTimes(2);
    for (const [saved] of jest.mocked(createQuestion).mock.calls) {
      expect(saved.sourceRefs).toEqual([{ materialId, chunk: 'Beta describes systematic risk.' }]);
      expect(saved.provenance).toMatchObject({ kind: 'generated', runId: run._id });
    }
    expect(assertGenerationEvidenceCurrent).toHaveBeenCalledTimes(4);
  });

  it('refreshes saved same-batch questions into the next semantic comparison', async () => {
    run.input.count = 2;
    let currentBank = memory();
    jest.mocked(loadGenerationMemory).mockImplementation(async () => currentBank);
    jest.mocked(createQuestion).mockImplementation(async input => {
      const questionId = new ObjectId();
      const versionId = new ObjectId();
      const captured = withBatchGenerationMemory(memory(), [{ id: 'batch:captured', content: { type: input.type, stem: input.stem, options: input.options } }]);
      currentBank = {
        ...captured,
        entries: captured.entries.map(entry => ({ ...entry, id: `q:${questionId.toHexString()}:${versionId.toHexString()}`, source: 'bank', state: 'draft', questionId: questionId.toHexString(), versionId: versionId.toHexString() })),
        snapshotDigest: 'saved-first-question',
      };
      return { questionId, version: { _id: versionId } } as never;
    });
    jest.mocked(assessGenerationQuality).mockImplementation(async ({ item, memory: current }) => item === 0 ? assessment(0) : assessment(1, {
      status: 'withheld', novelty: 'duplicate', matchedEntryIds: [current.entries[0].id], reasons: ['The earlier saved batch question asks this task.'],
    }));
    await execute();
    const second = jest.mocked(assessGenerationQuality).mock.calls[1][0];
    expect(second.memory.entries).toHaveLength(1);
    expect(second.memory.entries[0]).toMatchObject({ source: 'bank', state: 'draft', content: { stem: expect.stringContaining('task 0') } });
    expect(createQuestion).toHaveBeenCalledTimes(1);
    expect(finalResult()).toMatchObject({ failures: [expect.objectContaining({ item: 1 })] });
  });

  it.each([
    ['unsupported', { sourceSupport: 'unsupported' as const }],
    ['duplicate', { novelty: 'duplicate' as const }],
    ['variant', { novelty: 'variant' as const }],
  ])('withholds %s output, records a shortfall, and finishes partial when another candidate is eligible', async (_name, fields) => {
    run.input.count = 2;
    jest.mocked(assessGenerationQuality).mockResolvedValueOnce(assessment(0, { status: 'withheld', ...fields, reasons: ['Synthetic quality finding.'] })).mockResolvedValueOnce(assessment(1));
    await execute();
    expect(createQuestion).toHaveBeenCalledTimes(1);
    expect(jest.mocked(createQuestion).mock.calls[0][0].stem).toContain('task 1');
    expect(updateContentRun).toHaveBeenCalledWith(run._id, expect.objectContaining({ status: 'partial', completedUnits: 2 }));
    expect(finalResult()).toMatchObject({
      failures: [expect.objectContaining({ item: 0, stage: 'persisting', message: expect.stringContaining('generation-quality-withheld') })],
      quality: { assessments: [expect.objectContaining({ status: 'withheld' }), expect.objectContaining({ status: 'eligible' })] },
    });
  });

  it('records an all-withheld run as failed without counting any accepted output', async () => {
    jest.mocked(assessGenerationQuality).mockResolvedValue(assessment(0, { status: 'withheld', sourceSupport: 'uncertain', reasons: ['Review unavailable.'] }));
    await execute();
    expect(createQuestion).not.toHaveBeenCalled();
    expect(failContentRun).toHaveBeenCalledWith(run._id, expect.objectContaining({ code: 'generation-no-questions-created' }), expect.objectContaining({ createdQuestionIds: [], failures: [expect.any(Object)] }));
  });

  it('withholds a formerly eligible result after bank version drift', async () => {
    jest.mocked(loadGenerationMemory).mockResolvedValueOnce(memory()).mockResolvedValueOnce(memory()).mockResolvedValueOnce(memory('new-version-digest'));
    await execute();
    expect(createQuestion).not.toHaveBeenCalled();
    expect(finalResult()).toMatchObject({ quality: { assessments: [expect.objectContaining({ status: 'withheld', novelty: 'uncertain', reasons: expect.arrayContaining([expect.stringContaining('bank changed')]) })] } });
  });

  it.each(['generation-evidence-source-changed', 'generation-evidence-material-unavailable'])('withholds on %s after the semantic review, before saving', async error => {
    jest.mocked(assertGenerationEvidenceCurrent).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error(error));
    await execute();
    expect(assessGenerationQuality).toHaveBeenCalledTimes(1);
    expect(createQuestion).not.toHaveBeenCalled();
    expect(finalResult()).toMatchObject({ quality: { assessments: [expect.objectContaining({ status: 'withheld', sourceSupport: 'uncertain' })] } });
  });

  it('stops before the quality call when evidence is already stale', async () => {
    jest.mocked(assertGenerationEvidenceCurrent).mockRejectedValue(new Error('generation-evidence-source-changed'));
    await execute();
    expect(assessGenerationQuality).not.toHaveBeenCalled();
    expect(createQuestion).not.toHaveBeenCalled();
    expect(finalResult()).toMatchObject({ failures: [expect.objectContaining({ code: 'generation-evidence-source-changed' })] });
  });

  it('refuses pilot enqueue and execution when the reviewer is disabled', async () => {
    settings.featureFlags.reviewerAgent = false;
    await expect(enqueueGenerationRun({ courseId, loId, count: 1, byPuid: 'teacher-fixture', qualityPolicy: 'grounded-memory-v1' })).rejects.toThrow('generation-quality-reviewer-required');
    expect(createQuestionGenerationRun).not.toHaveBeenCalled();
    await execute();
    expect(completeJson).not.toHaveBeenCalled();
    expect(buildGenerationEvidence).not.toHaveBeenCalled();
    expect(failContentRun).toHaveBeenCalledWith(run._id, expect.objectContaining({ code: 'generation-quality-reviewer-required' }), expect.any(Object));
  });

  it.each([undefined, 'baseline' as const])('keeps the legacy/baseline policy on the existing generation path (%s)', async qualityPolicy => {
    run.input.qualityPolicy = qualityPolicy;
    await execute();
    expect(completeJson).toHaveBeenCalledTimes(3);
    expect(createQuestion).toHaveBeenCalledTimes(1);
    expect(buildGenerationEvidence).not.toHaveBeenCalled();
    expect(loadGenerationMemory).not.toHaveBeenCalled();
    expect(generationQualityInstruction).not.toHaveBeenCalled();
    expect(assessGenerationQuality).not.toHaveBeenCalled();
    expect(finalResult()).not.toHaveProperty('quality');
  });

  it('requires durable public generation for the pilot instead of silently ignoring its policy', async () => {
    await expect(runGenerationPipeline({ courseId, loId, count: 1, byPuid: 'teacher-fixture', qualityPolicy: 'grounded-memory-v1' })).rejects.toThrow('generation-quality-requires-tracked-run');
    expect(completeJson).not.toHaveBeenCalled();
  });

  it('records an unexpected quality-module failure without saving or retrying the candidate', async () => {
    jest.mocked(assessGenerationQuality).mockRejectedValue(new Error('synthetic-quality-check-failed'));
    await execute();
    expect(createQuestion).not.toHaveBeenCalled();
    expect(completeJson).toHaveBeenCalledTimes(3);
    expect(assessGenerationQuality).toHaveBeenCalledTimes(1);
    expect(finalResult()).toMatchObject({ failures: [expect.objectContaining({ code: 'synthetic-quality-check-failed', stage: 'persisting' })] });
  });

  it('carries cancellation checkpoints to every paid stage and never starts another call after cancellation', async () => {
    let stopped = false;
    jest.mocked(assertContentRunActive).mockImplementation(async () => { if (stopped) throw new Error('content-run-conflict'); });
    jest.mocked(updateContentRun).mockImplementation(async () => { if (stopped) throw new Error('content-run-conflict'); return run; });
    jest.mocked(completeJson).mockImplementation(async (_prompt, options) => {
      await options?.beforeRequest?.();
      if (options?.usageContext?.stage === 'generation') return candidate(0) as never;
      stopped = true;
      // Simulate cancellation at the existing JSON-repair checkpoint.
      await options?.beforeRequest?.();
      throw new Error('A cancelled request must not be sent');
    });
    await execute();
    expect(completeJson).toHaveBeenCalledTimes(2);
    expect(jest.mocked(completeJson).mock.calls.every(([, options]) => typeof options?.beforeRequest === 'function')).toBe(true);
    expect(createQuestion).not.toHaveBeenCalled();
    expect(assessGenerationQuality).not.toHaveBeenCalled();
    expect(failContentRun).not.toHaveBeenCalled();
  });
});
