import type * as Yjs from 'yjs';
import { ApiError, getQuestion } from '../../api.js';
import { el, mount } from '../../dom.js';
import { confirmDialog } from '../../modal.js';
import { protectUnsavedChanges, type RouteParams } from '../../router.js';
import { errorState, loadingState } from '../../ui.js';
import { attachTutorial } from '../../tutorials.js';
import { commitDraft, draftPath, getDraft, leaveDraft, rebaseDraft, sendDraftUpdate, setDraftPresence, type DraftSnapshot } from '../../question-collaboration-api.js';

const bytes = (value: string): Uint8Array => Uint8Array.from(atob(value), character => character.charCodeAt(0));
const base64 = (value: Uint8Array): string => {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
};

/** Native fields bind to Y.Text, with minimal edits and relative selections.
 * The shared draft is durable; publication still goes through normal review. */
export async function renderCollaborativeEditor(outlet: HTMLElement, params: RouteParams): Promise<void> {
  const root = el('div', { class: 'view collaborative-editor' }, loadingState('Opening shared draft…'));
  mount(outlet, root);
  const path = draftPath(params.id, params.questionId);
  const detailPath = `#/instructor/course/${params.id}/bank/${params.questionId}`;
  // Only the third-party library is pre-bundled; application modules use tsc.
  const vendorPath = '/vendor/yjs.js';
  let Y: typeof Yjs;
  let snapshot: DraftSnapshot;
  try {
    [Y, snapshot] = await Promise.all([import(vendorPath) as Promise<typeof Yjs>, getDraft(path)]);
  } catch (error) {
    if (root.isConnected) mount(root, errorState((error as Error).message, () => void renderCollaborativeEditor(outlet, params)));
    return;
  }
  if (!root.isConnected) return;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, bytes(snapshot.state), 'remote');
  const clientId = crypto.randomUUID();
  const queue: Uint8Array[] = [];
  let sending: Promise<void> | undefined;
  let stopped = false;
  let unavailable = false;
  let saving = false;
  let field = '';
  let connected = false;
  let sendTimer: number | undefined;
  let errorMessage = '';
  let pendingCommit: { id: string; revision: number } | undefined;
  let activeUpdate: AbortController | undefined;
  const controls: Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> = [];
  const bindings: Array<{ input: HTMLTextAreaElement; text: Yjs.Text; start?: Yjs.RelativePosition; end?: Yjs.RelativePosition }> = [];
  const status = el('p', { class: 'collaborative-editor__status', role: 'status', 'aria-live': 'polite' });
  const people = el('div', { class: 'collaborative-editor__people', 'aria-label': 'People editing this question' });
  const notice = el('p', { class: 'collaborative-editor__notice', role: 'alert', hidden: true });
  const savedNotice = el('p', { class: 'collaborative-editor__status', role: 'status', hidden: true });
  const compare = el('button', { class: 'btn btn--ghost', hidden: true, onclick: async () => {
    try {
      await flush();
      if (queue.length) throw new Error('Sync your changes before comparing versions.');
      receive(await getDraft(path));
      const comparedRevision = snapshot.revision;
      const latest = await getQuestion(params.questionId);
      const dialog = el('dialog', { class: 'app-dialog collaborative-editor__compare', 'aria-labelledby': 'compare-draft-title' });
      const fields = (stem: string, options: Array<{ key: string; text: string; explanation: string; role: string }>): HTMLElement =>
        el('div', {}, el('p', { text: stem }), ...options.map(option => el('section', {}, el('h4', { text: `Option ${option.key} · ${option.role}` }), el('p', { text: option.text }), el('p', { text: option.explanation }))));
      const sharedOptions = snapshot.optionKeys.map(key => ({ key, text: doc.getText(`option:${key}:text`).toString(), explanation: doc.getText(`option:${key}:explanation`).toString(), role: settings.get(`role:${key}`) ?? '' }));
      const accepted = await new Promise<boolean>(resolve => {
        const finish = (value: boolean): void => { dialog.close(); dialog.remove(); resolve(value); };
        dialog.append(el('div', { class: 'app-dialog__surface' },
          el('h2', { id: 'compare-draft-title', text: 'Compare with the latest saved version' }),
          el('p', { text: 'Continuing keeps the shared question text, answers, explanations and difficulty. The latest saved version remains in history. Review these differences before saving a new version.' }),
          el('div', { class: 'collaborative-editor__comparison' },
            el('section', {}, el('h3', { text: `Saved version ${latest.current.version} · ${latest.current.difficulty}` }), fields(latest.current.stem, latest.current.options)),
            el('section', {}, el('h3', { text: `Shared draft · ${settings.get('difficulty') ?? ''}` }), fields(doc.getText('stem').toString(), sharedOptions))),
          el('div', { class: 'app-dialog__actions' }, el('button', { class: 'btn btn--ghost', onclick: () => finish(false) }, 'Cancel'),
            el('button', { class: 'btn btn--instr-primary', onclick: () => finish(true) }, 'Continue with shared draft'))));
        dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
        document.body.append(dialog); dialog.showModal();
      });
      if (!accepted || !root.isConnected) return;
      receive(await rebaseDraft(path, comparedRevision, latest.currentVersionId));
      errorMessage = ''; renderStatus();
    } catch (error) { errorMessage = (error as Error).message; renderStatus(); }
  } }, 'Compare saved version');
  const save = el('button', { class: 'btn btn--instr-primary', onclick: async () => {
    if (saving || unavailable) return;
    saving = true; renderStatus();
    try {
      if (!pendingCommit) {
        await flush();
        if (queue.length) throw new Error('Wait for your changes to sync before saving a version.');
        const latest = await getDraft(path);
        const changed = latest.revision !== snapshot.revision;
        receive(latest);
        if (changed) throw new Error('New edits arrived. Review the shared draft, then save the version again.');
        if (snapshot.conflict) throw new Error('The saved question changed outside this draft. Download your draft and compare it with the latest saved version.');
        pendingCommit = { id: crypto.randomUUID(), revision: snapshot.revision };
      }
      await commitDraft(path, pendingCommit.revision, pendingCommit.id);
      receive(await getDraft(path));
      pendingCommit = undefined;
      errorMessage = '';
      savedNotice.hidden = false;
      savedNotice.textContent = 'Version saved to Review Queue. Open question details to review and approve it.';
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) pendingCommit = undefined;
      errorMessage = (error as Error).message;
    }
    finally { saving = false; renderStatus(); }
  } }, 'Save version');

  function renderStatus(): void {
    status.textContent = unavailable ? 'Editing access unavailable · download your draft to keep a copy'
      : saving ? 'Saving version…' : queue.length ? (connected ? 'Syncing changes…' : 'Reconnecting · changes waiting to sync')
        : connected ? 'All changes saved to shared draft' : 'Reconnecting · shared draft retained';
    const message = errorMessage || (snapshot.conflict ? 'A newer version was saved outside this draft. Your work is retained. Open the latest version to compare before continuing.' : '');
    notice.hidden = !message; notice.textContent = message;
    save.textContent = pendingCommit ? 'Retry save' : 'Save version';
    save.disabled = unavailable || saving || (!pendingCommit && (snapshot.conflict || snapshot.committing)) || !connected;
    compare.hidden = !snapshot.conflict;
    compare.disabled = unavailable || saving;
    for (const control of controls) control.disabled = unavailable || saving || Boolean(pendingCommit);
    people.replaceChildren(...snapshot.collaborators.map(person => el('span', { class: 'collaborative-editor__person' },
      `${person.name}${person.clientId === clientId ? ' (you)' : ''}${person.field ? ` · ${person.field}` : ''}`)));
  }

  function receive(next: DraftSnapshot): void {
    if (stopped || next.revision < snapshot.revision) return;
    snapshot = next;
    Y.applyUpdate(doc, bytes(next.state), 'remote');
    renderStatus();
  }

  function schedule(): void {
    clearTimeout(sendTimer);
    if (!stopped && !unavailable && queue.length) sendTimer = window.setTimeout(() => { void flush(); }, 250);
  }

  async function flush(): Promise<void> {
    if (sending) return sending;
    if (stopped || unavailable || !queue.length) return;
    sending = (async () => {
      try {
        // Send incremental updates individually. Lost responses are retried
        // with the same CRDT update, so a retry cannot duplicate characters.
        while (queue.length && !stopped && !unavailable) {
          const controller = new AbortController();
          activeUpdate = controller;
          let next: DraftSnapshot;
          try { next = await sendDraftUpdate(path, base64(queue[0]), controller.signal); }
          finally { if (activeUpdate === controller) activeUpdate = undefined; }
          queue.shift(); connected = true; errorMessage = ''; receive(next);
        }
      } catch (error) {
        if (error instanceof ApiError && [401, 403, 404].includes(error.status)) unavailable = true;
        if (!(error instanceof ApiError)) connected = false;
        errorMessage = `${(error as Error).message} Your unsynced text remains in this tab.`;
      } finally {
        sending = undefined; renderStatus();
        if (queue.length && !stopped && !unavailable) sendTimer = window.setTimeout(() => { void flush(); }, 2000);
      }
    })();
    return sending;
  }

  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === 'remote') return;
    savedNotice.hidden = true;
    queue.push(update); renderStatus(); schedule();
  });
  doc.on('beforeTransaction', () => {
    for (const binding of bindings) {
      if (document.activeElement !== binding.input) continue;
      binding.start = Y.createRelativePositionFromTypeIndex(binding.text, Math.min(binding.input.selectionStart, binding.text.length));
      binding.end = Y.createRelativePositionFromTypeIndex(binding.text, Math.min(binding.input.selectionEnd, binding.text.length));
    }
  });
  doc.on('afterTransaction', (transaction: Yjs.Transaction) => {
    for (const binding of bindings) {
      if (binding.input.value === binding.text.toString()) continue;
      binding.input.value = binding.text.toString();
      if (transaction.origin === 'remote' && binding.start && binding.end && document.activeElement === binding.input) {
        const start = Y.createAbsolutePositionFromRelativePosition(binding.start, doc);
        const end = Y.createAbsolutePositionFromRelativePosition(binding.end, doc);
        if (start && end) binding.input.setSelectionRange(start.index, end.index);
      }
    }
  });

  function textField(key: string, label: string, rows: number): HTMLElement {
    const text = doc.getText(key);
    const id = `shared-${key.replace(/:/g, '-')}`;
    const input = el('textarea', { id, rows, maxlength: 10000, class: 'input', 'data-shared-field': key });
    input.value = text.toString(); controls.push(input); bindings.push({ input, text });
    const applyInput = (): void => {
      const previous = text.toString(), next = input.value;
      let start = 0, end = 0;
      while (start < previous.length && start < next.length && previous[start] === next[start]) start++;
      while (end < previous.length - start && end < next.length - start && previous[previous.length - 1 - end] === next[next.length - 1 - end]) end++;
      doc.transact(() => {
        if (previous.length - start - end) text.delete(start, previous.length - start - end);
        if (next.length - start - end) text.insert(start, next.slice(start, next.length - end));
      }, 'local');
    };
    // Apply every native input event, including IME composition updates. Each
    // incremental Yjs update is valid, while waiting for compositionend can
    // lose text when focus or connectivity changes before that event arrives.
    input.addEventListener('input', applyInput);
    input.addEventListener('focus', () => { field = label; void heartbeat(); });
    return el('div', { class: 'collaborative-editor__field' }, el('label', { for: id, text: label }), input);
  }

  const settings = doc.getMap<string>('settings');
  function selectField(key: string, label: string, choices: Array<[string, string]>): HTMLElement {
    const id = `shared-${key.replace(/:/g, '-')}`;
    const input = el('select', { id, class: 'input' }, ...choices.map(([value, text]) => el('option', { value, text })));
    input.value = settings.get(key) ?? ''; controls.push(input);
    settings.observe(() => { input.value = settings.get(key) ?? ''; });
    input.addEventListener('change', () => settings.set(key, input.value));
    input.addEventListener('focus', () => { field = label; void heartbeat(); });
    return el('div', { class: 'collaborative-editor__field' }, el('label', { for: id, text: label }), input);
  }

  const download = el('button', { class: 'btn btn--ghost', onclick: () => {
    const payload = { questionId: params.questionId, baseVersionId: snapshot.baseVersionId, type: snapshot.questionType,
      stem: doc.getText('stem').toString(), difficulty: settings.get('difficulty'),
      options: snapshot.optionKeys.map(key => ({ key, text: doc.getText(`option:${key}:text`).toString(), explanation: doc.getText(`option:${key}:explanation`).toString(), role: settings.get(`role:${key}`) })),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = el('a', { href: url, download: `question-${params.questionId}-draft.json` }); link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } }, 'Download draft');

  mount(root,
    el('a', { class: 'breadcrumb-back', href: detailPath, text: '← Question details & version history' }),
    el('header', { class: 'collaborative-editor__header' }, el('div', {},
      el('h1', { text: 'Edit together' }), el('p', { class: 'text-muted', text: 'Edit the question with your co-instructors. Shared drafts stay separate from the saved question until you save a version.' })),
      el('div', { class: 'collaborative-editor__actions' }, download, save)),
    el('section', { class: 'collaborative-editor__presence', 'aria-label': 'Shared draft status' }, status, savedNotice, people), notice, compare,
    el('section', { class: 'collaborative-editor__paper', 'aria-label': 'Question editor' },
      selectField('difficulty', 'Difficulty', [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']]), textField('stem', 'Question stem', 6),
      ...snapshot.optionKeys.map(key => el('fieldset', { class: 'collaborative-editor__option' },
        el('legend', { text: `Option ${key}` }),
        textField(`option:${key}:text`, `Option ${key} text`, 2),
        textField(`option:${key}:explanation`, `Option ${key} explanation`, 3),
        selectField(`role:${key}`, `Option ${key} role`, [['correct', 'Correct answer'], ['common-misconception', 'Common misconception'], ['partially-correct', 'Partially correct'], ['clearly-wrong', 'Clearly wrong']])))),
  );
  attachTutorial(root, 'instructor-collaboration', {
    'collaboration-presence': '.collaborative-editor__presence',
    'collaboration-editor': '.collaborative-editor__paper',
    'collaboration-save': '.collaborative-editor__actions',
  });

  protectUnsavedChanges(root, () => queue.length > 0 || saving || Boolean(pendingCommit), () => confirmDialog({ title: 'Leave with unconfirmed changes?',
    message: 'Some changes or a version save are still awaiting confirmation. Stay here to confirm them, or download a copy before leaving.', confirmLabel: 'Leave', cancelLabel: 'Keep editing', tone: 'danger' }));
  let source: EventSource;
  let reconnectTimer: number | undefined;
  function scheduleReconnect(delay = 1000): void {
    clearTimeout(reconnectTimer);
    if (stopped || unavailable || connected || !navigator.onLine) return;
    reconnectTimer = window.setTimeout(reconnect, delay);
  }
  function connectEvents(): EventSource {
    const next = new EventSource(`${path}/events`);
    next.addEventListener('open', () => { clearTimeout(reconnectTimer); connected = true; renderStatus(); schedule(); });
    next.addEventListener('snapshot', (event) => { connected = true; receive(JSON.parse((event as MessageEvent<string>).data) as DraftSnapshot); });
    next.addEventListener('unavailable', (event) => {
      unavailable = true; connected = false; next.close();
      errorMessage = (JSON.parse((event as MessageEvent<string>).data) as { error: string }).error; renderStatus();
    });
    next.addEventListener('error', () => { connected = false; renderStatus(); scheduleReconnect(); });
    return next;
  }
  source = connectEvents();
  // A browser can keep an EventSource object in OPEN state while its underlying
  // connection was severed offline. Recreate it explicitly when connectivity
  // returns so edits made by a teammate during the outage cannot stay hidden.
  function reconnect(): void {
    if (stopped || unavailable) return;
    activeUpdate?.abort(); activeUpdate = undefined;
    source.close(); connected = false; source = connectEvents(); renderStatus(); schedule();
  }
  window.addEventListener('online', reconnect);
  async function heartbeat(): Promise<void> {
    if (stopped || unavailable) return;
    try { await setDraftPresence(path, clientId, field); }
    catch (error) { if (error instanceof ApiError && [401, 403, 404].includes(error.status)) { unavailable = true; source.close(); renderStatus(); } }
  }
  const heartbeatTimer = window.setInterval(() => { void heartbeat(); }, 10000);
  void heartbeat(); renderStatus();
  const leaving = (): void => { void leaveDraft(path, clientId).catch(() => undefined); };
  window.addEventListener('pagehide', leaving);
  const observer = new MutationObserver(() => {
    if (root.isConnected) return;
    stopped = true; observer.disconnect(); activeUpdate?.abort(); source.close(); clearTimeout(sendTimer); clearTimeout(reconnectTimer); clearInterval(heartbeatTimer);
    window.removeEventListener('online', reconnect);
    window.removeEventListener('pagehide', leaving);
    void leaveDraft(path, clientId).catch(() => undefined); doc.destroy();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
