import type { GenerationQualityAssessment, QuestionOption } from '../../api.js';
import { el } from '../../dom.js';
import { sourceCitationDetails } from './source-citations.js';

const exclusionBases = {
  'direct-contradiction': 'Direct contradiction',
  'derived-incompatibility': 'Derived incompatibility',
  'explicit-task-restriction': 'Explicit task restriction',
  'required-component-missing': 'Required component missing',
  'placement-only': 'Table placement only',
  'strength-only': 'Difference in strength only',
  'silence-only': 'Source silence only',
  undetermined: 'Undetermined',
} as const;
const exclusionIssues: Record<string, string> = {
  'exclusion-warrant-missing': 'The exclusion check is missing.',
  'exclusion-option-quote-invalid': 'The option clause could not be matched.',
  'exclusion-stem-quote-invalid': 'The stated task condition could not be matched.',
  'exclusion-challenge-evidence-missing': 'The alternative check lacks source evidence.',
  'answer-evidence-invalid': 'The source quotations could not be validated.',
  'exclusion-basis-does-not-exclude': 'The recorded basis does not exclude the alternative.',
  'exclusion-challenge-viable': 'A viable alternative remains.',
  'exclusion-challenge-uncertain': 'The alternative remains unresolved.',
};
type ExclusionWarrant = {
  basis: keyof typeof exclusionBases; optionQuote: string; stemQuote: string;
  challenge: { status: 'excluded' | 'viable' | 'uncertain'; reason: string; citations: GenerationQualityAssessment['citations'] };
  issues: Array<{ path: string; code: string }>;
};
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const boundedText = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length <= limit;
function exclusionWarrant(value: unknown): ExclusionWarrant | undefined {
  if (!record(value) || !boundedText(value.basis, 60) || !Object.prototype.hasOwnProperty.call(exclusionBases, value.basis) ||
      !boundedText(value.optionQuote, 120) || !value.optionQuote.trim() || !boundedText(value.stemQuote, 120) ||
      !record(value.challenge) || typeof value.challenge.status !== 'string' || !['excluded', 'viable', 'uncertain'].includes(value.challenge.status) ||
      !boundedText(value.challenge.reason, 120) || !value.challenge.reason.trim() || !Array.isArray(value.challenge.citations) || value.challenge.citations.length > 48 ||
      !value.challenge.citations.every(citation => record(citation) && typeof citation.kind === 'string' && ['premise', 'solution', 'correction'].includes(citation.kind) &&
        boundedText(citation.claim, 2000) && boundedText(citation.passageId, 1000) && boundedText(citation.quote, 20_000)) ||
      !Array.isArray(value.issues) || value.issues.length > 64 || !value.issues.every(issue => record(issue) && boundedText(issue.path, 1000) && boundedText(issue.code, 200))) return undefined;
  return value as unknown as ExclusionWarrant;
}
function exclusionCheck(courseId: string, value: unknown): HTMLElement {
  const details = el('details', { 'data-exclusion-check': 'true' }, el('summary', { text: 'Exclusion check' }));
  const warrant = exclusionWarrant(value);
  if (!warrant) {
    details.append(el('p', { class: 'workspace-muted', text: 'This recorded exclusion check is unavailable or malformed. It does not establish an exclusion.' }));
    return details;
  }
  const challenge = { excluded: 'Alternative excluded in recorded check', viable: 'Alternative remains viable', uncertain: 'Unresolved' };
  const weakBasis = ['placement-only', 'strength-only', 'silence-only', 'undetermined'].includes(warrant.basis);
  details.append(el('p', {}, el('strong', { text: 'Basis: ' }), exclusionBases[warrant.basis]),
    el('p', {}, el('strong', { text: 'Exact option clause' })), el('blockquote', { text: warrant.optionQuote }));
  if (warrant.stemQuote) details.append(el('div', {}, el('p', {}, el('strong', { text: 'Exact stem condition' })), el('blockquote', { text: warrant.stemQuote })));
  details.append(
    el('p', {}, el('strong', { text: 'Challenge: ' }), challenge[warrant.challenge.status]),
    el('p', { text: warrant.challenge.reason }));
  if (weakBasis) details.append(el('p', { class: 'workspace-muted', text: 'This basis does not establish that the alternative is excluded.' }));
  details.append(el('p', { class: 'workspace-muted', text: 'Quotations locate retained evidence; they do not prove that the evidence excludes this answer. Instructor review is still required.' }));
  const citations = sourceCitationDetails(courseId, warrant.challenge.citations);
  if (citations) details.append(citations);
  if (warrant.issues.length) details.append(el('p', { class: 'workspace-muted', text: `${warrant.issues.length} recorded exclusion ${warrant.issues.length === 1 ? 'issue needs' : 'issues need'} review.` }),
    el('ul', {}, ...[...new Set(warrant.issues.map(issue => Object.prototype.hasOwnProperty.call(exclusionIssues, issue.code)
      ? exclusionIssues[issue.code] : 'An exclusion detail could not be validated.'))].map(text => el('li', { text }))));
  return details;
}

/** Recorded literal-answer findings, separate from feedback and instructor approval. */
export function answerabilityChecks(courseId: string, quality: GenerationQualityAssessment,
  options: Pick<QuestionOption, 'key' | 'text' | 'explanation'>[] | undefined = quality.candidate?.options): HTMLElement {
  const receipt = quality.answerability;
  const section = el('section', { class: 'workspace-metadata-block gw-quality', 'aria-label': 'Answerability checks', style: 'overflow-wrap:anywhere' },
    el('h3', { text: 'Answerability checks' }));
  if (!receipt) {
    section.append(el('p', { class: 'workspace-muted', text: 'Not recorded for this assessment. Historical checks do not establish a unique answer.' }));
    return section;
  }
  if (receipt.protocol !== 'option-answerability-v1' || !['mcq', 'true-false'].includes(receipt.kind)) {
    section.append(el('p', { class: 'workspace-muted', text: 'This recorded answerability protocol cannot be displayed.' }));
    return section;
  }
  const labels = { 'fully-correct': 'Fully correct', 'not-fully-correct': 'Not fully correct', undetermined: 'Undetermined' };
  const bases = { none: 'None', 'source-contradiction': 'Source contradiction', 'explicit-stem-condition': 'Explicit stem condition', 'incomplete-response': 'Incomplete response', undetermined: 'Undetermined' };
  section.append(el('p', {}, el('strong', { text: receipt.status === 'passed' ? 'Passed recorded check' : 'Withheld by recorded check' })),
    el('p', { text: `Proposed answer key: ${receipt.keyedOptionKey ?? 'not recorded'}. Independently resolved answer key: ${receipt.resolvedCorrectKey ?? 'unresolved'}.` }),
    el('p', { class: 'workspace-muted', text: 'The answer as written is checked separately from its feedback. These model judgments require instructor review.' }));
  if (receipt.kind === 'mcq') {
    const exclusionProtocol = receipt.exclusionProtocol;
    const checkedExclusions = exclusionProtocol === 'literal-exclusion-warrants-v1';
    if (exclusionProtocol !== undefined && !checkedExclusions) section.append(el('p', { class: 'workspace-muted', text: 'Exclusion checks are unavailable for this recorded protocol.' }));
    const correct = receipt.options.filter(option => option.verdict === 'fully-correct');
    section.append(el('p', { text: correct.length > 1
      ? `Ambiguous answer set: ${correct.length} options were assessed as fully correct.`
      : receipt.resolvedCorrectKey ? `Unique fully correct option: ${receipt.resolvedCorrectKey}.` : 'No unique answer resolved.' }));
    for (const option of receipt.options) {
      const matches = options?.filter(candidate => candidate.key === option.key) ?? [];
      const literal = matches.length === 1 ? matches[0] : undefined;
      section.append(el('details', { 'data-answerability-option': option.key },
        el('summary', { text: `Option ${option.key} · ${labels[option.verdict] ?? 'Undetermined'}` }),
        el('p', {}, el('strong', { text: 'Answer as written: ' }), literal?.text ?? 'Answer text not retained in this receipt.'),
        el('p', {}, el('strong', { text: 'Reason: ' }), option.reason),
        el('p', {}, el('strong', { text: 'Exclusion basis: ' }), bases[option.exclusionBasis] ?? 'Undetermined'),
        el('p', {}, el('strong', { text: 'Exclusion: ' }), option.exclusion || 'None recorded.'),
        option.stemQuote ? el('div', {}, el('p', {}, el('strong', { text: 'Relevant stem condition' })), el('blockquote', { text: option.stemQuote })) : false,
        literal?.explanation ? el('details', {}, el('summary', { text: 'Recorded feedback · separate from answer' }), el('p', { text: literal.explanation })) : false,
        checkedExclusions && option.verdict === 'not-fully-correct' ? exclusionCheck(courseId, option.exclusionWarrant) : false,
        sourceCitationDetails(courseId, option.citations)));
    }
  } else {
    section.append(el('p', {}, el('strong', { text: 'Literal statement truth: ' }), receipt.stemTruth === 'undetermined' ? 'Undetermined' : receipt.stemTruth === 'true' ? 'True' : 'False'),
      el('p', {}, el('strong', { text: 'Reason: ' }), receipt.reason));
    const citations = sourceCitationDetails(courseId, receipt.citations);
    if (citations) section.append(citations);
  }
  if (receipt.issues.length) section.append(el('details', {}, el('summary', { text: `Recorded issues (${receipt.issues.length})` }),
    el('ul', {}, ...receipt.issues.map(issue => el('li', { text: `${issue.path}: ${issue.code}` })))));
  return section;
}
