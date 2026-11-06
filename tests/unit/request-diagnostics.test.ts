import { requestDiagnostics } from '../../server/src/services/request-diagnostics';

it('preserves public route words while masking identities, credentials, encoded text and malformed escapes', () => {
  const result = requestDiagnostics('/api/courses/123456789012345678901234/users/secret-name/token=private/%73ecret/%ZZ?token=query-secret#fragment', 'curl/8.0 secret-header', 'same-origin');
  expect(result).toMatchObject({ path: '/api/courses/:redacted/users/:redacted/:redacted/:redacted/:redacted', pathRedacted: true, pathTruncated: false, client: 'curl', fetchSite: 'same-origin' });
  expect(JSON.stringify(result)).not.toMatch(/123456789012345678901234|secret-name|private|secret-header|query-secret|fragment|%ZZ/);
});

it('distinguishes masked paths but excludes query strings from the path digest', () => {
  const a = requestDiagnostics('/api/unknown-one?token=one', undefined, undefined);
  const b = requestDiagnostics('/api/unknown-one?token=two', undefined, undefined);
  const c = requestDiagnostics('/api/unknown-two', undefined, undefined);
  expect(a.path).toBe(c.path);
  expect(a.pathHash).toMatch(/^[a-f\d]{64}$/);
  expect(a.pathHash).toBe(b.pathHash);
  expect(a.pathHash).not.toBe(c.pathHash);
  expect(a).toMatchObject({ client: 'absent', fetchSite: 'unavailable' });
});

it('bounds long paths and flags when only a prefix was hashed or displayed', () => {
  const huge = requestDiagnostics('/api/' + 'x'.repeat(10000), 'custom-private-agent', 'private-site');
  expect(huge).toMatchObject({ path: '/api/:redacted', pathTruncated: true, client: 'other', fetchSite: 'unavailable' });
  const deep = requestDiagnostics('/api' + '/courses'.repeat(1000), undefined, undefined);
  expect(deep.path.split('/').filter(Boolean)).toHaveLength(24);
  expect(deep.pathTruncated).toBe(true);
  expect(JSON.stringify(deep).length).toBeLessThan(500);
});

it.each([
  ['Mozilla/5.0 Chrome/120.0 Safari/537.36 Edg/120.0', 'edge'],
  ['Mozilla/5.0 Firefox/120.0', 'firefox'], ['Mozilla/5.0 FxiOS/120.0 Safari/605.1', 'firefox'],
  ['Mozilla/5.0 Chrome/120.0 Safari/537.36', 'chrome'], ['Mozilla/5.0 Safari/605.1', 'safari'],
  ['Wget/1.0', 'wget'], ['python-requests/2.0', 'python'], ['custom-agent', 'other'],
])('reduces %s to the unverified client category %s', (agent, category) => {
  expect(requestDiagnostics('/api/health', agent, 'cross-site')).toMatchObject({ path: '/api/health', pathRedacted: false, client: category, fetchSite: 'cross-site' });
});
