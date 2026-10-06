import { operationEventsCol } from '../components/mongodb/collections';
import type { OperationEvent } from '../types/domain';

let failedWrites = 0;
let lastFailureAt: Date | undefined;
let pendingWrites = 0;
export function auditHealth(): { failedWrites: number; pendingWrites: number; lastFailureAt?: Date } {
  return { failedWrites, pendingWrites, lastFailureAt };
}

// Bounded, best-effort telemetry. A DB outage must not exhaust process memory
// or turn a completed user mutation into a misleading HTTP failure.
export async function recordOperation(event: OperationEvent): Promise<void> {
  if (pendingWrites >= 100) { failedWrites++; lastFailureAt = new Date(); return; }
  pendingWrites++;
  try { await operationEventsCol().insertOne(event); }
  catch { failedWrites++; lastFailureAt = new Date(); console.error('[audit] Operation record could not be saved.'); }
  finally { pendingWrites--; }
}

export function safeDiagnostic(value: unknown): string {
  if (typeof value !== 'string') return '';
  const redacted = value
    .replace(/\b(?:Bearer|Basic)\s+[\w+/=.-]+/gi, '[redacted authorization]')
    .replace(/\b(?:password|passwd|secret|token|api[_-]?key|cookie|authorization)\b["']?\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '[redacted credential]')
    .replace(/https?:\/\/[^\s)"']+/gi, (url) => {
      try { const parsed = new URL(url); return `${parsed.protocol}//${parsed.host}${parsed.pathname}`; }
      catch { return '[redacted URL]'; }
    });
  return redacted.length > 2000 ? `${redacted.slice(0, 2000)}… [truncated]` : redacted;
}

/** Allowlisted scalar controls, never free text, scripts, answers or uploads. */
export function safeControls(value: unknown): Record<string, string | number | boolean> {
  if (!value || typeof value !== 'object') return {};
  const result: Record<string, string | number | boolean> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!/^(courseId|questionId|versionId|materialId|runId|loId|themeId|attemptId|count|type|difficulty|kind|state|to|seed|version|page|limit|mode|strategy|qualityPolicy)$/.test(key)) continue;
    if (typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) result[key] = item;
    else if (typeof item === 'string' && /^[\w.-]{1,128}$/.test(item)) result[key] = item;
  }
  return result;
}
