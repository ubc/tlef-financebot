import { evaluateFormula, parseFormula } from '../components/formula';
import { executeGenerate } from '../components/param-worker';
import type { DerivedValue, ParamSlot, QuestionVersion } from '../types/domain';

// -----------------------------------------------------------------------------
// Parameterization service (Task 5, IN-Q09/ST-P03/ST-R04): seeded value
// resolution for a QuestionVersion (either a `generateScript`, delegated to
// Task 4's sandboxed `executeGenerate`, or a seeded uniform draw per
// `paramSlots` entry) plus `{{name}}` placeholder substitution into stem/
// option text. Pure functions only — no DB/HTTP here; callers (serving,
// attempts, the question-params routes) own persistence and wire-shape.
// See server/src/services/AGENTS.md.
// -----------------------------------------------------------------------------

/** Draws a fresh per-serve seed (brief's exact formula) — `Date.now() ^
 * random`. Called on every `/practice/next` response (ST-R04's "fresh seed
 * on re-practice" therefore falls out for free: there is exactly one
 * question-serving call site, see serving.service.ts's module docstring)
 * and again whenever attempts.service.ts serves a fresh Strategy-A retry
 * question. */
export function drawSeed(): number {
  return Date.now() ^ Math.floor(Math.random() * 0xffffffff);
}

/**
 * Deterministic PRNG seeded by a plain number (mulberry32) — NOT
 * cryptographic, just fast and stable so the same `seed` always reproduces
 * the same draw sequence (ST-P03: values are fixed for an attempt; a client
 * that re-derives from the same seed must get the same numbers). Distinct
 * from Task 4's in-worker seeded RNG (worker.js has its own, used only for
 * `generateScript`); this one backs the `paramSlots` draw path.
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One slot's draw: a value from `values` (seeded pick) if given, else a
 * seeded uniform draw over the inclusive `[min, max]` range stepped by
 * `step` — `min + step * floor(random() * ((max - min) / step + 1))`
 * (brief's exact formula). `min`/`max`/`step` default to 0/0/1 when absent
 * so a malformed slot degrades to a constant 0 rather than throwing.
 */
function drawSlot(slot: ParamSlot, rand: () => number): number {
  if (slot.values && slot.values.length > 0) {
    const idx = Math.min(slot.values.length - 1, Math.floor(rand() * slot.values.length));
    return slot.values[idx];
  }
  const min = slot.min ?? 0;
  const max = slot.max ?? min;
  const step = slot.step && slot.step !== 0 ? slot.step : 1;
  const count = Math.floor((max - min) / step) + 1;
  const idx = Math.min(count - 1, Math.floor(rand() * count));
  return min + step * idx;
}

/**
 * Draws every slot, then evaluates every `derivedValue` formula in declaration
 * order so a later formula may reference an earlier one by name. Returns drawn
 * and derived values in one flat map — exactly what `substituteParams`
 * consumes.
 *
 * **This is the single source of truth for resolution semantics.**
 * Verification proves a question by calling this same function, so a proof and
 * a serve can never diverge — which is the whole point of the proof. Do not
 * reimplement the draw anywhere else.
 *
 * Throws on a bad formula rather than returning partial values: an unverified
 * question should never have reached serving (see numeric-gate.service.ts), so
 * a failure here is a bug, not an expected path.
 */
export function resolveSlotsAndDerived(
  slots: ParamSlot[],
  derivedValues: DerivedValue[],
  seed: number,
): Record<string, number> {
  const rand = seededRandom(seed);
  const values: Record<string, number> = {};
  for (const slot of slots) values[slot.name] = drawSlot(slot, rand);

  for (const derived of derivedValues) {
    const parsed = parseFormula(derived.formula);
    if (!parsed.ok) throw new Error(`${derived.name}: ${parsed.error}`);
    const evaluated = evaluateFormula(parsed.ast, values);
    if (!evaluated.ok) throw new Error(`${derived.name}: ${evaluated.error}`);
    values[derived.name] = evaluated.value;
  }
  return values;
}

/**
 * Resolves a QuestionVersion's parameterized values for one `seed`:
 *  - `generateScript` present -> delegates to Task 4's sandbox
 *    (`executeGenerate`); its resolved `vars` are returned as-is.
 *  - else `paramSlots` or `derivedValues` present -> a seeded uniform draw per
 *    slot, all drawn from the SAME seeded PRNG instance (so `seed` alone
 *    determines the whole set, in slot order), followed by every derived
 *    formula in declaration order.
 *  - else -> `undefined` (a conceptual, non-parameterized question).
 */
export async function resolveParamValues(
  version: Pick<QuestionVersion, 'generateScript' | 'paramSlots' | 'derivedValues'>,
  seed: number,
): Promise<Record<string, number> | undefined> {
  if (version.generateScript) {
    return executeGenerate(version.generateScript, seed);
  }
  const slots = version.paramSlots ?? [];
  const derivedValues = version.derivedValues ?? [];
  if (slots.length > 0 || derivedValues.length > 0) {
    return resolveSlotsAndDerived(slots, derivedValues, seed);
  }
  return undefined;
}

/** Rerolls before the serve-time guard gives up and serves the draw anyway. */
export const SERVE_DRAW_ATTEMPTS = 8;

/** One rendered draw of a saved version — what a student would actually see.
 * `parameterized: false` means the version has no slots/derived values (or its
 * formulas could not resolve), so `stem`/`options` are the stored text. */
export interface QuestionSampleDraw {
  seed: number;
  stem: string;
  /** `explanation` is carried so instructor surfaces can RENDER the rationale
   * (markdown + KaTeX) instead of showing its LaTeX source. The editor's
   * textarea necessarily shows source; a long `\frac{...}` derivation is close
   * to unreadable that way, which is the whole reason this field is here. */
  options: Array<{ key: string; text: string; explanation: string }>;
  parameterized: boolean;
}

/**
 * Renders ONE sample draw of a saved version. Substitution happens here, on the
 * server, through the same `substituteParams` the serve path uses, so an
 * instructor-facing example can never drift from what a student receives.
 *
 * Collision-guarded, because this claims to be "what a student sees" and a
 * student's draw is guarded. A version carrying a broken formula resolves to
 * the raw template rather than throwing: the example is an aid, and failing it
 * must not take the surrounding view down with it.
 */
export async function drawQuestionSample(
  version: Pick<QuestionVersion, 'generateScript' | 'paramSlots' | 'derivedValues' | 'options' | 'stem'>,
  seedFn: () => number = drawSeed,
): Promise<QuestionSampleDraw> {
  let seed = seedFn();
  let values: Record<string, number> | undefined;
  try {
    ({ seed, paramValues: values } = await drawCollisionFreeParams(version, seedFn));
  } catch {
    values = undefined;
  }
  if (!values) {
    return {
      seed,
      stem: version.stem,
      options: version.options.map((option) => ({
        key: option.key,
        text: option.text,
        explanation: option.explanation ?? '',
      })),
      parameterized: false,
    };
  }
  return {
    seed,
    stem: substituteParams(version.stem, values),
    options: version.options.map((option) => ({
      key: option.key,
      text: substituteParams(option.text, values),
      // Substituted like the text: an explanation quotes the same numbers, and
      // the student's card substitutes it too (practice-card.ts), so an
      // instructor previewing raw `{{RATE}}` here would be reading something no
      // student ever sees.
      explanation: substituteParams(option.explanation ?? '', values),
    })),
    parameterized: true,
  };
}

/**
 * A STABLE seed sequence derived from a question id (FNV-1a), for previews that
 * are rendered repeatedly — list rows.
 *
 * Deliberately not `drawSeed()`: a fresh random seed would change every number
 * on every page load, so the same question reads as $12,400 now and $9,180 after
 * a refresh. That is a bug report waiting to happen ("didn't that say…?"), and
 * it makes two instructors describing the same row to each other disagree. The
 * serve path and the detail page still draw fresh, where varying numbers are
 * the whole point.
 *
 * Each call returns the NEXT seed in the sequence rather than a constant, so the
 * collision guard's rerolls still explore different draws — deterministically.
 */
export function stableSeedsForId(questionId: string): () => number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < questionId.length; i += 1) {
    hash ^= questionId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const base = hash >>> 0;
  let attempt = 0;
  return () => {
    attempt += 1;
    return (base + attempt) >>> 0;
  };
}

/**
 * Serve-time guard (Saurav's design, 2026-08-17): draw a seed, render the
 * options, and REDRAW if any two would display identically to the student.
 *
 * Two collision classes reach a serve despite the verification proof: the proof
 * samples 100 draws rather than enumerating (a collision at exactly one combo
 * of a typical 135-combo slot space has a ~48% chance of never being sampled),
 * and proofs stored before 2026-08-17 compared raw doubles, so a pair that
 * rounds to the same displayed cent passed them. Rerolling the SEED is the
 * sound version of "change the numbers slightly": every displayed value is a
 * formula output, so nudging one number directly would break the working shown
 * in the explanation — a redraw regenerates the whole consistent set.
 *
 * Comparison is on the fully rendered option TEXT — exactly what the student
 * sees — via the same substituteParams the serve itself uses. On exhaustion the
 * last draw is served anyway with a warning: never worse than the behaviour
 * this replaces, and a question colliding on most draws cannot hold a proof, so
 * exhaustion implies something verification would already have rejected.
 *
 * `seedFn` is injectable for tests only; production callers use the default.
 */
export async function drawCollisionFreeParams(
  version: Pick<QuestionVersion, 'generateScript' | 'paramSlots' | 'derivedValues' | 'options'>,
  seedFn: () => number = drawSeed,
): Promise<{ seed: number; paramValues: Record<string, number> | undefined }> {
  let last: { seed: number; paramValues: Record<string, number> | undefined } | undefined;
  for (let attempt = 1; attempt <= SERVE_DRAW_ATTEMPTS; attempt += 1) {
    const seed = seedFn();
    const paramValues = await resolveParamValues(version, seed);
    // Conceptual question: nothing substituted, nothing to collide.
    if (!paramValues) return { seed, paramValues };
    const rendered = version.options.map((option) => substituteParams(option.text, paramValues));
    if (new Set(rendered).size === rendered.length) return { seed, paramValues };
    last = { seed, paramValues };
    console.warn(
      `[params] two options display identically at seed ${seed} ` +
        `(attempt ${attempt}/${SERVE_DRAW_ATTEMPTS}); redrawing`,
    );
  }
  return last!;
}

/**
 * R3 (design spec 2026-08-05): the ONE place a computed value becomes display
 * text. Integers print bare; everything else rounds to 2 decimals, which is
 * what a finance student writing dollars and cents expects. The formula
 * evaluator itself never rounds — all arithmetic upstream of here runs at
 * full double precision, so intermediate rounding can never compound into the
 * answer. That compounding is exactly the `190.48 + 272.11` class of error
 * this work exists to eliminate.
 */
export function formatParamValue(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return (Math.round(value * 100) / 100).toFixed(2);
}

/** Replaces every `{{name}}` placeholder in `text` with its resolved value
 * from `values`; a placeholder with no matching key is left untouched
 * (verbatim `{{name}}`) rather than substituted with `undefined`/blank, so a
 * stale/missing slot is visibly obvious instead of silently disappearing.
 * Callers apply this to stem, option text, AND option explanations
 * individually (there is no options-array overload — one string in, one
 * string out). */
export function substituteParams(text: string, values: Record<string, number>): string {
  return text.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? formatParamValue(values[name]) : match,
  );
}

/**
 * Validation warning list (surfaced by the params-preview panel): every
 * defined `paramSlots` entry whose `{{name}}` placeholder does not actually
 * appear anywhere in `stem` — a slot an instructor configured but never
 * referenced, almost certainly a typo or leftover. Does NOT flag the reverse
 * (a `{{name}}` in the stem with no matching slot) — that placeholder simply
 * won't substitute (stays literal), which `substituteParams` already makes
 * visible on its own.
 */
export function findUnusedParamSlots(stem: string, paramSlots: ParamSlot[]): string[] {
  return paramSlots
    .filter((slot) => {
      const escapedName = slot.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return !new RegExp(`\\{\\{\\s*${escapedName}\\s*\\}\\}`).test(stem);
    })
    .map((slot) => `paramSlots.${slot.name} has no matching {{${slot.name}}} placeholder in the stem`);
}
