import { createModelUsageTracker } from '../services/model-usage.service';
import { withModelCallObserver } from '../components/genai/llm/model-call';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { operationContext } from '../services/operation-context';
import { recordOperation, safeControls, safeDiagnostic, operationLogContext } from '../services/operation-audit.service';
import type { OperationEvent } from '../types/domain';
import { requestDiagnostics, requestFingerprints } from '../services/request-diagnostics';
import { env } from '../config/env';

/** Mounted before parsers/rate limiting: malformed requests are failures too. */
export const operationAudit: RequestHandler = (req, res, next) => {
  const requestId = randomUUID();
  const started = Date.now();
  const requestMetadata = requestDiagnostics(req.originalUrl, req.get('user-agent'), req.get('sec-fetch-site'));
  const peer = req.socket?.remoteAddress;
  const trust = req.app?.get('trust proxy fn');
  const proxy = { forwarded: Boolean(req.get('x-forwarded-for')), trustedPeer: Boolean(peer && typeof trust === 'function' && trust(peer, 0)) };
  const fingerprints = requestFingerprints(peer, req.get('user-agent'), new Date(started), env.sessionSecret,
    proxy.forwarded && proxy.trustedPeer ? req.ip : undefined);
  const slowThresholdMs = 30000;
  const slowTimer = setTimeout(() => {
    if (String(res.getHeader('Content-Type')).includes('text/event-stream')) return;
    console.warn('[http.operation_pending]', JSON.stringify({ requestId, method: req.method,
      elapsedMs: Date.now() - started, headersSent: res.headersSent, request: requestMetadata }));
  }, slowThresholdMs);
  slowTimer.unref();
  const usage = createModelUsageTracker(() => ({
    operationId: requestId,
    courseId: String(res.locals.courseId ?? req.params.courseId ?? req.body?.courseId ?? ''),
    ...(req.user ? { actor: { puid: req.user.puid, uid: req.user.uid, displayName: req.user.displayName } } : {}),
    stage: 'api-completion',
  }));
  res.setHeader('X-Request-ID', requestId);
  let response: Record<string, unknown> = {};
  const json = res.json;
  res.json = function (body: unknown) {
    // Keep just diagnostic metadata, not the body (which may contain answers).
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const data = body as Record<string, unknown>;
      response = { ...safeControls(data) };
      for (const [field, rows, key] of [['runIds', data.runs, 'runId'], ['materialIds', data.materials, '_id']] as const) {
        if (Array.isArray(rows)) response[field] = rows.slice(0, 100).flatMap(row => {
          const id = row && typeof row === 'object' ? String((row as Record<string, unknown>)[key] ?? '') : '';
          return /^[a-f\d]{24}$/i.test(id) ? [id] : [];
        });
      }
      if (typeof data.error === 'string') response.error = safeDiagnostic(data.error);
      if (typeof data.verificationError === 'string') response.error = safeDiagnostic(data.verificationError);
      if (typeof data.verificationError === 'string') response.hasIssues = true;
      for (const key of ['failures', 'skipped', 'mismatches']) {
        if (Array.isArray(data[key]) && data[key].length) {
          response.hasIssues = true;
          response[`${key}Count`] = data[key].length;
          response[key] = data[key].slice(0, 20).map((item: unknown) => {
            if (typeof item === 'string') return safeDiagnostic(item);
            if (!item || typeof item !== 'object') return null;
            const issue = item as Record<string, unknown>;
            return { ...safeControls(issue), line: safeDiagnostic(String(issue.line ?? '')), reason: safeDiagnostic(issue.reason), message: safeDiagnostic(issue.message) };
          });
        }
      }
      if (Array.isArray(data.issues)) response.issues = data.issues.slice(0, 20).map((item: unknown) => {
        if (!item || typeof item !== 'object') return { message: safeDiagnostic(item) };
        const issue = item as Record<string, unknown>;
        return { path: safeDiagnostic(issue.path), message: safeDiagnostic(issue.message) };
      });
    }
    return json.call(this, body);
  };
  let recorded = false;
  function finish(aborted: boolean): void {
    if (recorded) return;
    recorded = true;
    clearTimeout(slowTimer);
    void usage.close();
    const failed = aborted || res.statusCode >= 400 || Boolean(response.error) || Boolean(res.locals.operationException);
    const rawPath = req.originalUrl.split('?')[0];
    // Authenticated browser reports own their request ID. A client navigating
    // away while that insert is pending must not insert a second event under
    // the same unique ID. Rejected reports still have an ordinary HTTP record.
    if (rawPath === '/api/diagnostics/client-error' && res.statusCode < 400) return;
    // Closing an established SSE connection on navigation is normal, not a
    // failed user action. Failed handshakes are still recorded below.
    if (res.statusCode < 400 && !res.locals.operationException && String(res.getHeader('Content-Type')).includes('text/event-stream')) return;
    // Usage refreshes are diagnostics reads, not new user workflow steps.
    if (!failed && req.method === 'GET' && (/\/content-runs\/[a-f\d]{24}\/usage$/i.test(rawPath) || /^\/api\/admin\/(model-usage|workflows)/.test(rawPath))) return;
    // Successful infrastructure polls are intentionally excluded. Failures stay.
    if (!failed && req.method === 'GET' && rawPath === '/api/notifications') return;
    if (!failed && (/^\/api\/(health|auth\/me|diagnostics\/client-error)$/.test(rawPath) || /\/events$/.test(rawPath))) return;
    const route = typeof req.route?.path === 'string' ? req.route.path : '/unmatched';
    const targets: Record<string, string> = {};
    for (const [key, val] of Object.entries(req.params)) {
      if (typeof val === 'string' && /^[a-f\d]{24}$/i.test(val)) targets[key] = val;
      if (key === 'puid' && typeof val === 'string' && /^[\w.-]{1,128}$/.test(val)) targets.targetPuid = val;
    }
    for (const match of rawPath.matchAll(/\/(courses|questions|materials|content-runs|attempts)\/([a-f\d]{24})(?=\/|$)/gi)) {
      targets[({ courses: 'courseId', questions: 'questionId', materials: 'materialId', 'content-runs': 'runId', attempts: 'attemptId' } as Record<string, string>)[match[1]]] = match[2];
    }
    if (res.locals.courseId) targets.courseId = String(res.locals.courseId);
    if (res.locals.operationException) response.exception = res.locals.operationException;
    const event: OperationEvent = {
      requestId, createdAt: new Date(started), durationMs: Date.now() - started,
      method: req.method, route, statusCode: aborted ? 499 : res.statusCode,
      request: { ...requestMetadata, routeMatched: route !== '/unmatched',
        routeState: route !== '/unmatched' ? 'matched' : res.locals.probeRejected ? 'probe-rejected' : res.locals.routingComplete ? 'unmatched' : 'not-evaluated',
        proxy, responseStarted: res.headersSent, rangeRequested: Boolean(req.get('range')),
        loginState: res.locals.authenticationPending || typeof req.isAuthenticated !== 'function' ? 'not-evaluated' : req.isAuthenticated() ? 'authenticated' : 'unauthenticated',
        webClient: req.get('x-financebot-client') === 'web-v1', ...(fingerprints ? { fingerprints } : {}) },
      outcome: aborted ? 'interrupted' : res.statusCode >= 400 || res.locals.operationException ? 'failed' : response.hasIssues ? 'partial' : failed ? 'failed' : res.statusCode === 202 ? 'accepted' : 'succeeded',
      actor: req.user ? { puid: req.user.puid, uid: req.user.uid, displayName: req.user.displayName } : undefined,
      targets, input: { ...safeControls(req.query), ...safeControls(req.body) }, response,
    };
    if (['failed', 'partial', 'interrupted'].includes(event.outcome)) {
      const category = res.locals.operationException?.category ?? (aborted ? 'connection-interrupted' : res.locals.probeRejected ? 'probe-rejected' : event.statusCode === 404 && route === '/unmatched' ? 'route-not-found'
        : event.statusCode === 401 ? 'authentication' : event.statusCode === 403 ? 'authorization'
        : event.statusCode === 429 ? 'rate-limit' : event.statusCode >= 500 ? 'server-failure'
        : event.statusCode === 400 || event.statusCode === 422 ? 'validation' : 'application');
      response.failureCategory = category;
      console.warn(event.statusCode === 404 && route === '/unmatched' ? '[http.route_not_found]' : '[http.operation_failed]',
        JSON.stringify({ ...operationLogContext(event), category, ...(res.locals.operationException ? { exception: res.locals.operationException } : {}) }));
    } else if (event.durationMs >= slowThresholdMs) {
      console.warn('[http.operation_slow]', JSON.stringify(operationLogContext(event)));
    }
    void recordOperation(event);
  }
  res.once('finish', () => finish(false));
  res.once('close', () => { if (!res.writableFinished) finish(true); });
  withModelCallObserver(usage.observer, () => operationContext.run(requestId, next));
};
