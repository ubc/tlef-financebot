# Structure generation optimization — plan

Spec: `docs/superpowers/specs/2026-11-23-structure-generation-optimization-design.md`

- [x] **P0.1 Corpus-scaled ceiling.** `AuthoringBudgetOptions.maxEstimatedTokensCeiling`;
      `structureEstimatedTokenCeiling(sections)`; `generateStructure` loads the
      corpus once and sizes its budget. Env `AUTHORING_STRUCTURE_MAX_ESTIMATED_TOKENS`
      (+ `.env.example`). Tests: ceiling clamp, budget admits above the default.
- [x] **P0.2 Review stage.** Stage `checking` + per-receipt progress during review.
- [x] **P0.3 Error text** for `structure-review-budget-exhausted` in the workbench.
- [x] **P1 Token usage on the structure page** via `getContentRunUsage`.
- [x] **P2.1 Extraction concurrency** default 4, no hard cap of 2.
- [x] **P2.2 Correction rate** — classify validation reasons, fix the dominant one.
- [ ] **Verify** — typecheck, unit tests, live run on the 8-file COMM 298 set.
- [ ] **P3 / P4** — separate follow-up (quality constraints, per-stage models, eval harness).

## P3 result — LO wording rules (2026-11-23)

`OUTLINE_LO_WORDING_RULES` added to every outline call (synthesis and
organization). Same cached extraction; synthesis replayed identically for both
organization arms; measured before the source review (coverage = claimed).

| Arm | Topics | LOs | Avg words | >30 w | Compound | Case-bound | Tool | Topics <3 / >7 | Claimed coverage | Class 5 | Perpetuity/annuity LOs | Org time |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Luna, old prompt | 17 | 89 | 28.4 | 31 | 40 | 4 | 2 | 3 / 5 | 448/469 | 71/74 | 2 | 38 s |
| Sol org, old prompt | 16 | 84 | 31.4 | 38 | 36 | 4 | 2 | 2 / 5 | 469/469 | 74/74 | 2 | 71 s |
| Luna, rules | 19 | 109 | 17.3 | 6 | 12 | 3 | 0 | 1 / 6 | 425/469 | 58/74 | 5 | 31 s |
| Sol org, rules | 23 | 122 | 11.3 | 0 | 0 | 0 | 0 | 0 / 0 | 469/469 | 74/74 | 6 | 86 s |

Luna follows the rules only partly (several old long LOs kept verbatim, one
1-LO topic, an 11-LO topic, lower claimed coverage). Sol organization follows
them fully but produces more, sometimes thin LOs. Not yet verified through the
source review.

Follow-up (2026-11-23): the 20-word cap was removed at the developer's request.
The rule now asks for concise LOs with no fixed word limit; the one-capability,
no-case, no-tool and 3–7-per-topic rules are unchanged.

## Coverage gap pass (2026-11-23)

Spec: `docs/superpowers/specs/2026-11-23-structure-coverage-gap-pass-design.md`

- [ ] `server/src/services/structure-gap-pass.ts`: prompts, validators, credit application, merge (pure, unit-tested).
- [ ] Wire into `generateStructureWithBudget` after admission (Utility check, organizer fill, Utility review of new LOs); best-effort.
- [ ] `coverage.gapPass` type + Source coverage panel summary.
- [ ] Tests, typecheck, live run comparing covered points before/after.
