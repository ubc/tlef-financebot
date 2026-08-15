jest.mock('../../server/src/components/mongodb/collections', () => ({
  generationBlueprintsCol: jest.fn(),
  losCol: jest.fn(),
  materialsCol: jest.fn(),
}));
jest.mock('../../server/src/services/content-runs.service', () => ({
  getCourseContentRun: jest.fn(),
}));
jest.mock('../../server/src/services/generation.service', () => ({
  enqueueGenerationRun: jest.fn(),
}));
// step-models is deliberately NOT mocked. Its persisted <-> in-memory
// conversions are pure, and re-implementing them in a mock factory would stop
// these tests tracking the real shapes — which is exactly how the run-record
// shape could drift unnoticed. Only the env-derived defaults are stubbed.
jest.mock('../../server/src/config/env', () => ({
  env: {
    embeddingsModel: 'embed-v1',
    llmModelGenerator: 'generator-v1',
    llmModelValidator: 'validator-v1',
    llmModelReviewer: 'reviewer-v1',
  },
}));

import { ObjectId } from 'mongodb';
import {
  generationBlueprintsCol,
  losCol,
  materialsCol,
} from '../../server/src/components/mongodb/collections';
import { getCourseContentRun } from '../../server/src/services/content-runs.service';
import { enqueueGenerationRun } from '../../server/src/services/generation.service';
import { configuredGenerationModels } from '../../server/src/services/step-models';
import {
  createGenerationBlueprint,
  enqueueBlueprintRun,
  retryGenerationRun,
  updateGenerationBlueprint,
} from '../../server/src/services/generation-blueprints.service';

const blueprintInsertOne = jest.fn();
const blueprintFindOne = jest.fn();
const blueprintFindOneAndUpdate = jest.fn();
const loFindOne = jest.fn();
const materialCountDocuments = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(generationBlueprintsCol).mockReturnValue({
    insertOne: blueprintInsertOne,
    findOne: blueprintFindOne,
    findOneAndUpdate: blueprintFindOneAndUpdate,
  } as never);
  jest.mocked(losCol).mockReturnValue({ findOne: loFindOne } as never);
  jest.mocked(materialsCol).mockReturnValue({ countDocuments: materialCountDocuments } as never);
  loFindOne.mockResolvedValue({ _id: new ObjectId() });
  materialCountDocuments.mockResolvedValue(0);
  blueprintInsertOne.mockResolvedValue({ insertedId: new ObjectId() });
  jest.mocked(enqueueGenerationRun).mockResolvedValue(new ObjectId());
});

describe('saved generation blueprints', () => {
  it('pins the complete recipe, selected materials, and configured models', async () => {
    const courseId = new ObjectId();
    const loId = new ObjectId();
    const materialIds = [new ObjectId(), new ObjectId()];
    materialCountDocuments.mockResolvedValue(2);

    const blueprint = await createGenerationBlueprint(courseId, 'PUID-INSTR', {
      name: 'Week 4 medium MCQ',
      loId,
      count: 8,
      type: 'mcq',
      difficulty: 'medium',
      prompt: 'Focus on discounted cash flow.',
      materialIds,
    });

    expect(blueprint).toMatchObject({
      courseId,
      name: 'Week 4 medium MCQ',
      loId,
      count: 8,
      materialIds,
      // A blueprint pins model IDS, not per-step parameters: it answers "which
      // model produced this", and replaying it uses the models' own defaults.
      models: {
        embedding: 'embed-v1',
        generator: 'generator-v1',
        validator: 'validator-v1',
        reviewer: 'reviewer-v1',
      },
    });
    expect(configuredGenerationModels()).toEqual({
      embedding: 'embed-v1',
      generator: { model: 'generator-v1' },
      validator: { model: 'validator-v1' },
      reviewer: { model: 'reviewer-v1' },
    });
    expect(materialCountDocuments).toHaveBeenCalledWith({
      _id: { $in: materialIds },
      courseId,
      status: 'ready',
    });
  });

  it('rejects a blueprint that points at material outside the ready course set', async () => {
    materialCountDocuments.mockResolvedValue(0);

    await expect(
      createGenerationBlueprint(new ObjectId(), 'PUID-INSTR', {
        name: 'Invalid',
        loId: new ObjectId(),
        count: 3,
        type: 'mcq',
        materialIds: [new ObjectId()],
      }),
    ).rejects.toThrow('blueprint-material-not-ready');
    expect(blueprintInsertOne).not.toHaveBeenCalled();
  });

  it('normalizes a duplicate course/name index failure', async () => {
    blueprintInsertOne.mockRejectedValue(Object.assign(new Error('duplicate key'), { code: 11000 }));

    await expect(
      createGenerationBlueprint(new ObjectId(), 'PUID-INSTR', {
        name: 'Duplicate',
        loId: new ObjectId(),
        count: 3,
        type: 'mcq',
      }),
    ).rejects.toThrow('generation-blueprint-name-conflict');
  });

  it('runs the immutable model and material recipe from the saved blueprint', async () => {
    const courseId = new ObjectId();
    const blueprintId = new ObjectId();
    const loId = new ObjectId();
    const materialIds = [new ObjectId()];
    blueprintFindOne.mockResolvedValue({
      _id: blueprintId,
      courseId,
      name: 'Saved recipe',
      loId,
      count: 5,
      type: 'true-false',
      difficulty: 'hard',
      prompt: 'Use edge cases.',
      materialIds,
      models: {
        embedding: 'embed-v1',
        generator: 'generator-v1',
        validator: 'validator-v1',
        reviewer: 'reviewer-v1',
      },
    });

    await enqueueBlueprintRun(courseId, blueprintId, 'PUID-INSTR');

    expect(enqueueGenerationRun).toHaveBeenCalledWith({
      courseId,
      loId,
      count: 5,
      type: 'true-false',
      difficulty: 'hard',
      prompt: 'Use edge cases.',
      byPuid: 'PUID-INSTR',
      // Rehydrated to the in-memory shape the pipeline calls with.
      models: {
        embedding: 'embed-v1',
        generator: { model: 'generator-v1' },
        validator: { model: 'validator-v1' },
        reviewer: { model: 'reviewer-v1' },
      },
      blueprintId,
      pinnedMaterialIds: materialIds,
    });
  });

  it('clears a removed material pin when updating a blueprint', async () => {
    const courseId = new ObjectId();
    const blueprintId = new ObjectId();
    const current = {
      _id: blueprintId,
      courseId,
      name: 'Recipe',
      loId: new ObjectId(),
      count: 5,
      type: 'mcq',
      difficulty: 'hard',
      prompt: 'Old prompt',
      materialIds: [new ObjectId()],
    };
    blueprintFindOne.mockResolvedValue(current);
    blueprintFindOneAndUpdate.mockResolvedValue({ ...current, materialIds: undefined });

    await updateGenerationBlueprint(courseId, blueprintId, {
      materialIds: [],
    });

    expect(blueprintFindOneAndUpdate).toHaveBeenCalledWith(
      { _id: blueprintId, courseId },
      expect.objectContaining({
        $unset: expect.objectContaining({ materialIds: '' }),
      }),
      { returnDocument: 'after' },
    );
  });
});

describe('exact generation retry', () => {
  it('copies the original input, model snapshot, and grounding material ids', async () => {
    const courseId = new ObjectId();
    const runId = new ObjectId();
    const loId = new ObjectId();
    const blueprintId = new ObjectId();
    const materialIds = [new ObjectId(), new ObjectId()];
    jest.mocked(getCourseContentRun).mockResolvedValue({
      _id: runId,
      courseId,
      kind: 'question-generation',
      status: 'partial',
      input: {
        loId,
        count: 10,
        type: 'mcq',
        difficulty: 'easy',
        prompt: 'Original prompt',
        models: {
          embedding: 'old-embed',
          generator: 'old-generator',
          validator: 'old-validator',
          reviewer: 'old-reviewer',
        },
        blueprintId,
      },
      grounding: { allowedMaterialIds: materialIds, chunks: [] },
    } as never);

    await retryGenerationRun(courseId, runId, 'PUID-INSTR');

    expect(enqueueGenerationRun).toHaveBeenCalledWith({
      courseId,
      loId,
      count: 10,
      type: 'mcq',
      difficulty: 'easy',
      prompt: 'Original prompt',
      byPuid: 'PUID-INSTR',
      // A retry reuses the ORIGINAL run's models, not today's settings — but it
      // recovers ids only, so any per-step parameters that run used are lost.
      models: {
        embedding: 'old-embed',
        generator: { model: 'old-generator' },
        validator: { model: 'old-validator' },
        reviewer: { model: 'old-reviewer' },
      },
      blueprintId,
      retryOfRunId: runId,
      pinnedMaterialIds: materialIds,
    });
  });

  it('refuses to retry a still-running generation run', async () => {
    jest.mocked(getCourseContentRun).mockResolvedValue({
      kind: 'question-generation',
      status: 'running',
    } as never);

    await expect(
      retryGenerationRun(new ObjectId(), new ObjectId(), 'PUID-INSTR'),
    ).rejects.toThrow('content-run-not-terminal');
  });
});
