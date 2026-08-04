// Pure-logic tests for flag grouping/sorting, extracted from
// views/instructor/flags.ts so the instructor and TA flag views group
// identically. See client/src/flag-groups.ts.
import {
  groupFlags,
  isGroupOpen,
  latestEscalation,
  openFlags,
  sortGroups,
} from '../../client/src/flag-groups';
import type { Flag } from '../../client/src/api';

function flag(overrides: Partial<Flag> = {}): Flag {
  return {
    id: 'f1',
    courseId: 'c1',
    questionId: 'q1',
    questionVersionId: 'v1',
    puid: 'student-1',
    state: 'open',
    createdAt: '2026-08-01T00:00:00.000Z',
    question: null,
    currentVersion: null,
    ...overrides,
  } as Flag;
}

describe('groupFlags', () => {
  it('groups by questionVersionId, not questionId', () => {
    const groups = groupFlags([
      flag({ id: 'f1', questionVersionId: 'v1' }),
      flag({ id: 'f2', questionVersionId: 'v1' }),
      flag({ id: 'f3', questionVersionId: 'v2' }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].flags.map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(groups[1].flags.map((f) => f.id)).toEqual(['f3']);
  });

  it('returns an empty array for no flags', () => {
    expect(groupFlags([])).toEqual([]);
  });
});

describe('openFlags / isGroupOpen', () => {
  it('counts both open and escalated as open — an escalated flag still needs an instructor', () => {
    const [group] = groupFlags([
      flag({ id: 'f1', state: 'open' }),
      flag({ id: 'f2', state: 'escalated' }),
      flag({ id: 'f3', state: 'resolved-corrected' }),
    ]);
    expect(openFlags(group).map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(isGroupOpen(group)).toBe(true);
  });

  it('is closed when every flag is resolved', () => {
    const [group] = groupFlags([flag({ state: 'resolved-corrected' })]);
    expect(isGroupOpen(group)).toBe(false);
  });
});

describe('sortGroups', () => {
  it('puts open groups before resolved ones, newest first within each', () => {
    const groups = groupFlags([
      flag({ id: 'old-open', questionVersionId: 'v1', createdAt: '2026-07-01T00:00:00.000Z' }),
      flag({ id: 'new-resolved', questionVersionId: 'v2', state: 'resolved-corrected', createdAt: '2026-08-02T00:00:00.000Z' }),
      flag({ id: 'new-open', questionVersionId: 'v3', createdAt: '2026-08-01T00:00:00.000Z' }),
    ]);
    expect(sortGroups(groups).map((g) => g.flags[0].id)).toEqual(['new-open', 'old-open', 'new-resolved']);
  });

  it('does not mutate its input', () => {
    const groups = groupFlags([
      flag({ id: 'a', questionVersionId: 'v1', createdAt: '2026-07-01T00:00:00.000Z' }),
      flag({ id: 'b', questionVersionId: 'v2', createdAt: '2026-08-01T00:00:00.000Z' }),
    ]);
    const before = groups.map((g) => g.questionVersionId);
    sortGroups(groups);
    expect(groups.map((g) => g.questionVersionId)).toEqual(before);
  });
});

describe('latestEscalation', () => {
  const rec = (at: string, recommendation: 'correct' | 'archive' | 'clear', note?: string) =>
    ({ recommendation, note, puid: 'PUID-TA', at });

  it('returns null when no flag in the group was escalated', () => {
    const [group] = groupFlags([flag()]);
    expect(latestEscalation(group)).toBeNull();
  });

  it('returns the most recent recommendation across the group', () => {
    const [group] = groupFlags([
      flag({ id: 'f1', state: 'escalated', taRecommendation: rec('2026-08-01T00:00:00.000Z', 'clear', 'looks fine') }),
      flag({ id: 'f2', state: 'escalated', taRecommendation: rec('2026-08-03T00:00:00.000Z', 'archive', 'wrong answer key') }),
    ]);
    expect(latestEscalation(group)).toEqual(rec('2026-08-03T00:00:00.000Z', 'archive', 'wrong answer key'));
  });

  it('tolerates a recommendation with no note', () => {
    const [group] = groupFlags([flag({ state: 'escalated', taRecommendation: rec('2026-08-01T00:00:00.000Z', 'correct') })]);
    expect(latestEscalation(group)?.note).toBeUndefined();
  });
});
