export interface StructureOptions {
  materialIds?: string[];
  topicCount?: number;
  losPerTopic?: number;
  level?: 'auto' | 'introductory' | 'advanced';
  emphasis?: 'auto' | 'balanced' | 'conceptual' | 'applied';
  guidance?: string;
}

export interface StructureEvidence {
  id: string;
  objective: string;
  materialId: string;
  materialName: string;
  chunkIndex: number;
  quote: string;
}

export interface StructureDraft {
  themes: Array<{ name: string; los: Array<{ name: string }> }>;
}

export interface StructureResult {
  themes: Array<{ name: string; los: Array<{ name: string; evidenceIds: string[]; materialIds: string[] }> }>;
  evidence: StructureEvidence[];
  coverage: {
    materials: Array<{ materialId: string; name: string; chunks: number; sections: number; mappedObjectives: number }>;
    analyzedSections: number;
    extractedObjectives: number;
    mappedObjectives: number;
    unmappedEvidenceIds: string[];
    excludedSections: Array<{ materialId: string; chunkIndex: number; reason: string }>;
    warnings: string[];
  };
}
