// The batch planner: Auto fills a per-LO grid from the tier gap and the LO's
// kind; enqueueing makes one run per cell with an explicit difficulty and
// kind. See server/src/services/generation-plan.service.ts.
jest.mock('../../server/src/components/mongodb/collections', () => ({
  losCol: jest.fn(),
  themesCol: jest.fn(),
  questionsCol: jest.fn(),
  questionVersionsCol: jest.fn(),
}));
jest.mock('../../server/src/services/generation.service', () => ({
  enqueueGenerationRun: jest.fn(),
}));

import { ObjectId } from 'mongodb';
import {
  losCol, questionsCol, questionVersionsCol, themesCol,
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

  it('enqueues one run per cell with its difficulty and kind, and reports per-cell failures without stopping', async () => {
    const loA = new ObjectId(); const loB = new ObjectId();
    const runA = new ObjectId();
    jest.mocked(enqueueGenerationRun)
      .mockResolvedValueOnce(runA)
      .mockRejectedValueOnce(new Error('generation-no-assigned-materials'));

    const result = await enqueueGenerationPlan(courseId, [
      { loId: loA, difficulty: 'hard', kind: 'calculation', count: 1 },
      { loId: loB, difficulty: 'easy', kind: 'conceptual', count: 2 },
      { loId: loB, difficulty: 'medium', kind: 'conceptual', count: 0 },
    ], 'PUID-INSTR');

    expect(enqueueGenerationRun).toHaveBeenCalledTimes(2);
    expect(enqueueGenerationRun).toHaveBeenCalledWith(expect.objectContaining({
      courseId, loId: loA, count: 1, type: 'mcq', difficulty: 'hard', kind: 'calculation', byPuid: 'PUID-INSTR',
    }));
    expect(result.runs).toEqual([
      expect.objectContaining({ loId: loA, runId: runA }),
      expect.objectContaining({ loId: loB, error: 'generation-no-assigned-materials' }),
      expect.objectContaining({ loId: loB, difficulty: 'medium', error: 'generation-plan-invalid-count' }),
    ]);
  });
});
