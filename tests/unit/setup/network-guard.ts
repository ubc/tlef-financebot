import http from 'node:http';
import https from 'node:https';

const GUARD = Symbol.for('financebot.unit.network-guard');
const MARKER = 'External network is blocked in unit tests';
type GuardedFunction = { [GUARD]?: boolean };

function hostFor(input: unknown, overrides?: unknown): string {
  let hostname = '';
  if (typeof input === 'string' || input instanceof URL) hostname = new URL(input).hostname;
  else if (input && typeof input === 'object') {
    const target = input as { hostname?: unknown; host?: unknown; url?: unknown };
    if (typeof target.url === 'string') hostname = new URL(target.url).hostname;
    else if (typeof target.hostname === 'string') hostname = target.hostname;
    else if (typeof target.host === 'string') hostname = new URL(`http://${target.host}`).hostname;
  }
  if (overrides && typeof overrides === 'object') {
    const options = overrides as { hostname?: unknown; host?: unknown };
    if (typeof options.hostname === 'string') hostname = options.hostname;
    else if (typeof options.host === 'string') hostname = new URL(`http://${options.host}`).hostname;
  }
  // Node HTTP's default host is localhost. Reject an empty fetch URL before
  // passing it here; HTTP request option objects legitimately omit a host.
  return (hostname || 'localhost').toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
}

export function assertUnitLoopbackRequest(input: unknown, overrides?: unknown): void {
  const hostname = hostFor(input, overrides);
  if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1') {
    // Never expose a URL path, query string, authorization header, or key.
    throw new Error(`${MARKER} (${hostname}). Inject or mock the transport.`);
  }
}

/** Install before test modules load, covering fetch and Node HTTP clients. */
export function installUnitNetworkGuard(): void {
  for (const client of [http, https]) {
    for (const method of ['request', 'get'] as const) {
      const original = client[method];
      if ((original as GuardedFunction)[GUARD]) continue;
      const guarded = function (this: unknown, ...args: unknown[]) {
        assertUnitLoopbackRequest(args[0], args[1]);
        return Reflect.apply(original, this, args);
      };
      Object.defineProperty(guarded, GUARD, { value: true });
      Object.defineProperty(client, method, { value: guarded, configurable: true, writable: true });
    }
  }
  const originalFetch = globalThis.fetch;
  if (originalFetch && !(originalFetch as GuardedFunction)[GUARD]) {
    const guardedFetch: typeof fetch = (input, init) => {
      try { assertUnitLoopbackRequest(input); }
      catch (error) { return Promise.reject(error); }
      // Native fetch follows redirects inside its transport without invoking
      // this wrapper again. Disable automatic redirects so a loopback fixture
      // cannot redirect an accidentally live client to an external endpoint.
      const requestedRedirect = init?.redirect ?? (typeof input === 'object' && 'redirect' in input ? input.redirect : undefined);
      return originalFetch(input, { ...init, redirect: requestedRedirect === 'manual' ? 'manual' : 'error' });
    };
    Object.defineProperty(guardedFetch, GUARD, { value: true });
    globalThis.fetch = guardedFetch;
  }
}

installUnitNetworkGuard();
