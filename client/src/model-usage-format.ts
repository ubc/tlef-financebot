/** Provider counts are nullable. Missing or invalid counts must never render as zero. */
export function tokenCount(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value.toLocaleString()
    : 'Unknown';
}

export interface UsageCoverage {
  status: 'complete' | 'partial' | 'pending' | 'unavailable';
  observedCalls: number;
  reportedCalls: number;
  unknownCalls: number;
  pendingCalls: number;
}

export function usageCoverageLabel(summary: UsageCoverage): string {
  switch (summary.status) {
    case 'complete': return 'Complete recorded usage';
    case 'partial': return 'Partial usage · known subtotal';
    case 'pending': return 'Usage still arriving';
    case 'unavailable': return 'Usage unavailable';
  }
}

export function usageCoverageNote(summary: UsageCoverage): string {
  return `${summary.reportedCalls} of ${summary.observedCalls} observed calls reported usage` +
    (summary.pendingCalls ? ` · ${summary.pendingCalls} pending` : '') +
    (summary.unknownCalls ? ` · ${summary.unknownCalls} unknown` : '') +
    '. Instrumented LLM calls only; earlier or unrecorded activity cannot be reconstructed. ' +
    'This is not billing. Embeddings, parsing and infrastructure are excluded.';
}
