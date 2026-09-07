// Pure-logic tests for the Review Queue's filter-tab membership/counts (I5,
// Task 15 Task F). No DOM needed — `matchesTab`/`queueTabCounts` are plain
// array/object logic; importing review-queue.ts also pulls in dom.ts's `el`
// (DOM-touching) and api.ts, but merely importing doesn't execute any
// document access, so this is safe under jest's node test environment. See
// client/src/views/instructor/review-queue.ts.
import {
  matchesTab,
  matchesType,
  queueTabCounts,
  runHighlightSummary,
  QUEUE_TYPE_FILTERS,
  type QueueTab,
  type QueueTabInput,
} from '../../client/src/views/instructor/review-queue';

describe('matchesType (question-type filter)', () => {
  const mcq = { current: { type: 'mcq' as const } };
  const tf = { current: { type: 'true-false' as const } };

  it('"all" matches both types; each specific filter matches only its own', () => {
    expect(matchesType(mcq, 'all')).toBe(true);
    expect(matchesType(tf, 'all')).toBe(true);
    expect(matchesType(mcq, 'mcq')).toBe(true);
    expect(matchesType(tf, 'mcq')).toBe(false);
    expect(matchesType(tf, 'true-false')).toBe(true);
    expect(matchesType(mcq, 'true-false')).toBe(false);
  });

  it('offers exactly the three filters, all first', () => {
    expect(QUEUE_TYPE_FILTERS).toEqual(['all', 'mcq', 'true-false']);
  });
});

function item(overrides: Partial<QueueTabInput> = {}): QueueTabInput {
  return { labels: [], agentDecision: undefined, ...overrides };
}

describe('matchesTab', () => {
  it('"all" matches every item regardless of labels or agent decision', () => {
    expect(matchesTab(item(), 'all')).toBe(true);
    expect(matchesTab(item({ labels: ['student-flagged'] }), 'all')).toBe(true);
    expect(matchesTab(item({ agentDecision: { decision: 'reject' } }), 'all')).toBe(true);
  });

  it('"flagged" matches only items carrying the student-flagged label', () => {
    expect(matchesTab(item({ labels: ['student-flagged'] }), 'flagged')).toBe(true);
    expect(matchesTab(item({ labels: ['source-changed'] }), 'flagged')).toBe(false);
    expect(matchesTab(item(), 'flagged')).toBe(false);
  });

  it('"agent-flag"/"agent-reject"/"agent-pass" match the corresponding agentDecision.decision exactly', () => {
    expect(matchesTab(item({ agentDecision: { decision: 'flag' } }), 'agent-flag')).toBe(true);
    expect(matchesTab(item({ agentDecision: { decision: 'reject' } }), 'agent-flag')).toBe(false);
    expect(matchesTab(item({ agentDecision: { decision: 'reject' } }), 'agent-reject')).toBe(true);
    expect(matchesTab(item({ agentDecision: { decision: 'pass' } }), 'agent-pass')).toBe(true);
    expect(matchesTab(item({ agentDecision: { decision: 'pass' } }), 'agent-reject')).toBe(false);
  });

  it('an item with no agentDecision (not yet enriched, or the lookup failed) matches no Agent: tab', () => {
    const noDecision = item();
    expect(matchesTab(noDecision, 'agent-flag')).toBe(false);
    expect(matchesTab(noDecision, 'agent-reject')).toBe(false);
    expect(matchesTab(noDecision, 'agent-pass')).toBe(false);
  });

  it('a flagged item with an agent decision matches both its tab and "flagged"', () => {
    const both = item({ labels: ['student-flagged'], agentDecision: { decision: 'flag' } });
    expect(matchesTab(both, 'flagged')).toBe(true);
    expect(matchesTab(both, 'agent-flag')).toBe(true);
    expect(matchesTab(both, 'agent-reject')).toBe(false);
  });
});

describe('queueTabCounts', () => {
  it('returns zero counts for an empty queue', () => {
    expect(queueTabCounts([])).toEqual({
      all: 0,
      flagged: 0,
      'agent-flag': 0,
      'agent-reject': 0,
      'agent-pass': 0,
    });
  });

  it('counts each tab independently over a mixed queue', () => {
    const items: QueueTabInput[] = [
      item({ labels: ['student-flagged'], agentDecision: { decision: 'flag' } }),
      item({ labels: ['student-flagged'] }), // flagged, no agent decision yet
      item({ agentDecision: { decision: 'reject' } }),
      item({ agentDecision: { decision: 'pass' } }),
      item({ agentDecision: { decision: 'pass' } }),
      item(), // no label, no decision — only counts toward "all"
    ];
    expect(queueTabCounts(items)).toEqual({
      all: 6,
      flagged: 2,
      'agent-flag': 1,
      'agent-reject': 1,
      'agent-pass': 2,
    });
  });

  it("every tab's count matches items.filter(i => matchesTab(i, tab)).length for each tab", () => {
    const items: QueueTabInput[] = [
      item({ labels: ['student-flagged'] }),
      item({ agentDecision: { decision: 'reject' } }),
      item({ agentDecision: { decision: 'pass' } }),
    ];
    const counts = queueTabCounts(items);
    const tabs: QueueTab[] = ['all', 'flagged', 'agent-flag', 'agent-reject', 'agent-pass'];
    for (const tab of tabs) {
      expect(counts[tab]).toBe(items.filter((i) => matchesTab(i, tab)).length);
    }
  });
});

describe('runHighlightSummary (arrival from a generation run)', () => {
  it('counts the run questions still in the queue and those that have left it', () => {
    expect(runHighlightSummary(['q1', 'q2', 'q3'], ['q2', 'q9', 'q3'])).toEqual({ shown: 2, missing: 1 });
  });

  it('is all-missing when none of the run remains, and empty for a run that created nothing', () => {
    expect(runHighlightSummary(['q1'], ['q2'])).toEqual({ shown: 0, missing: 1 });
    expect(runHighlightSummary([], ['q2'])).toEqual({ shown: 0, missing: 0 });
  });
});
