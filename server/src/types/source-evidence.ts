import type { ObjectId } from 'mongodb';

export interface SourceKnowledgePoint {
  kind: 'concept' | 'formula' | 'notation' | 'unit' | 'condition';
  name: string;
  passageId: string;
  quote: string;
  /** Additional exact source spans; each remains a separate original quote. */
  supportingPassages?: Array<{ passageId: string; quote: string }>;
}
/** All IDs are source-local; the run translates them to its own ledger IDs. */
export interface SourceExtractionSection {
  sectionId: string;
  objectives: Array<{ name: string; passageId: string; quote: string; supportingPassages?: Array<{ passageId: string; quote: string }> }>;
  knowledge: SourceKnowledgePoint[];
  skipReason?: string;
  /** Every original passage not attached to an objective is explicitly accounted for. */
  passageDispositions?: Array<{ passageId: string; disposition: 'context' | 'non-instructional' | 'visual-review'; reason: string }>;
}
export interface SourceEvidenceExtraction {
  /** Absent historical records use word-boundary-v1. The exact rendered
   * prompt, not this locator label, controls source extraction cache identity. */
  passagePolicy?: 'word-boundary-v1' | 'line-boundary-v2';
  courseId: ObjectId;
  materialId: ObjectId;
  cacheKey: string;
  parentCacheKey?: string;
  parentPromptTextHash?: string;
  sourceTextHash: string;
  parserVersion: string;
  chunkerVersion: string;
  promptVersion: string;
  promptTextHash: string;
  schemaVersion: string;
  modelConfigurationHash: string;
  sourceTitle: string;
  guidanceHash: string;
  sectionIds: string[];
  sections: SourceExtractionSection[];
  completedAt: Date;
}
