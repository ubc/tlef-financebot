import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { operationContext } from '../services/operation-context';
import { recordOperation, safeControls, safeDiagnostic } from '../services/operation-audit.service';
import type { OperationEvent } from '../types/domain';

/** Mounted before parsers/rate limiting: malformed requests are failures too. */
export const operationAudit: RequestHandler = (req, res, next) => {
  const requestId = randomUUID();
  const started = Date.now();
  res.setHeader('X-Request-ID', requestId);
  let response: Record<string, unknown> = {};
  const json = res.json;
  res.json = function (body: unknown) {
    // Keep just diagnostic metadata, not the body (which may contain answers).
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const data = body as Record<string, unknown>;
      response = { ...safeControls(data) };
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
    const failed = aborted || res.statusCode >= 400 || Boolean(response.error);
    const rawPath = req.originalUrl.split('?')[0];
    // Authenticated browser reports own their request ID. A client navigating
    // away while that insert is pending must not insert a second event under
    // the same unique ID. Rejected reports still have an ordinary HTTP record.
    if (rawPath === '/api/diagnostics/client-error' && res.statusCode < 400) return;
    // Closing an established SSE connection on navigation is normal, not a
    // failed user action. Failed handshakes are still recorded below.
    if (res.statusCode < 400 && String(res.getHeader('Content-Type')).includes('text/event-stream')) return;
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
    const event: OperationEvent = {
      requestId, createdAt: new Date(started), durationMs: Date.now() - started,
      method: req.method, route, statusCode: aborted ? 499 : res.statusCode,
      outcome: aborted ? 'interrupted' : res.statusCode >= 400 ? 'failed' : response.hasIssues ? 'partial' : failed ? 'failed' : res.statusCode === 202 ? 'accepted' : 'succeeded',
      actor: req.user ? { puid: req.user.puid, uid: req.user.uid, displayName: req.user.displayName } : undefined,
      targets, input: { ...safeControls(req.query), ...safeControls(req.body) }, response,
    };
    void recordOperation(event);
  }
  res.once('finish', () => finish(false));
  res.once('close', () => { if (!res.writableFinished) finish(true); });
  operationContext.run(requestId, next);
};
