import type { GenerationTaskRetrievalDiagnostic } from '../../api.js';
import { el } from '../../dom.js';

/** Local nomination coverage never supplies a semantic novelty verdict. */
export function taskRetrievalChecks(quality: { taskRetrieval?: GenerationTaskRetrievalDiagnostic }, initial = false): HTMLElement {
  const label = initial ? 'Initial task retrieval' : 'Task retrieval';
  const section = el('section', { class: 'workspace-metadata-block gw-quality', 'aria-label': label, style: 'overflow-wrap:anywhere' });
  const receipt = quality.taskRetrieval;
  if (!receipt) {
    section.append(el('p', { class: 'gw-plan-note', text: `${label}: not recorded for this assessment. Historical absence supplies no retrieval counts.` }));
    return section;
  }
  if (receipt.protocol !== 'course-task-retrieval-v1') {
    section.append(el('p', { class: 'gw-plan-note', text: `${label}: recorded protocol cannot be displayed. Retrieval coverage is unavailable.` }));
    return section;
  }
  const count = (value: unknown): string => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString() : 'unavailable';
  const ids = (value: unknown): string[] | undefined => Array.isArray(value) && value.every(item => typeof item === 'string') ? value : undefined;
  const nominated = ids(receipt.nominatedIds), retained = ids(receipt.retainedIds), required = ids(receipt.requiredComparisonIds);
  const status = receipt.status === 'complete' ? 'Complete' : receipt.status === 'incomplete' ? 'Incomplete' : 'Status unavailable';
  const reasons = { 'head-limit': 'head limit reached', deadline: 'deadline reached', 'invalid-head': 'invalid question head',
    'missing-or-invalid-version': 'missing or invalid current version', 'profile-limit': 'profile limit reached' };
  section.append(el('p', { class: 'gw-plan-note' }, el('strong', { text: `${label} · ${status}` }),
    ` · ${count(receipt.headsScanned)} heads scanned · ${count(receipt.versionsChecked)} current versions checked · ${count(nominated?.length)} nominated · ${count(required?.length)} required comparisons`),
  el('p', { class: 'gw-plan-note', text: 'Local retrieval scores nominate comparisons; they are not novelty or duplicate verdicts. Complete describes bounded traversal, not complete semantic recall.' }));
  const details = el('details', {}, el('summary', { text: 'Task retrieval receipt' }),
    el('p', { text: `Recorded status: ${status}${receipt.incompleteReason ? ` · ${reasons[receipt.incompleteReason] ?? receipt.incompleteReason}` : ''}. Missing versions: ${count(receipt.missingVersions)}. Invalid versions: ${count(receipt.invalidVersions)}. Invalid heads: ${count(receipt.invalidHeads)}.` }),
    el('p', { text: `Retained Bank entries: ${count(retained?.length)}. Missing prepared descriptors: ${count(receipt.missingDescriptors)}. Ignored profiles: ${count(receipt.ignoredProfiles)}. These are retrieval diagnostics, not excluded-question counts.` }),
    el('p', { text: `Observed unscanned-head lower bound: ${count(receipt.unscannedHeadsLowerBound)}. This is not an estimate of the remaining Bank size.` }),
    el('p', { class: 'gw-plan-note', text: 'Required comparisons identify questions the same quality check must compare. Their presence here is not evidence that a comparison passed. This historical receipt does not cover later Bank changes.' }));
  for (const [title, values] of [['Required comparison identities', required], ['Nominated identities', nominated]] as const) {
    details.append(el('p', { text: `${title}: ${count(values?.length)}${values && values.length > 12 ? ' · first 12 displayed' : ''}.` }));
    if (values?.length) details.append(el('ul', {}, ...values.slice(0, 12).map(value => el('li', { text: value }))));
  }
  details.append(el('details', {}, el('summary', { text: 'Recorded retrieval bindings' }),
    el('p', { text: `Ranker: ${receipt.rankerVersion}` }), el('p', { text: `Query hash: ${receipt.queryHash}` }),
    el('p', { text: `Current content/profile bindings digest: ${receipt.bindingsDigest}` })));
  section.append(details);
  return section;
}
