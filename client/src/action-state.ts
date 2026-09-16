const BUSY_CLASS = 'is-action-busy';

/** Render request-backed progress inside a button without disturbing its label or child icons. */
export function setButtonBusy(button: HTMLButtonElement, busy: boolean): void {
  if (busy) {
    if (button.getAttribute('aria-busy') === 'true') return;
    button.setAttribute('aria-busy', 'true');
    button.classList.add(BUSY_CLASS);
    return;
  }

  if (button.getAttribute('aria-busy') !== 'true') return;
  button.removeAttribute('aria-busy');
  button.classList.remove(BUSY_CLASS);
}

export function isButtonBusy(button: HTMLButtonElement): boolean {
  return button.getAttribute('aria-busy') === 'true';
}

export async function runButtonAction<T>(button: HTMLButtonElement, action: () => Promise<T>): Promise<T | undefined> {
  if (isButtonBusy(button)) return undefined;
  setButtonBusy(button, true);
  try {
    return await action();
  } finally {
    setButtonBusy(button, false);
  }
}
