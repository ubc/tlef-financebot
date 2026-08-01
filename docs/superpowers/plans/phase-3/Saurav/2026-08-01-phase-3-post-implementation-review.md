# Phase 3 — Post-Implementation Review

_Reviewer: Saurav (Dev B)_
_Subject: Stephen's full Phase 3 implementation, merged to `main` as `ba0bae3` on 2026-08-01_
_Status: **review findings, awaiting Stephen's response.** Nothing here blocks or reverts shipped code._

> **What this document was, and why it changed.** It was opened as a Phase 3
> ownership/dependency proposal — the counterpart to Stephen's
> [2026-07-22 Phase 2 proposal](../../phase-2/Stephen/2026-07-22-phase-2-ownership-dependency-proposal.md)
> — because the Phase 3 core plan carried no `**Owner:**` line on any of its
> nine tasks. Stephen completed all nine tasks and merged them to `main`
> **sixteen seconds before** the proposal PR was opened (his merge:
> `2026-08-01 23:00:17Z`; PR #53: `23:00:33Z`). Neither side could have seen the
> other. The owner map is therefore moot and has been demoted to Appendix A as
> history. What survives is the audit, which was written against `main` and
> turned out to be load-bearing: two of the issues it predicted are now shipped.

---

## 1. What happened

Stephen's takeover notice ([`../Stephen/STATUS.md`](../Stephen/STATUS.md))
records the authorization:

> "Stephen explicitly authorized this session on 2026-08-01 to finish **all
> Phase 3 work**, including work that the default split originally assigned to
> Saurav. At takeover time Saurav's Phase 3 directory contained only its
> original empty README template […] and no Saurav Phase 3
> implementation/status/claim file or remote Phase 3 branch existed."

**That was accurate when he checked it**, and it follows the same pattern as the
Phase 2 Codex takeovers I accepted at the time. I am not disputing the takeover.
I am recording that the race was invisible to both sides, so neither of us did
anything wrong, and noting the one process consequence in §5.

Delivered in 21 commits merged as `ba0bae3`: 96 files, ~7,900 insertions,
Tasks 1–9 complete, core plan at 29/29. Local branch `codex/phase-3-exit-checks`
was never pushed to origin, and the merge went **directly to `main` with no
pull request** — so Phase 3 has had no cross-developer review, which is what
this document is trying to partially supply after the fact.

## 2. What I verified myself, and what I am taking on trust

Everything in §3 was verified by reading the code on `ba0bae3`.

**I have not independently run the test suite.** Stephen's STATUS claims lint,
typecheck, Jest **769/769**, and **21 Playwright** scenarios green with only the
opt-in live-LLM test skipped. I have no reason to doubt it and have not
confirmed it. Anyone relying on that number should re-run it rather than cite
this document.

## 3. Findings

### 3.1 Two AD-07 admin controls are wired end to end and control nothing — CONFIRMED

The proposal predicted this before the code existed (Appendix A): Task 8's
AD-07 spec inherited a `masteryEvaluator` model selector and a `layer2Evaluator`
feature flag from Task 13, **which is slipped and was never built.**

Both shipped anyway, as full-stack controls with no consumer.

`layer2Evaluator` — every occurrence in the repo:

| Location | What it does |
|---|---|
| `server/src/types/domain.ts:135` | declared on `PlatformSettings` |
| `server/src/routes/admin.routes.ts:59` | Zod-validated on `PUT` |
| `server/src/services/admin.service.ts:338` | defaulted to `true` |
| `client/src/api.ts:175` | typed on the client |
| `client/src/views/admin/platform-settings.ts:25,37` | rendered as a checkbox, read back on save |
| `tests/unit/*` | passed through in fixtures only |

There is no read of this flag anywhere in `server/src` outside its own
definition and persistence. An admin can toggle it, it saves, and nothing
observes it.

`masteryEvaluator` — same shape: declared (`domain.ts:132`), validated
(`admin.routes.ts:56`), seeded from `env.llmModelMasteryEvaluator`
(`admin.service.ts:335`), and never read to select a model.
`server/src/services/` contains `mastery.service.ts` (Layer-1) and
`exam-mastery.service.ts` (Task 4's qualifier pass); there is no Layer-2
evaluator to configure.

**Severity: low, but it is a live trap.** An admin who disables
"Layer-2 evaluator" gets a UI that confirms the change and a system that never
had the behaviour. That is worse than the control being absent.

**Recommendation (Stephen's call — Task 8 is his):** remove both from the AD-07
surface, or label them explicitly as inert pending Task 13. My preference is
removal; re-adding them is trivial if Layer-2 is ever picked up.

### 3.2 `reviewerAgent` is correctly wired — NOT a finding, verified positive

Recorded because the proposal flagged it as a cross-owner seam into my
`generation.service.ts` and asked for a coordination-ledger entry first. The
seam was taken without one, but **the implementation is right**, so I am closing
the concern rather than pressing it.

The flag is read at three call sites — `generation.service.ts:277`, `:374`,
`:535` — each skipping the reviewer LLM call and substituting exactly the
specified decision:

```ts
: { decision: 'flag', reasoning: 'Reviewer agent disabled at generation time.' };
```

`tests/unit/generation.service.test.ts:135` pins it properly: asserts
`completeJson` is called **twice, not three times**, and that `createQuestion`
receives the flagged `agentDecision` carrying the reviewer's reasoning string.
The cost-control path (`maxGenerationsPerDay`) is likewise consumed at
`generation.service.ts:181` with its own test. Good work on my file.

### 3.3 Capability model vs. Admin v0 grants — resolved well, undocumented

The proposal asked for a written merge-or-coexist decision before either of us
wrote code, since Task 1's `capabilitySettings` overlaps Admin Console v0's
shipped `platformInstructorGrants`.

The shipped answer is **coexist** — both collections are present in
`collections.ts:16` and `:41`, with `capabilitySettings` uniquely indexed on
`{ scope, courseId }`. That is the option I argued for: platform *enablement*
("may this person reach the instructor shell at all") and in-course
*permissions* are different questions with different lifecycles.

**No finding — I agree with the outcome.** The only gap is that the decision
exists solely as code. Worth one paragraph in the shared plan so the next person
to touch authorization does not "unify" them.

### 3.4 The Phase 1 exit gate is still open, and was passed over a third time

Neither `tests/e2e/core-loop-demo.spec.ts` nor
`tests/unit/approved-only-serving.test.ts` exists on `ba0bae3`. Phase 1 Task 8
Step 5 (live-LLM generation checkpoint) has still never run.

Timeline of this item:

1. **2026-07-22** — Stephen defers Task 16, explicitly exempting Phase 2 from waiting. Reasonable, and recorded in writing.
2. **2026-07-28** — Phase 2 completes without it.
3. **2026-08-01** — the S0 reconciliation (PR #52, merged) re-establishes it as owed, in the shared core plan.
4. **2026-08-01** — **Phase 3 is declared complete with it still open.**

Phase 3's Task 9 exit checks are green on their own terms, and Phase 3's own
Global Constraints contain the tripwire: *"if Phase 1/2 work is unfinished on
Aug 17, finish it first."* It is Aug 1 and Phase 3 finished early, so the
tripwire never fired — but the underlying work is still owed, and it is now the
only thing between us and a claimable exit for **three** phases.

**This is the one item I would like an actual decision on**, not a fourth
silent pass. Either it runs, or it is written off with a named owner and date.

**Cost estimate: low.** `approved-only-serving.test.ts` is a unit test over fake
collections, and much of its property is already pinned in
`serving.service.test.ts` / `attempts.service.test.ts`. `core-loop-demo.spec.ts`
is one Playwright flow across surfaces that now all exist and are individually
E2E-covered. This is a day, not a week — and Task 8 Step 5 would finally
exercise the generation pipeline against a real model, which nothing ever has.

### 3.5 Staleness audit — outcome

The proposal listed eight stale references in the Phase 3 core plan. The
implementation resolved them silently by building against reality rather than
the plan text, which is the right instinct. Recorded so the audit is not lost:
`course-setup.ts` (gone since Phase 1 Task 15's four-way split),
`admin.service.ts` / `admin.routes.ts` / `ensureAdmin()` (all pre-existing from
Admin v0, listed as "create"), and `mastery-evaluator.service.ts` (never built)
were the substantive ones. Only the last had consequences — see §3.1.

## 4. Summary

| # | Finding | Severity | Owner |
|---|---|---|---|
| 3.1 | `layer2Evaluator` + `masteryEvaluator` are inert admin controls | Low, live | Stephen (Task 8) |
| 3.2 | `reviewerAgent` wiring | None — verified correct | — |
| 3.3 | Capability/grant coexistence undocumented | Trivial | Either |
| 3.4 | Phase 1 exit gate open across three phases | **Decision owed** | Joint |
| 3.5 | Plan staleness | Resolved in code | — |

Phase 3 is a large, coherent delivery and the parts I read are good. Nothing
here argues for reverting anything.

## 5. One process note

Phase 3 reached `main` with no pull request and therefore no cross-developer
review. Phases 1 and 2 both went through PR review, and that review caught real
unrecoverable-outcome bugs in both directions — my Task 6 review found three,
Stephen's parameter sandbox took eight rounds. I am not asking to re-litigate a
merged phase. I am asking that **Phase 4 go back through PRs**, because review
is where this project has historically found its worst bugs.

Related and unambiguously good: `sync-plans` now publishes to the
`docs/phase-0-shared-services` branch instead of `main`, because plan-only
pushes were triggering the staging deployment. `CLAUDE.md`, `AGENTS.md`, and all
eight plan `README.md` files were updated to match.

---

## Appendix A — the original ownership proposal (history)

Preserved because §3.1, §3.3, and §3.4 originated here, and because the next
phase may want the format. **Superseded: Stephen owns all of Phase 3.**

The proposed split followed the core plan's own "two fully parallel bundles"
architecture and the Dev A/Dev B arc binding:

| | Tasks |
|---|---|
| Saurav (Dev B) | 1 capability model, 6 TA, 7 analytics |
| Stephen (Dev A) | 2–5 exam vertical, 8 admin |
| Joint | 9 phase exit |

Reasoning that still applies to future phases:

- **Give one owner a whole vertical when its tasks share a route file.** Tasks 2/3/4 all write `exams.routes.ts`; splitting that reproduces the Phase 2 Tasks 8/9 stacked-branch friction. This is why Task 2 was assigned to Stephen despite being instructor-facing.
- **Do not split a dependency root from its only consumer.** Task 1 (capability model) exists to serve Task 6 (TA); putting them on opposite sides of an ownership line blocks the larger task on the other developer's sequencing.
- **Split oversized tasks into independently reviewable halves**, as Phase 2 Task 2 was split. Task 6 should have been 6a (TA management) and 6b (TA workflows).

The proposal also flagged a schedule risk — ~3 weeks for nine tasks — and
proposed a five-item slip order. **That call was wrong**: Stephen delivered all
nine in a day. Recorded because a review document that only lists other people's
misses is not worth much.
