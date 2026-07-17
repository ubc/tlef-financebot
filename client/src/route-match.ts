// Pure route-pattern matcher, kept in its own DOM-free module so it's
// unit-testable under Jest's node test environment (no jsdom configured —
// see jest.config.js / tests/tsconfig.json, which has no "dom" lib). router.ts
// imports this for the real hash router; tests/unit/client-router.test.ts
// imports it directly.

export type RouteParams = Record<string, string>;

/**
 * Matches a route `pattern` (may contain `:param` segments, e.g.
 * `/course/:id/theme/:themeId`) against a concrete `path`, returning the
 * extracted params on match or `null` on a mismatch (differing segment
 * count, or a literal segment that doesn't match). A pattern with no `:`
 * segments only matches its exact path.
 */
export function matchRoute(pattern: string, path: string): RouteParams | null {
  const patternSegments = pattern.split('/').filter(Boolean);
  const pathSegments = path.split('/').filter(Boolean);
  if (patternSegments.length !== pathSegments.length) return null;

  const params: RouteParams = {};
  for (let i = 0; i < patternSegments.length; i += 1) {
    const patternSegment = patternSegments[i];
    const pathSegment = pathSegments[i];
    if (patternSegment.startsWith(':')) {
      params[patternSegment.slice(1)] = decodeURIComponent(pathSegment);
    } else if (patternSegment !== pathSegment) {
      return null;
    }
  }
  return params;
}
