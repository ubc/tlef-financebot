// The batch planner: Auto fills a per-LO grid from the tier gap and the LO's
// kind; enqueueing makes one run per cell with an explicit difficulty and
// kind. See server/src/services/generation-plan.service.ts.
jest.mock('../../server/src/components/mongodb/collections', () => ({
  losCol: jest.fn(),
  themesCol: jest.fn(),
  generationSubmissionsCol: jest.fn(),
  questionsCol: jest.fn(),
  questionVersionsCol: jest.fn(),
}));
jest.mock('../../server/src/services/generation.service', () => ({
  enqueueGenerationRun: jest.fn(),
}));

import { ObjectId } from 'mongodb';
import {
  losCol, questionsCol, questionVersionsCol, themesCol, generationSubmissionsCol,
} from '../../server/src/components/mongodb/collections';
import { enqueueGenerationRun } from '../../server/src/services/generation.service';
import {
  autoGenerationPlan, enqueueGenerationPlan, splitByKind, TIER_TARGETS,
} from '../../server/src/services/generation-plan.service';
import { inferLoKind } from '../../server/src/services/courses.service';

describe('inferLoKind — the verb heuristic that seeds an LO\'s kind', () => {
  it('reads calculation, conceptual and mixed off the objective\'s verb', () => {
    expect(inferLoKind('Compute WACC and discount cash flows')).toBe('calculation');
    expect(inferLoKind('Estimate expected returns with CAPM')).toBe('calculation');
    expect(inferLoKind('Explain market efficiency')).toBe('conceptual');
    expect(inferLoKind('Distinguish firm vs enterprise value')).toBe('conceptual');
    expect(inferLoKind('Evaluate car affordability')).toBe('mixed');
    expect(inferLoKind('Compare projects with PP and PI')).toBe('mixed');
  });
});

describe('splitByKind', () => {
  it('gives a single-kind LO all of its gap in that kind', () => {
    expect(splitByKind('calculation', 'medium', 2)).toEqual([{ kind: 'calculation', count: 2 }]);
    expect(splitByKind('conceptual', 'hard', 1)).toEqual([{ kind: 'conceptual', count: 1 }]);
    expect(splitByKind('conceptual', 'easy', 0)).toEqual([]);
  });

  it('leans a mixed LO conceptual at easy and calculation at hard, splitting the rest', () => {
    expect(splitByKind('mixed', 'easy', 1)).toEqual([{ kind: 'conceptual', count: 1 }]);
    expect(splitByKind('mixed', 'hard', 1)).toEqual([{ kind: 'calculation', count: 1 }]);
    expect(splitByKind('mixed', 'medium', 2)).toEqual([{ kind: 'calculation', count: 1 }, { kind: 'conceptual', count: 1 }]);
    expect(splitByKind('mixed', 'medium', 3)).toEqual([{ kind: 'calculation', count: 2 }, { kind: 'conceptual', count: 1 }]);
  });
});

describe('autoGenerationPlan', () => {
  const courseId = new ObjectId();
  const themeId = new ObjectId();
  const wacc = new ObjectId();
  const efficiency = new ObjectId();

  beforeEach(() => {
    jest.mocked(themesCol).mockReturnValue({
      find: jest.fn(() => ({ toArray: async () => [{ _id: themeId, courseId, name: 'Capital', order: 1 }] })),
    } as never);
    jest.mocked(losCol).mockReturnValue({
      find: jest.fn(() => ({ sort: jest.fn(() => ({ toArray: async () => [
        { _id: wacc, courseId, themeId, name: 'Compute WACC', order: 1 },
        // The instructor's override wins over the verb: "Explain" would be
        // conceptual, but they want both kinds here.
        { _id: efficiency, courseId, themeId, name: 'Explain market efficiency', order: 2, kind: 'mixed' },
      ] })) })),
    } as never);
    const v1 = new ObjectId(); const v2 = new ObjectId(); const v3 = new ObjectId();
    jest.mocked(questionsCol).mockReturnValue({
      find: jest.fn((filter: { loIds: ObjectId }) => ({ toArray: async () =>
        filter.loIds.equals(wacc)
          ? [{ currentVersionId: v1 }, { currentVersionId: v2 }, { currentVersionId: v3 }]
          : [] })),
    } as never);
    jest.mocked(questionVersionsCol).mockReturnValue({
      find: jest.fn(() => ({ toArray: async () => [
        { _id: v1, difficulty: 'easy' }, { _id: v2, difficulty: 'medium' }, { _id: v3, difficulty: 'medium' },
      ] })),
    } as never);
  });

  it('fills each LO\'s gap against the tier targets, split by its effective kind', async () => {
    const rows = await autoGenerationPlan(courseId);
    expect(rows.map((r) => r.loName)).toEqual(['Compute WACC', 'Explain market efficiency']);

    // WACC: calculation LO with 1 easy + 2 medium approved → needs 1 easy, 0 medium, 1 hard.
    expect(rows[0]).toMatchObject({ loKind: 'calculation', approved: { easy: 1, medium: 2, hard: 0 } });
    expect(rows[0]!.cells).toEqual([
      { difficulty: 'easy', kind: 'calculation', count: TIER_TARGETS.easy - 1 },
      { difficulty: 'hard', kind: 'calculation', count: 1 },
    ]);
    // Market efficiency: mixed, nothing approved → full targets, split.
    expect(rows[1]).toMatchObject({ loKind: 'mixed', approved: { easy: 0, medium: 0, hard: 0 } });
    expect(rows[1]!.cells).toEqual([
      { difficulty: 'easy', kind: 'conceptual', count: 1 }, { difficulty: 'easy', kind: 'calculation', count: 1 },
      { difficulty: 'medium', kind: 'calculation', count: 1 }, { difficulty: 'medium', kind: 'conceptual', count: 1 },
      { difficulty: 'hard', kind: 'calculation', count: 1 },
    ]);
  });
});

describe('enqueueGenerationPlan', () => {
  const courseId = new ObjectId();

  it('copies the opt-in policy into every batch cell without changing requested supply', async () => {
    jest.mocked(enqueueGenerationRun).mockResolvedValue(new ObjectId());
    await enqueueGenerationPlan(courseId, [
      { loId: new ObjectId(), difficulty: 'easy', kind: 'conceptual', count: 2 },
      { loId: new ObjectId(), difficulty: 'medium', kind: 'calculation', count: 3 },
    ], 'PUID-INSTR', { qualityPolicy: 'grounded-memory-v1' });
    expect(enqueueGenerationRun).toHaveBeenCalledTimes(2);
    expect(jest.mocked(enqueueGenerationRun).mock.calls.map(([input]) => input.qualityPolicy)).toEqual(['grounded-memory-v1', 'grounded-memory-v1']);
    expect(jest.mocked(enqueueGenerationRun).mock.calls.map(([input]) => input.count)).toEqual([2, 3]);
  });

  it('enqueues one run per cell with its difficulty and kind, and reports per-cell failures without stopping', async () => {
    const loA = new ObjectId(); const loB = new ObjectId();
    const runA = new ObjectId();
    jest.mocked(enqueueGenerationRun)
      .mockResolvedValueOnce(runA)
      .mockRejectedValueOnce(new Error('generation-no-assigned-materials'));

    const result = await enqueueGenerationPlan(courseId, [
      { loId: loA, difficulty: 'hard', kind: 'calculation', type: 'true-false', count: 1 },
      { loId: loB, difficulty: 'easy', kind: 'conceptual', count: 2 },
      { loId: loB, difficulty: 'medium', kind: 'conceptual', count: 0 },
    ], 'PUID-INSTR');

    expect(enqueueGenerationRun).toHaveBeenCalledTimes(2);
    expect(enqueueGenerationRun).toHaveBeenCalledWith(expect.objectContaining({
      courseId, loId: loA, count: 1, type: 'true-false', difficulty: 'hard', kind: 'calculation', byPuid: 'PUID-INSTR',
    }));
    expect(result.runs).toEqual([
      expect.objectContaining({ loId: loA, runId: runA }),
      expect.objectContaining({ loId: loB, error: 'generation-no-assigned-materials' }),
      expect.objectContaining({ loId: loB, difficulty: 'medium', error: 'generation-plan-invalid-count' }),
    ]);
  });

  it('passes a combination cell\'s secondary objectives through to the run, and echoes them in the result', async () => {
    const primary = new ObjectId(); const secondA = new ObjectId(); const secondB = new ObjectId();
    const runId = new ObjectId();
    jest.mocked(enqueueGenerationRun).mockResolvedValueOnce(runId);

    const result = await enqueueGenerationPlan(courseId, [
      { loId: primary, secondaryLoIds: [secondA, secondB], difficulty: 'hard', kind: 'calculation', count: 1 },
      { loId: primary, difficulty: 'easy', kind: 'conceptual', count: 0 },
    ], 'PUID-INSTR');

    expect(enqueueGenerationRun).toHaveBeenCalledTimes(1);
    expect(enqueueGenerationRun).toHaveBeenCalledWith(expect.objectContaining({
      loId: primary, secondaryLoIds: [secondA, secondB], difficulty: 'hard', kind: 'calculation', count: 1,
    }));
    expect(result.runs[0]).toEqual(expect.objectContaining({ secondaryLoIds: [secondA, secondB], runId }));
    // A plain cell carries no secondary field at all, so callers can tell the two apart.
    expect(result.runs[1]).not.toHaveProperty('secondaryLoIds');
  });
});


describe('durable plan submission identity', () => {
  it('reuses deterministic run identities after response loss and rejects a changed request', async () => {
    const records = new Map<string, { fingerprint: string }>();
    jest.mocked(generationSubmissionsCol).mockReturnValue({
      insertOne: async (doc: { _id: string; fingerprint: string }) => {
        if (records.has(doc._id)) throw Object.assign(new Error('duplicate'), { code: 11000 });
        records.set(doc._id, doc); return { insertedId: doc._id };
      },
      findOne: async (query: { _id: string }) => records.get(query._id),
    } as never);
    jest.mocked(enqueueGenerationRun).mockImplementation(async input => input.runId!);
    const course = new ObjectId();
    const cells = [{ loId: new ObjectId(), count: 2, kind: 'conceptual' as const, difficulty: 'easy' as const }];
    const submission = { id: 'e3ac70b3-16ba-4bea-9f66-fb23af6f9562', prompt: 'Use scenarios' };
    const first = await enqueueGenerationPlan(course, cells, 'teacher', submission);
    const retry = await enqueueGenerationPlan(course, cells, 'teacher', submission);
    expect(retry.runs[0].runId).toEqual(first.runs[0].runId);
    await expect(enqueueGenerationPlan(course, cells, 'teacher', { ...submission, qualityPolicy: 'grounded-memory-v1' })).rejects.toThrow('generation-submission-conflict');
    const explicitBaseline = await enqueueGenerationPlan(course, cells, 'teacher', { ...submission, qualityPolicy: 'baseline' });
    expect(explicitBaseline.runs[0].runId).toEqual(first.runs[0].runId);
    await expect(enqueueGenerationPlan(course, [{ ...cells[0], count: 3 }], 'teacher', submission)).rejects.toThrow('generation-submission-conflict');
    const other = await enqueueGenerationPlan(course, cells, 'other-teacher', submission);
    expect(other.runs[0].runId).not.toEqual(first.runs[0].runId);
  });
});
