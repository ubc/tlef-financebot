import { createHash } from 'node:crypto';
import type { AuthoringRequirements, GenerationQualityAssessment, GenerationQualityCandidate, GenerationQualityPolicy } from '../types/generation-quality';
import { buildGenerationNumericReviewWitness, NUMERIC_REVIEW_PROTOCOL, numericReviewReceipt } from './generation-numeric-review';
import type { GenerationNumericReviewWitnessResult } from './generation-numeric-review';
import type { GenerationNumericReviewReceipt } from '../types/generation-numeric-review';
import { resolveSlotsAndDerived } from './params.service';
import { optionFormatsConsistent, optionValueNamesForVerification, placeholderSyntaxFailure, undisplayedInputs,
  verifyQuestionNumerics } from './numeric-verification.service';

const runtime = { resolveSlotsAndDerived, optionFormatsConsistent, optionValueNamesForVerification,
  placeholderSyntaxFailure, undisplayedInputs, verifyQuestionNumerics };
const stableJson = (value: unknown): string => JSON.stringify(value, (_key, row: unknown) => row && typeof row === 'object' && !Array.isArray(row)
  ? Object.fromEntries(Object.entries(row).sort(([first], [second]) => first.localeCompare(second))) : row);

export function assertGenerationNumericReviewProtocol(protocol: unknown, policy?: GenerationQualityPolicy): boolean {
  if (protocol === undefined) return false;
  if (protocol !== NUMERIC_REVIEW_PROTOCOL) throw new Error('generation-numeric-review-protocol-invalid');
  if (policy !== undefined && policy !== 'grounded-memory-v2') throw new Error('generation-numeric-review-policy-invalid');
  return true;
}

/** Only trusted production arithmetic enters the pure renderer. A stored or
 * model-provided verification/witness is never used as its input authority. */
export function generationNumericReview(candidate: unknown, protocol: unknown): GenerationNumericReviewWitnessResult | undefined {
  if (!assertGenerationNumericReviewProtocol(protocol)) return;
  return buildGenerationNumericReviewWitness(candidate, runtime);
}

export function generationNumericReviewMetadata(candidate: unknown, protocol: unknown): GenerationNumericReviewReceipt | undefined {
  const witness = generationNumericReview(candidate, protocol);
  return witness ? numericReviewReceipt(witness) : undefined;
}

/** Cached stages must bind the exact complete candidate as well as the sample.
 * Unavailable samples can share a reason, so a separate canonical snapshot is
 * persisted with each stage receipt. Historical absent selectors stay absent. */
export function generationNumericReviewStageBinding(candidate: GenerationQualityCandidate, protocol: unknown):
  { candidate: GenerationQualityCandidate; receipt: GenerationNumericReviewReceipt } | undefined {
  const receipt = generationNumericReviewMetadata(candidate, protocol);
  return receipt ? { candidate, receipt } : undefined;
}

type StageBinding = NonNullable<ReturnType<typeof generationNumericReviewStageBinding>>;
function canonicalCandidate(candidate: GenerationQualityCandidate | undefined): boolean {
  if (!candidate || typeof candidate !== 'object' || candidate.truncated) return false;
  const body = Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== 'contentHash' && key !== 'truncated'));
  return createHash('sha256').update(JSON.stringify(body)).digest('hex') === candidate.contentHash;
}

export function generationNumericReviewStageMatches(binding: StageBinding | undefined,
  candidate: GenerationQualityCandidate, protocol: unknown): boolean {
  if (!assertGenerationNumericReviewProtocol(protocol)) return true;
  if (!binding || !canonicalCandidate(candidate) || !canonicalCandidate(binding.candidate)
    || stableJson(binding.candidate) !== stableJson(candidate)) return false;
  return stableJson(binding.receipt) === stableJson(generationNumericReviewMetadata(candidate, protocol));
}

/** Fresh arithmetic and exact candidate identity replay inside the existing
 * authoring fence. This grants no source, answerability or request waiver. */
export function generationNumericReviewReceiptMatches(assessment: GenerationQualityAssessment, requirements: AuthoringRequirements,
  candidate: GenerationQualityCandidate): boolean {
  if (!assertGenerationNumericReviewProtocol(requirements.numericReviewProtocol, assessment.policy)) return true;
  if (assessment.status !== 'eligible' || !canonicalCandidate(candidate) || !assessment.candidate || !canonicalCandidate(assessment.candidate)
    || stableJson(assessment.candidate) !== stableJson(candidate)) return false;
  const fresh = generationNumericReview(candidate, requirements.numericReviewProtocol)!;
  return stableJson(assessment.numericReview) === stableJson(numericReviewReceipt(fresh));
}
