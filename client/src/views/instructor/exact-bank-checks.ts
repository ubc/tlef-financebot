import type { GenerationQualityAssessment } from '../../api.js';
import { el } from '../../dom.js';

/** A recorded normalized-content scan is separate from semantic task memory,
 * instructor acceptance and the current state of a later-changing Bank. */
export function exactBankChecks(quality: Pick<GenerationQualityAssessment, 'exactBank'>): HTMLElement {
  const section = el('section', { class: 'workspace-metadata-block gw-quality', 'aria-label': 'Exact Bank scan', style: 'overflow-wrap:anywhere' });
  const receipt = quality.exactBank;
  if (!receipt) {
    section.append(el('p', { class: 'gw-plan-note', text: 'Exact normalized Bank scan: not recorded for this assessment. Historical absence supplies no scan counts.' }));
    return section;
  }
  if (receipt.protocol !== 'course-exact-bank-v1') {
    section.append(el('p', { class: 'gw-plan-note', text: 'The recorded exact Bank scan protocol cannot be displayed. Its coverage is unavailable.' }));
    return section;
  }
  const count = (value: unknown): string => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString() : 'unavailable';
  const states = { complete: 'Complete', incomplete: 'Incomplete' };
  const reasons = { 'head-limit': 'head limit reached', deadline: 'deadline reached', 'invalid-head': 'invalid question head', 'missing-or-invalid-version': 'missing or invalid current version' };
  section.append(el('p', { class: 'gw-plan-note' }, el('strong', { text: `Exact normalized Bank scan · ${states[receipt.status] ?? 'Status unavailable'}` }),
    ` · ${count(receipt.headsScanned)} heads scanned · ${count(receipt.versionsChecked)} current versions checked · ${count(receipt.exactMatchCount)} exact matches`),
  el('p', { class: 'gw-plan-note', text: 'Normalized exact content only. Semantic task similarity uses separate bounded question memory. Exact matching does not establish conceptual novelty.' }));
  const details = el('details', {}, el('summary', { text: 'Exact scan receipt' }),
    el('p', { text: `Recorded status: ${states[receipt.status] ?? 'unavailable'}${receipt.incompleteReason ? ` · ${reasons[receipt.incompleteReason] ?? receipt.incompleteReason}` : ''}. Missing versions: ${count(receipt.missingVersions)}. Invalid versions: ${count(receipt.invalidVersions)}. Invalid heads: ${count(receipt.invalidHeads)}.` }),
    el('p', { text: `Observed unscanned-head lower bound: ${count(receipt.unscannedHeadsLowerBound)}. This is not an estimate of the remaining Bank size. Head batches: ${count(receipt.headBatches)}.` }),
    el('p', { class: 'gw-plan-note', text: 'Scope: current Draft, Pending Review, Reviewed, Approved and Paused versions in this course. Archived versions are outside this scan.' }),
    el('p', { class: 'gw-plan-note', text: 'This receipt describes current-version content at the recorded check. The scan is best effort; later Bank changes are not covered by this historical receipt.' }));
  if (receipt.excludedQuestionId) details.append(el('p', { text: `Excluded original question: ${receipt.excludedQuestionId}.` }));
  const matches = Array.isArray(receipt.matches) ? receipt.matches : [];
  if (matches.length) details.append(el('p', { text: `Listed exact matches: ${count(Math.min(matches.length, 12))}${receipt.matchesTruncated || matches.length > 12 ? ' · match list truncated' : ''}.` }),
    el('ul', {}, ...matches.slice(0, 12).map(match => el('li', { text: `${match.entryId} · question ${match.questionId} · current version ${match.versionId} · ${match.state}` }))));
  else if (receipt.matchesTruncated) details.append(el('p', { text: 'The recorded exact-match list is truncated. An empty displayed list is not zero exact matches.' }));
  details.append(el('details', {}, el('summary', { text: 'Recorded content bindings' }),
    el('p', { text: `Course: ${receipt.courseId}` }), el('p', { text: `Candidate normalized hash: ${receipt.candidateHash}` }),
    el('p', { text: `Scanned current-head/version bindings digest: ${receipt.bindingsDigest}` })));
  section.append(details);
  return section;
}
