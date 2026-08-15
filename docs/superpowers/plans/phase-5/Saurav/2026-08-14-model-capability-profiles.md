# Model capability profiles — admin-selectable models with per-step params — 2026-08-14

**Owner:** Saurav
**Branch:** `saurav/model-capability-profiles`, cut from `main` (NOT from
`saurav/shuffle-answer-options`, which is under review as PR #74)
**Phase:** 5

## Why

Switching `LLM_DEFAULT_MODEL` / the admin console to `gpt-5.6-luna` **breaks
every LLM call in the app.** This was measured against the live OpenAI API with
the project's own key on 2026-08-14, not inferred:

| Request shape | Result |
|---|---|
| `temperature: 0` (what `completeJson` sends by default) | ❌ 400 `Unsupported value: 'temperature' does not support 0 with this model. Only the default (1) value is supported.` |
| `temperature: 0.7` (`GENERATOR_TEMPERATURE`) | ❌ 400, same |
| `max_tokens: 64` | ❌ 400 `Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.` |
| temperature omitted, `max_completion_tokens`, `reasoning_effort` | ✅ returns clean JSON |

`completeJson` (`server/src/components/genai/llm/index.ts:71-77`) **always**
sends `temperature` (defaulting to 0), so on `gpt-5.6-luna` the failure is total
and immediate — generation, classification, import and RAG all 400.

### The accepted `reasoning_effort` set is measured, not documented

Probed directly, because **the two OpenAI doc pages disagree and both are
wrong**:

- The [model page](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
  lists `none, low, medium, high, xhigh, max`.
- The [reasoning guide](https://developers.openai.com/api/docs/guides/reasoning)
  lists `none, minimal, low, medium, high, xhigh, max`.
- **The API accepts exactly: `none`, `low`, `medium`, `high`, `xhigh`.**
  `minimal` and `max` are both rejected with
  `Unsupported value: 'reasoning_effort' does not support 'max' with this model.`

Do not re-derive this from documentation. If a third model is added, probe it.

### Why a UI change and not just a code fix

A one-line fix to `completeJson` would unblock luna, but the admin console
already exposes free-text model ids with no validation
(`admin.routes.ts:56` only checks `.min(1)`), so an admin can select a model
whose parameter shape the code does not implement and get a pipeline that 400s
mid-run. Making the console capability-driven turns a runtime failure into an
unselectable option.

## ⚠️ Corrections from building it — the plan above was wrong three times

Tasks 1 + 3 shipped on 2026-08-14. Live verification against the real API
overturned three things this plan asserted, each of which unit tests had
happily confirmed:

1. **`gpt-5.4-nano` also rejects `max_tokens`.** It was assumed to be a legacy
   model needing no changes. It is not: it has the same reasoning channel as
   luna and the same renamed token cap. Consequence — **`rag.service.ts:118` had
   been failing with a 400 on every call in production**, unnoticed because the
   RAG page is demo surface.
2. **Temperature availability is a property of the REQUEST, not the model.**
   Measured on both models: `reasoning_effort: 'none'` → `temperature: 0.7`
   accepted; effort `low…xhigh` → rejected; effort omitted → follows the model's
   default. nano defaults to `none`, luna to `medium` — and that single field is
   the entire reason switching to luna broke everything. **luna accepts a
   temperature if you explicitly pass effort `none`.**
   So the two-profile split became three: `classic`, `reasoning-tunable`
   (reasoning off by default), `reasoning-fixed` (reasoning on by default).
3. **`rag.service` is not "covered for free".** It calls `llm.sendMessage`
   directly and wants prose, not JSON, so it never passes through `completeJson`.
   The shaping was split into `modelRequestOptions` so both can use it.

**The lesson worth keeping: every one of these passed a green unit suite.** The
only thing that caught them was issuing real requests.

### And four more the code review caught, after that

1. **`completeJson` lost its determinism contract.** It had always sent
   `temperature: 0`; on a reasoning-by-default model that is silently dropped, so
   classification, structure validation, review and import would have become
   nondeterministic with nothing logged. `completeJson` now requests effort
   `none` by default — one change covering every caller — and a caller wanting
   the model to think passes `reasoningEffort` and gives up the temperature
   knowingly.
2. **`max_completion_tokens` is not a renamed `max_tokens`.** It budgets
   reasoning AND visible output together. **Measured: luna spent all 500 tokens
   reasoning and returned `''` with `finish_reason: 'length'`.** Since
   `rag.service` returns `answer` unchecked, the "fix" would have turned a loud
   400 into a blank answer beside real citations — strictly worse. It now pairs
   its cap with effort `none`.
3. **The unknown-model fallback was unsafe.** Model ids are free text from the
   admin console, and a dated snapshot (`gpt-5.4-nano-2026-08-01`) is the normal
   way to pin one. Falling back to `classic` would have sent `max_tokens` and
   400'd — the exact bug. Ids matching `/^(gpt-|o\d)/i` now get
   `reasoning-tunable`, which is safe on an unknown OpenAI model precisely
   because it offers a temperature only at effort `none`.
4. **The shaper belongs in the component, not in `config/`.** Root AGENTS.md puts
   each integration in `components/<name>/`, and OpenAI parameter names are
   integration knowledge. The mocking hazard that seemed to force `config/` was
   overstated: `jest.mock` on the barrel does not shadow a sibling module, so
   `components/genai/llm/model-capabilities.ts` imported by its own path is
   untouched by it. `rag.service` imports it that way.

Also fixed from the review: `maxTokens: 0` was dropped by a truthiness check;
`model: ''` picked a profile for `''` while the toolkit served from its own
default; a model id colliding with an `Object` prototype key (`constructor`)
threw instead of falling back; the table was mutable and is now frozen; the
retry test asserted `toEqual` on the *same object reference* and so could never
fail; `rag.service.test` asserted nothing about the options argument, which is
why the original 400 shipped unnoticed; and `llm/AGENTS.md`'s usage example was
teaching the exact call shape its own new gotcha forbids.

## Design decisions — settled with Saurav on 2026-08-14

0. **Profile names are `classic` / `reasoning-tunable` / `reasoning-fixed`**, not
   the `openai-classic` / `openai-reasoning` pair named below. A profile turned
   out to describe a request SHAPE that Ollama models share, and the two GPT-5
   models turned out to differ only in their default effort — see the
   corrections above.
1. **Capability *profiles*, not a free-text capability editor.** Saurav proposed
   an env-style textarea for declaring model capabilities; rejected after
   pushback, because the declaration would be editable but the *behaviour keyed
   off it* is code — so the escape hatch only ever works for parameter shapes
   already implemented, while adding a grammar to parse, validate and document,
   and a way for one typo to brick all four agents.
2. **Custom models are allowed, but must pick an existing profile.** An admin may
   add a model id and assign it `openai-classic` or `openai-reasoning`. This is
   the same expressive power the textarea would actually have delivered, minus
   the parser, and it is honest: you can only add a model the code already knows
   how to call.
3. **Params are per pipeline step.** Preserves the existing intent — generator
   warm for batch diversity, validator/reviewer deterministic — and lets the
   reviewer run at high effort while the generator stays cheap.
4. **`masteryEvaluator` and the `layer2Evaluator` flag stay, marked "not yet
   wired".** Both are confirmed dead (persisted, audited, never read anywhere in
   `server/src`; there is no mastery-evaluator LLM call site at all). Saurav
   chose to keep them visible as roadmap rather than delete them.
5. **Classification, import and RAG come under admin control** via a new
   `utility` step, rather than being left on `env.llmDefaultModel`.

## ⚠️ Consequence Saurav should accept explicitly

On a reasoning profile, `temperature` cannot be sent at all. That means:

- **The validator and reviewer stop being deterministic.** `completeJson`'s
  `temperature: 0` default (`index.ts:72`) and the comment at
  `generation.service.ts:74` that they "stay deterministic" become false for any
  reasoning model.
- **`GENERATOR_TEMPERATURE = 0.7` becomes a no-op.** It exists so a `count > 1`
  batch yields distinct rather than identical questions
  (`generation.service.ts:72-75`). Under a reasoning profile, batch diversity
  now rests on the model's own sampling at its fixed default.

`reasoning_effort` is the replacement knob, but it is **not** a determinism
control. If deterministic structure validation matters, the validator step
should stay on a classic-profile model — which the per-step design makes
possible, and which is the main argument for per-step over global.

## Cost note

`gpt-5.6-luna` is $0.2 / $1.2 per M input/output vs. the nano currently in use,
but **reasoning tokens bill as output**. `xhigh` on the reviewer is not free.
`maxGenerationsPerDay` counts questions, not tokens, so it does not bound this.
Not solved here; flagged so the first bill is not a surprise.

## Global constraints

- Reuse the existing `PlatformSettings` document and `completeJson` helper. Do
  not add a second config surface or a parallel LLM client.
- The capability table is the single source of truth and lives in **server
  code**; the client renders from it and never hardcodes a model id or a
  parameter range.
- House style: match surrounding comment density and idiom.
- Jest is `testEnvironment: 'node'` with no jsdom (`tests/AGENTS.md:66-69`).
  Param shaping and normalization are unit-testable; the admin form is
  Playwright-only.
- Every task ends green on `npm run lint`, `npm run typecheck`, full `npx jest`.
- Mutation-verify each behavioural fix: revert it, confirm the covering
  assertion fails, restore it.
- `docs/api-contract.md` is updated in the same PR.
- **Node is not on PATH.** Prepend
  `C:\Users\Saurav\AppData\Local\node-portable\node-v24.19.0-win-x64` to
  `$env:Path` before lint/typecheck/jest.

---

## Task 1 — the capability registry

**Owner:** Saurav

New `server/src/config/model-capabilities.ts`. Two profiles, two shipped models.

```ts
export type CapabilityProfile = 'openai-classic' | 'openai-reasoning';
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';
```

Each profile declares: whether `temperature` is supported (and its range and
default), whether `reasoningEffort` is supported (and its allowed values and
default), and which token-limit parameter name the provider expects
(`max_tokens` vs `max_completion_tokens`).

Shipped catalogue: `gpt-5.4-nano → openai-classic`,
`gpt-5.6-luna → openai-reasoning`.

**Tests.** The profile lookup resolves both shipped models; an unknown model id
falls back to `openai-classic` (today's behaviour, so nothing regresses) and that
fallback is asserted rather than incidental. The `openai-reasoning` effort list
matches the measured set exactly — pin all five values and assert `minimal` and
`max` are absent, with the probe result cited in a comment so a future reader
does not "fix" it from the docs.

## Task 2 — `PlatformSettings` gains per-step params, a `utility` step, and custom models

**Owner:** Saurav

`models.<step>` changes from `string` to `{ model, temperature?, reasoningEffort? }`,
and a fifth step `utility` is added alongside
generator/validator/reviewer/masteryEvaluator. `customModels:
Array<{ id, profile }>` carries the escape hatch.

### Back-compat is mandatory, not optional

**A `platformSettings` doc already exists in the dev DB in the old string
shape** — Saurav saved one at 2026-08-14T00:12Z while testing, with all four
steps on `gpt-5.6-luna`. Staging may have one too. `getPlatformSettings`
(`admin.service.ts:344`) must normalize a legacy `string` to
`{ model: <string> }` on read, or the app breaks for exactly the people who used
the feature. Normalization happens on read, not as a migration script, so an
un-upgraded staging DB keeps working.

Zod gains a cross-field refinement: a step may not carry `temperature` if its
resolved profile does not support it, nor `reasoningEffort` if it does not, nor
a value outside the declared range/enum. **Server is the source of truth** — the
UI must not be the only thing preventing an incoherent save.

`GET /admin/platform-settings` returns the catalogue (profiles + known models)
alongside the settings, so the client has one round trip and no duplicated
table.

**Tests.** Legacy string doc normalizes to the new shape; a doc already in the
new shape round-trips unchanged; zod rejects temperature on a reasoning step,
effort on a classic step, an out-of-enum effort, and an out-of-range
temperature; a custom model resolves its assigned profile.

## Task 3 — `completeJson` becomes capability-aware

**Owner:** Saurav

This is the task that actually fixes the 400s, and it is keyed on the **resolved
model id** (`options.model ?? env.llmDefaultModel`), not on the config path —
so env-driven callers are fixed by the same code as admin-driven ones.

Per the resolved profile:

- temperature supported → send it; **not supported → omit the key entirely.**
- `reasoningEffort` supported → forward as `reasoning_effort`.
- `maxTokens` → emit under the profile's token parameter name.

Both `reasoning_effort` and `max_completion_tokens` reach the API through the
toolkit's passthrough: `separateOpenAIOptions` peels off the keys it manages and
spreads the remainder into `chat.completions.create`
(`node_modules/ubc-genai-toolkit-llm/dist/providers/openai-provider.js`). **No
toolkit fork is needed.**

**One thing to prove rather than assume:** the toolkit passes
`temperature: options?.temperature` unconditionally, so omission relies on the
OpenAI SDK dropping `undefined` from the JSON body. Expected (`JSON.stringify`
drops undefined properties) but it must be confirmed by a **real** call, not a
unit test with a mocked client — a `null` on the wire would 400 exactly like
today.

**Tests.** Param shaping per profile with a mocked LLM module: classic sends
`temperature` and `max_tokens`; reasoning omits `temperature` and sends
`reasoning_effort` + `max_completion_tokens`; the JSON-retry path reuses the same
shaped options. **Mutation-verify** by restoring the unconditional
`temperature` and confirming the reasoning-profile test fails.

`rag.service.ts:118` passes `maxTokens: 500` and is the only caller that does;
it needs no change once the token parameter is profile-selected, which the test
should state.

## Task 4 — admin console: dropdowns and conditional controls

**Owner:** Saurav

`client/src/views/admin/platform-settings.ts` currently builds one free-text
input per step from `Object.entries(settings.models)` (`:18-20`). Each step
becomes: a **model `<select>`** populated from the catalogue, plus **one
conditional control** that swaps on the selected model's profile — a temperature
number input within the declared range, or a reasoning-effort `<select>` of the
declared values.

A small "Custom models" section lets an admin add `id + profile`, which then
appears in every step's dropdown.

`masteryEvaluator` and the Layer 2 flag get a visible **"not yet wired"** note
stating they are saved but not read by any pipeline — so the label matches the
measured truth.

**Accessibility.** The existing per-field `aria-label` is built from the step key
(`:19`). The conditional control must carry its own label and be announced when
it swaps; `tests/a11y/a11y.spec.ts` already covers this page and must stay green.

**Tests.** Playwright: selecting a reasoning model swaps the temperature input
for an effort select and back; saving persists per-step params; adding a custom
model makes it selectable. `tests/e2e/responsive-workflows.spec.ts` also touches
this page and may need its selectors updated — check before assuming.

## Task 5 — verify against the live model

**Owner:** Saurav

Unit tests cannot prove this works; the whole defect class here is
provider-side. Set the generator to `gpt-5.6-luna` at `low` and the reviewer at
`high`, run a real generation, and confirm: no 400s, the run's `input.models`
records the per-step config, and the reviewer's output quality at `high` is
worth its token cost. Record the outcome in `STATUS.md` under a dated entry, as
with every previous live run.

**Until Task 3 lands, Saurav's local generation is broken** — the dev DB's
platform settings point all four steps at `gpt-5.6-luna`. Either drop that doc
to fall back to env defaults, or expect 400s.

## Out of scope, recorded so it is not lost

- **Streaming and structured outputs** are untouched. The toolkit's
  `sendStructuredConversation` path has the same `temperature` /
  `max_tokens` hardcoding and would need the same treatment if adopted.
- **`response_format: json_object` requires the literal word "json" in the
  messages** — confirmed by a 400 while probing. Every current prompt satisfies
  this, and it is model-independent, so nothing is done. It would bite a new
  prompt that omits the word.
- **Token-based cost control.** `maxGenerationsPerDay` counts questions; reasoning
  tokens are invisible to it.
- **`masteryEvaluator` has no call site.** Wiring it is its own task.
