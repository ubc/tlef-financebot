// Deterministic AST evaluator. Every operation is IEEE-754 exact (+, -, *, /)
// except the deliberately-approximated builtins (ln, exp, fractional ^) — see
// R1 in the spec. Never rounds: R3 puts rounding in the renderer alone.
import type { Node } from './parser';
import { BUILTINS, BuiltinError } from './builtins';
import { intPow } from './pow';

export type EvalResult = { ok: true; value: number } | { ok: false; error: string };

export const SUM_TERM_CAP = 1000;
export const SUM_TOTAL_CAP = 10000;

class EvalError extends Error {}

function applyBinary(op: '+' | '-' | '*' | '/' | '^', left: number, right: number): number {
  switch (op) {
    case '+':
      return left + right;
    case '-':
      return left - right;
    case '*':
      return left * right;
    case '/':
      if (right === 0) throw new EvalError('division by zero');
      return left / right;
    case '^':
      return intPow(left, right);
  }
}

export function evaluateFormula(ast: Node, env: Record<string, number>): EvalResult {
  let sumTermsUsed = 0;

  function walk(node: Node, scope: Record<string, number>): number {
    switch (node.kind) {
      case 'num':
        return node.value;
      case 'var': {
        if (!Object.prototype.hasOwnProperty.call(scope, node.name)) {
          throw new EvalError(`unknown variable '${node.name}'`);
        }
        return scope[node.name];
      }
      case 'neg':
        return -walk(node.operand, scope);
      case 'binary':
        return applyBinary(node.op, walk(node.left, scope), walk(node.right, scope));
      case 'call': {
        const fn = BUILTINS[node.name];
        if (!fn) throw new EvalError(`unknown function '${node.name}'`);
        return fn(node.args.map((arg) => walk(arg, scope)));
      }
      case 'sum': {
        const from = walk(node.from, scope);
        const to = walk(node.to, scope);
        if (!Number.isInteger(from) || !Number.isInteger(to)) {
          throw new EvalError('SUM bounds must be integers');
        }
        const terms = to - from + 1;
        if (terms > SUM_TERM_CAP) throw new EvalError(`SUM exceeds ${SUM_TERM_CAP} terms`);
        sumTermsUsed += Math.max(0, terms);
        if (sumTermsUsed > SUM_TOTAL_CAP) throw new EvalError(`formula exceeds ${SUM_TOTAL_CAP} SUM terms`);
        let total = 0;
        for (let i = from; i <= to; i += 1) {
          total += walk(node.body, { ...scope, [node.index]: i });
        }
        return total;
      }
    }
  }

  try {
    const value = walk(ast, env);
    if (!Number.isFinite(value)) return { ok: false, error: 'result is not finite' };
    return { ok: true, value };
  } catch (error) {
    if (error instanceof EvalError || error instanceof BuiltinError) {
      return { ok: false, error: error.message };
    }
    return { ok: false, error: String(error) };
  }
}
