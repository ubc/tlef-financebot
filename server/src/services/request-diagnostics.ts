import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { OperationRequestDiagnostics } from '../types/domain';
import { classifyProbe } from './request-probe.service';

// Only public route vocabulary survives. Arbitrary segments may be credentials,
// names or student input even when they look like ordinary words.
const pathWords = new Set(`api admin auth me health courses course questions materials
  users operations diagnostic-runs audit-history all-questions model-usage workflows
  diagnostics client-error notifications events content-runs usage generate generation
  generation-blueprints structure structure-generation themes los attempts practice
  preview student instructor ta settings platform-settings platform-instructors
  capabilities bank queue review-book summary exams assessments exam-templates
  analytics flags import export reproduce runs requests start status retry cancel
  archive restore publish unpublish people roster enrollment enrollments registration-codes
  canvas connection connections oauth callback materials-upload upload ingest download
  source source-context versions answers answer heartbeat close submit results
  tutorial tutorials permissions sharing invitations co-instructors tas notes rag
  members roles overview faculty staff login logout ubcshib
  .env .git config wp-admin wp-login.php xmlrpc.php phpmyadmin`.split(/\s+/));

/** Bounded metadata only: never retain raw URLs, headers, addresses or bodies. */
export function requestDiagnostics(originalUrl: string, userAgent: string | undefined, fetchSite: string | undefined): Omit<OperationRequestDiagnostics, 'routeMatched'> {
  const pathname = originalUrl.split(/[?#]/, 1)[0];
  const bounded = pathname.slice(0, 4096);
  let pathRedacted = false;
  let pathTruncated = pathname.length > bounded.length;
  const parts = bounded.split('/').filter(Boolean);
  if (parts.length > 24) pathTruncated = true;
  const path = '/' + parts.slice(0, 24).map(part => {
    let decoded: string;
    try { decoded = decodeURIComponent(part); } catch { decoded = ''; }
    if (pathWords.has(decoded)) return decoded;
    pathRedacted = true;
    return ':redacted';
  }).join('/');
  // The digest distinguishes masked paths without persisting their contents.
  // Queries/fragments are excluded; oversized paths explicitly hash a prefix.
  const pathHash = createHash('sha256').update(bounded).digest('hex');
  const ua = (userAgent ?? '').slice(0, 512);
  const client = !ua ? 'absent' : /\b(?:Edg|Edge)\//i.test(ua) ? 'edge'
    : /\b(?:Firefox|FxiOS)\//i.test(ua) ? 'firefox' : /\b(?:Chrome|CriOS)\//i.test(ua) ? 'chrome'
    : /\bSafari\//i.test(ua) ? 'safari' : /^curl\//i.test(ua) ? 'curl'
    : /^Wget\//i.test(ua) ? 'wget' : /^(?:python-requests|Python-urllib)\//i.test(ua) ? 'python' : 'other';
  const site = ['same-origin', 'same-site', 'cross-site', 'none'].includes(fetchSite ?? '')
    ? fetchSite as OperationRequestDiagnostics['fetchSite'] : 'unavailable';
  const probe = classifyProbe(originalUrl);
  return { path, pathHash, pathRedacted, pathTruncated, client, fetchSite: site, ...(probe ? { probe } : {}) };
}

/** Pseudonymous daily groups; client must be resolved through explicit proxy trust. */
export function requestFingerprints(peer: string | undefined, agent: string | undefined, date: Date, secret: string | undefined, client?: string): OperationRequestDiagnostics['fingerprints'] {
  if (!secret || secret.length < 32 || /^(?:dev-insecure-secret-change-me|change-me-in-production)$/.test(secret)) return;
  const day = date.toISOString().slice(0, 10);
  const digest = (kind: string, value: string): string => createHmac('sha256', secret)
    .update(`financebot-request-group-v1\0${day}\0${kind}\0${value}`).digest('hex').slice(0, 32);
  return { day, ...(peer ? { peer: digest('peer', peer.slice(0, 128)) } : {}), ...(agent ? { agent: digest('agent', agent.slice(0, 512)) } : {}),
    ...(client && isIP(client) ? { client: digest('client', client) } : {}) };
}

export function sessionGroup(id: string, secret: string): string | undefined {
  if (!id || !secret || secret.length < 32 || /^(?:dev-insecure-secret-change-me|change-me-in-production)$/.test(secret)) return;
  return createHmac('sha256', secret).update(`financebot-audit-session-v1\0${id}`).digest('hex').slice(0, 32);
}

/** Matches express-session's signed connect.sid format; never stores the credential. */
export function requestSession(header: string | undefined, secret: string): NonNullable<OperationRequestDiagnostics['session']> {
  if (!header) return { credential: 'absent' };
  if (header.length > 16384) return { credential: 'invalid' };
  const values = header.split(';').map(part => part.trim()).filter(part => /^connect\.sid[\t ]*=/.test(part));
  if (!values.length) return { credential: 'absent' };
  if (values.length !== 1) return { credential: 'ambiguous' };
  if (!secret) return { credential: 'invalid' };
  let value = values[0].slice(values[0].indexOf('=') + 1).trim();
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
  try { value = decodeURIComponent(value); } catch { return { credential: 'invalid' }; }
  if (!value.startsWith('s:') || value.length > 1024) return { credential: 'invalid' };
  const signed = value.slice(2), separator = signed.lastIndexOf('.');
  if (separator <= 0) return { credential: 'invalid' };
  const id = signed.slice(0, separator);
  const expected = Buffer.from(createHmac('sha256', secret).update(id).digest('base64').replace(/=+$/, ''));
  const provided = Buffer.from(signed.slice(separator + 1));
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return { credential: 'invalid' };
  const group = sessionGroup(id, secret);
  return { credential: 'signed', ...(group ? { group } : {}) };
}

const triggers = new Set(['api-call', 'notification-initial', 'notification-timer', 'notification-visible', 'notification-focus', 'notification-sync', 'diagnostic-report']);
export function requestSource(url: string, headers: { page?: string; callsite?: string; trigger?: string; webClient?: string }): OperationRequestDiagnostics['source'] {
  let query: URLSearchParams;
  try { query = new URL(url.slice(0, 8192), 'http://audit.invalid').searchParams; } catch { return; }
  const native = /\/source(?:\?|$)/.test(url) && ['embedded-preview', 'source-link'].includes(query.get('_fbSource') ?? '') ? query.get('_fbSource') as 'embedded-preview' | 'source-link'
    : /\/events(?:\?|$)/.test(url) && query.get('_fbSource') === 'event-stream' ? 'event-stream' : undefined;
  if (!native && headers.webClient !== 'web-v1') return;
  const source: NonNullable<OperationRequestDiagnostics['source']> = { channel: native ?? 'fetch' };
  const page = native ? query.get('_fbPage') : headers.page;
  if (page && page.length <= 512 && /^\/(?:admin|instructor|student|ta|preview)(?:\/|$)/.test(page)) source.page = requestDiagnostics(page, undefined, undefined).path;
  if (headers.callsite && headers.callsite.length <= 180 && /^(?:[a-z\d_-]+\/)*[a-z\d_-]+\.js:\d{1,6}:\d{1,6}$/i.test(headers.callsite)) source.callsite = headers.callsite;
  if (headers.trigger && triggers.has(headers.trigger)) source.trigger = headers.trigger;
  return source;
}
