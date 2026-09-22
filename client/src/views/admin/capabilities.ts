import { attachTutorial } from '../../tutorials.js';
import { ApiError, getAdminCapabilities, saveAdminCapabilities, type Capability, type CapabilityMatrix, type CapabilityRole } from '../../api.js';
import { el, mount } from '../../dom.js';
import { confirmDialog } from '../../modal.js';
import { protectUnsavedChanges, type RouteParams } from '../../router.js';
import { errorState, loadingState } from '../../ui.js';

const ROLES: CapabilityRole[] = ['student', 'instructor', 'ta', 'admin'];
const ROLE_LABEL = { student: 'Student', instructor: 'Instructor', ta: 'TA', admin: 'Admin' };
const LABELS: Record<Capability, string> = {
  'question.review': 'Review questions', 'question.suggest-edit': 'Suggest edits',
  'question.mark-reviewed': 'Mark reviewed', 'question.create-draft': 'Create drafts',
  'question.approve': 'Approve questions', 'flag.triage': 'Triage flags', 'flag.resolve': 'Resolve flags',
  'analytics.view': 'View course analytics', 'analytics.individual': 'View individual analytics',
  'exam.configure': 'Configure exam prep', 'course.manage-tas': 'Manage teaching assistants',
  'materials.upload': 'Upload materials', 'hierarchy.edit': 'Edit learning objectives',
};
const sourceLabel = { default: 'Default', course: 'Course', 'admin-override': 'Platform', 'user-override': 'Individual' };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const locked = (cap: Capability, role: CapabilityRole): boolean => role === 'admin' || (role === 'ta' && ['question.approve', 'flag.resolve'].includes(cap));
const assignmentText = (value: boolean | undefined): string => value === undefined ? 'Inherit' : value ? 'Allow' : 'Deny';
const category = (cap: Capability): string => cap.startsWith('question.') ? 'Questions' : cap.startsWith('flag.') ? 'Flags' : cap.startsWith('analytics.') ? 'Analytics' : 'Course tools';

async function renderInner(outlet: HTMLElement): Promise<void> {
  const root = el('div', { class: 'view view--admin admin-console admin-configuration' });
  const header = el('header', { class: 'ac-header' }, el('div', {}, el('h1', { text: 'Capabilities' }), el('p', { text: 'Set role access with clear scopes and inherited defaults.' })));
  const metrics = el('div', { class: 'ac-metrics' });
  const workspace = el('div', { class: 'ac-workspace' });
  const main = el('section', { class: 'ac-main', 'aria-label': 'Capability editor' });
  const inspectorSlot = el('div', { class: 'ac-config-inspector' });
  const status = el('span', { class: 'form-status', role: 'status', 'aria-live': 'polite' });
  const courseInput = el('input', { class: 'input ac-course-scope', id: 'admin-capability-course', placeholder: 'Course ID (optional)', 'aria-label': 'Course ID override', autocomplete: 'off', maxlength: 24 });
  const search = el('input', { class: 'input', type: 'search', placeholder: 'Find a permission…', 'aria-label': 'Search permissions' });
  const groups = el('select', { class: 'input', 'aria-label': 'Permission category' }, ...['All categories', 'Questions', 'Flags', 'Analytics', 'Course tools'].map((name, i) => el('option', { value: i ? name : '', text: name })));
  const tableSlot = el('div', { class: 'ac-table-scroll admin-capability-list', tabindex: 0, 'aria-label': 'Capability matrix' });
  const note = el('div', { class: 'ac-note ac-config-scope' });
  const saveStatus = el('span', { class: 'ac-config-save-status' });
  let matrix: CapabilityMatrix | undefined;
  let platform: CapabilityMatrix | undefined;
  let draft: CapabilityMatrix['assignments'] = {};
  let scope = '';
  let generation = 0;
  let pending = false;
  let loadFailed = false;
  let selected: Capability | undefined;
  const raw = (data: CapabilityMatrix['assignments'], cap: Capability, role: CapabilityRole): boolean | undefined => data[cap]?.[role];
  const deltas = (): Array<{ cap: Capability; role: CapabilityRole; before: boolean | undefined; after: boolean | undefined }> => (matrix?.matrix ?? []).flatMap(row => ROLES.filter(role => !locked(row.capability, role)).flatMap(role => {
    const before = raw(matrix!.assignments, row.capability, role), after = raw(draft, row.capability, role);
    return before === after ? [] : [{ cap: row.capability, role, before, after }];
  }));
  const discardConfirmation = (): Promise<boolean> => confirmDialog({ title: 'Discard permission changes?', message: 'Your unsaved permission changes will be discarded. Saved permissions will remain in effect.', confirmLabel: 'Discard changes', cancelLabel: 'Keep editing' });
  protectUnsavedChanges(root, () => deltas().length > 0 || pending, async () => pending ? false : discardConfirmation());
  const discard = el('button', { class: 'btn btn--secondary', type: 'button', text: 'Discard', onclick: async () => {
    if (!matrix || !deltas().length || !await discardConfirmation() || !root.isConnected) return;
    draft = clone(matrix.assignments); status.textContent = 'Unsaved changes discarded.'; redraw();
  } });
  const review = el('button', { class: 'btn btn--primary', type: 'button', text: 'Review changes', onclick: () => reviewChanges() });
  const loadButton = el('button', { class: 'btn btn--secondary', type: 'button', text: 'Load matrix', onclick: async () => {
    const next = courseInput.value.trim();
    if (next && !/^[a-f\d]{24}$/i.test(next)) { status.textContent = 'Enter a valid 24-character course ID, or leave it blank for platform defaults.'; courseInput.focus(); return; }
    if (deltas().length && !await discardConfirmation()) return;
    await load(next);
  } });
  const toolbar = el('div', { class: 'ac-toolbar admin-toolbar' }, search, groups, courseInput, loadButton);
  main.append(toolbar, note, tableSlot, el('footer', { class: 'ac-footer admin-save-bar' }, saveStatus, el('div', { class: 'ac-actions' }, discard, review)), el('div', { class: 'ac-config-status' }, status));
  workspace.append(main, inspectorSlot); root.append(header, metrics, workspace); mount(outlet, root);

  function effective(cap: Capability, role: CapabilityRole): { value?: boolean; source: string } {
    if (locked(cap, role)) return { value: role === 'admin', source: 'Locked' };
    const value = raw(draft, cap, role);
    if (value !== undefined) return { value, source: scope ? 'Course' : 'Platform' };
    if (scope && platform) {
      const fallback = platform.matrix.find(row => row.capability === cap)!.roles[role];
      return { value: fallback.value, source: sourceLabel[fallback.source] };
    }
    const saved = matrix!.matrix.find(row => row.capability === cap)!.roles[role];
    if (raw(matrix!.assignments, cap, role) !== undefined) return { source: 'Inherited after save' };
    return { value: saved.value, source: sourceLabel[saved.source] };
  }
  function put(cap: Capability, role: CapabilityRole, value: boolean | undefined): void {
    if (pending || locked(cap, role)) return;
    const next = { ...draft[cap] };
    if (value === undefined) delete next[role]; else next[role] = value;
    if (Object.keys(next).length) draft[cap] = next; else delete draft[cap];
    status.textContent = ''; redraw();
  }
  function redraw(): void {
    if (!matrix) return;
    const focusedLabel = root.contains(document.activeElement) ? document.activeElement?.getAttribute('aria-label') : null;
    const changes = deltas();
    metrics.replaceChildren(...[
      ['Permissions', String(matrix.matrix.length), 'Across 4 roles'], ['Current scope', scope ? 'Course' : 'Platform', scope || 'Shared defaults'],
      ['Overrides', String(matrix.matrix.reduce((count, row) => count + ROLES.filter(role => !locked(row.capability, role) && raw(draft, row.capability, role) !== undefined).length, 0)), 'In this scope'],
      ['Safety rules', '3', 'Always enforced'],
    ].map(([label, value, detail]) => el('div', { class: 'ac-metric' }, el('span', { text: label }), el('strong', { text: value }), el('small', { text: detail }))));
    note.replaceChildren(el('span', { text: 'Admin access and TA approval / resolution restrictions are locked.' }), el('strong', { text: scope ? `Course ${scope}` : 'Platform defaults' }));
    const q = search.value.trim().toLowerCase();
    const visible = matrix.matrix.filter(row => `${row.capability} ${LABELS[row.capability]}`.toLowerCase().includes(q) && (!groups.value || category(row.capability) === groups.value));
    const scrollTop = tableSlot.scrollTop;
    tableSlot.replaceChildren(el('table', { class: 'ac-table ac-capability-table' },
      el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: 'Permission' }), ...ROLES.map(role => el('th', { scope: 'col', text: ROLE_LABEL[role] })))),
      el('tbody', {}, ...visible.map(row => el('tr', { class: selected === row.capability ? 'is-selected' : '' },
        el('td', {}, el('button', { class: 'ac-link ac-capability-name', 'data-capability': row.capability, type: 'button', text: LABELS[row.capability], onclick: () => { selected = row.capability; renderInspector(); } }), el('small', { class: 'ac-cell-secondary', text: category(row.capability) })),
        ...ROLES.map(role => {
          const e = effective(row.capability, role);
          const input = el('input', { type: 'checkbox', 'aria-label': `${ROLE_LABEL[role]}: ${row.capability}`, onchange: () => put(row.capability, role, input.checked) });
          input.checked = e.value ?? false; input.indeterminate = e.value === undefined; input.disabled = pending || locked(row.capability, role);
          return el('td', { class: changes.some(change => change.cap === row.capability && change.role === role) ? 'is-changed' : '' }, el('label', { class: 'ac-capability-cell' }, input, el('small', { text: e.source })));
        }),
      ))),
    ));
    if (!visible.length) tableSlot.append(el('div', { class: 'ac-config-empty', text: 'No matching permissions. Try a different search or category.' }));
    tableSlot.scrollTop = scrollTop;
    saveStatus.textContent = changes.length ? `${changes.length} unsaved ${changes.length === 1 ? 'change' : 'changes'}` : 'No unsaved changes';
    discard.disabled = review.disabled = pending || !changes.length;
    loadButton.disabled = pending; courseInput.disabled = pending;
    renderInspector();
    if (focusedLabel) root.querySelector<HTMLElement>(`[aria-label="${CSS.escape(focusedLabel)}"]`)?.focus();
  }
  function closeInspector(): void { const previous = selected; selected = undefined; renderInspector(); if (previous) root.querySelector<HTMLButtonElement>(`[data-capability="${CSS.escape(previous)}"]`)?.focus(); }
  function renderInspector(): void {
    root.classList.toggle('has-inspector', !!selected);
    inspectorSlot.replaceChildren();
    if (!selected || !matrix) return;
    const cap = selected;
    inspectorSlot.append(el('aside', { class: 'ac-panel', 'aria-label': 'Permission details' },
      el('header', { class: 'ac-panel-header' }, el('div', {}, el('small', { text: scope ? 'Course override' : 'Platform defaults' }), el('h2', { text: LABELS[cap] })), el('button', { class: 'btn btn--ghost', type: 'button', text: 'Close', onclick: closeInspector })),
      el('div', { class: 'ac-panel-body' }, el('code', { class: 'ac-config-key', text: cap }), el('h3', { text: 'Role access' }),
        el('div', { class: 'ac-config-roles' }, ...ROLES.map(role => {
          const e = effective(cap, role);
          const select = el('select', { class: 'input', 'aria-label': `${ROLE_LABEL[role]} access for ${LABELS[cap]}` }, ...[['inherit', 'Inherit'], ['allow', 'Allow'], ['deny', 'Deny']].map(([value, text]) => el('option', { value, text })));
          select.value = raw(draft, cap, role) === undefined ? 'inherit' : raw(draft, cap, role) ? 'allow' : 'deny';
          select.disabled = pending; select.onchange = () => put(cap, role, select.value === 'inherit' ? undefined : select.value === 'allow');
          return el('div', {}, el('div', {}, el('strong', { text: ROLE_LABEL[role] }), el('small', { text: `${e.source} · ${e.value === undefined ? 'Resolved after save' : e.value ? 'Allowed' : 'Denied'}` })), locked(cap, role) ? el('span', { class: 'ac-badge', text: e.value ? 'Always allowed' : 'Always denied' }) : select);
        })),
        el('h3', { text: 'How access is resolved' }), el('ol', { class: 'ac-config-precedence' }, ...['Safety rules', 'Individual course override', 'Course override', 'Platform override', 'Built-in default'].map(text => el('li', { text }))),
        el('p', { class: 'ac-note', text: 'This matrix controls role-level access. A user still needs course membership. Individual overrides remain separate. Choosing Inherit removes this scope’s override.' }),
      ),
    ));
  }
  async function load(nextScope: string): Promise<boolean> {
    const token = ++generation;
    loadFailed = false;
    tableSlot.replaceChildren(loadingState('Loading capability matrix…')); status.textContent = '';
    review.disabled = discard.disabled = true;
    try {
      const [nextMatrix, nextPlatform] = await Promise.all([getAdminCapabilities(nextScope || undefined), nextScope ? getAdminCapabilities() : Promise.resolve(undefined)]);
      if (!root.isConnected || token !== generation) return false;
      matrix = nextMatrix; platform = nextPlatform; scope = nextScope; draft = clone(matrix.assignments); selected = undefined;
      redraw(); return true;
    } catch (error) {
      if (!root.isConnected || token !== generation) return false;
      loadFailed = true;
      status.textContent = error instanceof ApiError ? error.message : (error as Error).message;
      // Keep the last loaded scope intact: the editable text field is never a save target.
      tableSlot.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message), el('button', { class: 'btn btn--secondary', text: 'Retry', type: 'button', onclick: () => load(nextScope) }));
      inspectorSlot.replaceChildren(); root.classList.remove('has-inspector');
      return false;
    }
  }
  async function reviewChanges(): Promise<void> {
    const changes = deltas();
    if (!changes.length || pending) return;
    const agreed = await confirmDialog({ title: `Review ${changes.length} permission ${changes.length === 1 ? 'change' : 'changes'}`, message: `${scope ? `Course ${scope}` : 'Platform defaults'}\n\n${changes.map(c => `${LABELS[c.cap]} · ${ROLE_LABEL[c.role]}: ${assignmentText(c.before)} → ${assignmentText(c.after)}`).join('\n')}\n\nExisting course and individual overrides remain separate.`, confirmLabel: 'Save changes', cancelLabel: 'Keep editing' });
    if (!agreed || !root.isConnected) return;
    pending = true; redraw();
    status.textContent = 'Saving permissions…';
    const target = scope;
    try {
      await saveAdminCapabilities(clone(draft), target || undefined);
      if (!root.isConnected) return;
      // The write succeeded even if the subsequent verification read fails.
      matrix!.assignments = clone(draft);
      const refreshed = await load(target);
      status.textContent = refreshed ? 'Permissions saved. Existing course and individual overrides remain separate.' : 'Permissions saved, but the updated matrix could not be loaded. Retry to verify the effective permissions.';
    } catch (error) { if (root.isConnected) status.textContent = error instanceof ApiError ? error.message : (error as Error).message; }
    finally { pending = false; if (root.isConnected && matrix) { if (loadFailed) { loadButton.disabled = courseInput.disabled = false; review.disabled = discard.disabled = true; saveStatus.textContent = 'Saved · verification unavailable'; } else redraw(); } }
  }
  search.oninput = redraw; groups.onchange = redraw;
  root.addEventListener('keydown', event => { if (event.key === 'Escape') closeInspector(); });
  await load('');
  if (root.isConnected) attachTutorial(root, 'admin-capabilities', { 'admin-capabilities-scope': '.admin-toolbar', 'admin-capabilities-matrix': '.admin-capability-list' });
}
export function renderAdminCapabilities(outlet: HTMLElement, _params: RouteParams): void { void renderInner(outlet); }
