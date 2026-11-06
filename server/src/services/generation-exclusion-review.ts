import { createHash } from 'node:crypto';
import { z } from 'zod';
import { answerabilityExample, evaluateAnswerability, type AnswerabilityReview } from './generation-answerability';
import type { GenerationEvidencePacket } from '../types/generation-evidence';
import type { AuthoringRequirements, GenerationQualityAssessment, GenerationQualityCandidate, GenerationQualityPolicy, GenerationValidationFinding } from '../types/generation-quality';
import type { GenerationExclusionBasis, GenerationExclusionReviewReceipt, GenerationExclusionWarrantDisclosure } from '../types/generation-exclusion-review';

export const EXCLUSION_REVIEW_PROTOCOL = 'literal-exclusion-warrants-v1' as const;
const spanIds = z.array(z.string().max(32).regex(/^S[1-9][0-9]*$/)).max(3);
const challengeSchema = z.object({ status: z.enum(['excluded', 'viable', 'uncertain']), reason: z.string().trim().min(1).max(120), spanIds }).strict();
export const exclusionReviewSchema = z.object({ kind: z.literal('mcq'), options: z.array(z.object({
  key: z.string().trim().min(1).max(16), verdict: z.enum(['fully-correct', 'not-fully-correct', 'undetermined']),
  reason: z.string().trim().min(1).max(180), spanIds,
  exclusion: z.object({ basis: z.enum(['direct-contradiction', 'derived-incompatibility', 'explicit-task-restriction', 'required-component-missing',
    'placement-only', 'strength-only', 'silence-only', 'undetermined']), optionQuote: z.string().max(120), stemQuote: z.string().max(120), challenge: challengeSchema }).strict().nullable(),
}).strict()).length(4) }).strict();
export type ExclusionReview = z.infer<typeof exclusionReviewSchema>;
type Requirements = AuthoringRequirements & { exclusionReviewProtocol?: unknown };
type Assessment = GenerationQualityAssessment & { exclusionReview?: GenerationExclusionReviewReceipt };
type Result = ReturnType<typeof evaluateAnswerability> & { receipt?: GenerationExclusionReviewReceipt };
const stableJson = (value: unknown): string => JSON.stringify(value, (_key, row: unknown) => row && typeof row === 'object' && !Array.isArray(row)
  ? Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))) : row);
const hash = (value: unknown): string => createHash('sha256').update(stableJson(value)).digest('hex');
const equal = (a: unknown, b: unknown): boolean => stableJson(a) === stableJson(b);

export function assertGenerationExclusionReviewProtocol(protocol: unknown, policy?: GenerationQualityPolicy): boolean {
  if (protocol === undefined) return false;
  if (protocol !== EXCLUSION_REVIEW_PROTOCOL) throw new Error('generation-exclusion-review-protocol-invalid');
  if (policy !== undefined && policy !== 'grounded-memory-v2') throw new Error('generation-exclusion-review-policy-invalid');
  return true;
}

/** Historical absence and selected T/F preserve the exact old contract. */
export function exclusionReviewEnabled(requirements: Requirements | undefined, candidate: Pick<GenerationQualityCandidate, 'type'>): boolean {
  if (!assertGenerationExclusionReviewProtocol(requirements?.exclusionReviewProtocol) || candidate.type === 'true-false') return false;
  if (requirements?.answerabilityProtocol !== 'option-answerability-v1') throw new Error('generation-exclusion-review-answerability-required');
  return true;
}

export function exclusionReviewInstruction(): string {
  return 'EXCLUSIONS: answerability:{kind:"mcq",options:[{key,verdict,reason,spanIds,exclusion:null|{basis,optionQuote,stemQuote,challenge:{status,reason,spanIds}}}]}. '
    + 'All4 keys once; judge literal answers independently of key/roles/feedback; report all fully-correct/uncertain,even multiples/key conflicts. verdict=fully-correct|not-fully-correct|undetermined. reason<=180;challenge.reason/quotes<=120;refs<=3 S IDs. Fully-correct/undetermined:null. '
    + 'Others:exact nonblank optionQuote;basis=direct-contradiction|derived-incompatibility|explicit-task-restriction|required-component-missing|placement-only|strength-only|silence-only|undetermined. Task/missing bases:exact nonblank stemQuote;others:"". '
    + 'Challenge strongest source-supported alternative:excluded|viable|uncertain;resolved cite1–3,uncertain may[]. Placement/strength/silence/undetermined or viable/uncertain hold. Listing!=only;mitigate!=eliminate;can!=must. True partial fails only explicit task;false clauses fail. Taught formulas refute wrong math;source/conditions/feedback bind. No extras.';
}

export function exclusionReviewExample(candidate: Pick<GenerationQualityCandidate, 'type' | 'stem' | 'options'>): ExclusionReview | AnswerabilityReview {
  if (candidate.type === 'true-false') return answerabilityExample(candidate);
  return { kind: 'mcq', options: [{ key: candidate.options[0]?.key ?? 'A', verdict: 'undetermined',
    reason: 'Literal response finding, not a prescribed verdict.', spanIds: [], exclusion: null }] };
}

function canonicalCandidate(candidate: GenerationQualityCandidate | undefined): boolean {
  if (!candidate || candidate.truncated || typeof candidate.contentHash !== 'string') return false;
  const body = Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== 'contentHash' && key !== 'truncated'));
  return createHash('sha256').update(JSON.stringify(body)).digest('hex') === candidate.contentHash;
}

const mappedBasis = (basis: GenerationExclusionBasis): 'source-contradiction' | 'explicit-stem-condition' | 'incomplete-response' =>
  basis === 'explicit-task-restriction' ? 'explicit-stem-condition' : basis === 'required-component-missing' ? 'incomplete-response' : 'source-contradiction';

/** Reuse the unchanged legacy citation/scope/damage validator. Its semantic
 * uniqueness/key issues are irrelevant to this auxiliary source-reference join. */
function challengeReferences(row: ExclusionReview['options'][number], candidate: GenerationQualityCandidate, packet: GenerationEvidencePacket) {
  const challenge = row.exclusion!.challenge;
  if (!challenge.spanIds.length) return { citations: [], responseIssues: [] };
  const candidateIndex = candidate.options.findIndex(option => option.key === row.key);
  const check: AnswerabilityReview = { kind: 'mcq', options: candidate.options.map((option, position) => ({ key: option.key,
    verdict: position === candidateIndex ? 'fully-correct' : 'undetermined', reason: position === candidateIndex ? challenge.reason : 'No challenge source check for this row.',
    spanIds: position === candidateIndex ? challenge.spanIds : [], exclusionBasis: position === candidateIndex ? 'none' : 'undetermined', exclusion: '', stemQuote: '' })) };
  const result = evaluateAnswerability(check, candidate, packet);
  const focus = result.assessment.kind === 'mcq' ? result.assessment.options[candidateIndex] : undefined;
  return { citations: focus?.citations ?? [], responseIssues: result.responseIssues.filter(issue => issue.path === `answerability.options.${candidateIndex}.spanIds`) };
}

/** Same-call structural/source joins constrain model judgments; no new semantic
 * call, source waiver, arithmetic proof, automatic repair or save authority. */
export function evaluateExclusionReview(value: unknown, candidate: GenerationQualityCandidate, packet: GenerationEvidencePacket,
  requirements: Requirements): Result {
  if (!exclusionReviewEnabled(requirements, candidate)) return evaluateAnswerability(value, candidate, packet);
  const parsed = exclusionReviewSchema.safeParse(value);
  const adapted: AnswerabilityReview | undefined = parsed.success ? { kind: 'mcq', options: parsed.data.options.map(row => ({
    key: row.key, verdict: row.verdict, reason: row.reason, spanIds: row.spanIds,
    exclusionBasis: row.verdict === 'fully-correct' ? 'none' : row.verdict === 'undetermined' ? 'undetermined'
      : row.exclusion ? mappedBasis(row.exclusion.basis) : 'source-contradiction',
    exclusion: row.verdict === 'not-fully-correct' ? row.reason : '', stemQuote: row.verdict === 'not-fully-correct' ? row.exclusion?.stemQuote ?? '' : '',
  })) } : undefined;
  const checked = evaluateAnswerability(adapted, candidate, packet);
  const issues = checked.assessment.issues;
  const responseIssues = [...checked.responseIssues];
  let newWarrantProblem = false;
  const add = (path: string, code: string, response = false) => {
    newWarrantProblem = true;
    const issue = { path: `answerability.${path}`, code };
    if (!issues.some(item => item.path === issue.path && item.code === issue.code)) issues.push(issue);
    if (response && !responseIssues.some(item => item.path === issue.path && item.code === issue.code)) responseIssues.push(issue);
  };
  if (!parsed.success) add('response', 'exclusion-review-schema-invalid', true);
  if (!canonicalCandidate(candidate)) add('candidate', 'exclusion-candidate-snapshot-invalid');
  const options: GenerationExclusionReviewReceipt['options'] = [];
  const mcq = checked.assessment.kind === 'mcq' ? checked.assessment : undefined;
  if (parsed.success && mcq) parsed.data.options.forEach((row, index) => {
    const path = `options.${index}.exclusion`;
    const option = candidate.options.find(item => item.key === row.key);
    if (row.verdict !== 'not-fully-correct') {
      if (row.exclusion !== null) add(path, 'exclusion-neutral-row-warrant-present', true);
      options.push({ key: row.key, exclusionWarrant: null });
      return;
    }
    if (!row.exclusion) {
      add(path, 'exclusion-warrant-missing', true);
      options.push({ key: row.key, exclusionWarrant: null });
      return;
    }
    const warrant = row.exclusion;
    if (!warrant.optionQuote.trim() || !option?.text.includes(warrant.optionQuote)) add(`${path}.optionQuote`, 'exclusion-option-quote-invalid', true);
    const task = warrant.basis === 'explicit-task-restriction' || warrant.basis === 'required-component-missing';
    if (task ? !warrant.stemQuote.trim() || !candidate.stem.includes(warrant.stemQuote) : warrant.stemQuote !== '') add(`${path}.stemQuote`, 'exclusion-stem-quote-invalid', true);
    const refs = challengeReferences(row, candidate, packet);
    for (const issue of refs.responseIssues) add(`${path}.challenge.spanIds`, issue.code, true);
    if (warrant.challenge.status !== 'uncertain' && !warrant.challenge.spanIds.length) add(`${path}.challenge.spanIds`, 'exclusion-challenge-evidence-missing', true);
    if (['placement-only', 'strength-only', 'silence-only', 'undetermined'].includes(warrant.basis)) add(path, 'exclusion-basis-does-not-exclude');
    if (warrant.challenge.status !== 'excluded') add(`${path}.challenge`, `exclusion-challenge-${warrant.challenge.status}`);
    const disclosure: GenerationExclusionWarrantDisclosure = { basis: warrant.basis, optionQuote: warrant.optionQuote, stemQuote: warrant.stemQuote,
      challenge: { status: warrant.challenge.status, reason: warrant.challenge.reason, citations: structuredClone(refs.citations) },
      issues: issues.filter(issue => issue.path.startsWith(`answerability.${path}`)).map(issue => ({ ...issue })) };
    Object.assign(mcq.options[index], { exclusionWarrant: disclosure });
    options.push({ key: row.key, exclusionWarrant: disclosure });
  });
  Object.assign(checked.assessment, { exclusionProtocol: EXCLUSION_REVIEW_PROTOCOL });
  if (issues.length) { checked.assessment.status = 'withheld'; delete checked.assessment.resolvedCorrectKey; }
  const passageIds = [...new Set([...(checked.assessment.kind === 'mcq' ? checked.assessment.options.flatMap(row => row.citations.map(c => c.passageId)) : []),
    ...options.flatMap(row => row.exclusionWarrant?.challenge.citations.map(c => c.passageId) ?? [])])];
  const findings: GenerationValidationFinding[] = newWarrantProblem ? [{ kind: 'answer-semantics', target: 'options', status: 'uncertain',
    observation: `Literal exclusion warrants did not pass: ${[...new Set(issues.map(issue => issue.code))].join(', ')}.`.slice(0, 350),
    correction: '', passageIds, memoryEntryIds: [] }] : checked.findings.map(finding => ({ ...finding,
      passageIds: [...new Set([...finding.passageIds, ...passageIds])] }));
  const receipt: GenerationExclusionReviewReceipt = { protocol: EXCLUSION_REVIEW_PROTOCOL, status: checked.assessment.status,
    candidateHash: hash(candidate), requirementsHash: hash(requirements), evidenceHash: hash(packet),
    review: parsed.success ? structuredClone(parsed.data) : null, options: structuredClone(options), issues: issues.map(issue => ({ ...issue })) };
  return { assessment: checked.assessment, responseIssues, findings, receipt };
}

/** Mechanical recorded-response replay, including withheld semantic findings.
 * It grants no admission/repair authority and never upgrades an unresolved
 * judgment. JSON equality survives durable BSON/cross-realm representations. */
export function exclusionReviewRecordedMatches(quality: Assessment, requirements: Requirements,
  candidate: GenerationQualityCandidate, packet: GenerationEvidencePacket): boolean {
  try {
    assertGenerationExclusionReviewProtocol(requirements.exclusionReviewProtocol, quality.policy);
    if (!exclusionReviewEnabled(requirements, candidate)) return requirements.exclusionReviewProtocol === undefined || quality.exclusionReview === undefined;
    if (!['eligible', 'withheld'].includes(quality.status) || !quality.answerability || !quality.exclusionReview
      || !canonicalCandidate(candidate) || !canonicalCandidate(quality.candidate) || !equal(candidate, quality.candidate)
      || quality.evidencePacketId !== packet.id) return false;
    const fresh = evaluateExclusionReview(quality.exclusionReview.review, candidate, packet, requirements);
    return fresh.responseIssues.length === 0 && equal(fresh.receipt, quality.exclusionReview) && equal(fresh.assessment, quality.answerability);
  } catch { return false; }
}

/** Final admission needs eligible/passed on top of exact mechanical replay. */
export function exclusionReviewReceiptMatches(quality: Assessment, requirements: Requirements,
  candidate: GenerationQualityCandidate, packet: GenerationEvidencePacket): boolean {
  try {
    assertGenerationExclusionReviewProtocol(requirements.exclusionReviewProtocol, quality.policy);
    if (!exclusionReviewEnabled(requirements, candidate)) return requirements.exclusionReviewProtocol === undefined || quality.exclusionReview === undefined;
    return quality.status === 'eligible' && quality.answerability?.status === 'passed' && quality.exclusionReview?.status === 'passed'
      && exclusionReviewRecordedMatches(quality, requirements, candidate, packet);
  } catch { return false; }
}

export type { GenerationExclusionReviewReceipt, GenerationExclusionWarrantDisclosure } from '../types/generation-exclusion-review';
