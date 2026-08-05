// Formula tokenizer. Splits a formula source string into tokens for the
// parser. Pure and total: never throws, returns an error string instead.
// See AGENTS.md in this folder.

export type Token =
  | { kind: 'num'; value: number }
  | { kind: 'ident'; name: string }
  | { kind: 'op'; op: '+' | '-' | '*' | '/' | '^' }
  | { kind: 'lparen' }
  | { kind: 'rparen' }
  | { kind: 'comma' };

export type TokenizeResult = { ok: true; tokens: Token[] } | { ok: false; error: string };

const OPERATORS = new Set(['+', '-', '*', '/', '^']);

export function tokenize(src: string): TokenizeResult {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1;
      continue;
    }
    if (ch >= '0' && ch <= '9') {
      let j = i;
      while (j < src.length && src[j] >= '0' && src[j] <= '9') j += 1;
      if (src[j] === '.') {
        j += 1;
        while (j < src.length && src[j] >= '0' && src[j] <= '9') j += 1;
      }
      const value = Number(src.slice(i, j));
      if (!Number.isFinite(value)) return { ok: false, error: `bad number at ${i}` };
      tokens.push({ kind: 'num', value });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j += 1;
      tokens.push({ kind: 'ident', name: src.slice(i, j) });
      i = j;
      continue;
    }
    if (OPERATORS.has(ch)) {
      tokens.push({ kind: 'op', op: ch as '+' | '-' | '*' | '/' | '^' });
      i += 1;
      continue;
    }
    if (ch === '(') {
      tokens.push({ kind: 'lparen' });
      i += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen' });
      i += 1;
      continue;
    }
    if (ch === ',') {
      tokens.push({ kind: 'comma' });
      i += 1;
      continue;
    }
    return { ok: false, error: `unexpected character '${ch}' at ${i}` };
  }
  return { ok: true, tokens };
}
