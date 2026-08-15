// Unit test — the model capability registry (components/genai/llm).
//
// Every value here was MEASURED against the live OpenAI API on 2026-08-14, not
// taken from documentation, because the docs were wrong twice over and because
// gpt-5.4-nano — already in production — does not have the shape it appeared to
// have. These assertions exist so a future reader who "corrects" the table from
// a docs page fails loudly instead of shipping a 400.
import {
  CAPABILITY_PROFILES,
  KNOWN_MODELS,
  REASONING_EFFORTS,
  capabilitiesFor,
  temperatureAllowed,
} from '../../server/src/components/genai/llm/model-capabilities';

it('resolves the two shipped models to their profiles', () => {
  expect(capabilitiesFor('gpt-5.4-nano').profile).toBe('reasoning-tunable');
  expect(capabilitiesFor('gpt-5.6-luna').profile).toBe('reasoning-fixed');
  expect(Object.keys(KNOWN_MODELS).sort()).toEqual(['gpt-5.4-nano', 'gpt-5.6-luna']);
});

it('falls back to classic for a non-OpenAI unknown model, so nothing regresses', () => {
  // The pre-profile request shape. Ollama models land here, and their
  // temperature + maxTokens pair is exactly what the toolkit already sent.
  expect(capabilitiesFor('ministral-3:latest').profile).toBe('classic');
  expect(capabilitiesFor('some-model-nobody-has-heard-of').profile).toBe('classic');
});

it('gives an UNKNOWN OpenAI-looking id the safe reasoning shape, not classic', () => {
  // Model ids are free text from the admin console, and a dated snapshot is the
  // normal way to pin an OpenAI model. Falling back to classic would send
  // `max_tokens` and 400 — reintroducing the exact bug this module prevents.
  expect(capabilitiesFor('gpt-5.4-nano-2026-08-01').profile).toBe('reasoning-tunable');
  expect(capabilitiesFor('gpt-6-something').profile).toBe('reasoning-tunable');
  expect(capabilitiesFor('o3-mini').profile).toBe('reasoning-tunable');
  // …and that shape is safe on an unknown model precisely because a temperature
  // is only offered at effort `none`, which the whole family accepts.
  expect(temperatureAllowed(capabilitiesFor('gpt-6-something'), 'high')).toBe(false);
});

it('ignores surrounding whitespace and casing on a model id', () => {
  expect(capabilitiesFor('  gpt-5.6-luna  ').profile).toBe('reasoning-fixed');
  expect(capabilitiesFor('GPT-5.9-Unreleased').profile).toBe('reasoning-tunable');
});

it('survives a model id that collides with an Object prototype key', () => {
  // A bare `KNOWN_MODELS[id]` would resolve `constructor` through the prototype
  // chain to a function, index CAPABILITY_PROFILES with it, and return undefined
  // — so the next property read would throw rather than fall back.
  expect(capabilitiesFor('constructor').profile).toBe('classic');
  expect(capabilitiesFor('toString').profile).toBe('classic');
});

it('treats a missing or empty model id as unconfigured, not as a model named ""', () => {
  expect(capabilitiesFor(undefined).profile).toBe('classic');
  expect(capabilitiesFor('   ').profile).toBe('classic');
});

it('exposes the table as frozen, since it is measured ground truth', () => {
  // A shared singleton is handed to every caller; a stray write would corrupt
  // the shape for the whole process.
  expect(Object.isFrozen(CAPABILITY_PROFILES)).toBe(true);
  expect(Object.isFrozen(CAPABILITY_PROFILES['reasoning-fixed'])).toBe(true);
  expect(Object.isFrozen(KNOWN_MODELS)).toBe(true);
});

it('pins the reasoning-effort set the API actually accepts', () => {
  // Both doc pages disagree with the API and with each other: the model page
  // lists `max`, the reasoning guide lists `minimal`. The API rejects both, on
  // both shipped models.
  expect(REASONING_EFFORTS).toEqual(['none', 'low', 'medium', 'high', 'xhigh']);
  expect(REASONING_EFFORTS).not.toContain('minimal');
  expect(REASONING_EFFORTS).not.toContain('max');
});

it('describes classic as temperature + the toolkit maxTokens key, no reasoning', () => {
  const classic = CAPABILITY_PROFILES.classic;
  expect(classic.temperature).toEqual({ min: 0, max: 2, default: 0 });
  expect(classic.reasoningEffort).toBeNull();
  expect(classic.tokenLimitParam).toBe('maxTokens');
});

it('gives both GPT-5 models the same effort set and renamed token cap', () => {
  // The correction live verification forced: nano is not a legacy model. It has
  // the same reasoning channel as luna and rejects `max_tokens` just as hard —
  // which is why rag.service had been failing against it in production.
  for (const profile of ['reasoning-tunable', 'reasoning-fixed'] as const) {
    expect(CAPABILITY_PROFILES[profile].reasoningEffort).toEqual(REASONING_EFFORTS);
    expect(CAPABILITY_PROFILES[profile].tokenLimitParam).toBe('max_completion_tokens');
  }
});

it('separates the two GPT-5 models only by their DEFAULT effort', () => {
  // This single field is the whole difference, and the whole reason switching
  // to luna broke every call while nano had been fine.
  expect(CAPABILITY_PROFILES['reasoning-tunable'].defaultEffort).toBe('none');
  expect(CAPABILITY_PROFILES['reasoning-fixed'].defaultEffort).toBe('medium');
});

describe('temperatureAllowed — the measured rule', () => {
  const nano = CAPABILITY_PROFILES['reasoning-tunable'];
  const luna = CAPABILITY_PROFILES['reasoning-fixed'];

  it('allows a temperature only while the effective effort is none', () => {
    // Verified identically on BOTH models: effort `none` accepts temperature
    // 0.7; effort low…xhigh rejects it. The model matters only via its default.
    expect(temperatureAllowed(nano)).toBe(true);
    expect(temperatureAllowed(luna)).toBe(false);
    expect(temperatureAllowed(nano, 'none')).toBe(true);
    expect(temperatureAllowed(luna, 'none')).toBe(true);
  });

  it('withdraws the temperature knob as soon as reasoning is switched on', () => {
    for (const effort of ['low', 'medium', 'high', 'xhigh'] as const) {
      expect(temperatureAllowed(nano, effort)).toBe(false);
      expect(temperatureAllowed(luna, effort)).toBe(false);
    }
  });

  it('always allows a temperature on a model with no reasoning channel', () => {
    expect(temperatureAllowed(CAPABILITY_PROFILES.classic)).toBe(true);
  });
});
