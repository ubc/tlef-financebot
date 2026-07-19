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
// `POST .../generate` returns `202 { jobId }` immediately and the
// three-agent pipeline runs as a BACKGROUND JOB; the resulting questions
// land later as Draft questions in the bank/review queue. So "Generate
// Question ->" below enqueues and shows a queued CONFIRMATION (with a link
// to the Review Queue) instead of blocking on, or fabricating, a result. The
// preview panel is intentionally omitted — see the comment at the bottom of
// `renderForm`.
//
// Threshold note: the API's `target` (5 — `GENERATION_TARGET` in
// generation.service.ts) is displayed as-is in the Target column, but the
// At Target / Below Target / Empty highlight uses the separate Task 8 rule
// of "below 3 approved" (`THIN_THRESHOLD` below) per the plan's Task G
// resolution — the two numbers are intentionally different.
//
// @mentions are PLAIN TEXT: `generateBody` (generation.routes.ts) has no
// material-reference param, so whatever the instructor types in the custom
// prompt — including any "@lecture.pdf" — goes straight into `prompt`. No
// @-autocomplete (out of scope per the brief; a plain textarea is fine).
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
  generateQuestions,
  getCourseTree,
  getPreseeding,
  type CourseTree,
  type GenerationDifficulty,
  type GenerationQuestionType,
  type PreseedingLo,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { pageHeader, statTile, statusBadge, type BadgeVariant } from '../../instructor-ui.js';
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

export const PRESET_TEMPLATES: Array<{ id: PresetTemplateId; label: string }> = [
  { id: 'numerical-parameterized', label: 'Numerical problem (parameterized)' },
  { id: 'concept-check-mcq', label: 'Concept check MCQ' },
  { id: 'true-false-explanation', label: 'True/False with explanation' },
  { id: 'common-misconception', label: 'Common misconception confounder' },
];

/** Preset template id -> starter prompt text that fills the custom-prompt
 * textarea (I12's chip row). A starting point the instructor can edit
 * further, not a fixed value sent verbatim. */
export function presetPrompt(id: PresetTemplateId): string {
  switch (id) {
    case 'numerical-parameterized':
      return 'Generate a numerical problem with parameterized values (vary the key inputs) that requires a multi-step calculation to solve.';
    case 'concept-check-mcq':
      return 'Generate a concept-check multiple-choice question that tests understanding of the underlying idea rather than computation.';
    case 'true-false-explanation':
      return 'Generate a true/false question and include a clear explanation of why the statement is true or false.';
    case 'common-misconception':
      return "Generate a question whose confounder option targets a common student misconception about this topic.";
  }
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
  try {
    [preseeding, tree] = await Promise.all([getPreseeding(courseId), getCourseTree(courseId)]);
  } catch (error) {
    const message = error instanceof ApiError ? error.message : (error as Error).message;
    body.replaceChildren(errorState(message, () => void renderPreseedingInner(outlet, courseId)));
    return;
  }

  const rows = buildRows(preseeding, tree);
  const losInScope = tree.themes.flatMap((theme, themeIndex) =>
    (theme.los ?? []).map((lo, loIndex) => ({ id: lo._id, label: `Topic ${themeIndex + 1} / LO ${loIndex + 1}: ${lo.name}` })),
  );

  const tilesContainer = el('div', {});
  const tableContainer = el('div', {});
  const formContainer = el('div', {});
  const layout = el('div', {}, tilesContainer, tableContainer, formContainer);

  // --- Generate form state (I12) -------------------------------------------

  let formLoId = losInScope[0]?.id ?? '';
  let formType: GenerationQuestionType = 'mcq';
  let formDifficulty: GenerationDifficulty = 'medium';
  let formError: string | null = null;
  let formQueuedMessage: string | null = null;
  let formBusy = false;

  // Persistent — never recreated by `renderForm`, so typing in it doesn't get
  // interrupted the way rebuilding the whole form on every keystroke would
  // (same concern as bank.ts's search input / question-detail.ts's stem
  // textarea).
  const promptTextarea = el('textarea', {
    class: 'input input--area',
    rows: '5',
    placeholder: 'Describe the question to generate. Use @filename to reference a specific uploaded material (plain text — no autocomplete).',
  }) as HTMLTextAreaElement;

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
    formBusy = true;
    formError = null;
    formQueuedMessage = null;
    renderForm();
    try {
      await generateQuestions(courseId, {
        loId: formLoId,
        type: formType,
        difficulty: formDifficulty,
        prompt: promptTextarea.value.trim() || undefined,
      });
      formQueuedMessage = 'Generation queued — new Draft questions will appear in the Review Queue shortly.';
    } catch (error) {
      formError = error instanceof ApiError ? error.message : (error as Error).message;
    }
    formBusy = false;
    renderForm();
  }

  function renderForm(): void {
    const loSelect = el(
      'select',
      {
        class: 'input',
        onchange: (e: Event) => {
          formLoId = (e.target as HTMLSelectElement).value;
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
        { class: 'preseeding-presets' },
        ...PRESET_TEMPLATES.map((preset) =>
          el(
            'button',
            {
              class: 'chip-btn',
              type: 'button',
              onclick: () => {
                promptTextarea.value = presetPrompt(preset.id);
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
      el(
        'button',
        {
          class: 'btn btn--instr-primary',
          type: 'button',
          disabled: formBusy || !formLoId ? 'disabled' : undefined,
          onclick: () => void submitGenerate(),
        },
        formBusy ? 'Generating…' : 'Generate Question →',
      ),
      // The I12 wireframe also shows a synchronous "Generated output"
      // preview panel here, ending in "Review & Approve ->". Omitted: the
      // pipeline is async (202 { jobId }), so at the point this button
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
    if (!window.confirm(`Generate questions for ${thin.length} below-target LO${thin.length === 1 ? '' : 's'}?`)) return;
    bulkBusy = true;
    bulkError = null;
    bulkMessage = null;
    renderTiles();
    // One generateQuestions call per thin LO (Task G brief), all in flight
    // together; a single LO's failure doesn't stop the rest from enqueuing.
    const results = await Promise.allSettled(thin.map((lo) => generateQuestions(courseId, { loId: lo.loId })));
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    bulkBusy = false;
    bulkMessage = `Queued generation for ${succeeded} of ${thin.length} LO${thin.length === 1 ? '' : 's'} — new Draft questions will appear in the Review Queue shortly.`;
    if (succeeded < thin.length) {
      bulkError = `${thin.length - succeeded} LO${thin.length - succeeded === 1 ? '' : 's'} failed to enqueue — try again from that row's "Generate Questions" action.`;
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
    return el(
      'div',
      { class: 'preseeding-row' },
      el('span', { text: row.loLabel }),
      el('span', { class: 'preseeding-row__topic', text: row.topicName }),
      el('span', { class: approvedToneClass(status), text: String(row.approved) }),
      el('span', { class: 'preseeding-row__target', text: String(row.target) }),
      statusBadge(COVERAGE_LABEL[status], COVERAGE_BADGE_VARIANT[status]),
      status === 'at-target'
        ? el('span', {})
        : el(
            'button',
            { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => openFormFor(row.loId) },
            'Generate Questions →',
          ),
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
  renderForm();
}

export function renderPreseeding(outlet: HTMLElement, params: RouteParams): void {
  void renderPreseedingInner(outlet, params.id);
}
