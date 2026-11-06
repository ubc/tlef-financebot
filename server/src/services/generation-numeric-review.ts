import { createHash } from 'node:crypto';
import { z } from 'zod';
import { EVALUATOR_VERSION, parseFormula, SUM_TERM_CAP, type Node } from '../components/formula';
import { IRR_MAX_ITERATIONS } from '../components/formula/builtins';
import type { DerivedValue, ParamSlot } from '../types/domain';
import type { GenerationNumericReviewAvailable, GenerationNumericReviewReceipt, GenerationNumericReviewRuntime, GenerationNumericReviewWitness, NumericReviewUnavailableReason } from '../types/generation-numeric-review';
import { describeFiniteSlotDomain } from './finite-slot-domain';
import { numericInputDisplayFailure } from './numeric-input-display.service';
import { formatParamValue, substituteParams } from './parameter-display';

export const NUMERIC_REVIEW_PROTOCOL = 'server-rendered-numeric-review-v1' as const;
export const NUMERIC_REVIEW_SAMPLE_SEED = 1_000_003;
export const MAX_NUMERIC_REVIEW_WITNESS_UTF8 = 8_000;
const MAX_AST_NODES = 256;
const MAX_AST_DEPTH = 32;
const MAX_FORMULA_WORK_PER_DRAW = 20_000;
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unavailable = (reason: NumericReviewUnavailableReason): GenerationNumericReviewWitness => ({ version: NUMERIC_REVIEW_PROTOCOL, status: 'unavailable', reason });
const name = z.string().max(64).regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const finite = z.number().finite();
const slotSchema = z.object({ name, description: z.string().max(1_000).optional(), min: finite.optional(), max: finite.optional(), step: finite.optional(), values: z.array(finite).min(1).max(256).optional() }).strict();
const derivedSchema = z.object({ name, formula: z.string().min(1).max(512), errorModel: z.string().max(2_000).optional() }).strict();
const optionSchema = z.object({ key: z.string().min(1).max(16), text: z.string().min(1).max(4_000), role: z.enum(['correct', 'common-misconception', 'partially-correct', 'clearly-wrong']), explanation: z.string().max(8_000) }).strict();
const templateSchema = z.object({ type: z.enum(['mcq', 'true-false']), stem: z.string().min(1).max(16_000), options: z.array(optionSchema).min(2).max(4), numericKind: z.enum(['numeric', 'conceptual']).optional(), paramSlots: z.array(slotSchema).max(16), derivedValues: z.array(derivedSchema).max(32) }).strict();

/** Read only plain own data fields, never accessors, model proof/status fields or
 * inherited definitions. The full enclosing candidate is not replaced here. */
function plainData(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype) {
    // structuredClone/BSON/test realms can supply another native Object
    // prototype. Accept its own data, never inherited properties or classes.
    const ctor = Object.getOwnPropertyDescriptor(proto, 'constructor');
    if (Object.getPrototypeOf(proto) !== null || !ctor || !Object.hasOwn(ctor, 'value')
      || typeof ctor.value !== 'function' || Function.prototype.toString.call(ctor.value) !== Function.prototype.toString.call(Object)) return undefined;
  }
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!Object.hasOwn(descriptor, 'value')) return undefined;
    out[key] = descriptor.value;
  }
  return out;
}

function plainRows(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  if (Object.keys(value).length !== value.length) return null;
  const out: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
    const row = plainData(descriptor.value);
    if (!row) return null;
    if (Object.hasOwn(row, 'values')) {
      const values = row.values;
      if (Array.isArray(values)) {
        if (Object.keys(values).length !== values.length) return null;
        const copied: unknown[] = [];
        for (let i = 0; i < values.length; i += 1) {
          const d = Object.getOwnPropertyDescriptor(values, String(i));
          if (!d || !Object.hasOwn(d, 'value')) return null;
          copied.push(d.value);
        }
        row.values = copied;
      }
    }
    out.push(row);
  }
  return out;
}

/** Conservative structural work bound for this additional adapter. The real
 * evaluator still enforces its own SUM/IRR caps and arithmetic semantics. A
 * dynamic SUM is costed at the existing per-SUM ceiling; a literal range uses
 * its full exact length. Excessive work means unavailable, not invalid source. */
function formulaWork(ast: Node, state: { nodes: number }, depth = 0): number {
  state.nodes += 1;
  if (state.nodes > MAX_AST_NODES || depth > MAX_AST_DEPTH) return Infinity;
  switch (ast.kind) {
    case 'num': case 'var': return 1;
    case 'neg': return 1 + formulaWork(ast.operand, state, depth + 1);
    case 'binary': return 1 + formulaWork(ast.left, state, depth + 1) + formulaWork(ast.right, state, depth + 1);
    case 'call': return 1 + ast.args.reduce((sum, arg) => sum + formulaWork(arg, state, depth + 1), 0)
      + (ast.name === 'IRR' ? 4 * IRR_MAX_ITERATIONS * ast.args.length : 0);
    case 'sum': {
      const terms = ast.from.kind === 'num' && ast.to.kind === 'num' ? Math.max(0, ast.to.value - ast.from.value + 1) : SUM_TERM_CAP;
      return 1 + formulaWork(ast.from, state, depth + 1) + formulaWork(ast.to, state, depth + 1)
        + terms * formulaWork(ast.body, state, depth + 1);
    }
  }
}

/** Adds one server-rendered example to a semantic review. Runtime functions
 * must be the trusted existing pure verifier/resolver, never model callbacks.
 * No stored verification, role label or numerical result grants source/teacher
 * approval. Unknown, oversized or unsupported templates have no witness. */
export function buildGenerationNumericReviewWitness(candidate: unknown, runtime: GenerationNumericReviewRuntime): GenerationNumericReviewWitness {
  try {
    const raw = plainData(candidate);
    if (!raw) return unavailable('invalid-candidate');
    if (raw.generateScript !== undefined && raw.generateScript !== '') return unavailable('script-not-supported');
    const parsed = templateSchema.safeParse({ type: raw.type, stem: raw.stem, options: plainRows(raw.options),
      ...(raw.numericKind !== undefined ? { numericKind: raw.numericKind } : {}),
      paramSlots: plainRows(raw.paramSlots === undefined ? [] : raw.paramSlots), derivedValues: plainRows(raw.derivedValues === undefined ? [] : raw.derivedValues) });
    if (!parsed.success) return unavailable('invalid-candidate');
    const template = parsed.data;
    const slots: ParamSlot[] = template.paramSlots, derived: DerivedValue[] = template.derivedValues;
    if (!slots.length && !derived.length) {
      if (template.numericKind === 'numeric') return unavailable('numeric-definitions-missing');
      return runtime.placeholderSyntaxFailure(template, []) ? unavailable('invalid-template')
        : { version: NUMERIC_REVIEW_PROTOCOL, status: 'not-applicable', reason: 'no-numeric-template' };
    }
    if (template.numericKind !== 'numeric') return unavailable('invalid-candidate');
    if (template.type !== 'mcq' || template.options.length !== 4) return unavailable('unsupported-numeric-type');
    const correct = template.options.filter(option => option.role === 'correct');
    if (correct.length !== 1 || new Set(template.options.map(option => option.key)).size !== template.options.length) return unavailable('invalid-candidate');
    if (!derived.length) return unavailable('numeric-definitions-missing');
    const names = [...slots, ...derived].map(row => row.name);
    const reserved = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);
    if (new Set(names).size !== names.length || names.some(n => reserved.has(n))) return unavailable('ambiguous-parameter-names');
    if (slots.some(slot => !describeFiniteSlotDomain(slot).ok)) return unavailable('invalid-parameter-domain');
    const state = { nodes: 0 }; let work = 0;
    for (const definition of derived) {
      const ast = parseFormula(definition.formula);
      if (!ast.ok) return unavailable('unsupported-formula-complexity');
      work += formulaWork(ast.ast, state);
      if (work > MAX_FORMULA_WORK_PER_DRAW) return unavailable('unsupported-formula-complexity');
    }
    if (runtime.placeholderSyntaxFailure(template, names)) return unavailable('invalid-template');
    const optionValues = runtime.optionValueNamesForVerification(template.options.map(option => option.text), derived.map(row => row.name));
    if (!optionValues.ok) return unavailable('option-value-missing');
    const optionNames = optionValues.names, currency = optionValues.currency;
    if (!runtime.optionFormatsConsistent(template.options.map(option => option.text)).ok) return unavailable('option-format-mismatch');
    if (runtime.undisplayedInputs({ slots, derivedValues: derived, rootName: optionNames[template.options.indexOf(correct[0]!)]!, stem: template.stem }).length) return unavailable('undisplayed-input');
    const checked = runtime.verifyQuestionNumerics({ stem: template.stem, slots, derivedValues: derived, optionValueNames: optionNames, optionCurrency: currency });
    if (!checked.ok) return unavailable('verification-failed');
    const proof = checked.verification, coverage = proof.parameterCoverage;
    if (proof.evaluatorVersion !== EVALUATOR_VERSION || proof.inputDisplayVersion !== 1
      || !Array.isArray(proof.sampleSeeds) || proof.sampleSeeds.length !== 100 || proof.sampleSeeds.some(seed => !Number.isSafeInteger(seed))
      || !coverage || coverage.version !== 'finite-slot-grid-v1'
      || !['sampled', 'exhaustive'].includes(coverage.mode) || coverage.maxCombinations !== 256
      || !Number.isSafeInteger(coverage.checkedCombinations) || coverage.checkedCombinations < 0
      || (coverage.totalCombinations !== null && (!Number.isSafeInteger(coverage.totalCombinations) || coverage.totalCombinations < 1))
      || (coverage.mode === 'exhaustive' && (coverage.totalCombinations !== coverage.checkedCombinations || coverage.checkedCombinations > 256))
      || (coverage.mode === 'sampled' && coverage.checkedCombinations !== 0)) return unavailable('invalid-verification-scope');
    const values = runtime.resolveSlotsAndDerived(slots, derived, NUMERIC_REVIEW_SAMPLE_SEED);
    const safeValues = plainData(values);
    if (!safeValues || Object.keys(safeValues).length !== names.length || names.some(n => !Object.hasOwn(safeValues, n) || typeof safeValues[n] !== 'number' || !Number.isFinite(safeValues[n]) || Math.abs(safeValues[n] as number) > 1e12)) return unavailable('draw-failed');
    if (numericInputDisplayFailure({ stem: template.stem, slots, derivedValues: derived, optionTexts: template.options.map(option => option.text), values })) return unavailable('input-display-mismatch');
    const rendered = template.options.map((option, index) => ({ ...option, text: substituteParams(option.text, values), explanation: substituteParams(option.explanation, values),
      valueName: optionNames[index]!, value: values[optionNames[index]!]!, displayedValue: formatParamValue(values[optionNames[index]!]!, { currency: currency[index] }) }));
    const stem = substituteParams(template.stem, values);
    if ([stem, ...rendered.flatMap(option => [option.text, option.explanation])].some(text => text.includes('{{'))) return unavailable('unresolved-template');
    if (new Set(rendered.map(option => option.text)).size !== 4 || new Set(rendered.map(option => option.displayedValue)).size !== 4) return unavailable('display-collision');
    const body: Omit<GenerationNumericReviewAvailable, 'bindingHash'> = { version: NUMERIC_REVIEW_PROTOCOL, status: 'available', templateHash: hash(template),
      sample: { seed: NUMERIC_REVIEW_SAMPLE_SEED, stem, declaredKey: correct[0]!.key, options: rendered, values: names.map(n => ({ name: n, value: values[n]! })) },
      verificationScope: { evaluatorVersion: proof.evaluatorVersion, inputDisplayVersion: proof.inputDisplayVersion, sampleCount: proof.sampleSeeds.length, sampleSeedsHash: hash(proof.sampleSeeds), parameterCoverage: { ...coverage } } };
    const result: GenerationNumericReviewAvailable = { ...body, bindingHash: hash(body) };
    return Buffer.byteLength(renderGenerationNumericReviewWitness(result), 'utf8') <= MAX_NUMERIC_REVIEW_WITNESS_UTF8 ? result : unavailable('witness-size-limit');
  } catch {
    return unavailable('draw-failed');
  }
}

/** Supplemental untrusted-to-the-model representation only. The existing full
 * candidate/source/memory/teacher payload and final serving guards still bind. */
export function renderGenerationNumericReviewWitness(result: GenerationNumericReviewWitness, originalCandidate?: unknown): string {
  if (result.status !== 'available') return 'SERVER NUMERIC EXAMPLE: unavailable/not-applicable is no pass or missing-premise waiver. Original source/teacher/Bank/candidate obligations remain.\n' + JSON.stringify(result);
  let originalFeedback: Map<string, string> | undefined;
  try {
    const raw = plainData(originalCandidate);
    const { bindingHash, ...body } = result;
    if (raw && (raw.generateScript === undefined || raw.generateScript === '') && hash(body) === bindingHash) {
      // Same exact schema/projection as the builder; candidate metadata and
      // model proof fields cannot authenticate a feedback reference. No data
      // is removed from the private witness or the complete original packet.
      const original = templateSchema.safeParse({ type: raw.type, stem: raw.stem, options: plainRows(raw.options),
        ...(raw.numericKind !== undefined ? { numericKind: raw.numericKind } : {}),
        paramSlots: plainRows(raw.paramSlots === undefined ? [] : raw.paramSlots), derivedValues: plainRows(raw.derivedValues === undefined ? [] : raw.derivedValues) });
      if (original.success && hash(original.data) === result.templateHash) originalFeedback = new Map(original.data.options.map(option => [option.key, option.explanation]));
    }
  } catch { /* Unknown original identity keeps every rendered feedback string. */ }
  const packet = { seed: result.sample.seed, stem: result.sample.stem,
    options: result.sample.options.map(option => [option.key, option.text, originalFeedback?.get(option.key) === option.explanation ? null : option.explanation]),
    checks: { samples: result.verificationScope.sampleCount, grid: result.verificationScope.parameterCoverage.mode,
      checked: result.verificationScope.parameterCoverage.checkedCombinations, total: result.verificationScope.parameterCoverage.totalCombinations } };
  return 'SERVER NUMERIC EXAMPLE; arithmetic only, never source or semantic approval. Full original candidate/source/teacher/Bank obligations bind; key/roles are not certified. '
    + 'Wrong arithmetic need not be taught true if the taught formula refutes it; financial conditions/ambiguity still need review. '
    + 'options=[key,renderedText,renderedFeedback]; null feedback means unchanged COMPLETE original feedback for that key. One example is not all draws.\n'
    + JSON.stringify(packet);
}

/** Stable, bounded metadata for private persistence and fresh local replay.
 * No raw verification timestamp, rendered text or model verdict is trusted. */
export function numericReviewReceipt(result: GenerationNumericReviewWitness): GenerationNumericReviewReceipt {
  return result.status === 'available' ? { version: result.version, status: result.status, templateHash: result.templateHash,
    bindingHash: result.bindingHash, seed: result.sample.seed, verificationScope: { ...result.verificationScope,
      parameterCoverage: { ...result.verificationScope.parameterCoverage } } } : { ...result };
}

export type { GenerationNumericReviewRuntime, GenerationNumericReviewWitnessResult, GenerationNumericReviewReceipt } from '../types/generation-numeric-review';
