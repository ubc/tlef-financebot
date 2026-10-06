import { assessmentRequest, type AssessmentSummary, type AssessmentState, type AssessmentResults } from '../../api.js';
import { el, mount } from '../../dom.js';
import { renderRichText } from '../../render.js';
import type { RouteParams } from '../../router.js';
import { errorState, loadingState } from '../../ui.js';
import { pageHeader } from '../../instructor-ui.js';

export async function renderAssessments(outlet: HTMLElement, params: RouteParams): Promise<void> {
  const root = el('div', { class: 'view stack' }, loadingState('Loading assessments…')); mount(outlet, root);
  try {
    const rows = await assessmentRequest<AssessmentSummary[]>(params.id, 'assessments');
    if (!root.isConnected) return;
    root.replaceChildren(pageHeader('Assessments', 'Published Midterms and Finals for this course.'), ...rows.map(row => {
      const active = Date.now() >= Date.parse(row.opensAt) && Date.now() < Date.parse(row.closesAt);
      return el('section', { class: 'card stack' }, el('h2', { text: row.title }),
        el('p', { text: `${row.kind} · ${row.purpose} · ${row.questionCount} questions · ${row.durationMinutes} minutes` }),
        el('p', { text: `${new Date(row.opensAt).toLocaleString()} – ${new Date(row.closesAt).toLocaleString()} (your local time)` }),
        el('p', { class: 'muted', text: 'One resumable attempt. Your deadline is the earlier of the allowed duration and the exam close time.' }),
        el('button', { class: 'btn btn--primary', type: 'button', disabled: !active && !row.attemptId, text: row.submitted ? 'View submission' : row.attemptId ? 'Resume attempt' : active ? 'Start exam' : 'Not open', onclick: async () => {
          try {
            if (row.attemptId) { window.location.hash = `/course/${params.id}/assessment/${row.attemptId}`; return; }
            if (!window.confirm(`Start ${row.title}? The exam timer starts immediately.`)) return;
            const attempt = await assessmentRequest<AssessmentState>(params.id, `assessments/${row.id}/start`, 'POST', {});
            if (root.isConnected) window.location.hash = `/course/${params.id}/assessment/${attempt.id}`;
          } catch (error) { root.prepend(el('p', { role: 'alert', class: 'eb-error', text: error instanceof Error ? error.message : 'Could not start the exam.' })); }
        } }));
    }));
    if (!rows.length) root.append(el('p', { class: 'card', text: 'No assessments have been published yet.' }));
  } catch (error) { if (root.isConnected) root.replaceChildren(errorState((error as Error).message, () => void renderAssessments(outlet, params))); }
}

export async function renderAssessmentAttempt(outlet: HTMLElement, params: RouteParams): Promise<void> {
  const root = el('div', { class: 'view exam-builder eb-sitting' }, loadingState('Loading your attempt…')); mount(outlet, root);
  const path = `assessment-attempts/${params.attemptId}`;
  let state: AssessmentState, saving = false, timer: ReturnType<typeof setTimeout> | undefined;
  let serverOffset = 0;
  const message = el('p', { role: 'status', 'aria-live': 'polite' });
  const content = (text: string) => { const node = el('div'); renderRichText(node, text); return node; };
  async function results(): Promise<void> {
    const result = await assessmentRequest<AssessmentResults>(params.id, `${path}/results`);
    if (!root.isConnected) return;
    root.replaceChildren(pageHeader(result.title, 'Your attempt has been submitted.'), el('a', { class: 'btn btn--secondary', href: `#/course/${params.id}/assessments`, text: '← Back to assessments' }));
    if (!result.released) { root.append(el('div', { class: 'eb-panel eb-pad', text: result.message ?? 'Results have not been released yet.' })); return; }
    root.append(el('h2', { text: `${result.score} / ${result.maxScore} points` }));
    result.questions?.forEach((q, index) => root.append(el('article', { class: 'eb-review' }, el('h3', { text: `Question ${index + 1} · ${q.points} points` }), content(q.stem),
      ...q.options.map(o => el('div', { class: `eb-option ${o.correct ? 'correct' : ''}` }, el('strong', { text: `${o.key}${o.key === q.selectedKey ? ' · Your answer' : ''}${o.correct ? ' · Correct' : ''}` }), content(o.text), content(o.explanation ?? ''))))));
  }
  async function load(): Promise<void> {
    state = await assessmentRequest<AssessmentState>(params.id, path);
    if (!root.isConnected) return;
    serverOffset = Date.parse(state.serverTime) - Date.now();
    if (state.submitted) { if (timer) clearTimeout(timer); await results(); return; }
    draw(); tick();
  }
  function tick(): void {
    if (timer) clearTimeout(timer); if (!root.isConnected || state.submitted) return;
    const seconds = Math.max(0, Math.ceil((Date.parse(state.deadline) - (Date.now() + serverOffset)) / 1000));
    const display = root.querySelector('.eb-timer'); if (display) display.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} remaining`;
    if (seconds <= 0 && !saving) { saving = true; void load().catch(error => { message.textContent = (error as Error).message; }).finally(() => { saving = false; timer = setTimeout(tick, 2000); }); return; }
    timer = setTimeout(tick, 1000);
  }
  function draw(): void {
    root.replaceChildren(pageHeader(state.title, 'Answers are saved to the server after each selection.'), el('div', { class: 'eb-timer eb-notice', role: 'timer', 'aria-live': 'off' }), message);
    state.questions.forEach((q, index) => {
      const card = el('fieldset', { class: 'eb-review' }, el('legend', { text: `Question ${index + 1} · ${q.points} points` }), content(q.stem));
      q.options.forEach(o => {
        const input = el('input', { type: 'radio', name: q.id, value: o.key, checked: q.selectedKey === o.key, 'aria-label': `Option ${o.key}` });
        input.addEventListener('change', () => {
          if (saving) return; saving = true; message.textContent = 'Saving answer…';
          root.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button').forEach(node => { node.disabled = true; });
          void assessmentRequest<{ answerRevision: number }>(params.id, `${path}/answer`, 'PUT', { itemId: q.id, selectedKey: o.key, answerRevision: state.answerRevision }).then(saved => {
            state.answerRevision = saved.answerRevision; q.selectedKey = o.key; message.textContent = 'Answer saved.';
          }).catch(error => {
            message.textContent = `${(error as Error).message} Your selection was not confirmed. Retry it or reload saved answers.`;
            card.querySelectorAll<HTMLInputElement>('input').forEach(node => { node.checked = node.value === q.selectedKey; });
          }).finally(() => { saving = false; if (root.isConnected) root.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button').forEach(node => { node.disabled = false; }); });
        });
        card.append(el('label', { class: 'eb-option' }, input, el('b', { text: o.key }), content(o.text)));
      }); root.append(card);
    });
    root.append(el('div', { class: 'eb-actions' }, el('button', { class: 'btn btn--secondary', type: 'button', text: 'Reload saved answers', onclick: async () => { if (saving) return; try { await load(); } catch (error) { message.textContent = (error as Error).message; } } }), el('button', { class: 'btn btn--primary', type: 'button', text: 'Submit exam', onclick: async () => {
      if (saving || !window.confirm('Submit this exam? You will not be able to change your answers.')) return;
      saving = true;
      try { await assessmentRequest(params.id, `${path}/submit`, 'POST', {}); state.submitted = true; if (timer) clearTimeout(timer); await results(); }
      catch (error) { message.textContent = (error as Error).message; } finally { saving = false; }
    } })));
  }
  try { await load(); } catch (error) { if (root.isConnected) root.replaceChildren(errorState((error as Error).message, () => void renderAssessmentAttempt(outlet, params))); }
}
