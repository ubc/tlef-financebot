/** Private server-generated logical schema-correction audit. Provider JSON
 * retries, semantic reconsideration and teacher acceptance are outside scope. */
export interface GenerationReviewRepairReceipt {
  protocol: 'frozen-review-decisions-v1';
  status: 'consistent' | 'drift';
  corrected: boolean;
  candidateHash: string;
  requirementsHash: string;
  evidenceHash: string;
  before: Record<string, string | boolean>;
  after: Record<string, string | boolean>;
  changes: Array<{ path: string; before: string | boolean; after?: string | boolean }>;
  initialIssues: Array<{ path: string; code: string }>;
  receiptHash: string;
}
