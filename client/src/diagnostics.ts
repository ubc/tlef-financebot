// Minimal failure telemetry: no form contents, DOM, cookies or local storage.
import { addRequestSource } from './request-source.js';
let reports = 0;
let windowStart = Date.now();
let authenticated = false;
/** Reporting is authenticated too; stop after expiry and resume after login. */
export function setDiagnosticsAuthenticated(value: boolean): void { authenticated = value; }
export interface ClientRequestFailure { endpoint: string; statusCode?: number; relatedRequestId?: string }
export function reportClientFailure(kind: 'runtime' | 'unhandled-rejection' | 'network' | 'http' | 'response', message: string, request?: ClientRequestFailure): void {
  if (!authenticated) return;
  if (Date.now() - windowStart > 60_000) { reports = 0; windowStart = Date.now(); }
  if (reports++ >= 5) return;
  const headers = new Headers({ 'Content-Type': 'application/json', 'X-Financebot-Client': 'web-v1' });
  addRequestSource(headers, 'diagnostic-report');
  void fetch('/api/diagnostics/client-error', {
    method: 'POST', headers, credentials: 'same-origin',
    body: JSON.stringify({ kind, message: message.slice(0, 2000), page: window.location.hash.split('?')[0].slice(0, 250),
      ...(request ? { request: { endpoint: request.endpoint.split(/[?#]/, 1)[0].slice(0, 4096),
        statusCode: request.statusCode, relatedRequestId: request.relatedRequestId } } : {}) }),
  }).then(response => { if (response.status === 401) authenticated = false; }).catch(() => undefined); // Never recurse.
}
export function installClientDiagnostics(): void {
  window.addEventListener('error', (event) => {
    if (event.message) reportClientFailure('runtime', event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportClientFailure('unhandled-rejection', event.reason instanceof Error ? event.reason.message : 'Unhandled asynchronous failure');
  });
}
