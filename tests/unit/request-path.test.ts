import { createHash } from 'node:crypto';
import { originalRequestPath, withRetainedPath, publicPathSearchHashes } from '../../server/src/services/request-path.service';
import { withRetainedProbe } from '../../server/src/services/request-probe.service';
import { requestDiagnostics } from '../../server/src/services/request-diagnostics';

it('retains received spelling and encoding while excluding queries, fragments and URL authority', () => {
  expect(originalRequestPath('/api/v9/Some%2FThing//info?token=private#private')).toEqual({ originalPath: '/api/v9/Some%2FThing//info', originalPathTruncated: false });
  expect(originalRequestPath('http://user:private@host.test/api/mcp?token=private')).toEqual({ originalPath: '/api/mcp', originalPathTruncated: false });
  const long = originalRequestPath('/api/' + 'x'.repeat(5000));
  expect(long.originalPath).toHaveLength(4096); expect(long.originalPathTruncated).toBe(true);
});
it.each(['/api/mcp', '/api/version', '/api/v1/version', '/api/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php'])('recognizes only an exact public historical digest for %s', path => {
  const event = { route: '/unmatched', statusCode: 404, request: { ...requestDiagnostics(path, undefined, undefined), routeMatched: false } };
  const before = structuredClone(event);
  const result = withRetainedPath(withRetainedProbe(event));
  expect(result.request?.recognizedPath).toEqual({ path, evidence: 'retained-path-hash' });
  expect(event).toEqual(before);
  if (path === '/api/mcp' || path.includes('version')) expect(result.request?.probe).toBeUndefined();
  expect(withRetainedPath({ ...event, route: '/questions/:id' }).request?.recognizedPath).toBeUndefined();
  expect(withRetainedPath({ ...event, statusCode: 403 }).request?.recognizedPath).toBeUndefined();
  expect(withRetainedPath({ ...event, request: { ...event.request, pathTruncated: true } }).request?.recognizedPath).toBeUndefined();
});
it('preserves unknown history and includes historical public digests in literal path search', () => {
  const event = { route: '/unmatched', statusCode: 404, request: { ...requestDiagnostics('/api/unknown-original', undefined, undefined), routeMatched: false } };
  expect(withRetainedPath(event)).toBe(event);
  expect(publicPathSearchHashes('/api/mcp')).toContain(createHash('sha256').update('/api/mcp').digest('hex'));
  expect(publicPathSearchHashes('unknown-private-query')).toEqual([]);
});
