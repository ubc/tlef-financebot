import { el } from './dom.js';

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
}

/**
 * Accessible, application-styled replacement for `window.confirm`.
 * Native `<dialog>` supplies focus trapping, Escape handling, and modal
 * semantics while the returned promise keeps call sites as simple as the
 * browser API it replaces.
 */
export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = el('dialog', {
      class: `app-dialog${options.tone === 'danger' ? ' app-dialog--danger' : ''}`,
      'aria-labelledby': 'app-dialog-title',
      'aria-describedby': 'app-dialog-message',
    }) as HTMLDialogElement;

    const cancelButton = el(
      'button',
      { class: 'btn btn--ghost', type: 'button' },
      options.cancelLabel ?? 'Cancel',
    ) as HTMLButtonElement;
    const confirmButton = el(
      'button',
      {
        class: options.tone === 'danger' ? 'btn btn--danger' : 'btn btn--instr-primary',
        type: 'button',
      },
      options.confirmLabel ?? 'Confirm',
    ) as HTMLButtonElement;

    dialog.append(
      el(
        'div',
        { class: 'app-dialog__surface' },
        el('h2', { class: 'app-dialog__title', id: 'app-dialog-title', text: options.title }),
        el('p', { class: 'app-dialog__message', id: 'app-dialog-message', text: options.message }),
        el('div', { class: 'app-dialog__actions' }, cancelButton, confirmButton),
      ),
    );

    let settled = false;
    const finish = (confirmed: boolean): void => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(confirmed);
    };

    cancelButton.addEventListener('click', () => finish(false));
    confirmButton.addEventListener('click', () => finish(true));
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(false);
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) finish(false);
    });

    document.body.append(dialog);
    dialog.showModal();
    cancelButton.focus();
  });
}

export interface TextPromptDialogOptions extends ConfirmDialogOptions {
  fieldLabel: string;
  placeholder?: string;
  maxLength?: number;
}

/** Application-styled optional-text confirmation. `null` means cancelled;
 * an empty string is a valid confirmed response. */
export function textPromptDialog(options: TextPromptDialogOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = el('dialog', {
      class: `app-dialog${options.tone === 'danger' ? ' app-dialog--danger' : ''}`,
      'aria-labelledby': 'app-dialog-title',
      'aria-describedby': 'app-dialog-message',
    }) as HTMLDialogElement;
    const input = el('textarea', {
      class: 'input input--area app-dialog__textarea',
      rows: '4',
      maxlength: options.maxLength ?? 2000,
      placeholder: options.placeholder,
      'aria-label': options.fieldLabel,
    }) as HTMLTextAreaElement;
    const cancelButton = el(
      'button',
      { class: 'btn btn--ghost', type: 'button' },
      options.cancelLabel ?? 'Cancel',
    ) as HTMLButtonElement;
    const confirmButton = el(
      'button',
      {
        class: options.tone === 'danger' ? 'btn btn--danger' : 'btn btn--instr-primary',
        type: 'button',
      },
      options.confirmLabel ?? 'Confirm',
    ) as HTMLButtonElement;

    dialog.append(
      el(
        'div',
        { class: 'app-dialog__surface' },
        el('h2', { class: 'app-dialog__title', id: 'app-dialog-title', text: options.title }),
        el('p', { class: 'app-dialog__message', id: 'app-dialog-message', text: options.message }),
        el(
          'label',
          { class: 'form-field app-dialog__field' },
          el('span', { class: 'form-field__label', text: options.fieldLabel }),
          input,
        ),
        el('div', { class: 'app-dialog__actions' }, cancelButton, confirmButton),
      ),
    );

    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    cancelButton.addEventListener('click', () => finish(null));
    confirmButton.addEventListener('click', () => finish(input.value.trim()));
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(null);
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) finish(null);
    });

    document.body.append(dialog);
    dialog.showModal();
    input.focus();
  });
}
