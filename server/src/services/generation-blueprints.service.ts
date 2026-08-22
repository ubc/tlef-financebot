import type { ObjectId, WithId } from 'mongodb';
import {
  generationBlueprintsCol,
  losCol,
  materialsCol,
} from '../components/mongodb/collections';
import type {
  Difficulty,
  GenerationBlueprint,
  QuestionType,
} from '../types/domain';
import { getCourseContentRun } from './content-runs.service';
import { enqueueGenerationRun } from './generation.service';
import {
  configuredGenerationModels,
  persistedModels,
  resolvedFromPersisted,
} from './step-models';

export interface GenerationBlueprintInput {
  name: string;
  loId: ObjectId;
  count: number;
  type: QuestionType;
  difficulty?: Difficulty;
  prompt?: string;
  materialIds?: ObjectId[];
}

function throwBlueprintWriteError(error: unknown): never {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  ) {
    throw new Error('generation-blueprint-name-conflict', { cause: error });
  }
  throw error;
}

async function assertBlueprintScope(
  courseId: ObjectId,
  input: Pick<GenerationBlueprintInput, 'loId' | 'materialIds'>,
): Promise<void> {
  const lo = await losCol().findOne({ _id: input.loId, courseId });
  if (!lo) throw new Error('lo-not-in-course');
  if (!input.materialIds?.length) return;
  const distinct = new Set(input.materialIds.map((id) => id.toHexString()));
  const count = await materialsCol().countDocuments({
    _id: { $in: input.materialIds },
    courseId,
    status: 'ready',
  });
  if (count !== distinct.size) throw new Error('blueprint-material-not-ready');
}

export async function listGenerationBlueprints(
  courseId: ObjectId,
): Promise<Array<WithId<GenerationBlueprint>>> {
  return generationBlueprintsCol().find({ courseId }).sort({ updatedAt: -1 }).toArray();
}

export async function createGenerationBlueprint(
  courseId: ObjectId,
  byPuid: string,
  input: GenerationBlueprintInput,
): Promise<WithId<GenerationBlueprint>> {
  await assertBlueprintScope(courseId, input);
  const now = new Date();
  const doc: GenerationBlueprint = {
    courseId,
    name: input.name,
    loId: input.loId,
    count: input.count,
    type: input.type,
    ...(input.difficulty ? { difficulty: input.difficulty } : {}),
    ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
    ...(input.materialIds?.length ? { materialIds: input.materialIds } : {}),
    models: persistedModels(configuredGenerationModels()),
    createdBy: byPuid,
    createdAt: now,
    updatedAt: now,
  };
  let insertedId: ObjectId;
  try {
    ({ insertedId } = await generationBlueprintsCol().insertOne(doc));
  } catch (error) {
    throwBlueprintWriteError(error);
  }
  return { _id: insertedId, ...doc };
}

export async function updateGenerationBlueprint(
  courseId: ObjectId,
  blueprintId: ObjectId,
  patch: Partial<GenerationBlueprintInput>,
): Promise<WithId<GenerationBlueprint>> {
  const current = await generationBlueprintsCol().findOne({ _id: blueprintId, courseId });
  if (!current) throw new Error('generation-blueprint-not-found');
  const next = {
    name: patch.name ?? current.name,
    loId: patch.loId ?? current.loId,
    count: patch.count ?? current.count,
    type: patch.type ?? current.type,
    difficulty: patch.difficulty ?? current.difficulty,
    prompt: patch.prompt ?? current.prompt,
    materialIds: patch.materialIds ?? current.materialIds,
  };
  await assertBlueprintScope(courseId, next);
  const updatedAt = new Date();
  let updated: WithId<GenerationBlueprint> | null;
  try {
    updated = await generationBlueprintsCol().findOneAndUpdate(
      { _id: blueprintId, courseId },
      {
        $set: {
          name: next.name,
          loId: next.loId,
          count: next.count,
          type: next.type,
          ...(next.difficulty ? { difficulty: next.difficulty } : {}),
          ...(next.prompt !== undefined ? { prompt: next.prompt } : {}),
          ...(next.materialIds?.length ? { materialIds: next.materialIds } : {}),
          updatedAt,
        },
        ...(!next.difficulty || next.prompt === undefined || !next.materialIds?.length
          ? {
              $unset: {
                ...(!next.difficulty ? { difficulty: '' } : {}),
                ...(next.prompt === undefined ? { prompt: '' } : {}),
                ...(!next.materialIds?.length ? { materialIds: '' } : {}),
              },
            }
          : {}),
      },
      { returnDocument: 'after' },
    );
  } catch (error) {
    throwBlueprintWriteError(error);
  }
  if (!updated) throw new Error('generation-blueprint-not-found');
  return updated;
}

export async function enqueueBlueprintRun(
  courseId: ObjectId,
  blueprintId: ObjectId,
  byPuid: string,
): Promise<ObjectId> {
  const blueprint = await generationBlueprintsCol().findOne({ _id: blueprintId, courseId });
  if (!blueprint) throw new Error('generation-blueprint-not-found');
  return enqueueGenerationRun({
    courseId,
    loId: blueprint.loId,
    count: blueprint.count,
    type: blueprint.type,
    ...(blueprint.difficulty ? { difficulty: blueprint.difficulty } : {}),
    ...(blueprint.prompt !== undefined ? { prompt: blueprint.prompt } : {}),
    byPuid,
    models: resolvedFromPersisted(blueprint.models),
    blueprintId,
    ...(blueprint.materialIds ? { pinnedMaterialIds: blueprint.materialIds } : {}),
  });
}

export async function retryGenerationRun(
  courseId: ObjectId,
  runId: ObjectId,
  byPuid: string,
): Promise<ObjectId> {
  const run = await getCourseContentRun(courseId, runId);
  if (!run) throw new Error('content-run-not-found');
  if (run.kind !== 'question-generation') throw new Error('content-run-not-generation');
  if (!['completed', 'partial', 'failed'].includes(run.status)) {
    throw new Error('content-run-not-terminal');
  }
  return enqueueGenerationRun({
    courseId,
    loId: run.input.loId,
    count: run.input.count,
    type: run.input.type,
    ...(run.input.difficulty ? { difficulty: run.input.difficulty } : {}),
    ...(run.input.prompt !== undefined ? { prompt: run.input.prompt } : {}),
    byPuid,
    models: resolvedFromPersisted(run.input.models),
    ...(run.input.blueprintId ? { blueprintId: run.input.blueprintId } : {}),
    retryOfRunId: runId,
    ...(run.grounding?.allowedMaterialIds
      ? { pinnedMaterialIds: run.grounding.allowedMaterialIds }
      : {}),
    // The frozen ids are not an instructor pin; only the recorded flag is.
    ...(run.grounding?.pinned ? { groundingPinned: true } : {}),
  });
}
