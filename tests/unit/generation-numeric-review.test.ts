// Real closed-formula arithmetic/display helpers; every external boundary denied.
jest.mock('../../server/src/components/param-worker', () => ({ executeGenerate: jest.fn(() => { throw new Error('worker denied'); }) }));
jest.mock('../../server/src/config/env', () => { throw new Error('env load denied'); });

import { createHash } from 'node:crypto';
import { BSON } from 'mongodb';
import retained from '../fixtures/generation-quality/retained-review-size-2026-10-17.json';
import { executeGenerate } from '../../server/src/components/param-worker';
import { verifyQuestionNumerics, placeholderSyntaxFailure, optionFormatsConsistent, optionValueNamesForVerification, undisplayedInputs } from '../../server/src/services/numeric-verification.service';
import { resolveSlotsAndDerived } from '../../server/src/services/params.service';
import { substituteParams } from '../../server/src/services/parameter-display';
import { buildGenerationNumericReviewWitness, renderGenerationNumericReviewWitness, numericReviewReceipt, MAX_NUMERIC_REVIEW_WITNESS_UTF8, NUMERIC_REVIEW_SAMPLE_SEED } from '../../server/src/services/generation-numeric-review';
import type { GenerationNumericReviewAvailable, GenerationNumericReviewRuntime, GenerationNumericReviewWitness } from '../../server/src/types/generation-numeric-review';
import type { ParamSlot, DerivedValue, QuestionOption } from '../../server/src/types/domain';

interface Template {
  type: 'mcq'; stem: string; numericKind: 'numeric'; options: QuestionOption[];
  paramSlots: ParamSlot[]; derivedValues: DerivedValue[];
  [key: string]: unknown;
}
const runtime: GenerationNumericReviewRuntime = { verifyQuestionNumerics, resolveSlotsAndDerived, placeholderSyntaxFailure, optionFormatsConsistent, optionValueNamesForVerification, undisplayedInputs };
function example(id = 'CAPM'): Template {
  const row = retained.cases.find(value => value.id === id)!;
  return structuredClone({ ...row.candidate, type: row.type }) as unknown as Template;
}
function available(result: GenerationNumericReviewWitness): GenerationNumericReviewAvailable {
  if (result.status !== 'available') throw new Error(JSON.stringify(result));
  expect(result.status).toBe('available');
  return result;
}
function simple(): Template {
  return { type: 'mcq', numericKind: 'numeric', stem: 'For X={{X}}, compute X+1.', paramSlots: [{ name: 'X', values: [10, 11] }],
    derivedValues: ['A', 'B', 'C', 'D'].map((name, index) => ({ name, formula: `X+${index + 1}` })),
    options: ['A', 'B', 'C', 'D'].map((key, index) => ({ key, role: index === 0 ? 'correct' : 'clearly-wrong', text: `{{${key}}}`, explanation: `For X={{X}}, this calculation gives {{${key}}}.` })) };
}
beforeEach(() => jest.clearAllMocks());
afterEach(() => expect(executeGenerate).not.toHaveBeenCalled());

describe('additional deterministic numerical review representation', () => {
  it.each([['P03', 16], ['CAPM', 27]] as const)('renders retained %s through exact serving arithmetic/display with fresh finite scope', (id, count) => {
    const candidate = example(id), before = structuredClone(candidate);
    const result = available(buildGenerationNumericReviewWitness(candidate, runtime));
    const values = resolveSlotsAndDerived(candidate.paramSlots, candidate.derivedValues, NUMERIC_REVIEW_SAMPLE_SEED);
    expect(result.sample.stem).toBe(substituteParams(candidate.stem, values));
    expect(result.sample.values).toEqual([...candidate.paramSlots, ...candidate.derivedValues].map(row => ({ name: row.name, value: values[row.name] })));
    expect(result.sample.options).toHaveLength(4);
    for (let index = 0; index < 4; index += 1) {
      expect(result.sample.options[index]).toMatchObject({ key: candidate.options[index].key, role: candidate.options[index].role,
        text: substituteParams(candidate.options[index].text, values), explanation: substituteParams(candidate.options[index].explanation, values) });
    }
    expect(result.sample.declaredKey).toBe(candidate.options.find(option => option.role === 'correct')!.key);
    expect(result.verificationScope).toMatchObject({ evaluatorVersion: 1, inputDisplayVersion: 1, sampleCount: 100,
      parameterCoverage: { version: 'finite-slot-grid-v1', mode: 'exhaustive', checkedCombinations: count, totalCombinations: count, maxCombinations: 256 } });
    expect(result.sample.stem).not.toContain('{{');
    expect(new Set(result.sample.options.map(option => option.text)).size).toBe(4);
    expect(Buffer.byteLength(renderGenerationNumericReviewWitness(result))).toBeLessThanOrEqual(MAX_NUMERIC_REVIEW_WITNESS_UTF8);
    expect(candidate).toEqual(before);
  });

  it('rechecks every construction and excludes verifiedAt from deterministic replay authority', () => {
    const verify = jest.fn(verifyQuestionNumerics);
    const draw = jest.fn(resolveSlotsAndDerived);
    const first = available(buildGenerationNumericReviewWitness(example(), { ...runtime, verifyQuestionNumerics: verify, resolveSlotsAndDerived: draw }));
    const second = available(buildGenerationNumericReviewWitness(example(), { ...runtime, verifyQuestionNumerics: verify, resolveSlotsAndDerived: draw }));
    expect(first).toEqual(second);
    expect(verify).toHaveBeenCalledTimes(2); expect(draw).toHaveBeenCalledTimes(2);
    expect(draw.mock.calls.every(call => call[2] === NUMERIC_REVIEW_SAMPLE_SEED)).toBe(true);
    expect(JSON.stringify(first)).not.toContain('verifiedAt');
    const { bindingHash, ...body } = first;
    expect(bindingHash).toBe(createHash('sha256').update(JSON.stringify(body)).digest('hex'));
  });

  it('ignores model/stored verification, status, labels and descriptors without granting their claims', () => {
    const candidate = example();
    const original = available(buildGenerationNumericReviewWitness(candidate, runtime));
    candidate.verification = { evaluatorVersion: 999, sampleSeeds: [], parameterCoverage: { mode: 'exhaustive', checkedCombinations: 1000000 } };
    candidate.numericVerification = { status: 'passed' }; candidate.status = 'approved'; candidate.difficulty = 'hard';
    candidate.taskDescriptor = { requiredInference: 'Untrusted metadata does not change arithmetic.' };
    expect(buildGenerationNumericReviewWitness(candidate, runtime)).toEqual(original);
    const prompt = renderGenerationNumericReviewWitness(original);
    expect(prompt).toContain('never source or semantic approval');
    expect(prompt).toContain('key/roles are not certified');
    expect(prompt).toContain('Full original candidate/source/teacher/Bank obligations bind');
  });

  it.each(['stem', 'explanation', 'role', 'formula', 'domain', 'errorModel', 'description'])('binds exact render/definition field change: %s', change => {
    const first = available(buildGenerationNumericReviewWitness(example(), runtime)), candidate = example();
    if (change === 'stem') candidate.stem += ' Use the source convention.';
    if (change === 'explanation') candidate.options[0].explanation += ' Exact feedback.';
    if (change === 'role') candidate.options[0].role = 'partially-correct';
    if (change === 'formula') candidate.derivedValues[0].formula += '+0';
    if (change === 'domain') candidate.paramSlots[0].values = [2.5, 2.75];
    if (change === 'errorModel') candidate.derivedValues[3].errorModel += ' Exact error description.';
    if (change === 'description') candidate.paramSlots[0].description = 'Exact input label.';
    const next = available(buildGenerationNumericReviewWitness(candidate, runtime));
    expect(next.templateHash).not.toBe(first.templateHash); expect(next.bindingHash).not.toBe(first.bindingHash);
  });

  it('normalizes absent/undefined optional numeric fields and produces JSON/BSON-safe metadata copies', () => {
    const first = example(), second = example();
    second.paramSlots.forEach(slot => { slot.min = undefined; slot.description = undefined; });
    second.derivedValues[0].errorModel = undefined;
    const result = available(buildGenerationNumericReviewWitness(first, runtime));
    expect(buildGenerationNumericReviewWitness(second, runtime)).toEqual(result);
    const receipt = numericReviewReceipt(result);
    expect(JSON.parse(JSON.stringify(receipt))).toEqual(receipt);
    if (receipt.status !== 'available') throw new Error('missing receipt');
    receipt.verificationScope.parameterCoverage.checkedCombinations = 0;
    expect(result.verificationScope.parameterCoverage.checkedCombinations).toBe(27);
    expect(JSON.stringify(receipt)).not.toContain('stem');
  });

  it('rebuilds the exact sample and receipt after actual BSON candidate/receipt round trips', () => {
    const candidate = example(), result = available(buildGenerationNumericReviewWitness(candidate, runtime));
    const restored = BSON.deserialize(BSON.serialize(candidate));
    const next = available(buildGenerationNumericReviewWitness(restored, runtime));
    expect(next).toEqual(result);
    expect(numericReviewReceipt(next)).toEqual(BSON.deserialize(BSON.serialize(numericReviewReceipt(result))));
  });

  it('records a large domain as sampled rather than an exhaustive guarantee', () => {
    const candidate = simple(); candidate.paramSlots = [{ name: 'X', min: 1, max: 300, step: 1 }];
    expect(available(buildGenerationNumericReviewWitness(candidate, runtime)).verificationScope.parameterCoverage)
      .toMatchObject({ mode: 'sampled', totalCombinations: 300, checkedCombinations: 0, reason: 'combination-limit' });
  });

  it.each(['SUM(t,1,3,X/t)', 'IRR(0-X,60,60)*100', 'PV(0.1,2,X)+FV(0.1,2,X)+PMT(0.1,2,X)+NPV(0.1,X,X)+N(0)'])('uses the safe production evaluator for %s', formula => {
    const candidate = simple(); candidate.paramSlots = [{ name: 'X', values: [100, 110] }];
    candidate.derivedValues[0].formula = formula;
    candidate.derivedValues.slice(1).forEach((row, index) => { row.formula = `A+${index + 1}`; });
    expect(buildGenerationNumericReviewWitness(candidate, runtime).status).toBe('available');
  });

  it('preserves production currency and LaTeX grouping at display substitution', () => {
    const candidate = simple(); candidate.stem = 'For X=${{X}}, compute X+1 and read $z^{ {{X}} }$.';
    candidate.options.forEach(option => { option.text = '$' + option.text; });
    const result = available(buildGenerationNumericReviewWitness(candidate, runtime));
    expect(result.sample.stem).toContain('X=$'); expect(result.sample.stem).toMatch(/z\^\{ \d+ \}/);
    expect(result.sample.options.every(option => option.text.startsWith('$'))).toBe(true);
  });
});

describe('lossless compact model representation with exact original references', () => {
  function packet(result: GenerationNumericReviewWitness, original?: unknown): { stem: string; options: Array<[string, string, string | null]>; checks: { samples: number; grid: string; checked: number; total: number } } {
    return JSON.parse(renderGenerationNumericReviewWitness(result, original).split('\n').slice(1).join('\n'));
  }

  it.each(['P03', 'CAPM'])('references only exact unchanged %s feedback and keeps the complete private proof/sample intact', id => {
    const candidate = example(id), result = available(buildGenerationNumericReviewWitness(candidate, runtime));
    const before = structuredClone(result), originalBefore = structuredClone(candidate);
    const projected = packet(result, candidate);
    expect(projected.stem).toBe(result.sample.stem);
    expect(projected.options).toEqual(result.sample.options.map(option => [option.key, option.text, null]));
    expect(projected.checks).toEqual({ samples: 100, grid: 'exhaustive', checked: id === 'P03' ? 16 : 27, total: id === 'P03' ? 16 : 27 });
    expect(Buffer.byteLength(renderGenerationNumericReviewWitness(result, candidate))).toBeLessThan(1_250);
    expect(result).toEqual(before); expect(candidate).toEqual(originalBefore);
    expect(result.sample.values.length).toBe(candidate.paramSlots.length + candidate.derivedValues.length);
    expect(projected).not.toHaveProperty('declaredKey'); expect(projected).not.toHaveProperty('bindingHash');
    expect(renderGenerationNumericReviewWitness(result, candidate)).toContain('null feedback means unchanged COMPLETE original feedback for that key');
  });

  it('keeps substituted feedback complete and references only a truly unchanged same-key explanation', () => {
    const candidate = simple(); candidate.options[0].explanation = 'This exact explanation contains no placeholder.';
    const result = available(buildGenerationNumericReviewWitness(candidate, runtime));
    const projected = packet(result, candidate);
    expect(projected.options[0][2]).toBeNull();
    for (let index = 1; index < 4; index += 1) {
      expect(projected.options[index][2]).toBe(result.sample.options[index].explanation);
      expect(projected.options[index][2]).not.toContain('{{');
    }
  });

  it.each(['missing', 'changed-stem', 'changed-formula', 'changed-key', 'copied-model-hash'])('falls back to all full feedback for %s original identity', change => {
    const candidate = example(), result = available(buildGenerationNumericReviewWitness(candidate, runtime));
    const different = structuredClone(candidate);
    if (change === 'changed-stem' || change === 'copied-model-hash') different.stem += ' Exact different clause.';
    if (change === 'changed-formula') different.derivedValues[0].formula += '+0';
    if (change === 'changed-key') different.options[0].key = 'FOREIGN';
    if (change === 'copied-model-hash') different.templateHash = result.templateHash;
    expect(packet(result, change === 'missing' ? undefined : different).options)
      .toEqual(result.sample.options.map(option => [option.key, option.text, option.explanation]));
  });

  it('does not authenticate null references from a forged or mutated witness binding', () => {
    const candidate = example(), result = available(buildGenerationNumericReviewWitness(candidate, runtime));
    for (const field of ['binding', 'feedback'] as const) {
      const tampered = structuredClone(result);
      if (field === 'binding') tampered.bindingHash = '0'.repeat(64);
      else tampered.sample.options[0].explanation += ' Tampered sample feedback.';
      expect(packet(tampered, candidate).options.every(option => typeof option[2] === 'string')).toBe(true);
    }
  });

  it('does not invoke an original-candidate accessor to decide a feedback reference', () => {
    const candidate = example(), result = available(buildGenerationNumericReviewWitness(candidate, runtime));
    const getter = jest.fn(() => candidate.stem);
    Object.defineProperty(candidate, 'stem', { get: getter });
    expect(packet(result, candidate).options.every(option => typeof option[2] === 'string')).toBe(true);
    expect(getter).not.toHaveBeenCalled();
  });
});

describe('no optimistic representation for invalid or unsupported inputs', () => {
  it.each([null, undefined, [], new Date(), 'candidate', 1])('rejects non-plain input %p', value => {
    expect(buildGenerationNumericReviewWitness(value, runtime).status).toBe('unavailable');
  });

  it('never invokes accessors or legacy generate scripts', () => {
    const getter = jest.fn(() => [1]); const candidate = simple();
    Object.defineProperty(candidate.paramSlots[0], 'values', { get: getter });
    expect(buildGenerationNumericReviewWitness(candidate, runtime).status).toBe('unavailable'); expect(getter).not.toHaveBeenCalled();
    const scripted = { ...simple(), generateScript: 'while(true){}' };
    expect(buildGenerationNumericReviewWitness(scripted, runtime)).toMatchObject({ status: 'unavailable', reason: 'script-not-supported' });
  });

  it.each(['__proto__', 'constructor', 'toString', 'prototype'])('refuses unsafe namespace %s', name => {
    const candidate = simple(); candidate.paramSlots[0].name = name;
    expect(buildGenerationNumericReviewWitness(candidate, runtime)).toMatchObject({ status: 'unavailable', reason: 'ambiguous-parameter-names' });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects duplicate names, sparse arrays, nonfinite values and invalid explicit ranges', () => {
    const cases: Template[] = [];
    const duplicate = simple(); duplicate.derivedValues[0].name = 'X'; cases.push(duplicate);
    const sparse = simple(); sparse.paramSlots[0].values = new Array<number>(2); cases.push(sparse);
    const nonfinite = simple(); nonfinite.paramSlots[0].values = [Infinity]; cases.push(nonfinite);
    const range = simple(); range.paramSlots = [{ name: 'X', min: 1, max: 2, step: -1 }]; cases.push(range);
    for (const candidate of cases) expect(buildGenerationNumericReviewWitness(candidate, runtime).status).toBe('unavailable');
  });

  it('does not upgrade corrupt null numeric definitions or conceptual declarations into an available sample', () => {
    const candidate = simple();
    expect(buildGenerationNumericReviewWitness({ ...candidate, paramSlots: null }, runtime).status).toBe('unavailable');
    expect(buildGenerationNumericReviewWitness({ ...candidate, derivedValues: null }, runtime).status).toBe('unavailable');
    expect(buildGenerationNumericReviewWitness({ ...candidate, numericKind: 'conceptual' }, runtime).status).toBe('unavailable');
    expect(buildGenerationNumericReviewWitness({ ...candidate, numericKind: undefined }, runtime).status).toBe('unavailable');
    const nullOptional = simple(); nullOptional.paramSlots[0].description = undefined;
    const restoredNull = BSON.deserialize(BSON.serialize(nullOptional, { ignoreUndefined: false }));
    expect(restoredNull.paramSlots[0].description).toBeNull();
    expect(buildGenerationNumericReviewWitness(restoredNull, runtime).status).toBe('unavailable');
  });

  it.each(['bad-placeholder', 'hidden-input', 'literal-option', 'mixed-units', 'malformed-formula', 'same-answer'])('refuses %s even with a forged approved proof', kind => {
    const candidate = simple();
    if (kind === 'bad-placeholder') candidate.options[0].explanation = 'Bad {{X}/4} notation.';
    if (kind === 'hidden-input') candidate.stem = 'Compute X+1.';
    if (kind === 'literal-option') candidate.options[0].text = '11';
    if (kind === 'mixed-units') candidate.options[0].text += '%';
    if (kind === 'malformed-formula') candidate.derivedValues[0].formula = 'process.exit()';
    if (kind === 'same-answer') candidate.derivedValues[1].formula = 'A';
    candidate.verification = { status: 'passed', evaluatorVersion: 1, sampleSeeds: [1] };
    expect(buildGenerationNumericReviewWitness(candidate, runtime).status).toBe('unavailable');
  });

  it('refuses displayed-input precision drift rather than showing internally computed but unsolvable answers', () => {
    const candidate = simple(); candidate.paramSlots = [{ name: 'X', values: [0.333333] }];
    candidate.derivedValues[0].formula = 'X*1000'; candidate.derivedValues.slice(1).forEach((row, index) => { row.formula = `A+${index + 1}`; });
    expect(buildGenerationNumericReviewWitness(candidate, runtime)).toMatchObject({ status: 'unavailable', reason: 'verification-failed' });
  });

  it('independently rechecks fixed sample precision after the fresh verification dependency', () => {
    const proof = verifyQuestionNumerics({ stem: 'X={{X}}', slots: [{ name: 'X', values: [10] }],
      derivedValues: simple().derivedValues, optionValueNames: ['A', 'B', 'C', 'D'] });
    const candidate = simple(); candidate.paramSlots = [{ name: 'X', values: [0.333333] }];
    candidate.derivedValues[0].formula = 'X*1000'; candidate.derivedValues.slice(1).forEach((row, index) => { row.formula = `A+${index + 1}`; });
    expect(buildGenerationNumericReviewWitness(candidate, { ...runtime, verifyQuestionNumerics: () => proof }))
      .toMatchObject({ status: 'unavailable', reason: 'input-display-mismatch' });
  });

  it('does not search for a lucky sample after a collision or verifier error', () => {
    const resolve = jest.fn(resolveSlotsAndDerived);
    const result = buildGenerationNumericReviewWitness(simple(), { ...runtime, verifyQuestionNumerics: () => ({ ok: false, error: 'scripted arithmetic failure' }), resolveSlotsAndDerived: resolve });
    expect(result).toMatchObject({ status: 'unavailable', reason: 'verification-failed' }); expect(resolve).not.toHaveBeenCalled();
  });

  it.each(['timestamp-only', 'missing-grid', 'forged-exhaustive'])('refuses stale/incomplete proof scope %s from an invalid adapter', kind => {
    const verify: GenerationNumericReviewRuntime['verifyQuestionNumerics'] = input => {
      const value = verifyQuestionNumerics(input);
      if (!value.ok) return value;
      if (kind === 'timestamp-only') delete value.verification.inputDisplayVersion;
      if (kind === 'missing-grid') delete value.verification.parameterCoverage;
      if (kind === 'forged-exhaustive') value.verification.parameterCoverage!.checkedCombinations = 999;
      return value;
    };
    expect(buildGenerationNumericReviewWitness(simple(), { ...runtime, verifyQuestionNumerics: verify }))
      .toMatchObject({ status: 'unavailable', reason: 'invalid-verification-scope' });
  });

  it('refuses excessive nested SUM work before invoking the verifier', () => {
    const candidate = simple(); candidate.derivedValues[0].formula = 'SUM(t,1,1000,SUM(k,1,1000,X))';
    const verify = jest.fn(verifyQuestionNumerics);
    expect(buildGenerationNumericReviewWitness(candidate, { ...runtime, verifyQuestionNumerics: verify }))
      .toMatchObject({ status: 'unavailable', reason: 'unsupported-formula-complexity' }); expect(verify).not.toHaveBeenCalled();
  });

  it('marks a full oversized witness unavailable without clipping text or altering the original packet', () => {
    const candidate = simple(); candidate.options.forEach(option => { option.explanation = 'Exact teacher-facing feedback. '.repeat(200); });
    const before = structuredClone(candidate);
    expect(buildGenerationNumericReviewWitness(candidate, runtime)).toMatchObject({ status: 'unavailable', reason: 'witness-size-limit' });
    expect(candidate).toEqual(before);
  });

  it('returns explicit not-applicable only for a valid conceptual template without numeric definitions', () => {
    expect(buildGenerationNumericReviewWitness({ type: 'true-false', numericKind: 'conceptual', stem: 'A source proposition.', options: [
      { key: 'A', role: 'correct', text: 'True', explanation: 'Taught correction.' }, { key: 'B', role: 'common-misconception', text: 'False', explanation: 'Taught correction.' }], paramSlots: [], derivedValues: [] }, runtime))
      .toMatchObject({ status: 'not-applicable', reason: 'no-numeric-template' });
    const numeric = simple(); numeric.paramSlots = []; numeric.derivedValues = [];
    expect(buildGenerationNumericReviewWitness(numeric, runtime)).toMatchObject({ status: 'unavailable', reason: 'numeric-definitions-missing' });
    expect(buildGenerationNumericReviewWitness({ ...numeric, numericKind: 'conceptual' }, runtime))
      .toMatchObject({ status: 'unavailable', reason: 'invalid-template' });
  });
});
