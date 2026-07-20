// client/src/practice-actions.ts
// Hand-off slot between the currently-rendered practice view (practice.ts,
// re-created on every route change) and the persistent student shell
// (built once in main.ts, outside the router's render lifecycle). practice.ts
// calls setPracticeActions() on render and clearPracticeActions() on
// teardown/navigation-away; the shell calls getPracticeActions() on every
// onNavigate to decide whether to show the sidebar context panel.
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

export function setPracticeActions(actions: PracticeActions): void {
  current = actions;
}

export function getPracticeActions(): PracticeActions | null {
  return current;
}

export function clearPracticeActions(): void {
  current = null;
}
