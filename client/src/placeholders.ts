// Placeholder display format.
//
// Questions STORE variables as `{{NAME}}` — that is what the server's
// `substituteParams` matches, and it must never change. But `{{NAME}}` reads
// badly in prose, so instructors see `[NAME]` everywhere instead.
//
// Read-only surfaces only need `toDisplayPlaceholders`. Editable ones (the
// stem textarea, option text inputs) must round-trip: display on load, store
// on save.

const STORED = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const DISPLAYED = /\[([A-Za-z_][A-Za-z0-9_]*)\]/g;

/** `{{NAME}}` -> `[NAME]`. Unambiguous in this direction: `{{…}}` has no other
 * meaning in question text. */
export function toDisplayPlaceholders(text: string): string {
  return text.replace(STORED, (_match, name: string) => `[${name}]`);
}

/**
 * `[NAME]` -> `{{NAME}}`, but ONLY for names in `knownNames`.
 *
 * The restriction is the whole safety argument. Square brackets appear in
 * ordinary prose — "[Note]", "[sic]", a bracketed citation — and blindly
 * converting them would silently turn real text into a placeholder that never
 * substitutes. Limiting the conversion to variables the question actually
 * declares makes the round-trip lossless for every other use of brackets.
 */
export function toStoredPlaceholders(text: string, knownNames: readonly string[]): string {
  const known = new Set(knownNames);
  return text.replace(DISPLAYED, (match, name: string) => (known.has(name) ? `{{${name}}}` : match));
}

/** Every variable a question declares — the names `toStoredPlaceholders` is
 * allowed to convert back. */
export function declaredVariableNames(version: {
  paramSlots?: Array<{ name: string }>;
  derivedValues?: Array<{ name: string }>;
}): string[] {
  return [
    ...(version.paramSlots ?? []).map((slot) => slot.name),
    ...(version.derivedValues ?? []).map((derived) => derived.name),
  ];
}
