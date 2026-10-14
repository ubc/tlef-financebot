import { ApiError, type AssessmentSummary, type AssessmentState, type AssessmentResults, type AssessmentWindowReceipt } from '../../api.js';
import { LIVE_ASSESSMENT_EXPERIENCE, type AssessmentExperience } from '../../assessment-experience.js';
import { activateAssessmentWindow, assessmentWindowId, finishAssessmentWindow, isAssessmentWindowClosing, ownsAssessmentWindow, rememberAssessmentWindowClose, readAssessmentWindowClose, clearAssessmentWindowClose } from '../../assessment-window.js';
import { el, mount } from '../../dom.js';
import { renderRichText } from '../../render.js';
import { currentQuery, type RouteParams } from '../../router.js';
import { errorState, loadingState } from '../../ui.js';
import { pageHeader } from '../../instructor-ui.js';

interface PreviewAssessmentSummary extends AssessmentSummary {
  source?: 'published' | 'draft';
  canStart?: boolean;
  unavailableReason?: string;
}
interface PreviewAssessmentResults extends AssessmentResults {
  simulatedRelease?: boolean;
}

function previewNotice(experience: AssessmentExperience): HTMLElement | undefined {
  if (!experience.preview) return undefined;
  return el('details', { class: 'assessment-preview' }, el('summary', { text: 'Preview only' }), el('p', { text: experience.restricted
    ? 'Isolated student preview with access restrictions. Publication, availability and answer release follow the student rules. Preview answers stay out of student records.'
    : 'Isolated student preview without access restrictions. Rehearse ready drafts or exams outside their availability window and inspect answers after submission. Student availability and answer release remain as configured. Preview answers stay out of student records.' }));
}

export async function renderAssessments(outlet: HTMLElement, params: RouteParams, experience = LIVE_ASSESSMENT_EXPERIENCE): Promise<void> {
  const root = el('div', { class: 'view exam-builder eb-sitting assessment-view stack' }, loadingState('Loading assessments…')); mount(outlet, root);
  const requestedExamId = currentQuery().get('examId');
  try {
    const rows = await experience.request<PreviewAssessmentSummary[]>(params.id, 'assessments');
    if (!root.isConnected) return;
    root.replaceChildren(pageHeader('Assessments', experience.preview ? 'Try the course exams as an anonymous student.' : 'Published Midterms and Finals for this course.'),
      el('a', { class: 'eb-back', href: experience.routes.course(params.id), text: '← Back to Course Home' }));
    const notice = previewNotice(experience); if (notice) root.append(notice);
    rows.forEach(row => {
      const active = Date.now() >= Date.parse(row.opensAt) && Date.now() < Date.parse(row.closesAt);
      const canStart = experience.preview && !experience.restricted ? row.canStart !== false : (row.canStart ?? active);
      const highlighted = requestedExamId === row.id;
      const configuredWindow = Number.isFinite(Date.parse(row.opensAt)) && Number.isFinite(Date.parse(row.closesAt));
      const card = el('section', { class: 'eb-review', 'data-exam-id': row.id, tabindex: highlighted ? -1 : undefined },
        el('h2', { text: row.title }),
        experience.preview && el('span', { class: 'eb-pill', text: row.source === 'draft' ? 'Draft rehearsal' : 'Published paper' }),
        el('p', { text: `${row.kind} · ${row.purpose} · ${row.questionCount} questions · ${row.durationMinutes} minutes` }),
        el('p', { text: configuredWindow ? `${new Date(row.opensAt).toLocaleString()} – ${new Date(row.closesAt).toLocaleString()} (your local time)` : 'Availability is not configured. Ready drafts can still be rehearsed in unrestricted preview.' }),
        el('p', { class: 'muted', text: 'Complete the exam in this window. Closing or reloading it ends the attempt and submits your saved answers.' }),
        row.unavailableReason && el('p', { class: 'eb-error', text: row.unavailableReason }),
        el('button', { class: 'btn btn--primary', type: 'button', disabled: !canStart && !row.attemptId, text: row.submitted ? 'View submission' : row.attemptId ? 'Resume attempt' : canStart ? (experience.preview ? 'Start preview' : 'Start exam') : 'Not open', onclick: async () => {
          let pendingId: string | undefined;
          try {
            if (row.attemptId) {
              if (!row.submitted) activateAssessmentWindow({ attemptId: row.attemptId, href: experience.routes.attempt(params.id, row.attemptId), close: () => experience.closeWindow(params.id, row.attemptId!, assessmentWindowId()) });
              window.location.hash = experience.routes.attempt(params.id, row.attemptId); return;
            }
            if (!window.confirm(`Start ${row.title}${experience.preview ? ' in isolated preview' : ''}? The timer starts immediately. Closing or reloading this window ends the attempt and submits your saved answers. Other course pages stay unavailable until you submit.`)) return;
            pendingId = `starting:${params.id}:${row.id}`;
            activateAssessmentWindow({ attemptId: pendingId, href: window.location.hash, close: () => undefined });
            const attempt = await experience.request<AssessmentState>(params.id, `assessments/${row.id}/start`, 'POST', { windowId: assessmentWindowId() });
            if (!attempt.submitted) activateAssessmentWindow({ attemptId: attempt.id, owned: true, href: experience.routes.attempt(params.id, attempt.id), close: () => {
              rememberAssessmentWindowClose(experience.windowScope(params.id), attempt.id, experience.routes.attempt(params.id, attempt.id), assessmentWindowId());
              experience.closeWindow(params.id, attempt.id, assessmentWindowId());
            } });
            else finishAssessmentWindow(pendingId);
            window.location.hash = experience.routes.attempt(params.id, attempt.id);
          } catch (error) {
            if (pendingId) finishAssessmentWindow(pendingId);
            if (root.isConnected) root.prepend(el('p', { role: 'alert', class: 'eb-error', text: error instanceof Error ? error.message : 'Could not start the exam.' }));
          }
        } }));
      root.append(card);
      if (highlighted) card.focus({ preventScroll: true });
    });
    if (!rows.length) root.append(el('p', { class: 'eb-panel eb-pad', text: experience.preview && !experience.restricted ? 'No published exams or ready draft papers are available to preview.' : 'No assessments have been published yet.' }));
    if (requestedExamId && !rows.some(row => row.id === requestedExamId)) root.append(el('p', { class: 'eb-notice eb-warn', text: 'That paper is not available in this preview. Draft papers need approved, validated questions and no active generation before rehearsal.' }));
  } catch (error) { if (root.isConnected) root.replaceChildren(errorState((error as Error).message, () => void renderAssessments(outlet, params, experience))); }
}

export async function renderAssessmentAttempt(outlet: HTMLElement, params: RouteParams, experience = LIVE_ASSESSMENT_EXPERIENCE): Promise<void> {
  const root = el('div', { class: 'view exam-builder eb-sitting assessment-view' }, loadingState('Loading your attempt…')); mount(outlet, root);
  const path = `assessment-attempts/${params.attemptId}`;
  const windowId = assessmentWindowId();
  const attemptHref = experience.routes.attempt(params.id, params.attemptId);
  const windowScope = experience.windowScope(params.id);
  let windowOwned = ownsAssessmentWindow(params.attemptId);
  let terminalConfirmed = false, loadEpoch = 0, resultEpoch = 0;
  let state: AssessmentState | undefined, saving = false, timer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatTimer: ReturnType<typeof setTimeout> | undefined, heartbeatPending = false;
  let leaseReady = false, needsRecovery = false;
  let serverOffset = 0, cursor = 0;
  const cursorKey = `financebot:assessment-cursor:${experience.preview ? experience.restricted ? 'restricted' : 'unrestricted' : 'live'}:${params.id}:${params.attemptId}`;
  try { const stored = Number(sessionStorage.getItem(cursorKey)); if (Number.isInteger(stored) && stored >= 0) cursor = stored; }
  catch { /* Cursor persistence is optional; answers always come from the API. */ }
  let indexOpen = window.matchMedia('(min-width: 761px)').matches;
  const message = el('p', { class: 'assessment-save-state', role: 'status', 'aria-live': 'polite', text: 'Choose an answer. Each selection saves automatically.' });
  const content = (text: string, className = '') => { const node = el('div', { class: `eb-rich ${className}` }); renderRichText(node, text); return node; };
  const stopTimer = (): void => { if (timer) clearTimeout(timer); timer = undefined; };
  const stopHeartbeat = (): void => { if (heartbeatTimer) clearTimeout(heartbeatTimer); heartbeatTimer = undefined; };
  const observer = new MutationObserver(() => { if (!root.isConnected) { stopTimer(); stopHeartbeat(); observer.disconnect(); } });
  observer.observe(document.body, { childList: true, subtree: true });
  const expired = (): boolean => Boolean(state && Date.parse(state.deadline) <= Date.now() + serverOffset);
  const leaseExpired = (): boolean => Boolean(state?.windowExpiresAt && Date.parse(state.windowExpiresAt) <= Date.now() + serverOffset);
  function activateWindow(): void {
    root.setAttribute('data-assessment-active', '');
    activateAssessmentWindow({
      attemptId: params.attemptId, href: attemptHref, owned: windowOwned,
      close: () => {
        stopTimer(); stopHeartbeat(); leaseReady = false;
        if (windowOwned) rememberAssessmentWindowClose(windowScope, params.attemptId, attemptHref, windowId);
        experience.closeWindow(params.id, params.attemptId, windowId);
      },
      onBlocked: () => showMessage(new Error('Submit this exam before leaving. Closing or reloading this window submits your saved answers.')),
      onReturn: () => { leaseReady = false; needsRecovery = true; tick(); },
    });
  }
  // Direct links are provisionally locked before their first network read.
  // Only a terminal receipt or a definitive inaccessible identity releases it.
  activateWindow();
  function lockControls(): void {
    if (!root.isConnected || !root.classList.contains('assessment-workspace') || !state) return;
    const locked = saving || state.submitted || expired() || !leaseReady || leaseExpired();
    root.querySelectorAll<HTMLInputElement | HTMLButtonElement>('[data-assessment-control]').forEach(node => {
      const canRetry = node.hasAttribute('data-assessment-reload') || (leaseReady && node.hasAttribute('data-assessment-submit'));
      node.disabled = saving || state!.submitted || (!canRetry && (expired() || !leaseReady || leaseExpired()));
    });
    const previous = root.querySelector<HTMLButtonElement>('[data-assessment-previous]'); if (previous) previous.disabled = locked || cursor === 0;
    const next = root.querySelector<HTMLButtonElement>('[data-assessment-next]'); if (next) next.disabled = locked || cursor >= state.questions.length - 1;
    root.setAttribute('aria-busy', String(saving));
  }
  function showMessage(error: unknown): void {
    if (root.isConnected) { message.classList.add('is-error'); message.textContent = error instanceof Error ? error.message : 'The request could not be completed.'; }
  }
  function setMessage(text: string): void { message.classList.remove('is-error'); message.textContent = text; }
  function syncProgress(): void {
    if (!state || !root.isConnected) return;
    const answered = state.questions.filter(question => question.selectedKey !== null).length;
    root.querySelectorAll<HTMLElement>('.assessment-progress-text').forEach(node => { node.textContent = `${answered} of ${state!.questions.length} answered`; });
    const progress = root.querySelector<HTMLProgressElement>('progress'); if (progress) progress.value = answered;
    root.querySelectorAll<HTMLButtonElement>('.assessment-index-button').forEach((button, index) => {
      const answered = state!.questions[index]?.selectedKey !== null;
      button.classList.toggle('is-answered', answered);
      button.setAttribute('aria-label', `Question ${index + 1}, ${answered ? 'answered' : 'unanswered'}`);
      const status = button.querySelector('.assessment-index-status'); if (status) status.textContent = answered ? 'Answered' : 'Unanswered';
    });
  }
  function leaveWorkspace(): void {
    root.classList.remove('assessment-workspace'); root.removeAttribute('aria-busy');
  }
  function submitted(): void {
    terminalConfirmed = true; loadEpoch++;
    if (state) state.submitted = true;
    stopTimer(); stopHeartbeat(); leaseReady = false;
    clearAssessmentWindowClose(windowScope, params.attemptId, attemptHref);
    finishAssessmentWindow(params.attemptId); root.removeAttribute('data-assessment-active');
  }
  async function results(): Promise<void> {
    submitted();
    const epoch = ++resultEpoch;
    let result: PreviewAssessmentResults;
    try { result = await experience.request<PreviewAssessmentResults>(params.id, `${path}/results`); }
    catch (error) {
      if (!root.isConnected || epoch !== resultEpoch) return;
      leaveWorkspace();
      root.replaceChildren(pageHeader(state?.title ?? 'Assessment results', 'Your attempt has been submitted. Reload the result when the connection returns.'),
        el('a', { class: 'btn btn--secondary', href: experience.routes.list(params.id), text: '← Back to assessments' }),
        errorState(error instanceof Error ? error.message : 'Could not load results.', () => void results()));
      return;
    }
    if (!root.isConnected || epoch !== resultEpoch) return;
    leaveWorkspace();
    root.replaceChildren(pageHeader(result.title, experience.preview ? 'Your isolated preview attempt has been submitted.' : 'Your attempt has been submitted.'),
      el('a', { class: 'btn btn--secondary', href: experience.routes.list(params.id), text: '← Back to assessments' }));
    const notice = previewNotice(experience); if (notice) root.append(notice);
    if (!result.released) { root.append(el('div', { class: 'eb-panel eb-pad', text: result.message ?? 'Results have not been released yet.' })); return; }
    if (result.simulatedRelease) root.append(el('p', { class: 'assessment-release-note', text: result.message ?? 'Preview-only answer release. Students still follow the exam’s configured release policy.' }));
    root.append(el('h2', { text: `${result.score} / ${result.maxScore} points` }));
    result.questions?.forEach((q, index) => {
      const question = el('article', { class: 'eb-review' }, el('h3', { text: `Question ${index + 1} · ${q.points} points` }), content(q.stem));
      q.options.forEach(o => question.append(el('div', { class: `eb-option ${o.correct ? 'correct' : ''}` },
        el('strong', { text: `${o.key}${o.key === q.selectedKey ? ' · Your answer' : ''}${o.correct ? ' · Correct' : ''}` }), content(o.text), o.explanation && content(o.explanation))));
      root.append(question);
    });
  }
  async function load(): Promise<void> {
    if (terminalConfirmed) { await results(); return; }
    const epoch = ++loadEpoch;
    try {
      const marker = readAssessmentWindowClose(windowScope, params.attemptId, attemptHref);
      if (marker) {
        // A reload retries the departed owner's close before even attempting to
        // acquire a new lease. Keep the marker until the server confirms terminal.
        const receipt = await experience.request<Pick<AssessmentWindowReceipt, 'submitted'>>(params.id, `${path}/window/close`, 'POST', { windowId: marker.windowId });
        if (!root.isConnected || epoch !== loadEpoch || terminalConfirmed) return;
        if (!receipt.submitted) throw new Error('The departed window has not confirmed submission. Please retry.');
        submitted(); await results(); return;
      }
      const loaded = await experience.request<AssessmentState>(params.id, path);
      if (!root.isConnected || epoch !== loadEpoch || terminalConfirmed) return;
      state = loaded;
      serverOffset = Date.parse(loaded.serverTime) - Date.now();
      if (loaded.submitted) { submitted(); await results(); return; }
      activateWindow(); leaseReady = false; lockControls();
      if (isAssessmentWindowClosing(params.attemptId)) {
        // Returning from bfcache must finish the departed window, even if its
        // original beacon was lost. It must never renew that abandoned lease.
        const receipt = await experience.request<Pick<AssessmentWindowReceipt, 'submitted'>>(params.id, `${path}/window/close`, 'POST', { windowId });
        if (!root.isConnected || epoch !== loadEpoch || terminalConfirmed) return;
        if (!receipt.submitted) throw new Error('The exam ended. Reload to confirm the saved submission.');
        submitted(); await results(); return;
      }
      const receipt = await experience.request<AssessmentWindowReceipt>(params.id, `${path}/window`, 'POST', { windowId });
      if (!root.isConnected || epoch !== loadEpoch || terminalConfirmed) return;
      serverOffset = Date.parse(receipt.serverTime) - Date.now();
      if (receipt.submitted) {
        submitted(); await results(); return;
      }
      state.windowExpiresAt = receipt.windowExpiresAt;
      windowOwned = true; activateWindow();
      leaseReady = true; needsRecovery = false; startHeartbeat();
      cursor = Math.min(cursor, Math.max(0, loaded.questions.length - 1));
      draw(loaded); if (!saving) tick();
    } catch (error) {
      if (epoch !== loadEpoch || terminalConfirmed || !root.isConnected) return;
      throw error;
    }
  }
  function startHeartbeat(): void {
    if (heartbeatTimer || !root.isConnected || state?.submitted) return;
    heartbeatTimer = setTimeout(() => {
      heartbeatTimer = undefined;
      if (!root.isConnected || !state || state.submitted || heartbeatPending) return;
      heartbeatPending = true;
      void experience.request<AssessmentWindowReceipt>(params.id, `${path}/window/heartbeat`, 'POST', { windowId }).then(async receipt => {
        if (!root.isConnected || !state || terminalConfirmed) return;
        serverOffset = Date.parse(receipt.serverTime) - Date.now();
        state.windowExpiresAt = receipt.windowExpiresAt;
        if (receipt.submitted) { submitted(); await results(); return; }
        if (!leaseReady) { leaseReady = false; needsRecovery = true; }
      }).catch(error => {
        if (!root.isConnected || terminalConfirmed) return;
        leaseReady = false; needsRecovery = true;
        showMessage(new Error(`Connection interrupted. Answers are paused until your saved exam is confirmed. ${(error as Error).message}`));
      }).finally(() => { heartbeatPending = false; lockControls(); if (root.isConnected && !state?.submitted) { startHeartbeat(); tick(); } });
    }, 20_000);
  }
  function updateCountdown(): number {
    if (!state) return 0;
    const seconds = Math.max(0, Math.ceil((Date.parse(state.deadline) - (Date.now() + serverOffset)) / 1000));
    const display = root.querySelector('.eb-timer');
    if (display) { display.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} remaining`; display.classList.toggle('is-ending', seconds <= 300); }
    return seconds;
  }
  function tick(): void {
    stopTimer(); if (!root.isConnected || !state || state.submitted || terminalConfirmed) return;
    const seconds = updateCountdown();
    if (leaseExpired()) { leaseReady = false; needsRecovery = true; }
    if ((seconds <= 0 || needsRecovery) && !saving) {
      saving = true; setMessage(seconds <= 0 ? 'Time ended. Confirming your submission…' : 'Confirming your saved exam…'); lockControls();
      void load().catch(showMessage).finally(() => { saving = false; lockControls(); if (root.isConnected && !state?.submitted) timer = setTimeout(tick, 2000); });
      return;
    }
    timer = setTimeout(tick, 1000);
  }
  function go(index: number): void {
    if (saving || !state || state.submitted || terminalConfirmed || expired() || !leaseReady || leaseExpired() || index < 0 || index >= state.questions.length) return;
    cursor = index;
    try { sessionStorage.setItem(cursorKey, String(cursor)); }
    catch { /* Storage restrictions do not block navigation. */ }
    if (!window.matchMedia('(min-width: 761px)').matches) indexOpen = false;
    setMessage(state.questions[cursor].selectedKey === null ? 'Choose an answer. Each selection saves automatically.' : 'Saved answer loaded.');
    draw(state);
    root.querySelector<HTMLElement>('.assessment-question-scroll')?.focus({ preventScroll: true });
  }
  function draw(loaded: AssessmentState): void {
    root.classList.add('assessment-workspace');
    const q = loaded.questions[cursor];
    const answered = loaded.questions.filter(question => question.selectedKey !== null).length;
    const timerNode = el('div', { class: 'eb-timer', role: 'timer', 'aria-live': 'off' });
    const header = el('header', { class: 'assessment-header' },
      el('div', { class: 'assessment-heading' }, el('span', { class: 'assessment-window-rule', text: 'Closing or reloading ends this attempt' }), el('h1', { text: loaded.title })),
      el('div', { class: 'assessment-header-tools' }, previewNotice(experience), el('div', { class: 'assessment-clock' }, el('span', { text: 'Time remaining' }), timerNode)));
    const index = el('details', { class: 'assessment-index', open: indexOpen },
      el('summary', {}, el('strong', { text: 'Questions' }), el('span', { class: 'assessment-progress-text', text: `${answered} of ${loaded.questions.length} answered` })),
      el('progress', { class: 'assessment-progress', max: Math.max(1, loaded.questions.length), value: answered, 'aria-label': 'Answered questions' }),
      el('nav', { class: 'assessment-index-list', 'aria-label': 'Exam questions' }, ...loaded.questions.map((question, index) => el('button', {
        type: 'button', class: `assessment-index-button${index === cursor ? ' is-active' : ''}${question.selectedKey !== null ? ' is-answered' : ''}`,
        'data-assessment-control': '', 'aria-label': `Question ${index + 1}, ${question.selectedKey !== null ? 'answered' : 'unanswered'}`, 'aria-current': index === cursor ? 'step' : undefined,
        onclick: () => go(index),
      }, el('span', { class: 'assessment-index-number', text: String(index + 1).padStart(2, '0') }),
      el('span', {}, el('strong', { text: `Question ${index + 1}` }), el('small', { class: 'assessment-index-status', text: question.selectedKey !== null ? 'Answered' : 'Unanswered' }))))));
    index.addEventListener('toggle', () => { if (index.isConnected) indexOpen = index.open; });
    const reader = el('div', { class: 'assessment-question-scroll', tabindex: -1 });
    if (q) {
      const card = el('fieldset', { class: 'assessment-question' }, el('legend', { text: `Question ${cursor + 1} of ${loaded.questions.length}` }),
        el('div', { class: 'assessment-question-meta', text: `${q.type === 'true-false' ? 'True / False' : 'Multiple choice'} · ${q.points} ${q.points === 1 ? 'point' : 'points'}` }),
        content(q.stem, 'assessment-stem'));
      const choices = el('div', { class: 'assessment-options' });
      q.options.forEach(option => {
        const input = el('input', { type: 'radio', name: q.id, value: option.key, checked: q.selectedKey === option.key, 'aria-label': `Option ${option.key}`, 'data-assessment-control': '' });
        input.addEventListener('change', () => {
          if (saving || loaded.submitted) return;
          if (expired() || !leaseReady || leaseExpired()) {
            card.querySelectorAll<HTMLInputElement>('input').forEach(node => { node.checked = node.value === q.selectedKey; });
            tick(); return;
          }
          saving = true; setMessage('Saving answer…'); lockControls();
          void experience.request<{ answerRevision: number }>(params.id, `${path}/answer`, 'PUT', { itemId: q.id, selectedKey: option.key, answerRevision: loaded.answerRevision, windowId }).then(saved => {
            if (!root.isConnected || terminalConfirmed) return;
            loaded.answerRevision = saved.answerRevision; q.selectedKey = option.key; if (leaseReady) setMessage('Answer saved.'); syncProgress();
          }).catch(error => {
            if (!root.isConnected || terminalConfirmed) return;
            showMessage(new Error(`${(error as Error).message} Your selection was not confirmed. Retry it or reload saved answers.`));
            card.querySelectorAll<HTMLInputElement>('input').forEach(node => { node.checked = node.value === q.selectedKey; });
          }).finally(() => { saving = false; lockControls(); });
        });
        choices.append(el('label', { class: 'assessment-option' }, input, el('span', { class: 'assessment-option-key', text: option.key }), content(option.text)));
      }); card.append(choices); reader.append(card);
    } else reader.append(el('p', { text: 'No questions are available in this attempt.' }));
    const previous = el('button', { type: 'button', class: 'btn btn--secondary', text: 'Previous question', 'data-assessment-previous': '', onclick: () => go(cursor - 1) });
    const next = el('button', { type: 'button', class: 'btn btn--secondary', text: 'Next question', 'data-assessment-next': '', onclick: () => go(cursor + 1) });
    const reload = el('button', { class: 'assessment-reload', type: 'button', text: 'Reload saved answers', 'data-assessment-control': '', 'data-assessment-reload': '', onclick: async () => {
      if (saving) return; saving = true; setMessage('Reloading saved answers…'); lockControls();
      const scroll = reader.scrollTop;
      try { await load(); if (root.isConnected && !state?.submitted) { setMessage('Saved answers reloaded.'); const current = root.querySelector('.assessment-question-scroll'); if (current) current.scrollTop = scroll; } }
      catch (error) { showMessage(error); }
      finally { saving = false; lockControls(); }
    } });
    const submit = el('button', { class: 'btn eb-primary', type: 'button', text: 'Submit exam', 'data-assessment-control': '', 'data-assessment-submit': '', onclick: async () => {
      if (saving || loaded.submitted || !leaseReady) return;
      const unanswered = loaded.questions.filter(question => question.selectedKey === null).length;
      if (!window.confirm(`Submit this exam? ${unanswered ? `${unanswered} of ${loaded.questions.length} questions are unanswered.` : `All ${loaded.questions.length} questions are answered.`} You will not be able to change your answers.`)) return;
      saving = true; setMessage('Submitting exam…'); lockControls();
      try { await experience.request(params.id, `${path}/submit`, 'POST', { windowId }); loaded.submitted = true; submitted(); await results(); }
      catch (error) { showMessage(error); } finally { saving = false; lockControls(); }
    } });
    const footer = el('footer', { class: 'assessment-footer' },
      el('div', { class: 'assessment-save-row' }, message, reload),
      el('div', { class: 'assessment-actions' }, el('div', { class: 'assessment-navigation' }, previous,
        el('span', { class: 'assessment-position', text: `${cursor + 1} / ${loaded.questions.length}` }), next), submit));
    root.replaceChildren(header, el('div', { class: 'assessment-layout' }, index, el('section', { class: 'assessment-pane', 'aria-label': 'Current exam question' }, reader, footer)));
    updateCountdown(); lockControls();
  }
  try { await load(); } catch (error) {
    if (root.isConnected) {
      if (!windowOwned && error instanceof ApiError && [403, 404].includes(error.status)) {
        finishAssessmentWindow(params.attemptId); root.removeAttribute('data-assessment-active');
      } else if (!terminalConfirmed) { activateWindow(); needsRecovery = true; }
      root.replaceChildren(errorState((error as Error).message, () => void renderAssessmentAttempt(outlet, params, experience)));
    }
  }
}
