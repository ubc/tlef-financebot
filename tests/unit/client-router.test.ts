// Pure-function tests for the client router's param-pattern matcher. No DOM
// needed (jest.config.js runs testEnvironment: 'node') — matchRoute is a pure
// string/segment comparison, kept in its own DOM-free module (route-match.ts)
// specifically so it's testable in isolation from startRouter's DOM/hashchange
// wiring (router.ts itself references `window`/`HTMLElement`, which the test
// tsconfig has no "dom" lib for). See client/src/router.ts.
import { matchRoute } from '../../client/src/route-match';

describe('matchRoute', () => {
  it('matches an exact path with no params', () => {
    expect(matchRoute('/notes', '/notes')).toEqual({});
  });

  it('matches the root path', () => {
    expect(matchRoute('/', '/')).toEqual({});
  });

  it('returns null for a non-matching exact path', () => {
    expect(matchRoute('/notes', '/rag')).toBeNull();
  });

  it('extracts a single param', () => {
    expect(matchRoute('/course/:id', '/course/abc123')).toEqual({ id: 'abc123' });
  });

  it('extracts multiple params', () => {
    expect(matchRoute('/course/:id/theme/:themeId', '/course/abc123/theme/def456')).toEqual({
      id: 'abc123',
      themeId: 'def456',
    });
  });

  it('returns null when the segment count differs', () => {
    expect(matchRoute('/course/:id', '/course/abc123/theme/def456')).toBeNull();
    expect(matchRoute('/course/:id/theme/:themeId', '/course/abc123')).toBeNull();
  });

  it('returns null when a literal segment does not match', () => {
    expect(matchRoute('/course/:id/theme/:themeId', '/course/abc123/practice/def456')).toBeNull();
  });

  it('decodes URI-encoded param segments', () => {
    expect(matchRoute('/course/:id', '/course/abc%2F123')).toEqual({ id: 'abc/123' });
  });

  it('matches practice routes with two static segments around a param', () => {
    expect(matchRoute('/course/:id/practice/:loId', '/course/1/practice/2')).toEqual({ id: '1', loId: '2' });
    expect(matchRoute('/course/:id/practice-theme/:themeId', '/course/1/practice-theme/2')).toEqual({
      id: '1',
      themeId: '2',
    });
  });
});
