/** Instrumented SDK invocations, not physical requests hidden inside SDK retries. */
export interface AuthoringBudgetLimits {
  maxSends: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxEstimatedTokens: number;
}
export type AuthoringLogicalWork = 'generator-attempt' | 'repair-cycle' | 'evidence-expansion';
export type AuthoringBudgetAccounting = 'conservative-reservations-v1' | 'reported-usage-settlement-v1';
export interface AuthoringBudgetOptions {
  /** Explicit experiment only. Failed/incomplete sends retain reservations. */
  accounting?: AuthoringBudgetAccounting;
}
export interface AuthoringLogicalReceipt {
  generatorAttempts: number;
  repairCycles: number;
  evidenceExpansions: number;
  limits: { generatorAttempts: number; repairCycles: number; evidenceExpansions: number };
}

export interface AuthoringBudgetReceipt {
  version: 1;
  estimator: 'utf8-bytes-conservative-v1';
  retryVisibility: 'unknown';
  limitScope: 'process';
  observedSends: number;
  estimatedInputTokens: number;
  reservedOutputTokens: number;
  /** Estimates above remain cumulative audit data. This ledger admits new sends. */
  accounting?: AuthoringBudgetAccounting;
  admissionTokens?: number;
  pendingSends?: number;
  settledSends?: number;
  conservativeFinishedSends?: number;
  reportedInputTokens: number | null;
  reportedOutputTokens: number | null;
  usageCompleteness: 'complete' | 'partial' | 'unknown';
  queueWaitMs: number;
  executionMs: number;
  rejectedSends: number;
  logical: AuthoringLogicalReceipt;
  limits: AuthoringBudgetLimits;
}
