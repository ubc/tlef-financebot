// Unit test — generation.service (PRD §9.1, IN-Q10): enqueue validation, the
// queued `generation.run` job (which runs question-generation/pipeline.ts's
// two-call generate-then-check pipeline), the private-assessment adapter, and
// the pre-seeding progress rollup. llm/qdrant/embeddings/questions.service/
// collections/materials are all MOCKED — this pins the ORCHESTRATION (grounding,
// which model each call uses, that every decision is persisted as a Draft,
// run bookkeeping, per-LO counts), not real model output.
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
  examBuildRunsCol: jest.fn(() => ({ find: jest.fn(() => ({ toArray: async () => [] })) })),
  themesCol: jest.fn(),
  coursesCol: jest.fn(() => ({ findOne: jest.fn(async () => null) })),
  platformSettingsCol: jest.fn(() => ({ findOne: jest.fn(async () => null) })),
}));
jest.mock('../../server/src/services/content-runs.service', () => ({
  assertContentRunActive: jest.fn(),
  createQuestionGenerationRun: jest.fn(),
  failContentRun: jest.fn(),
  getContentRun: jest.fn(),
  updateContentRun: jest.fn(),
}));

jest.mock('../../server/src/services/question-similarity.service', () => ({ refreshQuestionSimilarity: jest.fn(async () => undefined) }));
jest.mock('../../server/src/services/question-generation/existing-stems', () => ({ loadExistingLoStems: jest.fn(async () => []), ACTIVE_QUESTION_STATES: [] }));

import { ObjectId } from 'mongodb';
import {
  enqueueGenerationRun,
  GENERATOR_PROMPT,
  HARDNESS_MOVE_DECLARATION,
  HARDNESS_MOVES,
  preseedingProgress,
  registerGenerationJobs,
  sanitizeGenerated,
  type GenerationInput,
} from '../../server/src/services/generation.service';
import { generatePrivateAssessmentQuestion, runQuestionGeneration } from '../../server/src/services/question-generation/pipeline';
import { completeJson } from '../../server/src/components/genai/llm';
import { embedOne } from '../../server/src/components/genai/embeddings';
import { search } from '../../server/src/components/qdrant';
import { createQuestion } from '../../server/src/services/questions.service';
import { contentRunsCol, coursesCol, losCol, materialsCol, platformSettingsCol, questionsCol, themesCol } from '../../server/src/components/mongodb/collections';
import { defineJob, enqueueJob } from '../../server/src/components/jobs';
import {
  assertContentRunActive,
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

const MODELS = {
  embedding: 'embed-model', generator: { model: 'gen-model' }, validator: { model: 'val-model' },
  reviewer: { model: 'rev-model' }, masteryEvaluator: { model: 'mastery-model' }, utility: { model: 'util-model' },
} as never;
/** The queued pipeline, called directly with a resolved model snapshot. It
 * records failures on the run rather than throwing. */
const runPipeline = (input: Omit<GenerationInput, 'models'>) => runQuestionGeneration({ ...input, models: MODELS }, new ObjectId());
const check = (decision = 'pass', reasoning = 'ok', extra: Record<string, unknown> = {}) =>
  ({ decision, reasoning, roleAssessment: 'roles ok', suggestions: [], ...extra });
/** The terminal failure the run records when nothing could be generated. */
const runFailure = () => jest.mocked(failContentRun).mock.calls[0]?.[1];

it('does not accept model-authored verification, source or approval fields as generation output', () => {
  const input = { ...generatorOutput(), verification: { status: 'verified', evaluatorVersion: 999 },
    sourceRefs: [{ chunk: 'Invented provenance' }], agentDecision: { decision: 'pass' },
    options: validOptions().map(option => ({ ...option, verified: true, score: 1 })) };
  const clean = sanitizeGenerated(input);
  expect(clean).toEqual(generatorOutput());
  expect(clean).not.toHaveProperty('verification');
  expect(clean.options.every(option => !('verified' in option) && !('score' in option))).toBe(true);
});

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
  jest.mocked(assertContentRunActive).mockReset();
  jest.mocked(assertContentRunActive).mockResolvedValue(undefined);
  jest.mocked(platformSettingsCol).mockReturnValue({ findOne: jest.fn(async () => null) } as never);
  jest.mocked(contentRunsCol).mockReturnValue({ aggregate: jest.fn(() => ({ toArray: async () => [] })) } as never);
  // No Themes by default: nothing is held back (theme-release.ts). R7 tests
  // that need earlier-objective Themes override this.
  jest.mocked(themesCol).mockReturnValue({ find: jest.fn(() => ({ toArray: async () => [] })) } as never);

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
describe('multi-LO generation (secondary objectives)', () => {
  const secondaryLoId = new ObjectId();
  const secondaryThemeId = new ObjectId();
  const secondaryMaterialId = new ObjectId();

  /** A primary LO with its own material, plus one secondary objective in
   * another theme with its own ready material. The first search answers the
   * primary query, the second the secondary one. */
  function wireSecondary(): void {
    loFindOne.mockResolvedValue({ _id: loId, courseId, themeId, name: 'Compute IRR', order: 2 });
    loToArray.mockResolvedValue([
      { _id: secondaryLoId, courseId, themeId: secondaryThemeId, name: 'Present value', order: 1 },
    ]);
    materialToArray.mockResolvedValue([
      { _id: materialId, courseId, status: 'ready', assignments: [{ themeId, loId }] },
      { _id: secondaryMaterialId, courseId, status: 'ready', assignments: [{ themeId: secondaryThemeId, loId: secondaryLoId }] },
    ]);
    jest.mocked(search)
      .mockResolvedValueOnce([
        { payload: { materialId: materialId.toHexString(), chunk: 'IRR material' } },
      ] as never)
      .mockResolvedValueOnce([
        { payload: { materialId: secondaryMaterialId.toHexString(), chunk: 'PV material' } },
      ] as never);
  }

  it('grounds each secondary objective from its own materials, tells both calls, and tags the question to every LO', async () => {
    wireSecondary();
    jest.mocked(completeJson)
      .mockResolvedValueOnce(generatorOutput())
      .mockResolvedValueOnce(check('pass', 'PV genuinely required'));

    await runPipeline({
      courseId, loId, secondaryLoIds: [secondaryLoId], count: 1, difficulty: 'medium', byPuid: 'PUID-INSTR',
    });

    // Primary keeps its plain budget; the secondary gets its own filtered search.
    expect(search).toHaveBeenCalledTimes(2);
    expect(jest.mocked(search).mock.calls[0]?.[2]).toBe(6);
    expect(jest.mocked(search).mock.calls[1]?.[2]).toBe(2);
    expect(jest.mocked(search).mock.calls[1]?.[3]).toEqual({
      must: [{ key: 'materialId', match: { any: [secondaryMaterialId.toHexString()] } }],
    });
    // The secondary query is the secondary objective's own name.
    expect(jest.mocked(embedOne).mock.calls[1]?.[0]).toBe('Present value');

    const [generatorPrompt, checkerPrompt] = jest.mocked(completeJson).mock.calls.map((call) => call[0] as string);
    expect(generatorPrompt).toContain('THIS QUESTION MUST INTEGRATE A SECOND LEARNING OBJECTIVE');
    expect(generatorPrompt).toContain('  - "Present value"');
    expect(generatorPrompt).toContain('Material for the learning objective "Present value"');
    expect(checkerPrompt).toContain('Present value');

    expect(createQuestion).toHaveBeenCalledWith(expect.objectContaining({
      loIds: [loId, secondaryLoId],
      themeIds: [themeId, secondaryThemeId],
    }));
  });

  it('at target hard, chosen secondaries replace the automatic earlier-objective sweep', async () => {
    wireSecondary();
    jest.mocked(completeJson)
      .mockResolvedValueOnce({ ...generatorOutput(), difficulty: 'hard', hardnessMove: 'reinvestment chain: PV then IRR' })
      .mockResolvedValueOnce(check());

    await runPipeline({
      courseId, loId, secondaryLoIds: [secondaryLoId], count: 1, difficulty: 'hard', byPuid: 'PUID-INSTR',
    });

    // No third search for the earlier-objective pool, and the primary budget
    // stays at the plain 6 (the split only applies to the automatic sweep).
    expect(search).toHaveBeenCalledTimes(2);
    expect(jest.mocked(search).mock.calls[0]?.[2]).toBe(6);
    const generatorPrompt = jest.mocked(completeJson).mock.calls[0]?.[0] as string;
    expect(generatorPrompt).not.toContain('Supporting material from an EARLIER learning objective');
    expect(generatorPrompt).toContain('hardness move chains should come from one of the listed objectives');
  });

  it('enqueue rejects a repeat of the primary, an unknown objective, and one with no ready material', async () => {
    await expect(enqueueGenerationRun({ courseId, loId, secondaryLoIds: [loId], count: 1, byPuid: 'PUID-INSTR' }))
      .rejects.toThrow('generation-secondary-lo-duplicate');

    loToArray.mockResolvedValue([]);
    await expect(enqueueGenerationRun({ courseId, loId, secondaryLoIds: [secondaryLoId], count: 1, byPuid: 'PUID-INSTR' }))
      .rejects.toThrow('lo-not-found');

    // The objective exists, but only the primary's material is assigned.
    loToArray.mockResolvedValue([
      { _id: secondaryLoId, courseId, themeId: secondaryThemeId, name: 'Present value', order: 1 },
    ]);
    await expect(enqueueGenerationRun({ courseId, loId, secondaryLoIds: [secondaryLoId], count: 1, byPuid: 'PUID-INSTR' }))
      .rejects.toThrow('generation-secondary-lo-no-materials');
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


  it('widens grounding with earlier-objective material ONLY at target hard (R7)', async () => {
    const earlierLoId = new ObjectId();
    const supportMaterialId = new ObjectId();
    jest.mocked(themesCol).mockReturnValue({
      find: jest.fn(() => ({ toArray: async () => [{ _id: themeId, courseId, order: 1 }] })),
    } as never);
    loFindOne.mockResolvedValue({ _id: loId, courseId, themeId, name: 'Compute IRR', order: 2 });
    loToArray.mockResolvedValue([
      { _id: loId, courseId, themeId, name: 'Compute IRR', order: 2 },
      { _id: earlierLoId, courseId, themeId, name: 'Present value', order: 1 },
    ]);
    materialToArray.mockResolvedValue([
      { _id: materialId, courseId, status: 'ready', assignments: [{ themeId, loId }] },
      { _id: supportMaterialId, courseId, status: 'ready', assignments: [{ themeId, loId: earlierLoId }] },
    ]);
    jest.mocked(search)
      .mockResolvedValueOnce([
        { payload: { materialId: materialId.toHexString(), chunk: 'IRR material' } },
      ] as never)
      .mockResolvedValueOnce([
        { payload: { materialId: supportMaterialId.toHexString(), chunk: 'PV material' } },
      ] as never);
    jest.mocked(completeJson)
      .mockResolvedValueOnce({ ...generatorOutput(), difficulty: 'hard', hardnessMove: 'off-cycle timing: mid-loan valuation' })
      .mockResolvedValueOnce(check());

    await runPipeline({ courseId, loId, count: 1, difficulty: 'hard', byPuid: 'PUID-INSTR' });

    // Two searches: the LO keeps its full budget, the earlier-objective pool
    // comes on top — 8 chunks total on a widened hard target.
    expect(search).toHaveBeenCalledTimes(2);
    expect(jest.mocked(search).mock.calls[0]?.[2]).toBe(6);
    expect(jest.mocked(search).mock.calls[1]?.[2]).toBe(2);
    expect(jest.mocked(search).mock.calls[1]?.[3]).toEqual({
      must: [{ key: 'materialId', match: { any: [supportMaterialId.toHexString()] } }],
    });
    // The generator sees the labeled support and the connector tying it to the
    // moves menu; the supporting chunk is honest provenance in sourceRefs.
    const generatorPrompt = jest.mocked(completeJson).mock.calls[0]?.[0] as string;
    expect(generatorPrompt).toContain('Supporting material from an EARLIER learning objective');
    expect(generatorPrompt).toContain('a hardness move can CHAIN one of');
    expect(createQuestion).toHaveBeenCalledWith(expect.objectContaining({
      sourceRefs: expect.arrayContaining([
        expect.objectContaining({ materialId: supportMaterialId }),
      ]),
    }));
  });

  it('keeps the plain single retrieval at medium, and at hard with no earlier material', async () => {
    jest.mocked(themesCol).mockReturnValue({
      find: jest.fn(() => ({ toArray: async () => [{ _id: themeId, courseId, order: 1 }] })),
    } as never);
    loFindOne.mockResolvedValue({ _id: loId, courseId, themeId, name: 'Compute IRR', order: 1 });
    loToArray.mockResolvedValue([{ _id: loId, courseId, themeId, name: 'Compute IRR', order: 1 }]);
    const runOnce = async (difficulty: 'medium' | 'hard') => {
      jest.mocked(search).mockClear();
      jest.mocked(completeJson)
        .mockResolvedValueOnce({ ...generatorOutput(), hardnessMove: 'regime change: two-stage growth' })
        .mockResolvedValueOnce(check());
      await runPipeline({ courseId, loId, count: 1, difficulty, byPuid: 'PUID-INSTR' });
      expect(search).toHaveBeenCalledTimes(1);
      expect(jest.mocked(search).mock.calls[0]?.[2]).toBe(6);
    };
    // Medium never widens, whatever the course looks like.
    await runOnce('medium');
    // Hard on the course's FIRST LO has no earlier pool and reverts to plain.
    await runOnce('hard');
  });

  it('assigns a distinct move to every question of a hard batch, none at medium (exp 26)', async () => {
    jest.mocked(themesCol).mockReturnValue({
      find: jest.fn(() => ({ toArray: async () => [{ _id: themeId, courseId, order: 1 }] })),
    } as never);
    loFindOne.mockResolvedValue({ _id: loId, courseId, themeId, name: 'Compute IRR', order: 1 });
    loToArray.mockResolvedValue([{ _id: loId, courseId, themeId, name: 'Compute IRR', order: 1 }]);
    const hardGen = () => ({ ...generatorOutput(), difficulty: 'hard', hardnessMove: 'as assigned' });
    jest.mocked(completeJson)
      .mockResolvedValueOnce(hardGen())
      .mockResolvedValueOnce(check())
      .mockResolvedValueOnce(hardGen())
      .mockResolvedValueOnce(check());

    await runPipeline({ courseId, loId, count: 2, difficulty: 'hard', byPuid: 'PUID-INSTR' });

    const generatorPrompts = jest.mocked(completeJson).mock.calls
      .map((call) => String(call[0]))
      .filter((prompt) => prompt.includes('HARDNESS MOVE HAS BEEN ASSIGNED'));
    expect(generatorPrompts).toHaveLength(2);
    // Rotation: consecutive questions in one batch carry DIFFERENT moves.
    const moveOf = (prompt: string) =>
      prompt.split('HAS BEEN ASSIGNED for this question. Implement EXACTLY this move:')[1]?.split('\n')[1];
    expect(moveOf(generatorPrompts[0]!)).toBeTruthy();
    expect(moveOf(generatorPrompts[0]!)).not.toEqual(moveOf(generatorPrompts[1]!));

    // Medium never assigns.
    jest.mocked(completeJson).mockClear();
    jest.mocked(completeJson)
      .mockResolvedValueOnce(generatorOutput())
      .mockResolvedValueOnce(check());
    await runPipeline({ courseId, loId, count: 1, difficulty: 'medium', byPuid: 'PUID-INSTR' });
    expect(String(jest.mocked(completeJson).mock.calls[0]?.[0])).not.toContain('HAS BEEN ASSIGNED');
  });

  it('an explicit instructor move applies to the whole batch and unknown ids are rejected at enqueue', async () => {
    jest.mocked(themesCol).mockReturnValue({
      find: jest.fn(() => ({ toArray: async () => [{ _id: themeId, courseId, order: 1 }] })),
    } as never);
    loFindOne.mockResolvedValue({ _id: loId, courseId, themeId, name: 'Compute IRR', order: 1 });
    loToArray.mockResolvedValue([{ _id: loId, courseId, themeId, name: 'Compute IRR', order: 1 }]);
    const hardGen = () => ({ ...generatorOutput(), difficulty: 'hard', hardnessMove: 'as assigned' });
    jest.mocked(completeJson)
      .mockResolvedValueOnce(hardGen())
      .mockResolvedValueOnce(check())
      .mockResolvedValueOnce(hardGen())
      .mockResolvedValueOnce(check());

    await runPipeline({
      courseId, loId, count: 2, difficulty: 'hard', hardnessMove: 'regime-change', byPuid: 'PUID-INSTR',
    });
    const prompts = jest.mocked(completeJson).mock.calls
      .map((call) => String(call[0]))
      .filter((prompt) => prompt.includes('HAS BEEN ASSIGNED'));
    expect(prompts).toHaveLength(2);
    for (const prompt of prompts) expect(prompt).toContain('regime change: switch a growth rate');

    // Enqueue validation: unknown id and non-hard difficulty both refuse
    // before a durable run is created.
    await expect(enqueueGenerationRun({
      courseId, loId, count: 1, difficulty: 'hard', hardnessMove: 'nonsense', byPuid: 'PUID-INSTR',
    })).rejects.toThrow('generation-unknown-hardness-move');
    await expect(enqueueGenerationRun({
      courseId, loId, count: 1, difficulty: 'medium', hardnessMove: 'regime-change', byPuid: 'PUID-INSTR',
    })).rejects.toThrow('generation-hardness-move-requires-hard');
  });

  it('persists the kind contract on the run so the async job honours it (batch planner, 2026-08-23)', async () => {
    jest.mocked(createQuestionGenerationRun).mockResolvedValue({ _id: new ObjectId() } as never);
    await enqueueGenerationRun({ courseId, loId, count: 1, kind: 'calculation', byPuid: 'PUID-INSTR' });
    expect(createQuestionGenerationRun).toHaveBeenCalledWith(expect.objectContaining({ kind: 'calculation' }));
  });

  it('demands the declaration in the generator prompt ONLY at hard', () => {
    const build = (difficulty: 'medium' | 'hard') => GENERATOR_PROMPT({
      type: 'mcq', loName: 'Compute IRR', difficulty, chunks: [{ text: 'IRR material' }],
    });
    expect(build('hard')).toContain(HARDNESS_MOVE_DECLARATION);
    expect(build('medium')).not.toContain('DECLARE YOUR MOVE');
  });

  it('replaces the moves catalog with compact framing when a move is assigned', () => {
    const assigned = GENERATOR_PROMPT({
      type: 'mcq', loName: 'Compute IRR', difficulty: 'hard',
      chunks: [{ text: 'IRR material' }],
      assignedMove: 'regime change: switch a growth rate partway',
    });
    expect(assigned).toContain('WHAT MAKES A QUESTION HARD');
    expect(assigned).toContain('HAS BEEN ASSIGNED');
    expect(assigned).not.toContain('HOW TO MAKE IT HARD');
    // The escape hatch's referent survives the catalog's removal.
    expect(assigned).toContain('two related-but-easily-confused rules');
    // Without an assignment (harness/API callers) the full catalog remains.
    const unassigned = GENERATOR_PROMPT({
      type: 'mcq', loName: 'Compute IRR', difficulty: 'hard', chunks: [{ text: 'IRR material' }],
    });
    expect(unassigned).toContain('HOW TO MAKE IT HARD');
    expect(unassigned).not.toContain('WHAT MAKES A QUESTION HARD');
  });

  it('gives the generator the hardness-moves menu ONLY at target hard', () => {
    // The block is conditional so easy/medium calls pay no tokens for it — the
    // experiment-2 lesson that global prompt additions are not free.
    const build = (difficulty: 'easy' | 'medium' | 'hard') => GENERATOR_PROMPT({
      type: 'mcq',
      loName: 'Calculate present value',
      difficulty,
      chunks: [{ text: 'PV and FV formulas' }],
    });
    expect(build('hard')).toContain(HARDNESS_MOVES);
    expect(build('medium')).not.toContain('HOW TO MAKE IT HARD');
    expect(build('easy')).not.toContain('HOW TO MAKE IT HARD');
  });
});

describe('durable generation runs (P2-0)', () => {
  it('validates the LO, persists a unique run, and enqueues only its runId', async () => {
    const runId = new ObjectId();
    jest.mocked(coursesCol).mockReturnValueOnce({ findOne: async () => ({
      llmModelSettings: { revision: 1, overrides: { generator: { model: 'course-generator' } } },
    }) } as never);
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
          generator: 'course-generator',
          reviewer: 'rev-model',
        },
        modelSnapshot: expect.objectContaining({ generator: { model: 'course-generator', modelSource: 'override' } }),
        grounding: {
          allowedMaterialIds: [materialId],
          retrievedChunkCount: 0,
          // Plain LO assignment is NOT an instructor pin — R7 may widen.
          pinned: false,
        },
      }),
    );
    expect(enqueueJob).toHaveBeenCalledWith('generation.run', { runId: runId.toHexString() });
  });

  it('records a prompt @mention as an instructor pin on the run', async () => {
    const runId = new ObjectId();
    jest.mocked(createQuestionGenerationRun).mockResolvedValue({ _id: runId } as never);
    materialToArray.mockResolvedValue([
      { _id: materialId, courseId, name: 'lecture-3.pdf', status: 'ready', assignments: [{ themeId, loId }] },
    ]);

    await enqueueGenerationRun({ courseId, loId, count: 1, prompt: 'Use @lecture-3.pdf only', byPuid: 'PUID-INSTR' });

    expect(createQuestionGenerationRun).toHaveBeenCalledWith(
      expect.objectContaining({ grounding: expect.objectContaining({ pinned: true }) }),
    );
  });

  it('rejects an LO with no ready assigned material before creating a run', async () => {
    materialToArray.mockResolvedValue([]);

    await expect(
      enqueueGenerationRun({ courseId, loId, count: 2, byPuid: 'PUID-INSTR' }),
    ).rejects.toThrow('generation-no-assigned-materials');

    expect(createQuestionGenerationRun).not.toHaveBeenCalled();
    expect(enqueueJob).not.toHaveBeenCalled();
  });


  /** A queued run record as the job reads it; `input` overrides merge in. */
  function queuedRun(input: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
    return {
      _id: new ObjectId(), courseId, kind: 'question-generation', requestedBy: 'PUID-INSTR',
      status: 'queued', stage: 'queued', completedUnits: 0, totalUnits: 1, revision: 0, events: [], warnings: [],
      input: { loId, count: 1, type: 'mcq',
        models: { embedding: 'embed-model', generator: 'gen-model', validator: 'val-model', reviewer: 'rev-model' }, ...input },
      result: { createdQuestionIds: [], failures: [] }, createdAt: new Date(), updatedAt: new Date(), ...extra,
    };
  }
  function jobHandler() {
    registerGenerationJobs();
    return jest.mocked(defineJob).mock.calls[0]![1] as (data: { runId: string }) => Promise<void>;
  }

  it('the job runs the two-call pipeline at the effort the admin configured for each model (2026-08-23)', async () => {
    jest.mocked(platformSettingsCol).mockReturnValue({ findOne: jest.fn(async () => ({
      _id: 'platform',
      models: {
        generator: { model: 'gen-model', modelSource: 'override', reasoningEffort: 'xhigh' },
        validator: { model: 'val-model' },
        reviewer: { model: 'rev-model', modelSource: 'override', reasoningEffort: 'xhigh' },
        masteryEvaluator: { model: 'mastery-model' }, utility: { model: 'util-model' },
      },
      costControls: { maxGenerationsPerDay: 100 },
      featureFlags: { reviewerAgent: true, layer2Evaluator: true, retryOnReject: false },
      updatedBy: 'ADMIN', updatedAt: new Date(),
    })) } as never);
    jest.mocked(themesCol).mockReturnValue({
      find: jest.fn(() => ({ toArray: async () => [{ _id: themeId, courseId, order: 1 }] })),
    } as never);
    loFindOne.mockResolvedValue({ _id: loId, courseId, themeId, name: 'Compute IRR', order: 1 });
    loToArray.mockResolvedValue([{ _id: loId, courseId, themeId, name: 'Compute IRR', order: 1 }]);
    // The record carries ids only — the effort must come from the settings.
    jest.mocked(getContentRun).mockResolvedValue(queuedRun({ difficulty: 'medium' },
      { grounding: { allowedMaterialIds: [materialId], retrievedChunkCount: 0, pinned: false } }) as never);
    jest.mocked(completeJson).mockResolvedValueOnce(generatorOutput()).mockResolvedValueOnce(check());
    jest.mocked(createQuestion).mockResolvedValue({ questionId: new ObjectId(), version: {} } as never);
    await jobHandler()({ runId: new ObjectId().toHexString() });

    const calls = jest.mocked(completeJson).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]?.[1]).toMatchObject({ model: 'gen-model', reasoningEffort: 'xhigh' });
    expect(calls[1]?.[1]).toMatchObject({ model: 'rev-model', reasoningEffort: 'xhigh' });
    // And the run record names both models, where the instructor can see it.
    const retrieving = jest.mocked(updateContentRun).mock.calls.map((c) => c[1]).find((u) => /Retrieving/.test(String(u.message)));
    expect(String(retrieving?.message)).toContain('generator gen-model, checker rev-model');
  });

  it('the job widens a hard run from the recorded pin FLAG, not from the frozen ids (R7 fix)', async () => {
    // Found 2026-08-22 on a live hard batch: the job hands the run's frozen
    // allowedMaterialIds back through pinnedMaterialIds, so a widen test on
    // "pinnedMaterialIds === undefined" was false on every tracked run and R7
    // never fired in production (6 chunks where 8 were due).
    const earlierLoId = new ObjectId();
    const supportMaterialId = new ObjectId();
    jest.mocked(themesCol).mockReturnValue({
      find: jest.fn(() => ({ toArray: async () => [{ _id: themeId, courseId, order: 1 }] })),
    } as never);
    loFindOne.mockResolvedValue({ _id: loId, courseId, themeId, name: 'Compute WACC', order: 2 });
    loToArray.mockResolvedValue([
      { _id: loId, courseId, themeId, name: 'Compute WACC', order: 2 },
      { _id: earlierLoId, courseId, themeId, name: 'CAPM', order: 1 },
    ]);
    materialToArray.mockResolvedValue([
      { _id: materialId, courseId, status: 'ready', assignments: [{ themeId, loId }] },
      { _id: supportMaterialId, courseId, status: 'ready', assignments: [{ themeId, loId: earlierLoId }] },
    ]);
    // Every run carries its frozen resolved ids; only `pinned` says whether
    // the instructor constrained them.
    const runFor = (pinned: boolean) => queuedRun({ difficulty: 'hard' },
      { grounding: { allowedMaterialIds: [materialId], retrievedChunkCount: 0, pinned } });
    const hardGen = () => ({ ...generatorOutput(), difficulty: 'hard', hardnessMove: 'as assigned' });
    const handler = jobHandler();
    jest.mocked(createQuestion).mockResolvedValue({ questionId: new ObjectId(), version: {} } as never);

    // Not pinned: primary search + supporting search.
    jest.mocked(getContentRun).mockResolvedValue(runFor(false) as never);
    jest.mocked(search).mockClear();
    jest.mocked(search)
      .mockResolvedValueOnce([{ payload: { materialId: materialId.toHexString(), chunk: 'WACC material' } }] as never)
      .mockResolvedValueOnce([{ payload: { materialId: supportMaterialId.toHexString(), chunk: 'CAPM material' } }] as never);
    jest.mocked(completeJson).mockResolvedValueOnce(hardGen()).mockResolvedValueOnce(check());
    await handler({ runId: new ObjectId().toHexString() });
    expect(search).toHaveBeenCalledTimes(2);
    expect(jest.mocked(search).mock.calls[1]?.[3]).toEqual({
      must: [{ key: 'materialId', match: { any: [supportMaterialId.toHexString()] } }],
    });

    // Pinned by the instructor: the frozen ids are exactly the set — one search.
    jest.mocked(getContentRun).mockResolvedValue(runFor(true) as never);
    jest.mocked(search).mockClear();
    jest.mocked(search).mockResolvedValue([{ payload: { materialId: materialId.toHexString(), chunk: 'WACC material' } }] as never);
    jest.mocked(completeJson).mockResolvedValueOnce(hardGen()).mockResolvedValueOnce(check());
    await handler({ runId: new ObjectId().toHexString() });
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('keeps a successful Draft and finishes partial when another item cannot be stored', async () => {
    const blueprintId = new ObjectId();
    const run = queuedRun({ count: 2, blueprintId }, { totalUnits: 2 });
    const createdQuestionId = new ObjectId();
    jest.mocked(getContentRun).mockResolvedValue(run as never);
    jest.mocked(completeJson)
      .mockResolvedValueOnce(generatorOutput())
      .mockResolvedValueOnce(check('pass', 'good'))
      .mockResolvedValueOnce({ stem: 'bad', options: [] })
      .mockResolvedValueOnce({ stem: 'still bad', options: [] });
    jest.mocked(createQuestion).mockResolvedValue({ questionId: createdQuestionId, version: {} } as never);

    await jobHandler()({ runId: run._id.toHexString() });

    // Two calls for the first item; the second item's unstorable output gets
    // its one repair call (2026-11-12), which is also unstorable, so it fails.
    expect(completeJson).toHaveBeenCalledTimes(4);
    const terminal = jest
      .mocked(updateContentRun)
      .mock.calls.map((call) => call[1])
      .find((update) => update.status === 'partial');
    expect(terminal).toMatchObject({ status: 'partial', completedUnits: 2 });
    expect(terminal?.result).toMatchObject({
      createdQuestionIds: [createdQuestionId],
      failures: [expect.objectContaining({ item: 1, stage: 'generating', code: 'generation-invalid-options' })],
    });
    expect(jest.mocked(createQuestion).mock.calls[0][0].provenance).toEqual({
      kind: 'generated',
      runId: run._id,
      blueprintId,
      item: 0,
    });
    expect(failContentRun).not.toHaveBeenCalled();
  });

  it('stops quietly once an instructor ends the run, keeping the Draft already saved', async () => {
    const run = queuedRun({ count: 2 }, { totalUnits: 2 });
    jest.mocked(getContentRun).mockResolvedValue(run as never);
    jest.mocked(completeJson)
      .mockResolvedValueOnce(generatorOutput()).mockResolvedValueOnce(check())
      .mockResolvedValueOnce(generatorOutput()).mockResolvedValueOnce(check());
    // Ended while the first Draft was being saved: the checks before the first
    // slot, before generating and before checking pass (3); the check before
    // the second slot finds the run terminal.
    jest.mocked(assertContentRunActive).mockImplementation(async () => {
      if (jest.mocked(assertContentRunActive).mock.calls.length > 3) throw new Error('content-run-conflict');
    });

    await jobHandler()({ runId: run._id.toHexString() });

    expect(completeJson).toHaveBeenCalledTimes(2);
    expect(createQuestion).toHaveBeenCalledTimes(1);
    expect(failContentRun).not.toHaveBeenCalled();
    expect(jest.mocked(updateContentRun).mock.calls.map((call) => call[1].status)).not.toContain('partial');
  });

  it('makes no model call once the run was ended before its next candidate', async () => {
    const run = queuedRun({ count: 3 }, { totalUnits: 3 });
    jest.mocked(getContentRun).mockResolvedValue(run as never);
    jest.mocked(assertContentRunActive).mockRejectedValue(new Error('content-run-conflict'));

    await jobHandler()({ runId: run._id.toHexString() });

    expect(completeJson).not.toHaveBeenCalled();
    expect(createQuestion).not.toHaveBeenCalled();
    expect(failContentRun).not.toHaveBeenCalled();
  });

  it('durably fails a tracked batch before generation when assigned grounding is missing', async () => {
    const run = queuedRun();
    materialToArray.mockResolvedValue([]);
    jest.mocked(getContentRun).mockResolvedValue(run as never);

    await jobHandler()({ runId: run._id.toHexString() });

    expect(failContentRun).toHaveBeenCalledWith(
      run._id,
      expect.objectContaining({
        code: 'generation-no-assigned-materials',
        atStage: 'retrieving',
      }),
      { createdQuestionIds: [], failures: [], checks: [] },
    );
    expect(completeJson).not.toHaveBeenCalled();
    expect(createQuestion).not.toHaveBeenCalled();
  });
});

describe('queued pipeline grounding and persistence (IN-Q05/Q10)', () => {
  it('strips control characters the generator emits into displayed text', async () => {
    // Seen in two consecutive live runs: `\text{DISC<U+0002>PCT}` in a stem,
    // then a U+001D inside an explanation. Prompt guidance did not stop it
    // recurring, hence a deterministic strip. Built with fromCharCode
    // deliberately: a literal control character would be invisible here.
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
    jest.mocked(completeJson).mockResolvedValueOnce(dirty).mockResolvedValueOnce(check());

    await runPipeline({ courseId, loId, count: 1, byPuid: 'PUID-INSTR' });

    const arg = jest.mocked(createQuestion).mock.calls[0][0];
    expect(arg.stem).toBe('What is the IRR?');
    // Located by ROLE, not by position: MCQ options are shuffled.
    const dirtied = arg.options.find((o) => o.role === 'correct')!;
    expect(dirtied.text).toBe('AB');
    expect(dirtied.explanation).toBe('line one\nline two');
  });

  it('grounds retrieval in the course collection and records sourceRefs + agentDecision', async () => {
    jest.mocked(completeJson)
      .mockResolvedValueOnce(generatorOutput())
      .mockResolvedValueOnce(check('flag', 'double-check the rounding', { suggestions: ['Round to 2 dp'] }));

    await runPipeline({ courseId, loId, count: 1, prompt: 'focus on IRR', byPuid: 'PUID-INSTR' });

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
      suggestions: ['Round to 2 dp'],
    });
    expect(arg.sourceRefs).toEqual([{ materialId, chunk: 'IRR context' }]);
  });

  it('still inserts a Draft when the checker REJECTS and the one repair does not improve it', async () => {
    jest.mocked(completeJson)
      .mockResolvedValueOnce(generatorOutput()).mockResolvedValueOnce(check('reject', 'factually wrong'))
      .mockResolvedValueOnce(generatorOutput()).mockResolvedValueOnce(check('reject', 'still wrong'));

    const ids = await runPipeline({ courseId, loId, count: 1, byPuid: 'PUID-INSTR' });

    expect(ids).toHaveLength(1);
    expect(completeJson).toHaveBeenCalledTimes(4);
    expect(jest.mocked(createQuestion).mock.calls[0][0].agentDecision).toMatchObject({
      decision: 'reject', reasoning: 'factually wrong',
      repair: { attempted: true, trigger: 'checker-reject', adopted: false, originalDecision: 'reject' },
    });
    expect(createQuestion).toHaveBeenCalledTimes(1);
    expect(jest.mocked(createQuestion).mock.calls[0][0].agentDecision?.decision).toBe('reject');
    // createQuestion itself sets state:'draft'; the pipeline must never publish.
  });

  it('allows a ready material assigned to the LO theme without a narrower loId', async () => {
    materialToArray.mockResolvedValue([
      { _id: materialId, courseId, status: 'ready', assignments: [{ themeId }] },
    ]);
    jest.mocked(completeJson).mockResolvedValueOnce(generatorOutput()).mockResolvedValueOnce(check());

    await runPipeline({ courseId, loId, count: 1, byPuid: 'PUID-INSTR' });

    expect(search).toHaveBeenCalledWith('course-abc', [0.1, 0.2, 0.3], 6, {
      must: [{ key: 'materialId', match: { any: [materialId.toHexString()] } }],
    });
  });

  it('excludes ready materials assigned only to a sibling LO from grounding and sourceRefs', async () => {
    const siblingMaterialId = new ObjectId();
    const siblingLoId = new ObjectId();
    materialToArray.mockResolvedValue([
      { _id: materialId, courseId, status: 'ready', assignments: [{ themeId, loId }] },
      { _id: siblingMaterialId, courseId, status: 'ready', assignments: [{ themeId, loId: siblingLoId }] },
    ]);
    jest.mocked(search).mockResolvedValue([
      { id: 'sibling', score: 0.99, payload: { materialId: siblingMaterialId.toHexString(), chunk: 'wrong LO' } },
      { id: 'allowed', score: 0.8, payload: { materialId: materialId.toHexString(), chunk: 'right LO' } },
    ]);
    jest.mocked(completeJson).mockResolvedValueOnce(generatorOutput()).mockResolvedValueOnce(check());

    await runPipeline({ courseId, loId, count: 1, byPuid: 'PUID-INSTR' });

    expect(search).toHaveBeenCalledWith('course-abc', [0.1, 0.2, 0.3], 6, {
      must: [{ key: 'materialId', match: { any: [materialId.toHexString()] } }],
    });
    expect(jest.mocked(createQuestion).mock.calls[0][0].sourceRefs).toEqual([
      { materialId, chunk: 'right LO' },
    ]);
  });

  it('fails before embedding or LLM calls when no ready material is assigned', async () => {
    materialToArray.mockResolvedValue([
      { _id: new ObjectId(), courseId, status: 'ready', assignments: [{ themeId, loId: new ObjectId() }] },
    ]);

    await runPipeline({ courseId, loId, count: 1, byPuid: 'PUID-INSTR' });

    expect(runFailure()).toMatchObject({ code: 'generation-no-assigned-materials' });
    expect(embedOne).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
    expect(completeJson).not.toHaveBeenCalled();
    expect(createQuestion).not.toHaveBeenCalled();
  });

  it('surfaces retrieval failure without falling back to ungrounded generation', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.mocked(search).mockRejectedValue(new Error('qdrant down'));

    await runPipeline({ courseId, loId, count: 1, byPuid: 'PUID-INSTR' });

    expect(runFailure()).toMatchObject({ code: 'generation-retrieval-failed' });
    expect(completeJson).not.toHaveBeenCalled();
    expect(createQuestion).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('surfaces zero filtered hits without generating from the LO name alone', async () => {
    jest.mocked(search).mockResolvedValue([]);

    await runPipeline({ courseId, loId, count: 1, byPuid: 'PUID-INSTR' });

    expect(runFailure()).toMatchObject({ code: 'generation-no-grounding' });
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
      { loId: lo1, loName: 'LO one', approved: 4, reviewed: 2, unapproved: 6, heldBack: 0, target: 5 },
      { loId: lo2, loName: 'LO two', approved: 0, reviewed: 1, unapproved: 3, heldBack: 0, target: 5 },
    ]);

    expect(countDocuments).toHaveBeenCalledTimes(6);
  });
});


// --- option order alignment (Phase 5 Task 7.2) ------------------------------

describe('option order alignment', () => {
  // The invariant: the checker cites options by LETTER, so the order it is
  // shown must be the order that is persisted. Shuffling downstream of it
  // reassigns every key after the prose is written — seen for real on
  // generation run 6a7e9b9f0dbc47057d634fdc, where a roleAssessment reading
  // "Option A (correct)" was stored against an A that was partially-correct.
  // createQuestion is mocked here, so any variation in the persisted order can
  // only have come from generation itself.
  const ITEMS = 12;

  function runPipelineWithCannedCalls() {
    let call = 0;
    jest.mocked(completeJson).mockImplementation(async () => {
      // Per item the pipeline calls the generator, then the checker.
      const step = call % 2;
      call += 1;
      return (step === 0 ? generatorOutput() : check('pass', 'fine')) as never;
    });
    return runPipeline({ courseId, loId, count: ITEMS, byPuid: 'PUID-INSTR' });
  }

  it('shows the checker the exact order it persists', async () => {
    await runPipelineWithCannedCalls();

    const prompts = jest.mocked(completeJson).mock.calls.map((c) => String(c[0]));
    const persistedCalls = jest.mocked(createQuestion).mock.calls;
    expect(persistedCalls).toHaveLength(ITEMS);

    persistedCalls.forEach((persisted, item) => {
      const texts = persisted[0].options.map((o) => o.text);
      // Sorting the persisted texts by where each first appears in the prompt
      // reproduces the prompt's own order — so the two agree iff it is a no-op.
      const prompt = prompts[item * 2 + 1];
      const asShownToChecker = [...texts].sort((a, b) => prompt.indexOf(a) - prompt.indexOf(b));
      expect(asShownToChecker).toEqual(texts);
    });
  });

  it('shuffles upstream of persistence and tells createQuestion not to repeat it', async () => {
    await runPipelineWithCannedCalls();

    const correctKeys = jest
      .mocked(createQuestion)
      .mock.calls.map((c) => c[0].options.find((o) => o.role === 'correct')!.key);

    // The fixture always generates the correct option at 'A'. Over 12 items the
    // chance of a real shuffle leaving every one there is (1/4)^12.
    expect(correctKeys.some((key) => key !== 'A')).toBe(true);
    for (const call of jest.mocked(createQuestion).mock.calls) {
      expect(call[0].optionsAlreadyShuffled).toBe(true);
    }
  });
});

describe('deterministic plan run identity', () => {
  it('returns existing durable work without enqueuing another job', async () => {
    const runId = new ObjectId();
    jest.mocked(getContentRun).mockResolvedValue({ _id: runId, courseId, requestedBy: 'PUID-INSTR' } as never);
    await expect(enqueueGenerationRun({ courseId, loId, count: 2, byPuid: 'PUID-INSTR', runId })).resolves.toEqual(runId);
    expect(createQuestionGenerationRun).not.toHaveBeenCalled();
    expect(enqueueJob).not.toHaveBeenCalled();
  });
  it('does not enqueue a second job if another request won the unique insert', async () => {
    const runId = new ObjectId();
    jest.mocked(getContentRun).mockResolvedValue(null);
    jest.mocked(createQuestionGenerationRun).mockRejectedValue(Object.assign(new Error('duplicate'), { code: 11000 }));
    await expect(enqueueGenerationRun({ courseId, loId, count: 2, byPuid: 'PUID-INSTR', runId })).resolves.toEqual(runId);
    expect(enqueueJob).not.toHaveBeenCalled();
  });
});

describe('private assessment adapter', () => {
  it('makes the same two calls but never inserts a public bank question', async () => {
    jest.mocked(completeJson).mockResolvedValueOnce(generatorOutput()).mockResolvedValueOnce(check('pass', 'grounded'));
    const checkpoint = jest.fn(async () => undefined);
    const onStage = jest.fn(async (_stage: string) => undefined);
    const result = await generatePrivateAssessmentQuestion({ courseId, loId, type: 'mcq', difficulty: 'medium', checkpoint, onStage });
    expect(result.stem).toBe('What is the IRR?');
    expect(result.sourceRefs).toHaveLength(1);
    expect(result.agentDecision).toMatchObject({ decision: 'pass', reasoning: 'grounded' });
    expect(completeJson).toHaveBeenCalledTimes(2);
    expect(String(jest.mocked(completeJson).mock.calls[0][0])).toContain('sin, cos, tan');
    expect(onStage.mock.calls.map(call => call[0])).toEqual(['retrieving', 'generating', 'reviewing']);
    expect(createQuestion).not.toHaveBeenCalled();
    expect(createQuestionGenerationRun).not.toHaveBeenCalled();
    expect(checkpoint).toHaveBeenCalled();
  });

  it('fails the slot on a numeric failure the one repair cannot fix (an exam item must be servable)', async () => {
    const broken = { ...generatorOutput(), stem: 'A loan of {{P}} at 5%: what is the IRR?', numericKind: 'conceptual' };
    jest.mocked(completeJson)
      .mockResolvedValueOnce(broken).mockResolvedValueOnce(check())
      .mockResolvedValueOnce(broken).mockResolvedValueOnce(check());
    await expect(generatePrivateAssessmentQuestion({ courseId, loId, type: 'mcq', difficulty: 'medium', checkpoint: async () => undefined }))
      .rejects.toThrow('this question is conceptual');
    expect(completeJson).toHaveBeenCalledTimes(4);
    expect(createQuestion).not.toHaveBeenCalled();
  });
});
