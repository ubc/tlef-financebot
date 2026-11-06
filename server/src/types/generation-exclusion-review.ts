import type { AnswerabilityVerdict, GenerationQualityCitation } from './generation-quality';

export type GenerationExclusionBasis = 'direct-contradiction' | 'derived-incompatibility' | 'explicit-task-restriction'
  | 'required-component-missing' | 'placement-only' | 'strength-only' | 'silence-only' | 'undetermined';
export type GenerationExclusionChallengeStatus = 'excluded' | 'viable' | 'uncertain';
export interface GenerationExclusionReview {
  kind: 'mcq';
  options: Array<{
    key: string; verdict: AnswerabilityVerdict; reason: string; spanIds: string[];
    exclusion: null | {
      basis: GenerationExclusionBasis; optionQuote: string; stemQuote: string;
      challenge: { status: GenerationExclusionChallengeStatus; reason: string; spanIds: string[] };
    };
  }>;
}

/** Safe same-call model judgment plus server-resolved exact original quotes.
 * A supported locator or matched substring does not establish entailment. */
export interface GenerationExclusionWarrantDisclosure {
  basis: GenerationExclusionBasis;
  optionQuote: string;
  stemQuote: string;
  challenge: { status: GenerationExclusionChallengeStatus; reason: string; citations: GenerationQualityCitation[] };
  issues: Array<{ path: string; code: string }>;
}
export type GenerationExclusionWarrant = GenerationExclusionWarrantDisclosure;

/** Guarded same-call replay receipt, not a full provider payload. It proves
 * exact input/response replay only; valid warrants do not prove semantic truth. */
export interface GenerationExclusionReviewReceipt {
  protocol: 'literal-exclusion-warrants-v1';
  status: 'passed' | 'withheld';
  candidateHash: string;
  requirementsHash: string;
  evidenceHash: string;
  /** Null when no schema-valid bounded response was supplied. */
  review: GenerationExclusionReview | null;
  options: Array<{ key: string; exclusionWarrant: GenerationExclusionWarrantDisclosure | null }>;
  issues: Array<{ path: string; code: string }>;
}
