import { editQuestion, type CourseTree, type QuestionDetail, type QuestionOption, type QuestionType, type Difficulty } from '../../api.js';
import { el } from '../../dom.js';
import { confirmDialog } from '../../modal.js';
import { errorState } from '../../ui.js';

/** Complete version editor; one request changes content and returns it to review. */
export function openBankEditor(detail: QuestionDetail, tree: CourseTree, onSaved: () => Promise<void>): void {
  const dialog = el('dialog', { class: 'app-dialog bank-editor', 'aria-label': 'Edit approved question' }) as HTMLDialogElement;
  const current = detail.current;
  let busy = false;
  let dirty = false;
  let saved = false;
  const error = el('div');
  const input = (value: string, area = false) => area ? el('textarea', { class: 'input', rows: 3, text: value }) : el('input', { class: 'input', value });
  const field = (name: string, control: HTMLElement) => { if (!control.hasAttribute('aria-label')) control.setAttribute('aria-label', name); return el('label', { class: 'bank-editor__field' }, el('span', { text: name }), control); };
  const stem = input(current.stem, true) as HTMLTextAreaElement;
  stem.required = true;
  const difficulty = el('select', { class: 'input' }, ...['easy', 'medium', 'hard'].map(d => el('option', { value: d, text: d, selected: d === current.difficulty }))) as HTMLSelectElement;
  const type = el('select', { class: 'input' }, ...(['mcq', 'true-false'] as const).map(t => el('option', { value: t, text: t === 'mcq' ? 'Multiple choice' : 'True / false', selected: t === current.type }))) as HTMLSelectElement;
  let options = current.options.map(o => ({ ...o }));
  const optionArea = el('div', { class: 'bank-editor__options' });
  const roles: QuestionOption['role'][] = ['correct', 'partially-correct', 'common-misconception', 'clearly-wrong'];
  function drawOptions(): void {
    optionArea.replaceChildren(...options.map((o, i) => {
      const text = input(o.text) as HTMLInputElement; text.required = true;
      text.oninput = () => { o.text = text.value; };
      const explanation = input(o.explanation, true) as HTMLTextAreaElement;
      explanation.oninput = () => { o.explanation = explanation.value; };
      const role = el('select', { class: 'input', 'aria-label': `Answer ${o.key} role` }, ...roles.map(r => el('option', { value: r, text: r === 'correct' ? 'Correct answer' : r === 'partially-correct' ? 'Partially correct' : r === 'common-misconception' ? 'Common misconception' : 'Incorrect', selected: r === o.role }))) as HTMLSelectElement;
      role.onchange = () => {
        // Swap roles to maintain one of each for four-option MCQs.
        const previous = o.role; const other = options.find(x => x !== o && x.role === role.value);
        if (other) other.role = previous;
        o.role = role.value as QuestionOption['role']; dirty = true; drawOptions();
      };
      return el('fieldset', { class: 'bank-editor__option' }, el('legend', { text: `Answer ${String.fromCharCode(65 + i)}` }), field('Answer text', text), field('Answer role', role), field('Explanation', explanation));
    }));
  }
  type.onchange = async () => {
    if (!await confirmDialog({ title: 'Change question type?', message: 'The answer options will be replaced for the new type. Your question text will be kept.', confirmLabel: 'Change type' })) { type.value = options.length === 4 ? 'mcq' : 'true-false'; return; }
    options = type.value === 'mcq' ? roles.map((role, i) => ({ key: 'ABCD'[i], text: '', explanation: '', role })) : [{ key: 'T', text: 'True', explanation: '', role: 'correct' }, { key: 'F', text: 'False', explanation: '', role: 'clearly-wrong' }];
    dirty = true; drawOptions();
  };
  drawOptions();
  const loChecks = tree.themes.flatMap(t => (t.los ?? []).map(lo => ({ themeId: t._id, id: lo._id, node: el('input', { type: 'checkbox', checked: detail.loIds.includes(lo._id) }) as HTMLInputElement, name: `${t.name} / ${lo.name}` })));
  const topicChecks = tree.themes.map(t => ({ id: t._id, node: el('input', { type: 'checkbox', checked: detail.themeIds.includes(t._id) }) as HTMLInputElement, name: t.name }));
  const advanced = el('details', {}, el('summary', { text: 'Topics, learning objectives & numerical settings' }),
    el('div', { class: 'bank-editor__checks' }, el('strong', { text: 'Topics' }), ...topicChecks.map(x => el('label', {}, x.node, x.name)), el('strong', { text: 'Learning objectives' }), ...loChecks.map(x => el('label', {}, x.node, x.name))));
  const slots = input(JSON.stringify(current.paramSlots ?? [], null, 2), true) as HTMLTextAreaElement;
  const derived = input(JSON.stringify(current.derivedValues ?? [], null, 2), true) as HTMLTextAreaElement;
  advanced.append(el('p', { class: 'muted', text: 'Keep {{variable}} placeholders intact. Formula changes are checked by the server.' }), field('Parameter slots (JSON)', slots), field('Derived values (JSON)', derived));
  if (current.generateScript) advanced.append(el('a', { href: `#/instructor/course/${detail.courseId}/bank/${detail.id}/params`, text: 'Open script and parameter editor →' }));
  const sourceRefs = input(JSON.stringify(current.sourceRefs, null, 2), true) as HTMLTextAreaElement;
  advanced.append(field('Source references (JSON)', sourceRefs));
  const close = async () => { if (busy) return; if (dirty && !saved && !await confirmDialog({ title: 'Discard unsaved edits?', message: 'Your saved question will stay unchanged.', confirmLabel: 'Discard edits' })) return; dialog.close(); dialog.remove(); };
  const form = el('form', {}, field('Question text', stem), el('div', { class: 'bank-editor__grid' }, field('Question type', type), field('Difficulty', difficulty)), optionArea, advanced, error);
  form.oninput = () => { dirty = true; };
  form.onchange = () => { dirty = true; };
  const save = el('button', { type: 'button', class: 'btn btn--instr-primary', onclick: async () => {
    if (!form.reportValidity() || busy) return;
    error.replaceChildren();
    try {
      const paramSlots = JSON.parse(slots.value); const derivedValues = JSON.parse(derived.value); const refs = JSON.parse(sourceRefs.value);
      if (![paramSlots, derivedValues, refs].every(Array.isArray)) throw new Error('Numerical settings and source references must be JSON arrays.');
      if (options.filter(o => o.role === 'correct').length !== 1) throw new Error('Choose exactly one correct answer.');
      const loIds = loChecks.filter(x => x.node.checked).map(x => x.id);
      const themeIds = [...new Set([...topicChecks.filter(x => x.node.checked).map(x => x.id), ...loChecks.filter(x => x.node.checked).map(x => x.themeId)])];
      busy = true; form.inert = true;
      await editQuestion(detail.id, { expectedVersionId: detail.currentVersionId, submitForReview: true, stem: stem.value.trim(), type: type.value as QuestionType, difficulty: difficulty.value as Difficulty, options, loIds, themeIds,
        ...(current.paramSlots?.length || slots.value !== JSON.stringify(current.paramSlots ?? [], null, 2) ? { paramSlots } : {}),
        ...(current.derivedValues?.length || derived.value !== JSON.stringify(current.derivedValues ?? [], null, 2) ? { derivedValues } : {}),
        ...(sourceRefs.value !== JSON.stringify(current.sourceRefs, null, 2) ? { sourceRefs: refs } : {}) });
      saved = true; dialog.close(); dialog.remove(); await onSaved();
    } catch (e) { error.replaceChildren(errorState(e instanceof Error ? e.message : String(e))); }
    finally { busy = false; form.inert = false; }
  } }, 'Save & send to review');
  form.onsubmit = e => { e.preventDefault(); save.click(); };
  dialog.append(el('h2', { text: 'Edit approved question' }), el('p', { class: 'muted', text: 'Saving creates a new version and sends this question back to Review Queue. Previous versions and student history are retained.' }), form,
    el('footer', { class: 'bank-editor__footer' }, el('button', { class: 'btn btn--ghost', type: 'button', onclick: close }, 'Cancel'), save));
  dialog.addEventListener('cancel', e => { e.preventDefault(); void close(); });
  document.body.append(dialog); dialog.showModal();
}
