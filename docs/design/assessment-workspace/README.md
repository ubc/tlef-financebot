# Assessment workspace proposal — review before implementation

Status: **HTML prototype for Stephen's approval.** No production navigation, API,
or database behavior changes are included in this commit.

Open [`index.html`](./index.html) in a browser. The prototype uses sample data;
buttons and tabs demonstrate the intended flow but do not save or publish.

## Why this is the first change

The product already has strong pieces: a guided course launch path, source-backed
question generation, review states, an Approved-only bank, the fixed-paper Exam
Builder, isolated Student Preview, and analytics. The problem is continuity.
Instructors currently see a long navigation list organized partly by build stage
and partly by implementation area. The new Exam Builder is placed under Course
Settings, while the old Exam Prep remains linked from its catalog. Students see
both Assessments and Exam Prep. An instructor trying to publish and monitor one
midterm has to reconstruct where that work lives.

The PrairieLearn course inspected on 2026-09-28 keeps course-level Questions
separate from instance-level Assessments, and each assessment has its own
Questions, Access, Settings, and Statistics pages. Its question preview and
issue list preserve links back to the exact item. Its density and large number
of settings are not a model to copy. The single Default module in that course
also shows that more taxonomy does not automatically improve navigation.

## Product direction

1. **One primary task per top-level destination.** Course Home, Content,
   Assessments, Insights, Team, Settings. Preserve all current capabilities;
   move their links into contextual subnavigation. Keep the existing role colors.
2. **One assessment object through its lifecycle.** A catalog shows type,
   status, availability, question count, and the next action. Opening a draft
   keeps Paper, Quality, Access, and Student Preview together. A published exam
   keeps its Results and Issues with that exam.
3. **Make readiness actionable.** Show the exact blockers and their destination:
   unreviewed item, failed variant check, missing access window, or potential
   practice exposure. Existing server-side publish guards remain authoritative.
4. **Show access as a comparison.** Preview a named scenario (ordinary student,
   group, time) and explain why the assessment is visible or hidden. The current
   restricted Preview checks course publication and topic release, but does not
   model enrollment or assessment-specific access. This would need its own
   authorization design and tests before production implementation.
5. **Keep practice distinct.** Use a clearly labeled Practice area inside
   Assessments, or choose another explicit destination during implementation.
   Do not silently merge legacy Exam Prep data with formal-exam records.

## Prototype screens

- **Catalog:** attention row, grouped exams/practice list, lifecycle labels.
- **Draft exam:** Paper, Quality, Access, Student Preview tabs; persistent
  summary and a publish action that shows blockers.
- **Published exam:** Results & Issues context plus immutable publication note.
- **Navigation:** proposed compact Instructor sidebar, using current FinanceBot
  green, neutral surfaces, typography, badges, and card shapes.

## Implementation sequence after approval

1. Agree on names and information architecture. Map every existing route to
   the proposed destination; keep old URLs resolving during migration.
2. Add an Assessments catalog around the current Exam Builder without changing
   stored exams. Move the primary Instructor link out of Course Settings.
3. Reorganize the exam detail navigation using current services. Add contextual
   links to existing flags and analytics only where their data is exam scoped.
4. Design and implement true access simulation separately, with course,
   enrollment, assessment window, and release checks. Show the reason for a
   hidden assessment and test direct API access.
5. Consolidate student terminology only after formal-exam and practice paths
   remain behaviorally distinct and their migration is reviewed.

## Boundaries and rollback

Do not introduce random per-student formal papers, gradebook writes, LMS sync,
or new TA approval powers as part of this navigation change. Those need separate
data and policy decisions. The existing immutable exam publication remains the
source of truth. This prototype is isolated in its own branch and folder; the
pre-existing working-tree changes are not staged in its commit. Returning to
`codex/admin-audit` restores the prior branch view of this design work.
