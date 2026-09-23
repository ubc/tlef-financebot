import { ApiError, editQuestion, getQuestion, transitionQuestion, type CourseTree, type QuestionDetail, type ReviewQueueItem } from '../../api.js';
import { el, mount } from '../../dom.js';
import { confirmDialog, textPromptDialog } from '../../modal.js';
import { protectUnsavedChanges } from '../../router.js';
import { rowStemText } from '../../placeholders.js';
import { renderRichText } from '../../render.js';
import { errorState, loadingState } from '../../ui.js';
import { heldBackTopics, TYPE_LABEL } from './bank.js';

interface WorkbenchOptions {
  courseId: string;
  tree: CourseTree;
  selected: Set<string>;
  onSelection: () => void;
  onDecision: (id: string) => void;
  onDetail: (detail: QuestionDetail) => void;
  isBatchBusy?: () => boolean;
  preferredId?: string;
  onClearFilters: () => void;
}

const message = (error: unknown): string => error instanceof ApiError ? error.message : String(error instanceof Error ? error.message : error);
function rich(text: string, className = ''): HTMLElement {
  const node = el('div', { class: className });
  renderRichText(node, text);
  return node;
}

/** Owns the active reader independently of filter/agent-list redraws. */
export function createReviewWorkbench(options: WorkbenchOptions) {
  const list = el('div', { class: 'review-workbench__list' });
  const listTitle = el('div', { class: 'review-workbench__list-title', text: 'QUESTIONS' });
  const listFooter = el('div', { class: 'review-workbench__list-footer' });
  const reader = el('article', { class: 'review-workbench__reader', 'aria-label': 'Question review' });
  const inspector = el('aside', { class: 'review-workbench__inspector', 'aria-label': 'Review context' });
  const status = el('p', { class: 'review-workbench__notice', role: 'status' });
  const node = el('section', { class: 'review-workbench', 'data-tutorial': 'review-actions' },
    el('nav', { class: 'review-workbench__queue', 'aria-label': 'Question queue' },
      listTitle, list, listFooter), reader, inspector);
  const empty = el('section', { class: 'review-empty', hidden: true, 'aria-labelledby': 'review-empty-title' });
  const root = el('div', { class: 'review-workbench-shell' }, status, node, empty);
  let rows: ReviewQueueItem[] = [];
  let activeId = '';
  let detail: QuestionDetail | undefined;
  let requestRevision = 0;
  let busy = false;
  let editing = false;
  let dirty = false;
  protectUnsavedChanges(root, () => dirty, () => confirmDialog({ title: 'Discard unsaved edits?', message: 'Your saved question will be kept.', confirmLabel: 'Discard edits' }));
  let totalAvailable = 0;
  const agentStates = new Map<string, string>();
  const completed = new Map<string, { label: string; state: string }>();
  const rejectionDrafts = new Map<string, string>();

  const filtered = () => rows;
  function topicNames(item: ReviewQueueItem | QuestionDetail): string[] {
    return options.tree.themes.filter(theme => item.themeIds.includes(theme._id)).map(theme => theme.name);
  }
  function objectiveNames(item: ReviewQueueItem | QuestionDetail): string[] {
    return options.tree.themes.flatMap(theme => (theme.los ?? []).filter(lo => item.loIds.includes(lo._id)).map(lo => lo.name));
  }
  function stateText(item: ReviewQueueItem): string {
    if (item.labels.includes('student-flagged')) return 'Student flagged';
    const decision = agentStates.get(item.id);
    return decision === 'flag' ? 'Needs attention' : decision === 'reject' ? 'AI recommends rejection' : decision === 'pass' ? 'AI checks passed' : 'Awaiting review';
  }
  function drawList(): void {
    const top = list.scrollTop;
    const visible = filtered();
    listTitle.textContent = `QUESTIONS · ${visible.length}`;
    mount(list, ...visible.map((item, index) => {
      const checkbox = el('input', { type: 'checkbox', 'aria-label': `Select question ${index + 1}`, checked: options.selected.has(item.id), disabled: busy || options.isBatchBusy?.(),
        onchange: () => { if (checkbox.checked) options.selected.add(item.id); else options.selected.delete(item.id); options.onSelection(); } });
      const preview = rich(rowStemText(item), 'review-workbench__row-title');
      preview.title = rowStemText(item);
      const topics = topicNames(item);
      const objectives = objectiveNames(item);
      const tags = el('span', { class: 'review-workbench__row-tags' },
        topics.length ? el('span', { class: 'review-workbench__row-tag is-topic', text: topics[0], title: topics.join(' · ') }) : false,
        objectives.length ? el('span', { class: 'review-workbench__row-tag is-objective', text: objectives[0], title: objectives.join(' · ') })
          : el('span', { class: 'review-workbench__row-tag is-missing', text: 'No LO assigned' }),
        objectives.length > 1 ? el('span', { class: 'review-workbench__row-tag is-more', text: `+${objectives.length - 1} LO`, title: objectives.slice(1).join(' · ') }) : false);
      return el('div', { class: `review-workbench__row${activeId === item.id ? ' is-current' : ''}${options.selected.has(item.id) ? ' is-selected' : ''}` }, checkbox,
        el('button', { type: 'button', 'aria-current': activeId === item.id ? 'true' : 'false', disabled: busy || options.isBatchBusy?.(),
          onclick: () => selectQuestion(item.id) },
          el('span', { class: 'review-workbench__row-meta' }, `${String(index + 1).padStart(2, '0')} · ${item.current.difficulty} · ${TYPE_LABEL[item.current.type]}`,
            activeId === item.id ? el('b', { class: 'review-workbench__viewing', text: 'Viewing' }) : false),
          preview,
          tags,
          el('span', { class: `review-workbench__row-status${item.labels.includes('student-flagged') || ['flag', 'reject'].includes(agentStates.get(item.id) ?? '') ? ' needs-attention' : ''}`, text: stateText(item) })));
    }), visible.length ? false : el('p', { class: 'muted', text: 'No matching questions.' }));
    list.scrollTop = top;
    mount(listFooter, el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: openBoard, disabled: busy }, `▦  Question board · ${visible.length}`));
  }
  async function selectQuestion(id: string, force = false): Promise<void> {
    if (busy || options.isBatchBusy?.() || (id === activeId && detail && !force)) return;
    if (dirty && !await confirmDialog({ title: 'Discard unsaved edits?', message: 'Your saved question will be kept.', confirmLabel: 'Discard edits' })) return;
    activeId = id; detail = undefined; editing = false; dirty = false;
    const revision = ++requestRevision;
    drawList(); mount(reader, loadingState('Loading question…')); inspector.replaceChildren();
    try {
      const result = await getQuestion(id);
      if (revision !== requestRevision || !root.isConnected) return;
      detail = result; agentStates.set(id, result.agentDecision?.decision ?? ''); options.onDetail(result);
      drawReader(); drawList();
    } catch (error) {
      if (revision === requestRevision && root.isConnected) mount(reader, errorState(message(error), () => { void selectQuestion(id, true); }));
    }
  }
  function openBoard(): void {
    const opener = document.activeElement as HTMLElement | null;
    const dialog = el('dialog', { class: 'app-dialog review-question-board', 'aria-labelledby': 'question-board-title' });
    const close = () => { dialog.close(); dialog.remove(); opener?.focus(); };
    const visible = filtered();
    const squares = visible.map((item, index) => el('button', {
      class: `review-question-board__square${activeId === item.id ? ' is-current' : ''}${['flag', 'reject'].includes(agentStates.get(item.id) ?? '') || item.labels.includes('student-flagged') ? ' needs-attention' : ''}`,
      type: 'button', 'aria-current': activeId === item.id ? 'true' : 'false',
      'aria-label': `Question ${index + 1}: ${rowStemText(item)}. ${stateText(item)}`,
      title: rowStemText(item), onclick: async () => { close(); await selectQuestion(item.id); list.querySelector('.is-current')?.scrollIntoView({ block: 'nearest' }); },
    }, String(index + 1).padStart(2, '0')));
    dialog.append(el('div', { class: 'app-dialog__surface' },
      el('div', { class: 'review-question-board__heading' }, el('h2', { id: 'question-board-title', text: 'Question board' }), el('button', { class: 'btn btn--ghost btn--sm', 'aria-label': 'Close question board', onclick: close }, '×')),
      el('p', { class: 'muted', text: `${visible.length} questions in your current filters. Choose a number to jump.` }),
      el('div', { class: 'review-question-board__grid' }, ...squares),
      el('p', { class: 'muted', text: 'Outlined: current question · Amber: needs attention' }),
      completed.size ? el('details', {}, el('summary', { text: `${completed.size} reviewed this visit` }), ...[...completed.values()].map(item => el('div', { class: 'review-question-board__completed' }, el('strong', { text: `${item.state} · ` }), rich(item.label)))) : false));
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); } });
    document.body.append(dialog); dialog.showModal();
    const observer = new MutationObserver(() => { if (!root.isConnected) { close(); observer.disconnect(); } });
    observer.observe(document.body, { childList: true, subtree: true });
    dialog.addEventListener('close', () => observer.disconnect(), { once: true });
  }
  async function decide(to: 'approved' | 'archived'): Promise<void> {
    if (!detail || busy || options.isBatchBusy?.()) return;
    const snapshot = detail;
    let reason: string | undefined;
    if (to === 'archived') {
      const value = await textPromptDialog({ title: 'Reject this question?', message: 'The question will be archived. You can restore it from Question Bank. Your note is visible only to the teaching team.', fieldLabel: 'Reason for rejecting (optional)', placeholder: 'What should be improved?', confirmLabel: 'Reject question', cancelLabel: 'Keep reviewing', tone: 'danger', initialValue: rejectionDrafts.get(snapshot.id) ?? '' });
      if (value === null || !root.isConnected || activeId !== snapshot.id) return;
      reason = value; rejectionDrafts.set(snapshot.id, value);
    }
    busy = true; status.textContent = ''; drawReader(); drawList();
    try {
      await transitionQuestion(snapshot.id, to, snapshot.current._id, reason);
      completed.set(snapshot.id, { state: to === 'approved' ? 'Approved' : 'Rejected', label: snapshot.current.stem });
      rejectionDrafts.delete(snapshot.id);
      if (!root.isConnected) return;
      status.textContent = to === 'approved' ? 'Question approved. Student access still follows course and topic release settings.' : 'Question rejected and archived. Your note was saved with the decision.';
      detail = undefined; activeId = ''; busy = false;
      options.onDecision(snapshot.id);
    } catch (error) {
      if (root.isConnected) status.textContent = `${message(error)} Your decision was not confirmed. Reload the question before retrying; any rejection note is retained.`;
    } finally { busy = false; if (root.isConnected) { drawList(); if (detail) drawReader(); } }
  }
  function drawReader(): void {
    if (!detail) return;
    const current = detail;
    const item = rows.find(row => row.id === current.id);
    // Stable list samples belong to a specific version. Never combine a new
    // answer key with a sample drawn from an older version.
    const sample = item?.current._id === current.current._id ? item.sample : undefined;
    const parameterized = !!(current.current.paramSlots?.length || current.current.generateScript || current.current.derivedValues?.length);
    const body = el('div', { class: 'review-workbench__body', tabindex: '0', 'aria-label': 'Question content' },
      el('div', { class: 'review-workbench__metadata', text: `Question ${Math.max(1, filtered().findIndex(row => row.id === current.id) + 1)} of ${filtered().length} · ${TYPE_LABEL[current.current.type]} · ${current.current.difficulty} · ${current.state} · Version ${current.current.version}` }),
      el('p', { class: 'review-workbench__objective', text: objectiveNames(current).join(' · ') || 'No learning objective assigned' }));
    let saveEdits: (() => Promise<void>) | undefined;
    if (editing) {
      const stem = el('textarea', { class: 'input', rows: '4', 'aria-label': 'Question stem' }, current.current.stem);
      const draftOptions = current.current.options.map(option => ({ ...option }));
      const fields = current.current.options.map((option, i) => el('section', { class: 'review-workbench__edit-option' },
        el('label', {}, `Option ${option.key} · ${option.role}`, el('textarea', { class: 'input', rows: '2', 'aria-label': `Option ${option.key}`, oninput: (e: Event) => { draftOptions[i].text = (e.target as HTMLTextAreaElement).value; dirty = true; } }, option.text)),
        el('label', {}, 'Explanation', el('textarea', { class: 'input', rows: '2', 'aria-label': `Explanation ${option.key}`, oninput: (e: Event) => { draftOptions[i].explanation = (e.target as HTMLTextAreaElement).value; dirty = true; } }, option.explanation))));
      stem.addEventListener('input', () => { dirty = true; });
      body.append(el('label', {}, 'Question stem', stem), ...fields);
      saveEdits = async () => {
        if (busy) return;
        busy = true;
        const formControls = reader.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>('button, textarea');
        formControls.forEach(control => { control.disabled = true; });
        try {
          const version = await editQuestion(current.id, { stem: stem.value, options: draftOptions, expectedVersionId: current.currentVersionId });
          if (!root.isConnected || activeId !== current.id) return;
          detail = { ...current, current: version, currentVersionId: version._id };
          delete detail.agentDecision;
          agentStates.delete(current.id);
          options.onDetail(detail);
          const row = rows.find(row => row.id === current.id); if (row) { row.current = version; delete row.sample; }
          dirty = false; editing = false; status.textContent = 'Changes saved. Review the updated question before approving.';
          busy = false; drawReader(); drawList();
        } catch (error) { status.textContent = message(error); }
        finally { busy = false; formControls.forEach(control => { control.disabled = false; }); }
      };
    } else {
      if (current.current.unresolvablePlaceholders?.length) body.append(el('p', { class: 'review-workbench__sample-note', role: 'status', text: 'This question has unresolved placeholders and cannot be served to students. Fix these in the full editor: ' + current.current.unresolvablePlaceholders.join(', ') }));
      if (parameterized) body.append(el('p', { class: 'review-workbench__sample-note', text: sample ? 'One computed sample. Students may receive different values.' : 'Template preview. Open the full editor to draw and verify sample values.' }));
      body.append(rich(sample?.stem ?? current.current.stem, 'review-workbench__stem'),
        el('div', { class: 'review-workbench__answers' }, ...current.current.options.map(option => {
          const drawn = sample?.options.find(value => value.key === option.key);
          return el('section', { class: `review-workbench__answer${option.role === 'correct' ? ' is-correct' : ''}`, 'aria-label': `Option ${option.key}${option.role === 'correct' ? ', correct answer' : ''}` },
            el('span', { class: 'review-workbench__key', text: option.key }),
            el('div', {}, option.role === 'correct' ? el('span', { class: 'review-workbench__correct-label', text: 'Correct answer' }) : false,
              rich(drawn?.text ?? option.text), rich(drawn?.explanation ?? option.explanation, 'review-workbench__explanation')));
        })));
    }
    const actionBusy = busy || !!options.isBatchBusy?.();
    const buttons = editing
      ? [el('button', { class: 'btn btn--ghost btn--sm', disabled: busy, onclick: () => { editing = false; dirty = false; drawReader(); } }, 'Cancel editing'), el('button', { class: 'btn btn--instr-primary btn--sm', onclick: saveEdits }, 'Save changes')]
      : [el('button', { class: 'btn btn--ghost btn--sm', disabled: actionBusy, onclick: () => { editing = true; drawReader(); reader.querySelector('textarea')?.focus(); } }, 'Edit'),
        el('button', { class: 'btn btn--ghost btn--sm', disabled: actionBusy || current.state === 'archived', onclick: () => decide('archived') }, 'Reject'),
        el('button', { class: 'btn btn--instr-primary btn--sm', disabled: actionBusy || ['approved', 'archived'].includes(current.state), busy: actionBusy, onclick: () => decide('approved') }, actionBusy ? 'Saving decision…' : 'Approve')];
    mount(reader, body, el('footer', { class: 'review-workbench__actions' },
      el('button', { class: 'btn btn--ghost btn--sm', disabled: actionBusy, 'aria-label': 'Open question board', onclick: openBoard }, `▦ ${Math.max(1, filtered().findIndex(row => row.id === activeId) + 1)} / ${filtered().length}`),
      el('span', { class: 'review-workbench__spacer' }), ...buttons));
    const held = heldBackTopics(options.tree, current.themeIds);
    mount(inspector,
      el('h2', { text: 'Review context' }),
      el('section', {}, el('h3', { text: current.agentDecision ? `AI check · ${current.agentDecision.decision.toUpperCase()}` : 'AI check unavailable' }),
        current.agentDecision ? (current.agentDecision.reasoning.length > 280 ? el('div', {}, rich(current.agentDecision.reasoning.slice(0, 280).replace(/\s+\S*$/, '') + '…'), el('details', {}, el('summary', { text: 'Full AI assessment' }), rich(current.agentDecision.reasoning))) : rich(current.agentDecision.reasoning)) : el('p', { text: 'No AI review result was recorded for this question.' }),
        current.agentDecision?.roleAssessment ? el('details', {}, el('summary', { text: 'Answer structure' }), rich(current.agentDecision.roleAssessment)) : false),
      el('section', {}, el('h3', { text: 'Source evidence' }), current.current.sourceRefs.length ? el('div', {}, ...current.current.sourceRefs.map((ref, index) => el('details', {}, el('summary', { text: `Reference ${index + 1}` }), ref.chunk ? rich(ref.chunk) : el('p', { text: 'No excerpt recorded.' }), el('a', { href: `#/instructor/course/${encodeURIComponent(options.courseId)}/materials`, text: 'Open course materials ↗' })))) : el('p', { text: 'No source references recorded.' })),
      el('section', {}, el('h3', { text: 'Student availability' }), el('p', { text: held.length ? `Awaiting topic release: ${held.join(', ')}.` : 'Topic release dates are ready. Students receive approved questions when the course is published and validation checks pass.' })),
      current.internalNotes?.length ? el('details', {}, el('summary', { text: `Teaching-team notes (${current.internalNotes.length})` }), ...current.internalNotes.map(note => el('p', { text: note.text }))) : false,
      current.state !== 'archived' ? el('a', { class: 'btn btn--instr-primary btn--sm', href: `#/instructor/course/${encodeURIComponent(options.courseId)}/bank/${encodeURIComponent(current.id)}/collaborate`, text: 'Edit together' }) : false,
      el('a', { class: 'review-workbench__advanced', href: `#/instructor/course/${encodeURIComponent(options.courseId)}/bank/${encodeURIComponent(current.id)}?from=queue`, text: 'Open full editor ↗' }),
      el('button', { class: 'btn btn--ghost btn--sm', disabled: busy, onclick: () => selectQuestion(activeId, true) }, 'Reload question'));
  }
  return {
    root,
    isLocked: () => busy || editing,
    refresh() { drawList(); if (detail) drawReader(); },
    setAgent(id: string, decision?: string) { agentStates.set(id, decision ?? ''); },
    update(nextRows: ReviewQueueItem[], total = nextRows.length) {
      rows = nextRows; totalAvailable = total; drawList();
      const visible = filtered();
      const showEmpty = !visible.length && !busy && !editing;
      node.hidden = showEmpty;
      empty.hidden = !showEmpty;
      if (showEmpty) {
        const noMatches = totalAvailable > 0;
        const finished = !noMatches && completed.size > 0;
        const path = `/instructor/course/${encodeURIComponent(options.courseId)}`;
        mount(empty,
          el('div', { class: `review-empty__art${noMatches ? ' is-search' : ''}`, 'aria-hidden': 'true' },
            el('span', { class: 'review-empty__sheet review-empty__sheet--back' }),
            el('span', { class: 'review-empty__sheet' }, el('i', {}), el('i', {}), el('i', {})),
            el('span', { class: 'review-empty__seal', text: noMatches ? '⌕' : '✓' })),
          el('div', { class: 'review-empty__content' },
            el('p', { class: 'review-empty__eyebrow', text: noMatches ? 'REFINE YOUR SEARCH' : finished ? 'REVIEW COMPLETE' : 'YOUR REVIEW QUEUE' }),
            el('h2', { id: 'review-empty-title', text: noMatches ? 'No questions match' : finished ? 'You’re all caught up' : 'Nothing waiting for review' }),
            el('p', { class: 'review-empty__description', text: noMatches
              ? 'Try another keyword or clear your filters to see the rest of the queue.'
              : finished ? 'Your review decisions are saved. Visit your question bank to see what’s ready for your course.'
              : 'Newly generated and imported questions will appear here when they’re ready for your review.' }),
            el('div', { class: 'review-empty__actions' },
              noMatches ? el('button', { class: 'btn btn--instr-primary', onclick: options.onClearFilters }, 'Clear search & filters')
                : el('a', { class: 'btn btn--instr-primary', href: `#${path}/bank`, text: 'Open question bank →' }),
              noMatches ? false : el('a', { class: 'review-empty__secondary', href: `#${path}/preseeding`, text: 'Generate questions' })),
            noMatches ? el('p', { class: 'review-empty__footnote', text: `${totalAvailable} question${totalAvailable === 1 ? '' : 's'} still awaiting review.` })
              : el('p', { class: 'review-empty__footnote', text: 'Student access is managed through approval and course release settings.' })));
      }
      if (!visible.some(item => item.id === activeId) && !busy && !editing) {
        if (visible[0]) void selectQuestion(!activeId && options.preferredId && visible.some(item => item.id === options.preferredId) ? options.preferredId : visible[0].id);
        else { ++requestRevision; activeId = ''; detail = undefined; mount(reader, el('div', { class: 'review-workbench__body' }, el('h2', { text: 'You’re all caught up here' }), el('p', { text: 'No questions match the current filters.' }))); inspector.replaceChildren(); }
      }
    },
  };
}
