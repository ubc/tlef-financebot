// Pure-logic tests for the instructor Questions workspace helpers
// (client/src/views/instructor/questions-model.ts). Importing api.ts is safe
// under node: nothing touches the DOM at import time.
import {
  bulkActionsFor,
  defaultTab,
  EMPTY_FILTERS,
  filterRows,
  hasActiveFilters,
  heldTopicNames,
  hiddenReasonText,
  legacyQuestionsPath,
  parseTab,
  questionsPath,
  releaseState,
  runBulk,
  runHighlightSummary,
} from '../../client/src/views/instructor/questions-model';
import type { CourseTree, QuestionWorkspace, WorkspaceRow } from '../../client/src/api';

const counts: QuestionWorkspace['counts'] = { review: 0, approved: 3, approvedVisible: 1, approvedWaiting: 2, flags: 0, paused: 0, archived: 0 };

describe('tabs and paths', () => {
  it('parses only known tabs', () => {
    expect(parseTab('flags')).toBe('flags');
    expect(parseTab('bank')).toBeNull();
    expect(parseTab(null)).toBeNull();
  });

  it('defaults to To review only while something waits there', () => {
    expect(defaultTab(counts)).toBe('approved');
    expect(defaultTab({ ...counts, review: 2 })).toBe('review');
  });

  it('builds the Questions path with only the set params', () => {
    expect(questionsPath('c1')).toBe('/instructor/course/c1/questions');
    expect(questionsPath('c1', { tab: 'review', runId: 'r9' })).toBe('/instructor/course/c1/questions?tab=review&runId=r9');
  });

  it('redirects the old pages to their tab and keeps the selection', () => {
    const q = (s: string) => new URLSearchParams(s);
    expect(legacyQuestionsPath('/instructor/course/c1/queue', q('runId=r1'))).toBe('/instructor/course/c1/questions?tab=review&runId=r1');
    expect(legacyQuestionsPath('/instructor/course/c1/bank', q('q=abc'))).toBe('/instructor/course/c1/questions?tab=approved&q=abc');
    expect(legacyQuestionsPath('/instructor/course/c1/flags', q('question=abc'))).toBe('/instructor/course/c1/questions?tab=flags&q=abc');
    expect(legacyQuestionsPath('/instructor/course/c1/flags', q('flag=f1'))).toBe('/instructor/course/c1/questions?tab=flags&flag=f1');
    expect(legacyQuestionsPath('/instructor/course/c1/bank/abc', q(''))).toBeNull();
    expect(legacyQuestionsPath('/ta/course/c1/bank', q(''))).toBeNull();
  });
});

describe('filterRows', () => {
  const tree = {
    course: {},
    themes: [{ _id: 't1', name: 'Budgeting', los: [{ _id: 'lo1', name: 'Build a personal budget' }] }],
  } as unknown as CourseTree;
  function row(overrides: Partial<WorkspaceRow>): WorkspaceRow {
    return {
      id: Math.random().toString(16).slice(2),
      state: 'approved',
      labels: [],
      loIds: [],
      themeIds: [],
      current: { _id: 'v', stem: 'What is NPV?', type: 'mcq', difficulty: 'easy', options: [] },
      openFlagCount: 0,
      studentVisible: false,
      ...overrides,
    } as WorkspaceRow;
  }

  it('searches stem and LO text', () => {
    const byLo = row({ loIds: ['lo1'] });
    const other = row({});
    expect(filterRows([byLo, other], { ...EMPTY_FILTERS, search: 'personal budget' }, tree, 'approved')).toEqual([byLo]);
    expect(filterRows([byLo, other], { ...EMPTY_FILTERS, search: 'npv' }, tree, 'approved')).toHaveLength(2);
  });

  it('filters by AI verdict, including questions with none', () => {
    const flagged = row({ agentVerdict: 'flag' });
    const none = row({});
    expect(filterRows([flagged, none], { ...EMPTY_FILTERS, verdict: 'flag' }, tree, 'review')).toEqual([flagged]);
    expect(filterRows([flagged, none], { ...EMPTY_FILTERS, verdict: 'none' }, tree, 'review')).toEqual([none]);
  });

  it('applies the approved sub-filter only on the Approved tab', () => {
    const visible = row({ studentVisible: true });
    const waiting = row({});
    expect(filterRows([visible, waiting], { ...EMPTY_FILTERS, approvedView: 'waiting' }, tree, 'approved')).toEqual([waiting]);
    expect(filterRows([visible, waiting], { ...EMPTY_FILTERS, approvedView: 'waiting' }, tree, 'flags')).toHaveLength(2);
  });

  it('knows when filters are active', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, approvedView: 'visible' })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, type: 'mcq' })).toBe(true);
  });
});

describe('release wording', () => {
  it('classifies a Topic release', () => {
    expect(releaseState({ released: true, availableFrom: '2026-01-01T00:00:00Z' })).toBe('released');
    expect(releaseState({ released: false, availableFrom: '2027-01-01T00:00:00Z' })).toBe('scheduled');
    expect(releaseState({ released: false, availableFrom: null })).toBe('hidden');
  });

  it('names held topics and words the hidden reason', () => {
    const release = { coursePublished: true, hiddenApprovedCount: 1, themes: [
      { themeId: 't1', name: 'Budgeting', order: 0, revision: 0, availableFrom: null, released: false, approvedCount: 1 },
      { themeId: 't2', name: 'Bonds', order: 1, revision: 0, availableFrom: '2026-01-01', released: true, approvedCount: 0 },
    ] };
    expect(heldTopicNames(release, ['t1', 't2'])).toEqual(['Budgeting']);
    expect(hiddenReasonText('topic-unreleased', ['Budgeting'])).toBe('Not visible: Budgeting is not released.');
    expect(hiddenReasonText(undefined)).toBe('Visible to students.');
  });
});

describe('bulk', () => {
  it('offers state-appropriate bulk actions', () => {
    expect(bulkActionsFor('review').map((a) => a.label)).toEqual(['Approve selected', 'Reject selected']);
    expect(bulkActionsFor('paused').map((a) => a.to)).toEqual(['approved', 'archived']);
    expect(bulkActionsFor('archived')).toEqual([]);
  });

  it('reports each failure and keeps input order', async () => {
    const outcome = await runBulk(['a', 'b', 'c', 'd', 'e'], async (id) => {
      if (id === 'b' || id === 'e') throw new Error(`no ${id}`);
    }, 2);
    expect(outcome.succeeded).toEqual(['a', 'c', 'd']);
    expect(outcome.failed.map((f) => f.item)).toEqual(['b', 'e']);
  });

  it('summarizes a run highlight', () => {
    expect(runHighlightSummary(['a', 'b', 'c'], ['a', 'x'])).toEqual({ shown: 1, missing: 2 });
  });
});
