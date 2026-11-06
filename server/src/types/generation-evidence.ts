import type { ObjectId } from 'mongodb';
import type { SourceLocation } from './source-provenance';

export type EvidenceRole = 'primary' | 'secondary' | 'prerequisite';
export interface EvidenceMaterialScope {
  materialId: string;
  role: EvidenceRole;
  loId?: string;
  loName?: string;
}
export interface EvidenceSeed {
  materialId?: string;
  chunkIndex?: number;
  text: string;
  /** Server-validated catalog locator within the original chunk. */
  preferredStart?: number;
}
export interface GenerationEvidenceInput {
  courseId: ObjectId;
  loIds: ObjectId[];
  /** Already resolved by the generation owner; the loader never broadens this set. */
  allowedMaterials: EvidenceMaterialScope[];
  seeds: EvidenceSeed[];
  policyVersion: string;
  /** Explicit internal opt-in. Absent historical requests retain v1 identities. */
  sourceProvenance?: 'pdf-pages-v1';
  query?: string;
}
export interface EvidenceFinding {
  code: 'evidence-budget-truncated' | 'source-text-damage';
  message: string;
  passageIds: string[];
}
export interface EvidencePassage extends EvidenceMaterialScope {
  id: string;
  materialName: string;
  chunkIndex: number;
  /** Exact half-open offsets within the persisted source chunk. */
  start: number;
  end: number;
  text: string;
  selection: 'retrieved' | 'neighbor';
  /** Server-computed physical location only; never semantic source proof. */
  sourceLocation?: SourceLocation;
}
export interface EvidenceMaterialSnapshot extends EvidenceMaterialScope {
  name: string;
  revision: number | null;
  activeRunId: string | null;
  contentHash: string;
  chunkCount: number;
  parserVersion?: string;
  chunkerVersion?: string;
  sourceProvenance?: { provenanceId: string; receiptHash: string };
}
export interface GenerationEvidencePacket {
  id: string;
  schemaVersion: 'source-passages-v1' | 'source-passages-v2';
  policyVersion: string;
  courseId: string;
  loIds: string[];
  sourceFingerprint: string;
  /** Existing source chunks do not record the actual parser/fallback version. */
  parsingProvenance: 'unrecorded' | 'verified' | 'partial';
  materials: EvidenceMaterialSnapshot[];
  passages: EvidencePassage[];
  coverage: {
    sourceChunks: number;
    selectedChunks: number;
    selectedCharacters: number;
    omittedPassages: number;
    truncated: boolean;
    searchScope: 'retrieved-chunks-and-immediate-neighbors';
    catalogChunks?: number;
    catalogRejectedReferences?: number;
    catalogUnrepresentedMaterials?: string[];
  };
  findings: EvidenceFinding[];
}
