import type { AttemptResult, CourseHomeLo, PracticeMode, PracticeQuestion } from '../../api.js';
import { el } from '../../dom.js';
import { PracticeSession } from '../../practice-session.js';
import type { RouteParams } from '../../router.js';
import { learningApi, type LearningLibrary } from '../../student-learning-api.js';
import { emptyState, errorState, loadingState } from '../../ui.js';
import { maybeStartStudentTutorial } from '../../tutorials.js';
import type { StudentExperience } from './experience.js';
import { button, dialog, questionTile, rich } from './learning-workspace.js';
import { renderLearningSummary } from './learning-summary.js';

interface QuestionEntry {
  kind: 'question'; question: PracticeQuestion; lo: CourseHomeLo; session: PracticeSession;
  selected?: string; result?: AttemptResult; skipped: boolean; isRetry: boolean;
}
interface RoundEntry {
  kind: 'round'; lo: CourseHomeLo; number: number; session: PracticeSession;
}
type Entry = QuestionEntry | RoundEntry;

/** The Topic Practice engine keeps its existing serving, retry and mastery APIs.
 * Only its presentation shares the finite lesson's question workspace. */
export async function renderTopicPracticeWorkspace(
  outlet: HTMLElement, params: RouteParams, experience: StudentExperience,
  library: LearningLibrary, mode: PracticeMode = 'topic-practice',
): Promise<void> {
  const courseId = params.id;
  const api = learningApi(courseId, experience.preview);
  const root = el('div', { class: 'learning-workspace topic-practice-workspace' });
  outlet.append(root);
  root.append(loadingState('Loading practice…'));
  try {
    const home = await experience.getHome(courseId);
    if (!root.isConnected) return;
    const group = home.find(g => params.themeId ? g.theme._id === params.themeId : g.los.some(l => l.lo._id === params.loId));
    const los = group?.los.filter(l => params.themeId || l.lo._id === params.loId).sort((a, b) => a.lo.order - b.lo.order) ?? [];
    if (!group || !los.length) {
      root.replaceChildren(emptyState('This learning objective is not available to practice.'));
      return;
    }
    let loIndex = Math.max(0, los.findIndex(l => l.status !== 'covered'));
    let session = new PracticeSession();
    let roundNumber = 1;
    const entries: Entry[] = [];
    const saved = new Set(library.questions.filter(q => q.saved).map(q => q.questionId));
    let cursor = 0;
    let busy = false;
    let submitting = false;
    let drawnEntry: Entry | undefined;
    const errors = el('div', { class: 'topic-practice-errors', role: 'status', 'aria-live': 'polite' });
    const status = (entry: QuestionEntry) => entry.result ? entry.result.correct ? 'Correct' : 'Needs review' : entry.skipped ? 'Skipped' : 'Not answered';

    const request = async (action: () => Promise<void>, submitAction = false) => {
      if (busy || !root.isConnected) return;
      busy = true; submitting = submitAction; errors.replaceChildren(); draw();
      try { await action(); }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.replaceChildren(errorState(message === 'no-question-available'
          ? 'No student-ready Approved questions are available for this learning objective.' : message));
      } finally { busy = false; submitting = false; if (root.isConnected) draw(); }
    };
    const visit = (index: number) => {
      if (busy) return;
      const previous = entries[cursor];
      if (previous?.kind === 'question' && !previous.result && index !== cursor) previous.skipped = true;
      cursor = index; draw();
    };
    const load = async () => {
      const lo = los[loIndex];
      const question = await experience.getNextQuestion(courseId, { loId: lo.lo._id, sessionServedIds: session.sessionServedIds });
      if (!root.isConnected) return;
      if (session.hasServed(question.questionId)) {
        entries.push({ kind: 'round', lo, number: roundNumber, session });
      } else {
        session.recordServed(question);
        entries.push({ kind: 'question', question, lo, session, skipped: false, isRetry: false });
      }
      cursor = entries.length - 1;
    };
    const next = async () => {
      if (busy) return;
      if (cursor < entries.length - 1) { visit(cursor + 1); return; }
      const entry = entries[cursor];
      if (entry?.kind === 'round') return;
      await request(async () => {
        const retry = entry?.result?.feedback.retry;
        if (retry) {
          const question: PracticeQuestion = { ...retry, difficulty: entry.question.difficulty, watermark: entry.question.watermark, degraded: 'none' };
          entry.session.recordServed(question);
          entries.push({ kind: 'question', question, lo: entry.lo, session: entry.session, skipped: false, isRetry: true });
          cursor++;
        } else {
          await load();
        }
        // A failed next-question request must leave the current draft editable.
        if (entry?.kind === 'question' && !entry.result) entry.skipped = true;
      });
    };
    const advance = () => request(async () => {
      if (cursor < entries.length - 1) { cursor++; return; }
      if (loIndex + 1 < los.length) {
        const previousSession = session, previousRound = roundNumber;
        loIndex++; session = new PracticeSession(); roundNumber = 1;
        try { await load(); } catch (error) { loIndex--; session = previousSession; roundNumber = previousRound; throw error; }
      }
      else window.location.hash = experience.routes.theme(courseId, group.theme._id).replace(/^#/, '');
    });
    const submit = () => request(async () => {
      const entry = entries[cursor];
      if (entry?.kind !== 'question' || !entry.selected || entry.result) return;
      const result = await experience.submit(courseId, {
        questionVersionId: entry.question.questionVersionId, loId: entry.lo.lo._id,
        selectedKey: entry.selected, mode, sessionServedIds: entry.session.sessionServedIds,
        ...(entry.isRetry ? { isRetry: true } : {}), ...(entry.question.paramValues ? { paramValues: entry.question.paramValues } : {}),
      });
      entry.result = result; entry.lo.status = result.mastery.loStatus;
      entry.session.recordAttempt({ question: entry.question, selectedKey: entry.selected, result, loId: entry.lo.lo._id });
      // A skipped question answered after revisiting can still have a gated retry.
      // Insert it directly after its parent; never reveal the withheld answers.
      if (result.feedback.retry && cursor < entries.length - 1) {
        const question: PracticeQuestion = { ...result.feedback.retry, difficulty: entry.question.difficulty, watermark: entry.question.watermark, degraded: 'none' };
        entry.session.recordServed(question);
        entries.splice(cursor + 1, 0, { kind: 'question', question, lo: entry.lo, session: entry.session, skipped: false, isRetry: true });
      }
    }, true);
    const board = () => {
      const popup = dialog('Question board', el('div', { class: 'learning-board-grid' }, ...entries.map((entry, index) =>
        questionTile(index + 1, entry.kind === 'question' ? status(entry) : 'Summary', entry.kind === 'question' ? entry.question.stem : `Round ${entry.number} summary`, () => { popup.close(); visit(index); }))));
    };
    const report = (entry: QuestionEntry) => {
      const text = el('textarea', { class: 'input', rows: 4, maxlength: 500, 'aria-label': 'Describe the problem', placeholder: 'What is wrong with this question?' });
      const feedback = el('div', { role: 'status' });
      let sending = false;
      const popup = dialog('Report a problem', el('div', { class: 'stack' }, text, feedback, button('Submit report', async () => {
        if (sending) return; sending = true;
        try {
          const result = await experience.flag(courseId, entry.question.questionId, text.value.trim() || undefined);
          popup.close(); errors.textContent = result.duplicate ? 'A report for this question is already pending.' : 'Problem reported.';
        } catch (error) { feedback.replaceChildren(errorState((error as Error).message)); }
        finally { sending = false; }
      }, 'btn btn--instr-primary')));
    };
    const tools = (entry: QuestionEntry | undefined) => {
      if (!entry) return el('div', { class: 'learning-tools' });
      const bookmarked = saved.has(entry.question.questionId);
      return el('div', { class: 'learning-tools' }, el('button', {
        class: `btn btn--ghost learning-icon${bookmarked ? ' is-saved' : ''}`, type: 'button', disabled: busy,
        title: bookmarked ? 'Remove bookmark' : 'Save to Review Book', 'aria-label': bookmarked ? 'Remove bookmark' : 'Save to Review Book', 'aria-pressed': String(bookmarked),
        html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
        onclick: () => request(async () => { await api.metadata(entry.question.questionId, { saved: !bookmarked }); if (bookmarked) saved.delete(entry.question.questionId); else saved.add(entry.question.questionId); }),
      }), el('button', {
        class: 'btn btn--ghost learning-icon', type: 'button', disabled: busy, title: 'Report a problem', 'aria-label': 'Report a problem',
        html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5m0 3v1"/></svg>', onclick: () => report(entry),
      }));
    };
    const draw = () => {
      if (!root.isConnected) return;
      const entry = entries[cursor];
      const same = entry === drawnEntry;
      const scroll = same ? root.querySelector('.learning-question-body')?.scrollTop ?? 0 : 0;
      const active = document.activeElement instanceof HTMLElement && root.contains(document.activeElement) ? document.activeElement.dataset.control : undefined;
      root.classList.remove('is-summary');
      if (entry?.kind === 'round') {
        const round = entries.flatMap((item, index) => item.kind === 'question' && item.session === entry.session ? [{ item, index }] : []);
        const missing = round.find(q => !q.item.result);
        const repeat = button('Continue with repeats', () => request(async () => {
          if (cursor < entries.length - 1) { cursor++; return; }
          const previousSession = session;
          session = new PracticeSession(); roundNumber++;
          try { await load(); } catch (error) { session = previousSession; roundNumber--; throw error; }
        })); repeat.disabled = busy || cursor < entries.length - 1;
        const finish = button(params.themeId ? 'Finish this LO' : 'Back to topic', advance); finish.disabled = busy || cursor < entries.length - 1;
        const previous = button('← Previous question', () => visit(cursor - 1)); previous.disabled = busy || cursor === 0;
        const primary = missing ? button('Return to unanswered questions', () => visit(missing.index), 'btn btn--instr-primary') : finish;
        if (!missing) finish.className = 'btn btn--instr-primary btn--sm';
        renderLearningSummary(root, {
          title: 'Practice summary', context: `Round ${entry.number} · ${entry.lo.lo.name}`, errors,
          questions: round.map(({ item, index }) => ({ title: item.question.stem, loName: item.lo.lo.name, status: item.result ? item.result.correct ? 'correct' : 'incorrect' : item.skipped ? 'skipped' : 'unanswered', open: () => visit(index) })),
          footer: el('footer', { class: 'learning-footer' }, el('div', { class: 'learning-tools' }, repeat),
            el('div', { class: 'learning-navigation' }, previous, ...(missing ? [finish] : []), primary)),
        });
        drawnEntry = entry; return;
      }
      const list = el('div', { class: 'learning-list' }, ...entries.map((item, index) => el('button', {
        type: 'button', disabled: busy, class: `learning-list-item${index === cursor ? ' is-active' : ''}`, 'aria-current': index === cursor ? 'step' : undefined,
        'data-control': `entry-${index}`, onclick: () => visit(index),
      }, el('small', { text: item.kind === 'question' ? `${String(index + 1).padStart(2, '0')} · ${status(item)}` : `Round ${item.number} complete` }),
      el('strong', { text: item.kind === 'question' ? item.question.stem.replace(/[#*_]/g, '').slice(0, 90) : 'Round summary' }), el('small', { text: item.lo.lo.name }))));
      const rail = el('aside', { class: 'learning-rail' }, el('h2', { class: 'eyebrow', text: 'Your practice' }), list,
        el('div', { class: 'learning-board-entry' }, button(`▦ Question board · ${entries.filter(e => e.kind === 'question').length}`, board)));
      const body = el('div', { class: 'learning-question-body', 'data-tutorial': 'practice-question', tabindex: -1 });
      if (entry?.kind === 'question') {
        const q = entry.question;
        body.append(el('h1', { class: 'sr-only', text: entry.lo.lo.name }), el('p', { class: 'eyebrow', text: `Question ${cursor + 1} · ${q.difficulty}${entry.isRetry ? ' · Follow-up' : ''}` }), rich(q.stem, 'learning-stem'));
        if (q.watermark) body.append(el('small', { class: 'muted', text: q.watermark }));
        body.append(el('div', { class: 'learning-options' }, ...q.options.map(option => {
          const reveal = entry.result?.feedback.revealed.find(r => r.key === option.key);
          return el('button', {
            class: `learning-option${entry.selected === option.key ? ' is-selected' : ''}${reveal?.correct ? ' is-correct' : ''}`, type: 'button', disabled: busy || !!entry.result,
            'aria-pressed': String(entry.selected === option.key), 'data-control': `option-${option.key}`, onclick: () => { entry.selected = option.key; draw(); },
          }, el('span', { class: 'mono', text: option.key }), rich(option.text), reveal ? rich(reveal.explanation, 'learning-explanation') : false);
        })));
        if (entry.result) {
          body.append(el('div', { class: 'learning-feedback', role: 'status', text: entry.result.correct ? 'Correct! Continue when you are ready.' : entry.result.feedback.retry ? 'Review your answer, then continue to the follow-up question.' : 'Review the explanation, then continue to the next question.' }));
          if (entry.result.mastery.recommendation && !entry.result.feedback.retry && cursor === entries.length - 1) body.append(el('div', { class: 'learning-feedback' },
            el('p', { text: 'You have covered this learning objective.' }), button(params.themeId && loIndex + 1 < los.length ? 'Advance to next LO' : 'Back to topic', advance)));
        } else if (entry.skipped) body.append(el('p', { class: 'muted', text: 'You skipped this question. You can answer it now.' }));
      } else {
        body.append(loadingState('Loading question…'));
        if (!busy) body.append(button('Try again', () => request(load)));
      }
      const previous = button('← Previous question', () => visit(cursor - 1)); previous.dataset.control = 'previous'; previous.disabled = busy || cursor === 0;
      const forward = button('Next question →', next); forward.dataset.control = 'next'; forward.disabled = busy || !entry;
      const submitButton = el('button', { class: 'btn btn--instr-primary', type: 'button', 'data-control': 'submit', disabled: busy || entry?.kind !== 'question' || !!entry.result || !entry.selected, busy: submitting, text: 'Submit', onclick: submit });
      const pane = el('section', { class: 'learning-pane' }, body, errors,
        el('footer', { class: 'learning-footer', 'data-tutorial': 'practice-actions' }, tools(entry?.kind === 'question' ? entry : undefined), el('div', { class: 'learning-navigation' }, previous, forward, submitButton)));
      const answered = entries.filter(e => e.kind === 'question' && e.result).length;
      const inspector = el('aside', { class: 'learning-inspector' }, el('p', { class: 'eyebrow', text: 'Progress' }),
        el('strong', { class: 'learning-progress', text: String(answered) }), el('p', { class: 'muted', text: 'questions answered' }), el('hr'),
        el('strong', { text: entry?.lo.lo.name ?? los[loIndex].lo.name }), el('p', { class: 'muted', text: group.theme.name }));
      if (entry?.kind === 'question' && entry.result?.redirect) {
        inspector.append(el('hr'), el('strong', { text: 'Suggested review' }), el('p', { text: entry.result.redirect.message }),
          ...entry.result.redirect.materials.map(material => el('p', {}, el('a', { href: experience.materialHref(courseId, entry.lo.lo._id, material.materialId), target: '_blank', rel: 'noopener noreferrer', text: material.name }))));
      }
      root.replaceChildren(rail, pane, inspector); body.scrollTop = scroll; drawnEntry = entry;
      if (active) Array.from(root.querySelectorAll<HTMLElement>('[data-control]')).find(node => node.dataset.control === active)?.focus({ preventScroll: true });
    };
    await request(load);
    if (!experience.preview && root.isConnected) maybeStartStudentTutorial('student-practice', { root });
  } catch (error) {
    if (root.isConnected) root.replaceChildren(errorState((error as Error).message));
  }
}
