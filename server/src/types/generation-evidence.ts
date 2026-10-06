import type { ObjectId } from 'mongodb';

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
}
export interface GenerationEvidenceInput {
  courseId: ObjectId;
  loIds: ObjectId[];
  /** Already resolved by the generation owner; the loader never broadens this set. */
  allowedMaterials: EvidenceMaterialScope[];
  seeds: EvidenceSeed[];
  policyVersion: string;
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
}
export interface EvidenceMaterialSnapshot extends EvidenceMaterialScope {
  name: string;
  revision: number | null;
  activeRunId: string | null;
  contentHash: string;
  chunkCount: number;
}
export interface GenerationEvidencePacket {
  id: string;
  schemaVersion: 'source-passages-v1';
  policyVersion: string;
  courseId: string;
  loIds: string[];
  sourceFingerprint: string;
  /** Existing source chunks do not record the actual parser/fallback version. */
  parsingProvenance: 'unrecorded';
  materials: EvidenceMaterialSnapshot[];
  passages: EvidencePassage[];
  coverage: {
    sourceChunks: number;
    selectedChunks: number;
    selectedCharacters: number;
    omittedPassages: number;
    truncated: boolean;
    searchScope: 'retrieved-chunks-and-immediate-neighbors';
  };
  findings: EvidenceFinding[];
}
