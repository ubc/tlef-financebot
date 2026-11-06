# Authoring currentness and recoverable replacement

Status: implemented and verified with a completed, isolated zero-model HTTP/Mongo
run, intercepted production-UI browser checks, and focused regression suites.
The checks establish currentness, idempotency and recovery behavior for their
recorded fixtures. They do not establish generated-question quality, teacher
acceptance or improved effective question yield.

## Problem and resulting behavior

A retained regeneration candidate can become unusable when its original
question, source files, learning objective or Bank/Queue memory changes. The
server already checked these prerequisites, but several known failures reached
the HTTP client as unexpected `500` responses. The editor then displayed raw
codes and allowed repeated replacement attempts against the same stale state.

The generation router now maps exact known currentness failures to `409` and
unusable comparison/candidate prerequisites to `422`. Unknown errors remain
`500`; no error-prefix rule turns an unexpected failure into a known conflict.
The editor translates exact matching status/code pairs into actionable English.

After a confirmed stale or unusable adoption, the editor retains the current
question, generated alternative, source/memory checks, token receipt, prompt and
change/preservation requirements. It disables **Replace with variant** until an
explicit new generation. Editing and restoring an editor field cannot re-enable
the rejected candidate. Only that question's pending-request and candidate
restoration keys are removed; unrelated session state remains. A subsequent
explicit generation uses a fresh UUID, including when its inputs are unchanged.
The server still rechecks all prerequisites for that new request.

An unknown `500`, network failure or unrecognized human-readable conflict does
not prove that replacement failed or that the candidate is stale. Those cases
retain candidate restoration and adoption retry. A reload can restore the same
candidate without another generation call. Existing response-loss recovery also
retains the pending generation UUID, so an uncertain generation request is
replayed rather than silently duplicated. No error handler automatically starts
generation or spends tokens.

For a changed original question, the guidance asks the instructor to preserve
unsaved edits and reload the current version before generating again. For source
processing failures, it asks them to wait for current files to finish processing.
For Bank/Queue changes, it asks for a new alternative checked against current
memory. A missing original comparison remains a rejection, not a server override
of the independent-task requirement.

## Exact server and UI scope

The implementation is in `server/src/routes/generation.routes.ts` and
`client/src/views/instructor/question-detail.ts`. The existing production
regeneration, source evidence, memory, context and coordinated-commit services
remain responsible for the checks and writes.

| Exact prerequisite | HTTP handling | Recovery guidance |
| --- | --- | --- |
| `generation-evidence-source-changed` | `409` | Inspect current files and generate again. |
| `generation-evidence-material-unavailable` | `409` | Restore or select available sources, then generate again. |
| `generation-evidence-source-not-ready`, `generation-evidence-chunks-missing`, `generation-evidence-ingest-incomplete` | `409` | Wait for complete source processing before generating again. |
| `authoring-objective-changed` | `409` | Review the current learning objective. |
| `generation-memory-original-changed`, `generation-memory-original-version-unavailable`, existing `question-changed-during-regeneration` | `409` | Preserve edits and reload the current original version. |
| Existing `authoring-memory-changed` | `409` | Generate against current Bank/Queue memory. |
| `regeneration-original-comparison-required`, `authoring-original-comparison-required`, `authoring-original-comparison-invalid` | `422` | Generate a candidate with a valid original comparison. |
| `generation-memory-original-scope-missing`, `generation-memory-required-original-missing` | `422` | Review the original version and learning-objective scope. |
| `generation-memory-required-original-too-large` | `422` | Shorten the saved question or edit manually. |
| Existing `regeneration-candidate-not-eligible` | `422` | Inspect the retained checks and generate a new candidate. |

The imported-script/manual-edit guidance remains available for its exact `409`
code. A recognized code returned as `500` is deliberately not treated as a
terminal stale-candidate confirmation. Request-UUID conflicts, other unknown
conflicts and custom human messages retain their existing behavior.

## Completed HTTP/Mongo verification

The retained run is
`audit-results/authoring-zero-call-guards-2026-10-17/live/results.json`, with its
prospective `live/plan.json` and separate file-only `preflight/plan.json`.
It completed with exit code 0 on the local replica set in **1,412 ms**, with
**eight passed groups and 18 received HTTP responses**. This elapsed time is a
small local guard test, not generation latency or a production benchmark.

The harness mounts the real generation and question routers in Express and
uses real Mongo collections, question creation/editing, source packets, memory
snapshots, currentness checks and adoption/transaction code. Its source manifest
and one-chunk original are constructed in an exclusively owned database; they
are not uploaded, parsed or indexed by the ingestion pipeline.

Authentication identities are synthetic middleware fixtures, not CWL/SAML
sessions. Eligible candidate records and their quality assessments are seeded
synthetic state solely to reach adoption guards. A seeded `eligible` field is
not a model or professor verdict. The conceptual True/False fixtures also do
not validate numerical generation or serving.

Before production runtime imports, the harness installs a socket/fetch fence
and replaces only external model, embedding, vector and job integration
boundaries with counted functions that throw on any invocation. It never starts
Agenda, Qdrant or FastEmbed. A forbidden attempt invalidates the run even if a
caller catches the thrown error. The only permitted sockets are the owned local
Mongo endpoint and the harness's own ephemeral loopback HTTP listener.

| Group | Received responses | Verified result |
| --- | ---: | --- |
| Stale original with a new UUID | 2 | A real manual original edit succeeds; regeneration pinned to the previous version returns `409` before candidate insertion. No additional head/version/candidate write occurs. |
| UUID replay, conflict, authorization and stale replay | 8 | Signed-out and foreign identities receive `401`/`403`. Exact UUID/input replay returns the retained candidate. Reusing that UUID with another prompt returns `409`. After a real original edit, cached replay remains a read-only `200`, while a fresh UUID pinned to the old version and adoption of the stale candidate both return `409`. |
| Changed original-source revision | 1 | Revision-only mutation keeps the manifest ready but invalidates the evidence identity; adoption returns `409 generation-evidence-source-changed` without changing the question/candidate. |
| Changed Bank neighbor | 2 | A real edit of another question changes memory; adoption returns `409 authoring-memory-changed` without a target write. |
| Tampered candidate content | 1 | Candidate bytes changed without a matching recorded hash are rejected with `422 regeneration-candidate-not-eligible`. |
| Missing independent-task original comparison | 1 | An independent-task candidate without the required original comparison is rejected with `422 regeneration-original-comparison-required`. |
| Changed objective at the transaction fence | 1 | Adoption returns `409 authoring-objective-changed`; earlier source-fence writes roll back and the original question/candidate remain unchanged. |
| Synthetic positive adoption and replay | 2 | Adoption adds exactly one target question version. Repeating adoption returns the same version ID and does not add another version. |

All eight groups ran; the two transaction-dependent groups were not skipped.
The final receipt records zero external-boundary attempts, zero model sends and
zero embedding calls. `modelCallReceipts`, `modelUsageSessions`, `contentRuns`
and `agendaJobs` each contain zero records. The database retains eight synthetic
courses, 16 questions, 20 question versions and seven candidate records.

The positive fixture proves one-version persistence and idempotent replay for
that seeded conceptual candidate. It does not prove that a newly generated
candidate would pass source interpretation, novelty, role, difficulty or teacher
review. Read-only cached replay also does not reauthorize stale adoption: the
separate adoption endpoint remains the write gate.

## Browser and regression evidence

`audit-results/authoring-zero-call-guards-2026-10-17/browser.json` records
**31/31 passing browser cases**, with no skipped, unexpected or flaky results.
The browser uses compiled production components and intercepted APIs, not the
real Mongo harness. It covers authoring upload/workspace flows as well as
regeneration; seven new cases specifically exercise this recovery change:

- Source and Bank-memory `409` rejections preserve evidence and disable Replace.
- Missing-comparison and ineligible-candidate `422` rejections do the same.
- A generation-source prerequisite rejection clears only its unusable recovery
  identity, and an explicit retry uses a different UUID.
- Unknown `500` and network adoption failures retain candidate restoration,
  reload without generation, and allow same-candidate adoption retry.

The stale-source case also retains desktop/light and mobile/dark screenshots
under `browser/`, named `stale-source-retained-*-mocked.png`. These are mocked UI
evidence, not screenshots of a model-quality acceptance run. Existing dirty-edit,
response-loss, diagnostic-only, withheld-candidate and custom human conflict
checks remain in the passing suite.

Verification history is retained rather than collapsed into one inflated count:

| Receipt | Recorded result | Relationship |
| --- | --- | --- |
| `initial-units.json` | 59/59 tests in two suites | Generation-route and pure harness checks before the added exclusive-owner regression. |
| `final-units.json` | 60/60 tests in the same two suites | Includes the additional atomic, concurrent database-owner claim test. |
| `integrated-units.json` | 226/226 tests in 13 suites | Includes those same 60 tests plus focused source, context, commit, regeneration-memory, outline and cache suites. |

These counts overlap and must not be added. Before those retained successful
runs, a sandboxed Supertest attempt could not bind its listener (`EPERM` on
`0.0.0.0`). That attempt did not establish an application assertion failure or a
Mongo/model result; the later root-executed checks provide the runtime evidence.
Scoped ESLint and the complete `npm run typecheck` passed. A standalone browser
spec TypeScript invocation could not resolve its existing absolute `/js/...`
runtime imports; the compiled browser suite is the relevant verification of
those imports.

## Safe reproduction

Use the installed project dependencies and the separate local Mongo instance on
port `27029`. Choose a never-used database suffix and two new output directories;
the examples below must not be pointed at an earlier experiment database or
existing output directory. No provider credentials are required.

First prepare a file-only plan; omitting `--live once` makes no database or
provider calls:

```sh
node --import tsx scripts/verify-authoring-zero-call-guards.ts \
  --database financebot_quality_smoke_retest_zero_call_guards_repro_20261017_01 \
  --output audit-results/authoring-zero-call-guards-repro-20261017-01-plan
```

Then execute the guarded local run in a fresh process:

```sh
MONGODB_URI='mongodb://127.0.0.1:27029/?directConnection=true' \
MONGODB_DB_NAME=financebot_quality_smoke_retest_zero_call_guards_repro_20261017_01 \
node --import tsx scripts/verify-authoring-zero-call-guards.ts \
  --database financebot_quality_smoke_retest_zero_call_guards_repro_20261017_01 \
  --output audit-results/authoring-zero-call-guards-repro-20261017-01-live \
  --live once
```

Admission requires a credential-free loopback Mongo URI on exactly `27029`, an
exact match between the configured and declared database, and the prefix
`financebot_quality_smoke_retest_zero_call_guards_`. It refuses a previously
connected Mongo runtime and every nonempty database. An atomic unique ownership
record prevents two processes from sharing a database even if both initially
observe it as empty. Server source files and the harness are pinned before
runtime admission and checked again before completion.

The script retains its owned fixture database and receipts; it does not drop or
clean up any old database. On standalone Mongo, transaction-dependent groups
are recorded as not executed, so a standalone result cannot reproduce the eight
passed groups above. Do not start the full application server or an Agenda
worker for this harness.

## Remaining quality work and paid-phase status

This local verification required no model approval and dispatched no paid
request. It does not execute or bypass the pending source-interpretation probe.
The original declaration, retained source/candidate inputs, eleven prior
ledgers and automatic-approval rejection history remain separate evidence.
The old 252-file declaration predates this route change; its exact code bytes
were archived under
`audit-results/quality-lab-source-interpretation-2026-10-17-preflight/code-before-source-conflict-fix/manifest.json`.
It cannot be silently reused against changed code. Any paid continuation needs
its own admitted current declaration and authorization.

The later file-only successor is now prepared under
`quality-lab-source-interpretation-2026-10-17-preflight-r3`. It pins 253 code files
and the unchanged ten prompt shapes; its `supersession.json` retains the archived
original and failed preparation. It remains unexecuted pending the same explicit
API approval. See the [probe status](SOURCE-INTERPRETATION-REVIEW-PROBE-2026-10-17.md).

Original-version admission and adoption conflicts now have concrete zero-model
HTTP/Mongo evidence. Fresh independent regeneration, source-interpretation
judgments, actual saved-question yield, multi-chapter semantic coverage and
professor review effort still require their separately scoped acceptance work.
Nothing in these 18 HTTP responses resolves the previously recorded ambiguous
questions or turns a saved Draft into a teacher-approved question.
