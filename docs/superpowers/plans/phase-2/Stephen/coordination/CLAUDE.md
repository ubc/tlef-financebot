# Claude file claim — Stephen work

**Ledger owner:** Claude  
**Last updated:** 2026-07-28  
**State:** claimed — Task 5 in progress

## Active task

Phase 2 Task 5 — parameterization config + serve-time randomization.

## Branch and base

- Branch: `worktree-stephen-phase-2-task5-params` (worktree
  `stephen-phase-2-task5-params`); will push to remote as
  `stephen/phase-2-task5-params`.
- Base SHA: `2557d86` (`origin/main`, includes PR #33 — Admin v0's Gate A0
  publish commits and Task 4's merge are both already in this base).

## Claimed by Claude — DONE, see Handoff below for the final file list

Actual paths touched ended up differing slightly from the provisional list
below (decision recorded, not a surprise): `serving.service.ts` was left
untouched — `selectNextQuestion` stays pure selection logic per its own
module docstring — and the seed-draw/substitution wiring for `/practice/next`
went into `practice.routes.ts` instead (it already assembles the sanitized
response object field-by-field for the no-leak security invariant, so this
keeps that assembly in one place). `questions.service.ts` and
`client/src/views/instructor/question-detail.ts` (one added nav link) also
ended up touched, neither on the original list.

- Create: `server/src/services/params.service.ts`
- Create: `client/src/views/instructor/param-config.ts`
- Create: `tests/unit/params.service.test.ts`
- Modify: `server/src/services/attempts.service.ts`
- Modify: `server/src/services/questions.service.ts` (added `generateScript`
  to the existing `ContentKey`/`editQuestion` versioning, mirroring the
  already-shipped `paramSlots` pattern)
- Modify: `server/src/routes/questions.routes.ts`
- Modify: `server/src/routes/practice.routes.ts` (serve-time seed draw +
  substitution for `/practice/next`)
- Modify: `tests/unit/attempts.service.test.ts`,
  `tests/unit/practice.routes.test.ts`, `tests/unit/questions.routes.test.ts`,
  `tests/unit/questions.service.test.ts`

Note for Codex: `server/src/types/domain.ts` was NOT modified by Task 5 —
`QuestionVersion.paramSlots`/`generateScript` and `AttemptRecord.paramValues`
were already present (added ahead of Task 5), exactly as expected.

## Shared wiring Claude touched, in small append-only diffs

- `client/src/api.ts` — new `patchQuestionParams` / `previewQuestionParams`
  client functions + `ParamSlotInput`/`ParamPreviewResult`/`ParamPreviewDraw`
  types + `paramValues?`/`seed?` added to `PracticeQuestion` and
  `AttemptResult.feedback.retry`. No existing exports renamed or restructured.
- `client/src/main.ts` — one new route line
  (`/instructor/course/:id/bank/:questionId/params` -> `renderParamConfig`)
  plus its import. Nothing else in this file touched.
- `docs/api-contract.md` — new `PATCH /api/questions/:questionId/params` and
  `POST .../params/preview` entries under "Question bank"; the `/practice/next`
  and `/api/attempts` entries under "Practice (student)" updated in place to
  document the new `paramValues`/`seed` fields (and `/practice/next`'s doc
  entry corrected to match the route's actual flat response shape, which was
  already flat on main — not a Task 5 behavior change).

`server/src/app.ts` was **not** touched by Task 5 — the new param-config
endpoints mount on the already-registered `questionsRouter`, so no new
`app.use(...)` line was needed. Codex's Admin/Preview routers are unaffected
by this branch.

## Handoff

**state: `released`**

- Final commit SHA: see the `feat: parameterization config...` commit on
  `worktree-stephen-phase-2-task5-params` (this session did not push to
  remote or open a PR — that's the human's call).
- Exact shared paths released to Codex: `client/src/api.ts`,
  `client/src/main.ts`, `docs/api-contract.md` (all three diffs above), plus
  `server/src/services/attempts.service.ts` and
  `server/src/routes/practice.routes.ts` for Slice A2's preview integration
  (NOT `serving.service.ts` — that file is unchanged, see the note above).
- Tests run: `npx jest` (full suite) — 51 suites / 566 tests, all passing.
  `npm run typecheck && npm run lint && npm run build` all clean.

Codex may now begin Student Preview (Slice A2) integration against this
release, per Gate A1.5 in the Admin v0 plan.

