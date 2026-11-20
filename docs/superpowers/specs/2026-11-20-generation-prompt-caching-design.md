# Question generation prompt caching — design

**Date:** 2026-11-20
**Status:** Agreed with the developer in conversation; implementing.

## Problem

Question generation spends most of FinanceBot's model tokens on input, and almost
none of it is served from the provider's prompt cache. Local receipts
(`modelCallReceipts`, 2026-10-05 → 2026-11-19, 110 calls with usage):

| Stage | Calls | Input | Cached input | Output | Avg input |
|---|---|---|---|---|---|
| generation | 50 | 309,945 | 12,796 (4%) | 52,343 | 6,199 |
| check | 51 | 118,115 | 0 | 7,539 | 2,316 |

The generator prompt carries ~4.5k–5.3k tokens of fixed rules (option roles,
placeholders, numeric/conceptual contracts, JSON shape). OpenAI caches only an
identical *prefix* of at least 1,024 tokens, but the prompt's first line names
the learning objective, then difficulty, hardness move and course material come
before the fixed rules. Every call therefore has a unique prefix.

The checker has ~650 tokens of fixed rules (below the 1,024-token minimum on its
own), followed by course material that is identical for every item of one LO,
but its first line also names the LO and per-item deterministic findings sit
before the material.

## Design

1. **Generator: split into a stable system prompt and a per-question task.**
   `GENERATOR_PROMPT_PARTS(params)` returns `{ system, task }`.
   - `system` depends only on the question type (mcq / true-false): the role,
     the difficulty self-assessment rule, the grounding rule, the option/role
     contract and every fixed formatting, placeholder, numeric and JSON rule.
     It names "the learning objective in the task" instead of the LO itself.
   - `task` carries everything that varies: LO and integration rule, target
     difficulty and rubric, hardness blocks, kind contract, instructor
     instruction, course material, angle, focus chunk, distinctness context and
     regeneration context.
   - `GENERATOR_PROMPT(params)` stays as `system + task` for tests and callers
     that want one string.
2. **Checker: same split.** `system` holds the fixed parts 1–2, verdict policy
   and JSON shape. `task` holds, in this order: LO / integration rule / hardness
   move, course material, deterministic findings, question JSON. The material
   comes before per-item data so items of the same LO share a longer prefix.
3. **`completeJson` accepts `promptCacheKey`.** Sent as `prompt_cache_key` only
   when the provider is `openai` with no custom endpoint (the official API).
   Other providers (Ollama, Anthropic, UBC Sandbox, OpenAI-compatible gateways)
   would receive an unknown passthrough option, so it is omitted for them.
   Keys: `financebot-generator-<type>-v1`, `financebot-checker-v1`.
4. **Pipeline** passes `systemPrompt` and `promptCacheKey` for generation,
   repair and check.

No cache warm-up is needed: batch items run sequentially, so the first item
writes the cache and later items read it.

## Not changing

- Distinctness context: stems are loaded per LO only (max 13 per LO locally,
  ~700 tokens at worst); not worth trimming.
- JSON retries: generation and check already use `jsonRetry: false`.
- Wording of any rule. Only position changes, plus the LO reference in the role
  line.

## Risk and verification

Moving the target difficulty and hardness blocks after the fixed rules could
change generation behaviour. Verification:

- Unit tests: prompt content, split invariants (system has no per-question
  data and is identical across LOs/difficulties), cache-key gating.
- Live run against the configured OpenAI model: generate a small batch for one
  LO and compare `cachedInputTokens` before/after, and check the questions still
  pass the checker.
