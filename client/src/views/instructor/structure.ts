// Topic/LO Structure editor (I2) — a two-pane tree (left) + detail (right)
// view for the course hierarchy (Task 15, Task C). See
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
  getSuggestedHierarchy,
  listMaterials,
  updateLo,
  updateTheme,
  type CourseTreeLo,
  type CourseTreeTheme,
  type Material,
  type PreseedingLo,
  type SuggestedHierarchy,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { pageHeader, statTile } from '../../instructor-ui.js';
import { emptyState, errorState, loadingState } from '../../ui.js';
import type { RouteParams } from '../../router.js';
import { addAssignment, removeAssignment } from './material-assign.js';

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
  onAdd: (name: string) => void;
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

  const submit = (): void => {
    const name = input.value.trim();
    if (name) opts.onAdd(name);
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

  const themes: CourseTreeTheme[] = tree.themes;
  const expanded = new Set<string>(themes[0] ? [themes[0]._id] : []);
  let selection: Selection | null = null;
  let addingTheme = false;
  let addingLoForTheme: string | null = null;
  let treeErrorMessage: string | null = null;

  // AI-suggested hierarchy (IN-S06, wireframe N10): a read-only suggestion
  // fetched on demand; applying it is just repeated addTheme/addLo calls, the
  // same mutation path the manual Add Topic/Add LO forms already use — this
  // never writes anything the instructor hasn't explicitly kept checked.
  let suggestState: 'idle' | 'loading' | { hierarchy: SuggestedHierarchy } | { error: string } = 'idle';
  let applyingSuggestion = false;
  let applyError: string | null = null;

  const layout = el('div', { class: 'structure-layout' });
  body.replaceChildren(pageHeader('Course Structure', 'Add, rename, and organize Topics and Learning Objectives.'), layout);

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

  function isReviewingSuggestion(): boolean {
    return suggestState !== 'idle' && suggestState !== 'loading';
  }

  function refresh(): void {
    const reviewingSuggestion = isReviewingSuggestion();
    layout.classList.toggle('structure-layout--suggestion', reviewingSuggestion);
    layout.replaceChildren(buildTreePane(), ...(reviewingSuggestion ? [] : [buildDetailPane()]));
  }

  async function handleAddTheme(name: string): Promise<void> {
    try {
      const created = await addTheme(courseId, name);
      themes.push({ ...created, los: created.los ?? [] });
      addingTheme = false;
      expanded.add(created._id);
      selection = { type: 'theme', id: created._id };
      treeErrorMessage = null;
      refresh();
    } catch (error) {
      treeErrorMessage = error instanceof ApiError ? error.message : (error as Error).message;
      refresh();
    }
  }

  async function handleAddLo(themeId: string, name: string): Promise<void> {
    try {
      const created = await addLo(themeId, name);
      const theme = findTheme(themeId);
      if (theme) {
        theme.los = [...(theme.los ?? []), created];
      }
      addingLoForTheme = null;
      expanded.add(themeId);
      selection = { type: 'lo', id: created._id };
      treeErrorMessage = null;
      refresh();
    } catch (error) {
      treeErrorMessage = error instanceof ApiError ? error.message : (error as Error).message;
      refresh();
    }
  }

  async function handleSuggestHierarchy(): Promise<void> {
    suggestState = 'loading';
    applyError = null;
    refresh();
    try {
      const hierarchy = await getSuggestedHierarchy(courseId);
      suggestState = { hierarchy };
    } catch (error) {
      suggestState = { error: error instanceof ApiError ? error.message : (error as Error).message };
    }
    refresh();
  }

  /** Selected-topic / selected-LO checkbox state for the suggestion panel,
   * built fresh each time a hierarchy is fetched — everything starts checked. */
  function buildSuggestionPanel(hierarchy: SuggestedHierarchy): HTMLElement {
    if (hierarchy.themes.length === 0) {
      return el(
        'div',
        { class: 'assign-checklist suggestion-panel' },
        el('p', { class: 'materials-placeholder__text', text: 'No suggestions yet — upload and process course materials first, then try again.' }),
        el(
          'button',
          { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => { suggestState = 'idle'; refresh(); } },
          'Dismiss',
        ),
      );
    }

    // themeIndex -> { checked, loChecked[] } — a topic unchecked skips all its
    // LOs too, regardless of their own checkbox state (simple parent/child rule).
    const themeChecks = hierarchy.themes.map((theme) => ({
      checked: true,
      loChecked: theme.los.map(() => true),
    }));

    const panel = el('div', { class: 'assign-checklist suggestion-panel' });

    const renderRows = (): void => {
      mount(
        panel,
        el('p', { class: 'materials-placeholder__text', text: 'Review the AI-suggested Topics and Learning Objectives below, uncheck anything you don’t want, then apply.' }),
        el(
          'div',
          { class: 'suggestion-panel__grid' },
          ...hierarchy.themes.map((theme, ti) =>
            el(
              'div',
              { class: 'assign-checklist__theme suggestion-panel__theme' },
              el(
                'label',
                { class: 'assign-checklist__lo suggestion-panel__topic' },
                el('input', {
                  type: 'checkbox',
                  checked: themeChecks[ti].checked ? 'checked' : undefined,
                  onchange: (e: Event) => {
                    themeChecks[ti].checked = (e.target as HTMLInputElement).checked;
                  },
                }),
                el('span', { class: 'assign-checklist__theme-name', text: theme.name }),
              ),
              ...theme.los.map((loName, li) =>
                el(
                  'label',
                  { class: 'assign-checklist__lo suggestion-panel__lo' },
                  el('input', {
                    type: 'checkbox',
                    checked: themeChecks[ti].loChecked[li] ? 'checked' : undefined,
                    onchange: (e: Event) => {
                      themeChecks[ti].loChecked[li] = (e.target as HTMLInputElement).checked;
                    },
                  }),
                  el('span', { text: loName }),
                ),
              ),
            ),
          ),
        ),
        applyError ? errorState(applyError) : false,
        el(
          'div',
          { class: 'row suggestion-panel__actions' },
          el(
            'button',
            {
              class: 'btn btn--instr-primary btn--sm',
              type: 'button',
              disabled: applyingSuggestion ? 'disabled' : undefined,
              onclick: () => void applySelected(),
            },
            applyingSuggestion ? 'Applying…' : 'Apply Selected',
          ),
          el(
            'button',
            {
              class: 'btn btn--ghost btn--sm',
              type: 'button',
              disabled: applyingSuggestion ? 'disabled' : undefined,
              onclick: () => {
                suggestState = 'idle';
                refresh();
              },
            },
            'Dismiss',
          ),
        ),
      );
    };

    async function applySelected(): Promise<void> {
      applyingSuggestion = true;
      applyError = null;
      renderRows();
      try {
        for (let ti = 0; ti < hierarchy.themes.length; ti++) {
          if (!themeChecks[ti].checked) continue;
          const suggested = hierarchy.themes[ti];
          const createdTheme = await addTheme(courseId, suggested.name);
          themes.push({ ...createdTheme, los: createdTheme.los ?? [] });
          expanded.add(createdTheme._id);
          for (let li = 0; li < suggested.los.length; li++) {
            if (!themeChecks[ti].loChecked[li]) continue;
            const createdLo = await addLo(createdTheme._id, suggested.los[li]);
            const theme = findTheme(createdTheme._id);
            if (theme) theme.los = [...(theme.los ?? []), createdLo];
          }
        }
        suggestState = 'idle';
        applyingSuggestion = false;
        refresh();
      } catch (error) {
        applyingSuggestion = false;
        applyError = error instanceof ApiError ? error.message : (error as Error).message;
        renderRows();
      }
    }

    renderRows();
    return panel;
  }

  function buildTreePane(): HTMLElement {
    return el(
      'div',
      { class: 'structure-tree' },
      el('h2', { class: 'structure-tree__title', text: 'Course Structure' }),
      treeErrorMessage ? errorState(treeErrorMessage) : false,
      el(
        'div',
        { class: 'row structure-tree__toolbar' },
        addingTheme
          ? false
          : el(
              'button',
              {
                class: 'btn btn--instr-primary structure-tree__add',
                type: 'button',
                onclick: () => {
                  addingTheme = true;
                  refresh();
                },
              },
              '+ Add Topic',
            ),
        el(
          'button',
          {
            class: 'btn btn--ghost structure-tree__add',
            type: 'button',
            disabled: suggestState === 'loading' ? 'disabled' : undefined,
            onclick: () => void handleSuggestHierarchy(),
          },
          suggestState === 'loading' ? 'Suggesting…' : 'Suggest Structure (AI)',
        ),
      ),
      addingTheme
        ? addNameForm({
            placeholder: 'Topic name',
            existingNames: themes.map((t) => t.name),
            onAdd: (name) => void handleAddTheme(name),
            onCancel: () => {
              addingTheme = false;
              refresh();
            },
          })
        : false,
      suggestState !== 'idle' && suggestState !== 'loading'
        ? 'hierarchy' in suggestState
          ? buildSuggestionPanel(suggestState.hierarchy)
          : errorState(suggestState.error, () => void handleSuggestHierarchy())
        : false,
      ...(isReviewingSuggestion() ? [] : themes.map((theme, index) => buildThemeNode(theme, index))),
    );
  }

  function buildThemeNode(theme: CourseTreeTheme, index: number): HTMLElement {
    const isExpanded = expanded.has(theme._id);
    const isSelected = selection?.type === 'theme' && selection.id === theme._id;
    const los = theme.los ?? [];

    const row = el(
      'div',
      {
        class: `tree-theme__row${isSelected ? ' tree-theme__row--selected' : ''}`,
        onclick: () => {
          selection = { type: 'theme', id: theme._id };
          expanded.add(theme._id);
          refresh();
        },
      },
      el(
        'button',
        {
          class: 'tree-theme__chevron',
          type: 'button',
          'aria-label': isExpanded ? 'Collapse' : 'Expand',
          onclick: (e: Event) => {
            e.stopPropagation();
            if (isExpanded) expanded.delete(theme._id);
            else expanded.add(theme._id);
            refresh();
          },
        },
        isExpanded ? '▾' : '▸',
      ),
      el('span', { class: 'tree-theme__name', text: `Topic ${index + 1}: ${theme.name}` }),
      el('span', { class: 'tree-theme__count', text: `${los.length} LO${los.length === 1 ? '' : 's'}` }),
    );

    const childList = isExpanded
      ? el(
          'div',
          { class: 'tree-lo-list' },
          ...los.map((lo, loIndex) => buildLoRow(lo, loIndex)),
          addingLoForTheme === theme._id
            ? addNameForm({
                placeholder: 'Learning Objective name',
                existingNames: los.map((l) => l.name),
                onAdd: (name) => void handleAddLo(theme._id, name),
                onCancel: () => {
                  addingLoForTheme = null;
                  refresh();
                },
              })
            : el(
                'button',
                {
                  class: 'tree-add-lo',
                  type: 'button',
                  onclick: () => {
                    addingLoForTheme = theme._id;
                    refresh();
                  },
                },
                '+ Add LO',
              ),
        )
      : false;

    return el('div', { class: 'tree-theme' }, row, childList);
  }

  function buildLoRow(lo: CourseTreeLo, index: number): HTMLElement {
    const isSelected = selection?.type === 'lo' && selection.id === lo._id;
    return el(
      'div',
      {
        class: `tree-lo${isSelected ? ' tree-lo--selected' : ''}`,
        onclick: (e: Event) => {
          e.stopPropagation();
          selection = { type: 'lo', id: lo._id };
          refresh();
        },
      },
      el('span', { class: 'tree-lo__name', text: `LO ${index + 1}: ${lo.name}` }),
    );
  }

  function buildDetailPane(): HTMLElement {
    if (!selection) {
      return el('div', { class: 'structure-detail' }, emptyState('Select a Topic or Learning Objective to view its details.'));
    }
    if (selection.type === 'theme') {
      const theme = findTheme(selection.id);
      if (!theme) {
        selection = null;
        return buildDetailPane();
      }
      return buildThemeDetail(theme);
    }
    const found = findLo(selection.id);
    if (!found) {
      selection = null;
      return buildDetailPane();
    }
    return buildLoDetail(found.lo, found.theme);
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

    const save = async (): Promise<void> => {
      errorSlot.replaceChildren();
      const name = nameInput.value.trim();
      if (!name) {
        errorSlot.replaceChildren(errorState('Topic name is required.'));
        return;
      }
      try {
        const updated = await updateTheme(theme._id, {
          name,
          availableFrom: availableFromInput.value ? new Date(availableFromInput.value).toISOString() : undefined,
        });
        theme.name = updated.name;
        theme.availableFrom = updated.availableFrom;
        refresh();
      } catch (error) {
        errorSlot.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
      }
    };

    const archive = async (): Promise<void> => {
      if (!window.confirm(`Archive Topic "${theme.name}" and all its Learning Objectives?`)) return;
      try {
        await archiveTheme(theme._id);
        themes.splice(themes.indexOf(theme), 1);
        expanded.delete(theme._id);
        selection = null;
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
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => void archive() }, 'Archive'),
      ),
      el('div', { class: 'form-field' }, fieldLabel('Name'), nameInput),
      el('div', { class: 'form-field' }, fieldLabel('Available From (optional)'), availableFromInput),
      errorSlot,
      el('button', { class: 'btn btn--instr-primary', type: 'button', onclick: () => void save() }, 'Save Changes'),
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
                  { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => void remove(material) },
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
            el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => void add() }, '+ Assign material'),
          )
        : el('p', { class: 'materials-placeholder__text', text: 'No unassigned materials available to add.' }),
    );
  }

  function buildLoDetail(lo: CourseTreeLo, theme: CourseTreeTheme): HTMLElement {
    const index = (theme.los ?? []).indexOf(lo);
    const nameInput = el('input', { class: 'input', type: 'text', value: lo.name }) as HTMLInputElement;
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
        const updated = await updateLo(lo._id, { name });
        lo.name = updated.name;
        refresh();
      } catch (error) {
        errorSlot.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
      }
    };

    const archive = async (): Promise<void> => {
      if (!window.confirm(`Archive Learning Objective "${lo.name}"?`)) return;
      try {
        await archiveLo(lo._id);
        theme.los = (theme.los ?? []).filter((l) => l._id !== lo._id);
        selection = null;
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
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => void archive() }, 'Archive'),
        // Merge/Split render inactive — out of scope (wireframe N4).
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: 'disabled', title: 'Coming soon' }, 'Merge LOs…'),
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: 'disabled', title: 'Coming soon' }, 'Split LO…'),
      ),
      el('div', { class: 'form-field' }, fieldLabel('Name'), nameInput),
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
      el('button', { class: 'btn btn--instr-primary', type: 'button', onclick: () => void save() }, 'Save Changes'),
    );
  }

  refresh();
}

export function renderStructure(outlet: HTMLElement, params: RouteParams): void {
  void renderStructureInner(outlet, params.id);
}
