import type { ObjectId } from 'mongodb';

export interface IntendedUploadFile {
  clientFileId: string;
  name: string;
  size: number;
}

export interface MaterialUploadBatchItem extends IntendedUploadFile {
  disposition: 'pending' | 'created' | 'reused' | 'rejected';
  materialId?: ObjectId;
  error?: string;
}

/** Admission metadata only: no source text, file bytes, grades or credentials. */
export interface MaterialUploadBatch {
  courseId: ObjectId;
  requestedBy: string;
  requestId: string;
  manifestHash: string;
  items: MaterialUploadBatchItem[];
  revision: number;
  createdAt: Date;
  updatedAt: Date;
  admission: 'prepared' | 'uploading' | 'accepted' | 'rejected';
  uploadOwner?: string;
  uploadLeaseUntil?: Date;
  admissionError?: string;
}

export interface SourceSnapshot {
  materialId: string;
  /** Observed metadata revision for write CAS, not original-source identity. */
  revision?: number;
  name: string;
  sourceTextHash: string;
  chunkCount: number;
  characterCount: number;
  ingestRunId?: string;
  parserVersion: string;
  chunkerVersion: string;
}

export interface MaterialSourceReadiness {
  materialId: string;
  name: string;
  ready: boolean;
  state: 'indexed' | 'processing' | 'failed' | 'trashed' | 'missing' | 'manifest-invalid';
  reason?: string;
  snapshot?: SourceSnapshot;
  classification: 'pending' | 'completed' | 'warning' | 'unknown';
}

export interface SourceSelectionReport {
  sourceBatchId?: string;
  replacements?: Array<{ previousMaterialId: string; replacementMaterialId: string; previousName: string; replacementName: string }>;
  requested: Array<MaterialSourceReadiness & { clientFileId?: string }>;
  included: SourceSnapshot[];
  excluded: Array<{ name: string; materialId?: string; clientFileId?: string; reason: string }>;
  ready: boolean;
}
