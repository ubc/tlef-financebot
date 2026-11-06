import { el } from '../../dom.js';
import { sourceCitationDetails } from './source-citations.js';
/** Recorded literal-answer findings, separate from feedback and instructor approval. */
export function answerabilityChecks(courseId, quality, options = quality.candidate?.options) {
    const receipt = quality.answerability;
    const section = el('section', { class: 'workspace-metadata-block gw-quality', 'aria-label': 'Answerability checks', style: 'overflow-wrap:anywhere' }, el('h3', { text: 'Answerability checks' }));
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
    section.append(el('p', {}, el('strong', { text: receipt.status === 'passed' ? 'Passed recorded check' : 'Withheld by recorded check' })), el('p', { text: `Proposed answer key: ${receipt.keyedOptionKey ?? 'not recorded'}. Independently resolved answer key: ${receipt.resolvedCorrectKey ?? 'unresolved'}.` }), el('p', { class: 'workspace-muted', text: 'The answer as written is checked separately from its feedback. These model judgments require instructor review.' }));
    if (receipt.kind === 'mcq') {
        const correct = receipt.options.filter(option => option.verdict === 'fully-correct');
        section.append(el('p', { text: correct.length > 1
                ? `Ambiguous answer set: ${correct.length} options were assessed as fully correct.`
                : receipt.resolvedCorrectKey ? `Unique fully correct option: ${receipt.resolvedCorrectKey}.` : 'No unique answer resolved.' }));
        for (const option of receipt.options) {
            const matches = options?.filter(candidate => candidate.key === option.key) ?? [];
            const literal = matches.length === 1 ? matches[0] : undefined;
            section.append(el('details', { 'data-answerability-option': option.key }, el('summary', { text: `Option ${option.key} · ${labels[option.verdict] ?? 'Undetermined'}` }), el('p', {}, el('strong', { text: 'Answer as written: ' }), literal?.text ?? 'Answer text not retained in this receipt.'), el('p', {}, el('strong', { text: 'Reason: ' }), option.reason), el('p', {}, el('strong', { text: 'Exclusion basis: ' }), bases[option.exclusionBasis] ?? 'Undetermined'), el('p', {}, el('strong', { text: 'Exclusion: ' }), option.exclusion || 'None recorded.'), option.stemQuote ? el('div', {}, el('p', {}, el('strong', { text: 'Relevant stem condition' })), el('blockquote', { text: option.stemQuote })) : false, literal?.explanation ? el('details', {}, el('summary', { text: 'Recorded feedback · separate from answer' }), el('p', { text: literal.explanation })) : false, sourceCitationDetails(courseId, option.citations)));
        }
    }
    else {
        section.append(el('p', {}, el('strong', { text: 'Literal statement truth: ' }), receipt.stemTruth === 'undetermined' ? 'Undetermined' : receipt.stemTruth === 'true' ? 'True' : 'False'), el('p', {}, el('strong', { text: 'Reason: ' }), receipt.reason));
        const citations = sourceCitationDetails(courseId, receipt.citations);
        if (citations)
            section.append(citations);
    }
    if (receipt.issues.length)
        section.append(el('details', {}, el('summary', { text: `Recorded issues (${receipt.issues.length})` }), el('ul', {}, ...receipt.issues.map(issue => el('li', { text: `${issue.path}: ${issue.code}` })))));
    return section;
}
//# sourceMappingURL=answerability-checks.js.map