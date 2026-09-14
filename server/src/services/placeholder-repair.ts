// Deterministic repair of stored question text damaged by the placeholder/LaTeX
// brace collision and swallowed JSON escapes (2026-09-14). Pure: callers own
// persistence (scripts/repair-latex-placeholders.ts writes a new version).
import { restoreLatexEscapes } from '../components/genai/llm/latex-escapes';

const NAME = String.raw`[A-Za-z_]\w*`;

/** Index of the `}` that closes a group whose `{` sits just before `from`, or
 * -1 if the group does not close before the end of the math span (`$`). */
function closingBrace(text: string, from: number): number {
  let depth = 1;
  for (let index = from; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\\') { index += 1; continue; }
    if (char === '$') return -1;
    if (char === '{') depth += 1;
    if (char === '}' && (depth -= 1) === 0) return index;
  }
  return -1;
}

/**
 * Repairs one stem/option/explanation string:
 *  1. control characters left by a swallowed LaTeX escape (TAB+"imes" -> \times);
 *  2. a placeholder whose second closing brace merged into a LaTeX group —
 *     after `^`/`_` the group is the exponent (`^{{N}/4}` -> `^{ {{N}} /4}`);
 *     anywhere else the stray `}` closing the group is moved back onto the
 *     placeholder (`-{{DOWN}+\operatorname{PV}(r,4,T)}` -> `-{{DOWN}}+\operatorname{PV}(r,4,T)`);
 *  3. a complete placeholder used directly as a `^`, `_`, `\frac` or `\sqrt`
 *     argument gets its own group (`^{{N}}` -> `^{ {{N}} }`). substituteParams
 *     already renders these correctly; this makes the stored text unambiguous.
 * Returns the text unchanged when a broken placeholder cannot be attributed.
 */
export function repairPlaceholderText(input: string): string {
  let text = restoreLatexEscapes(input) as string;

  text = text.replace(new RegExp(String.raw`([\^_]\s*)\{\{\s*(${NAME})\s*\}(?!\})`, 'g'), '$1{ {{$2}} ');

  const unclosed = new RegExp(String.raw`\{\{\s*(${NAME})\s*\}(?!\})`, 'g');
  for (let match = unclosed.exec(text); match; match = unclosed.exec(text)) {
    const end = closingBrace(text, match.index + match[0].length);
    if (end === -1) continue;
    const fixed = `{{${match[1]}}}`;
    text = text.slice(0, match.index) + fixed + text.slice(match.index + match[0].length, end) + text.slice(end + 1);
    unclosed.lastIndex = match.index + fixed.length;
  }

  // No lookahead for a following `}`: `^{{N}}}` is usually the placeholder then
  // the close of an enclosing group (`\frac{C}{(1+r)^{{N}}}`), and an already
  // grouped `{{{N}}}` cannot match because its placeholder follows a `{`.
  return text.replace(
    new RegExp(String.raw`(?<=(?:[\^_]|\\[dt]?frac|\\sqrt)\s*)\{\{\s*(${NAME})\s*\}\}`, 'g'),
    '{ {{$1}} }',
  );
}
