jest.mock('../../server/src/services/source-readiness.service', () => ({ getMaterialSourceReadiness: jest.fn() }));
jest.mock('../../server/src/components/mongodb/collections', () => ({ contentRunsCol: jest.fn(), materialsCol: jest.fn() }));
jest.mock('../../server/src/components/jobs', () => ({ hasPendingJob: jest.fn() }));

import { ObjectId, type WithId } from 'mongodb';
import { contentRunsCol, materialsCol } from '../../server/src/components/mongodb/collections';
import { getMaterialSourceReadiness } from '../../server/src/services/source-readiness.service';
import { hasPendingJob } from '../../server/src/components/jobs';
import {
  assertContentRunActive,
  claimStructureGenerationRun,
  createMaterialIngestRun,
  createStructureGenerationRun,
  createQuestionGenerationRun,
  endActiveGenerationRuns,
  endGenerationRun,
  getContentRun,
  listCourseContentRuns,
  reconcileContentRuns,
  subscribeToCourseContentRuns,
  updateContentRun,
} from '../../server/src/services/content-runs.service';
import type { ContentRun } from '../../server/src/types/domain';

let docs: Array<WithId<ContentRun>> = [];
let persistedBeforePublish = false;

function same(a: unknown, b: unknown): boolean {
  if (a instanceof ObjectId && b instanceof ObjectId) return a.equals(b);
  return a === b;
}

function matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = doc[key];
    if (expected && typeof expected === 'object' && '$in' in (expected as Record<string, unknown>)) {
      return ((expected as { $in: unknown[] }).$in).includes(actual);
    }
    return same(actual, expected);
  });
}

const insertOne = jest.fn(async (doc: ContentRun) => {
  const insertedId = new ObjectId();
  docs.push({ _id: insertedId, ...doc });
  return { insertedId };
});
const findOne = jest.fn(async (filter: Record<string, unknown>) =>
  docs.find((doc) => matches(doc as unknown as Record<string, unknown>, filter)) ?? null,
);
const findOneAndUpdate = jest.fn(
  async (filter: Record<string, unknown>, update: { $set: Record<string, unknown> }) => {
    const index = docs.findIndex((doc) => matches(doc as unknown as Record<string, unknown>, filter));
    if (index === -1) return null;
    docs[index] = { ...docs[index]!, ...update.$set } as WithId<ContentRun>;
    persistedBeforePublish = true;
    return docs[index]!;
  },
);
interface FakeCursor {
  sort: jest.Mock<FakeCursor, []>;
  limit: jest.Mock<FakeCursor, [number]>;
  toArray: jest.Mock<Promise<Array<WithId<ContentRun>>>, []>;
}
const find = jest.fn((filter: Record<string, unknown>) => {
  let rows = docs.filter((doc) => matches(doc as unknown as Record<string, unknown>, filter));
  const cursor = {} as FakeCursor;
  cursor.sort = jest.fn(() => {
    rows = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return cursor;
  });
  cursor.limit = jest.fn((limit: number) => {
    rows = rows.slice(0, limit);
    return cursor;
  });
  cursor.toArray = jest.fn(async () => rows);
  return cursor;
});

beforeEach(() => {
  docs = [];
  persistedBeforePublish = false;
  jest.clearAllMocks();
  jest.mocked(contentRunsCol).mockReturnValue({ insertOne, findOne, findOneAndUpdate, find } as never);
  jest.mocked(hasPendingJob).mockResolvedValue(true);
  jest.mocked(materialsCol).mockReturnValue({ findOne: jest.fn().mockResolvedValue(null), updateOne: jest.fn(), updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }) } as never);
});

function materialRun(overrides: Partial<WithId<ContentRun>> = {}): WithId<ContentRun> {
  const now = new Date('2026-07-22T12:00:00.000Z');
  return {
    _id: new ObjectId(),
    courseId: new ObjectId(),
    kind: 'material-ingest',
    requestedBy: 'PUID-1',
    status: 'queued',
    stage: 'queued',
    completedUnits: 0,
    revision: 0,
    events: [],
    warnings: [],
    input: {
      materialId: new ObjectId(),
      sourceName: 'lecture.pdf',
      sourceFormat: 'pdf',
      trigger: 'upload',
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as WithId<ContentRun>;
}

describe('content run creation', () => {
  it('persists the selected quality policy while leaving legacy requests baseline by omission', async () => {
    const input = { courseId: new ObjectId(), requestedBy: 'PUID-1', loId: new ObjectId(), count: 1, type: 'mcq' as const,
      models: { embedding: 'embed', generator: 'gen', validator: 'val', reviewer: 'review' } };
    const baseline = await createQuestionGenerationRun(input);
    const pilot = await createQuestionGenerationRun({ ...input, qualityPolicy: 'grounded-memory-v1' });
    expect(baseline.input).not.toHaveProperty('qualityPolicy');
    expect(pilot.input.qualityPolicy).toBe('grounded-memory-v1');
    expect(await getContentRun(pilot._id)).toMatchObject({ input: { qualityPolicy: 'grounded-memory-v1' } });
  });
  it('pins provenance-aware evidence without upgrading historical quality-policy-only records', async () => {
    const input = { courseId: new ObjectId(), requestedBy: 'PUID-1', loId: new ObjectId(), count: 1, type: 'mcq' as const,
      qualityPolicy: 'grounded-memory-v2' as const, models: { embedding: 'embed', generator: 'gen', validator: 'val', reviewer: 'review' } };
    const legacy = await createQuestionGenerationRun(input);
    const current = await createQuestionGenerationRun({ ...input, sourceProvenance: 'pdf-pages-v1' });
    expect(legacy.input).not.toHaveProperty('sourceProvenance');
    expect(await getContentRun(current._id)).toMatchObject({ input: { sourceProvenance: 'pdf-pages-v1' } });
    expect(await getContentRun(legacy._id)).toMatchObject({ input: legacy.input });
  });
  it('pins answerability independently while preserving historical absence', async () => {
    const input = { courseId: new ObjectId(), requestedBy: 'PUID-1', loId: new ObjectId(), count: 1, type: 'mcq' as const,
      qualityPolicy: 'grounded-memory-v2' as const, models: { embedding: 'embed', generator: 'gen', validator: 'val', reviewer: 'review' } };
    const legacy = await createQuestionGenerationRun(input);
    const current = await createQuestionGenerationRun({ ...input, answerabilityProtocol: 'option-answerability-v1' });
    expect(legacy.input).not.toHaveProperty('answerabilityProtocol');
    expect((await getContentRun(current._id))?.input).toMatchObject({ answerabilityProtocol: 'option-answerability-v1' });
  });
  it('pins task demand independently while preserving historical absence', async () => {
    const input = { courseId: new ObjectId(), requestedBy: 'PUID-1', loId: new ObjectId(), count: 1, type: 'mcq' as const,
      qualityPolicy: 'grounded-memory-v2' as const, models: { embedding: 'embed', generator: 'gen', validator: 'val', reviewer: 'review' } };
    const legacy = await createQuestionGenerationRun(input);
    const current = await createQuestionGenerationRun({ ...input, taskDemandProtocol: 'task-demand-v1' });
    expect(legacy.input).not.toHaveProperty('taskDemandProtocol');
    expect((await getContentRun(current._id))?.input).toMatchObject({ taskDemandProtocol: 'task-demand-v1' });
  });
  it('pins task demand independently while preserving historical absence', async () => {
    const input = { courseId: new ObjectId(), requestedBy: 'PUID-1', loId: new ObjectId(), count: 1, type: 'mcq' as const,
      qualityPolicy: 'grounded-memory-v2' as const, models: { embedding: 'embed', generator: 'gen', validator: 'val', reviewer: 'review' } };
    const legacy = await createQuestionGenerationRun(input);
    const current = await createQuestionGenerationRun({ ...input, exactBankProtocol: 'course-exact-bank-v1' });
    expect(legacy.input).not.toHaveProperty('exactBankProtocol');
    expect((await getContentRun(current._id))?.input).toMatchObject({ exactBankProtocol: 'course-exact-bank-v1' });
  });
  it.each([undefined, 'course-task-retrieval-v1', 'unknown-protocol', '', null])(
    'preserves the exact task-retrieval selector for downstream validation: %s', async taskRetrievalProtocol => {
      const input = { courseId: new ObjectId(), requestedBy: 'PUID-1', loId: new ObjectId(), count: 1, type: 'mcq' as const,
        qualityPolicy: 'grounded-memory-v2' as const, models: { embedding: 'embed', generator: 'gen', validator: 'val', reviewer: 'review' } };
      const run = await createQuestionGenerationRun({ ...input,
        ...(taskRetrievalProtocol !== undefined ? { taskRetrievalProtocol: taskRetrievalProtocol as never } : {}) });
      const stored = await getContentRun(run._id);
      if (taskRetrievalProtocol === undefined) {
        expect(run.input).not.toHaveProperty('taskRetrievalProtocol');
        expect(stored?.input).not.toHaveProperty('taskRetrievalProtocol');
      } else {
        expect(run.input.taskRetrievalProtocol).toBe(taskRetrievalProtocol);
        expect(stored?.input).toMatchObject({ taskRetrievalProtocol });
      }
    },
  );
  it.each([undefined, 'compact-authoring-v1', 'unknown-protocol', '', null])(
    'preserves the exact authoring-prompt selector for downstream validation: %s', async authoringPromptProtocol => {
      const input = { courseId: new ObjectId(), requestedBy: 'PUID-1', loId: new ObjectId(), count: 1, type: 'mcq' as const,
        qualityPolicy: 'grounded-memory-v2' as const, models: { embedding: 'embed', generator: 'gen', validator: 'val', reviewer: 'review' } };
      const run = await createQuestionGenerationRun({ ...input,
        ...(authoringPromptProtocol !== undefined ? { authoringPromptProtocol: authoringPromptProtocol as never } : {}) });
      const stored = await getContentRun(run._id);
      if (authoringPromptProtocol === undefined) {
        expect(run.input).not.toHaveProperty('authoringPromptProtocol');
        expect(stored?.input).not.toHaveProperty('authoringPromptProtocol');
      } else {
        expect(run.input.authoringPromptProtocol).toBe(authoringPromptProtocol);
        expect(stored?.input).toMatchObject({ authoringPromptProtocol });
      }
    },
  );
  it.each([undefined, 'server-rendered-numeric-review-v1', 'unknown-protocol', '', null])(
    'preserves the exact numeric-review selector for downstream validation: %s', async numericReviewProtocol => {
      const input = { courseId: new ObjectId(), requestedBy: 'PUID-1', loId: new ObjectId(), count: 1, type: 'mcq' as const,
        qualityPolicy: 'grounded-memory-v2' as const, models: { embedding: 'embed', generator: 'gen', validator: 'val', reviewer: 'review' } };
      const run = await createQuestionGenerationRun({ ...input,
        ...(numericReviewProtocol !== undefined ? { numericReviewProtocol: numericReviewProtocol as never } : {}) });
      const stored = await getContentRun(run._id);
      if (numericReviewProtocol === undefined) {
        expect(run.input).not.toHaveProperty('numericReviewProtocol');
        expect(stored?.input).not.toHaveProperty('numericReviewProtocol');
      } else {
        expect(run.input.numericReviewProtocol).toBe(numericReviewProtocol);
        expect(stored?.input).toMatchObject({ numericReviewProtocol });
      }
    },
  );
  it.each([undefined, 'literal-exclusion-warrants-v1', 'unknown-protocol', '', null])(
    'preserves the exact exclusion-review selector for downstream validation: %s', async exclusionReviewProtocol => {
      const input = { courseId: new ObjectId(), requestedBy: 'PUID-1', loId: new ObjectId(), count: 1, type: 'mcq' as const,
        qualityPolicy: 'grounded-memory-v2' as const, models: { embedding: 'embed', generator: 'gen', validator: 'val', reviewer: 'review' } };
      const run = await createQuestionGenerationRun({ ...input,
        ...(exclusionReviewProtocol !== undefined ? { exclusionReviewProtocol: exclusionReviewProtocol as never } : {}) });
      const stored = await getContentRun(run._id);
      if (exclusionReviewProtocol === undefined) {
        expect(run.input).not.toHaveProperty('exclusionReviewProtocol');
        expect(stored?.input).not.toHaveProperty('exclusionReviewProtocol');
      } else {
        expect(run.input.exclusionReviewProtocol).toBe(exclusionReviewProtocol);
        expect(stored?.input).toMatchObject({ exclusionReviewProtocol });
      }
    },
  );
  it.each([undefined, 'frozen-review-decisions-v1', 'unknown-protocol', '', null])(
    'preserves the exact review-repair selector for downstream validation: %s', async reviewRepairProtocol => {
      const input = { courseId: new ObjectId(), requestedBy: 'PUID-1', loId: new ObjectId(), count: 1, type: 'mcq' as const,
        qualityPolicy: 'grounded-memory-v2' as const, models: { embedding: 'embed', generator: 'gen', validator: 'val', reviewer: 'review' } };
      const run = await createQuestionGenerationRun({ ...input,
        ...(reviewRepairProtocol !== undefined ? { reviewRepairProtocol: reviewRepairProtocol as never } : {}) });
      const stored = await getContentRun(run._id);
      if (reviewRepairProtocol === undefined) {
        expect(run.input).not.toHaveProperty('reviewRepairProtocol');
        expect(stored?.input).not.toHaveProperty('reviewRepairProtocol');
      } else {
        expect(run.input.reviewRepairProtocol).toBe(reviewRepairProtocol);
        expect(stored?.input).toMatchObject({ reviewRepairProtocol });
      }
    },
  );
  it('creates distinct durable ids for identical material requests', async () => {
    const input = {
      courseId: new ObjectId(),
      requestedBy: 'PUID-1',
      materialId: new ObjectId(),
      sourceName: 'lecture.pdf',
      sourceFormat: 'pdf' as const,
      trigger: 'upload' as const,
    };
    const first = await createMaterialIngestRun(input);
    const second = await createMaterialIngestRun(input);

    expect(first._id.equals(second._id)).toBe(false);
    expect(first.status).toBe('queued');
    expect(first.events[0]).toMatchObject({ revision: 0, status: 'queued', stage: 'queued' });
  });

  it('pins generation request details and requested count', async () => {
    const run = await createQuestionGenerationRun({
      courseId: new ObjectId(),
      requestedBy: 'PUID-1',
      loId: new ObjectId(),
      count: 4,
      type: 'mcq',
      prompt: 'Focus on NPV',
      models: { embedding: 'embed', generator: 'gen', validator: 'val', reviewer: 'review' },
    });

    expect(run.totalUnits).toBe(4);
    expect(run.input).toMatchObject({ count: 4, prompt: 'Focus on NPV' });
    expect(run.result).toEqual({ createdQuestionIds: [], failures: [] });
  });
});

describe('content run compare-and-set updates', () => {
  it('atomically gives one duplicate structure worker ownership and publishes only the winning start', async () => {
    const run = await createStructureGenerationRun({ courseId: new ObjectId(), requestedBy: 'PUID-1', options: { materialIds: [new ObjectId().toHexString()] } });
    const listener = jest.fn(); const unsubscribe = subscribeToCourseContentRuns(run.courseId, listener);
    const results = await Promise.all([claimStructureGenerationRun(run._id), claimStructureGenerationRun(run._id)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter(row => row === null)).toHaveLength(1);
    const stored = await getContentRun(run._id);
    expect(stored).toMatchObject({ status: 'running', revision: 1, startedAt: expect.any(Date) });
    expect(stored!.events.filter(event => event.status === 'running')).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(findOneAndUpdate).toHaveBeenCalledWith(expect.objectContaining({ _id: run._id, kind: 'structure-generation', status: 'queued', revision: 0 }),
      expect.anything(), { returnDocument: 'after' });
    expect(await claimStructureGenerationRun(run._id)).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('does not claim missing, non-structure or terminal work', async () => {
    expect(await claimStructureGenerationRun(new ObjectId())).toBeNull();
    const material = materialRun(); docs.push(material);
    expect(await claimStructureGenerationRun(material._id)).toBeNull();
    for (const status of ['running', 'failed', 'completed'] as const) {
      const run = await createStructureGenerationRun({ courseId: new ObjectId(), requestedBy: 'PUID-1', options: { materialIds: [new ObjectId().toHexString()] } });
      const stored = docs.find(row => row._id.equals(run._id))!; stored.status = status;
      expect(await claimStructureGenerationRun(run._id)).toBeNull();
    }
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('persists the snapshot/event before notifying a course subscriber', async () => {
    const run = materialRun();
    docs.push(run);
    const listener = jest.fn(() => expect(persistedBeforePublish).toBe(true));
    const unsubscribe = subscribeToCourseContentRuns(run.courseId, listener);

    const updated = await updateContentRun(run._id, {
      status: 'running',
      stage: 'parsing',
      message: 'Parsing source material',
    });
    unsubscribe();

    expect(updated.revision).toBe(1);
    expect(updated.events.at(-1)).toMatchObject({ revision: 1, status: 'running', stage: 'parsing' });
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { _id: run._id, revision: 0, status: 'queued' },
      expect.anything(),
      { returnDocument: 'after' },
    );
    expect(listener).toHaveBeenCalledWith(updated);
  });

  it('rejects stage and counter regression without persisting or broadcasting', async () => {
    const run = materialRun({ status: 'running', stage: 'embedding', completedUnits: 2, totalUnits: 4 });
    docs.push(run);
    const listener = jest.fn();
    const unsubscribe = subscribeToCourseContentRuns(run.courseId, listener);

    await expect(
      updateContentRun(run._id, { status: 'running', stage: 'chunking', completedUnits: 1, totalUnits: 4 }),
    ).rejects.toThrow('content-run-conflict');
    unsubscribe();

    expect(findOneAndUpdate).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it('never mutates a terminal run', async () => {
    const run = materialRun({ status: 'completed', stage: 'classifying', completedUnits: 2, totalUnits: 2 });
    docs.push(run);

    await expect(
      updateContentRun(run._id, { status: 'running', stage: 'classifying' }),
    ).rejects.toThrow('content-run-conflict');
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('allows partial only when generation has both successful Drafts and failures', async () => {
    const run = await createQuestionGenerationRun({
      courseId: new ObjectId(),
      requestedBy: 'PUID-1',
      loId: new ObjectId(),
      count: 2,
      type: 'mcq',
      models: { embedding: 'embed', generator: 'gen', validator: 'val', reviewer: 'review' },
    });
    await updateContentRun(run._id, { status: 'running', stage: 'persisting' });
    const questionId = new ObjectId();

    await expect(
      updateContentRun(run._id, {
        status: 'partial',
        stage: 'persisting',
        completedUnits: 2,
        result: { createdQuestionIds: [questionId], failures: [] },
      }),
    ).rejects.toThrow('content-run-conflict');

    await expect(
      updateContentRun(run._id, {
        status: 'partial',
        stage: 'persisting',
        completedUnits: 2,
        result: {
          createdQuestionIds: [questionId],
          failures: [{ item: 1, stage: 'validating', code: 'validation-failed', message: 'bad output' }],
        },
      }),
    ).resolves.toMatchObject({ status: 'partial' });
  });
});

describe('ending generation runs', () => {
  function generationRun(courseId: ObjectId) {
    return createQuestionGenerationRun({
      courseId,
      requestedBy: 'PUID-1',
      loId: new ObjectId(),
      count: 3,
      type: 'mcq',
      models: { embedding: 'embed', generator: 'gen', validator: 'val', reviewer: 'review' },
    });
  }

  it('ends a running run so the pipeline cannot write progress or start another step', async () => {
    const courseId = new ObjectId();
    const run = await generationRun(courseId);
    await updateContentRun(run._id, { status: 'running', stage: 'generating' });

    const ended = await endGenerationRun(courseId, run._id);

    expect(ended).toMatchObject({ status: 'failed', error: { code: 'generation-ended', atStage: 'generating', retryable: true } });
    await expect(updateContentRun(run._id, { status: 'running', stage: 'generating' })).rejects.toThrow('content-run-conflict');
    await expect(assertContentRunActive(run._id)).rejects.toThrow('content-run-conflict');
  });

  it('ends a queued run before its job starts', async () => {
    const courseId = new ObjectId();
    const run = await generationRun(courseId);

    await expect(endGenerationRun(courseId, run._id)).resolves.toMatchObject({ status: 'failed', stage: 'queued' });
  });

  it('retries when a pipeline progress write lands between the read and the write', async () => {
    const courseId = new ObjectId();
    const run = await generationRun(courseId);
    await updateContentRun(run._id, { status: 'running', stage: 'generating' });
    findOneAndUpdate.mockImplementationOnce(async () => {
      // The pipeline's write wins the revision race.
      const index = docs.findIndex((doc) => doc._id.equals(run._id));
      docs[index] = { ...docs[index]!, revision: docs[index]!.revision + 1 };
      return null;
    });

    await expect(endGenerationRun(courseId, run._id)).resolves.toMatchObject({ status: 'failed' });
    expect(findOneAndUpdate).toHaveBeenCalledTimes(3);
  });

  it('returns a terminal run unchanged, and refuses material runs and runs from another course', async () => {
    const courseId = new ObjectId();
    const run = await generationRun(courseId);
    await updateContentRun(run._id, { status: 'running', stage: 'generating' });
    await endGenerationRun(courseId, run._id);
    const writes = findOneAndUpdate.mock.calls.length;

    await expect(endGenerationRun(courseId, run._id)).resolves.toMatchObject({ status: 'failed' });
    expect(findOneAndUpdate).toHaveBeenCalledTimes(writes);

    const material = materialRun({ courseId });
    docs.push(material);
    await expect(endGenerationRun(courseId, material._id)).rejects.toThrow('content-run-not-generation');
    await expect(endGenerationRun(new ObjectId(), run._id)).rejects.toThrow('content-run-not-found');
  });

  it('ends every active generation run in the course and nothing else', async () => {
    const courseId = new ObjectId();
    const queued = await generationRun(courseId);
    const running = await generationRun(courseId);
    await updateContentRun(running._id, { status: 'running', stage: 'reviewing' });
    const otherCourse = await generationRun(new ObjectId());
    const material = materialRun({ courseId, status: 'running', stage: 'embedding' });
    docs.push(material);

    await expect(endActiveGenerationRuns(courseId)).resolves.toBe(2);

    expect((await getContentRun(queued._id))?.error?.code).toBe('generation-ended');
    expect((await getContentRun(running._id))?.error?.code).toBe('generation-ended');
    expect((await getContentRun(otherCourse._id))?.status).toBe('queued');
    expect((await getContentRun(material._id))?.status).toBe('running');
  });
});

describe('content run listing and startup reconciliation', () => {
  it('filters recent course history by kind/status', async () => {
    const courseId = new ObjectId();
    docs.push(
      materialRun({ courseId, status: 'failed' }),
      materialRun({ courseId, status: 'completed', stage: 'classifying' }),
      materialRun({ courseId: new ObjectId(), status: 'failed' }),
    );

    const runs = await listCourseContentRuns(courseId, { kind: 'material-ingest', status: 'failed', limit: 10 });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.courseId.equals(courseId)).toBe(true);
  });

  it('fails interrupted runs and queued runs whose Agenda job is missing', async () => {
    const running = materialRun({ status: 'running', stage: 'embedding' });
    const queued = materialRun();
    docs.push(running, queued);
    jest.mocked(hasPendingJob).mockResolvedValue(false);

    const result = await reconcileContentRuns();

    expect(result).toEqual({ interrupted: 1, missingJobs: 1 });
    expect((await getContentRun(running._id))?.error?.code).toBe('server-restarted');
    expect((await getContentRun(queued._id))?.error?.code).toBe('content-run-job-missing');
  });
});

it('persists streamed previews before publishing without evicting stage history or advancing completed units', async () => {
  const run = await createQuestionGenerationRun({ courseId: new ObjectId(), requestedBy: 'PUID-1', loId: new ObjectId(), count: 1, type: 'mcq', models: { embedding: 'embed', generator: 'gen', validator: 'val', reviewer: 'review' } });
  const started = await updateContentRun(run._id, { status: 'running', stage: 'generating' });
  const seen: unknown[] = [];
  const close = subscribeToCourseContentRuns(run.courseId, value => seen.push(value));
  const updated = await updateContentRun(run._id, { preview: { item: 0, attempt: 1, stem: 'Two forces' } });
  expect(updated.events).toEqual(started.events);
  expect(updated.revision).toBe(started.revision+1);
  expect(updated.completedUnits).toBe(0);
  expect(persistedBeforePublish).toBe(true);
  expect(seen).toEqual([expect.objectContaining({ preview: { item: 0, attempt: 1, stem: 'Two forces' } })]);
  await updateContentRun(run._id, { status: 'failed', error: { code: 'generation-ended', message: 'Ended', atStage: 'generating', retryable: true } });
  await expect(updateContentRun(run._id, { preview: { item: 0, attempt: 1, stem: 'Late text' } })).rejects.toThrow('content-run-conflict');
  close();
});

 it('persists structure drafts on the course stream, enforces stage order and stops them independently', async () => {
  const run = await createStructureGenerationRun({ courseId: new ObjectId(), requestedBy: 'instructor', options: { materialIds: [new ObjectId().toHexString()] } });
  await updateContentRun(run._id, { status: 'running', stage: 'analyzing', totalUnits: 3 });
  await updateContentRun(run._id, { stage: 'synthesizing', completedUnits: 3 });
  const snapshot = await updateContentRun(run._id, { structurePreview: { themes: [{ name: 'Forces', los: [{ name: 'Calculate' }] }] } });
  expect(snapshot.kind === 'structure-generation' && snapshot.structurePreview?.themes[0].name).toBe('Forces');
  await expect(updateContentRun(run._id, { stage: 'analyzing' })).rejects.toThrow('content-run-conflict');
  await endGenerationRun(run.courseId, run._id);
  await expect(updateContentRun(run._id, { structurePreview: { themes: [] } })).rejects.toThrow('content-run-conflict');
});


it('preserves an indexed source when only advisory classification was interrupted', async () => {
  const run = materialRun({ status: 'running', stage: 'classifying' }); docs.push(run);
  if (run.kind !== 'material-ingest') throw new Error('Expected material fixture.');
  const updateOne = jest.fn();
  jest.mocked(materialsCol).mockReturnValue({ findOne: jest.fn().mockResolvedValue({ _id: run.input.materialId, activeRunId: run._id, status: 'ready' }), updateOne, updateMany: jest.fn() } as never);
  jest.mocked(getMaterialSourceReadiness).mockResolvedValue({ ready: true } as never);
  await reconcileContentRuns();
  expect(updateOne).not.toHaveBeenCalled();
  expect((await getContentRun(run._id))?.status).toBe('failed');
});

it('enables retry for an interrupted upload without a complete indexed manifest', async () => {
  const run = materialRun({ status: 'running', stage: 'embedding' }); docs.push(run);
  if (run.kind !== 'material-ingest') throw new Error('Expected material fixture.');
  const updateOne = jest.fn().mockResolvedValue({ matchedCount: 1 });
  jest.mocked(materialsCol).mockReturnValue({ findOne: jest.fn().mockResolvedValue({ _id: run.input.materialId, activeRunId: run._id, status: 'processing' }), updateOne, updateMany: jest.fn() } as never);
  await reconcileContentRuns();
  expect(updateOne).toHaveBeenCalledWith(expect.objectContaining({ activeRunId: run._id, status: 'processing' }), expect.objectContaining({ $set: expect.objectContaining({ status: 'failed' }), $unset: { sourceManifest: '' } }));
});
