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
 * What a LIST ROW should print for a question: the drawn student sample when the
 * server sent one, otherwise the template with readable `[NAME]` placeholders.
 *
 * Saurav, 2026-08-17: rows show the student view rather than the template,
 * "so it's easier on the eyes without the variables". The raw template still
 * has a home — the detail page, where it is the thing being edited.
 *
 * The fallback is not decoration. A `generateScript` question is never sampled
 * for a list (it would cost a worker thread per row), so those rows depend on
 * it, and a row must never render blank because a preview was unavailable.
 */
export function rowStemText(question: { current: { stem: string }; sample?: { stem: string } }): string {
  return question.sample ? question.sample.stem : toDisplayPlaceholders(question.current.stem);
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

/**
 * The names an editor may convert back to `{{NAME}}`: every declared variable,
 * plus every name the STORED text already uses as a placeholder. Without the
 * second set, saving any edit to a question whose `{{YEARS}}` has no variable
 * (the 2026-09-14 conceptual case) would store the display form `[YEARS]` as
 * literal text — the question would then pass the serving check and students
 * would read the brackets, with the warning gone.
 */
export function editableVariableNames(version: {
  stem: string;
  options: Array<{ text: string; explanation?: string }>;
  paramSlots?: Array<{ name: string }>;
  derivedValues?: Array<{ name: string }>;
}): string[] {
  const texts = [version.stem, ...version.options.flatMap((option) => [option.text, option.explanation ?? ''])];
  const used = texts.flatMap((text) => [...text.matchAll(STORED)].map((match) => match[1]!));
  return [...new Set([...declaredVariableNames(version), ...used])];
}

function listed(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * The editor's warning for placeholders the server reports it can never fill
 * (`unresolvablePlaceholders` — the same check that keeps the question from
 * being served). Undefined when there are none.
 */
export function unresolvedPlaceholderWarning(problems: readonly string[] | undefined): { title: string; body: string } | undefined {
  if (!problems || problems.length === 0) return undefined;
  const complete: string[] = [];
  const broken: string[] = [];
  for (const problem of problems) {
    const name = /^\{\{\s*([A-Za-z_]\w*)\s*\}\}$/.exec(problem)?.[1];
    if (name) complete.push(`[${name}]`);
    else broken.push(`"${problem}"`);
  }
  const sentences: string[] = [];
  if (complete.length > 0) {
    sentences.push(
      `It uses ${listed(complete)}, but no variable ${complete.length === 1 ? 'has that name' : 'has those names'}, `
        + `so a student would see the ${complete.length === 1 ? 'placeholder' : 'placeholders'} as written. `
        + 'Type the actual number in its place, or add the variable.',
    );
  }
  if (broken.length > 0) {
    sentences.push(
      `It contains ${listed(broken)}, a variable with broken braces that is never replaced. `
        + 'Rewrite it as [NAME].',
    );
  }
  return { title: 'Students are not being served this question', body: sentences.join(' ') };
}
