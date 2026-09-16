import { createStructureAssistant } from './structure-ai-workbench.js';
// Topic/LO Structure editor (I2) — one full-width hierarchy with item details
// opened only when the instructor chooses Edit (Task 15, Task C). See
// docs/superpowers/plans/phase-1/Saurav/task-15-wireframe-reference.md
// (node-id `148:3582`) and `.superpowers/sdd/task-15/i2-hierarchy.png`.
import {
  ApiError,
  addLo,
  addTheme,
  archiveLo,
  archiveTheme,
  assignMaterial,
  getCourseTree,
  getPreseeding,
  listMaterials,
  updateLo,
  updateTheme,
  type CourseTreeLo,
  type CourseTreeTheme,
  type Material,
  type PreseedingLo,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { pageHeader, statTile } from '../../instructor-ui.js';
import { confirmDialog } from '../../modal.js';
import { errorState, loadingState } from '../../ui.js';
import type { RouteParams } from '../../router.js';
import { addAssignment, removeAssignment } from './material-assign.js';

export type ThemeReleaseState = 'unreleased' | 'scheduled' | 'released';

/** The Topic's release state, read off its release date (pure, tested).
 * Mirrors the server's theme-release.ts: no date is "Not released" — the
 * default for new Topics — a future date is scheduled, a past date is
 * released. Students see a Topic, and any question tagged to it, only once
 * it is released. */
export function themeAvailability(
  availableFrom: string | undefined,
  now: Date = new Date(),
): { state: ThemeReleaseState; label: string } {
  const date = availableFrom ? new Date(availableFrom) : null;
  if (!date || Number.isNaN(date.getTime())) return { state: 'unreleased', label: 'Not released' };
  const formatted = date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  return date > now
    ? { state: 'scheduled', label: `Releases on ${formatted}` }
    : { state: 'released', label: `Released on ${formatted}` };
}

const RELEASE_TITLE: Record<ThemeReleaseState, string> = {
  unreleased: 'Students cannot see this Topic, its Learning Objectives, or any question tagged to it. Release it from Edit.',
  scheduled: 'Hidden from students until this date, then released automatically.',
  released: 'Students have been able to see this Topic since this date.',
};

function themeAvailabilityPill(availableFrom: string | undefined): HTMLElement {
  const availability = themeAvailability(availableFrom);
  return el('span', {
    class: `tree-theme__availability tree-theme__availability--${availability.state}`,
    title: RELEASE_TITLE[availability.state],
    text: availability.label,
  });
}

/**
 * Pure matcher behind the Structure editor's non-blocking duplicate-name
 * warning on Add Topic / Add LO: an existing `name` "matches" `candidate`
 * when they're equal ignoring case and surrounding whitespace. Never blocks
 * submit — callers only use this to decide whether to show the inline amber
 * hint. Returns the first matching existing name, or `undefined` (including
 * an empty `names` list, or a blank `candidate`).
 */
export function findDuplicateName(names: string[], candidate: string): string | undefined {
  const norm = candidate.trim().toLowerCase();
  if (!norm) return undefined;
  return names.find((name) => name.trim().toLowerCase() === norm);
}

interface SuggestionSelection {
  checked: boolean;
  los: Array<{ checked: boolean }>;
}

/** Topic selection owns its child LO selection in the AI review panel. */
export function setSuggestionTopicSelected(
  theme: SuggestionSelection,
  checked: boolean,
): void {
  theme.checked = checked;
  theme.los.forEach((lo) => {
    lo.checked = checked;
  });
}

/** Applying an AI hierarchy must never create a selected Topic with zero LOs. */
export function canApplySuggestion(themes: SuggestionSelection[]): boolean {
  const selected = themes.filter((theme) => theme.checked);
  return selected.length > 0
    && selected.every((theme) => theme.los.some((lo) => lo.checked));
}

function fieldLabel(text: string): HTMLElement {
  return el('label', { class: 'form-field__label', text });
}

interface Selection {
  type: 'theme' | 'lo';
  id: string;
}

/** A small inline "name + Add/Cancel" form shared by Add Topic and Add LO,
 * with a non-blocking duplicate-name warning that updates on every keystroke
 * without triggering a full panel re-render (which would drop input focus). */
function addNameForm(opts: {
  placeholder: string;
  existingNames: string[];
  onAdd: (name: string) => Promise<void> | void;
  onCancel: () => void;
}): HTMLElement {
  const input = el('input', { class: 'input', type: 'text', placeholder: opts.placeholder }) as HTMLInputElement;
  const warnSlot = el('div', {});

  const updateWarning = (): void => {
    const duplicate = findDuplicateName(opts.existingNames, input.value);
    warnSlot.replaceChildren(
      duplicate ? el('p', { class: 'duplicate-warn', text: `"${duplicate}" already exists.` }) : '',
    );
  };
  input.addEventListener('input', updateWarning);

  const submit = (): Promise<void> | void => {
    const name = input.value.trim();
    if (name) return opts.onAdd(name);
  };

  return el(
    'div',
    { class: 'tree-add-form' },
    input,
    warnSlot,
    el(
      'div',
      { class: 'row' },
      el('button', { class: 'btn btn--instr-primary btn--sm', type: 'button', onclick: submit }, 'Add'),
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: opts.onCancel }, 'Cancel'),
    ),
  );
}

async function renderStructureInner(outlet: HTMLElement, courseId: string): Promise<void> {
  const body = el('div', {}, loadingState('Loading course structure…'));
  const root = el('div', { class: 'view view--structure' }, body);
  mount(outlet, root);

  let tree;
  let preseeding: PreseedingLo[];
  let materials: Material[];
  try {
    [tree, preseeding, materials] = await Promise.all([getCourseTree(courseId), getPreseeding(courseId), listMaterials(courseId)]);
  } catch (error) {
    const message = error instanceof ApiError ? error.message : (error as Error).message;
    body.replaceChildren(errorState(message, () => void renderStructureInner(outlet, courseId)));
    return;
  }

  if (!root.isConnected) return;
  const themes: CourseTreeTheme[] = tree.themes;
  let activeTopic = themes[0]?._id ?? '';
  let showAll = false;
  let search = '';
  let openLo = '';
  let editorSelection: Selection | null = null;
  let editorDialog: HTMLDialogElement | null = null;
  let addingTheme = false;
  let addingLoForTheme: string | null = null;
  let treeErrorMessage: string | null = null;

  const layout = el('div', { class: 'structure-layout' });
  body.replaceChildren(pageHeader('Course Structure', 'Turn your materials into a clear, teachable outline.'), layout);
  const assistant = createStructureAssistant(courseId, materials, refresh, async () => {
    assistant.dispose();
    await renderStructureInner(outlet, courseId);
  }, root);

  function findTheme(id: string): CourseTreeTheme | undefined {
    return themes.find((t) => t._id === id);
  }

  function findLo(id: string): { lo: CourseTreeLo; theme: CourseTreeTheme } | undefined {
    for (const theme of themes) {
      const lo = (theme.los ?? []).find((l) => l._id === id);
      if (lo) return { lo, theme };
    }
    return undefined;
  }

  function refresh(): void {
    layout.replaceChildren(buildTreePane());
    if (editorDialog?.open && editorSelection) renderEditorDialog();
  }

  function closeEditor(): void {
    if (editorDialog?.open) editorDialog.close();
    editorDialog?.remove();
    editorDialog = null;
    editorSelection = null;
  }

  function renderEditorDialog(): void {
    if (!editorDialog || !editorSelection) return;

    let detail: HTMLElement | null = null;
    if (editorSelection.type === 'theme') {
      const theme = findTheme(editorSelection.id);
      if (theme) detail = buildThemeDetail(theme);
    } else {
      const found = findLo(editorSelection.id);
      if (found) detail = buildLoDetail(found.lo, found.theme);
    }

    if (!detail) {
      closeEditor();
      refresh();
      return;
    }

    editorDialog.replaceChildren(
      el(
        'div',
        { class: 'app-dialog__surface structure-editor-dialog__surface' },
        el(
          'div',
          { class: 'structure-editor-dialog__header' },
          el('p', { class: 'eyebrow', text: 'EDIT COURSE STRUCTURE' }),
          el(
            'button',
            {
              class: 'icon-btn structure-editor-dialog__close',
              type: 'button',
              'aria-label': 'Close editor',
              onclick: closeEditor,
            },
            '×',
          ),
        ),
        detail,
      ),
    );
  }

  function openEditor(nextSelection: Selection): void {
    editorSelection = nextSelection;
    if (!editorDialog) {
      editorDialog = el('dialog', {
        class: 'app-dialog structure-editor-dialog',
        'aria-label': 'Edit course structure item',
      }) as HTMLDialogElement;
      editorDialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        closeEditor();
      });
      editorDialog.addEventListener('click', (event) => {
        if (event.target === editorDialog) closeEditor();
      });
      document.body.append(editorDialog);
    }
    renderEditorDialog();
    if (!editorDialog.open) editorDialog.showModal();
    (editorDialog.querySelector('input') as HTMLInputElement | null)?.focus();
  }

  async function handleAddTheme(name: string): Promise<void> {
    try {
      const created = await addTheme(courseId, name);
      themes.push({ ...created, los: created.los ?? [] });
      addingTheme = false;
      activeTopic = created._id; showAll = false;
      treeErrorMessage = null;
      refresh();
    } catch (error) {
      treeErrorMessage = error instanceof ApiError ? error.message : (error as Error).message;
      refresh();
    }
  }

  function buildTreePane(): HTMLElement {
    if (!findTheme(activeTopic)) activeTopic = themes[0]?._id ?? '';
    const button = (text: string, onclick: () => void | Promise<void>, primary = false) =>
      el('button', { type: 'button', class: primary ? 'btn btn--instr-primary' : 'btn btn--ghost', onclick }, text);
    const count = themes.reduce((n, t) => n + (t.los?.length ?? 0), 0);
    const tabs = el('nav', { class: 'structure-view-tabs', 'aria-label': 'Structure views' },
      el('button', { type: 'button', class: assistant.isOpen ? 'is-active' : '', 'aria-pressed': String(assistant.isOpen), onclick: () => assistant.open() }, 'AI draft'),
      el('button', { type: 'button', class: assistant.isOpen ? '' : 'is-active', 'aria-pressed': String(!assistant.isOpen), onclick: () => assistant.close() }, `Course outline · ${count}`));
    const actions = el('div', { class: 'structure-view-bar' }, tabs, el('div', { class: 'structure-view-actions' },
      !assistant.isOpen && themes.length > 0 && button(showAll ? 'Topic view' : 'All objectives', () => { showAll = !showAll; openLo = ''; refresh(); }),
      button('+ Add manually', () => { addingTheme = true; assistant.close(); })));
    const shell = el('div', { class: 'outline-shell' }, actions);
    if (treeErrorMessage) shell.append(errorState(treeErrorMessage));
    if (addingTheme) shell.append(addNameForm({ placeholder: 'Topic name', existingNames: themes.map(t => t.name), onAdd: handleAddTheme, onCancel: () => { addingTheme = false; refresh(); } }));
    if (assistant.isOpen) { shell.append(assistant.element); return shell; }
    if (!themes.length) {
      shell.append(el('div', { class: 'structure-saved-empty' },
        el('span', { class: 'structure-ai-eyebrow', text: 'YOUR COURSE OUTLINE' }),
        el('h2', { text: 'Make space for what students will learn.' }),
        el('p', { text: 'Build a draft from your materials, or add your first topic manually.' }),
        button('Build with AI →', () => assistant.open(), true)));
      return shell;
    }
    const nav = el('aside', { class: 'outline-topics', 'aria-label': 'Topics' },
      el('div', { class: 'outline-topic-heading', text: `TOPICS · ${themes.length}` }),
      el('div', { class: 'outline-topic-list' }, ...themes.map((t, i) =>
        el('button', { type: 'button', class: `outline-topic${activeTopic === t._id && !showAll ? ' is-active' : ''}`,
          'aria-pressed': activeTopic === t._id && !showAll, onclick: () => { activeTopic = t._id; showAll = false; search = ''; openLo = ''; addingLoForTheme = null; refresh(); } },
        el('span', { class: 'outline-number', text: String(i + 1).padStart(2, '0') }),
        el('span', {}, el('strong', { text: t.name }), el('small', { text: `${t.los?.length ?? 0} objectives` }))))),
      el('footer', { class: 'outline-topic-footer', text: `${count} objectives across ${themes.length} topics` }));
    const content = el('section', { class: 'outline-content' });
    shell.append(el('div', { class: 'outline-workspace' }, nav, content));
    const current = findTheme(activeTopic);
    if (!current) {
      content.append(el('div', { class: 'outline-empty' }, el('h2', { text: 'Start with your first topic' }),
        el('p', { text: 'Group related learning objectives into a topic.' }),
        button('+ Add Topic', () => { addingTheme = true; refresh(); }, true)));
      return shell;
    }
    const results = el('div', { class: 'outline-objectives' });
    function drawResults(): void {
      results.replaceChildren();
      const matchingThemes = themes.filter(t => showAll || search || t._id === activeTopic);
      for (const t of matchingThemes) {
        const los = (t.los ?? []).filter(lo => !search || `${t.name} ${lo.name}`.toLowerCase().includes(search.toLowerCase()));
        if (!los.length) continue;
        const section = el('section', { class: 'outline-group' });
        if (showAll || search) section.append(el('h3', { text: t.name }));
        section.append(el('div', { class: 'outline-columns' }, el('span', { text: 'LEARNING OBJECTIVE' }), el('span', { text: 'MATERIALS · APPROVED' })));
        for (const lo of los) {
          const assigned = materials.filter(m => m.assignments.some(a => a.themeId === t._id && a.loId === lo._id));
          const approved = preseeding.find(p => p.loId === lo._id)?.approved ?? 0;
          const row = el('div', { class: 'outline-lo' });
          row.append(el('button', { type: 'button', class: 'outline-lo-row', 'aria-expanded': openLo === lo._id,
            onclick: () => { openLo = openLo === lo._id ? '' : lo._id; drawResults(); } },
            el('span', { class: 'outline-number', text: `${themes.indexOf(t) + 1}.${(t.los ?? []).indexOf(lo) + 1}` }),
            el('span', { class: 'outline-lo-name', text: lo.name }),
            el('small', { text: `${assigned.length} materials · ${approved} approved` }), el('span', { 'aria-hidden': 'true', text: openLo === lo._id ? '−' : '+' })));
          if (openLo === lo._id) {
            const name = el('textarea', { class: 'input', 'aria-label': 'Learning objective', text: lo.name }) as HTMLTextAreaElement;
            const errors = el('div');
            row.append(el('div', { class: 'outline-lo-editor' }, name,
              el('p', { text: assigned.length ? assigned.map(m => m.name).join(' · ') : 'No supporting materials linked yet.' }), errors,
              el('div', { class: 'outline-inline-actions' }, button('Save changes', async () => {
                if (!name.value.trim()) { errors.replaceChildren(errorState('Learning Objective name is required.')); return; }
                try { const updated = await updateLo(lo._id, { name: name.value.trim() }); lo.name = updated.name; openLo = ''; drawResults(); }
                catch (e) { errors.replaceChildren(errorState(e instanceof Error ? e.message : String(e))); }
              }, true), button('Cancel', () => { openLo = ''; drawResults(); }),
              button('Materials & settings', () => openEditor({ type: 'lo', id: lo._id })))));
          }
          section.append(row);
        }
        results.append(section);
      }
      if (!results.childElementCount) results.append(el('div', { class: 'outline-empty' },
        el('h2', { text: search ? 'No matching objectives' : 'Give this topic a purpose' }),
        el('p', { text: search ? 'Try a different search or clear your filters.' : 'Add what students should know or be able to do.' }),
        button(search ? 'Clear search' : '+ Add objectives', () => {
          if (search) { search = ''; input.value = ''; drawResults(); }
          else { addingLoForTheme = current!._id; refresh(); }
        })));
    }
    const input = el('input', { type: 'search', class: 'input', value: search, 'aria-label': 'Search all objectives', placeholder: 'Search all objectives…',
      oninput: () => { search = input.value; drawResults(); } }) as HTMLInputElement;
    content.append(el('header', { class: 'outline-content-heading' },
      el('small', { text: showAll ? 'COURSE OUTLINE' : `TOPIC ${themes.indexOf(current) + 1}` }),
      el('div', {}, el('h2', { text: showAll ? 'The complete learning journey' : current.name }),
        button('Topic settings', () => openEditor({ type: 'theme', id: current._id }))),
      el('p', { text: 'What should students be able to do after this topic?' }), themeAvailabilityPill(current.availableFrom)),
      el('div', { class: 'outline-tools' }, input, button('+ Add objectives', () => { addingLoForTheme = current._id; refresh(); })));
    if (addingLoForTheme) {
      const target = findTheme(addingLoForTheme);
      if (target) {
        const names = el('textarea', { class: 'input', 'aria-label': 'New objectives, one per line', placeholder: 'One objective per line' }) as HTMLTextAreaElement;
        const errors = el('div');
        content.append(el('div', { class: 'outline-add' }, el('strong', { text: `Add to ${target.name}` }), names, errors,
          button('Add objectives', async () => {
            const pending = [...new Set(names.value.split('\n').map(n => n.trim()).filter(Boolean))];
            if (!pending.length) { errors.replaceChildren(errorState('Enter at least one learning objective.')); return; }
            try {
              for (const name of pending) {
                if (!(target.los ?? []).some(lo => lo.name.toLowerCase() === name.toLowerCase())) {
                  const created = await addLo(target._id, name); target.los = [...(target.los ?? []), created];
                }
                names.value = names.value.split('\n').filter(n => n.trim() !== name).join('\n');
              }
              addingLoForTheme = null; refresh();
            } catch (e) { errors.replaceChildren(errorState(`Saved objectives are retained. ${e instanceof Error ? e.message : String(e)}`)); drawResults(); }
          }, true), button('Cancel', () => { addingLoForTheme = null; refresh(); })));
      }
    }
    content.append(results, el('footer', { class: 'outline-content-footer', text: 'Click an objective to edit it. Materials & settings includes question kind and archive controls.' }));
    drawResults();
    return shell;
  }

  function buildThemeDetail(theme: CourseTreeTheme): HTMLElement {
    const index = themes.indexOf(theme);
    const nameInput = el('input', { class: 'input', type: 'text', value: theme.name }) as HTMLInputElement;
    const availableFromInput = el('input', {
      class: 'input',
      type: 'date',
      value: theme.availableFrom ? theme.availableFrom.slice(0, 10) : '',
    }) as HTMLInputElement;
    const errorSlot = el('div', {});
    const release = themeAvailability(theme.availableFrom);

    const applyTheme = async (patch: { name?: string; availableFrom?: string | null }): Promise<void> => {
      errorSlot.replaceChildren();
      try {
        const updated = await updateTheme(theme._id, patch);
        theme.name = updated.name;
        theme.availableFrom = updated.availableFrom;
        closeEditor();
        refresh();
      } catch (error) {
        errorSlot.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
      }
    };

    const save = async (): Promise<void> => {
      const name = nameInput.value.trim();
      if (!name) {
        errorSlot.replaceChildren(errorState('Topic name is required.'));
        return;
      }
      // A date typed here schedules (or re-dates) the release; clearing a
      // date that was set withdraws it; leaving it empty on an unreleased
      // Topic changes nothing.
      const scheduled = availableFromInput.value ? new Date(availableFromInput.value).toISOString() : undefined;
      await applyTheme({
        name,
        ...(scheduled !== undefined ? { availableFrom: scheduled } : theme.availableFrom ? { availableFrom: null } : {}),
      });
    };

    /** Manual release: stamps now, so the Topic and its questions are visible immediately. */
    const releaseNow = async (): Promise<void> => {
      await applyTheme({ availableFrom: new Date().toISOString() });
    };

    const withdraw = async (): Promise<void> => {
      if (!await confirmDialog({
        title: 'Withdraw this release?',
        message: `"${theme.name}" and its Learning Objectives will be hidden from students again, and any question tagged to this Topic will stop being served until it is released again.`,
        confirmLabel: 'Withdraw release',
        tone: 'danger',
      })) return;
      await applyTheme({ availableFrom: null });
    };

    const archive = async (): Promise<void> => {
      if (!await confirmDialog({
        title: 'Archive this Topic?',
        message: `"${theme.name}" and all of its Learning Objectives will be removed from the active course structure.`,
        confirmLabel: 'Archive Topic',
        tone: 'danger',
      })) return;
      try {
        await archiveTheme(theme._id);
        themes.splice(themes.indexOf(theme), 1);
        if (activeTopic === theme._id) activeTopic = '';
        closeEditor();
        refresh();
      } catch (error) {
        errorSlot.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
      }
    };

    return el(
      'div',
      { class: 'structure-detail' },
      el('h2', { class: 'detail-title', text: `Topic ${index + 1}: ${theme.name}` }),
      el(
        'div',
        { class: 'detail-actions' },
        el(
          'button',
          {
            class: 'btn btn--ghost btn--sm',
            type: 'button',
            onclick: () => {
              nameInput.focus();
              nameInput.select();
            },
          },
          'Rename',
        ),
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => archive() }, 'Archive'),
      ),
      el('div', { class: 'form-field' }, fieldLabel('Name'), nameInput),
      el(
        'div',
        { class: `structure-release structure-release--${release.state}` },
        el('span', { class: 'structure-release__label', text: 'Release' }),
        el('span', { class: 'structure-release__state', text: release.label }),
        release.state !== 'released'
          ? el('button', { class: 'btn btn--instr-primary btn--sm', type: 'button', onclick: () => releaseNow() }, 'Release now')
          : false,
        release.state !== 'unreleased'
          ? el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => withdraw() }, 'Withdraw release')
          : false,
      ),
      el(
        'div',
        { class: 'form-field' },
        fieldLabel(release.state === 'released' ? 'Release date' : 'Schedule release (optional)'),
        availableFromInput,
        el('p', {
          class: 'form-field__help',
          text: 'Students see this Topic, its Learning Objectives, and every question tagged to it from this date. Save to apply.',
        }),
      ),
      errorSlot,
      el('button', { class: 'btn btn--instr-primary', type: 'button', onclick: () => save() }, 'Save Changes'),
    );
  }

  /**
   * "Assigned Course Materials" panel in the LO detail pane — the panel Task
   * C deferred (Task 15, Task D). Lists materials whose `assignments` include
   * this LO (Remove -> `assignMaterial` with that one assignment stripped via
   * `removeAssignment`), plus a "+ Assign material" picker over the course's
   * `ready` materials not already on this LO (Add -> `assignMaterial` with
   * the assignment appended via `addAssignment`). Kept consistent with the
   * Materials view's (I3) assign flow by sharing `material-assign.ts`'s pure
   * add/remove helpers rather than duplicating the merge logic.
   */
  function buildAssignedMaterialsPanel(lo: CourseTreeLo, theme: CourseTreeTheme): HTMLElement {
    const assigned = materials.filter((m) => m.assignments.some((a) => a.themeId === theme._id && a.loId === lo._id));
    const candidates = materials.filter(
      (m) => m.status === 'ready' && !m.assignments.some((a) => a.themeId === theme._id && a.loId === lo._id),
    );
    const errorSlot = el('div', {});

    const remove = async (material: Material): Promise<void> => {
      errorSlot.replaceChildren();
      try {
        const updated = await assignMaterial(material._id, removeAssignment(material.assignments, theme._id, lo._id));
        materials = materials.map((m) => (m._id === updated._id ? updated : m));
        refresh();
      } catch (error) {
        errorSlot.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
      }
    };

    const select = el(
      'select',
      { class: 'input' },
      ...candidates.map((m) => el('option', { value: m._id, text: m.name })),
    ) as HTMLSelectElement;

    const add = async (): Promise<void> => {
      errorSlot.replaceChildren();
      const material = candidates.find((m) => m._id === select.value);
      if (!material) return;
      try {
        const updated = await assignMaterial(material._id, addAssignment(material.assignments, theme._id, lo._id));
        materials = materials.map((m) => (m._id === updated._id ? updated : m));
        refresh();
      } catch (error) {
        errorSlot.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
      }
    };

    return el(
      'div',
      { class: 'assigned-materials' },
      assigned.length
        ? el(
            'div',
            { class: 'assigned-materials__list' },
            ...assigned.map((material) =>
              el(
                'div',
                { class: 'assigned-materials__row' },
                el('span', { class: 'assigned-materials__name', text: material.name }),
                el(
                  'button',
                  { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => remove(material) },
                  'Remove',
                ),
              ),
            ),
          )
        : el('p', { class: 'materials-placeholder__text', text: 'No materials assigned to this Learning Objective yet.' }),
      errorSlot,
      candidates.length
        ? el(
            'div',
            { class: 'row assigned-materials__add' },
            select,
            el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => add() }, '+ Assign material'),
          )
        : el('p', { class: 'materials-placeholder__text', text: 'No unassigned materials available to add.' }),
    );
  }

  function buildLoDetail(lo: CourseTreeLo, theme: CourseTreeTheme): HTMLElement {
    const index = (theme.los ?? []).indexOf(lo);
    const nameInput = el('input', { class: 'input', type: 'text', value: lo.name }) as HTMLInputElement;
    // The LO's kind drives the batch planner's Auto distribution. Inferred
    // from the verb server-side; this is the instructor's override.
    const kindSelect = el('select', { class: 'input', 'aria-label': 'Question kind' }) as HTMLSelectElement;
    for (const [value, label] of [
      ['calculation', 'Calculation — numeric questions'],
      ['conceptual', 'Conceptual — reasoning questions'],
      ['mixed', 'Mixed — both kinds'],
    ] as const) kindSelect.append(el('option', { value, text: label }));
    kindSelect.value = lo.kind ?? 'mixed';
    const errorSlot = el('div', {});
    const approved = preseeding.find((p) => p.loId === lo._id)?.approved ?? 0;

    const save = async (): Promise<void> => {
      errorSlot.replaceChildren();
      const name = nameInput.value.trim();
      if (!name) {
        errorSlot.replaceChildren(errorState('Learning Objective name is required.'));
        return;
      }
      try {
        const updated = await updateLo(lo._id, { name, kind: kindSelect.value as CourseTreeLo['kind'] });
        lo.name = updated.name;
        lo.kind = updated.kind;
        closeEditor();
        refresh();
      } catch (error) {
        errorSlot.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
      }
    };

    const archive = async (): Promise<void> => {
      if (!await confirmDialog({
        title: 'Archive this Learning Objective?',
        message: `"${lo.name}" will be removed from the active course structure.`,
        confirmLabel: 'Archive LO',
        tone: 'danger',
      })) return;
      try {
        await archiveLo(lo._id);
        theme.los = (theme.los ?? []).filter((l) => l._id !== lo._id);
        closeEditor();
        refresh();
      } catch (error) {
        errorSlot.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
      }
    };

    return el(
      'div',
      { class: 'structure-detail' },
      el('h2', { class: 'detail-title', text: `LO ${index + 1}: ${lo.name}` }),
      el('p', { class: 'detail-subtitle', text: `Under Topic: ${theme.name}` }),
      el(
        'div',
        { class: 'detail-actions' },
        el(
          'button',
          {
            class: 'btn btn--ghost btn--sm',
            type: 'button',
            onclick: () => {
              nameInput.focus();
              nameInput.select();
            },
          },
          'Rename',
        ),
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => archive() }, 'Archive'),
        // Merge/Split render inactive — out of scope (wireframe N4).
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: 'disabled', title: 'Coming soon' }, 'Merge LOs…'),
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: 'disabled', title: 'Coming soon' }, 'Split LO…'),
      ),
      el('div', { class: 'form-field' }, fieldLabel('Name'), nameInput),
      el('div', { class: 'form-field' }, fieldLabel('Question kind'), kindSelect),
      // Description is omitted: LearningObjective has no `description` field
      // server-side (server/src/types/domain.ts) — adding one would be a
      // server change, out of scope for this task. Omitted rather than faked.
      errorSlot,
      el('h3', { class: 'detail-section-title', text: 'Assigned Course Materials' }),
      buildAssignedMaterialsPanel(lo, theme),
      el('h3', { class: 'detail-section-title', text: 'Questions in Bank' }),
      // Pending/Draft counts need the question bank (Task E) — omitted rather
      // than faked; only the approved count (from `getPreseeding`) is shown.
      el('div', { class: 'stat-tile-row' }, statTile(approved, 'Approved', 'good')),
      el('button', { class: 'btn btn--instr-primary', type: 'button', onclick: () => save() }, 'Save Changes'),
    );
  }

  if (!themes.length) assistant.open(); else refresh();
}

export function renderStructure(outlet: HTMLElement, params: RouteParams): void {
  void renderStructureInner(outlet, params.id);
}
