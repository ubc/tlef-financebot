// A tiny hash router. Hash routing needs zero server changes (no SPA fallback),
// so static serving stays trivial and /api/* is never shadowed. Each route maps
// a path pattern to a render function that fills the outlet element. Patterns
// may contain `:param` segments (e.g. `/course/:id`) extracted by `matchRoute`
// (route-match.ts, kept DOM-free so it's unit-testable) and passed to the
// render function. See client/AGENTS.md.
import { matchRoute, type RouteParams } from './route-match.js';

export type { RouteParams };
export { matchRoute };

export type ViewRender = (outlet: HTMLElement, params: RouteParams) => void | Promise<void>;

export interface Route {
  /** A path pattern, e.g. `/notes` or `/course/:id/theme/:themeId`. */
  path: string;
  render: ViewRender;
}

export interface RouterHandle {
  navigate(path: string): void;
  stop(): void;
}

interface RouterOptions {
  routes: Route[];
  outlet: HTMLElement;
  /** Path to use when the hash is empty or unknown. */
  fallback: string;
  /** Called after each navigation with the resolved path (for active nav/title). */
  onNavigate?: (path: string) => void;
}

/** Read the current path from location.hash ('#/notes' -> '/notes'), stripped
 * of any query string ('#/course/1?mode=x' -> '/course/1') — matching is
 * segment-based and knows nothing about query params. Views that need a
 * query value (e.g. review-book's re-practice link) read it themselves via
 * `currentQuery()`. */
function currentPath(): string {
  const hash = window.location.hash.replace(/^#/, '');
  const path = hash.split('?')[0];
  return path || '/';
}

/** The query-string portion of the current hash, if any (see `currentPath`). */
export function currentQuery(): URLSearchParams {
  const hash = window.location.hash.replace(/^#/, '');
  const idx = hash.indexOf('?');
  return new URLSearchParams(idx === -1 ? '' : hash.slice(idx + 1));
}

interface Matched {
  route: Route;
  params: RouteParams;
}

/** Finds the first route whose pattern matches `path`, falling back to the
 * configured fallback route (with empty params) if nothing matches. */
function resolve(routes: Route[], fallback: string, path: string): Matched {
  for (const route of routes) {
    const params = matchRoute(route.path, path);
    if (params) return { route, params };
  }
  const fallbackRoute = routes.find((r) => r.path === fallback) ?? routes[0];
  return { route: fallbackRoute, params: {} };
}

export function startRouter(options: RouterOptions): RouterHandle {
  const { routes, outlet, fallback, onNavigate } = options;

  const handle = (): void => {
    const path = currentPath();
    const { route, params } = resolve(routes, fallback, path);
    // No pattern matched at all (unknown/empty hash): normalize to fallback.
    if (!matchRoute(route.path, path)) {
      window.location.hash = fallback;
      return; // the hash change re-triggers handle()
    }
    outlet.replaceChildren();
    outlet.scrollTop = 0;
    onNavigate?.(path);
    void route.render(outlet, params);
  };

  window.addEventListener('hashchange', handle);
  handle();

  return {
    navigate(path: string) {
      if (currentPath() === path) handle();
      else window.location.hash = path;
    },
    stop() {
      window.removeEventListener('hashchange', handle);
    },
  };
}
