// Recursive-descent parser over the tokenizer's output. Produces an AST the
// evaluator walks. `^` is right-associative and binds tighter than unary
// minus, so -2^2 is -(2^2), matching mathematical convention.
import { tokenize, type Token } from './tokenizer';

export type Node =
  | { kind: 'num'; value: number }
  | { kind: 'var'; name: string }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/' | '^'; left: Node; right: Node }
  | { kind: 'neg'; operand: Node }
  | { kind: 'call'; name: string; args: Node[] }
  | { kind: 'sum'; index: string; from: Node; to: Node; body: Node };

export type ParseResult = { ok: true; ast: Node } | { ok: false; error: string };

class ParseError extends Error {}

export function parseFormula(src: string): ParseResult {
  const tokenized = tokenize(src);
  if (!tokenized.ok) return { ok: false, error: tokenized.error };
  const tokens = tokenized.tokens;
  let pos = 0;

  const peek = (): Token | undefined => tokens[pos];
  const next = (): Token | undefined => {
    const token = tokens[pos];
    pos += 1;
    return token;
  };

  function expect(kind: Token['kind']): void {
    const token = next();
    if (!token || token.kind !== kind) throw new ParseError(`expected ${kind}`);
  }

  // expression := term (('+' | '-') term)*
  function parseExpression(): Node {
    let left = parseTerm();
    for (;;) {
      const token = peek();
      if (token?.kind === 'op' && (token.op === '+' || token.op === '-')) {
        pos += 1;
        left = { kind: 'binary', op: token.op, left, right: parseTerm() };
      } else return left;
    }
  }

  // term := unary (('*' | '/') unary)*
  function parseTerm(): Node {
    let left = parseUnary();
    for (;;) {
      const token = peek();
      if (token?.kind === 'op' && (token.op === '*' || token.op === '/')) {
        pos += 1;
        left = { kind: 'binary', op: token.op, left, right: parseUnary() };
      } else return left;
    }
  }

  // unary := '-' unary | power
  function parseUnary(): Node {
    const token = peek();
    if (token?.kind === 'op' && token.op === '-') {
      pos += 1;
      return { kind: 'neg', operand: parseUnary() };
    }
    return parsePower();
  }

  // power := primary ('^' unary)?   — right-associative
  function parsePower(): Node {
    const base = parsePrimary();
    const token = peek();
    if (token?.kind === 'op' && token.op === '^') {
      pos += 1;
      return { kind: 'binary', op: '^', left: base, right: parseUnary() };
    }
    return base;
  }

  function parsePrimary(): Node {
    const token = next();
    if (!token) throw new ParseError('unexpected end of formula');
    if (token.kind === 'num') return { kind: 'num', value: token.value };
    if (token.kind === 'lparen') {
      const inner = parseExpression();
      expect('rparen');
      return inner;
    }
    if (token.kind === 'ident') {
      if (peek()?.kind !== 'lparen') return { kind: 'var', name: token.name };
      pos += 1; // consume '('
      // SUM(index, from, to, body) binds `index` inside `body` only.
      if (token.name === 'SUM') {
        const indexToken = next();
        if (!indexToken || indexToken.kind !== 'ident') throw new ParseError('SUM index must be a name');
        expect('comma');
        const from = parseExpression();
        expect('comma');
        const to = parseExpression();
        expect('comma');
        const body = parseExpression();
        expect('rparen');
        return { kind: 'sum', index: indexToken.name, from, to, body };
      }
      const args: Node[] = [];
      if (peek()?.kind === 'rparen') pos += 1;
      else {
        for (;;) {
          args.push(parseExpression());
          const sep = next();
          if (sep?.kind === 'rparen') break;
          if (sep?.kind !== 'comma') throw new ParseError('expected , or ) in argument list');
        }
      }
      return { kind: 'call', name: token.name, args };
    }
    throw new ParseError(`unexpected token ${token.kind}`);
  }

  try {
    const ast = parseExpression();
    if (pos !== tokens.length) return { ok: false, error: 'trailing input after formula' };
    return { ok: true, ast };
  } catch (error) {
    return { ok: false, error: error instanceof ParseError ? error.message : String(error) };
  }
}
