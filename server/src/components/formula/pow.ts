// R1's integer power. Its own module because both evaluate.ts and builtins.ts
// need it — putting it in either would make the two mutually dependent.

/**
 * R1: integer exponents use exponentiation by squaring — only `*` and `/`,
 * both exactly specified by IEEE 754, so the result is bit-identical across
 * platforms and Node versions. `Math.pow` is implementation-approximated per
 * ECMA-262 and is used ONLY for fractional exponents. This algorithm is
 * fixed: changing it changes stored answers and requires an
 * EVALUATOR_VERSION bump.
 */
export function intPow(base: number, exp: number): number {
  if (!Number.isInteger(exp)) return Math.pow(base, exp);
  let remaining = Math.abs(exp);
  let result = 1;
  let square = base;
  while (remaining > 0) {
    if (remaining % 2 === 1) result *= square;
    square *= square;
    remaining = Math.floor(remaining / 2);
  }
  return exp < 0 ? 1 / result : result;
}
