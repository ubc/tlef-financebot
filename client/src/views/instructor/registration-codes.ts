import { createRegistrationCodes, deleteRegistrationCode, listRegistrationCodes, revokeRegistrationCode, type RegistrationCodePage, type RegistrationCodeRow } from '../../api.js';
import { el } from '../../dom.js';
import { confirmDialog } from '../../modal.js';

const STATUS: Record<RegistrationCodeRow['status'], string> = {
  available: 'Unused', claimed: 'Pending', used: 'Used', revoked: 'Revoked', expired: 'Expired',
};
function date(value: string | null): string {
  return value ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
}
function timestamp(value: string | null): HTMLElement {
  return value ? el('time', { datetime: value, title: new Date(value).toLocaleString(), text: date(value) }) : el('span', { class: 'muted', text: '—' });
}

/** Dense, server-paginated supplemental enrollment management. */
export function registrationCodesPanel(courseId: string, canManage = true): HTMLElement {
  const root = el('section', { class: 'registration-codes-panel', 'aria-labelledby': 'registration-codes-title' });
  const list = el('div', { class: 'registration-codes-list' });
  const notice = el('p', { class: 'registration-codes-notice', role: 'status' });
  const error = el('p', { class: 'registration-codes-error', role: 'alert' });
  const totalLabel = el('span', { class: 'registration-codes-total' });
  const count = el('input', { id: 'registration-code-count', class: 'input', type: 'number', min: 1, max: 50, value: '1' });
  const generate = el('button', { 'data-code-mutation': true, class: 'btn btn--instr-primary', type: 'submit', text: 'Generate codes' });
  const refresh = el('button', { class: 'btn btn--secondary', type: 'button', text: 'Refresh codes', onclick: () => refreshList() });
  const status = el('select', { id: 'registration-code-status', class: 'input' },
    el('option', { value: '', text: 'All statuses' }),
    ...Object.entries(STATUS).map(([value, text]) => el('option', { value, text })));
  const size = el('select', { id: 'registration-code-page-size', class: 'input' },
    ...[10, 25, 50].map(value => el('option', { value, text: `${value} / page`, selected: value === 25 })));
  let busy = false;
  let page = 1;
  let request: { id: string; count: number } | undefined;
  let result: RegistrationCodePage = { codes: [], total: 0, page: 1, pageSize: 25, pageCount: 1 };
  const pageLabel = el('span', { 'aria-live': 'polite' });
  const previous = el('button', { class: 'btn btn--secondary', type: 'button', text: 'Previous', 'aria-label': 'Previous code page', onclick: () => changePage(page - 1) });
  const next = el('button', { class: 'btn btn--secondary', type: 'button', text: 'Next', 'aria-label': 'Next code page', onclick: () => changePage(page + 1) });
  function setBusy(value: boolean): void {
    busy = value;
    root.setAttribute('aria-busy', String(value));
    root.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('button, input, select').forEach(control => { control.disabled = value || (!canManage && control.hasAttribute("data-code-mutation")); });
    previous.disabled = value || page <= 1;
    next.disabled = value || page >= result.pageCount;
  }
  async function copyCode(code: string): Promise<void> {
    error.textContent = '';
    try { await navigator.clipboard.writeText(code); notice.textContent = `Code ${code} copied.`; }
    catch { error.textContent = 'Could not copy automatically. Select the code and copy it manually.'; }
  }
  function rowView(row: RegistrationCodeRow): HTMLTableRowElement {
    const recipient = row.recipient;
    return el('tr', { class: 'registration-code-row', 'aria-label': `Registration code ${row.code}` },
      el('td', { 'data-label': 'Code' }, el('button', { class: 'registration-code-copy', type: 'button', title: 'Click to copy code', 'aria-label': `Copy registration code ${row.code}`, onclick: () => copyCode(row.code) }, el('code', { text: row.code })), el('small', { text: `Created ${date(row.createdAt)}` })),
      el('td', { 'data-label': 'Status' }, el('span', { class: `registration-code-status registration-code-status--${row.status}`, text: STATUS[row.status] })),
      el('td', { 'data-label': 'Student', class: 'registration-code-recipient' }, recipient
        ? el('div', {}, el('strong', { text: recipient.displayName }),
          el('small', { text: recipient.cwl ? `CWL: ${recipient.cwl}` : `Login ID: ${recipient.puid}`, title: `Login ID: ${recipient.puid}` }),
          recipient.email ? el('small', { text: recipient.email }) : false)
        : el('span', { class: 'muted', text: 'Unclaimed' })),
      el('td', { 'data-label': 'Claimed' }, timestamp(row.claimedAt)),
      el('td', { 'data-label': 'Last CWL login' }, timestamp(recipient?.lastLoginAt ?? null)),
      el('td', { 'data-label': 'Actions' }, el('div', { class: 'registration-code-actions' },
        row.status === 'available' ? el('button', { class: 'btn btn--secondary', type: 'button', text: 'Copy', 'aria-label': `Copy code ${row.code}`, onclick: () => copyCode(row.code) }) : false,
        canManage && row.status === 'available' ? el('button', { 'data-code-mutation': true, class: 'btn btn--ghost', type: 'button', text: 'Revoke', 'aria-label': `Revoke code ${row.code}`, onclick: () => mutate(row, 'revoke') }) : false,
        canManage && row.status !== 'claimed' ? el('button', { class: 'btn btn--ghost registration-code-delete', type: 'button', text: 'Delete', 'aria-label': `Delete code record ${row.code}`, onclick: () => mutate(row, 'delete') }) : el('span', { class: 'muted', text: 'Enrolling…' }))));
  }
  function render(): void {
    totalLabel.textContent = `${result.total} code${result.total === 1 ? '' : 's'}${status.value ? ` · ${STATUS[status.value as RegistrationCodeRow['status']]}` : ''}`;
    const table = el('table', { class: 'registration-codes-table', 'aria-label': 'One-time registration codes' },
      el('thead', {}, el('tr', {}, ...['Code / created', 'Status', 'Student', 'Claimed', 'Last CWL login', 'Actions'].map(text => el('th', { scope: 'col', text })))),
      el('tbody', {}, ...result.codes.map(rowView)));
    list.replaceChildren(result.codes.length ? table : el('p', { class: 'registration-codes-empty', text: status.value ? 'No codes with this status. Choose another status or generate codes.' : 'No codes yet. Generate one for each student missing from your Gradebook import.' }));
    const first = result.total ? (page - 1) * result.pageSize + 1 : 0;
    const last = result.total ? first + result.codes.length - 1 : 0;
    pageLabel.textContent = `${first}–${last} of ${result.total} · Page ${page} of ${result.pageCount}`;
  }
  async function load(): Promise<void> {
    result = await listRegistrationCodes(courseId, { page, pageSize: Number(size.value), ...(status.value ? { status: status.value as RegistrationCodeRow['status'] } : {}) });
    page = result.page;
    render();
  }
  async function refreshList(): Promise<void> {
    if (busy) return;
    setBusy(true); error.textContent = '';
    try { await load(); }
    catch (failure) { error.textContent = `Could not load codes: ${(failure as Error).message}`; }
    finally { setBusy(false); }
  }
  async function changePage(target: number): Promise<void> {
    if (busy) return;
    const previousPage = page;
    page = target;
    setBusy(true); error.textContent = '';
    try { await load(); }
    catch (failure) { page = previousPage; error.textContent = `Could not load this page: ${(failure as Error).message}`; }
    finally { setBusy(false); }
  }
  async function mutate(row: RegistrationCodeRow, action: 'delete' | 'revoke'): Promise<void> {
    if (busy) return;
    const deleting = action === 'delete';
    if (!await confirmDialog({
      title: deleting ? 'Delete this code record?' : 'Revoke this unused code?',
      message: deleting ? `${row.code} will be removed from this list${row.status === 'available' ? ' and will stop accepting enrollment' : ''}. Existing student access is unchanged.` : `${row.code} will stop accepting enrollment. Existing students keep their access.`,
      confirmLabel: deleting ? 'Delete record' : 'Revoke code',
    })) return;
    if (busy) return;
    setBusy(true); error.textContent = '';
    try {
      await (deleting ? deleteRegistrationCode : revokeRegistrationCode)(courseId, row.id);
      notice.textContent = deleting ? 'Code record deleted.' : 'Code revoked.';
      try { await load(); } catch { error.textContent = 'The change was saved. Refresh codes to update the list.'; }
    } catch (failure) { error.textContent = (failure as Error).message; }
    finally { setBusy(false); }
  }
  const form = el('form', { class: 'registration-code-controls' },
    el('div', { class: 'form-field' }, el('label', { for: count.id, text: 'Number of codes' }), count), generate, refresh);
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    const amount = Number(count.value);
    if (!Number.isInteger(amount) || amount < 1 || amount > 50) { error.textContent = 'Enter a number from 1 to 50.'; return; }
    if (!request || request.count !== amount) request = { id: crypto.randomUUID(), count: amount };
    setBusy(true); error.textContent = '';
    try {
      const created = await createRegistrationCodes(courseId, amount, request.id);
      request = undefined; page = 1; status.value = '';
      notice.textContent = `${created.ids.length} one-time code${created.ids.length === 1 ? '' : 's'} generated.`;
      try { await load(); } catch { error.textContent = 'Codes were generated. Refresh codes to load them.'; }
    } catch (failure) { error.textContent = (failure as Error).message; }
    finally { setBusy(false); }
  });
  status.addEventListener('change', () => { page = 1; void refreshList(); });
  size.addEventListener('change', () => { page = 1; void refreshList(); });
  const help = el('details', { class: 'registration-codes-help' }, el('summary', { text: 'How codes work' }),
    el('p', { text: 'Use Gradebook import for your class; give one unused code to each additional student. Each code enrolls one CWL account. The course must be published and within its term dates.' }),
    el('p', { text: 'Last CWL login is a sign-in timestamp, not online presence. Deleting a record or revoking a code does not remove student access. Pending enrollment records cannot be deleted.' }));
  root.append(el('div', { class: 'registration-codes-heading' }, el('div', {}, el('h3', { id: 'registration-codes-title', text: 'One-time registration codes' }),
    el('p', { text: 'Supplemental access for students missing from the Gradebook import.' })), help),
    canManage ? form : el('p', { class: 'muted', text: 'Only the Owner/Admin can generate, revoke or delete codes.' }), notice, error,
    el('div', { class: 'registration-codes-toolbar' }, totalLabel, el('div', {},
      el('label', { for: status.id, class: 'sr-only', text: 'Filter code status' }), status,
      el('label', { for: size.id, class: 'sr-only', text: 'Codes per page' }), size)),
    list, el('nav', { class: 'registration-codes-pagination', 'aria-label': 'Registration code pagination' }, pageLabel, el('div', {}, previous, next)));
  list.append(el('div', { class: 'registration-codes-skeleton', 'aria-label': 'Loading codes' }, ...Array.from({ length: 5 }, () => el('div'))));
  void refreshList();
  return root;
}
