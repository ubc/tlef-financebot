// Unit test — generation.service (PRD §9.1, IN-Q10): the three-agent pipeline
// (generator -> structure validator -> reviewer) and the pre-seeding progress
// rollup. llm/qdrant/embeddings/questions.service/collections/materials are all
// MOCKED — this pins the ORCHESTRATION (which model each step uses, that every
// decision is persisted as a Draft, retry/skip on bad options, per-LO counts),
// not real model output. Task 8 Step 1 cases:
//   1. the three steps run with the three DISTINCT configured models
//   2. a reviewer `reject` STILL inserts a Draft carrying agentDecision.reject
//   3. generator output failing option invariants is retried once, then skipped
//   4. preseedingProgress counts approved/reviewed/actionable-unapproved per LO
jest.mock('../../server/src/config/env', () => ({
  env: {
    llmModelGenerator: 'gen-model',
    llmModelValidator: 'val-model',
    llmModelReviewer: 'rev-model',
    llmDefaultModel: 'default-model',
    embeddingsModel: 'embed-model',
  },
}));
jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../server/src/components/genai/embeddings', () => ({ embedOne: jest.fn() }));
jest.mock('../../server/src/components/qdrant', () => ({ search: jest.fn() }));
jest.mock('../../server/src/services/questions.service', () => ({ createQuestion: jest.fn() }));
jest.mock('../../server/src/services/materials.service', () => ({
  courseCollection: jest.fn(() => 'course-abc'),
}));
jest.mock('../../server/src/components/jobs', () => ({ defineJob: jest.fn(), enqueueJob: jest.fn() }));
jest.mock('../../server/src/components/mongodb/collections', () => ({
  losCol: jest.fn(),
  materialsCol: jest.fn(),
  questionsCol: jest.fn(),
  contentRunsCol: jest.fn(),
  platformSettingsCol: jest.fn(() => ({ findOne: jest.fn(async () => null) })),
}));
jest.mock('../../server/src/services/content-runs.service', () => ({
  createQuestionGenerationRun: jest.fn(),
  failContentRun: jest.fn(),
  getContentRun: jest.fn(),
  updateContentRun: jest.fn(),
}));

import { ObjectId } from 'mongodb';
import {
  enqueueGenerationRun,
  GENERATOR_PROMPT,
  preseedingProgress,
  registerGenerationJobs,
  REVIEWER_PROMPT,
  runGenerationPipeline,
} from '../../server/src/services/generation.service';
import { completeJson } from '../../server/src/components/genai/llm';
import { embedOne } from '../../server/src/components/genai/embeddings';
import { search } from '../../server/src/components/qdrant';
import { createQuestion } from '../../server/src/services/questions.service';
import { contentRunsCol, losCol, materialsCol, platformSettingsCol, questionsCol } from '../../server/src/components/mongodb/collections';
import { defineJob, enqueueJob } from '../../server/src/components/jobs';
import {
  createQuestionGenerationRun,
  failContentRun,
  getContentRun,
  updateContentRun,
} from '../../server/src/services/content-runs.service';
import type { QuestionOption } from '../../server/src/types/domain';

const loFindOne = jest.fn();
const loToArray = jest.fn();
const materialToArray = jest.fn();
const countDocuments = jest.fn();

function validOptions(): QuestionOption[] {
  return [
    { key: 'A', text: '10%', role: 'correct', explanation: 'right' },
    { key: 'B', text: '5%', role: 'common-misconception', explanation: 'mix-up' },
    { key: 'C', text: '8%', role: 'partially-correct', explanation: 'close' },
    { key: 'D', text: '99%', role: 'clearly-wrong', explanation: 'nope' },
  ];
}
function generatorOutput(options: QuestionOption[] = validOptions()) {
  return { stem: 'What is the IRR?', options, difficulty: 'medium' as const };
}

const courseId = new ObjectId();
const loId = new ObjectId();
const themeId = new ObjectId();
const materialId = new ObjectId();

beforeEach(() => {
  jest.mocked(completeJson).mockReset();
  jest.mocked(embedOne).mockReset();
  jest.mocked(search).mockReset();
  jest.mocked(createQuestion).mockReset();
  loFindOne.mockReset();
  loToArray.mockReset();
  materialToArray.mockReset();
  countDocuments.mockReset();
  jest.mocked(defineJob).mockReset();
  jest.mocked(enqueueJob).mockReset();
  jest.mocked(createQuestionGenerationRun).mockReset();
  jest.mocked(failContentRun).mockReset();
  jest.mocked(getContentRun).mockReset();
  jest.mocked(updateContentRun).mockReset();
  jest.mocked(updateContentRun).mockResolvedValue({} as never);
  jest.mocked(platformSettingsCol).mockReturnValue({ findOne: jest.fn(async () => null) } as never);
  jest.mocked(contentRunsCol).mockReturnValue({ aggregate: jest.fn(() => ({ toArray: async () => [] })) } as never);

  jest.mocked(losCol).mockReturnValue({
    findOne: loFindOne,
    find: jest.fn(() => ({ sort: jest.fn(() => ({ toArray: loToArray })), toArray: loToArray })),
  } as never);
  jest.mocked(questionsCol).mockReturnValue({ countDocuments } as never);
  jest.mocked(materialsCol).mockReturnValue({
    find: jest.fn(() => ({ toArray: materialToArray })),
  } as never);

  loFindOne.mockResolvedValue({ _id: loId, courseId, themeId, name: 'Compute IRR' });
  materialToArray.mockResolvedValue([
    {
      _id: materialId,
      courseId,
      status: 'ready',
      assignments: [{ themeId, loId }],
    },
  ]);
  jest.mocked(embedOne).mockResolvedValue([0.1, 0.2, 0.3]);
  jest.mocked(search).mockResolvedValue([
    { id: 'p1', score: 0.9, payload: { materialId: materialId.toHexString(), chunk: 'IRR context' } },
  ]);
  jest.mocked(createQuestion).mockResolvedValue({
    questionId: new ObjectId(),
    version: { _id: new ObjectId() },
  } as never);
});

describe('platform reviewer feature flag (AD-07)', () => {
  it('skips the reviewer call and records disabled reasoning', async () => {
    jest.mocked(platformSettingsCol).mockReturnValue({ findOne: jest.fn(async () => ({
      _id: 'platform',
      models: { generator: 'gen-model', validator: 'val-model', reviewer: 'rev-model', masteryEvaluator: 'mastery-model' },
      costControls: { maxGenerationsPerDay: 100 },
      featureFlags: { reviewerAgent: false, layer2Evaluator: true },
      updatedBy: 'ADMIN', updatedAt: new Date(),
    })) } as never);
    jest.mocked(completeJson)
      .mockResolvedValueOnce(generatorOutput())
      .mockResolvedValueOnce({ valid: true, roleAssessment: 'roles valid' });
    jest.mocked(search).mockResolvedValue([{ payload: { chunk: 'grounding', materialId: materialId.toHexString() } }] as never);
    jest.mocked(createQuestion).mockResolvedValue({ questionId: new ObjectId() } as never);

    await runGenerationPipeline({ courseId, loId, count: 1, byPuid: 'PUID-INSTR' });

    expect(completeJson).toHaveBeenCalledTimes(2);
    expect(createQuestion).toHaveBeenCalledWith(expect.objectContaining({
      agentDecision: {
        decision: 'flag',
        reasoning: 'Reviewer agent disabled at generation time.',
        roleAssessment: 'roles valid',
      },
    }));
  });
});

describe('platform generation cost control (AD-07)', () => {
  it('rejects enqueue before creating a run when the daily limit would be exceeded', async () => {
    jest.mocked(platformSettingsCol).mockReturnValue({ findOne: jest.fn(async () => ({
      _id: 'platform',
      models: { generator: 'g', validator: 'v', reviewer: 'r', masteryEvaluator: 'm' },
      costControls: { maxGenerationsPerDay: 5 },
      featureFlags: { reviewerAgent: true, layer2Evaluator: true },
      updatedBy: 'ADMIN', updatedAt: new Date(),
    })) } as never);
    jest.mocked(contentRunsCol).mockReturnValue({
      aggregate: jest.fn(() => ({ toArray: async () => [{ total: 4 }] })),
    } as never);

    await expect(enqueueGenerationRun({ courseId, loId, count: 2, byPuid: 'PUID-INSTR' }))
      .rejects.toThrow('generation-daily-limit');
    expect(createQuestionGenerationRun).not.toHaveBeenCalled();
  });
});

describe('difficulty calibration prompts', () => {
  it('defines medium difficulty beyond a direct formula substitution', () => {
    const prompt = GENERATOR_PROMPT({
      type: 'mcq',
      loName: 'Calculate present value',
      difficulty: 'medium',
      chunks: [{ text: 'PV and FV formulas' }],
    });
    expect(prompt).toContain('a direct formula substitution is too easy');
  });

  it('asks the reviewer to flag mismatched stated and actual difficulty', () => {
    const prompt = REVIEWER_PROMPT({
      loName: 'Calculate present value',
      question: generatorOutput(),
    });
    expect(prompt).toContain('Difficulty calibration');
  });
});

describe('durable generation runs (P2-0)', () => {
  it('validates the LO, persists a unique run, and enqueues only its runId', async () => {
    const runId = new ObjectId();
    jest.mocked(createQuestionGenerationRun).mockResolvedValue({
      _id: runId,
      result: { createdQuestionIds: [], failures: [] },
    } as never);

    const returned = await enqueueGenerationRun({ courseId, loId, count: 2, byPuid: 'PUID-INSTR' });

    expect(returned).toEqual(runId);
    expect(createQuestionGenerationRun).toHaveBeenCalledWith(
      expect.objectContaining({
        courseId,
        loId,
        count: 2,
        type: 'mcq',
        requestedBy: 'PUID-INSTR',
        models: {
          embedding: 'embed-model',
          generator: 'gen-model',
          validator: 'val-model',
          reviewer: 'rev-model',
        },
        grounding: {
          allowedMaterialIds: [materialId],
          retrievedChunkCount: 0,
        },
      }),
    );
    expect(enqueueJob).toHaveBeenCalledWith('generation.run', { runId: runId.toHexString() });
  });

  it('rejects an LO with no ready assigned material before creating a run', async () => {
    materialToArray.mockResolvedValue([]);

    await expect(
      enqueueGenerationRun({ courseId, loId, count: 2, byPuid: 'PUID-INSTR' }),
    ).rejects.toThrow('generation-no-assigned-materials');

    expect(createQuestionGenerationRun).not.toHaveBeenCalled();
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('keeps a successful Draft and finishes partial when another item fails validation', async () => {
    const runId = new ObjectId();
    const blueprintId = new ObjectId();
    const createdQuestionId = new ObjectId();
    jest.mocked(getContentRun).mockResolvedValue({
      _id: runId,
      courseId,
      kind: 'question-generation',
      requestedBy: 'PUID-INSTR',
      status: 'queued',
      stage: 'queued',
      completedUnits: 0,
      totalUnits: 2,
      revision: 0,
      events: [],
      warnings: [],
      input: {
        loId,
        count: 2,
        type: 'mcq',
        blueprintId,
        models: { embedding: 'embed-model', generator: 'gen-model', validator: 'val-model', reviewer: 'rev-model' },
      },
      result: { createdQuestionIds: [], failures: [] },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    jest
      .mocked(completeJson)
      .mockResolvedValueOnce(generatorOutput())
      .mockResolvedValueOnce(generatorOutput())
      .mockResolvedValueOnce({ roleAssessment: 'roles ok' })
      .mockRejectedValueOnce(new Error('validator unavailable'))
      .mockResolvedValueOnce({ decision: 'pass', reasoning: 'good' });
    jest.mocked(createQuestion).mockResolvedValue({ questionId: createdQuestionId, version: {} } as never);

    registerGenerationJobs();
    const handler = jest.mocked(defineJob).mock.calls[0]![1] as (data: { runId: string }) => Promise<void>;
    await handler({ runId: runId.toHexString() });

    const terminal = jest
      .mocked(updateContentRun)
      .mock.calls.map((call) => call[1])
      .find((update) => update.status === 'partial');
    expect(terminal).toMatchObject({ status: 'partial', completedUnits: 2 });
    expect(terminal?.result).toEqual({
      createdQuestionIds: [createdQuestionId],
      failures: [expect.objectContaining({ item: 1, stage: 'validating', code: 'generation-validation-failed' })],
    });
    expect(jest.mocked(createQuestion).mock.calls[0][0].provenance).toEqual({
      kind: 'generated',
      runId,
      blueprintId,
      item: 0,
    });
    const pinnedCallIndex = jest.mocked(updateContentRun).mock.calls.findIndex((call) =>
      Boolean(call[1].grounding && call[1].grounding.retrievedChunkCount === 0),
    );
    expect(pinnedCallIndex).toBeGreaterThanOrEqual(0);
    expect(jest.mocked(updateContentRun).mock.invocationCallOrder[pinnedCallIndex]!).toBeLessThan(
      jest.mocked(search).mock.invocationCallOrder[0]!,
    );
    expect(failContentRun).not.toHaveBeenCalled();
  });

  it('durably fails a tracked batch before generation when assigned grounding is missing', async () => {
    const runId = new ObjectId();
    materialToArray.mockResolvedValue([]);
    jest.mocked(getContentRun).mockResolvedValue({
      _id: runId,
      courseId,
      kind: 'question-generation',
      requestedBy: 'PUID-INSTR',
      status: 'queued',
      stage: 'queued',
      completedUnits: 0,
      totalUnits: 1,
      revision: 0,
      events: [],
      warnings: [],
      input: {
        loId,
        count: 1,
        type: 'mcq',
        models: { embedding: 'embed-model', generator: 'gen-model', validator: 'val-model', reviewer: 'rev-model' },
      },
      result: { createdQuestionIds: [], failures: [] },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    registerGenerationJobs();
    const handler = jest.mocked(defineJob).mock.calls[0]![1] as (data: { runId: string }) => Promise<void>;
    await handler({ runId: runId.toHexString() });

    expect(failContentRun).toHaveBeenCalledWith(
      runId,
      expect.objectContaining({
        code: 'generation-no-assigned-materials',
        atStage: 'retrieving',
      }),
      { createdQuestionIds: [], failures: [] },
    );
    expect(completeJson).not.toHaveBeenCalled();
    expect(createQuestion).not.toHaveBeenCalled();
  });
});

describe('runGenerationPipeline — three-agent orchestration (IN-Q05/Q10)', () => {
  it('runs generator, validator, reviewer with the three distinct configured models', async () => {
    jest
      .mocked(completeJson)
      .mockResolvedValueOnce(generatorOutput())
      .mockResolvedValueOnce({ roleAssessment: 'each role fits' })
      .mockResolvedValueOnce({ decision: 'pass', reasoning: 'accurate and clear' });

    const ids = await runGenerationPipeline({ courseId, loId, count: 1, byPuid: 'PUID-INSTR' });

    expect(ids).toHaveLength(1);
    expect(completeJson).toHaveBeenCalledTimes(3);
    expect(jest.mocked(completeJson).mock.calls[0][1]?.model).toBe('gen-model');
    expect(jest.mocked(completeJson).mock.calls[1][1]?.model).toBe('val-model');
    expect(jest.mocked(completeJson).mock.calls[2][1]?.model).toBe('rev-model');
  });

  it('strips control characters the generator emits into displayed text', async () => {
    // Seen in two consecutive live runs: `\text{DISC<U+0002>PCT}` in a stem,
    // then a U+001D inside an explanation. The model emits them as \uXXXX
    // escapes so they survive JSON.parse, they are invisible in logs and in the
    // DB shell, and they kill the KaTeX span they land in. Prompt guidance did
    // not stop it recurring, hence a deterministic strip.
    //
    // Built with fromCharCode deliberately: a literal control character in this
    // file would be invisible to the next reader and does not survive editors.
    const STX = String.fromCharCode(0x02);
    const GS = String.fromCharCode(0x1d);

    const dirty = generatorOutput();
    dirty.stem = `What is the ${STX}IRR?`;
    dirty.options[0] = {
      ...dirty.options[0],
      text: `A${GS}B`,
      // The newline must SURVIVE — explanations legitimately use them.
      explanation: `line one\nline${STX} two`,
    };

    jest
      .mocked(completeJson)
      .mockResolvedValueOnce(dirty)
      .mockResolvedValueOnce({ roleAssessment: 'roles ok' })
      .mockResolvedValueOnce({ decision: 'pass', reasoning: 'fine' });

    await runGenerationPipeline({ courseId, loId, count: 1, byPuid: 'PUID-INSTR' });

    const arg = jest.mocked(createQuestion).mock.calls[0][0];
    expect(arg.stem).toBe('What is the IRR?');
    expect(arg.options[0].text).toBe('AB');
    expect(arg.options[0].explanation).toBe('line one\nline two');
  });

  it('grounds retrieval in the course collection and records sourceRefs + agentDecision', async () => {
    jest
      .mocked(completeJson)
      .mockResolvedValueOnce(generatorOutput())
      .mockResolvedValueOnce({ roleAssessment: 'roles ok' })
      .mockResolvedValueOnce({ decision: 'flag', reasoning: 'double-check the rounding' });

    await runGenerationPipeline({ courseId, loId, count: 1, prompt: 'focus on IRR', byPuid: 'PUID-INSTR' });

    expect(search).toHaveBeenCalledWith('course-abc', [0.1, 0.2, 0.3], 6, {
      must: [{ key: 'materialId', match: { any: [materialId.toHexString()] } }],
    });
    const arg = jest.mocked(createQuestion).mock.calls[0][0];
    expect(arg.courseId).toEqual(courseId);
    expect(arg.loIds).toEqual([loId]);
    expect(arg.themeIds).toEqual([themeId]);
    expect(arg.createdBy).toBe('PUID-INSTR');
    expect(arg.agentDecision).toEqual({
      decision: 'flag',
      reasoning: 'double-check the rounding',
      roleAssessment: 'roles ok',
    });
    expect(arg.sourceRefs).toEqual([{ materialId, chunk: 'IRR context' }]);
  });

  it('still inserts a Draft when the reviewer REJECTS (nothing is auto-discarded)', async () => {
    jest
      .mocked(completeJson)
      .mockResolvedValueOnce(generatorOutput())
      .mockResolvedValueOnce({ roleAssessment: 'roles ok' })
      .mockResolvedValueOnce({ decision: 'reject', reasoning: 'factually wrong' });

    const ids = await runGenerationPipeline({ courseId, loId, count: 1, byPuid: 'PUID-INSTR' });

    expect(ids).toHaveLength(1);
    expect(createQuestion).toHaveBeenCalledTimes(1);
    expect(jest.mocked(createQuestion).mock.calls[0][0].agentDecision?.decision).toBe('reject');
    // createQuestion itself sets state:'draft'; the pipeline must never publish.
  });

  it('retries the generator once on invalid options, then succeeds', async () => {
    const bad = generatorOutput([
      { key: 'A', text: 'x', role: 'correct', explanation: '' },
      { key: 'B', text: 'y', role: 'correct', explanation: '' }, // two correct -> invalid
    ]);
    jest
      .mocked(completeJson)
      .mockResolvedValueOnce(bad) // generator attempt 1 (invalid)
      .mockResolvedValueOnce(generatorOutput()) // generator attempt 2 (valid)
      .mockResolvedValueOnce({ roleAssessment: 'roles ok' })
      .mockResolvedValueOnce({ decision: 'pass', reasoning: 'ok' });

    const ids = await runGenerationPipeline({ courseId, loId, count: 1, byPuid: 'PUID-INSTR' });

    expect(ids).toHaveLength(1);
    expect(createQuestion).toHaveBeenCalledTimes(1);
  });

  it('skips the question (no insert) and warns when options are invalid twice', async () => {
    const bad = generatorOutput([{ key: 'A', text: 'x', role: 'correct', explanation: '' }]); // 1 option -> invalid
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.mocked(completeJson).mockResolvedValueOnce(bad).mockResolvedValueOnce(bad);

    const ids = await runGenerationPipeline({ courseId, loId, count: 1, byPuid: 'PUID-INSTR' });

    expect(ids).toHaveLength(0);
    expect(createQuestion).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('allows a ready material assigned to the LO theme without a narrower loId', async () => {
    materialToArray.mockResolvedValue([
      { _id: materialId, courseId, status: 'ready', assignments: [{ themeId }] },
    ]);
    jest
      .mocked(completeJson)
      .mockResolvedValueOnce(generatorOutput())
      .mockResolvedValueOnce({ roleAssessment: 'roles ok' })
      .mockResolvedValueOnce({ decision: 'pass', reasoning: 'ok' });

    await runGenerationPipeline({ courseId, loId, count: 1, byPuid: 'PUID-INSTR' });

    expect(search).toHaveBeenCalledWith('course-abc', [0.1, 0.2, 0.3], 6, {
      must: [{ key: 'materialId', match: { any: [materialId.toHexString()] } }],
    });
  });

  it('excludes ready materials assigned only to a sibling LO from grounding and sourceRefs', async () => {
    const siblingMaterialId = new ObjectId();
    const siblingLoId = new ObjectId();
    materialToArray.mockResolvedValue([
      { _id: materialId, courseId, status: 'ready', assignments: [{ themeId, loId }] },
      {
        _id: siblingMaterialId,
        courseId,
        status: 'ready',
        assignments: [{ themeId, loId: siblingLoId }],
      },
    ]);
    jest.mocked(search).mockResolvedValue([
      {
        id: 'sibling',
        score: 0.99,
        payload: { materialId: siblingMaterialId.toHexString(), chunk: 'wrong LO' },
      },
      { id: 'allowed', score: 0.8, payload: { materialId: materialId.toHexString(), chunk: 'right LO' } },
    ]);
    jest
      .mocked(completeJson)
      .mockResolvedValueOnce(generatorOutput())
      .mockResolvedValueOnce({ roleAssessment: 'roles ok' })
      .mockResolvedValueOnce({ decision: 'pass', reasoning: 'ok' });

    await runGenerationPipeline({ courseId, loId, count: 1, byPuid: 'PUID-INSTR' });

    expect(search).toHaveBeenCalledWith('course-abc', [0.1, 0.2, 0.3], 6, {
      must: [{ key: 'materialId', match: { any: [materialId.toHexString()] } }],
    });
    expect(jest.mocked(createQuestion).mock.calls[0][0].sourceRefs).toEqual([
      { materialId, chunk: 'right LO' },
    ]);
  });

  it('fails before embedding or LLM calls when no ready material is assigned', async () => {
    materialToArray.mockResolvedValue([
      {
        _id: new ObjectId(),
        courseId,
        status: 'ready',
        assignments: [{ themeId, loId: new ObjectId() }],
      },
    ]);

    await expect(
      runGenerationPipeline({ courseId, loId, count: 1, byPuid: 'PUID-INSTR' }),
    ).rejects.toThrow('generation-no-assigned-materials');

    expect(embedOne).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
    expect(completeJson).not.toHaveBeenCalled();
    expect(createQuestion).not.toHaveBeenCalled();
  });

  it('surfaces retrieval failure without falling back to ungrounded generation', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.mocked(search).mockRejectedValue(new Error('qdrant down'));

    await expect(
      runGenerationPipeline({ courseId, loId, count: 1, byPuid: 'PUID-INSTR' }),
    ).rejects.toThrow('generation-retrieval-failed');

    expect(completeJson).not.toHaveBeenCalled();
    expect(createQuestion).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('surfaces zero filtered hits without generating from the LO name alone', async () => {
    jest.mocked(search).mockResolvedValue([]);

    await expect(
      runGenerationPipeline({ courseId, loId, count: 1, byPuid: 'PUID-INSTR' }),
    ).rejects.toThrow('generation-no-grounding');

    expect(completeJson).not.toHaveBeenCalled();
    expect(createQuestion).not.toHaveBeenCalled();
  });
});

describe('preseedingProgress — per-LO approved/reviewed/unapproved counts (IN-Q10)', () => {
  it('returns approved, reviewed, and actionable unapproved counts per LO with target 5', async () => {
    const lo1 = new ObjectId();
    const lo2 = new ObjectId();
    loToArray.mockResolvedValue([
      { _id: lo1, courseId, name: 'LO one', order: 1 },
      { _id: lo2, courseId, name: 'LO two', order: 2 },
    ]);
    countDocuments.mockImplementation(async (filter: {
      loIds: ObjectId;
      state: string | { $in: string[] };
    }) => {
      if (typeof filter.state === 'object') {
        expect(filter.state.$in).toEqual(['draft', 'pending-review', 'reviewed', 'paused']);
        return filter.loIds.equals(lo1) ? 6 : 3;
      }
      if (filter.loIds.equals(lo1)) return filter.state === 'approved' ? 4 : 2;
      if (filter.loIds.equals(lo2)) return filter.state === 'approved' ? 0 : 1;
      return 0;
    });

    const result = await preseedingProgress(courseId);

    expect(result).toEqual([
      { loId: lo1, loName: 'LO one', approved: 4, reviewed: 2, unapproved: 6, target: 5 },
      { loId: lo2, loName: 'LO two', approved: 0, reviewed: 1, unapproved: 3, target: 5 },
    ]);

    expect(countDocuments).toHaveBeenCalledTimes(6);
  });
});
