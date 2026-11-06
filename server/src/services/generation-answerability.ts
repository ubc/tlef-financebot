import { z } from 'zod';
import type { AuthoringRequirements, GenerationAnswerabilityAssessment, GenerationQualityCandidate, GenerationQualityCitation, GenerationValidationFinding } from '../types/generation-quality';
import type { GenerationEvidencePacket } from '../types/generation-evidence';
import { resolveSpanCitations, type CitationIssue } from './generation-citation-spans';

const reason = z.string().trim().min(1).max(180);
const spanIds = z.array(z.string().regex(/^S[1-9][0-9]*$/)).max(3);
export const answerabilityReviewSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('mcq'), options: z.array(z.object({
    key: z.string().trim().min(1).max(16), verdict: z.enum(['fully-correct', 'not-fully-correct', 'undetermined']),
    reason, spanIds, exclusionBasis: z.enum(['none', 'source-contradiction', 'explicit-stem-condition', 'incomplete-response', 'undetermined']),
    exclusion: z.string().trim().max(180), stemQuote: z.string().max(160),
  }).strict()).length(4) }).strict(),
  z.object({ kind: z.literal('true-false'), stemTruth: z.enum(['true', 'false', 'undetermined']), reason, spanIds }).strict(),
]);
export type AnswerabilityReview = z.infer<typeof answerabilityReviewSchema>;
type Candidate = Pick<GenerationQualityCandidate, 'type' | 'stem' | 'options'>;

export function answerabilityEnabled(requirements?: AuthoringRequirements): boolean {
  const protocol = requirements?.answerabilityProtocol;
  if (protocol !== undefined && protocol !== 'option-answerability-v1') throw new Error('generation-answerability-protocol-invalid');
  return protocol === 'option-answerability-v1';
}

export function answerabilityExample(candidate: Candidate): AnswerabilityReview {
  return candidate.type === 'true-false'
    ? { kind: 'true-false', stemTruth: 'undetermined', reason: 'Judge the whole literal proposition.', spanIds: [] }
    : { kind: 'mcq', options: [{ key: candidate.options[0]?.key ?? 'A', verdict: 'undetermined',
      reason: 'Literal answer finding.', spanIds: [], exclusionBasis: 'undetermined', exclusion: '', stemQuote: '' }] };
}

export function answerabilityInstruction(candidate: Candidate): string {
  return [
    'ANSWERABILITY option-answerability-v1: judge literal responses to the actual stem, not roles/feedback. A truthful correction of a false choice is not another answer. Formal numerical proof stays separate; judge taught setup/conditions, not arithmetic.',
    candidate.type === 'true-false'
      ? 'T/F: judge the whole stem once: stemTruth is a JSON string "true"|"false"|"undetermined", never JSON booleans. Cite1–3 S spans for resolved truth; uncertain may use []. Reason≤180 chars. Server derives the key from actual True/False labels; ignore feedback as separate propositions.'
      : 'MCQ: all4 actual keys exactly once; verdict fully-correct|not-fully-correct|undetermined. Only one fully-correct, matching key. True partial answers fail only a stated task requirement. Resolved rows cite1–3 S spans; uncertain may use []. Reason/exclusion≤180 chars; stemQuote≤160. fully-correct: exclusionBasis none, empty exclusion/stemQuote. undetermined: basis undetermined, both empty. Others need specific exclusion: source-contradiction (empty stemQuote) or explicit-stem-condition|incomplete-response (nonempty exact stemQuote). Table placement is not exclusive; mitigate!=eliminate. Unproven exclusions stay undetermined.',
    'Example rows show shape, not count/verdict. No extra/server fields.',
  ].join('\n');
}

/** Validate references and answer-set consistency; semantic verdicts remain model judgments. */
export function evaluateAnswerability(value: unknown, candidate: Candidate, packet: GenerationEvidencePacket): {
  assessment: GenerationAnswerabilityAssessment; responseIssues: CitationIssue[]; findings: GenerationValidationFinding[];
} {
  const issues: CitationIssue[] = [], responseIssues: CitationIssue[] = [];
  const add = (path: string, code: string, response = false) => { const issue = { path: `answerability.${path}`, code }; issues.push(issue); if (response) responseIssues.push(issue); };
  const keyed = candidate.options.filter(option => option.role === 'correct');
  const base = { protocol: 'option-answerability-v1' as const, status: 'withheld' as const,
    ...(keyed.length === 1 ? { keyedOptionKey: keyed[0].key } : {}), issues };
  const parsed = answerabilityReviewSchema.safeParse(value);
  const citations: GenerationQualityCitation[] = [];
  const resolve = (ids: string[], claim: string, path: string, required: boolean) => {
    if (!ids.length) { if (required) add(path, 'answer-evidence-missing', true); return []; }
    const result = resolveSpanCitations(packet, [{ kind: 'solution', claim, spanIds: ids }]);
    const damaged = new Set(packet.findings.filter(finding => finding.code === 'source-text-damage').flatMap(finding => finding.passageIds));
    const scoped = result.citations.every(citation => packet.passages.some(passage => passage.id === citation.passageId
      && ['primary', 'secondary', 'prerequisite'].includes(passage.role)
      && packet.materials.some(material => material.materialId === passage.materialId && material.role === passage.role && material.loId === passage.loId)) && !damaged.has(citation.passageId));
    if (result.issues.length || !scoped) { add(path, 'answer-evidence-invalid', true); return []; }
    citations.push(...result.citations); return result.citations;
  };
  let assessment: GenerationAnswerabilityAssessment = candidate.type === 'mcq' ? { ...base, kind: 'mcq', options: [] }
    : { ...base, kind: 'true-false', stemTruth: 'undetermined', reason: 'No valid literal-stem assessment.', citations: [] };
  const keys = candidate.options.map(option => option.key);
  if (keyed.length !== 1 || new Set(keys).size !== keys.length || candidate.options.length !== (candidate.type === 'mcq' ? 4 : 2)) add('candidate', 'candidate-answer-shape-invalid');
  if (!parsed.success) add('response', 'answerability-schema-invalid', true);
  else if (parsed.data.kind !== candidate.type) add('kind', 'answerability-kind-mismatch', true);
  else if (parsed.data.kind === 'mcq') {
    const rows = parsed.data.options;
    if (rows.length !== keys.length || new Set(rows.map(row => row.key)).size !== rows.length || rows.some(row => !keys.includes(row.key))) add('options', 'answer-option-keys-mismatch', true);
    const options = rows.map((row, index) => {
      const path = `options.${index}`;
      const refs = resolve(row.spanIds, row.reason, `${path}.spanIds`, row.verdict !== 'undetermined');
      const neutral = row.verdict === 'fully-correct' ? 'none' : row.verdict === 'undetermined' ? 'undetermined' : undefined;
      if (neutral ? row.exclusionBasis !== neutral || !!row.exclusion || !!row.stemQuote
        : !['source-contradiction', 'explicit-stem-condition', 'incomplete-response'].includes(row.exclusionBasis) || !row.exclusion) add(path, 'answer-exclusion-inconsistent', true);
      if (row.verdict === 'not-fully-correct') {
        const condition = row.exclusionBasis === 'explicit-stem-condition' || row.exclusionBasis === 'incomplete-response';
        if (condition ? !row.stemQuote.trim() || !candidate.stem.includes(row.stemQuote) : !!row.stemQuote) add(`${path}.stemQuote`, 'answer-stem-condition-invalid', true);
      }
      return { key: row.key, verdict: row.verdict, reason: row.reason, exclusionBasis: row.exclusionBasis,
        exclusion: row.exclusion, stemQuote: row.stemQuote, citations: refs };
    });
    const correct = options.filter(row => row.verdict === 'fully-correct');
    if (options.some(row => row.verdict === 'undetermined')) add('options', 'answer-option-undetermined');
    if (correct.length !== 1) add('options', correct.length > 1 ? 'multiple-fully-correct-options' : 'no-fully-correct-option');
    if (correct.length === 1 && correct[0].key !== keyed[0]?.key) add('options', 'answer-key-disagrees');
    assessment = { ...base, kind: 'mcq', options,
      ...(!responseIssues.length && correct.length === 1 && !options.some(row => row.verdict === 'undetermined') ? { resolvedCorrectKey: correct[0].key } : {}) };
  } else {
    const row = parsed.data;
    const truthKeys = candidate.options.map(option => ({ key: option.key, truth: option.text.trim().toLowerCase() }));
    if (truthKeys.filter(option => option.truth === 'true').length !== 1 || truthKeys.filter(option => option.truth === 'false').length !== 1) add('candidate', 'true-false-labels-invalid');
    const refs = resolve(row.spanIds, row.reason, 'spanIds', row.stemTruth !== 'undetermined');
    const correct = truthKeys.find(option => option.truth === row.stemTruth);
    if (row.stemTruth === 'undetermined') add('stemTruth', 'literal-stem-undetermined');
    else if (correct?.key !== keyed[0]?.key) add('stemTruth', 'answer-key-disagrees');
    assessment = { ...base, kind: 'true-false', stemTruth: row.stemTruth, reason: row.reason, citations: refs,
      ...(!responseIssues.length && correct && !issues.some(issue => issue.path === 'answerability.candidate') ? { resolvedCorrectKey: correct.key } : {}) };
  }
  if (!issues.length) assessment.status = 'passed';
  const uncertain = responseIssues.length > 0 || issues.some(issue => /undetermined|shape-invalid|labels-invalid/.test(issue.code));
  const findings: GenerationValidationFinding[] = issues.length ? [{ kind: 'answer-semantics', target: candidate.type === 'mcq' ? 'options' : 'stem',
    status: uncertain ? 'uncertain' : 'defect', observation: `Literal-answer check did not pass: ${[...new Set(issues.map(issue => issue.code))].join(', ')}.`.slice(0, 350),
    correction: uncertain ? '' : 'Clarify the actual stem/options or reconcile the key so exactly one literal response answers the stated task. Preserve original source distinctions and teacher requirements; corrective feedback is not another choice.',
    passageIds: [...new Set(citations.map(citation => citation.passageId))], memoryEntryIds: [] }] : [];
  return { assessment, responseIssues, findings };
}
