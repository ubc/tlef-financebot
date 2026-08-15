/**
 * Which request parameters a model accepts, and under which names.
 *
 * Model families no longer agree about parameters that used to be universal, and
 * the disagreements are INDEPENDENT of each other — `gpt-5.4-nano` takes both a
 * temperature and a reasoning effort but rejects `max_tokens`, while
 * `gpt-5.6-luna` rejects any temperature at all. Sending the wrong shape is a
 * hard 400 on the first call, so the shape is derived from the model id here
 * rather than assumed at the call site.
 *
 * A profile is a request SHAPE, not a provider. Ollama models take the same
 * temperature + toolkit-managed `maxTokens` pair as older OpenAI models, which
 * is why `classic` is the fallback for anything that is not recognisably OpenAI.
 *
 * ⚠️ Every value below was MEASURED against the live API on 2026-08-14, and the
 * measurements corrected three separate guesses. The OpenAI docs were wrong
 * twice over (see REASONING_EFFORTS); `gpt-5.4-nano` — in production here for
 * months — turned out to reject `max_tokens`, which is why `rag.service` had
 * been failing; and temperature availability turned out to depend on the
 * reasoning effort rather than on the model (see `defaultEffort`). Probe a new
 * model with real requests; do not read its capabilities off a page.
 */
import type { LLMOptions } from 'ubc-genai-toolkit-llm';
import { env } from '../../../config/env';
import type { CapabilityProfile, ReasoningEffort } from '../../../types/domain';

export type { CapabilityProfile, ReasoningEffort };

/**
 * Measured, NOT copied from documentation. Both OpenAI doc pages are wrong: the
 * model page lists `max`, the reasoning guide lists `minimal`, and the API
 * rejects both —
 *
 *   Unsupported value: 'reasoning_effort' does not support 'max' with this
 *   model. Supported values are: 'none', 'low', 'medium', 'high', and 'xhigh'.
 *
 * Identical on `gpt-5.4-nano` and `gpt-5.6-luna`. Re-probe before adding a model.
 *
 * `satisfies` makes a value the `ReasoningEffort` union does not have a compile
 * error; the reverse direction (a union member missing here) is pinned by
 * `model-capabilities.test.ts`, so the two cannot drift either way.
 */
export const REASONING_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh'] as const satisfies readonly ReasoningEffort[];

export interface ModelCapabilities {
  readonly profile: CapabilityProfile;
  /**
   * The allowed range — but availability is CONDITIONAL, see `defaultEffort`.
   * `null` only when the model has no temperature knob at all.
   */
  readonly temperature: { readonly min: number; readonly max: number; readonly default: number } | null;
  /** `null` when the model has no reasoning channel. */
  readonly reasoningEffort: readonly ReasoningEffort[] | null;
  /**
   * What the API applies when `reasoning_effort` is omitted — and therefore
   * whether a temperature is legal by default. **This is the whole rule:**
   * temperature is accepted only while the effective effort is `none`. Measured
   * identically on both models:
   *
   *   | effort sent | temperature 0.7 |
   *   | none        | accepted        |
   *   | low…xhigh   | rejected        |
   *   | omitted     | follows this field |
   *
   * `gpt-5.4-nano` defaults to `none`, which is the only reason temperature has
   * worked in this codebase to date. `gpt-5.6-luna` defaults to `medium`, which
   * is the whole of why switching to it broke every call. Setting
   * `reasoningEffort: 'none'` explicitly makes temperature legal on luna too.
   */
  readonly defaultEffort: ReasoningEffort;
  /**
   * How the output cap is sent. `maxTokens` is the toolkit's own key (it maps
   * that per provider, e.g. Ollama's `num_predict`); `max_completion_tokens` is
   * passed straight through to the OpenAI SDK as a provider option.
   *
   * ⚠️ These are not the same quantity. `max_tokens` caps VISIBLE output;
   * `max_completion_tokens` caps reasoning + visible output combined, so a
   * reasoning model can spend the entire budget thinking and return `''` with
   * `finish_reason: 'length'`. Measured: luna at default effort burned all 500
   * tokens on reasoning. A caller that sets a small cap should also ask for
   * effort `none`.
   */
  readonly tokenLimitParam: 'maxTokens' | 'max_completion_tokens';
}

export const CAPABILITY_PROFILES: Readonly<Record<CapabilityProfile, ModelCapabilities>> = Object.freeze({
  // The pre-profile shape: temperature plus the toolkit's own maxTokens key, no
  // reasoning channel at all. Ollama models live here. temperature defaults to 0
  // because completeJson's callers want deterministic JSON — that was the
  // helper's hardcoded default before profiles existed.
  classic: Object.freeze({
    profile: 'classic',
    temperature: Object.freeze({ min: 0, max: 2, default: 0 }),
    reasoningEffort: null,
    // Unreachable via temperatureAllowed (the null reasoningEffort short-circuits
    // first); present only so the record has one shape.
    defaultEffort: 'none',
    tokenLimitParam: 'maxTokens',
  }),
  // Reasoning available but OFF by default, so a temperature works until you
  // turn reasoning on. gpt-5.4-nano. Verified: temperature 0, 0.7 and 1.9 all
  // succeed with no effort set; 0.7 with effort `low` is rejected.
  //
  // Also the fallback for an UNRECOGNISED OpenAI id, because it is the only
  // shape that is safe when the id is unknown: `max_completion_tokens` is
  // accepted by every GPT-5 model, and a temperature is sent only at effort
  // `none`, which every model in the family accepts.
  'reasoning-tunable': Object.freeze({
    profile: 'reasoning-tunable',
    temperature: Object.freeze({ min: 0, max: 2, default: 0 }),
    reasoningEffort: REASONING_EFFORTS,
    defaultEffort: 'none',
    tokenLimitParam: 'max_completion_tokens',
  }),
  // Reasoning ON by default, so a temperature is rejected unless the caller
  // explicitly asks for effort `none`. gpt-5.6-luna.
  'reasoning-fixed': Object.freeze({
    profile: 'reasoning-fixed',
    temperature: Object.freeze({ min: 0, max: 2, default: 0 }),
    reasoningEffort: REASONING_EFFORTS,
    defaultEffort: 'medium',
    tokenLimitParam: 'max_completion_tokens',
  }),
});

/** Models this codebase knows how to call. */
export const KNOWN_MODELS: Readonly<Record<string, CapabilityProfile>> = Object.freeze({
  'gpt-5.4-nano': 'reasoning-tunable',
  'gpt-5.6-luna': 'reasoning-fixed',
});

/**
 * Ids that are recognisably OpenAI without being in the table — dated snapshots
 * (`gpt-5.4-nano-2026-08-01`) and family members added after this table was
 * written. Falling back to `classic` for these would send `max_tokens` and 400,
 * which is precisely the bug this module exists to prevent, so they get the
 * conservative OpenAI shape instead.
 */
const OPENAI_MODEL_ID = /^(gpt-|o\d)/i;

/**
 * The capabilities of `model`.
 *
 * Unknown ids resolve to `classic` — the shape this codebase always sent — EXCEPT
 * for ids that look like OpenAI's, which get `reasoning-tunable`. A model id is
 * free text all the way from the admin console (`admin.routes.ts` validates only
 * that it is non-empty), so an id the table has never seen is an ordinary event,
 * not a programming error.
 */
export function capabilitiesFor(model: string | undefined): ModelCapabilities {
  const id = typeof model === 'string' ? model.trim() : '';
  // Object.hasOwn, not a bare index: a model literally named `constructor` or
  // `toString` would otherwise resolve through the prototype chain to a function
  // and index CAPABILITY_PROFILES with it, yielding undefined.
  if (Object.hasOwn(KNOWN_MODELS, id)) return CAPABILITY_PROFILES[KNOWN_MODELS[id]!];
  return CAPABILITY_PROFILES[OPENAI_MODEL_ID.test(id) ? 'reasoning-tunable' : 'classic'];
}

/** A model an admin added, assigned one of the profiles the code implements. */
export interface CustomModel {
  id: string;
  profile: CapabilityProfile;
}

/**
 * As `capabilitiesFor`, but an admin-registered custom model wins over both the
 * shipped table and the OpenAI-prefix guess. This is the escape hatch: a new
 * model can be used without a deploy, as long as its behaviour matches a profile
 * the code already implements.
 */
export function capabilitiesForConfigured(
  model: string | undefined,
  customModels?: readonly CustomModel[],
): ModelCapabilities {
  const id = typeof model === 'string' ? model.trim() : '';
  const custom = customModels?.find((entry) => entry.id.trim() === id);
  if (custom && Object.hasOwn(CAPABILITY_PROFILES, custom.profile)) return CAPABILITY_PROFILES[custom.profile];
  return capabilitiesFor(id);
}

/**
 * Everything the admin console needs to render capability-driven controls, so
 * the client never hardcodes a model id or a parameter range. Shipped models
 * first, then custom ones.
 */
export function modelCatalogue(customModels?: readonly CustomModel[]): {
  models: Array<CustomModel & { custom: boolean }>;
  profiles: Record<CapabilityProfile, ModelCapabilities>;
} {
  const shipped = Object.entries(KNOWN_MODELS).map(([id, profile]) => ({ id, profile, custom: false }));
  const custom = (customModels ?? [])
    .filter((entry) => !Object.hasOwn(KNOWN_MODELS, entry.id.trim()))
    .map((entry) => ({ id: entry.id.trim(), profile: entry.profile, custom: true }));
  return { models: [...shipped, ...custom], profiles: CAPABILITY_PROFILES };
}

/**
 * Whether an explicit `temperature` is legal given the effort that will apply.
 * The provider rejects any non-default temperature while reasoning is active.
 */
export function temperatureAllowed(caps: ModelCapabilities, effort?: ReasoningEffort): boolean {
  if (caps.temperature === null) return false;
  // A model with no reasoning channel ignores the effort entirely, so an effort
  // a caller passes anyway must not cost it the temperature it does support.
  if (caps.reasoningEffort === null) return true;
  return (effort ?? caps.defaultEffort) === 'none';
}

export interface ModelRequestOptions {
  /** Model override (falls back to `LLM_DEFAULT_MODEL`). */
  model?: string;
  /** Dropped when the effective reasoning effort is anything but `none`. */
  temperature?: number;
  maxTokens?: number;
  /** Reasoning-capable models only; dropped elsewhere. Omitted unless set. */
  reasoningEffort?: ReasoningEffort;
}

/**
 * Shape the provider request for whichever model will actually serve it.
 *
 * Keyed on the RESOLVED model id (`options.model || env.llmDefaultModel`) rather
 * than on how that model was configured, so callers reading platform settings
 * and callers falling back to the environment are handled by this one function.
 *
 * A parameter the model will not accept is OMITTED, not defaulted: the toolkit
 * forwards `temperature: undefined` to the SDK, which drops undefined keys from
 * the JSON body, so the parameter never reaches the wire. Sending it instead is
 * a hard 400 (`'temperature' does not support 0 with this model`). Confirmed
 * end-to-end against the live API, not just in a unit test — a `null` on the
 * wire would fail identically to the bug this replaces.
 *
 * Consequence worth knowing at the call sites: asking for reasoning silently
 * costs you the temperature knob, so `GENERATOR_TEMPERATURE`'s batch-diversity
 * role and any caller's `temperature: 0` determinism both lapse the moment a
 * step is given an effort. Effort is a quality knob, not a determinism one.
 *
 * `reasoning_effort` and `max_completion_tokens` are snake_case because they are
 * passed straight through the toolkit to the OpenAI SDK: the provider peels off
 * the keys it manages and spreads the rest into `chat.completions.create`.
 */
export function modelRequestOptions(options: ModelRequestOptions): LLMOptions {
  // `||` not `??`: an empty-string model would otherwise pick capabilities for
  // '' while the toolkit served the request from its own defaultModel, so the
  // profile and the serving model would disagree.
  const caps = capabilitiesFor(options.model || env.llmDefaultModel);
  const sendOptions: LLMOptions = {
    ...(options.model ? { model: options.model } : {}),
  };
  if (caps.reasoningEffort && options.reasoningEffort) {
    sendOptions.reasoning_effort = options.reasoningEffort;
  }
  if (temperatureAllowed(caps, options.reasoningEffort)) {
    sendOptions.temperature = options.temperature ?? caps.temperature!.default;
  }
  // `!== undefined`, not truthiness: `maxTokens: 0` is a caller asking for a
  // zero budget, and silently dropping the cap is the opposite of that request.
  if (options.maxTokens !== undefined) {
    sendOptions[caps.tokenLimitParam] = options.maxTokens;
  }
  return sendOptions;
}
