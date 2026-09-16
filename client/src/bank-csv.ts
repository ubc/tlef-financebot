import type { BankQuestion } from './api.js';
/** Portable, static question snapshots. Approval and course ids are never copied. */
export function bankCsv(rows: BankQuestion[]): string {
  if (!rows.length) throw new Error('No questions selected for export.');
  const headers = ['type','stem','optionA','optionB','optionC','optionD','correct','explanationA','explanationB','explanationC','explanationD','roleA','roleB','roleC','roleD','difficulty'];
  const quote = (s: string) => '"' + s.replace(/"/g, '""') + '"';
  return '\uFEFF' + [headers, ...rows.map(row => {
    const v = row.current;
    const parameterized = Boolean(v.generateScript || v.paramSlots?.length || /\{\{/.test(v.stem + v.options.map(o => o.text).join('')));
    if (parameterized && !row.sample) throw new Error('A selected parameterized question has no rendered sample. Export other questions or use script migration for that question.');
    const options = v.options.map(o => ({ ...o, ...(parameterized ? row.sample?.options.find(s => s.key === o.key) : {}) }));
    const correct = options.findIndex(o => o.role === 'correct');
    if (correct < 0) throw new Error('A selected question has no correct answer. Review it before exporting.');
    return [v.type, parameterized ? row.sample!.stem : v.stem,
      ...Array.from({length:4},(_,i)=>options[i]?.text ?? ''),
      v.type === 'true-false' ? ['T','F'][correct] : ['A','B','C','D'][correct],
      ...Array.from({length:4},(_,i)=>options[i]?.explanation ?? ''),
      ...Array.from({length:4},(_,i)=>options[i]?.role ?? ''),v.difficulty];
  })].map(row => row.map(quote).join(',')).join('\r\n');
}
