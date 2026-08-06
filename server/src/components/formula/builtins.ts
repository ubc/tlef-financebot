// Finance and math built-ins. These are shorthand, NOT the allowed formula
// set — arbitrary closed-form finance is expressible with arithmetic alone
// (CAPM is RF + BETA*MRP, Gordon growth is D1/(R-G)). See the spec.
import { intPow } from './pow';

// R2: IRR's convergence contract. Constants, not tunables — changing any of
// them changes stored answers and requires an EVALUATOR_VERSION bump.
export const IRR_GUESS = 0.1;
export const IRR_MAX_ITERATIONS = 100;
export const IRR_TOLERANCE = 1e-9;
export const IRR_BRACKET_LOW = -0.9999;
export const IRR_BRACKET_HIGH = 10;

export class BuiltinError extends Error {}

function requireArgs(name: string, args: number[], min: number): void {
  if (args.length < min) throw new BuiltinError(`${name} needs at least ${min} argument(s)`);
}

/** Net present value of cash flows at t=1..n, discounted at `rate`. */
function npv(rate: number, flows: number[]): number {
  let total = 0;
  for (let t = 0; t < flows.length; t += 1) total += flows[t] / intPow(1 + rate, t + 1);
  return total;
}

/** Cumulative standard normal, Abramowitz & Stegun 26.2.17 (|error| < 7.5e-8).
 * Deterministic: only +, -, *, / and one exp. */
function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return 0.5 * (1 + sign * (1 - poly * Math.exp(-z * z)));
}

/** NPV of the whole stream including the t=0 flow, which is what IRR drives
 * to zero. `flows[0]` is at t=0; the rest are discounted from t=1. */
function irrObjective(rate: number, flows: number[]): number {
  return flows[0] + npv(rate, flows.slice(1));
}

export const BUILTINS: Record<string, (args: number[]) => number> = {
  PV: (args) => {
    requireArgs('PV', args, 3);
    return args[2] / intPow(1 + args[0], args[1]);
  },
  FV: (args) => {
    requireArgs('FV', args, 3);
    return args[2] * intPow(1 + args[0], args[1]);
  },
  PMT: (args) => {
    requireArgs('PMT', args, 3);
    const [rate, periods, principal] = args;
    if (rate === 0) return principal / periods;
    return (principal * rate) / (1 - intPow(1 + rate, -periods));
  },
  NPV: (args) => {
    requireArgs('NPV', args, 2);
    return npv(args[0], args.slice(1));
  },
  IRR: (args) => {
    requireArgs('IRR', args, 2);
    // Newton from IRR_GUESS, then bisection over the bracket if it strays.
    let rate = IRR_GUESS;
    for (let i = 0; i < IRR_MAX_ITERATIONS; i += 1) {
      const value = irrObjective(rate, args);
      if (Math.abs(value) < IRR_TOLERANCE) return rate;
      const derivative = (irrObjective(rate + IRR_TOLERANCE, args) - value) / IRR_TOLERANCE;
      if (derivative === 0 || !Number.isFinite(derivative)) break;
      const stepped = rate - value / derivative;
      if (!Number.isFinite(stepped) || stepped <= IRR_BRACKET_LOW || stepped >= IRR_BRACKET_HIGH) break;
      rate = stepped;
    }
    let low = IRR_BRACKET_LOW;
    let high = IRR_BRACKET_HIGH;
    if (irrObjective(low, args) * irrObjective(high, args) > 0) {
      throw new BuiltinError('IRR did not converge');
    }
    for (let i = 0; i < IRR_MAX_ITERATIONS; i += 1) {
      const mid = (low + high) / 2;
      const value = irrObjective(mid, args);
      if (Math.abs(value) < IRR_TOLERANCE) return mid;
      if (irrObjective(low, args) * value > 0) low = mid;
      else high = mid;
    }
    throw new BuiltinError('IRR did not converge');
  },
  ln: (args) => {
    requireArgs('ln', args, 1);
    if (args[0] <= 0) throw new BuiltinError('ln needs a positive argument');
    return Math.log(args[0]);
  },
  exp: (args) => {
    requireArgs('exp', args, 1);
    return Math.exp(args[0]);
  },
  sqrt: (args) => {
    requireArgs('sqrt', args, 1);
    if (args[0] < 0) throw new BuiltinError('sqrt needs a non-negative argument');
    return Math.sqrt(args[0]);
  },
  abs: (args) => {
    requireArgs('abs', args, 1);
    return Math.abs(args[0]);
  },
  min: (args) => {
    requireArgs('min', args, 1);
    return Math.min(...args);
  },
  max: (args) => {
    requireArgs('max', args, 1);
    return Math.max(...args);
  },
  round: (args) => {
    requireArgs('round', args, 2);
    const factor = intPow(10, args[1]);
    return Math.round(args[0] * factor) / factor;
  },
  N: (args) => {
    requireArgs('N', args, 1);
    return normalCdf(args[0]);
  },
};
