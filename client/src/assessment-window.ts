/** A document owns one exam window. Refresh deliberately creates a new owner. */
let documentWindowId: string | undefined;
export function assessmentWindowId(): string {
  return documentWindowId ??= crypto.randomUUID();
}

interface ActiveAssessmentWindow {
  attemptId: string;
  href: string;
  owned?: boolean;
  close: () => void;
  onBlocked?: () => void;
  onReturn?: () => void;
  closing?: boolean;
}
let active: ActiveAssessmentWindow | undefined;
let installed = false;
const changedShells = new Set<HTMLElement>();
let shellObserver: MutationObserver | undefined;
const path = (hash: string): string => hash.replace(/^#/, '').split('?')[0];

function syncShell(): void {
  if (!active) return;
  document.querySelectorAll<HTMLElement>('.app-shell').forEach(shell => {
    if (!shell.classList.contains('assessment-in-progress')) { changedShells.add(shell); shell.classList.add('assessment-in-progress'); }
  });
}

export function hasActiveAssessmentWindow(attemptId?: string): boolean {
  return Boolean(active && (!attemptId || active.attemptId === attemptId));
}
export function isAssessmentWindowClosing(attemptId: string): boolean {
  return Boolean(active?.attemptId === attemptId && active.closing);
}
export function ownsAssessmentWindow(attemptId: string): boolean {
  return Boolean(active?.attemptId === attemptId && active.owned);
}

interface AssessmentCloseMarker {
  attemptId: string;
  windowId: string;
  scope: string;
  route: string;
}
const closeMarkerKey = (scope: string, attemptId: string, href: string): string =>
  `financebot:assessment-close:${encodeURIComponent(scope)}:${encodeURIComponent(path(href))}:${attemptId}`;

/** Persist only on departure, never while a living window can be duplicated. */
export function rememberAssessmentWindowClose(scope: string, attemptId: string, href: string, windowId: string): void {
  try { sessionStorage.setItem(closeMarkerKey(scope, attemptId, href), JSON.stringify({ attemptId, windowId, scope, route: path(href) })); }
  catch { /* Without storage, the server's expiring lease remains the fallback. */ }
}
export function readAssessmentWindowClose(scope: string, attemptId: string, href: string): AssessmentCloseMarker | undefined {
  try {
    const marker = JSON.parse(sessionStorage.getItem(closeMarkerKey(scope, attemptId, href)) ?? 'null') as Partial<AssessmentCloseMarker> | null;
    if (marker?.scope === scope && marker.attemptId === attemptId && marker.route === path(href) && typeof marker.windowId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(marker.windowId)) return marker as AssessmentCloseMarker;
  } catch { /* Invalid or inaccessible browser state never grants ownership. */ }
  return undefined;
}
export function clearAssessmentWindowClose(scope: string, attemptId: string, href: string): void {
  try { sessionStorage.removeItem(closeMarkerKey(scope, attemptId, href)); }
  catch { /* The terminal server receipt is authoritative even without storage. */ }
}

/** Called by every router before rendering, including role-shell switches. */
export function guardAssessmentNavigation(event: Event): boolean {
  if (!active || path(window.location.hash) === path(active.href)) return false;
  event.preventDefault(); event.stopImmediatePropagation();
  history.replaceState(null, '', active.href);
  active.onBlocked?.();
  return true;
}

export function activateAssessmentWindow(value: Omit<ActiveAssessmentWindow, 'closing'>): void {
  active = { ...value, ...(active?.closing ? { closing: true } : {}) };
  syncShell();
  if (!shellObserver) {
    shellObserver = new MutationObserver(syncShell);
    shellObserver.observe(document.body, { childList: true, subtree: true });
  }
  if (installed) return;
  installed = true;
  window.addEventListener('hashchange', guardAssessmentNavigation, true);
  const blockShortcut = (event: Event): void => {
    if (!active || !(event.target instanceof Element) || !event.target.closest('.app-shell')) return;
    const element = event.target.closest('a,button,summary,input,select,form');
    if (!element) return;
    // Only sitting controls remain usable, including when a hidden shell
    // control receives a synthetic click.
    if (element.closest('[data-assessment-active]') && !element.matches('a[href]')) return;
    event.preventDefault(); event.stopImmediatePropagation(); active.onBlocked?.();
  };
  document.addEventListener('click', blockShortcut, true);
  document.addEventListener('auxclick', blockShortcut, true);
  document.addEventListener('submit', blockShortcut, true);
  window.addEventListener('pagehide', () => {
    if (!active || active.closing) return;
    active.closing = true;
    active.close();
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted && active) active.onReturn?.();
  });
}

/** Only an authoritative submitted response unlocks an accepted sitting. */
export function finishAssessmentWindow(attemptId: string): void {
  if (active?.attemptId !== attemptId) return;
  active = undefined;
  shellObserver?.disconnect(); shellObserver = undefined;
  changedShells.forEach(shell => shell.classList.remove('assessment-in-progress')); changedShells.clear();
}
