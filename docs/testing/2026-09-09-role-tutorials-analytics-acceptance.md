# Role tutorials and Student Analytics — acceptance

Date: 2026-09-09. Owner: Stephen.
Branch: `codex/role-tutorials-analytics`, based on `2af3b6f` from main.
Implementation accepted locally; Stephen authorized committing and pushing this delivery to main on 2026-09-09.

## Delivered behavior

| Role | Contextual tutorials |
| --- | --- |
| Student | 9: welcome, Course Home, Topics/LOs, Practice, feedback, Session Summary, Review Book, Exam Prep, submitted exam results |
| Instructor | 9: projects, course preparation, sources, generation, review, question editing, Student Analytics, settings, exam templates |
| TA | 3: review queue, question review, flag triage |
| Admin | 4: Instructor grants, user directory, capabilities, platform settings |

Each role has Help & Tutorials with course-aware replay and its own reset.
Completion and skip state are account/role/version scoped. Preview modes and
timed exam sittings suppress the relevant tutorials. TA controls reflect actual
course capabilities; tutorials never grant a capability or approve content.

Student Analytics remains in the Instructor course workspace. It now offers:

- Separate Topic Practice and Exam Prep evidence with 7/28/84-day or all-time
  filters, explicit timestamps and Refresh.
- Objective review priorities, sample counts, expandable outcomes and direct
  question-bank, Coverage Map and flag destinations.
- Selectable recorded question versions, readable answer distributions and
  a distinct historical version section above the current question editor.
- Weekly engagement and CSV using the same scope, plus an independently
  configured 7/14/30-day inactivity list and student search.

Dates and versions are enforced by the read models. Active objectives with no
attempts remain visible; fewer than five attempts produces insufficient data,
not a zero rate. Multi-objective evidence is explicitly labelled. Named student
lists require `analytics.individual`; aggregate access remains independent.

## Verification

| Layer | Result |
| --- | --- |
| Full Jest | 103 suites, 1294 tests passed |
| Tutorial browser regressions | 15 passed |
| Analytics browser regressions | 10 passed |
| Real SAML/Mongo integration | 6 role/analytics scenarios passed |
| Existing Exam Prep / Student Preview | 1 exam scenario and 2 preview scenarios passed |
| Configured real-page axe suite | 6 scenarios passed |
| Build, typecheck, lint, diff whitespace | Passed |
| Additional acceptance-fixture TypeScript check | Passed |

The deterministic browser suites intercept APIs and cover account/route races,
missing/replaced targets, reduced motion, role isolation, filtered response
ordering, delayed/failed sorting, historical retry, and 390/1280px light/dark
accessibility. They are separate from the real-service acceptance fixtures.

Real-service fixtures verify two historical question versions with rotated
option keys, date exclusion, mode separation, insufficient samples, zero-data
objectives, course permissions and actual progress persistence. They restore
temporary role/Admin changes and tutorial state and remove their course data.
The legacy exam assertion was updated for the new outcome wording while
retaining its two-attempt insufficient-data requirement.

Manual inspection used the real PHYS 100 course at desktop and 390px, in light
and dark themes. All four Analytics tutorial steps were exercised through Done,
and normal page interaction returned. Original viewport and appearance were
restored. The course's existing content and student activity were not changed.

## Coverage boundaries

- Real page flows exercised 19 of 25 contexts: all Student, TA and Admin
  tutorials, plus Instructor preparation, review and analytics. Other Instructor
  contexts have source/fixture coverage; they were not all exercised with live
  materials and generation. Missing prerequisites do not mark a tutorial done.
- Tutorials are optional product help. They do not implement or replace the
  PRD's mandatory service/copyright acknowledgements or optional research
  consent. This is not a claim of complete PRD or production acceptance.
- No provider calls, generation, student messaging, deployment or application
  push was needed for these checks. The earlier AI Workspace rollback is retained.

Task reviews, their fixes and the final independent whole-feature review were
approved with no remaining Critical or Important findings. Detailed logs and
screenshots are local under `/private/tmp/financebot-role-experience/`.

## Quick local acceptance

1. Open Help & Tutorials for a real role, choose a course and replay a tutorial.
   Skip or finish, reload, and confirm the corresponding state remains saved.
2. In Instructor → Student Analytics, switch mode/date, inspect an objective,
   select a recorded version and compare its option counts with its sample size.
3. Open a historical review link: the recorded version is separate from the
   editable current question. Retry a transient load error without losing edits.
4. Verify CSV follows the current outcome scope, while the inactivity threshold
   remains independent. An account without individual analytics permission can
   still read permitted aggregates but cannot retrieve named follow-up data.
