// Pure-logic tests for the batch planner's combination rows (multi-LO batch
// generation). No DOM needed — the helpers are plain data logic; importing
// the dialog module pulls in dom.ts/api.ts without touching `document`, the
// same as review-queue.test.ts. See
// client/src/views/instructor/generation-plan-dialog.ts.
import {
  combinationAddable,
  combinationCellAllowed,
  combinationKey,
  defaultCombinationCounts,
  MAX_COMBINATION_SECONDARIES,
  numberedLoName,
  topicLoNumber,
} from '../../client/src/views/instructor/generation-plan-dialog';
import type { CourseTree } from '../../client/src/api';

describe('Topic / LO numbering', () => {
  const tree = {
    themes: [
      { _id: 't1', name: 'Budgeting', los: [{ _id: 'lo-a', name: 'Build a budget' }, { _id: 'lo-b', name: 'Track spending' }] },
      { _id: 't2', name: 'Saving', los: [{ _id: 'lo-c', name: 'Match accounts to goals' }] },
      { _id: 't3', name: 'Empty topic' },
    ],
  } as unknown as CourseTree;

  it('numbers an LO by its position in the course outline', () => {
    expect(topicLoNumber(tree, 'lo-b')).toBe('Topic 1 / LO 2');
    expect(topicLoNumber(tree, 'lo-c')).toBe('Topic 2 / LO 1');
  });

  it('falls back to the name when the LO or the outline is missing', () => {
    expect(topicLoNumber(tree, 'lo-missing')).toBeUndefined();
    expect(topicLoNumber(undefined, 'lo-a')).toBeUndefined();
    expect(numberedLoName(tree, 'lo-c', 'Match accounts to goals')).toBe('Topic 2 / LO 1: Match accounts to goals');
    expect(numberedLoName(undefined, 'lo-c', 'Match accounts to goals')).toBe('Match accounts to goals');
  });
});

describe('combinationKey', () => {
  it('joins the primary and secondaries in order, so order is part of identity', () => {
    expect(combinationKey({ loId: 'a', secondaryLoIds: ['b', 'c'] })).toBe('a+b+c');
    expect(combinationKey({ loId: 'a', secondaryLoIds: ['c', 'b'] })).not.toBe('a+b+c');
  });
});

describe('combinationCellAllowed', () => {
  it('offers calculation at hard only and conceptual at every tier', () => {
    expect(combinationCellAllowed('hard', 'calculation')).toBe(true);
    expect(combinationCellAllowed('medium', 'calculation')).toBe(false);
    expect(combinationCellAllowed('easy', 'calculation')).toBe(false);
    for (const tier of ['easy', 'medium', 'hard'] as const) expect(combinationCellAllowed(tier, 'conceptual')).toBe(true);
  });
});

describe('defaultCombinationCounts', () => {
  it('starts a new row with one hard calculation question and nothing else', () => {
    const counts = defaultCombinationCounts();
    expect(counts.hard.calculation).toBe(1);
    const rest = [counts.easy.calculation, counts.easy.conceptual, counts.medium.calculation, counts.medium.conceptual, counts.hard.conceptual];
    expect(rest.every((n) => n === 0)).toBe(true);
  });
});

describe('combinationAddable', () => {
  const none = new Set<string>();

  it('needs a primary and at least one secondary', () => {
    expect(combinationAddable({ loId: '', secondaryLoIds: ['b'] }, none)).toBe(false);
    expect(combinationAddable({ loId: 'a', secondaryLoIds: [] }, none)).toBe(false);
    expect(combinationAddable({ loId: 'a', secondaryLoIds: ['', ''] }, none)).toBe(false);
    expect(combinationAddable({ loId: 'a', secondaryLoIds: ['b'] }, none)).toBe(true);
  });

  it('refuses repeats, more than the cap, and a combination already in the plan', () => {
    expect(combinationAddable({ loId: 'a', secondaryLoIds: ['a'] }, none)).toBe(false);
    expect(combinationAddable({ loId: 'a', secondaryLoIds: ['b', 'b'] }, none)).toBe(false);
    expect(combinationAddable({ loId: 'a', secondaryLoIds: ['b', 'c', 'd'] }, none)).toBe(false);
    expect(MAX_COMBINATION_SECONDARIES).toBe(2);
    expect(combinationAddable({ loId: 'a', secondaryLoIds: ['b'] }, new Set(['a+b']))).toBe(false);
  });

  it('ignores blank picks when judging the key', () => {
    expect(combinationAddable({ loId: 'a', secondaryLoIds: ['', 'b'] }, new Set(['a+b']))).toBe(false);
    expect(combinationAddable({ loId: 'a', secondaryLoIds: ['', 'b'] }, none)).toBe(true);
  });
});
