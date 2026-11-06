# Reviewed exam export to Canvas — design proposal

Status: **design only**, checked against official Instructure documentation on
October 17, 2026. No Canvas API request, write, OAuth scope change, generated
exam, model call, migration or deployment was performed. This is the stretch
goal; question quality and source coverage remain the immediate work.

## Product flow

The Instructor assembles a paper from the approved bank, optionally redraws
verified numerical variants, and reviews the exact frozen questions. A separate
**Export to Canvas** review shows the target course, question count, points,
duration, availability, feedback policy, and unsupported features. The Instructor
confirms that concrete export. The proposed first export must produce a verified
unpublished Canvas draft and its review link. An unpublished creation contract
has not been established yet. Publishing remains an explicit action in Canvas
during the initial rollout.

Generation never occurs during export. Private exam generation may feed the
normal Instructor review process, but neither a model judgment nor an export
receipt substitutes for approval. A changed paper requires a new reviewed
snapshot; an existing export is never silently rewritten.

## Integration options and deployment discovery

Canvas documents content migrations with an upload-preparation flow and
asynchronous progress/issues. Discover the target deployment's migration types
before choosing a supported QTI import format. A downloadable package should
precede automated migration so the same mapping can be inspected independently.
[Canvas Content Migrations](https://developerdocs.instructure.com/services/canvas/resources/content_migrations)

Canvas also documents New Quiz creation and item operations. Treat New Quizzes
as a distinct adapter, rather than assuming that a Classic Quiz or package
import produces an equivalent result. Verify the institution's enabled APIs and
accepted question bodies in a sandbox course.
[Canvas New Quizzes](https://developerdocs.instructure.com/services/canvas/resources/new_quizzes),
[Canvas New Quiz Items](https://developerdocs.instructure.com/services/canvas/resources/new_quiz_items)

The current repository requests read-only Canvas scopes in
`server/src/components/canvas/index.ts`. Direct export therefore needs a
reviewed Developer Key scope change and account reconnection. Continue using
the existing backend-only encrypted token store, configured Canvas origin, and
course-scoped authorization. Discover requirements without sending a write.

## Mapping and retained receipts

| FinanceBot value | Export rule |
| --- | --- |
| Pinned approved version | Export exactly the reviewed version and store its digest. |
| Numerical variant | Freeze displayed parameters, computed options, correct key, and explanation. Do not export a random-generation script. |
| MCQ / True-False | Map stable option identifiers, one correct answer, and points; compare after read-back. |
| Markdown and LaTeX | Convert through an allowlisted renderer; validate equations and accessible text in Canvas. |
| Correctness and explanations | Map feedback policy explicitly; withhold export if the target cannot preserve the reviewed policy. |
| Source evidence and private formula definitions | Retain in FinanceBot authoring records; omit from student question bodies. |
| Topic/LO lineage | Retain local metadata and mappings; no assumption that Canvas has matching LO objects. |
| Timing/accommodations | Report each mapped, deliberately omitted, or unsupported setting before confirmation. |

A durable export record binds actor, FinanceBot course, target Canvas course,
reviewed revision, publication/snapshot digest, adapter version and request key.
Track queued, uploading, importing, checking, completed, partial, failed and
unknown outcomes, plus remote quiz/migration/item IDs. Retry reconciles existing
remote IDs first. A timeout after remote creation is an unknown outcome, not
permission to create another quiz. Partial exports remain unpublished and show
the affected items.

## Acceptance gates before enabling direct writes

1. Pure conversion fixtures: conceptual MCQ, T/F, decimal CAPM, long equations,
   Unicode and sanitized rich text; exact correct-key and point preservation.
2. Downloadable package: import into an authorized sandbox and compare every
   question, option, computed answer, feedback rule and rendered equation.
3. Direct adapter: repeated confirmation, interrupted upload, remote timeout,
   partial item failure, revoked OAuth, wrong course and stale paper revision.
4. Read-back: counts, option mappings, correct answers, points and available
   settings must match. Rendering and policy differences block completion.
5. Instructor reviews the unpublished Canvas draft before real student release.

No API success code alone establishes exam correctness. Real deployment access
and sandbox read-back are still required; this proposal does not claim that
Canvas export is implemented or tested.

## Current adapter boundary: read scopes are not write support

Read-only inspection found seven `CANVAS_SCOPES` entries: courses, course users,
enrollments, sections, course files, an individual course file and file public
URLs. All are GET. The local POST/PUT/DELETE routes in
`server/src/routes/canvas.routes.ts` manage FinanceBot connections, links and
imports; they do not export exams to Canvas.

The installed `@ubc/ubc-genai-toolkit-lms-integration` is vendored **1.4.0**.
Its `ApiClient` has GET/paginated GET/POST/PUT/DELETE and constrained file upload,
but no PATCH. Its `resolvePath` prepends `/api/v1/` unless a path already starts
with `api/v1/`. Passing `/api/quiz/v1/...` would incorrectly request
`/api/v1/api/quiz/v1/...`. New Quizzes therefore needs a reviewed toolkit/adapter
extension for the quiz namespace and PATCH, preserving origin, token refresh,
pagination and credential controls. The inspected JSON request path uses plain
`fetch` without an explicit whole-call abort; bounded deadlines and write-replay
rules also need implementation. Do not bypass the adapter with arbitrary
URLs or browser-held tokens. The generic upload helper is not proof that it
handles a content migration's `pre_attachment` ticket.

These findings come from the installed toolkit's
`dist/providers/canvas/api-client.{js,d.ts}`, and the repository's
`server/src/components/canvas/index.ts`. No runtime module was imported.
New scopes also require a Developer Key review and fresh scoped OAuth consent;
adding a scope to a key does not expand an already issued token.
Confirm that the key actually enforces scopes; the seven requested GET strings
alone do not prove the deployment's effective token permissions.
[Developer Keys](https://developerdocs.instructure.com/services/canvas/oauth2/file.developer_keys)

## Actor, destination and remote identifiers

Bind each export to `(configured Canvas origin, actor PUID, OAuth canvasUserId,
Canvas course ID, FinanceBot course ID, reviewed paper digest)`. Retain IDs as
opaque strings. A PUID, email, course code or display name is not a Canvas ID.
Preserve backend AES-256-GCM token storage and course authorization. Use the
exporting actor's connected token, not another Instructor's retained link token.

One FinanceBot course may link several Canvas courses. Require one explicit
destination per export and separate receipts for additional targets. Recheck
current local Instructor access and remote teaching access before dispatch;
an old roster snapshot or successful login does not grant quiz-write permission.
Keep assignment, quiz and item IDs distinct. New Quiz routes use the associated
assignment's `:assignment_id`; do not substitute a Classic Quiz ID or assume all
returned IDs are interchangeable. [New Quizzes](https://developerdocs.instructure.com/services/canvas/resources/new_quizzes)

## Prospective endpoint and scope inventory

None of these scopes is requested by the current app. For each row, the exact
OAuth scope is `url:<METHOD>|<path>`, keeping the literal placeholders. Select
one adapter's minimum scope set rather than enabling every option.

### Upload-backed content migration

| Method | Exact path | Use |
| --- | --- | --- |
| GET | `/api/v1/courses/:course_id/content_migrations/migrators` | Discover supported formats. |
| POST | `/api/v1/courses/:course_id/content_migrations` | Prepare migration/upload. |
| GET | `/api/v1/courses/:course_id/content_migrations/:id` | Read migration state. |
| GET | `/api/v1/courses/:course_id/content_migrations` | Reconcile uncertain creation. |
| GET | `/api/v1/courses/:course_id/content_migrations/:content_migration_id/migration_issues` | Enumerate issues. |
| GET | `/api/v1/progress/:id` | Poll asynchronous work. |

Use the discovered migrator contract; do not assume a particular QTI version or
New Quizzes conversion. File metadata goes in `pre_attachment`. Processing
follows upload completion, and preparation can fail without an upload URL.
Selective import additionally requires GET `.../:id/selective_data` and PUT
`.../:id`, with a possible `waiting_for_select` state. Keep overwrite disabled
and use unique package identifiers. [Content Migrations](https://developerdocs.instructure.com/services/canvas/resources/content_migrations),
[Progress](https://developerdocs.instructure.com/services/canvas/resources/progress)

Treat upload parameters as opaque; send file bytes only to the authenticated
ticket's permitted destination, without Canvas bearer tokens or cookies. Confirm
the upload back against Canvas. Retain the configured-origin API boundary and a
reviewed storage-host allowlist. Avoid making the exam publicly available through
`settings[file_url]`. [File Uploads](https://developerdocs.instructure.com/services/canvas/basics/file.file_uploads)

### Direct New Quizzes

| Method | Exact path | Use |
| --- | --- | --- |
| POST | `/api/quiz/v1/courses/:course_id/quizzes` | Create reviewed quiz. |
| GET | `/api/quiz/v1/courses/:course_id/quizzes/:assignment_id` | Read settings/draft state. |
| GET | `/api/quiz/v1/courses/:course_id/quizzes` | Reconcile uncertain creation. |
| PATCH | `/api/quiz/v1/courses/:course_id/quizzes/:assignment_id` | Optional explicit settings/release operation. |

The response documents `published`; current create/update parameter tables do
**not** document `quiz[published]`. Sending `published=false` is not an established
draft guarantee. Require a sandbox-proven unpublished creation contract and
read-back `published === false` before enabling direct creation. Otherwise block
this adapter. [New Quizzes](https://developerdocs.instructure.com/services/canvas/resources/new_quizzes)

| Method | Exact path | Use |
| --- | --- | --- |
| POST | `/api/quiz/v1/courses/:course_id/quizzes/:assignment_id/items` | Create fixed question. |
| GET | `/api/quiz/v1/courses/:course_id/quizzes/:assignment_id/items` | Enumerate exported items. |
| GET | `/api/quiz/v1/courses/:course_id/quizzes/:assignment_id/items/:item_id` | Read one item. |

Item PATCH/DELETE and Bank writes are outside the first adapter. Bank/random
Bank-entry creation is not provided by this documented item API; sample Topics
and questions in FinanceBot, then export the frozen paper.
[New Quiz Items](https://developerdocs.instructure.com/services/canvas/resources/new_quiz_items)

## Correct-key, choice and feedback conversion contract

The following are proposed converter invariants:

- Allocate each choice UUID once; persist `(paper item, FinanceBot option key,
  choice UUID)`. Bind scoring and feedback to UUIDs, not visible A/B/C labels or
  positions. Retries reuse the mapping.
- MCQ uses `choice`, `Equivalence`, a single correct UUID in `scoring_data.value`
  and no varying-points behavior. Every distractor earns **zero**, including the
  FinanceBot **partially-correct** role. If `VaryPointsByAnswer` is added later,
  explicitly assign full points to the correct choice and zero to every other
  choice; never infer partial credit from a pedagogical role.
- T/F uses `true-false`, `Equivalence` and a Boolean scoring value derived from
  the correct literal selection. A true corrective explanation on the wrong
  False selection is feedback, not a second correct answer.

The API documents UUID-backed MCQ scoring, Boolean T/F scoring and per-answer
feedback for `choice`. Examples mix camelCase and snake_case nested keys, so
accepted serialization remains a sandbox contract, not a proven copy/paste
request. [New Quiz Items: question types](https://developerdocs.instructure.com/services/canvas/resources/new_quiz_items#appendixes)

Export numerics as frozen MCQ/T/F values, preserving displayed inputs, units,
rounding and explanations. Do not map a parameterized script to an assumed
equivalent Canvas formula. Keep private definitions and source diagnostics local.
Allowlisted HTML/equation conversion must preserve accessible text and be checked
in the rendered draft. Ambiguous correct keys or changed mathematical meaning
block completion. No model call is needed for conversion or comparison.

## Release-policy mapping: required behavior, not verified parity

Relevant fields under `quiz[quiz_settings][result_view_settings]` include
`result_view_restricted`, `display_points_awarded`, `display_items`,
`display_item_response`, `display_item_response_correctness`,
`display_item_correct_answer` and `display_item_feedback`. Response/correctness
timestamps and dependent flags are distinct controls.
[New Quizzes: ResultViewSettings](https://developerdocs.instructure.com/services/canvas/resources/new_quizzes#resultviewsettings)

| FinanceBot setting | Proposed requirement |
| --- | --- |
| Practice `immediate` | Results after submission only; verify both result-page and gradebook behavior. Never embed answer feedback in the stem. |
| `after-close` | Use the configured global closing instant, not the end of one student's sitting. Hide score, correctness, answers and feedback until a verified scheduled release or explicit Canvas operation. |
| Instructor release | Keep sensitive results hidden until deliberate release in Canvas; FinanceBot's local release button does not release Canvas results. |

Correctness dates alone cannot establish score/feedback parity. Check gradebook
visibility separately. A scheduled PATCH/release worker and any grade-posting
adapter are future work requiring their own reviewed scopes and durable jobs.
If exact policy preservation is unavailable, block automatic export or provide
an explicitly reviewed **manual Canvas configuration required** package path.
Never silently weaken the requested policy.

Freeze dates as instants with offsets/UTC. Distinguish due date, availability
close and duration; convert minutes/seconds deliberately. Per-student timing,
extra attempts, navigation restrictions and FinanceBot's window-close submission
policy remain unsupported until separately verified. List every mismatch before
confirmation; publication state alone does not prove all access controls.

## Durable async reconciliation and expanded acceptance gates

Persist the export key, actor/target binding, paper digest, package hash,
adapter/schema version, exact settings and stable choice mappings **before** a
write. A local key is not a documented Canvas idempotency key. Save migration,
assignment and item IDs as each response arrives. There is no transaction across
a quiz and all its questions.

Poll the migration's returned progress and all issue pages; processing completion
does not establish correct scoring, a full item mapping or an unpublished quiz.
Read back every created resource before `completed`: count/order, UUIDs, option
text, correct keys, points, feedback, settings and draft state. Missing scoring
visibility blocks verification; counts alone are insufficient.

A timeout after creation is **unknown**, not permission to repeat POST. Reconcile
known IDs first, then bounded paginated lists using target, time and a distinctive
export marker. A title alone is not identity. Ambiguous matches require an
Instructor decision. Do not replay a creation merely because refresh or transport
obscured its response. Unexpected publication or partial items stop the workflow;
cleanup/unpublication requires a separately authorized action on exact owned IDs.

Before enabling writes, additionally test stable UUIDs under shuffle, zero-credit
distractors, decimal/rounding fidelity, correct quiz-namespace routing and PATCH,
signed-upload failures, lost create responses, partial item creation, revoked
scope, stale paper and external Canvas edits. Student sandbox inspection must
exercise score, feedback and gradebook before/after every release boundary.

**Still unverified:** UBC's enabled New Quizzes surface, remote write permissions,
accepted QTI version/engine, imported draft state, nested-key casing, rendering,
scoring and exact release/accommodation parity. This document is an implementation
proposal backed by official API descriptions and local code inspection, not an
executed Canvas export or a deployment-ready feature.
