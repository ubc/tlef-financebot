// Flag grouping/sorting shared by the instructor flag queue and the TA flag
// triage view. DOM-free so it unit-tests without jsdom, and shared so the two
// views cannot drift on what constitutes "one row".
import type { Flag, TaRecommendation } from './api.js';

/** One row: every Flag raised against the same `questionVersionId`. */
export interface FlagGroup {
  questionVersionId: string;
  questionId: string;
  question: Flag['question'];
  version: Flag['currentVersion'];
  flags: Flag[];
}

export function groupFlags(flags: Flag[]): FlagGroup[] {
  const groups = new Map<string, FlagGroup>();
  for (const flag of flags) {
    let group = groups.get(flag.questionVersionId);
    if (!group) {
      group = {
        questionVersionId: flag.questionVersionId,
        questionId: flag.questionId,
        question: flag.question,
        version: flag.currentVersion,
        flags: [],
      };
      groups.set(flag.questionVersionId, group);
    }
    group.flags.push(flag);
  }
  return [...groups.values()];
}

export function openFlags(group: FlagGroup): Flag[] {
  return group.flags.filter((f) => f.state === 'open' || f.state === 'escalated');
}

export function isGroupOpen(group: FlagGroup): boolean {
  return openFlags(group).length > 0;
}

export function byCreatedAtDesc(a: Flag, b: Flag): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

/** Whether a TA has escalated this group, keyed on flag STATE rather than on
 * the presence of a `taRecommendation`. `escalateFlag` (tas.service.ts) always
 * sets both `state: 'escalated'` and `taRecommendation` together, but
 * `proactivelyEscalateQuestion` — the "Escalate" button on the TA question
 * page — inserts a flag with `state: 'escalated'` and NO `taRecommendation`.
 * Testing for a recommendation (as `sortGroups` and the instructor queue's
 * badge both used to) makes that second shape invisible: it neither sorts to
 * the top nor gets the "Escalated by TA" badge, indistinguishable from an
 * ordinary student flag. `latestEscalation` below is still the right function
 * for rendering the recommendation TEXT — only a recommendation-bearing
 * escalation has text to show — but "is this escalated at all" must check
 * `state`, not `taRecommendation`. */
export function isGroupEscalated(group: FlagGroup): boolean {
  return group.flags.some((flag) => flag.state === 'escalated');
}

/** Unresolved groups first, then resolved groups. Within the unresolved
 * partition, a group a TA has already escalated (see `isGroupEscalated`
 * above) sorts ahead of one no one has triaged yet, regardless of which is
 * newer — that's the whole point of escalating: it's supposed to reach the
 * top of the instructor's queue, not wait behind a same-day flag nobody has
 * looked at. Everything else is most-recently-flagged-first within its
 * partition (escalated-vs-escalated, un-triaged-vs-un-triaged, and the
 * resolved partition, none of which distinguish escalation). */
export function sortGroups(groups: FlagGroup[]): FlagGroup[] {
  return [...groups].sort((a, b) => {
    const aOpen = isGroupOpen(a);
    const bOpen = isGroupOpen(b);
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    if (aOpen) {
      const aEscalated = isGroupEscalated(a);
      const bEscalated = isGroupEscalated(b);
      if (aEscalated !== bEscalated) return aEscalated ? -1 : 1;
    }
    const aLatest = [...a.flags].sort(byCreatedAtDesc)[0];
    const bLatest = [...b.flags].sort(byCreatedAtDesc)[0];
    return byCreatedAtDesc(aLatest, bLatest);
  });
}

/** The most recent TA recommendation in the group, or null if no flag in it
 * carries one. A group can hold several escalations (two TAs, or one TA
 * escalating two flags on the same version); the latest is the one that
 * reflects the current teaching-team position. Note this is null for a
 * proactive escalation (`state: 'escalated'`, no `taRecommendation`) even
 * though the group IS escalated — use `isGroupEscalated` to test escalation
 * status, and this only for the recommendation text once you know one
 * exists. */
export function latestEscalation(group: FlagGroup): TaRecommendation | null {
  const escalated = group.flags
    .map((flag) => flag.taRecommendation)
    .filter((recommendation): recommendation is TaRecommendation => Boolean(recommendation))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return escalated[0] ?? null;
}
