/** Local fetch diagnostics preserve operation and nested causes without retries. */
import { AsyncLocalStorage } from 'node:async_hooks';
const redact = (value: unknown) => String(value).replace(/\bBearer\s+[^\s,;"']+/gi, '[redacted]')
  .replace(/\b(?:api[-_ ]?key|authorization|secret|access[-_ ]?token)\s*[=:]\s*[^\s,;"']+/gi, '[redacted]')
  .replace(/\bsk-[a-zA-Z0-9_-]+/g, '[redacted]').replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/g, '$1[redacted]@').slice(0, 2400);
export interface ContinuationError { name: string; message: string; code?: string; errno?: string; syscall?: string; address?: string; port?: number;
  cause?: ContinuationError; errors?: ContinuationError[] }
export function continuationError(error: unknown, depth = 0, seen = new Set<unknown>()): ContinuationError {
  if (!error || typeof error !== 'object') return { name: 'UnknownError', message: redact(error) };
  if (depth >= 5 || seen.has(error)) return { name: 'NestedError', message: '[depth/cycle boundary]' };
  seen.add(error); const source = error as Record<string, unknown>;
  return { name: typeof source.name === 'string' ? redact(source.name) : 'Error', message: redact(source.message ?? 'unknown-error'),
    ...Object.fromEntries(['code', 'errno', 'syscall', 'address'].flatMap(key => typeof source[key] === 'string' || typeof source[key] === 'number' ? [[key, redact(source[key])]] : [])),
    ...(typeof source.port === 'number' ? { port: source.port } : {}),
    ...(source.cause ? { cause: continuationError(source.cause, depth + 1, seen) } : {}),
    ...(Array.isArray(source.errors) ? { errors: source.errors.slice(0, 8).map(item => continuationError(item, depth + 1, seen)) } : {}) };
}
export interface ContinuationOperation { operation: string; caseId: string; startedAt: string; completedAt?: string; status: 'running' | 'returned' | 'failed'; error?: ContinuationError }
export interface ContinuationFetch { operation: string; caseId: string; method: string; endpoint: string; startedAt: string; elapsedMs: number; status?: number; error?: ContinuationError }
export function installContinuationDiagnostics(input: { caseId(): string; save(): Promise<void> }): {
  operations: ContinuationOperation[]; fetches: ContinuationFetch[]; operation<T>(label: string, work: () => Promise<T>): Promise<T>; assertHealthy(): void; restore(): void;
} {
  const scope = new AsyncLocalStorage<string>(); const operations: ContinuationOperation[] = []; const fetches: ContinuationFetch[] = [];
  const original = globalThis.fetch; let failure: unknown;
  const healthy = () => { if (failure) throw new Error('public-continuation-local-evidence-failed', { cause: failure }); };
  const save = async () => { try { await input.save(); } catch (error) { failure ??= error; throw error; } };
  globalThis.fetch = async (resource, options) => {
    const url = new URL(typeof resource === 'string' ? resource : resource instanceof URL ? resource.href : resource.url);
    if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname) || url.port !== '6333') return original(resource, options);
    healthy(); const started = Date.now(); const record: ContinuationFetch = { operation: scope.getStore() ?? 'production-http-local-fetch', caseId: input.caseId(),
      method: options?.method ?? (typeof resource === 'object' && 'method' in resource ? resource.method : 'GET'), endpoint: `${url.origin}${url.pathname}`,
      startedAt: new Date(started).toISOString(), elapsedMs: 0 };
    fetches.push(record); await save();
    try { const response = await original(resource, options); record.status = response.status; return response; }
    catch (error) { record.error = continuationError(error); failure ??= error; throw error; }
    finally { record.elapsedMs = Date.now() - started; await save(); }
  };
  return { operations, fetches, assertHealthy: healthy, restore: () => { globalThis.fetch = original; }, operation: async <T>(label: string, work: () => Promise<T>) => {
    healthy(); const record: ContinuationOperation = { operation: label, caseId: input.caseId(), startedAt: new Date().toISOString(), status: 'running' };
    operations.push(record); await save();
    try { return await scope.run(label, async () => { const result = await work(); record.status = 'returned'; return result; }); }
    catch (error) { record.status = 'failed'; record.error = continuationError(error); throw error; }
    finally { record.completedAt = new Date().toISOString(); await save(); }
  } };
}
