// LaTeX that a model wrote inside a JSON string with single backslashes. Pure
// helpers with no provider dependency, so scripts can repair stored text
// without constructing the LLM module.

/** Doubles every backslash that does not begin a valid JSON escape, keeping
 * valid escapes (including an already-doubled `\\`) exactly as they are. A
 * LaTeX `\left`, `\sqrt` or `\ln` written with one backslash is not a JSON
 * escape at all, so without this the whole reply fails to parse. */
export function escapeInvalidJsonBackslashes(text: string): string {
  return text.replace(/\\(["\\/bfnrt]|u[0-9a-fA-F]{4})|\\/g, (whole, valid?: string) => (valid ? whole : '\\\\'));
}

/** A JSON escape that is also the start of a LaTeX command. When a model
 * writes `\times` with ONE backslash, JSON reads `\t` as a tab and the stored
 * text becomes TAB + "imes" (seen in generated explanations, 2026-09-14), and
 * likewise `\frac` (form feed), `\beta` (backspace) and `\right`/`\rho`
 * (carriage return). Models do not emit those control characters on purpose,
 * so one directly followed by a lowercase letter is put back as the command.
 * `\n` is deliberately NOT repaired: a real newline before a lowercase word is
 * ordinary prose, and `\nu`/`\neq` cannot be told apart from it. */
const SWALLOWED_LATEX_ESCAPES: Array<[RegExp, string]> = [
  [/\t(?=[a-z])/g, '\\t'],
  [/\f(?=[a-z])/g, '\\f'],
  // eslint-disable-next-line no-control-regex -- matching the decoded backspace is the point
  [/\x08(?=[a-z])/g, '\\b'],
  [/\r(?=[a-z])/g, '\\r'],
];

/** Walks a parsed JSON value and repairs swallowed LaTeX escapes in every string. */
export function restoreLatexEscapes(value: unknown): unknown {
  if (typeof value === 'string') {
    return SWALLOWED_LATEX_ESCAPES.reduce((text, [pattern, command]) => text.replace(pattern, command), value);
  }
  if (Array.isArray(value)) return value.map(restoreLatexEscapes);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, restoreLatexEscapes(entry)]));
  }
  return value;
}
