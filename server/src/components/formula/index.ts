// Public API of the formula component. Consumers import from here only.
export { parseFormula, type Node, type ParseResult } from './parser';
export { intPow } from './pow';
export { evaluateFormula, SUM_TERM_CAP, SUM_TOTAL_CAP, type EvalResult } from './evaluate';
export { BUILTINS } from './builtins';

/**
 * R4: bumping this invalidates every stored `verification` proof at once.
 * Bump whenever evaluator arithmetic changes — the intPow algorithm, an IRR
 * constant, a builtin's formula, or the SUM caps.
 */
export const EVALUATOR_VERSION = 1;
