// A tiny hash router. Hash routing needs zero server changes (no SPA fallback),
// so static serving stays trivial and /api/* is never shadowed. Each route maps
// a path to a render function that fills the outlet element. See client/AGENTS.md.

export type ViewRender = (outlet: HTMLElement) => void | Promise<void>;

export interface Route {
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

/** Read the current path from location.hash ('#/notes' -> '/notes'). */
function currentPath(): string {
  const hash = window.location.hash.replace(/^#/, '');
  return hash || '/';
}

export function startRouter(options: RouterOptions): RouterHandle {
  const { routes, outlet, fallback, onNavigate } = options;

  const resolve = (path: string): Route =>
    routes.find((r) => r.path === path) ??
    routes.find((r) => r.path === fallback) ??
    routes[0];

  const handle = (): void => {
    const path = currentPath();
    const route = resolve(path);
    // Normalize the hash if it was empty/unknown so the address bar matches.
    if (route.path !== path) {
      window.location.hash = route.path;
      return; // the hash change re-triggers handle()
    }
    outlet.replaceChildren();
    outlet.scrollTop = 0;
    onNavigate?.(route.path);
    void route.render(outlet);
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
