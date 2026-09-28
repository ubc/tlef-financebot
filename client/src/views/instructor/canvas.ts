import {
  getCanvasConnection, connectCanvas, disconnectCanvas, getCanvasCourses, getCanvasLink, saveCanvasLink,
  syncCanvasLink, unlinkCanvas, getCanvasFiles, importCanvasFile, listInstructorCourses, createCourse, listMaterials,
  type CanvasLink, type CanvasSource,
} from '../../api.js';
import { getSession } from '../../auth.js';
import { el, mount } from '../../dom.js';
import { loadingState } from '../../ui.js';
import { confirmDialog } from '../../modal.js';
import type { RouteParams } from '../../router.js';

type Tab = 'courses' | 'students' | 'materials';
const field = (label: string, node: HTMLElement): HTMLElement => el('label', { class: 'canvas-field' }, el('span', { text: label }), node);
const button = (text: string, onclick: () => unknown, style = ''): HTMLButtonElement => el('button', { type: 'button', class: `canvas-button ${style}`, text, onclick });
const empty = (title: string, message: string, action?: HTMLElement): HTMLElement => el('section', { class: 'canvas-panel canvas-empty' }, el('h2', { text: title }), el('p', { text: message }), action);
const tableHead = (labels: string[]): HTMLElement => el('thead', {}, el('tr', {}, ...labels.map(text => el('th', { scope: 'col', text }))));

/** Compact course-scoped UI over the existing Canvas APIs. No simulated authorization or sync state. */
export async function renderCanvas(outlet: HTMLElement, params: RouteParams): Promise<void> {
  const root = el('div', { class: 'view canvas-workspace' });
  const notice = el('div', { class: 'canvas-notice', role: 'status', 'aria-live': 'polite' });
  const content = el('div', {}, loadingState('Loading Canvas connection…'));
  const accountSlot = el('div', { class: 'canvas-account-slot' });
  root.append(el('p', { class: 'canvas-breadcrumb', text: 'Course settings / Integrations' }),
    el('header', { class: 'canvas-pagehead' }, el('div', {}, el('h1', { text: 'Canvas connection' }),
      el('p', { text: 'Manage linked sections, students and materials.' })), accountSlot), notice, content);
  mount(outlet, root);
  const report = (message: string, error = false): void => {
    notice.className = `canvas-notice${error ? ' canvas-notice--error' : ''}`;
    notice.textContent = message;
  };
  const action = (fn: () => Promise<void>) => async (): Promise<void> => {
    try { await fn(); } catch (error) { report(error instanceof Error ? error.message : 'Unable to complete this action.', true); }
  };
  try {
    const [connection, courses] = await Promise.all([getCanvasConnection(), listInstructorCourses()]);
    if (!root.isConnected) return;
    const courseId = params.id || '';
    const course = courses.find(c => c._id === courseId);
    let link: CanvasLink | null = courseId ? await getCanvasLink(courseId) : null;
    if (!root.isConnected) return;
    let tab: Tab = 'courses';
    let mutating = false;
    let importing = false;
    const panel = el('div', { id: 'canvas-tab-panel', role: 'tabpanel', tabindex: '0' });
    const tabs = el('div', { class: 'canvas-tabs', role: 'tablist', 'aria-label': 'Canvas information' });
    const warning = el('div', { class: 'canvas-warning', role: 'status' });
    const syncTime = el('span', { class: 'canvas-sync-time' });
    const syncButton = button('↻ Sync', action(async () => {
      if (!courseId || mutating) return;
      mutating = true; updateControls();
      try {
        await syncCanvasLink(courseId);
        link = await getCanvasLink(courseId); renderTab(); report('Roster synchronized.');
      } catch (error) {
        // Read the server's retained-snapshot error instead of leaving the UI looking healthy.
        link = await getCanvasLink(courseId); renderTab(); throw error;
      } finally { mutating = false; updateControls(); }
    }), 'canvas-button--quiet canvas-sync-button');
    syncButton.setAttribute('aria-label', 'Sync roster now');
    function updateControls(): void {
      syncButton.disabled = !link || !connection.connected || mutating || importing;
      root.querySelectorAll<HTMLButtonElement>('[data-canvas-mutation]').forEach(b => { b.disabled = mutating || importing || !connection.configured; });
    }
    async function changeLink(change: () => Promise<void>): Promise<void> {
      if (mutating || importing) throw new Error('Please wait for the current operation to finish.');
      mutating = true; updateControls();
      try { await change(); link = await getCanvasLink(courseId); renderTab(); }
      finally { mutating = false; updateControls(); }
    }
    const auth = action(async () => {
      const result = await connectCanvas(`/${location.hash.split('?')[0]}`);
      location.assign(result.url);
    });
    const accountButton = button(connection.connected ? 'Connected' : 'Connect Canvas', connection.connected ? () => {
      accountMenu.hidden = !accountMenu.hidden;
      accountButton.setAttribute('aria-expanded', String(!accountMenu.hidden));
    } : auth, connection.connected ? 'canvas-connected' : 'canvas-button--primary');
    accountButton.disabled = !connection.configured;
    const accountMenu = el('div', { class: 'canvas-account-menu', id: 'canvas-account-menu', hidden: true },
      el('strong', { text: `Canvas user ${connection.canvasUserId ?? ''}` }), el('p', { text: connection.domain }),
      button('Reconnect Canvas', auth, 'canvas-button--quiet'),
      button('Disconnect account', action(async () => {
        accountMenu.hidden = true; accountButton.setAttribute('aria-expanded', 'false');
        if (!await confirmDialog({ title: 'Disconnect Canvas?', message: 'Automatic Canvas access pauses for courses using this connection. Imported materials and manual registrations remain available.', confirmLabel: 'Disconnect' })) return;
        await disconnectCanvas(); await renderCanvas(outlet, params);
      }), 'canvas-button--quiet canvas-button--danger'));
    if (connection.connected) {
      accountButton.setAttribute('aria-expanded', 'false'); accountButton.setAttribute('aria-controls', accountMenu.id);
      accountButton.setAttribute('aria-label', 'Connected Canvas account');
    }
    accountSlot.append(accountButton, accountMenu);
    root.addEventListener('click', event => {
      if (!accountSlot.contains(event.target as Node)) { accountMenu.hidden = true; accountButton.setAttribute('aria-expanded', 'false'); }
    });
    accountSlot.addEventListener('keydown', event => {
      if (event.key === 'Escape') { accountMenu.hidden = true; accountButton.setAttribute('aria-expanded', 'false'); accountButton.focus(); }
    });
    if (location.hash.includes('canvas=cancelled')) report('Canvas authorization was cancelled or refused. Check the Developer Key scopes, then try again.', true);
    if (!connection.configured) report('An administrator needs to configure the Canvas Developer Key before you can connect.');
    else if (!connection.connected) report('Connect Canvas to synchronize students and import course materials.');

    // Native dialogs stay under this route's root so navigation removes them too.
    function dialog(title: string) {
      const node = el('dialog', { class: 'canvas-dialog', 'aria-labelledby': 'canvas-dialog-title' });
      const close = (): void => { node.close(); node.remove(); };
      const body = el('div', { class: 'canvas-dialog-body' });
      const errors = el('p', { class: 'canvas-dialog-error', role: 'alert' });
      const footer = el('div', { class: 'canvas-dialog-footer' });
      const dismiss = button('✕', close, 'canvas-button--quiet'); dismiss.setAttribute('aria-label', 'Close dialog');
      node.append(el('div', { class: 'canvas-dialog-head' }, el('h2', { id: 'canvas-dialog-title', text: title }), dismiss), body, errors, footer);
      node.addEventListener('close', () => node.remove(), { once: true });
      root.append(node); node.showModal();
      const attempt = (fn: () => Promise<void>) => async (): Promise<void> => {
        errors.textContent = '';
        try { await fn(); } catch (error) { errors.textContent = error instanceof Error ? error.message : 'Unable to save. Please retry.'; }
      };
      return { node, body, footer, close, attempt };
    }
    function createDraft(): void {
      const d = dialog('Create a FinanceBot course');
      const name = el('input', { required: true, maxlength: 200, placeholder: 'Introduction to Finance', 'aria-label': 'New course name' });
      const code = el('input', { required: true, maxlength: 50, placeholder: 'COMM 298', 'aria-label': 'New course code' });
      const term = el('input', { required: true, maxlength: 100, placeholder: '2026W1', 'aria-label': 'New course term' });
      const section = el('input', { maxlength: 50, placeholder: '101 + 102', 'aria-label': 'New course sections' });
      d.body.append(el('p', { class: 'canvas-sub', text: 'Start with a draft, then choose the Canvas courses to link.' }), field('Course name', name),
        el('div', { class: 'canvas-two-fields' }, field('Course code', code), field('Term', term)), field('Sections (optional)', section));
      d.footer.append(el('span', { text: 'New courses begin as drafts' }), el('div', { class: 'canvas-actions' }, button('Cancel', d.close),
        button('Create draft', d.attempt(async () => {
          if (![name, code, term].every(input => input.reportValidity() && input.value.trim())) throw new Error('Enter the course name, code and term.');
          const created = await createCourse({ name: name.value.trim(), courseCode: code.value.trim(), term: term.value.trim(), section: section.value.trim() || undefined });
          d.close(); location.hash = `/instructor/course/${created._id}/canvas`;
        }), 'canvas-button--primary')));
      name.focus();
    }
    const target = el('select', { id: 'canvas-target', 'aria-label': 'FinanceBot course' },
      el('option', { value: '', text: 'Choose a FinanceBot course' }),
      ...courses.filter(c => c.lifecycle !== 'archived' || c._id === courseId).map(c => el('option', { value: c._id, text: `${c.courseCode} · ${c.name}${c.section ? ` · ${c.section}` : ''}` })));
    if (getSession().user?.platformInstructor || getSession().user?.isAdmin) target.append(el('option', { value: 'new', text: '+ Create a new FinanceBot course…' }));
    target.value = courseId;
    target.addEventListener('change', () => {
      const next = target.value;
      if (next === 'new') { target.value = courseId; createDraft(); }
      else location.hash = next ? `/instructor/course/${next}/canvas` : '/instructor/canvas';
    });
    const lifecycle = course?.lifecycle ?? (course?.published ? 'published' : 'draft');
    content.replaceChildren(el('div', { class: 'canvas-project-row' }, el('label', { for: target.id, text: 'FinanceBot course' }), target,
      course && el('span', { class: `canvas-badge ${lifecycle !== 'published' ? 'canvas-badge--draft' : ''}`, text: lifecycle === 'published' ? 'Published' : lifecycle === 'archived' ? 'Archived' : 'Draft' })),
      el('div', { class: 'canvas-tabbar' }, tabs, el('div', { class: 'canvas-sync' }, syncTime, syncButton)), warning, panel);
    const tabButtons = (['courses', 'students', 'materials'] as Tab[]).map(key => {
      const label = key === 'courses' ? 'Course links' : key === 'students' ? 'Students' : 'Materials';
      const b = button(label, () => { tab = key; renderTab(); }, 'canvas-tab');
      b.setAttribute('role', 'tab'); b.id = `canvas-tab-${key}`; b.setAttribute('aria-controls', panel.id);
      b.dataset.tab = key;
      b.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = tabButtons.indexOf(b);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
        tabButtons[next].click(); tabButtons[next].focus();
      });
      tabs.append(b); return b;
    });
    function editButton(label = 'Edit links'): HTMLButtonElement {
      const b = button(label, action(picker)); b.dataset.canvasMutation = ''; return b;
    }
    async function picker(): Promise<void> {
      if (!connection.connected) { await auth(); return; }
      if (!courseId || mutating || importing) return;
      const snapshot = link;
      const pending = new Set(snapshot?.sources.map(s => s.id) || []);
      const d = dialog('Choose Canvas courses');
      const info = el('span', { text: `${pending.size} courses selected` });
      const choices = el('div', {}, loadingState('Loading courses you teach…'));
      const search = el('input', { type: 'search', class: 'canvas-search', placeholder: 'Search your teaching courses…', 'aria-label': 'Search Canvas courses' });
      const save = button('Save links', d.attempt(async () => {
        if (!pending.size) throw new Error('Select at least one Canvas course.');
        await changeLink(() => saveCanvasLink(courseId, [...pending], snapshot?.revision ?? null, snapshot?.autoEnroll ?? true));
        d.close(); report('Canvas course links saved.');
      }), 'canvas-button--primary');
      save.disabled = true;
      d.body.append(el('p', { class: 'canvas-sub', text: 'Choose all sections that share this FinanceBot course.' }), search, choices,
        el('p', { class: 'canvas-picker-note', text: 'Only your active Canvas teaching courses can be linked. Student identities are verified through CWL.' }));
      d.footer.append(info, el('div', { class: 'canvas-actions' }, button('Cancel', d.close), save));
      let available: CanvasSource[];
      try { available = await getCanvasCourses(); }
      catch (error) { choices.replaceChildren(el('p', { class: 'canvas-dialog-error', text: error instanceof Error ? error.message : 'Unable to load Canvas courses.' }), button('Retry', () => { d.close(); return picker(); })); return; }
      if (!d.node.isConnected) return;
      const all = [...available, ...(snapshot?.sources.filter(s => !available.some(a => a.id === s.id)) || [])];
      function update(): void {
        info.textContent = `${pending.size} courses selected`;
        save.disabled = !pending.size || [...pending].some(id => !available.some(a => a.id === id));
      }
      function draw(): void {
        const q = search.value.trim().toLowerCase();
        const visible = all.filter(s => `${s.name} ${s.code} ${s.id}`.toLowerCase().includes(q));
        choices.replaceChildren(...visible.map(source => {
          const accessible = available.some(s => s.id === source.id);
          const check = el('input', { type: 'checkbox', 'aria-label': `${source.code} ${source.name}` }); check.checked = pending.has(source.id);
          const row = el('label', { class: `canvas-choice${check.checked ? ' is-selected' : ''}` }, check,
            el('span', {}, el('strong', { text: source.name }), el('small', { text: `${source.code} · Canvas #${source.id}${accessible ? '' : ' · No longer available; deselect to continue'}` })),
            el('span', { class: 'canvas-badge', text: accessible ? 'Teacher' : 'Unavailable' }));
          check.addEventListener('change', () => { if (check.checked) pending.add(source.id); else pending.delete(source.id); row.classList.toggle('is-selected', check.checked); update(); });
          return row;
        }));
        if (!visible.length) choices.append(el('p', { class: 'canvas-sub', text: q ? 'No courses match your search.' : 'No active Canvas teaching courses found. Check your account and permissions.' }));
        update();
      }
      search.addEventListener('input', draw); draw(); search.focus();
    }
    async function removeSource(source: CanvasSource): Promise<void> {
      const snapshot = link;
      if (!snapshot || mutating || importing) return;
      if (!await confirmDialog({ title: `Unlink ${source.code || source.name}?`, message: 'Canvas-only access from this source ends unless another linked source still provides it. Imported materials and student learning history are kept.', confirmLabel: 'Unlink' })) return;
      const remaining = snapshot.sources.filter(s => s.id !== source.id).map(s => s.id);
      await changeLink(() => remaining.length ? saveCanvasLink(courseId, remaining, snapshot.revision, snapshot.autoEnroll) : unlinkCanvas(courseId, snapshot.revision));
      report('Canvas course unlinked.');
    }
    function renderLinks(current: CanvasLink): void {
      const rows = current.sources.map(source => {
        const remove = button('Unlink', action(() => removeSource(source)), 'canvas-button--quiet'); remove.dataset.canvasMutation = '';
        remove.setAttribute('aria-label', `Unlink ${source.code || source.name}`);
        return el('tr', {}, el('td', {}, el('strong', { text: source.code || source.name }), el('small', { class: 'canvas-secondary', text: source.name })),
          el('td', { text: String(current.students.filter(s => s.sourceIds.includes(source.id)).length) }),
          el('td', { class: 'canvas-hide-small' }, el('span', { class: 'canvas-matched', text: 'Linked' })), el('td', { class: 'canvas-row-actions' }, remove));
      });
      const auto = button('', action(async () => {
        const snapshot = link;
        if (!snapshot) return;
        await changeLink(() => saveCanvasLink(courseId, snapshot.sources.map(s => s.id), snapshot.revision, !snapshot.autoEnroll));
        report(link?.autoEnroll ? 'Automatic student enrollment enabled.' : 'Automatic student enrollment paused.');
      }), 'canvas-toggle');
      auto.dataset.canvasMutation = ''; auto.setAttribute('role', 'switch'); auto.setAttribute('aria-label', 'Automatic student enrollment'); auto.setAttribute('aria-checked', String(current.autoEnroll));
      panel.replaceChildren(el('section', { class: 'canvas-panel' },
        el('div', { class: 'canvas-panel-head' }, el('div', {}, el('h2', { text: 'Linked Canvas courses' }), el('p', { text: 'Multiple sections share one FinanceBot course.' })), editButton()),
        el('div', { class: 'canvas-table-scroll' }, el('table', { class: 'canvas-table canvas-source-table' }, tableHead(['Canvas course', 'Students', 'Status', 'Actions']), el('tbody', {}, ...rows))),
        el('div', { class: 'canvas-panel-footer' }, el('span', { text: `${current.sources.length} sources → 1 FinanceBot course` }), el('span', { text: `${current.students.length} unique students` }))),
        el('section', { class: 'canvas-setting' }, el('div', {}, el('h2', { text: 'Automatic student enrollment' }), el('p', { text: 'Students join after CWL login when this course is published and within its access dates.' })), auto),
        el('p', { class: 'canvas-inline-note', text: 'Students are matched by verified CWL identity. Switching between linked sections keeps their progress in this FinanceBot course.' }));
    }
    function renderStudents(current: CanvasLink): void {
      const search = el('input', { class: 'canvas-search', type: 'search', placeholder: 'Search name or Canvas ID…', 'aria-label': 'Search students' });
      const rows = el('tbody'); const count = el('span', { role: 'status', 'aria-live': 'polite' });
      let page = 1;
      let pageSize = 20;
      const size = el('select', { 'aria-label': 'Students per page' }, ...[10, 20, 50].map(n => el('option', { value: String(n), text: String(n) })));
      size.value = String(pageSize);
      const pageLabel = el('span', { class: 'canvas-page-label' });
      const previous = button('Previous', () => { page--; draw(); });
      const next = button('Next', () => { page++; draw(); });
      const pagination = el('nav', { class: 'canvas-pagination', 'aria-label': 'Student pages' },
        field('Per page', size), previous, pageLabel, next);
      size.addEventListener('change', () => { pageSize = Number(size.value); page = 1; draw(); });
      const draw = (): void => {
        const q = search.value.trim().toLowerCase();
        const visible = current.students.filter(s => `${s.name} ${s.canvasUserId}`.toLowerCase().includes(q));
        const pages = Math.max(1, Math.ceil(visible.length / pageSize));
        page = Math.max(1, Math.min(page, pages));
        const start = (page - 1) * pageSize;
        rows.replaceChildren(...visible.slice(start, start + pageSize).map(s => el('tr', {}, el('td', { text: s.name }),
          el('td', {}, el('span', { text: current.sources.filter(source => s.sourceIds.includes(source.id)).map(source => source.code || source.name).join(', ') })),
          el('td', { class: 'canvas-hide-small canvas-identity', text: `#${s.canvasUserId} / ${s.identity}` }),
          el('td', {}, el('span', { class: s.status === 'CWL account matched' ? 'canvas-matched' : 'canvas-sub', text: s.status === 'CWL account matched' ? 'Matched' : 'Awaiting CWL login', title: s.status })))));
        if (!visible.length) rows.append(el('tr', {}, el('td', { colspan: '4', class: 'canvas-sub', text: q ? 'No matching students.' : 'No active students in the linked Canvas courses.' })));
        count.textContent = visible.length ? `${start + 1}–${Math.min(start + pageSize, visible.length)} of ${visible.length} students` : '0 students';
        pageLabel.textContent = `${page} / ${pages}`;
        previous.disabled = page === 1;
        next.disabled = page === pages;
      };
      search.addEventListener('input', () => { page = 1; draw(); });
      panel.replaceChildren(el('section', { class: 'canvas-panel' }, el('div', { class: 'canvas-panel-head' }, el('div', {}, el('h2', { text: `Course students · ${current.students.length}` }),
        el('p', { text: 'Current enrollment from your linked Canvas courses.' })), search),
        el('div', { class: 'canvas-table-scroll' }, el('table', { class: 'canvas-table canvas-student-table' }, tableHead(['Student', 'Source course', 'Canvas ID / PUID suffix', 'CWL identity']), rows)),
        el('div', { class: 'canvas-panel-footer canvas-roster-footer' }, count, pagination)),
        el('p', { class: 'canvas-inline-note', text: 'Names are display labels, not identity keys.' }));
      draw();
    }
    async function renderMaterials(): Promise<void> {
      const host = el('section', { class: 'canvas-panel' }, loadingState('Loading Canvas materials…'));
      panel.replaceChildren(host);
      try {
        const [files, materials] = await Promise.all([getCanvasFiles(courseId), listMaterials(courseId)]);
        if (!host.isConnected) return;
        const selected = new Set<string>();
        const count = el('span', { text: '0 files selected' });
        const selectAll = el('input', { type: 'checkbox', 'aria-label': 'Select all available files' });
        const controls: Array<{ key: string; checkbox: HTMLInputElement; status: HTMLElement }> = [];
        const importButton = button('Import selected', action(async () => {
          if (importing || !selected.size) return;
          importing = true; updateControls(); updateSelection();
          controls.forEach(c => { c.checkbox.disabled = true; });
          try {
            for (const file of files.filter(f => selected.has(`${f.sourceId}:${f.id}`))) {
              if (!root.isConnected) break;
              const result = await importCanvasFile(courseId, file.sourceId, file.id);
              const key = `${file.sourceId}:${file.id}`;
              selected.delete(key);
              const control = controls.find(c => c.key === key)!;
              control.checkbox.checked = false; control.checkbox.dataset.imported = 'true';
              control.status.className = result.status === 'failed' ? 'canvas-sub' : 'canvas-matched';
              control.status.textContent = result.status === 'ready' ? 'Ready' : result.status === 'failed' ? 'Failed — retry in Materials' : 'Processing';
              report(`${result.name} — ${result.reused ? 'already imported' : 'imported'}; ${result.status === 'ready' ? 'ready' : result.status === 'failed' ? 'processing failed — retry' : 'processing'} in Course Materials.`);
            }
          } finally {
            importing = false;
            controls.forEach(c => { c.checkbox.disabled = c.checkbox.dataset.imported === 'true' || c.checkbox.dataset.supported === 'false'; });
            updateControls(); updateSelection();
          }
        }), 'canvas-button--primary');
        function updateSelection(): void {
          count.textContent = `${selected.size} files selected`;
          importButton.disabled = !selected.size || importing || !connection.connected;
          selectAll.disabled = importing || !controls.some(c => !c.checkbox.disabled);
          selectAll.checked = selected.size > 0 && controls.filter(c => !c.checkbox.disabled).every(c => c.checkbox.checked);
          selectAll.indeterminate = selected.size > 0 && !selectAll.checked;
        }
        const rows = files.map(file => {
          const key = `${file.sourceId}:${file.id}`;
          const existing = materials.find(m => m.canvasSource?.courseId === file.sourceId && m.canvasSource.fileId === file.id && m.canvasSource.updatedAt === file.updatedAt);
          const checkbox = el('input', { type: 'checkbox', 'aria-label': `Select ${file.name} from ${file.sourceName}`, disabled: !file.supported || Boolean(existing) });
          checkbox.dataset.imported = String(Boolean(existing)); checkbox.dataset.supported = String(file.supported);
          const status = el('span', { class: existing?.status === 'ready' ? 'canvas-matched' : 'canvas-sub', text: !file.supported ? 'Unsupported' : existing ? existing.status === 'ready' ? 'Imported' : existing.status === 'failed' ? 'Failed — retry in Materials' : 'Processing' : 'Available' });
          controls.push({ key, checkbox, status });
          checkbox.addEventListener('change', () => { if (checkbox.checked) selected.add(key); else selected.delete(key); updateSelection(); });
          return el('tr', {}, el('td', {}, checkbox), el('td', {}, el('strong', { text: file.name }), el('small', { class: 'canvas-secondary', text: file.sourceName })),
            el('td', { class: 'canvas-hide-small canvas-file-size', text: file.size === undefined ? '—' : `${Math.ceil(file.size / 1024)} KB` }), el('td', {}, status));
        });
        selectAll.addEventListener('change', () => { controls.filter(c => !c.checkbox.disabled).forEach(c => { c.checkbox.checked = selectAll.checked; if (selectAll.checked) selected.add(c.key); else selected.delete(c.key); }); updateSelection(); });
        host.replaceChildren(el('div', { class: 'canvas-panel-head' }, el('div', {}, el('h2', { text: 'Canvas materials' }), el('p', { text: 'Select files to add to Course Materials.' })),
          button('Refresh files', () => importing ? undefined : renderMaterials(), 'canvas-button--quiet')),
          el('div', { class: 'canvas-table-scroll' }, el('table', { class: 'canvas-table canvas-file-table' },
            el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, selectAll), ...['File', 'Size', 'Status'].map(text => el('th', { scope: 'col', text })))), el('tbody', {}, ...rows))),
          !files.length ? el('p', { class: 'canvas-inline-note', text: 'No files found in these Canvas courses.' }) : el('span'),
          el('div', { class: 'canvas-panel-footer' }, count, importButton));
        panel.append(el('p', { class: 'canvas-inline-note' }, 'Imported files are copies. Canvas edits won’t overwrite them. ',
          el('a', { href: `#/instructor/course/${courseId}/materials`, text: 'Open Course Materials →' })));
        updateSelection();
      } catch (error) {
        if (host.isConnected) host.replaceChildren(empty('Unable to load Canvas materials', error instanceof Error ? error.message : 'Check your Canvas connection.', button('Retry', () => renderMaterials())));
      }
    }
    function renderTab(): void {
      if (!root.isConnected) return;
      tabButtons.forEach(b => {
        const key = b.dataset.tab as Tab; b.setAttribute('aria-selected', String(key === tab)); b.tabIndex = key === tab ? 0 : -1;
        b.replaceChildren(key === 'courses' ? 'Course links' : key === 'students' ? 'Students' : 'Materials');
        if (key !== 'materials') b.append(el('span', { class: 'canvas-count', text: String(key === 'courses' ? link?.sources.length ?? 0 : link?.students.length ?? 0) }));
      });
      panel.setAttribute('aria-labelledby', `canvas-tab-${tab}`);
      syncTime.textContent = link?.syncedAt ? `Synced ${new Date(link.syncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Not synchronized';
      syncTime.title = link?.syncedAt ? `Last synchronized ${new Date(link.syncedAt).toLocaleString()}. Automatic refresh every 5 minutes.` : '';
      warning.textContent = link?.syncError || (link && (!link.validUntil || new Date(link.validUntil) <= new Date()) ? 'Canvas access is paused until the roster can be synchronized.' : '');
      warning.hidden = !warning.textContent;
      if (!courseId) panel.replaceChildren(empty('Choose your FinanceBot course', 'Select an existing course above, or create a new draft to connect to Canvas.'));
      else if (!link) panel.replaceChildren(empty('Link this course to Canvas', 'Choose one or more Canvas courses or sections for this FinanceBot course.', editButton('Choose Canvas courses')));
      else if (tab === 'courses') renderLinks(link);
      else if (tab === 'students') renderStudents(link);
      else void renderMaterials();
      updateControls();
    }
    renderTab();
  } catch (error) {
    if (root.isConnected) { content.replaceChildren(button('Retry', () => renderCanvas(outlet, params))); report(error instanceof Error ? error.message : 'Unable to load Canvas.', true); }
  }
}
