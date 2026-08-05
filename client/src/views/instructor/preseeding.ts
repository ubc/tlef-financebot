// Pre-seeding Coverage (N9) + Generate Question with Custom Prompt (I12) —
// per-LO approved-question coverage against the server's target, and the
// async three-agent generation trigger (Task 15, Task G). See
// docs/superpowers/plans/phase-1/Saurav/task-15-wireframe-reference.md
// (node-ids N9 `283:68`, I12 `148:5283`) and
// `.superpowers/sdd/task-15/n9-preseeding.png` /
// `.superpowers/sdd/task-15/i12-generate.png`.
//
// ASYNC PIPELINE — no live preview (Task G brief, CRITICAL): the I12
// wireframe shows a synchronous "Generated output" preview panel ending in a
// "Review & Approve ->" action. The server does not support that —
// `POST .../generate` returns `202 { runId }` immediately and the three-agent
// pipeline runs as a BACKGROUND JOB. A course-scoped EventSource now renders
// durable retrieve/generate/validate/review/persist progress and refreshes
// coverage when Drafts land. The preview panel remains intentionally omitted:
// it would still fabricate synchronous output that does not exist yet.
//
// Threshold note: the API's `target` (5 — `GENERATION_TARGET` in
// generation.service.ts) is displayed as-is in the Target column, but the
// At Target / Below Target / Empty highlight uses the separate Task 8 rule
// of "below 3 approved" (`THIN_THRESHOLD` below) per the plan's Task G
// resolution — the two numbers are intentionally different.
//
// Task 10 resolves @mentions server-side against ready materials assigned to
// the selected LO. The form provides a material-name autocomplete that inserts
// the canonical token; typed tokens remain supported.
//
// Topic join: `getPreseeding` returns per-LO rows with no Topic/theme id, so
// Topic names are derived by scanning `getCourseTree`'s themes for each
// `loId` (client-side join, same "no server change" approach as
// bank.ts/review-queue.ts's own `topicLoLabel`).
//
// No `count` field: `generateQuestions` accepts an optional `count` (1-20,
// server defaults to 3), but the Task G brief's field list for this form is
// Target LO / Question Type / Difficulty / custom prompt only — `count` is
// left to the server default rather than adding a field the brief and I12
// screenshot don't show.
import {
  ApiError,
  createGenerationBlueprint,
  generateQuestions,
  getCourseTree,
  getGenerationPresets,
  getPreseeding,
  listMaterials,
  listContentRuns,
  listGenerationBlueprints,
  retryContentRun,
  runGenerationBlueprint,
  subscribeContentRuns,
  type ContentRunSummary,
  type CourseTree,
  type GenerationDifficulty,
  type GenerationBlueprint,
  type GenerationPreset,
  type GenerationQuestionType,
  type Material,
  type PreseedingLo,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { pageHeader, statTile, statusBadge, type BadgeVariant } from '../../instructor-ui.js';
import { confirmDialog } from '../../modal.js';
import { errorState, loadingState } from '../../ui.js';
import type { RouteParams } from '../../router.js';

function navigate(path: string): void {
  window.location.hash = path;
}

// --- Coverage threshold (pure, tested) --------------------------------------

/** Threshold-highlight rule (Task 8 / Task G brief): fewer than 3 Approved
 * questions is "thin" (Below Target at 1-2 approved, Empty at 0). The API's
 * own `target` (displayed separately in the table) plays no part in this. */
export const THIN_THRESHOLD = 3;

export type CoverageStatus = 'at-target' | 'below-target' | 'empty';

/** Approved-count -> coverage status against `threshold`. */
export function coverageStatus(approved: number, threshold: number): CoverageStatus {
  if (approved <= 0) return 'empty';
  if (approved < threshold) return 'below-target';
  return 'at-target';
}

/** The LOs a "Generate for All Thin LOs" sweep should cover: everything
 * below `THIN_THRESHOLD` (Below Target + Empty), in the order `getPreseeding`
 * returned them. */
export function thinLos(preseeding: PreseedingLo[]): PreseedingLo[] {
  return preseeding.filter((lo) => coverageStatus(lo.approved, THIN_THRESHOLD) !== 'at-target');
}

const COVERAGE_LABEL: Record<CoverageStatus, string> = {
  'at-target': 'At Target',
  'below-target': 'Below Target',
  empty: 'Empty',
};

const COVERAGE_BADGE_VARIANT: Record<CoverageStatus, BadgeVariant> = {
  'at-target': 'at-target',
  'below-target': 'below-target',
  empty: 'empty',
};

function approvedToneClass(status: CoverageStatus): string {
  if (status === 'at-target') return 'preseeding-row__approved--good';
  if (status === 'below-target') return 'preseeding-row__approved--warn';
  return 'preseeding-row__approved--bad';
}

// --- Generate form (I12) preset templates (pure, tested) --------------------

export type PresetTemplateId =
  | 'numerical-parameterized'
  | 'concept-check-mcq'
  | 'true-false-explanation'
  | 'common-misconception';

export const PRESET_TEMPLATES: Array<{ id: PresetTemplateId; label: string; text: string }> = [
  {
    id: 'numerical-parameterized',
    label: 'Calculation question',
    text: 'Create a calculation question that requires students to select and apply the correct finance formula, showing enough information for one unambiguous answer.',
  },
  {
    id: 'concept-check-mcq',
    label: 'Concept check',
    text: 'Create a concise concept check that distinguishes genuine understanding from memorizing a definition.',
  },
  {
    id: 'true-false-explanation',
    label: 'Applied scenario',
    text: 'Create an applied business scenario in which the student must use this learning objective to make or justify a finance decision.',
  },
  {
    id: 'common-misconception',
    label: 'Common-misconception probe',
    text: 'Create a question whose most plausible distractor exposes a common student misconception, and explain that misconception clearly.',
  },
];

/** Preset template id -> starter prompt text that fills the custom-prompt
 * textarea (I12's chip row). A starting point the instructor can edit
 * further, not a fixed value sent verbatim. */
export function presetPrompt(id: PresetTemplateId): string {
  return PRESET_TEMPLATES.find((preset) => preset.id === id)?.text ?? '';
}

/** Token format accepted by the server mention resolver. */
export function materialMentionToken(name: string): string {
  return /\s/u.test(name) ? `@"${name.replace(/"/gu, '')}"` : `@${name}`;
}

const GENERATION_ERROR_MESSAGE: Record<string, string> = {
  'generation-no-assigned-materials':
    'This Learning Objective has no ready assigned material. Assign at least one course material before generating questions.',
  'generation-material-mention-not-found':
    'One of the @mentioned materials is not ready or is not assigned to this Learning Objective.',
  'generation-material-mention-ambiguous':
    'The @mentioned material name matches more than one assigned file. Rename the files or remove the @mention.',
  'generation-retrieval-failed':
    'The assigned material could not be searched. Check the vector database and embedding configuration, then try again.',
  'generation-no-grounding':
    'No usable content was found in the assigned materials. Check the file content and assignment before trying again.',
  'generation-no-questions-created':
    'The run completed, but no valid Draft questions could be created.',
  'content-run-enqueue-failed':
    'Question generation could not be queued. Please try again after the background job service recovers.',
};

/** Convert persisted/server domain codes into instructor-facing recovery text. */
export function generationErrorMessage(message: string): string {
  const code = message.split(':')[0] ?? message;
  return GENERATION_ERROR_MESSAGE[code] ?? message;
}

// --- LO/Topic join ------------------------------------------------------------

interface LoRow {
  loId: string;
  approved: number;
  target: number;
  topicName: string;
  loLabel: string;
}

function buildRows(preseeding: PreseedingLo[], tree: CourseTree): LoRow[] {
  return preseeding.map((p) => {
    for (let themeIndex = 0; themeIndex < tree.themes.length; themeIndex += 1) {
      const theme = tree.themes[themeIndex];
      const loIndex = (theme.los ?? []).findIndex((lo) => lo._id === p.loId);
      if (loIndex !== -1) {
        return {
          loId: p.loId,
          approved: p.approved,
          target: p.target,
          topicName: theme.name,
          loLabel: `LO ${themeIndex + 1}.${loIndex + 1}  ${p.loName}`,
        };
      }
    }
    // LO not found in the tree (e.g. archived after preseeding was computed)
    // — still show the row rather than dropping coverage data silently.
    return { loId: p.loId, approved: p.approved, target: p.target, topicName: '—', loLabel: p.loName };
  });
}

const QUESTION_TYPES: GenerationQuestionType[] = ['mcq', 'true-false'];
const TYPE_LABEL: Record<GenerationQuestionType, string> = { mcq: 'MCQ', 'true-false': 'True/False' };
const DIFFICULTIES: GenerationDifficulty[] = ['easy', 'medium', 'hard'];
const DIFFICULTY_LABEL: Record<GenerationDifficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

async function renderPreseedingInner(outlet: HTMLElement, courseId: string): Promise<void> {
  const body = el('div', {}, loadingState('Loading pre-seeding coverage…'));
  const root = el('div', { class: 'view' }, body);
  mount(outlet, root);

  let preseeding: PreseedingLo[];
  let tree: CourseTree;
  let recentRuns: ContentRunSummary[];
  let materials: Material[];
  let generationPresets: GenerationPreset[];
  let blueprints: GenerationBlueprint[];
  try {
    [preseeding, tree, recentRuns, materials, generationPresets, blueprints] = await Promise.all([
      getPreseeding(courseId),
      getCourseTree(courseId),
      listContentRuns(courseId, { kind: 'question-generation', limit: 25 }),
      listMaterials(courseId),
      getGenerationPresets().catch(() =>
        PRESET_TEMPLATES.map(({ label, text }) => ({ label, text })),
      ),
      listGenerationBlueprints(courseId),
    ]);
  } catch (error) {
    const message = error instanceof ApiError ? error.message : (error as Error).message;
    body.replaceChildren(errorState(message, () => void renderPreseedingInner(outlet, courseId)));
    return;
  }

  let rows = buildRows(preseeding, tree);
  const runs = new Map(recentRuns.map((run) => [run._id, run]));
  const refreshedTerminalRuns = new Set<string>();
  const losInScope = tree.themes.flatMap((theme, themeIndex) =>
    (theme.los ?? []).map((lo, loIndex) => ({ id: lo._id, label: `Topic ${themeIndex + 1} / LO ${loIndex + 1}: ${lo.name}` })),
  );

  const tilesContainer = el('div', {});
  const tableContainer = el('div', {});
  const runContainer = el('div', {});
  const formContainer = el('div', {});
  const layout = el('div', {}, tilesContainer, tableContainer, runContainer, formContainer);

  // --- Generate form state (I12) -------------------------------------------

  let formLoId = losInScope[0]?.id ?? '';
  let formType: GenerationQuestionType = 'mcq';
  let formDifficulty: GenerationDifficulty = 'medium';
  let formError: string | null = null;
  let formQueuedMessage: string | null = null;
  let formBusy = false;
  let activeFormRunId: string | null = null;
  let selectedBlueprintId = '';
  const retryingRuns = new Set<string>();
  const blueprintNameInput = el('input', {
    class: 'input',
    type: 'text',
    placeholder: 'Blueprint name',
  }) as HTMLInputElement;

  // Persistent — never recreated by `renderForm`, so typing in it doesn't get
  // interrupted the way rebuilding the whole form on every keystroke would
  // (same concern as bank.ts's search input / question-detail.ts's stem
  // textarea).
  const promptTextarea = el('textarea', {
    class: 'input input--area',
    rows: '5',
    placeholder: 'Describe the question to generate. Type @filename or use the material autocomplete below.',
  }) as HTMLTextAreaElement;
  const materialListId = `generation-materials-${courseId}`;
  const mentionInput = el('input', {
    class: 'input',
    type: 'search',
    list: materialListId,
    placeholder: 'Start typing an assigned material name…',
  }) as HTMLInputElement;

  function materialsForLo(loId: string): Material[] {
    const theme = tree.themes.find((candidate) =>
      (candidate.los ?? []).some((lo) => lo._id === loId),
    );
    if (!theme) return [];
    return materials.filter(
      (material) =>
        material.status === 'ready' &&
        material.assignments.some(
          (assignment) =>
            assignment.loId === loId ||
            (assignment.loId === undefined && assignment.themeId === theme._id),
        ),
    );
  }

  function materialsForSelectedLo(): Material[] {
    return materialsForLo(formLoId);
  }

  function hasReadyAssignedMaterial(loId: string): boolean {
    return materialsForLo(loId).length > 0;
  }

  function openMaterials(): void {
    navigate(`/instructor/course/${encodeURIComponent(courseId)}/materials`);
  }

  function insertMaterialMention(): void {
    const material = materialsForSelectedLo().find(
      (candidate) => candidate.name.toLocaleLowerCase() === mentionInput.value.trim().toLocaleLowerCase(),
    );
    if (!material) {
      formError = 'Choose a ready material assigned to the selected LO.';
      renderForm();
      return;
    }
    const prefix = promptTextarea.value.trimEnd();
    promptTextarea.value = `${prefix}${prefix ? ' ' : ''}${materialMentionToken(material.name)} `;
    mentionInput.value = '';
    formError = null;
    renderForm();
    promptTextarea.focus();
  }

  function openFormFor(loId: string): void {
    formLoId = loId;
    formQueuedMessage = null;
    formError = null;
    renderForm();
    formContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function submitGenerate(): Promise<void> {
    if (!formLoId) {
      formError = 'Choose a Target LO first.';
      renderForm();
      return;
    }
    if (materialsForSelectedLo().length === 0) {
      formError = GENERATION_ERROR_MESSAGE['generation-no-assigned-materials'];
      renderForm();
      return;
    }
    formBusy = true;
    formError = null;
    formQueuedMessage = null;
    renderForm();
    try {
      const queued = await generateQuestions(courseId, {
        loId: formLoId,
        type: formType,
        difficulty: formDifficulty,
        prompt: promptTextarea.value.trim() || undefined,
      });
      activeFormRunId = queued.runId;
      formQueuedMessage = `Generation queued as run ${queued.runId.slice(-8)}.`;
    } catch (error) {
      formError = generationErrorMessage(error instanceof ApiError ? error.message : (error as Error).message);
    }
    formBusy = false;
    renderForm();
  }

  async function saveBlueprint(): Promise<void> {
    const name = blueprintNameInput.value.trim();
    if (!name || !formLoId) {
      formError = 'Blueprint name and Target LO are required.';
      renderForm();
      return;
    }
    formBusy = true;
    formError = null;
    renderForm();
    try {
      const prompt = promptTextarea.value.trim();
      const eligibleMaterials = materialsForSelectedLo();
      const mentionedMaterials = eligibleMaterials.filter((material) =>
        prompt.includes(materialMentionToken(material.name)),
      );
      const pinnedMaterials = mentionedMaterials.length > 0 ? mentionedMaterials : eligibleMaterials;
      const created = await createGenerationBlueprint(courseId, {
        name,
        loId: formLoId,
        count: 3,
        type: formType,
        difficulty: formDifficulty,
        prompt: prompt || undefined,
        materialIds: pinnedMaterials.length > 0
          ? pinnedMaterials.map((material) => material._id)
          : undefined,
      });
      blueprints = [created, ...blueprints];
      selectedBlueprintId = created._id;
      formQueuedMessage = `Saved blueprint “${created.name}”.`;
    } catch (error) {
      formError = generationErrorMessage(error instanceof ApiError ? error.message : (error as Error).message);
    }
    formBusy = false;
    renderForm();
  }

  async function runSelectedBlueprint(): Promise<void> {
    if (!selectedBlueprintId) return;
    formBusy = true;
    formError = null;
    renderForm();
    try {
      const queued = await runGenerationBlueprint(courseId, selectedBlueprintId);
      activeFormRunId = queued.runId;
      formQueuedMessage = `Blueprint run queued as ${queued.runId.slice(-8)}.`;
    } catch (error) {
      formError = generationErrorMessage(error instanceof ApiError ? error.message : (error as Error).message);
    }
    formBusy = false;
    renderForm();
  }

  async function retryRun(run: ContentRunSummary): Promise<void> {
    retryingRuns.add(run._id);
    renderRuns();
    try {
      const queued = await retryContentRun(courseId, run._id);
      activeFormRunId = queued.runId;
      formQueuedMessage = `Retry queued as run ${queued.runId.slice(-8)}.`;
      renderForm();
    } catch (error) {
      formError = generationErrorMessage(error instanceof ApiError ? error.message : (error as Error).message);
      renderForm();
    } finally {
      retryingRuns.delete(run._id);
      renderRuns();
    }
  }

  function runStatusText(run: ContentRunSummary): string {
    const stage = run.stage.charAt(0).toUpperCase() + run.stage.slice(1);
    const units = run.totalUnits !== undefined ? ` · ${run.completedUnits}/${run.totalUnits}` : '';
    const created = run.kind === 'question-generation' ? run.result?.createdQuestionIds.length ?? 0 : 0;
    const failed = run.kind === 'question-generation' ? run.result?.failures.length ?? 0 : 0;
    const activeStage = run.status === 'running'
      ? ` · ${stage}`
      : run.status === 'failed'
        ? ` · during ${stage}`
        : '';
    return `${run.status}${activeStage}${units} · ${created} Draft${created === 1 ? '' : 's'} · ${failed} failed`;
  }

  function runStatusPanel(run: ContentRunSummary): HTMLElement {
    const created = run.kind === 'question-generation' ? run.result?.createdQuestionIds.length ?? 0 : 0;
    const missingAssignedMaterial = run.error?.code === 'generation-no-assigned-materials'
      || run.error?.message.split(':')[0] === 'generation-no-assigned-materials';
    return el(
      'div',
      { class: `preseeding-queued-message content-run-status content-run-status--${run.status}`, role: 'status' },
      el('strong', { text: `Run ${run._id.slice(-8)}` }),
      el('span', { text: ` — ${runStatusText(run)}` }),
      created > 0
        ? el(
            'a',
            {
              href: `#/instructor/course/${encodeURIComponent(courseId)}/queue`,
              onclick: (event: Event) => {
                event.preventDefault();
                navigate(`/instructor/course/${encodeURIComponent(courseId)}/queue`);
              },
            },
            ' Review Drafts →',
          )
        : false,
      run.error ? el('p', { class: 'material-row__error', text: generationErrorMessage(run.error.message) }) : false,
      missingAssignedMaterial
        ? el(
            'button',
            {
              class: 'btn btn--ghost btn--sm',
              type: 'button',
              onclick: openMaterials,
            },
            'Assign course materials',
          )
        : false,
      run.kind === 'question-generation'
        && !missingAssignedMaterial
        && ['completed', 'partial', 'failed'].includes(run.status)
        ? el(
            'button',
            {
              class: 'btn btn--ghost btn--sm',
              type: 'button',
              disabled: retryingRuns.has(run._id) ? 'disabled' : undefined,
              onclick: () => void retryRun(run),
            },
            retryingRuns.has(run._id) ? 'Retrying…' : 'Run exact retry',
          )
        : false,
    );
  }

  function renderForm(): void {
    const assignedMaterials = materialsForSelectedLo();
    const canGenerate = Boolean(formLoId) && assignedMaterials.length > 0;
    const blueprintSelect = el(
      'select',
      {
        class: 'input',
        onchange: (event: Event) => {
          selectedBlueprintId = (event.target as HTMLSelectElement).value;
          const selected = blueprints.find((blueprint) => blueprint._id === selectedBlueprintId);
          if (selected) {
            formLoId = selected.loId;
            formType = selected.type;
            formDifficulty = selected.difficulty ?? 'medium';
            promptTextarea.value = selected.prompt ?? '';
            blueprintNameInput.value = selected.name;
          }
          renderForm();
        },
      },
      el('option', { value: '', text: 'Custom request', selected: selectedBlueprintId ? undefined : 'selected' }),
      ...blueprints.map((blueprint) =>
        el('option', {
          value: blueprint._id,
          text: blueprint.name,
          selected: selectedBlueprintId === blueprint._id ? 'selected' : undefined,
        }),
      ),
    ) as HTMLSelectElement;
    const loSelect = el(
      'select',
      {
        class: 'input',
        onchange: (e: Event) => {
          formLoId = (e.target as HTMLSelectElement).value;
          mentionInput.value = '';
          renderForm();
        },
      },
      ...losInScope.map((lo) =>
        el('option', { value: lo.id, text: lo.label, selected: formLoId === lo.id ? 'selected' : undefined }),
      ),
    ) as HTMLSelectElement;

    const typeSelect = el(
      'select',
      {
        class: 'input',
        onchange: (e: Event) => {
          formType = (e.target as HTMLSelectElement).value as GenerationQuestionType;
        },
      },
      ...QUESTION_TYPES.map((t) => el('option', { value: t, text: TYPE_LABEL[t], selected: formType === t ? 'selected' : undefined })),
    ) as HTMLSelectElement;

    const difficultySelect = el(
      'select',
      {
        class: 'input',
        onchange: (e: Event) => {
          formDifficulty = (e.target as HTMLSelectElement).value as GenerationDifficulty;
        },
      },
      ...DIFFICULTIES.map((d) =>
        el('option', { value: d, text: DIFFICULTY_LABEL[d], selected: formDifficulty === d ? 'selected' : undefined }),
      ),
    ) as HTMLSelectElement;

    mount(
      formContainer,
      el('h2', { class: 'detail-section-title', text: 'Generate Question with Custom Prompt' }),
      el('p', {
        class: 'preseeding-form__hint',
        text: 'Guide question generation: specify LO, type, difficulty, and use @mentions to reference specific materials.',
      }),
      el(
        'div',
        { class: 'preseeding-form__row' },
        el('label', { class: 'form-field' }, el('span', { class: 'form-field__label', text: 'Saved blueprint' }), blueprintSelect),
        el('label', { class: 'form-field' }, el('span', { class: 'form-field__label', text: 'Blueprint name' }), blueprintNameInput),
        el(
          'button',
          {
            class: 'btn btn--ghost btn--sm',
            type: 'button',
            disabled: formBusy ? 'disabled' : undefined,
            onclick: () => void saveBlueprint(),
          },
          'Save blueprint',
        ),
        selectedBlueprintId
          ? el(
              'button',
              {
                class: 'btn btn--ghost btn--sm',
                type: 'button',
                disabled: formBusy ? 'disabled' : undefined,
                onclick: () => void runSelectedBlueprint(),
              },
              'Run blueprint',
            )
          : false,
      ),
      formLoId
        ? assignedMaterials.length > 0
          ? el('p', {
              class: 'preseeding-form__hint',
              text: `${assignedMaterials.length} ready assigned material${assignedMaterials.length === 1 ? '' : 's'} will ground this generation: ${assignedMaterials.map((material) => material.name).join(', ')}`,
            })
          : el(
              'div',
              { class: 'unassigned-banner', role: 'status' },
              el('p', {
                text: 'Questions must be grounded in course content. This LO has no ready assigned material yet.',
              }),
              el(
                'button',
                { class: 'btn btn--ghost btn--sm', type: 'button', onclick: openMaterials },
                'Assign course materials',
              ),
            )
        : false,
      el(
        'div',
        { class: 'preseeding-presets' },
        ...generationPresets.map((preset) =>
          el(
            'button',
            {
              class: 'chip-btn',
              type: 'button',
              onclick: () => {
                promptTextarea.value = preset.text;
              },
            },
            preset.label,
          ),
        ),
      ),
      el(
        'div',
        { class: 'preseeding-form__row' },
        el('label', { class: 'form-field' }, el('span', { class: 'form-field__label', text: 'Target LO' }), loSelect),
        el('label', { class: 'form-field' }, el('span', { class: 'form-field__label', text: 'Question Type' }), typeSelect),
        el('label', { class: 'form-field' }, el('span', { class: 'form-field__label', text: 'Difficulty' }), difficultySelect),
      ),
      el(
        'label',
        { class: 'form-field' },
        el('span', { class: 'form-field__label', text: 'Custom prompt · Use @filename to reference a specific uploaded material' }),
        promptTextarea,
      ),
      el(
        'div',
        { class: 'preseeding-form__row' },
        el(
          'label',
          { class: 'form-field' },
          el('span', { class: 'form-field__label', text: 'Material @mention autocomplete' }),
          mentionInput,
          el(
            'datalist',
            { id: materialListId },
            ...materialsForSelectedLo().map((material) =>
              el('option', { value: material.name, text: material.name }),
            ),
          ),
        ),
        el(
          'button',
          {
            class: 'btn btn--ghost btn--sm',
            type: 'button',
            onclick: insertMaterialMention,
          },
          'Insert @mention',
        ),
      ),
      formError ? errorState(formError) : false,
      formQueuedMessage
        ? el(
            'p',
            { class: 'preseeding-queued-message' },
            `${formQueuedMessage} `,
            el(
              'a',
              {
                href: `#/instructor/course/${encodeURIComponent(courseId)}/queue`,
                onclick: (e: Event) => {
                  e.preventDefault();
                  navigate(`/instructor/course/${encodeURIComponent(courseId)}/queue`);
                },
              },
              'Go to Review Queue →',
            ),
          )
        : false,
      activeFormRunId && runs.get(activeFormRunId) ? runStatusPanel(runs.get(activeFormRunId)!) : false,
      el(
        'button',
        {
          class: 'btn btn--instr-primary',
          type: 'button',
          disabled: formBusy || !canGenerate ? 'disabled' : undefined,
          onclick: () => void submitGenerate(),
        },
        formBusy ? 'Generating…' : 'Generate Question →',
      ),
      // The I12 wireframe also shows a synchronous "Generated output"
      // preview panel here, ending in "Review & Approve ->". Omitted: the
      // pipeline is async (202 { runId }), so at the point this button
      // resolves the question doesn't exist yet — there is nothing real to
      // preview. The queued-message link above (Review Queue) is the actual
      // destination once the background job lands a Draft.
    );
  }

  // --- Bulk "Generate for All Thin LOs" -------------------------------------

  let bulkMessage: string | null = null;
  let bulkError: string | null = null;
  let bulkBusy = false;

  async function generateForAllThin(): Promise<void> {
    const thin = thinLos(preseeding);
    if (thin.length === 0) return;
    const eligible = thin.filter((lo) => hasReadyAssignedMaterial(lo.loId));
    const skipped = thin.length - eligible.length;
    if (eligible.length === 0) {
      bulkError = 'None of the below-target Learning Objectives has a ready assigned material. Assign course materials before generating questions.';
      renderTiles();
      return;
    }
    if (!await confirmDialog({
      title: 'Generate questions?',
      message: `Start generation for ${eligible.length} below-target Learning Objective${eligible.length === 1 ? '' : 's'}?${skipped ? ` ${skipped} without assigned materials will be skipped.` : ''}`,
      confirmLabel: 'Start generation',
    })) return;
    bulkBusy = true;
    bulkError = null;
    bulkMessage = null;
    renderTiles();
    // One generateQuestions call per thin LO (Task G brief), all in flight
    // together; a single LO's failure doesn't stop the rest from enqueuing.
    const results = await Promise.allSettled(eligible.map((lo) => generateQuestions(courseId, { loId: lo.loId })));
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const runIds = results
      .filter((result): result is PromiseFulfilledResult<{ runId: string }> => result.status === 'fulfilled')
      .map((result) => result.value.runId.slice(-8));
    bulkBusy = false;
    bulkMessage = `Queued generation for ${succeeded} of ${eligible.length} eligible LO${eligible.length === 1 ? '' : 's'}${runIds.length ? ` — runs ${runIds.join(', ')}` : ''}.${skipped ? ` Skipped ${skipped} without assigned materials.` : ''}`;
    if (succeeded < eligible.length) {
      bulkError = `${eligible.length - succeeded} LO${eligible.length - succeeded === 1 ? '' : 's'} failed to enqueue — try again from that row's "Generate Questions" action.`;
    }
    renderTiles();
  }

  // --- Tiles + table ----------------------------------------------------------

  function renderTiles(): void {
    const atTarget = rows.filter((r) => coverageStatus(r.approved, THIN_THRESHOLD) === 'at-target').length;
    const belowTarget = rows.filter((r) => coverageStatus(r.approved, THIN_THRESHOLD) === 'below-target').length;
    const empty = rows.filter((r) => coverageStatus(r.approved, THIN_THRESHOLD) === 'empty').length;

    mount(
      tilesContainer,
      el(
        'div',
        { class: 'stat-tile-row' },
        statTile(`${atTarget} / ${rows.length}`, 'LOs at target', 'good'),
        statTile(belowTarget, 'LOs below target', 'warn'),
        statTile(empty, 'LOs empty', 'bad'),
      ),
      bulkBusy ? el('p', { class: 'preseeding-bulk-status', text: 'Queuing generation…' }) : false,
      bulkMessage ? el('p', { class: 'preseeding-bulk-status', text: bulkMessage }) : false,
      bulkError ? errorState(bulkError) : false,
    );
  }

  function loRow(row: LoRow): HTMLElement {
    const status = coverageStatus(row.approved, THIN_THRESHOLD);
    const coverageBadge = statusBadge(COVERAGE_LABEL[status], COVERAGE_BADGE_VARIANT[status]);
    coverageBadge.setAttribute('data-label', 'Status');
    const action = status === 'at-target'
      ? el('span', { class: 'preseeding-row__action' })
      : !hasReadyAssignedMaterial(row.loId)
        ? el(
            'button',
            { class: 'btn btn--ghost btn--sm', type: 'button', onclick: openMaterials },
            'Assign Materials →',
          )
        : el(
            'button',
            { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => openFormFor(row.loId) },
            'Generate Questions →',
          );
    const actionCell = el('div', { class: 'preseeding-row__action', 'data-label': 'Action' }, action);
    return el(
      'div',
      { class: 'preseeding-row' },
      el('span', { class: 'preseeding-row__lo', 'data-label': 'Learning objective', text: row.loLabel }),
      el('span', { class: 'preseeding-row__topic', 'data-label': 'Topic', text: row.topicName }),
      el('span', { class: approvedToneClass(status), 'data-label': 'Approved', text: String(row.approved) }),
      el('span', { class: 'preseeding-row__target', 'data-label': 'Target', text: String(row.target) }),
      coverageBadge,
      actionCell,
    );
  }

  function renderTable(): void {
    mount(
      tableContainer,
      el(
        'div',
        { class: 'preseeding-table' },
        el(
          'div',
          { class: 'preseeding-row preseeding-row--head' },
          el('span', { text: 'Learning Objective' }),
          el('span', { text: 'Topic' }),
          el('span', { text: 'Approved' }),
          el('span', { text: 'Target' }),
          el('span', { text: 'Status' }),
          el('span', { text: 'Action' }),
        ),
        el('div', { class: 'preseeding-table__rows' }, ...rows.map(loRow)),
      ),
    );
  }

  function renderRuns(): void {
    const generationRuns = recentRuns.filter((run) => run.kind === 'question-generation').slice(0, 8);
    mount(
      runContainer,
      generationRuns.length > 0
        ? el(
            'section',
            { class: 'content-run-history' },
            el('h2', { class: 'detail-section-title', text: 'Recent Generation Activity' }),
            ...generationRuns.map(runStatusPanel),
          )
        : false,
    );
  }

  async function applyRunUpdate(run: ContentRunSummary, source: 'snapshot' | 'live'): Promise<void> {
    if (run.kind !== 'question-generation') return;
    const previous = runs.get(run._id);
    runs.set(run._id, run);
    recentRuns = [run, ...recentRuns.filter((existing) => existing._id !== run._id)]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, 25);
    renderRuns();
    if (activeFormRunId === run._id) renderForm();

    const terminal = ['completed', 'partial', 'failed'].includes(run.status);
    const wasActive = previous !== undefined && !['completed', 'partial', 'failed'].includes(previous.status);
    if (!terminal || refreshedTerminalRuns.has(run._id) || (source === 'snapshot' && !wasActive)) return;
    refreshedTerminalRuns.add(run._id);
    try {
      preseeding = await getPreseeding(courseId);
      rows = buildRows(preseeding, tree);
      renderTiles();
      renderTable();
    } catch {
      // Run truth remains visible even if the aggregate refresh is transiently unavailable.
    }
  }

  body.replaceChildren(
    pageHeader(
      'Question Bank Coverage',
      'Target: 3–5 Approved questions per LO before publishing. Generate for any LO below threshold.',
      { text: 'Generate for All Thin LOs', onClick: () => void generateForAllThin() },
    ),
    layout,
  );
  renderTiles();
  renderTable();
  renderRuns();
  renderForm();

  const closeStream = subscribeContentRuns(courseId, {
    onSnapshot: (recent) => {
      for (const run of recent) void applyRunUpdate(run, 'snapshot');
    },
    onRun: (run) => void applyRunUpdate(run, 'live'),
  });
  const lifecycleObserver = new MutationObserver(() => {
    if (root.isConnected) return;
    closeStream();
    lifecycleObserver.disconnect();
  });
  lifecycleObserver.observe(outlet, { childList: true });
}

export function renderPreseeding(outlet: HTMLElement, params: RouteParams): void {
  void renderPreseedingInner(outlet, params.id);
}
