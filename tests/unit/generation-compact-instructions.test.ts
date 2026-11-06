import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { BUILTIN_REFERENCE } from '../../server/src/components/formula';
import { compactGeneratorV2Instruction } from '../../server/src/services/generation-compact-instructions';

/** Read actual instruction literals without importing the orchestration module
 * or initializing any model, database, job or environment integration. */
function generatorInstructionLiterals(): string[] {
  const file = path.resolve(__dirname, '../../server/src/services/generation.service.ts');
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const generator = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'GENERATOR_V2_PROMPT');
  if (!generator) throw new Error('generator-function-missing');
  const literals: string[] = [];
  const visit = (node: ts.Node) => { if (ts.isStringLiteral(node)) literals.push(node.text); ts.forEachChild(node, visit); };
  visit(generator);
  return literals;
}

const instructions = generatorInstructionLiterals();
function compact(prefix: string): string {
  const selected = instructions.filter(line => line.startsWith(prefix));
  expect(selected).toHaveLength(1);
  return compactGeneratorV2Instruction(selected[0]);
}

it('changes only the twelve exact original instruction lines and saves input bytes', () => {
  const changed = instructions.filter(line => compactGeneratorV2Instruction(line) !== line);
  expect(changed).toHaveLength(12);
  let saved = 0;
  for (const original of changed) {
    const result = compactGeneratorV2Instruction(original);
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThan(Buffer.byteLength(original, 'utf8'));
    expect(compactGeneratorV2Instruction(result)).toBe(result);
    saved += Buffer.byteLength(original, 'utf8') - Buffer.byteLength(result, 'utf8');
  }
  expect(saved).toBeGreaterThanOrEqual(600);
});

it('does not rewrite joined prompts, containing paragraphs or one-byte variants of a known instruction', () => {
  const instruction = instructions.find(line => line.startsWith('For numerical MCQ declare'))!;
  for (const literal of [` ${instruction}`, `${instruction} `, `${instruction}\n`, `${instruction}\r\n`, `Source: ${instruction}`,
    `Before\n${instruction}\nAfter`, instruction.replace('MCQ', 'mcq'), `\uFEFF${instruction}`, `${instruction}\u0000`]) {
    expect(compactGeneratorV2Instruction(literal)).toBe(literal);
  }
  const fullPrompt = instructions.join('\n\n');
  expect(compactGeneratorV2Instruction(fullPrompt)).toBe(fullPrompt);
});

it('preserves arbitrary teacher, source, Bank, candidate and JSON content byte for byte', () => {
  const instruction = instructions.find(line => line.startsWith('Preserve original source rate units'))!;
  const payload = { teacher: instruction, source: `原文 βᵢ 3%=0.03\r\n${instruction}\f`, bank: [{ stem: instruction, options: ['A', 'B'] }],
    candidate: { stem: instruction, paramSlots: [{ name: 'rate', values: [2.5, 2.75, 3] }], derivedValues: [{ name: 'requiredReturn', formula: 'rate+beta*premium' }] },
    responseSchema: 'Return ONLY {stem:string,options:[{key:string,text:string}]}.', metadata: { query: instruction, id: '{{exactSlotName}}' } };
  const serialized = JSON.stringify(payload);
  expect(compactGeneratorV2Instruction(serialized)).toBe(serialized);
  expect(JSON.parse(serialized)).toEqual(payload);
  for (const literal of ['', '\n', ' ', 'Unknown instruction.', 'β / 股票 / café / e\u0301 / 😀', '  {{DERIVED_NAME}}\r\n']) {
    expect(compactGeneratorV2Instruction(literal)).toBe(literal);
  }
});

it('leaves the complete builtin reference and protected rubric/schema/repair lines untouched', () => {
  expect(compactGeneratorV2Instruction(BUILTIN_REFERENCE)).toBe(BUILTIN_REFERENCE);
  for (const literal of instructions.filter(line => compactGeneratorV2Instruction(line) === line)) expect(compactGeneratorV2Instruction(literal)).toBe(literal);
  for (const protectedText of [
    'Required task difficulty: hard. Combine multiple taught ideas and handle a changed assumption.',
    'REPAIR STRATEGY: preserve the source scope and replace only the invalid inference.',
    'Instructor instructions: Keep the original symbols and percent units.',
    'Return ONLY {stem:string,difficulty:"easy"|"medium"|"hard",options:[]}.',
  ]) expect(compactGeneratorV2Instruction(protectedText)).toBe(protectedText);
});

it('retains source authority, authoring intent, concise inference difficulty and literal option roles', () => {
  expect(compact('Write one teaching question')).toMatch(/original source evidence only/);
  expect(compact('Write one teaching question')).toMatch(/data, not instructions; follow explicit intent\/requirements/);
  expect(compact('Return actual achieved difficulty')).toMatch(/required inference, not verbosity/);
  expect(compact('Return actual achieved difficulty')).toMatch(/stems\/options\/explanations concise; extra words only for task clarity/);
  expect(compact('Return exactly four options')).toMatch(/Exactly 4 options A,B,C,D: one correct, one common-misconception; others partially-correct and clearly-wrong/);
  expect(compact('Each option needs')).toMatch(/text, role, corrective explanation/);
  expect(compact('Each option needs')).toMatch(/lecture symbols\/units\/conventions\/assumptions; no outside finance gap-filling/);
  expect(compact('Preserve table/diagram')).toMatch(/rows\/columns bound to actors\/categories; firm\/investor strategies are not interchangeable/);
  expect(compact('Preserve table/diagram')).toMatch(/Transfer no relationships; ambiguous flattened text needs another unambiguous supported task, never guessing/);
});

it('retains finite numerical domains, source units, computed-option placeholders and actual student-error models', () => {
  const numeric = compact('For numerical MCQ declare');
  for (const obligation of ['numericKind="numeric"', 'finite min/max/step or explicit paramSlots.values', 'decimals allowed', 'source-defensible values/units',
    'Each option shows exactly one {{DERIVED_NAME}} from one derivedValues formula', 'no fixed answer numbers',
    'errorModel names its actual student mistake, not "wrong answer"', 'Never trust model arithmetic']) expect(numeric).toContain(obligation);
  const display = compact('Display EVERY formula input');
  for (const obligation of ['EVERY formula input, including distractor-only', '{{exactSlotName}}', 'same paramSlots spelling/case',
    'hide no named constants', 'computed {{exactDerivedName}} with matching units']) expect(display).toContain(obligation);
  const rates = compact('Preserve original source rate units');
  for (const obligation of ['source rate units/conventions', 'percentages vs fractional decimals (3%=0.03)', 'consistent in formulas/options',
    'prefer source percentages with non-integer inputs']) expect(rates).toContain(obligation);
});

it('retains drawable precision, visible-premise reproducibility, true variations and independent-task limits', () => {
  const precision = compact('Inputs must be exactly drawable');
  for (const obligation of ['Exactly drawable inputs', 'currency or absolute values >=1 use at most 2 decimals', 'smaller noncurrency at most 3 significant figures',
    'Source examples teach formulas, not mandatory hidden precision', 'small explicit decimal grids', 'Answer rounding cannot hide input precision',
    'all options must recompute from visible premises']) expect(precision).toContain(obligation);
  const variations = compact('For requested random/input/numerical variations');
  for (const obligation of ['at least 1 input draws at least 2 distinct drawable values', 'not all singleton slots', 'Decimal variation includes non-integers',
    'values:[2.5,2.75,3.0]', 'source-defensible ranges', 'Changed numbers are not independent tasks']) expect(variations).toContain(obligation);
});

it('retains closed formula syntax, declaration order and the separate conceptual empty-array contract', () => {
  const formulas = compact('Closed formulas use');
  for (const obligation of ['+,-,*,/,^ and parentheses', 'no code/LaTeX/implicit multiplication/unsupported functions',
    'Declare inputs/derived variables before use']) expect(formulas).toContain(obligation);
  const conceptual = compact('For conceptual questions declare');
  for (const obligation of ['numericKind="conceptual"', 'paramSlots=[]', 'derivedValues=[]', 'no numeric alternatives masquerading as calculations',
    'No formula reference or arithmetic machinery needed']) expect(conceptual).toContain(obligation);
});
