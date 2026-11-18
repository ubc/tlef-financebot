// Reader for the Questions workspace: the selected question, its review
// context, and the actions its state allows (spec "Reader"). The flag card
// sits on top whenever the question has flags. The middle pane has modes
// (Read / Edit / Preview) and the inspector has tabs (Review / Settings /
// Team) — spec 2026-11-18 D2/D3. Adapted from the retired review workbench
// and from Question details.
import {
  addQuestionInternalNote,
  ApiError,
  editQuestion,
  getQuestion,
  notifyRemediation,
  resolveFlag,
  resolveTaQuestionSuggestion,
  transitionQuestion,
  type CourseTree,
  type Difficulty,
  type Flag,
  type RegenerationVariant,
  type OptionRole,
  type PublicationState,
  type QuestionDetail,
  type QuestionSuggestion,
  type QuestionWorkspace,
  type WorkspaceRow,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { ROLE_LABEL, statusBadge } from '../../instructor-ui.js';
import { confirmDialog, textPromptDialog } from '../../modal.js';
import { editableVariableNames, toDisplayPlaceholders, toStoredPlaceholders, unresolvedPlaceholderWarning } from '../../placeholders.js';
import { STATUS_LABEL, TYPE_LABEL, statusToBadgeVariant } from '../../question-labels.js';
import { renderRichText } from '../../render.js';
import { protectUnsavedChanges } from '../../router.js';
import { errorState, loadingState } from '../../ui.js';
import { createFlagCard } from './questions-flag-card.js';
import { authoringAnswer } from './authoring-answer.js';
import { questionGenerationUsage } from './question-generation-usage.js';
import { isFieldEdited } from './question-tags.js';
import { inspector, type InspectorTab } from './questions-inspector.js';
import { heldTopicNames, hiddenReasonText, objectiveNames, repairSummary, solverSummary, topicNames, type ReaderMode } from './questions-model.js';
import { createQuestionPreview } from './questions-preview.js';
import { createQuestionCompare } from './questions-compare.js';
import { createAnalyticsNotice } from './questions-analytics-notice.js';
import { settingsPanel } from './questions-settings.js';
import { pendingSuggestions, teamPanel } from './questions-team.js';

export interface ReaderOptions {
  courseId: string;
  tree: CourseTree;
  release: () => QuestionWorkspace['release'];
  /** A mutation succeeded: refetch the workspace and show `message`. */
  onMutated: (message: string, questionId: string) => Promise<void> | void;
  /** Open another question (similarity links), switching tab if needed. */
  onOpenQuestion: (questionId: string) => void;
  onOpenRelease: (themeId?: string) => void;
  /** Narrow screens: return from the full-width reader to the list. */
  onBack: () => void;
  isBatchBusy: () => boolean;
  highlightFlagId?: string;
  /** Reader state from the URL, applied when `questionId` is the first
   * question loaded. */
  initialState?: { questionId: string; mode: ReaderMode; flagVersionId?: string; analyticsVersionId?: string };
  /** Mode, flag fix or analytics version changed (the workspace writes `urlState()` to the URL). */
  onStateChange?: () => void;
}

/** A flagged version being corrected in Edit mode (spec D4). */
interface FlagFix {
  versionId: string;
  flags: Flag[];
  reply: string;
}

const isTestFlag = (flag: Flag): boolean => flag.source === 'instructor-preview-test';

const errorText = (error: unknown): string => error instanceof ApiError ? error.message : error instanceof Error ? error.message : String(error);

function rich(text: string, className = ''): HTMLElement {
  const node = el('div', { class: className });
  renderRichText(node, text);
  return node;
}

const REVIEW_STATES: ReadonlySet<PublicationState> = new Set(['draft', 'pending-review', 'reviewed']);

/** Edit-mode text, held in display form (`[NAME]`, see placeholders.ts). */
interface EditDraft {
  stem: string;
  options: Array<{ key: string; role: OptionRole; text: string; explanation: string }>;
}

function displayDraft(detail: QuestionDetail): EditDraft {
  return {
    stem: toDisplayPlaceholders(detail.current.stem),
    options: detail.current.options.map((option) => ({
      key: option.key, role: option.role, text: toDisplayPlaceholders(option.text), explanation: toDisplayPlaceholders(option.explanation),
    })),
  };
}

const returnsToReview = (state: PublicationState): boolean => state === 'approved' || state === 'paused';

export function createQuestionReader(options: ReaderOptions) {
  const status = el('p', { class: 'questions-reader__notice', role: 'status' });
  const content = el('div', { class: 'questions-reader__content' });
  const root = el('article', { class: 'questions-reader', 'aria-label': 'Selected question' }, status, content);
  const coursePath = `/instructor/course/${encodeURIComponent(options.courseId)}`;
  let row: WorkspaceRow | null = null;
  let detail: QuestionDetail | undefined;
  let generationUsage: HTMLElement | false = false;
  /** One per loaded question, so redraws do not refetch its flags. */
  let flagCard: ReturnType<typeof createFlagCard> | undefined;
  let preview: ReturnType<typeof createQuestionPreview> | undefined;
  let compare: ReturnType<typeof createQuestionCompare> | undefined;
  let analyticsNotice: ReturnType<typeof createAnalyticsNotice> | undefined;
  let requestRevision = 0;
  let busy = false;
  let mode: ReaderMode = 'read';
  /** URL state not yet applied: waits for its question to load. */
  let pending = options.initialState;
  let flagFix: FlagFix | null = null;
  /** `flagVersionId` from the URL, waiting for the flag card's flags. */
  let pendingFlagVersionId: string | undefined;
  let draft: EditDraft | null = null;
  let baseline: EditDraft | null = null;
  let dirty = false;
  /** Kept while moving between questions. */
  let inspectorTab: InspectorTab = 'review';
  const rejectionDrafts = new Map<string, string>();
  protectUnsavedChanges(root, () => dirty, () => confirmDialog({ title: 'Discard unsaved edits?', message: 'Your saved question will be kept.', confirmLabel: 'Discard edits' }));

  const locked = (): boolean => busy || options.isBatchBusy();
  const notifyState = (): void => options.onStateChange?.();

  /** Which modes the loaded question offers (Compare: To review only, P2-4). */
  function allowedMode(next: ReaderMode): ReaderMode {
    if (next === 'edit' && detail?.state === 'archived') return 'read';
    if (next === 'compare' && detail && !REVIEW_STATES.has(detail.state)) return 'read';
    return next;
  }

  /** Sets the mode without asking; Edit starts from the loaded version.
   * Leaving Edit drops a flag fix; leaving Compare drops its alternative. */
  function applyMode(next: ReaderMode, fix: FlagFix | null = null): void {
    next = allowedMode(next);
    const changed = next !== mode || fix?.versionId !== flagFix?.versionId;
    if (mode === 'compare' && next !== 'compare') compare?.clear();
    mode = next;
    flagFix = mode === 'edit' ? fix : null;
    if (mode === 'edit' && detail) {
      if (!draft) { baseline = displayDraft(detail); draft = displayDraft(detail); }
    } else {
      draft = null; baseline = null;
    }
    dirty = false;
    if (changed) notifyState();
  }

  async function confirmLeave(): Promise<boolean> {
    if (dirty && !await confirmDialog({ title: 'Discard unsaved edits?', message: 'Your saved question will be kept.', confirmLabel: 'Discard edits' })) return false;
    if (mode === 'compare' && compare?.hasVariant() && !await confirmDialog({ title: 'Discard the generated alternative?', message: 'The current question stays as it is. Generating again makes a new alternative.', confirmLabel: 'Discard alternative' })) return false;
    return true;
  }

  async function setMode(next: ReaderMode, fix: FlagFix | null = null): Promise<void> {
    if ((next === mode && fix?.versionId === flagFix?.versionId) || locked()) return;
    if (!await confirmLeave()) return;
    applyMode(next, fix);
    draw();
    if (mode === 'edit') root.querySelector<HTMLTextAreaElement>('.questions-reader__edit-stem textarea')?.focus();
  }

  /** "Correct the question" on the flag card. */
  function startFlagFix(fix: { versionId: string; flags: Flag[] }): void {
    if (!fix.flags.length) return;
    void setMode('edit', { ...fix, reply: '' }).then(() => {
      if (mode === 'edit' && flagFix) root.querySelector('.questions-flagfix')?.scrollIntoView({ block: 'nearest' });
    });
  }

  async function load(target: WorkspaceRow, force = false): Promise<void> {
    if (!force && row?.id === target.id && detail) { row = target; draw(); return; }
    const sameQuestion = row?.id === target.id;
    row = target; detail = undefined; generationUsage = false; flagCard = undefined;
    if (!sameQuestion) {
      preview = createQuestionPreview(target.id);
      compare = createQuestionCompare({
        courseId: options.courseId,
        questionId: target.id,
        onBusy: (generating) => { busy = generating; draw(); },
        onReplace: (variant) => { void replaceWithVariant(variant); },
      });
      analyticsNotice = undefined;
    }
    // A new question opens in Read, or in the URL's state when it is the URL's
    // question; a reload of the same one keeps Read, Preview or Compare but
    // always leaves Edit.
    const initial = !sameQuestion && pending?.questionId === target.id ? pending : undefined;
    if (!sameQuestion) pending = undefined;
    const nextMode: ReaderMode = initial ? initial.mode : !sameQuestion ? 'read' : mode === 'edit' ? 'read' : mode;
    pendingFlagVersionId = initial?.mode === 'edit' ? initial.flagVersionId : undefined;
    if (initial?.analyticsVersionId) {
      analyticsNotice = createAnalyticsNotice(options.courseId, target.id, initial.analyticsVersionId, () => { analyticsNotice = undefined; notifyState(); draw(); });
    }
    if (mode === 'compare' && nextMode !== 'compare') compare?.clear();
    draft = null; baseline = null; dirty = false; flagFix = null;
    mode = nextMode;
    notifyState();
    const revision = ++requestRevision;
    mount(content, loadingState('Loading question…'));
    try {
      const result = await getQuestion(target.id);
      if (revision !== requestRevision || !root.isConnected) return;
      detail = result;
      generationUsage = questionGenerationUsage(result);
      flagCard = createFlagCard({
        courseId: options.courseId,
        questionId: result.id,
        highlightFlagId: options.highlightFlagId,
        onChanged: () => { void options.onMutated('Flag resolved.', result.id); },
        onCorrect: startFlagFix,
      });
      const card = flagCard;
      void card.load().then(() => {
        // A flag fix from the URL needs the card's flags for that version.
        const versionId = pendingFlagVersionId;
        pendingFlagVersionId = undefined;
        if (!versionId || card !== flagCard || mode !== 'edit' || dirty) return;
        const flags = card.openFlagsFor(versionId);
        if (flags.length) { applyMode('edit', { versionId, flags, reply: '' }); draw(); }
      });
      const wanted = mode;
      mode = allowedMode(mode);
      if (mode === 'edit') applyMode('edit');
      if (wanted !== mode) notifyState();
      draw();
    } catch (error) {
      if (revision === requestRevision && root.isConnected) mount(content, errorState(errorText(error), () => { void load(target, true); }));
    }
  }

  /** 409 means someone else changed the question: say so, reload, never overwrite. */
  async function handleFailure(error: unknown, snapshot: QuestionDetail): Promise<void> {
    if (error instanceof ApiError && error.status === 409) {
      status.textContent = 'This question changed since you opened it. It has been reloaded — check it before deciding again.';
      if (row?.id === snapshot.id) await load(row, true);
      return;
    }
    status.textContent = `${errorText(error)} Nothing was changed.`;
  }

  /** Runs one write for the loaded question: locks the reader, refetches the
   * workspace with `message`, and reloads the question (its version changed). */
  async function mutate(work: (snapshot: QuestionDetail) => Promise<unknown>, message: string): Promise<void> {
    if (!detail || locked()) return;
    const snapshot = detail;
    busy = true; status.textContent = ''; draw();
    try {
      await work(snapshot);
      busy = false;
      await options.onMutated(message, snapshot.id);
      if (row?.id === snapshot.id) await load(row, true);
    } catch (error) {
      busy = false;
      await handleFailure(error, snapshot);
    } finally {
      busy = false;
      if (root.isConnected && detail) draw();
    }
  }

  async function transition(to: PublicationState, message: string, reason?: string): Promise<void> {
    if (!detail || locked()) return;
    const snapshot = detail;
    busy = true; status.textContent = ''; draw();
    try {
      await transitionQuestion(snapshot.id, to, snapshot.current._id, reason);
      rejectionDrafts.delete(snapshot.id);
      busy = false;
      await options.onMutated(message, snapshot.id);
    } catch (error) {
      busy = false;
      await handleFailure(error, snapshot);
    } finally {
      busy = false;
      if (root.isConnected && detail) draw();
    }
  }

  async function reject(): Promise<void> {
    if (!detail || locked()) return;
    const id = detail.id;
    const value = await textPromptDialog({
      title: 'Reject this question?',
      message: 'The question will be archived. You can restore it from the Archived tab. Your note is visible only to the teaching team.',
      fieldLabel: 'Reason for rejecting (optional)',
      placeholder: 'What should be improved?',
      confirmLabel: 'Reject question',
      cancelLabel: 'Keep reviewing',
      tone: 'danger',
      initialValue: rejectionDrafts.get(id) ?? '',
    });
    if (value === null || detail?.id !== id) return;
    rejectionDrafts.set(id, value);
    await transition('archived', 'Question rejected and archived.', value);
  }

  async function archive(): Promise<void> {
    if (!detail || locked()) return;
    if (!await confirmDialog({ title: 'Archive question?', message: 'It leaves student practice. Previous versions and student history are kept.', confirmLabel: 'Archive' })) return;
    await transition('archived', 'Question archived.');
  }

  async function pause(): Promise<void> {
    if (!detail || locked()) return;
    if (!await confirmDialog({ title: 'Pause question?', message: 'Students stop receiving it until you resume it.', confirmLabel: 'Pause' })) return;
    await transition('paused', 'Question paused. Resume it from the Paused tab.');
  }

  async function restore(): Promise<void> {
    if (!detail || locked()) return;
    if (!await confirmDialog({ title: 'Restore to review?', message: 'The question returns as a draft and needs approval again.', confirmLabel: 'Restore to review' })) return;
    await transition('draft', 'Question restored to To review.');
  }

  // --- Edit mode -------------------------------------------------------------

  const markDirty = (): void => { dirty = !!draft && !!baseline && isFieldEdited(draft, baseline); };

  function editorNodes(current: QuestionDetail, edit: EditDraft): HTMLElement[] {
    const stem = el('textarea', { class: 'input', rows: '4', 'aria-label': 'Question stem', disabled: busy }, edit.stem) as HTMLTextAreaElement;
    stem.addEventListener('input', () => { edit.stem = stem.value; markDirty(); });
    const fields = edit.options.map((option) => el('section', { class: 'questions-reader__edit-option' },
      el('label', {}, `Option ${option.key} · ${ROLE_LABEL[option.role]}`,
        el('textarea', { class: 'input', rows: '2', 'aria-label': `Option ${option.key}`, disabled: busy, oninput: (e: Event) => { option.text = (e.target as HTMLTextAreaElement).value; markDirty(); } }, option.text)),
      el('label', {}, 'Explanation',
        el('textarea', { class: 'input', rows: '2', 'aria-label': `Explanation ${option.key}`, disabled: busy, oninput: (e: Event) => { option.explanation = (e.target as HTMLTextAreaElement).value; markDirty(); } }, option.explanation))));
    const variables = editableVariableNames(current.current);
    const warning = flagFix
      // P2-1: a flag correction fixes a question students already have.
      ? (current.state === 'approved' || current.state === 'paused' ? 'Students get the corrected question as soon as you save.' : '')
      : returnsToReview(current.state) ? 'Saving returns this question to To review: it leaves student practice until you approve it again.' : '';
    return [
      flagFix ? flagFixNode(flagFix) : el('span'),
      warning ? el('p', { class: 'questions-reader__warning', text: warning }) : el('span'),
      variables.length ? el('p', { class: 'questions-reader__sample-note', text: `Variables appear as [NAME] (${variables.map((name) => `[${name}]`).join(', ')}). Keep them to keep the computed values.` }) : el('span'),
      el('label', { class: 'questions-reader__edit-stem' }, 'Question stem', stem),
      ...fields,
    ];
  }

  function flagFixNode(fix: FlagFix): HTMLElement {
    const count = fix.flags.length;
    const onlyTests = fix.flags.every(isTestFlag);
    const reply = el('textarea', { class: 'input', id: 'questions-flagfix-reply', rows: '2', disabled: busy, placeholder: 'Optional. Sent to each student who flagged this question.' }, fix.reply) as HTMLTextAreaElement;
    reply.addEventListener('input', () => { fix.reply = reply.value; });
    return el('section', { class: 'questions-flagfix', 'aria-label': 'Fixing flagged reports' },
      el('p', { class: 'questions-flagfix__title' },
        el('strong', { text: `Fixing ${count} report${count === 1 ? '' : 's'}` }),
        fix.flags.some(isTestFlag) ? el('span', { class: 'badge badge--muted', text: 'TEST · Instructor preview' }) : false),
      el('p', { class: 'questions-flagfix__help', text: 'Save and resolve saves your correction, resolves these reports and notifies the students who flagged it.' }),
      el('label', { class: 'questions-settings__label', for: reply.id, text: 'Reply to flagging students' }),
      reply,
      onlyTests ? el('p', { class: 'questions-flagfix__help', text: 'This is a test flag, so no student gets a message.' }) : false);
  }

  /** Resolves the fixed reports and notifies real flaggers (P2-2). Returns
   * what happened, or the step that failed. */
  async function resolveFix(fix: FlagFix): Promise<{ resolved: number; notified: number; failure?: string }> {
    let resolved = 0;
    for (const flag of fix.flags) {
      try {
        await resolveFlag(flag.id, 'correct', true, fix.reply.trim() || undefined);
        resolved++;
      } catch (error) {
        return { resolved, notified: 0, failure: `resolving the reports failed after ${resolved} of ${fix.flags.length}: ${errorText(error)}` };
      }
    }
    const anchor = fix.flags.find((flag) => !isTestFlag(flag));
    if (!anchor) return { resolved, notified: 0 };
    try {
      return { resolved, notified: (await notifyRemediation(anchor.id)).notified };
    } catch (error) {
      return { resolved, notified: 0, failure: `notifying the affected students failed: ${errorText(error)}` };
    }
  }

  async function saveEdit(): Promise<void> {
    if (!detail || !draft || !baseline || locked()) return;
    const current = detail;
    const edit = draft;
    const before = baseline;
    const variables = editableVariableNames(current.current);
    const stored = (text: string): string => toStoredPlaceholders(text, variables);
    const patch: { stem?: string; options?: Array<{ key: string; role: OptionRole; text: string; explanation: string }> } = {};
    if (isFieldEdited(edit.stem, before.stem)) patch.stem = stored(edit.stem);
    if (isFieldEdited(edit.options, before.options)) {
      patch.options = edit.options.map((option) => ({ ...option, text: stored(option.text), explanation: stored(option.explanation) }));
    }
    const fix = flagFix;
    if (!patch.stem && !patch.options) {
      if (fix) { status.textContent = 'Edit the question before resolving the reports.'; return; }
      applyMode('read'); draw(); return;
    }
    if (fix) { await saveFlagFix(current, patch, fix); return; }
    const backToReview = returnsToReview(current.state);
    busy = true; status.textContent = ''; draw();
    try {
      // The server returns an approved or paused question to review only when asked.
      await editQuestion(current.id, { ...patch, expectedVersionId: current.currentVersionId, ...(backToReview ? { submitForReview: true } : {}) });
      busy = false;
      applyMode('read');
      await options.onMutated(backToReview ? 'Changes saved. The question is back in To review.' : 'Changes saved. Review the updated question before approving.', current.id);
      if (row?.id === current.id) await load(row, true);
    } catch (error) {
      busy = false;
      // Keep the draft on screen so nothing typed is lost.
      status.textContent = error instanceof ApiError && error.status === 409
        ? 'This question changed since you opened it. Your edits were not saved; copy anything you need, then reload.'
        : `${errorText(error)} Your edits were not saved.`;
    } finally {
      busy = false;
      if (root.isConnected && detail) draw();
    }
  }

  async function saveFlagFix(current: QuestionDetail, patch: { stem?: string; options?: Array<{ key: string; role: OptionRole; text: string; explanation: string }> }, fix: FlagFix): Promise<void> {
    busy = true; status.textContent = ''; draw();
    try {
      // P2-1: no submitForReview — the corrected question stays with students.
      await editQuestion(current.id, { ...patch, expectedVersionId: current.currentVersionId });
    } catch (error) {
      busy = false;
      status.textContent = error instanceof ApiError && error.status === 409
        ? 'This question changed since you opened it. Your edits were not saved and the reports are still open; copy anything you need, then reload.'
        : `${errorText(error)} Your edits were not saved and the reports are still open.`;
      if (root.isConnected && detail) draw();
      return;
    }
    const result = await resolveFix(fix);
    busy = false;
    applyMode('read');
    const reports = `${result.resolved} report${result.resolved === 1 ? '' : 's'} resolved`;
    const message = result.failure
      ? `The question was saved, but ${result.failure}. Check the flag card for what is still open.`
      : `Question corrected. ${reports}${fix.flags.some((flag) => !isTestFlag(flag)) ? `; ${result.notified} student${result.notified === 1 ? '' : 's'} notified` : ''}.`;
    await options.onMutated(message, current.id);
    if (row?.id === current.id) await load(row, true);
    if (root.isConnected && detail) draw();
  }

  // --- Compare mode ----------------------------------------------------------

  async function replaceWithVariant(variant: RegenerationVariant): Promise<void> {
    if (!detail || locked()) return;
    const current = detail;
    busy = true; status.textContent = ''; draw();
    try {
      // P2-5: the fields Question details saves. Compare is To review only, so no submitForReview.
      const saved = await editQuestion(current.id, {
        expectedVersionId: current.currentVersionId,
        stem: variant.stem,
        options: variant.options,
        difficulty: variant.difficulty,
        ...(variant.paramSlots !== undefined ? { paramSlots: variant.paramSlots } : {}),
        ...(variant.derivedValues !== undefined ? { derivedValues: variant.derivedValues } : {}),
        ...(variant.numericKind !== undefined ? { numericKind: variant.numericKind } : {}),
      });
      busy = false;
      applyMode('read');
      await options.onMutated(`Variant saved as version ${saved.version}.`, current.id);
      if (row?.id === current.id) await load(row, true);
    } catch (error) {
      busy = false;
      status.textContent = error instanceof ApiError && error.status === 409
        ? 'This question changed since you opened it. The alternative is kept here — reload the question before replacing it.'
        : `${errorText(error)} The current question was not changed.`;
    } finally {
      busy = false;
      if (root.isConnected && detail) draw();
    }
  }

  // --- Settings and Team -----------------------------------------------------

  function saveDifficulty(difficulty: Difficulty): void {
    const backToReview = !!detail && returnsToReview(detail.state);
    void mutate((snapshot) => editQuestion(snapshot.id, {
      difficulty, expectedVersionId: snapshot.currentVersionId, ...(backToReview ? { submitForReview: true } : {}),
    }), backToReview ? `Difficulty set to ${difficulty}. The question is back in To review.` : `Difficulty set to ${difficulty}.`);
  }

  function saveTags(tags: { loIds: string[]; themeIds: string[] }): void {
    void mutate((snapshot) => editQuestion(snapshot.id, {
      expectedVersionId: snapshot.currentVersionId,
      expectedTags: { loIds: snapshot.loIds, themeIds: snapshot.themeIds },
      loIds: tags.loIds,
      ...(JSON.stringify(tags.themeIds) !== JSON.stringify(snapshot.themeIds) ? { themeIds: tags.themeIds } : {}),
    }), 'Learning objectives updated.');
  }

  async function loadSuggestion(suggestion: QuestionSuggestion): Promise<void> {
    if (!detail || locked()) return;
    if (dirty && !await confirmDialog({ title: 'Replace your unsaved edits?', message: 'The editor will show the TA’s suggestion instead.', confirmLabel: 'Load suggestion' })) return;
    if (mode !== 'edit') applyMode('edit');
    if (!draft) return;
    if (suggestion.patch.stem !== undefined) draft.stem = toDisplayPlaceholders(suggestion.patch.stem);
    for (const option of suggestion.patch.options ?? []) {
      const target = draft.options.find((candidate) => candidate.key === option.key);
      if (!target) continue;
      target.text = toDisplayPlaceholders(option.text);
      target.explanation = toDisplayPlaceholders(option.explanation);
    }
    markDirty();
    status.textContent = 'TA suggestion loaded into the editor. Review it, then save.';
    draw();
  }

  function resolveSuggestion(suggestion: QuestionSuggestion, action: 'accept' | 'discard'): void {
    void mutate((snapshot) => resolveTaQuestionSuggestion(snapshot.id, suggestion.id, action),
      action === 'accept' ? 'TA suggestion accepted.' : 'TA suggestion discarded.');
  }

  async function addNote(text: string): Promise<boolean> {
    if (!detail) return false;
    const current = detail;
    try {
      const note = await addQuestionInternalNote(current.id, text);
      if (detail === current) {
        current.internalNotes = [...current.internalNotes, note];
        status.textContent = 'Comment added.';
        draw();
      }
      return true;
    } catch (error) {
      status.textContent = `${errorText(error)} The comment was not added.`;
      return false;
    }
  }

  function selectInspectorTab(tab: InspectorTab, fromKeyboard: boolean): void {
    inspectorTab = tab;
    draw({ resetInspectorScroll: true });
    if (fromKeyboard) root.querySelector<HTMLElement>('.questions-inspector__tab[aria-selected="true"]')?.focus();
  }

  // --- Drawing ---------------------------------------------------------------

  function actionButtons(current: QuestionDetail): HTMLElement[] {
    const disabled = locked();
    const btn = (label: string, onclick: () => void, primary = false): HTMLElement =>
      el('button', { class: `btn ${primary ? 'btn--instr-primary' : 'btn--ghost'} btn--sm`, type: 'button', disabled, onclick }, label);
    if (mode === 'edit') {
      return [
        btn('Cancel editing', () => { void setMode('read'); }),
        el('button', { class: 'btn btn--instr-primary btn--sm', type: 'button', disabled, onclick: () => { void saveEdit(); } }, busy ? 'Saving…' : flagFix ? 'Save and resolve' : 'Save changes'),
      ];
    }
    if (REVIEW_STATES.has(current.state)) {
      return [
        btn('Reject', () => { void reject(); }),
        btn(busy ? 'Saving decision…' : 'Approve', () => { void transition('approved', 'Question approved.'); }, true),
      ];
    }
    switch (current.state) {
      case 'approved': return [btn('Archive', () => { void archive(); }), btn('Pause', () => { void pause(); }, true)];
      case 'paused': return [btn('Archive', () => { void archive(); }), btn('Resume', () => { void transition('approved', 'Question resumed.'); }, true)];
      default: return [btn('Restore to review', () => { void restore(); }, true)];
    }
  }

  function modeControl(current: QuestionDetail): HTMLElement {
    const option = (value: ReaderMode, label: string): HTMLElement => el('button', {
      class: `questions-mode__option${mode === value ? ' is-active' : ''}`,
      type: 'button',
      'aria-pressed': String(mode === value),
      disabled: locked() && mode !== value,
      onclick: () => { void setMode(value); },
    }, label);
    return el('div', { class: 'questions-mode', role: 'group', 'aria-label': 'Reader mode' },
      option('read', 'Read'),
      current.state !== 'archived' ? option('edit', 'Edit') : false,
      option('preview', 'Preview'),
      REVIEW_STATES.has(current.state) ? option('compare', 'Compare') : false);
  }

  function placeholderWarning(current: QuestionDetail): HTMLElement | false {
    const warning = unresolvedPlaceholderWarning(current.current.unresolvablePlaceholders);
    return warning
      ? el('div', { class: 'questions-reader__warning', role: 'status' }, el('strong', { text: warning.title }), el('p', { text: warning.body }))
      : false;
  }

  function reviewPanel(current: QuestionDetail, listRow: WorkspaceRow): HTMLElement {
    const decision = current.agentDecision;
    const held = heldTopicNames(options.release(), current.themeIds);
    const similarity = listRow.similarity;
    const similarityLink = (label: string, link: { questionId: string; score: number } | null): HTMLElement | false => link
      ? el('li', {}, el('button', { class: 'link-button', type: 'button', onclick: () => options.onOpenQuestion(link.questionId) }, `${label} · ${link.score.toFixed(2)}`))
      : false;
    return el('div', { class: 'questions-review' },
      generationUsage,
      el('section', {}, el('h3', { text: decision ? `AI check · ${decision.decision.toUpperCase()}` : 'AI check' }),
        decision ? rich(decision.reasoning) : el('p', { class: 'muted', text: current.current.provenance?.kind === 'edited' ? 'Edited after the AI check; the earlier result no longer applies.' : 'No AI check was recorded for this question.' }),
        decision?.suggestions?.length ? el('ul', { class: 'questions-reader__suggestions' }, ...decision.suggestions.map((text) => el('li', { text }))) : false,
        decision?.suggestedDifficulty ? el('p', { text: `Suggested difficulty: ${decision.suggestedDifficulty}` }) : false,
        repairSummary(decision?.repair)
          ? el('div', { class: 'questions-reader__repair' }, el('p', { text: repairSummary(decision?.repair)! }),
            decision?.repair?.originalFindings.length
              ? el('details', {}, el('summary', { text: 'What the first version got wrong' }), el('ul', {}, ...decision.repair.originalFindings.map((finding) => el('li', { text: finding }))))
              : false)
          : false,
        solverSummary(current.current.verification) ? el('p', { class: 'questions-reader__solver', text: solverSummary(current.current.verification)! }) : false,
        decision?.roleAssessment ? el('details', {}, el('summary', { text: 'Answer structure' }), rich(decision.roleAssessment)) : false),
      similarity && (similarity.lo || similarity.topic)
        ? el('section', {}, el('h3', { text: 'Similar questions' }), el('ul', { class: 'questions-reader__similar' }, similarityLink('Nearest in LO', similarity.lo), similarityLink('Nearest in Topic', similarity.topic)))
        : false,
      el('details', { class: 'questions-reader__sources' }, el('summary', { text: `Source evidence · ${current.current.sourceRefs.length}` }),
        ...(current.current.sourceRefs.length
          ? current.current.sourceRefs.map((ref, index) => el('div', {}, el('strong', { text: `Reference ${index + 1}` }), ref.chunk ? rich(ref.chunk) : el('p', { class: 'muted', text: 'No excerpt recorded.' })))
          : [el('p', { class: 'muted', text: 'No source references recorded.' })]),
        el('a', { href: `#${coursePath}/materials`, text: 'Open course materials ↗' })),
      el('section', { class: `questions-reader__visibility${listRow.studentVisible ? ' is-visible' : ''}` },
        el('h3', { text: 'Student visibility' }),
        el('p', { text: hiddenReasonText(listRow.hiddenReason, held) }),
        listRow.hiddenReason === 'topic-unreleased' || listRow.hiddenReason === 'topic-scheduled'
          ? el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => options.onOpenRelease(options.release().themes.find((theme) => current.themeIds.includes(theme.themeId) && !theme.released)?.themeId) }, 'Manage releases')
          : listRow.hiddenReason === 'course-unpublished' ? el('a', { href: `#${coursePath}`, text: 'Publish from the Dashboard →' }) : false));
  }

  function draw(redraw: { resetInspectorScroll?: boolean } = {}): void {
    if (!detail || !row) return;
    const readingScroll = content.querySelector('.questions-reader__scroll')?.scrollTop ?? 0;
    const contextScroll = redraw.resetInspectorScroll ? 0 : content.querySelector('.questions-reader__context')?.scrollTop ?? 0;
    const stackedScroll = content.scrollTop;
    const current = detail;
    const listRow = row;
    // A stable list sample belongs to one version; never mix it with a newer answer key.
    const sample = listRow.current._id === current.current._id ? listRow.sample : undefined;
    const parameterized = !!(current.current.paramSlots?.length || current.current.generateScript || current.current.derivedValues?.length);
    const body = el('div', { class: 'gw-body questions-reader__body' },
      el('div', { class: 'questions-reader__meta' },
        statusBadge(STATUS_LABEL[current.state], statusToBadgeVariant(current.state)),
        el('span', { text: `${TYPE_LABEL[current.current.type]} · ${current.current.difficulty} · Version ${current.currentVersion}` })),
      el('p', { class: 'questions-reader__tags', text: [topicNames(options.tree, current.themeIds).join(', ') || 'No Topic', objectiveNames(options.tree, current.loIds).join(' · ') || 'No learning objective assigned'].join(' — ') }),
      placeholderWarning(current));
    if (mode === 'edit' && draft) {
      body.append(...editorNodes(current, draft));
    } else if (mode === 'compare' && compare) {
      body.append(compare.render(current, locked()));
    } else if (mode === 'preview' && preview) {
      body.append(preview.render(current.current._id, new Set(current.current.options.filter((option) => option.role === 'correct').map((option) => option.key))));
    } else {
      if (parameterized) {
        body.append(el('p', { class: 'questions-reader__sample-note' },
          sample ? 'One computed sample — students may receive different values. ' : 'Template — values are drawn for each student. ',
          el('button', { class: 'link-button', type: 'button', onclick: () => { void setMode('preview'); } }, 'Draw samples in Preview')));
      }
      body.append(rich(sample?.stem ?? current.current.stem, 'gw-stem questions-reader__stem'),
        el('div', { class: 'questions-reader__answers' }, ...current.current.options.map((option) => {
          const drawn = sample?.options.find((value) => value.key === option.key);
          return authoringAnswer(drawn ?? option, option.role === 'correct');
        })));
    }

    const panel = inspectorTab === 'settings'
      ? settingsPanel({ detail: current, tree: options.tree, busy: locked(), editing: mode === 'edit', onSaveDifficulty: saveDifficulty, onSaveTags: saveTags })
      : inspectorTab === 'team'
        ? teamPanel({
          detail: current, tree: options.tree, busy: locked(), canEdit: current.state !== 'archived',
          onLoad: (suggestion) => { void loadSuggestion(suggestion); }, onResolve: resolveSuggestion, onAddNote: addNote,
        })
        : reviewPanel(current, listRow);
    const context = el('aside', { class: 'gw-plan questions-reader__context', 'aria-label': 'Question inspector' },
      inspector({ active: inspectorTab, teamCount: pendingSuggestions(current).length, panel, onSelect: selectInspectorTab }));

    const fullDetails = `#${coursePath}/bank/${encodeURIComponent(current.id)}?from=questions`;
    const links = el('details', { class: 'questions-reader__links' },
      el('summary', {}, 'More actions'),
      el('div', { class: 'questions-reader__link-menu' },
        // Until phase 3 moves it into the reader (spec D6), only for parameterized questions.
        parameterized ? el('a', { href: `#${coursePath}/bank/${encodeURIComponent(current.id)}/params`, text: 'Parameters' }) : false,
        current.state !== 'archived' ? el('a', { href: `#${coursePath}/bank/${encodeURIComponent(current.id)}/collaborate`, text: 'Edit together' }) : false,
        el('a', { href: fullDetails, text: 'Open full details ↗' }),
        el('button', { class: 'link-button', type: 'button', disabled: busy, onclick: () => { if (row) void load(row, true); } }, 'Reload')));

    const readingPane = el('div', { class: 'questions-reader__scroll' },
      el('button', { class: 'btn btn--ghost btn--sm questions-reader__back', type: 'button', onclick: options.onBack }, '← Back to list'),
      // The flag card and inspector use h3; on narrow screens the list's
      // headings are hidden, so the reader names its own level.
      el('h2', { class: 'sr-only', text: 'Selected question' }),
      flagCard?.root ?? false,
      analyticsNotice?.root ?? false,
      modeControl(current),
      body);
    // D8: Compare takes the inspector's column; the inspector returns on the
    // tab it showed before.
    const wide = mode === 'compare';
    content.classList.toggle('is-wide', wide);
    mount(content,
      el('div', { class: 'gw-reader questions-reader__main' },
        readingPane,
        el('footer', { class: 'gw-footer questions-reader__actions' },
          el('div', { class: 'questions-reader__tools' }, links),
          el('div', { class: 'questions-reader__buttons' }, ...actionButtons(current)))),
      wide ? false : context);
    readingPane.scrollTop = readingScroll;
    context.scrollTop = contextScroll;
    content.scrollTop = stackedScroll;
  }

  return {
    root,
    show(target: WorkspaceRow | null, force = false): void {
      if (!target) {
        ++requestRevision; row = null; detail = undefined; draft = null; baseline = null; dirty = false; flagFix = null; analyticsNotice = undefined;
        content.classList.remove('is-wide');
        if (mode !== 'read') { mode = 'read'; notifyState(); }
        content.replaceChildren();
        return;
      }
      if (row?.id !== target.id) status.textContent = '';
      void load(target, force);
    },
    currentId: (): string | null => row?.id ?? null,
    /** The reader's part of the workspace URL, for the current question. */
    urlState: (): { mode: ReaderMode; flagVersionId?: string; analyticsVersionId?: string } => ({
      mode,
      ...(flagFix ? { flagVersionId: flagFix.versionId } : pendingFlagVersionId ? { flagVersionId: pendingFlagVersionId } : {}),
      ...(analyticsNotice ? { analyticsVersionId: analyticsNotice.versionId } : {}),
    }),
    /** Unsaved edits, an unsaved alternative, or a write in progress. */
    isLocked: (): boolean => busy || dirty || (mode === 'compare' && !!compare?.hasVariant()),
    setNotice(message: string): void { status.textContent = message; },
  };
}
