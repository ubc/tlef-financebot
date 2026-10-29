import type { OperationEvent } from '../types/domain';

/** Observed failure mechanisms only. The sender's intent is not inferred. */
export function requestFailureAnalysis(event: OperationEvent): { failurePhase: string; failureReason: string } {
  const identity = event.request?.identity;
  if (event.outcome === 'interrupted') {
    const stage = identity?.stageAtEnd ?? identity?.stage;
    return { failurePhase: stage === 'session-loading' ? 'session-load' : stage === 'user-loading' ? 'user-load' : 'transfer',
      failureReason: ['session-loading', 'user-loading'].includes(stage ?? '') ? 'connection-closed-before-identity' : 'connection-closed' };
  }
  const category = event.response.failureCategory;
  if (category === 'ip-blocked') return { failurePhase: 'ip-block', failureReason: 'ip-address-blocked' };
  if (category === 'malformed-json' || category === 'payload-too-large') return { failurePhase: 'body-parser', failureReason: category };
  if (category === 'probe-rejected') return { failurePhase: 'probe-guard', failureReason: 'known-path-rejected' };
  if (event.statusCode === 429) return { failurePhase: 'rate-limit', failureReason: 'rate-limit-reached' };
  if (identity?.failedDuring) return { failurePhase: identity.failedDuring === 'session-loading' ? 'session-load' : 'user-load', failureReason: 'identity-lookup-failed' };
  if (event.statusCode === 401 && event.actor) return { failurePhase: 'application', failureReason: 'authenticated-request-rejected' };
  if (event.statusCode === 401) return { failurePhase: 'authentication', failureReason:
    event.request?.session?.credential === 'absent' ? 'session-credential-absent' :
      event.request?.session?.credential === 'invalid' ? 'session-signature-invalid' :
        event.request?.session?.credential === 'ambiguous' ? 'session-credential-ambiguous' :
          identity?.sessionLookup === 'not-restored' ? 'session-not-restored' : 'no-authenticated-account' };
  if (event.statusCode === 403) return { failurePhase: 'authorization', failureReason: 'access-denied' };
  if (event.statusCode === 404 && event.route === '/unmatched') return { failurePhase: 'routing', failureReason: 'no-route-matched' };
  return { failurePhase: 'application', failureReason: event.response.exception ? 'application-exception' : 'application-response' };
}
