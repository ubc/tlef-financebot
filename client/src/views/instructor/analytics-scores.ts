import { type AnalyticsExamScore } from '../../api.js';
import { el } from '../../dom.js';
export function scoresPanel(items: AnalyticsExamScore[], courseId: string, showNames = true): HTMLElement {
  const root = el('div', { class: 'analytics-score-panel' });
  if (!items.length) { root.append(el('h3', { text: 'No submitted exam scores' }), el('p', { text: 'Unstarted and in-progress sittings are excluded. Try a wider date range.' })); return root; }
  const templates = [...new Set(items.map(s => s.templateId))];
  const select = el('select', { class: 'input', 'aria-label': 'Exam template' }, ...templates.map((id, i) => el('option', { value: id, text: `${items.find(s => s.templateId === id)!.templateKind} · Template ${i + 1}` }))) as HTMLSelectElement;
  const detail = el('div');
  function draw(): void {
    const rows = items.filter(s => s.templateId === select.value);
    const mean = rows.reduce((sum, s) => sum + s.score / s.maxScore, 0) / rows.length;
    const bins = [0, 0, 0, 0, 0];
    rows.forEach(s => { const p = s.score / s.maxScore * 100; bins[p < 60 ? 0 : p < 70 ? 1 : p < 80 ? 2 : p < 90 ? 3 : 4]++; });
    detail.replaceChildren(el('p', { text: `${rows.length} submitted sittings · Mean score ${Math.round(mean * 100)}%. Each sitting counts once, including repeat sittings.` }),
      el('div', { class: 'analytics-score-bins' }, ...bins.map((n, i) => el('div', {}, el('strong', { text: String(n) }), el('div', { style: `height:${n / Math.max(...bins) * 90}px` }), el('small', { text: ['0–59%', '60–69%', '70–79%', '80–89%', '90–100%'][i] })))),
      el('div', { class: 'analytics-table-wrap' }, el('table', { class: 'analytics-table' },
        el('thead', {}, el('tr', {}, ...[...(showNames ? ['Student'] : []), 'Earned / possible', 'Score', 'Submitted'].map(text => el('th', { scope: 'col', text })))),
        el('tbody', {}, ...rows.map(s => el('tr', {},
          ...(showNames ? [el('td', {}, el('a', { href: `#/instructor/course/${encodeURIComponent(courseId)}/student/${encodeURIComponent(s.puid)}`, text: s.displayName }))] : []),
          el('td', { text: `${s.score} / ${s.maxScore}` }), el('td', { text: `${Math.round(s.score / s.maxScore * 100)}%` }), el('td', { text: new Date(s.submittedAt).toLocaleString() })))))));
  }
  select.onchange = draw; root.append(el('label', {}, 'Exam template ', select), detail); draw(); return root;
}
