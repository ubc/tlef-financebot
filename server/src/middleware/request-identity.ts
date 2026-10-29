import type { Request, Response, RequestHandler } from 'express';
import type { OperationEvent } from '../types/domain';
import { env } from '../config/env';
import { requestSession, sessionGroup } from '../services/request-diagnostics';

type Stage = 'not-started' | 'session-loading' | 'user-loading' | 'complete' | 'failed';
type Actor = OperationEvent['actor'];
interface Trace {
  stage: Stage; completion: Promise<void>; settle: () => void;
  actor?: Actor; sessionAccountPuid?: string;
  sessionLookup?: 'restored' | 'not-restored' | 'no-valid-credential';
  failedDuring?: 'session-loading' | 'user-loading';
}
const traces = new WeakMap<Response, Trace>();
let waiting = 0;

export function startRequestIdentity(res: Response): void {
  let settle!: () => void;
  const completion = new Promise<void>(resolve => { settle = resolve; });
  traces.set(res, { stage: 'not-started', completion, settle });
}

/** Observe the existing auth chain; never perform a second session/user lookup. */
export function traceAuthentication(stage: 'session-loading' | 'user-loading', middleware: RequestHandler): RequestHandler {
  return (req, res, next) => {
    const trace = traces.get(res);
    if (trace) trace.stage = stage;
    res.locals.authenticationPending = true;
    let completed = false;
    const done = (error?: unknown): void => {
      if (completed) { if (error) next(error); return; }
      completed = true;
      if (trace) {
        if (stage === 'session-loading' && !error) {
          const presented = requestSession(req.get('cookie'), env.sessionSecret);
          trace.sessionLookup = presented.credential === 'signed'
            ? presented.group ? sessionGroup(req.sessionID, env.sessionSecret) === presented.group ? 'restored' : 'not-restored' : undefined
            : 'no-valid-credential';
          const puid = (req.session as { passport?: { user?: unknown } } | undefined)?.passport?.user;
          if (typeof puid === 'string' && /^[\w.-]{1,128}$/.test(puid)) trace.sessionAccountPuid = puid;
        }
        if (error || stage === 'user-loading') {
          trace.stage = error ? 'failed' : 'complete';
          if (error) trace.failedDuring = stage;
          if (!error && req.user) trace.actor = actorFrom(req);
          trace.settle();
        }
      }
      if (error || stage === 'user-loading') res.locals.authenticationPending = false;
      next(error);
    };
    try {
      const work = middleware(req, res, done);
      if (work && typeof (work as Promise<unknown>).then === 'function') return Promise.resolve(work).catch(done);
    } catch (error) { done(error); }
    return undefined;
  };
}

function actorFrom(req: Request): Actor {
  return req.user ? { puid: req.user.puid, uid: req.user.uid, displayName: req.user.displayName } : undefined;
}

export function identitySnapshot(req: Request, res: Response) {
  const trace = traces.get(res);
  return { stage: trace?.stage ?? 'not-started',
    ...(trace?.sessionLookup ? { sessionLookup: trace.sessionLookup } : {}),
    ...(trace?.failedDuring ? { failedDuring: trace.failedDuring } : {}),
    ...(trace?.sessionAccountPuid ? { sessionAccountPuid: trace.sessionAccountPuid } : {}),
    actor: trace?.actor ?? actorFrom(req) };
}

/** Only telemetry waits; transport outcome/time and the HTTP response stay fixed. */
export async function awaitRequestIdentity(res: Response): Promise<'resolved' | 'timed-out' | 'capacity-limited'> {
  const trace = traces.get(res);
  if (!trace || !['session-loading', 'user-loading'].includes(trace.stage)) return 'resolved';
  if (waiting >= 100) return 'capacity-limited';
  waiting++;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      trace.completion.then(() => 'resolved' as const),
      new Promise<'timed-out'>(resolve => { timer = setTimeout(() => resolve('timed-out'), 1500); timer.unref(); }),
    ]);
  } finally { if (timer) clearTimeout(timer); waiting--; }
}
