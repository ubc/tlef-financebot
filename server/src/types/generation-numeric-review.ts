import type { DerivedValue, NumericVerification, ParamSlot, QuestionOption } from './domain';
import type { OptionValueNameResult, VerifyInput, VerifyResult } from '../services/numeric-verification.service';

/** Trusted production functions are supplied by the caller. The pure witness
 * module never loads the worker/env/provider dependency tree or runs scripts. */
export interface GenerationNumericReviewRuntime {
  verifyQuestionNumerics(input: VerifyInput): VerifyResult;
  resolveSlotsAndDerived(slots: ParamSlot[], derivedValues: DerivedValue[], seed: number): Record<string, number>;
  placeholderSyntaxFailure(question: { stem: string; options: Array<{ key: string; text: string; explanation?: string }> }, knownNames: string[]): string | undefined;
  optionFormatsConsistent(texts: string[]): { ok: true } | { ok: false; templates: string[] };
  optionValueNamesForVerification(texts: string[], allowedNames?: Iterable<string>): OptionValueNameResult;
  undisplayedInputs(input: { slots: ParamSlot[]; derivedValues: DerivedValue[]; rootName: string; stem: string }): string[];
}

export type NumericReviewUnavailableReason =
  | 'invalid-candidate'
  | 'unsupported-numeric-type'
  | 'script-not-supported'
  | 'numeric-definitions-missing'
  | 'ambiguous-parameter-names'
  | 'invalid-parameter-domain'
  | 'unsupported-formula-complexity'
  | 'invalid-template'
  | 'option-format-mismatch'
  | 'option-value-missing'
  | 'undisplayed-input'
  | 'verification-failed'
  | 'invalid-verification-scope'
  | 'draw-failed'
  | 'unresolved-template'
  | 'display-collision'
  | 'input-display-mismatch'
  | 'witness-size-limit';

export interface GenerationNumericReviewAvailable {
  version: 'server-rendered-numeric-review-v1';
  status: 'available';
  /** Binds type, original stem/options/roles/feedback and complete declared
   * numeric definitions. Other candidate/teacher/source/Bank data remains in
   * the enclosing exact packet; this hash does not claim to bind that packet. */
  templateHash: string;
  /** Binds this deterministic additional representation, not source truth,
   * semantic answer correctness, currentness, persistence or serving authority. */
  bindingHash: string;
  sample: {
    seed: number;
    stem: string;
    /** The candidate's declared role is preserved, never certified by arithmetic. */
    declaredKey: string;
    options: Array<QuestionOption & { valueName: string; value: number; displayedValue: string }>;
    /** Every drawn and derived value, in declaration order; no hidden rounding. */
    values: Array<{ name: string; value: number }>;
  };
  verificationScope: {
    evaluatorVersion: number;
    inputDisplayVersion: number;
    sampleCount: number;
    sampleSeedsHash: string;
    parameterCoverage: NonNullable<NumericVerification['parameterCoverage']>;
  };
}

export type GenerationNumericReviewWitness = GenerationNumericReviewAvailable | {
  version: 'server-rendered-numeric-review-v1';
  status: 'unavailable';
  reason: NumericReviewUnavailableReason;
} | {
  version: 'server-rendered-numeric-review-v1';
  status: 'not-applicable';
  reason: 'no-numeric-template';
};

export type GenerationNumericReviewWitnessResult = GenerationNumericReviewWitness;

/** A stable private-sidecar receipt. Actual sample text/values stay in the
 * bounded model packet; source/teacher/Bank authority stays outside this proof. */
export type GenerationNumericReviewReceipt = Pick<GenerationNumericReviewAvailable, 'version' | 'status' | 'templateHash' | 'bindingHash' | 'verificationScope'> & { seed: number }
  | Exclude<GenerationNumericReviewWitness, GenerationNumericReviewAvailable>;
