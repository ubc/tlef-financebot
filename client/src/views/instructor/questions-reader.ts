// Reader for the Questions workspace: the selected question, its review
// context, and the actions its state allows (spec "Reader"). The flag card
// sits on top whenever the question has flags. Adapted from the retired
// review workbench (review-workbench.ts) and bank workbench.
import {
  ApiError,
  editQuestion,
  getQuestion,
  transitionQuestion,
  type CourseTree,
  type PublicationState,
  type QuestionDetail,
  type QuestionWorkspace,
  type WorkspaceRow,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { statusBadge } from '../../instructor-ui.js';
import { confirmDialog, textPromptDialog } from '../../modal.js';
import { STATUS_LABEL, TYPE_LABEL, statusToBadgeVariant } from '../../question-labels.js';
import { renderRichText } from '../../render.js';
import { protectUnsavedChanges } from '../../router.js';
import { errorState, loadingState } from '../../ui.js';
import { createFlagCard } from './questions-flag-card.js';
import { heldTopicNames, hiddenReasonText, objectiveNames, repairSummary, solverSummary, topicNames } from './questions-model.js';

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
}

const errorText = (error: unknown): string => error instanceof ApiError ? error.message : error instanceof Error ? error.message : String(error);

function rich(text: string, className = ''): HTMLElement {
  const node = el('div', { class: className });
  renderRichText(node, text);
  return node;
}

const REVIEW_STATES: ReadonlySet<PublicationState> = new Set(['draft', 'pending-review', 'reviewed']);

export function createQuestionReader(options: ReaderOptions) {
  const status = el('p', { class: 'questions-reader__notice', role: 'status' });
  const content = el('div', { class: 'questions-reader__content' });
  const root = el('article', { class: 'questions-reader', 'aria-label': 'Selected question' }, status, content);
  const coursePath = `/instructor/course/${encodeURIComponent(options.courseId)}`;
  let row: WorkspaceRow | null = null;
  let detail: QuestionDetail | undefined;
  /** One per loaded question, so redraws do not refetch its flags. */
  let flagCard: ReturnType<typeof createFlagCard> | undefined;
  let requestRevision = 0;
  let busy = false;
  let editing = false;
  let dirty = false;
  const rejectionDrafts = new Map<string, string>();
  protectUnsavedChanges(root, () => dirty, () => confirmDialog({ title: 'Discard unsaved edits?', message: 'Your saved question will be kept.', confirmLabel: 'Discard edits' }));

  const locked = (): boolean => busy || options.isBatchBusy();

  async function load(target: WorkspaceRow, force = false): Promise<void> {
    if (!force && row?.id === target.id && detail) { row = target; draw(); return; }
    row = target; detail = undefined; flagCard = undefined; editing = false; dirty = false;
    const revision = ++requestRevision;
    mount(content, loadingState('Loading question…'));
    try {
      const result = await getQuestion(target.id);
      if (revision !== requestRevision || !root.isConnected) return;
      detail = result;
      flagCard = createFlagCard({
        courseId: options.courseId,
        questionId: result.id,
        highlightFlagId: options.highlightFlagId,
        onChanged: () => { void options.onMutated('Flag resolved.', result.id); },
      });
      void flagCard.load();
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

  function editor(current: QuestionDetail): { nodes: HTMLElement[]; save: () => Promise<void> } {
    const stem = el('textarea', { class: 'input', rows: '4', 'aria-label': 'Question stem' }, current.current.stem) as HTMLTextAreaElement;
    stem.addEventListener('input', () => { dirty = true; });
    const draftOptions = current.current.options.map((option) => ({ ...option }));
    const fields = current.current.options.map((option, i) => el('section', { class: 'questions-reader__edit-option' },
      el('label', {}, `Option ${option.key} · ${option.role.replace(/-/g, ' ')}`,
        el('textarea', { class: 'input', rows: '2', 'aria-label': `Option ${option.key}`, oninput: (e: Event) => { draftOptions[i].text = (e.target as HTMLTextAreaElement).value; dirty = true; } }, option.text)),
      el('label', {}, 'Explanation',
        el('textarea', { class: 'input', rows: '2', 'aria-label': `Explanation ${option.key}`, oninput: (e: Event) => { draftOptions[i].explanation = (e.target as HTMLTextAreaElement).value; dirty = true; } }, option.explanation))));
    const returnsToReview = current.state === 'approved' || current.state === 'paused';
    const nodes = [
      returnsToReview ? el('p', { class: 'questions-reader__warning', text: 'Saving returns this question to To review: it leaves student practice until you approve it again.' }) : el('span'),
      el('label', { class: 'questions-reader__edit-stem' }, 'Question stem', stem),
      ...fields,
    ];
    const save = async (): Promise<void> => {
      if (busy) return;
      busy = true;
      root.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>('button, textarea').forEach((control) => { control.disabled = true; });
      try {
        await editQuestion(current.id, { stem: stem.value, options: draftOptions, expectedVersionId: current.currentVersionId });
        dirty = false; editing = false; busy = false;
        await options.onMutated(returnsToReview ? 'Changes saved. The question is back in To review.' : 'Changes saved. Review the updated question before approving.', current.id);
        if (row?.id === current.id) await load(row, true);
      } catch (error) {
        busy = false;
        if (error instanceof ApiError && error.status === 409) {
          status.textContent = 'This question changed since you opened it. Your edits were not saved; copy anything you need, then reload.';
        } else {
          status.textContent = `${errorText(error)} Your edits were not saved.`;
        }
        root.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>('button, textarea').forEach((control) => { control.disabled = false; });
      }
    };
    return { nodes, save };
  }

  function actionButtons(current: QuestionDetail, save?: () => Promise<void>): HTMLElement[] {
    const disabled = locked();
    const btn = (label: string, onclick: () => void, primary = false): HTMLElement =>
      el('button', { class: `btn ${primary ? 'btn--instr-primary' : 'btn--ghost'} btn--sm`, type: 'button', disabled, onclick }, label);
    const startEdit = (): void => { editing = true; draw(); root.querySelector('textarea')?.focus(); };
    if (editing) {
      return [
        btn('Cancel editing', () => { editing = false; dirty = false; draw(); }),
        el('button', { class: 'btn btn--instr-primary btn--sm', type: 'button', disabled: busy, onclick: () => { void save?.(); } }, busy ? 'Saving…' : 'Save changes'),
      ];
    }
    if (REVIEW_STATES.has(current.state)) {
      return [
        btn('Edit', startEdit),
        btn('Reject', () => { void reject(); }),
        btn(busy ? 'Saving decision…' : 'Approve', () => { void transition('approved', 'Question approved.'); }, true),
      ];
    }
    switch (current.state) {
      case 'approved': return [btn('Edit', startEdit), btn('Archive', () => { void archive(); }), btn('Pause', () => { void pause(); }, true)];
      case 'paused': return [btn('Edit', startEdit), btn('Archive', () => { void archive(); }), btn('Resume', () => { void transition('approved', 'Question resumed.'); }, true)];
      default: return [btn('Restore to review', () => { void restore(); }, true)];
    }
  }

  function draw(): void {
    if (!detail || !row) return;
    const current = detail;
    const listRow = row;
    // A stable list sample belongs to one version; never mix it with a newer answer key.
    const sample = listRow.current._id === current.current._id ? listRow.sample : undefined;
    const parameterized = !!(current.current.paramSlots?.length || current.current.generateScript || current.current.derivedValues?.length);
    const body = el('div', { class: 'questions-reader__body' });
    let save: (() => Promise<void>) | undefined;
    body.append(
      el('div', { class: 'questions-reader__meta' },
        statusBadge(STATUS_LABEL[current.state], statusToBadgeVariant(current.state)),
        el('span', { text: `${TYPE_LABEL[current.current.type]} · ${current.current.difficulty} · Version ${current.currentVersion}` })),
      el('p', { class: 'questions-reader__tags', text: [topicNames(options.tree, current.themeIds).join(', ') || 'No Topic', objectiveNames(options.tree, current.loIds).join(' · ') || 'No learning objective assigned'].join(' — ') }));
    if (editing) {
      const edit = editor(current);
      save = edit.save;
      body.append(...edit.nodes);
    } else {
      if (current.current.unresolvablePlaceholders?.length) {
        body.append(el('p', { class: 'questions-reader__warning', role: 'status', text: `Unresolved placeholders keep this question from students: ${current.current.unresolvablePlaceholders.join(', ')}. Fix them in the full details.` }));
      }
      if (parameterized) body.append(el('p', { class: 'questions-reader__sample-note', text: sample ? 'One computed sample — students may receive different values.' : 'Template preview. Open full details to draw and verify sample values.' }));
      body.append(rich(sample?.stem ?? current.current.stem, 'questions-reader__stem'),
        el('div', { class: 'questions-reader__answers' }, ...current.current.options.map((option) => {
          const drawn = sample?.options.find((value) => value.key === option.key);
          const correct = option.role === 'correct';
          return el('section', { class: `questions-reader__answer${correct ? ' is-correct' : ''}`, 'aria-label': `Option ${option.key}${correct ? ', correct answer' : ''}` },
            el('span', { class: 'questions-reader__key', text: option.key }),
            el('div', {}, correct ? el('span', { class: 'questions-reader__correct', text: 'Correct answer' }) : false,
              rich(drawn?.text ?? option.text), rich(drawn?.explanation ?? option.explanation, 'questions-reader__explanation')));
        })));
    }

    const decision = current.agentDecision;
    const held = heldTopicNames(options.release(), current.themeIds);
    const similarity = listRow.similarity;
    const similarityLink = (label: string, link: { questionId: string; score: number } | null): HTMLElement | false => link
      ? el('li', {}, el('button', { class: 'link-button', type: 'button', onclick: () => options.onOpenQuestion(link.questionId) }, `${label} · ${link.score.toFixed(2)}`))
      : false;
    const suggestions = current.suggestions ?? [];
    const context = el('div', { class: 'questions-reader__context' },
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
          : listRow.hiddenReason === 'course-unpublished' ? el('a', { href: `#${coursePath}`, text: 'Publish from the Dashboard →' }) : false),
      suggestions.length ? el('details', {}, el('summary', { text: `TA suggested edits · ${suggestions.length}` }),
        el('p', { text: 'Review and apply them in full details.' }), el('a', { href: `#${coursePath}/bank/${encodeURIComponent(current.id)}?from=questions`, text: 'Open full details ↗' })) : false,
      current.internalNotes?.length ? el('details', {}, el('summary', { text: `Teaching-team notes · ${current.internalNotes.length}` }),
        ...current.internalNotes.map((note) => el('p', { text: `${note.text} — ${new Date(note.at).toLocaleDateString()}` }))) : false);

    const links = el('div', { class: 'questions-reader__links' },
      current.state !== 'archived' ? el('a', { href: `#${coursePath}/bank/${encodeURIComponent(current.id)}/collaborate`, text: 'Edit together' }) : false,
      REVIEW_STATES.has(current.state) ? el('a', { href: `#${coursePath}/bank/${encodeURIComponent(current.id)}?from=questions&intent=regenerate`, text: 'Regenerate side by side' }) : false,
      el('a', { href: `#${coursePath}/bank/${encodeURIComponent(current.id)}?from=questions`, text: 'Open full details ↗' }),
      el('button', { class: 'link-button', type: 'button', disabled: busy, onclick: () => { if (row) void load(row, true); } }, 'Reload'));

    mount(content,
      el('button', { class: 'btn btn--ghost btn--sm questions-reader__back', type: 'button', onclick: options.onBack }, '← Back to list'),
      flagCard?.root ?? false,
      body,
      el('footer', { class: 'questions-reader__actions' }, links, el('div', { class: 'questions-reader__buttons' }, ...actionButtons(current, save))),
      context);
  }

  return {
    root,
    show(target: WorkspaceRow | null, force = false): void {
      if (!target) {
        ++requestRevision; row = null; detail = undefined; editing = false; dirty = false;
        content.replaceChildren();
        return;
      }
      if (row?.id !== target.id) status.textContent = '';
      void load(target, force);
    },
    currentId: (): string | null => row?.id ?? null,
    isLocked: (): boolean => busy || editing,
    setNotice(message: string): void { status.textContent = message; },
  };
}
