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

**state: `released`** (superseding the earlier version of this section,
which was written right after the first commit, before two review-driven
fix rounds landed two more commits and touched two more shared files —
`review-book.service.ts` and `client/src/views/student/practice-card.ts`.
Read this version, not any cached copy of the first one.)

- Final commit SHA: `210c68f` on `worktree-stephen-phase-2-task5-params`
  (3 commits total: `ae55672` implementation, `704b950` task-review fix
  round, `210c68f` final-whole-branch-review fix round). Went through
  implementer -> task review (spec ✅, quality Approved after 1 fix round)
  -> final whole-branch review (2 Important integration gaps found and
  fixed) -> re-verified **Ready to merge: Yes**. Not yet pushed to remote or
  opened as a PR as of this note — pending the human's push/PR decision via
  `finishing-a-development-branch`; will update this file again once that
  happens with the PR URL.
- Exact shared paths released to Codex, all three original ones plus two
  more discovered during the final review's cross-cutting check:
  - `client/src/api.ts` — see the diff summary above (unchanged from the
    first release note).
  - `client/src/main.ts` — see above (unchanged).
  - `docs/api-contract.md` — see above (unchanged).
  - `server/src/services/attempts.service.ts` — see above (unchanged).
  - `server/src/routes/practice.routes.ts` — see above (unchanged).
  - **New: `server/src/services/review-book.service.ts`** — `listReviewBook`
    now substitutes a parameterized entry's preview `stem` using the
    triggering attempt's pinned `paramValues` (falls back to raw `stem` when
    there's no pinned value, e.g. non-parameterized questions or missing
    attempts — safe no-op via `substituteParams`).
  - **New: `client/src/views/student/practice-card.ts`** — `submit()` now
    echoes the served question's `paramValues` back to `submitAttempt()`
    (previously missing entirely — a real bug this branch fixed, not a
    Task-5-introduced regression). If Slice A2's preview integration reuses
    this file's `submit()`/card logic, it inherits this fix for free; if it
    duplicates the logic instead, it needs the same echo.
  - `serving.service.ts` remains untouched (confirmed again across all 3
    commits).
- Tests run at final state: `npx jest` (full suite) — 51 suites / 570
  tests, all passing. `npm run typecheck && npm run lint && npm run build`
  all clean.

Codex may now begin Student Preview (Slice A2) integration against this
release, per Gate A1.5 in the Admin v0 plan.

