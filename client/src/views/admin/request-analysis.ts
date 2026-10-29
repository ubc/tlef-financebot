import { el } from '../../dom.js';
import type { OperationRecord } from '../../api.js';
import { diagnosticLink } from './diagnostic-ui.js';

const phases: Record<string, string> = { 'ip-block': 'IP access rule', 'body-parser': 'Reading request input', 'probe-guard': 'Known probe rejection', 'rate-limit': 'Request rate limit',
  'session-load': 'Loading the login session', 'user-load': 'Loading the account', authentication: 'Checking authentication', authorization: 'Checking access', routing: 'Matching an API route', transfer: 'Transferring the response', application: 'Application handler' };
const reasons: Record<string, string> = {
  'ip-address-blocked': 'A manually configured IP rule rejected the API request before body parsing and login/session loading.',
  'malformed-json': 'The server could not parse the JSON input.', 'payload-too-large': 'The input exceeded the admitted size.',
  'known-path-rejected': 'A fixed known probe path was rejected.', 'rate-limit-reached': 'The request rate limit was reached.',
  'identity-lookup-failed': 'The session/account lookup returned an error; this does not establish that the caller was signed out.',
  'session-credential-absent': 'No login-session credential was sent. A signed-out browser or a browser whose cookie expired can do this.',
  'session-signature-invalid': 'The login-session signature did not validate.', 'session-credential-ambiguous': 'Multiple login-session credentials were supplied.',
  'session-not-restored': 'The signed credential did not restore its stored session. Expiry and server-side removal cannot be distinguished from this record.',
  'no-authenticated-account': 'No authenticated account was established for this request.', 'access-denied': 'The access check rejected the request.',
  'authenticated-request-rejected': 'The account was authenticated, but the endpoint returned 401. Inspect endpoint-specific credentials and the recorded error before attributing this to CWL session expiry.',
  'no-route-matched': 'No API route matched. The record alone cannot distinguish a stale client, a check, a manual request or scanning.',
  'connection-closed-before-identity': 'The connection closed while session/account lookup was still running.',
  'connection-closed': 'The connection closed before completion. The server cannot distinguish navigation, preview replacement, network loss or a proxy disconnect.',
  'application-exception': 'The handler raised an exception; inspect the retained code locations.', 'application-response': 'The handler reported a failure or partial result; inspect its validation details.',
};
const stages: Record<string, string> = { 'not-started': 'Not started', 'session-loading': 'Session lookup pending', 'user-loading': 'Account lookup pending', complete: 'Completed', failed: 'Lookup failed' };

/** Server observations and spoofable browser hints are presented separately. */
export function requestAnalysis(operation: OperationRecord): HTMLElement {
  const request = operation.request;
  const rows: Array<[string, string]> = [];
  const phase = String(operation.response.failurePhase ?? '');
  const reason = String(operation.response.failureReason ?? '');
  if (phase) rows.push(['Observed failure stage', phases[phase] || phase]);
  if (request?.identity) {
    rows.push(['Identity lookup at connection end', stages[request.identity.stageAtEnd ?? request.identity.stage]]);
    rows.push(['Final identity lookup', stages[request.identity.stage]]);
    if (request.identity.wait) rows.push(['Identity completion after disconnect', request.identity.wait === 'resolved' ? 'Observed within the bounded audit wait' : request.identity.wait === 'timed-out' ? 'Still unresolved after 1.5 seconds' : 'Audit wait capacity reached']);
    if (request.identity.sessionAccountPuid) rows.push(['Account PUID in stored session', request.identity.sessionAccountPuid]);
    if (request.identity.sessionLookup) rows.push(['Stored session lookup', request.identity.sessionLookup === 'restored' ? 'Restored the presented session' : request.identity.sessionLookup === 'not-restored' ? 'Presented session not restored' : 'No unambiguous valid credential for correlation']);
  }
  if (request?.session) {
    rows.push(['Login-session credential', { absent: 'Not sent', signed: 'Signature valid; current login still requires session/account lookup', invalid: 'Invalid or unsigned', ambiguous: 'Multiple values' }[request.session.credential]]);
    if (request.session.group) rows.push(['Session correlation group', request.session.group]);
  }
  const section = el('section', { class: 'ac-callout', 'aria-label': 'Request cause analysis' }, el('h3', { text: 'Request cause analysis' }));
  if (rows.length) section.append(el('dl', { class: 'ac-properties' }, ...rows.flatMap(([label, value]) => [el('dt', { text: label }), el('dd', { text: value })])));
  if (reasons[reason]) section.append(el('p', { text: reasons[reason] }));
  const source = request?.source;
  if (source) section.append(el('h4', { text: 'Browser initiation hints (unverified)' }), el('dl', { class: 'ac-properties' }, ...[
    ['Page', source.page || 'Not supplied'], ['Call location', source.callsite || 'Unavailable'], ['Trigger', source.trigger || 'Not supplied'], ['Request channel', source.channel || 'Not supplied'],
  ].flatMap(([label, value]) => [el('dt', { text: label }), el('dd', { text: value })])), el('p', { text: 'These hints can be forged. They explain reported application context, not verified sender intent.' }));
  else section.append(el('p', { text: 'No browser initiation hint was retained. This can be an older client, an uninstrumented caller or external traffic; its initiating action is unknown.' }));
  if (request?.session?.group) section.append(el('p', { text: 'Compare requests carrying the same signed session credential, including authenticated requests. This group is not an account identity and grants no access.' }), diagnosticLink('Compare session requests', `#/admin/operations?tab=requests&activity=all&q=${encodeURIComponent(request.session.group)}`));
  if (request?.identity?.sessionAccountPuid && !operation.actor) section.append(el('p', { text: 'The stored session names this account, but this request did not complete account verification. The PUID is association evidence, not an authenticated actor.' }));
  return section;
}
