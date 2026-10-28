import { createHash } from 'node:crypto';
import type { OperationEvent, OperationRequestDiagnostics } from '../types/domain';

type Probe = NonNullable<OperationRequestDiagnostics['probe']>;
export const probeKinds: Probe['kind'][] = ['git-metadata', 'environment-file', 'phpunit', 'wordpress', 'phpmyadmin', 'laravel-debug'];

/** Fixed signatures only. An unknown API path is not evidence of a probe. */
export function classifyProbe(originalUrl: string): Probe | undefined {
  const path = originalUrl.split(/[?#]/, 1)[0];
  if (path.length > 4096) return;
  let decoded: string;
  try { decoded = decodeURIComponent(path); } catch { return; }
  const patterns: Array<[Probe['kind'], RegExp]> = [
    ['git-metadata', /^\/api\/\.git(?:\/|$)/i],
    ['environment-file', /^\/api\/\.env(?:\.[a-z\d_-]{1,32})?(?:\/|$)/i],
    ['phpunit', /^\/api\/(?:vendor\/)?phpunit\/(?:phpunit\/)?(?:src\/)?util\/php\/eval-stdin\.php\/?$/i],
    ['wordpress', /^\/api\/(?:wp-login\.php|xmlrpc\.php|wp-admin)(?:\/|$)/i],
    ['phpmyadmin', /^\/api\/phpmyadmin(?:\/|$)/i],
    ['laravel-debug', /^\/api\/_ignition\/execute-solution\/?$/i],
  ];
  const kind = patterns.find(([, pattern]) => pattern.test(decoded))?.[0];
  return kind ? { kind, evidence: 'path-signature' } : undefined;
}

// These public constants recognize retained hashes without recovering arbitrary
// private paths or rewriting historical records. Keep unknown hashes unknown.
const historicalPaths = [
  '/api/.git/config', '/api/.git/HEAD', '/api/.git/index', '/api/.env', '/api/.env.local', '/api/.env.production',
  '/api/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php', '/api/phpunit/phpunit/src/Util/PHP/eval-stdin.php',
  '/api/wp-login.php', '/api/xmlrpc.php', '/api/wp-admin', '/api/phpmyadmin', '/api/_ignition/execute-solution',
];
const historicalProbes = new Map(historicalPaths.map(path => [createHash('sha256').update(path).digest('hex'), classifyProbe(path)!]));

export function retainedProbe(event: Pick<OperationEvent, 'route' | 'statusCode' | 'request'>): Probe | undefined {
  if (event.route !== '/unmatched' || !event.request) return;
  if (event.request.probe && probeKinds.includes(event.request.probe.kind)) return event.request.probe;
  if (event.statusCode !== 404) return;
  const match = historicalProbes.get(event.request.pathHash);
  return match ? { kind: match.kind, evidence: 'retained-path-hash' } : undefined;
}

/** A Mongo predicate shared by inclusion/exclusion; matched resource 404s stay. */
export function probePredicate() {
  return { route: '/unmatched', $or: [
    { 'request.probe.kind': { $in: probeKinds } },
    { statusCode: 404, 'request.pathHash': { $in: [...historicalProbes.keys()] } },
  ] };
}

export function withRetainedProbe<T extends Pick<OperationEvent, 'route' | 'statusCode' | 'request'>>(event: T): T {
  const probe = retainedProbe(event);
  return probe && event.request ? { ...event, request: { ...event.request, probe } } : event;
}
