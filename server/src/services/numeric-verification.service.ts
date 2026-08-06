// -----------------------------------------------------------------------------
// Numeric verification (design spec 2026-08-05): resolves a parameterized
// question's drawn + derived values for a seed, and proves across sampled
// draws that every derived value is finite, in-band, and that no two option
// values collide. Pure functions only (apart from the Tier 3 sandbox) — no
// DB/HTTP here; callers own persistence. See server/src/services/AGENTS.md.
// -----------------------------------------------------------------------------
import { EVALUATOR_VERSION } from '../components/formula';
import { executeGenerate } from '../components/param-worker';
import { resolveSlotsAndDerived } from './params.service';
import type { DerivedValue, NumericVerification, ParamSlot } from '../types/domain';

/** Draws sampled per verification run. Every one must pass every check. */
export const VERIFICATION_SAMPLE_COUNT = 100;

/** Tier 3 spawns one worker per seed, so it samples fewer. The reduced count
 * is recorded in the stored proof's `sampleSeeds`, making the difference
 * visible rather than implied. */
export const SCRIPT_SAMPLE_COUNT = 25;

/** Values beyond this are treated as a runaway formula rather than a number a
 * student could meaningfully answer. */
export const MAX_ABS_VALUE = 1e12;

/** Fixed base for the sampled seeds so a failing verification reproduces
 * exactly on re-run rather than being a different sample each time. */
const SAMPLE_SEED_BASE = 1_000_003;

export type ResolveResult =
  | { ok: true; values: Record<string, number> }
  | { ok: false; error: string };

export interface VerifyInput {
  slots: ParamSlot[];
  derivedValues: DerivedValue[];
  /** Names of the derived values the question's options display. */
  optionValueNames: string[];
}

export type VerifyResult =
  | { ok: true; sampleSeeds: number[]; verification: NumericVerification }
  | { ok: false; error: string; failingSeed?: number };

export type OptionValueNameResult =
  | { ok: true; names: string[] }
  | { ok: false; error: string };

/**
 * Resolve the one computed value displayed by each answer option.
 *
 * Verification must cover the answer surface, not merely whatever formulas
 * happened to be declared. Without this structural check a generator could
 * provide one unused `derivedValue`, leave every option as an LLM-written
 * literal, and still earn a proof because an empty option-value list has no
 * collisions. Requiring exactly one computed value per option also catches two
 * options that accidentally reuse the same placeholder.
 *
 * `allowedNames` is supplied for formula-backed questions so a drawn input
 * placeholder does not masquerade as a computed answer. Script migrations do
 * not have a declared value list, so every option must simply contain exactly
 * one placeholder and the sandbox proof checks that the script returns it.
 */
export function optionValueNamesForVerification(
  optionTexts: string[],
  allowedNames?: Iterable<string>,
): OptionValueNameResult {
  const allowed = allowedNames ? new Set(allowedNames) : undefined;
  const names: string[] = [];

  for (let index = 0; index < optionTexts.length; index += 1) {
    const placeholders = Array.from(
      optionTexts[index]!.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g),
      (match) => match[1]!,
    );
    const computed = allowed
      ? placeholders.filter((name) => allowed.has(name))
      : placeholders;
    if (computed.length !== 1) {
      return {
        ok: false,
        error: `option ${index + 1} must display exactly one computed value`,
      };
    }
    names.push(computed[0]!);
  }

  return { ok: true, names };
}

function sampleSeedsFor(count: number): number[] {
  const seeds: number[] = [];
  for (let i = 0; i < count; i += 1) seeds.push(SAMPLE_SEED_BASE + i);
  return seeds;
}

/**
 * Verification's view of resolution. Delegates to `resolveSlotsAndDerived`,
 * which is the SAME function the serving paths call — a proof computed by
 * different code than the serve would prove nothing, which is precisely the
 * failure mode the proof exists to prevent. This wrapper only converts its
 * throw into the result shape verification reports against.
 */
export function resolveDerivedValues(
  slots: ParamSlot[],
  derivedValues: DerivedValue[],
  seed: number,
): ResolveResult {
  try {
    return { ok: true, values: resolveSlotsAndDerived(slots, derivedValues, seed) };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/** The three per-draw checks shared by Tier 1/2 and Tier 3. Returns an error
 * string, or null when the draw is sound. */
function checkDraw(values: Record<string, number>, optionValueNames: string[]): string | null {
  for (const [name, value] of Object.entries(values)) {
    if (!Number.isFinite(value)) return `${name} is not finite`;
    if (Math.abs(value) > MAX_ABS_VALUE) return `${name} exceeds the magnitude band ${MAX_ABS_VALUE}`;
  }

  if (optionValueNames.length < 2) return 'at least two computed option values are required';
  const optionValues: number[] = [];
  for (const name of optionValueNames) {
    if (!Object.prototype.hasOwnProperty.call(values, name)) {
      return `option value ${name} was not produced`;
    }
    const value = values[name]!;
    if (!Number.isFinite(value)) return `option value ${name} is not finite`;
    optionValues.push(value);
  }
  for (let a = 0; a < optionValues.length; a += 1) {
    for (let b = a + 1; b < optionValues.length; b += 1) {
      if (optionValues[a] === optionValues[b]) {
        return `options ${optionValueNames[a]} and ${optionValueNames[b]} are identical`;
      }
    }
  }
  return null;
}

/**
 * R4's proof. Samples VERIFICATION_SAMPLE_COUNT deterministic draws; every
 * one must satisfy all three checks. A single-draw check is close to
 * worthless — the failures that matter (a range whose edge divides by zero,
 * two options that coincide for some values) appear only on specific draws.
 */
export function verifyQuestionNumerics(input: VerifyInput): VerifyResult {
  const sampleSeeds = sampleSeedsFor(VERIFICATION_SAMPLE_COUNT);

  for (const seed of sampleSeeds) {
    const resolved = resolveDerivedValues(input.slots, input.derivedValues, seed);
    if (!resolved.ok) return { ok: false, error: resolved.error, failingSeed: seed };

    const failure = checkDraw(resolved.values, input.optionValueNames);
    if (failure) return { ok: false, error: failure, failingSeed: seed };
  }

  return {
    ok: true,
    sampleSeeds,
    verification: { evaluatorVersion: EVALUATOR_VERSION, sampleSeeds, verifiedAt: new Date() },
  };
}

/**
 * Tier 3: the same proof for a question whose values come from a sandboxed
 * `generate()` rather than formulas. Async because the worker is. Identical
 * checks, so a Tier 3 question earns exactly the same gate clearance as a
 * Tier 1 one — the tier changes who authors the maths, never whether it is
 * proven.
 */
export async function verifyGenerateScript(
  script: string,
  optionValueNames: string[],
): Promise<VerifyResult> {
  const sampleSeeds = sampleSeedsFor(SCRIPT_SAMPLE_COUNT);

  for (const seed of sampleSeeds) {
    let values: Record<string, number>;
    try {
      values = await executeGenerate(script, seed);
    } catch (error) {
      return { ok: false, error: `generateScript failed: ${(error as Error).message}`, failingSeed: seed };
    }

    const failure = checkDraw(values, optionValueNames);
    if (failure) return { ok: false, error: failure, failingSeed: seed };
  }

  return {
    ok: true,
    sampleSeeds,
    verification: { evaluatorVersion: EVALUATOR_VERSION, sampleSeeds, verifiedAt: new Date() },
  };
}
