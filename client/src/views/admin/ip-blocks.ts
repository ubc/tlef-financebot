import { el } from '../../dom.js';
import { listIpBlocks, setIpBlock, type IpBlockRecord } from '../../api.js';
import { confirmDialog } from '../../modal.js';
import { dateLabel } from './diagnostic-ui.js';

/** Explicit Admin actions only; opening a request never creates a rule. */
export function openIpBlocks(selectedIp = ''): void {
  const existing = document.querySelector<HTMLDialogElement>('.ac-ip-dialog');
  if (existing) { existing.focus(); return; }
  const dialog = el('dialog', { class: 'app-dialog ac-ip-dialog', 'aria-labelledby': 'ip-access-title' }) as HTMLDialogElement;
  const ip = el('input', { class: 'input', type: 'text', maxlength: 80, value: selectedIp, 'aria-label': 'IP address', placeholder: 'IPv4 or IPv6 address' }) as HTMLInputElement;
  const reason = el('textarea', { class: 'input', rows: 2, maxlength: 300, 'aria-label': 'Block reason', placeholder: 'Optional reason' }) as HTMLTextAreaElement;
  const find = el('input', { class: 'input', type: 'text', maxlength: 80, value: selectedIp, 'aria-label': 'Find IP rule', placeholder: 'Exact IP address, or leave empty' }) as HTMLInputElement;
  const notice = el('p', { role: 'status', class: 'ac-note' });
  const error = el('p', { role: 'alert', class: 'ac-ip-error' });
  const current = el('p', { class: 'ac-note' });
  const list = el('div', { class: 'ac-table-scroll', tabindex: 0, 'aria-label': 'IP access rules' });
  const range = el('span', { class: 'ac-note' });
  const close = el('button', { type: 'button', class: 'btn btn--secondary', text: 'Close IP rules' }) as HTMLButtonElement;
  const add = el('button', { type: 'submit', class: 'btn btn--danger', text: 'Block IP' }) as HTMLButtonElement;
  const search = el('button', { type: 'button', class: 'btn btn--secondary', text: 'Find rule' }) as HTMLButtonElement;
  const clear = el('button', { type: 'button', class: 'btn btn--ghost', text: 'Show all rules' }) as HTMLButtonElement;
  const previous = el('button', { type: 'button', class: 'btn btn--secondary', text: 'Previous rules' }) as HTMLButtonElement;
  const next = el('button', { type: 'button', class: 'btn btn--secondary', text: 'Next rules' }) as HTMLButtonElement;
  let page = 1, total = 0, loading = false, writing = false, ready = false, ownIp: string | null = null;
  const form = el('form', {}, el('label', {}, el('span', { text: 'IP address' }), ip), el('label', {}, el('span', { text: 'Reason' }), reason), add);
  function sync(): void {
    const busy = loading || writing;
    close.disabled = writing; search.disabled = clear.disabled = busy;
    add.disabled = busy || !ready || !ip.value.trim() || ip.value.trim() === ownIp;
    previous.disabled = busy || page === 1; next.disabled = busy || page * 25 >= total;
    list.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = busy || !ready; });
    ip.disabled = reason.disabled = writing;
  }
  async function change(address: string, blocked: boolean, text: string, expectedRevision?: number): Promise<void> {
    if (loading || writing) return;
    if (blocked && !await confirmDialog({ title: 'Block API requests from this IP?', message: `${address}\nA shared address may represent several users. This app will reject API requests from it until unblocked. Other workers refresh within five seconds.`, confirmLabel: 'Block this IP', tone: 'danger' })) return;
    writing = true; error.textContent = ''; notice.textContent = blocked ? 'Saving IP block…' : 'Removing IP block…'; sync();
    try {
      const result = await setIpBlock({ ip: address, blocked, reason: text, ...(expectedRevision !== undefined ? { expectedRevision } : {}) });
      notice.textContent = `${result.ip}: ${result.blocked ? 'blocked' : 'unblocked'}.`;
      page = 1;
    } catch (caught) { notice.textContent = ''; error.textContent = (caught as Error).message; }
    finally { writing = false; if (dialog.isConnected) await load(); }
  }
  function row(entry: IpBlockRecord): HTMLElement {
    const history = el('details', {}, el('summary', { text: `History (${entry.history.length}, latest 50)` }), el('ol', {}, ...entry.history.slice().reverse().map(item => el('li', { text: `${dateLabel(item.at)} · ${item.blocked ? 'Blocked' : 'Unblocked'} · ${item.actorName || item.actorPuid}${item.reason ? ` · ${item.reason}` : ''}` }))));
    return el('tr', {}, el('td', { class: 'mono', text: entry.ip }), el('td', { text: entry.blocked ? 'Blocked' : 'Unblocked' }), el('td', {}, el('p', { text: entry.reason || 'No reason recorded.' }), el('small', { text: `${dateLabel(entry.updatedAt)} · ${entry.updatedByName || entry.updatedByPuid}` }), history),
      el('td', {}, el('button', { class: entry.blocked ? 'btn btn--secondary' : 'btn btn--danger', type: 'button', text: entry.blocked ? 'Unblock' : 'Block', 'aria-label': `${entry.blocked ? 'Unblock' : 'Block'} ${entry.ip}`, onclick: () => change(entry.ip, !entry.blocked, reason.value.trim() || entry.reason, entry.revision) })));
  }
  async function load(): Promise<void> {
    if (!dialog.isConnected || loading) return;
    loading = true; sync();
    try {
      const data = await listIpBlocks(page, find.value.trim() || undefined);
      if (!dialog.isConnected) return;
      ownIp = data.currentIp; ready = Boolean(ownIp && data.addressSource !== 'untrusted-forwarding' && data.addressSource !== 'unavailable'); total = data.total;
      current.textContent = `Your current source IP: ${ownIp || 'unavailable'}. Your own address, loopback and trusted proxies cannot be blocked.${ready ? '' : ' Proxy source identification must be fixed before changing rules.'}`;
      range.textContent = `Page ${page} · ${total} rule${total === 1 ? '' : 's'}`;
      list.replaceChildren(data.items.length ? el('table', { class: 'ac-table' }, el('thead', {}, el('tr', {}, ...['IP address', 'Status', 'Reason and history', 'Action'].map(label => el('th', { scope: 'col', text: label })))), el('tbody', {}, ...data.items.map(row))) : el('p', { class: 'ac-note', text: 'No IP rules match.' }));
    } catch (caught) { error.textContent = (caught as Error).message; }
    finally { loading = false; sync(); }
  }
  form.addEventListener('submit', event => { event.preventDefault(); if (!add.disabled) void change(ip.value.trim(), true, reason.value.trim()); });
  ip.addEventListener('input', sync);
  search.addEventListener('click', () => { page = 1; error.textContent = ''; void load(); });
  clear.addEventListener('click', () => { find.value = ''; page = 1; error.textContent = ''; void load(); });
  previous.addEventListener('click', () => { page--; void load(); }); next.addEventListener('click', () => { page++; void load(); });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => { if (writing) event.preventDefault(); });
  dialog.addEventListener('close', () => dialog.remove());
  dialog.append(el('div', { class: 'app-dialog__surface' }, el('h2', { id: 'ip-access-title', text: 'IP access rules' }),
    el('p', { class: 'ac-note', text: 'These manual rules apply to this application’s API. They do not configure a network firewall or identify a person. Rules remain until unblocked.' }), current, form, notice, error,
    el('div', { class: 'ac-actions' }, find, search, clear), list, el('div', { class: 'ac-actions' }, range, previous, next, close)));
  document.body.append(dialog); dialog.showModal(); void load();
}
