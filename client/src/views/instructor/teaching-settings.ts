import { browseBank, listMaterials } from '../../api.js';
import { el } from '../../dom.js';
import { errorState, loadingState } from '../../ui.js';
import { getTeachingSettings, saveTeachingSettings, type LearningSettings, type QuestionNote } from '../../student-learning-api.js';
import { button, select } from '../student/learning-workspace.js';

export function teachingSettingsPanel(courseId: string) {
  const root = el('section', { class: 'teaching-settings stack' }, loadingState('Loading teaching mode…'));
  void (async () => {
    try {
      let settings = await getTeachingSettings(courseId);
      const [bank, materials] = await Promise.all([browseBank(courseId), listMaterials(courseId)]);
      const questions = bank.questions.filter(q => q.state === 'approved');
      const order = [...settings.questionOrder.filter(id => questions.some(q => q.id === id)), ...questions.filter(q => !settings.questionOrder.includes(q.id)).map(q => q.id)];
      const mode = select('Teaching mode', [['linear', 'Linear learning · all questions, one by one (default)'], ['topic-practice', 'Topic Practice · legacy feedback and retry']], settings.mode, () => {});
      const sequence = select('Question sequence', [['instructor', 'Same instructor order for all students'], ['personalized', 'Prioritize learning objectives using student evidence']], settings.order, () => {});
      const status = el('div', { role: 'status', 'aria-live': 'polite' });
      const questionList = el('div', { class: 'teaching-sequence' });
      const drawOrder = () => questionList.replaceChildren(...order.map((id, index) => {
        const q = questions.find(q => q.id === id)!;
        const move = (delta: number) => { const target = index + delta; if (target < 0 || target >= order.length) return; [order[index], order[target]] = [order[target], order[index]]; drawOrder(); };
        const up = button('↑', () => move(-1)); up.setAttribute('aria-label', `Move question ${index + 1} earlier`); up.disabled = index === 0;
        const down = button('↓', () => move(1)); down.setAttribute('aria-label', `Move question ${index + 1} later`); down.disabled = index === order.length - 1;
        return el('div', { class: 'teaching-sequence-row' }, el('small', { text: String(index + 1) }), el('span', { text: q.sample?.stem ?? q.current.stem }), up, down);
      })); drawOrder();
      const notePanel = el('div', { class: 'stack' }); let noteQuestion = questions[0]?.id ?? '';
      const picker = select('Question for instructor notes', [['', 'Choose a question'], ...questions.map(q => [q.id, q.current.stem.slice(0, 95)] as [string, string])], noteQuestion, value => { noteQuestion = value; drawNote(); });
      let commitNote = () => {};
      const drawNote = () => {
        commitNote();
        const q = questions.find(q => q.id === noteQuestion); if (!q) { notePanel.replaceChildren(); commitNote = () => {}; return; }
        const existing = settings.notes.find(n => n.questionId === q.id);
        const enabled = el('input', { type: 'checkbox', ...(existing ? { checked: true } : {}) });
        const text = el('textarea', { class: 'input', rows: 4, value: existing?.text ?? '', 'aria-label': 'Instructor notes text', placeholder: 'Add a concept explanation or material excerpt…' }); text.value = existing?.text ?? '';
        const material = select('Related material', [['', 'Text notes only'], ...materials.filter(m => m.status === 'ready' && m.assignments.some(a => a.loId && q.loIds.includes(a.loId))).map(m => [m._id, m.name] as [string, string])], existing?.materialId ?? '', () => {});
        const visibility = select('Notes visibility', [['always', 'Before and after answering'], ['after-submit', 'After the answer is submitted']], existing?.visibility ?? 'after-submit', () => {});
        const start = el('input', { class: 'input', type: 'number', min: 1, value: existing?.pageStart ?? '', 'aria-label': 'Start page', placeholder: 'Start page' });
        const end = el('input', { class: 'input', type: 'number', min: 1, value: existing?.pageEnd ?? '', 'aria-label': 'End page', placeholder: 'End page' });
        notePanel.replaceChildren(el('label', {}, enabled, ' Show instructor notes for this question'), text, material, el('div', { class: 'row' }, start, end), visibility);
        commitNote = () => {
          const note: QuestionNote = { questionId: q.id, visibility: visibility.value as QuestionNote['visibility'], ...(text.value.trim() ? { text: text.value.trim() } : {}), ...(material.value ? { materialId: material.value } : {}), ...(start.value ? { pageStart: Number(start.value) } : {}), ...(end.value ? { pageEnd: Number(end.value) } : {}) };
          settings.notes = settings.notes.filter(n => n.questionId !== q.id); if (enabled.checked) settings.notes.push(note);
        };
      };
      // The old editor must commit before changing the question selector.
      drawNote();
      root.replaceChildren(el('label', { class: 'form-field' }, el('span', { text: 'Teaching mode' }), mode), el('p', { class: 'muted', text: 'The default is Linear learning: students see all released Approved questions in each topic from the start. Students can return to skipped questions; incorrect answers do not force a retry.' }), el('label', { class: 'form-field' }, el('span', { text: 'Question order' }), sequence), el('h3', { text: 'Instructor sequence' }), questionList, el('h3', { text: 'Optional instructor notes' }), picker, notePanel, status, button('Save teaching settings', async () => {
        status.replaceChildren(); commitNote();
        try {
          const input: LearningSettings = { ...settings, mode: mode.value as LearningSettings['mode'], order: sequence.value as LearningSettings['order'], questionOrder: order };
          settings = await saveTeachingSettings(courseId, input); status.append(el('p', { text: 'Teaching settings saved.' }));
        } catch (error) { status.replaceChildren(errorState((error as Error).message)); }
      }, 'btn btn--instr-primary'));
    } catch (error) { root.replaceChildren(errorState((error as Error).message)); }
  })();
  return root;
}
