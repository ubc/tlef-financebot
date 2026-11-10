// Decision tabs for the TA review queue (views/ta/review-queue.ts). Moved here
// from the retired instructor review-queue.ts (2026-11-09); DOM-free so it
// unit-tests under node.
import type { QuestionLabel } from '../../api.js';

export type QueueTab = 'all' | 'flagged' | 'agent-flag' | 'agent-reject' | 'agent-pass';

const QUEUE_TABS: QueueTab[] = ['all', 'flagged', 'agent-flag', 'agent-reject', 'agent-pass'];

/** The minimal shape `matchesTab`/`queueTabCounts` need. `agentDecision` is
 * `undefined` until enrichment resolves (or if it failed for that item),
 * which correctly excludes it from every Agent: tab. */
export interface QueueTabInput {
  labels: QuestionLabel[];
  agentDecision?: { decision: 'pass' | 'flag' | 'reject' } | undefined;
}

/** Does `item` belong on `tab`? 'all' always matches; 'flagged' reads the
 * `student-flagged` overlay label; the Agent: tabs match the decision exactly
 * and never match an item whose decision hasn't loaded. */
export function matchesTab(item: QueueTabInput, tab: QueueTab): boolean {
  switch (tab) {
    case 'all':
      return true;
    case 'flagged':
      return item.labels.includes('student-flagged');
    case 'agent-flag':
      return item.agentDecision?.decision === 'flag';
    case 'agent-reject':
      return item.agentDecision?.decision === 'reject';
    case 'agent-pass':
      return item.agentDecision?.decision === 'pass';
  }
}

/** Live per-tab counts over the full (unfiltered) queue. */
export function queueTabCounts(items: QueueTabInput[]): Record<QueueTab, number> {
  const counts = {} as Record<QueueTab, number>;
  for (const tab of QUEUE_TABS) counts[tab] = items.filter((item) => matchesTab(item, tab)).length;
  return counts;
}
