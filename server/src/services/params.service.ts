import { executeGenerate } from '../components/param-worker';
import type { ParamSlot, QuestionVersion } from '../types/domain';

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
 * Resolves a QuestionVersion's parameterized values for one `seed`:
 *  - `generateScript` present -> delegates to Task 4's sandbox
 *    (`executeGenerate`); its resolved `vars` are returned as-is.
 *  - else `paramSlots` present (non-empty) -> a seeded uniform draw per slot,
 *    all drawn from the SAME seeded PRNG instance (so `seed` alone
 *    determines the whole set, in slot order).
 *  - else -> `undefined` (a conceptual, non-parameterized question).
 */
export async function resolveParamValues(
  version: Pick<QuestionVersion, 'generateScript' | 'paramSlots'>,
  seed: number,
): Promise<Record<string, number> | undefined> {
  if (version.generateScript) {
    return executeGenerate(version.generateScript, seed);
  }
  if (version.paramSlots && version.paramSlots.length > 0) {
    const rand = seededRandom(seed);
    const values: Record<string, number> = {};
    for (const slot of version.paramSlots) {
      values[slot.name] = drawSlot(slot, rand);
    }
    return values;
  }
  return undefined;
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
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match,
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
