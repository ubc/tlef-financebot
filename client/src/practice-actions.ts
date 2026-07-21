// client/src/practice-actions.ts
// Hand-off slot between the currently-rendered practice view (practice.ts,
// re-created on every route change) and the persistent student shell
// (built once in main.ts, outside the router's render lifecycle). practice.ts
// calls setPracticeActions() on render and clearPracticeActions() on
// teardown/navigation-away; the shell calls getPracticeActions() on every
// onNavigate to decide whether to show the sidebar context panel.
//
// The router's onNavigate fires BEFORE the new route's view has rendered
// (see router.ts: `onNavigate?.(path); void route.render(...)`), so the
// very first time a practice route is reached, onNavigate reads a stale/
// empty hand-off. practice.ts's first `setPracticeActions()` call happens
// only after that — with nothing pulling it back into the shell, the
// sidebar panel (and its Skip/End-Session buttons) would silently never
// appear on that visit. `onPracticeActionsChange` lets the shell register
// a listener once, so every `setPracticeActions()`/`clearPracticeActions()`
// call re-syncs the panel immediately, not just on the next navigation.
export interface PracticeActions {
  topicName: string;
  loName: string;
  statusLabel: string;
  answered: number;
  correct: number;
  onSkip: () => void;
  endSessionHref: string;
}

let current: PracticeActions | null = null;
let listener: (() => void) | null = null;

export function setPracticeActions(actions: PracticeActions): void {
  current = actions;
  listener?.();
}

export function getPracticeActions(): PracticeActions | null {
  return current;
}

export function clearPracticeActions(): void {
  current = null;
  listener?.();
}

/** Registers the shell's re-sync callback. There is exactly one persistent
 * shell per app lifetime, so a single slot (not a Set) is enough. */
export function onPracticeActionsChange(fn: (() => void) | null): void {
  listener = fn;
}
