import type { GenerationEvidencePacket } from './generation-evidence';
import type { QuestionType, QuestionOption, ParamSlot, DerivedValue } from './domain';

/** Versioned, opt-in public authoring policy. Legacy runs remain baseline. */
export type GenerationQualityPolicy = 'baseline' | 'grounded-memory-v1';

export interface GenerationQualityCitation {
  kind: 'premise' | 'solution' | 'correction';
  claim: string;
  passageId: string;
  quote: string;
}

export interface GenerationQualityCandidate {
  type: QuestionType;
  stem: string;
  options: QuestionOption[];
  numericKind?: 'numeric' | 'conceptual';
  paramSlots?: ParamSlot[];
  derivedValues?: DerivedValue[];
  contentHash: string;
  truncated: boolean;
}

/** Model assessments plus server-validated references, not a proof of quality. */
export interface GenerationQualityAssessment {
  policy: 'grounded-memory-v1';
  item: number;
  status: 'eligible' | 'withheld';
  sourceSupport: 'supported' | 'unsupported' | 'uncertain';
  notation: 'consistent' | 'inconsistent' | 'uncertain';
  novelty: 'independent' | 'duplicate' | 'variant' | 'uncertain';
  reasons: string[];
  citations: GenerationQualityCitation[];
  matchedEntryIds: string[];
  /** Pinned question/version identities shown to the novelty judge. */
  comparedEntryIds?: string[];
  evidencePacketId: string;
  memoryDigest: string;
  checkedAt: Date;
  /** Bounded authoring evidence for withheld items that have no saved version. */
  candidate?: GenerationQualityCandidate;
  coverage: {
    evidenceTruncated: boolean;
    memoryTruncated: boolean;
    shownEntries: number;
    totalEntries: number;
    missingVersions: number;
    consistency: 'best-effort';
  };
}

export interface GenerationQualityRunResult {
  policy: 'grounded-memory-v1';
  assessments: GenerationQualityAssessment[];
  /** Frozen originals used for review; kept outside the metadata-only usage ledger. */
  evidence?: GenerationEvidencePacket;
}
