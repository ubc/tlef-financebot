jest.mock('../../server/src/components/mongodb/collections', () => ({ contentRunsCol: jest.fn() }));
jest.mock('../../server/src/components/jobs', () => ({ hasPendingJob: jest.fn() }));

import { ObjectId, type WithId } from 'mongodb';
import { contentRunsCol } from '../../server/src/components/mongodb/collections';
import { hasPendingJob } from '../../server/src/components/jobs';
import {
  createMaterialIngestRun,
  createQuestionGenerationRun,
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
