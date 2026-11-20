# Generation prompt caching — plan

Spec: `docs/superpowers/specs/2026-11-20-generation-prompt-caching-design.md`

- [x] **Task 1 — Generator split.** Add `GENERATOR_PROMPT_PARTS` in
      `server/src/services/question-generation/generator-prompt.ts`; keep
      `GENERATOR_PROMPT` as the joined string. Tests: system prompt is identical
      across LO, difficulty, chunks, stems and regeneration for one type, and
      contains none of them.
- [x] **Task 2 — Checker split.** Add `CHECKER_PROMPT_PARTS` in
      `checker-prompt.ts`, with material before findings and question JSON.
      Tests: system prompt identical across items; task order.
- [x] **Task 3 — Cache key.** `completeJson` option `promptCacheKey`, sent as
      `prompt_cache_key` only for provider `openai` without a custom endpoint.
      Tests with mocked env/toolkit.
- [x] **Task 4 — Pipeline wiring.** Generation, repair and check pass
      `systemPrompt` + `promptCacheKey`. Update pipeline tests that assert the
      prompt passed to `completeJson`.
- [x] **Task 5 — Verify.** `npm test`, `npm run typecheck`, `npm run lint`;
      live batch on the configured OpenAI model comparing cached input tokens.
- [x] **Task 6 — Docs.** `components/genai/llm/AGENTS.md` (cache key gating),
      AGENTS.md "Current state".

## Result (2026-11-20)

Unit suite green apart from the pre-existing `ta-ui.test.ts` type error
(uncommitted `themeId` change in `client/src/api.ts`, unrelated). Live run on
`gpt-6-luna`, four medium MCQ generator calls over two objectives:

| Arm | Input | Cached | Share |
|---|---|---|---|
| Old order (task, then rules) | 22,590 | 0 | 0% |
| New split (system + task + key) | 22,606 | 13,935 | 62% |

Every call after the first cached 4,645 tokens (~82%), including the calls for
the second objective. All eight replies parsed as four-option questions. The
checker split is unit-tested; its live cache rate was not measured.
