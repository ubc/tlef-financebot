// Minimal failure telemetry: no form contents, DOM, cookies or local storage.
let reports = 0;
let windowStart = Date.now();
export interface ClientRequestFailure { endpoint: string; statusCode?: number; relatedRequestId?: string }
export function reportClientFailure(kind: 'runtime' | 'unhandled-rejection' | 'network' | 'http' | 'response', message: string, request?: ClientRequestFailure): void {
  if (Date.now() - windowStart > 60_000) { reports = 0; windowStart = Date.now(); }
  if (reports++ >= 5) return;
  void fetch('/api/diagnostics/client-error', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
    body: JSON.stringify({ kind, message: message.slice(0, 2000), page: window.location.hash.split('?')[0].slice(0, 250),
      ...(request ? { request: { endpoint: request.endpoint.split(/[?#]/, 1)[0].slice(0, 4096),
        statusCode: request.statusCode, relatedRequestId: request.relatedRequestId } } : {}) }),
  }).catch(() => undefined); // Network failure reporting must never recurse.
}
export function installClientDiagnostics(): void {
  window.addEventListener('error', (event) => {
    if (event.message) reportClientFailure('runtime', event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportClientFailure('unhandled-rejection', event.reason instanceof Error ? event.reason.message : 'Unhandled asynchronous failure');
  });
}
