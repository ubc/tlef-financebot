# Instructor Dashboard Progress — Design

Date: 2026-11-12
Status: approved by the developer (decisions below); ready to build

## Why

The course Dashboard shows a five-stage bar that ends at "Student preview", a
separate floating "setup journey" guide with its own six steps, a "Launch
readiness" percentage, and a "Next actions" panel. Three progress displays can
disagree, and none of them shows Release — the step where approved questions
actually reach students (spec 1, `2026-11-09-instructor-questions-workspace-design.md`).

This is spec 2 of the instructor-workflow review (decisions D1–D7, 2026-11-09).

## Decisions

1. **Stages.** The bar has six stages, matching the main path (D1):
   **Materials → Structure → Generate → Review → Release → Publish.**
   Student preview is no longer a stage; it is a recommended check inside Publish.
2. **One guide.** The bar is the only progress guide. The floating setup journey
   (`client/src/setup-journey.ts`), its island, its sidebar step markers and the
   Dashboard's "Open setup guide" button are removed.
3. **Layout.** Bar on top, then one "Next step" card (with the existing
   collapsed "Up next" list). The launch checklist moves into a **Publish**
   panel; the "Launch readiness" percentage card is removed. Course snapshot and
   Explore course stay.

## Stages (server, `instructor-workflow.service.ts`)

`setup.steps` becomes six stages; ids and destinations:

| # | id | label | destination (client route) |
|---|---|---|---|
| 1 | `materials` | Materials | `materials` |
| 2 | `structure` | Structure | `structure` |
| 3 | `generate` | Generate | `preseeding` |
| 4 | `review` | Review | `review-queue` → `questions?tab=review` |
| 5 | `release` | Release | new `release` → `questions?tab=approved` |
| 6 | `publish` | Publish | `dashboard` (opens the Publish panel) |

Stages 1–4 keep today's status rules (Sources → Materials, Learning
objectives → Structure, Questions → Generate, Review unchanged).

**Release** (uses the course's active Topics and the Approved questions already
loaded; same rule as serving and the Questions page — `theme-release.ts`):
- `blocked` (by `review`) when there are no Approved questions — "Waiting for Approved questions".
- `needs-attention` when any Approved question is held by a Topic with no
  release date — "N hidden · X of Y topics released".
- `in-progress` when held questions only wait on scheduled Topics — "N scheduled".
- `ready` otherwise — "X of Y topics released".
Course publication is not part of Release (it is Publish).

**Publish**:
- `complete` when the course is published — "Published".
- `needs-attention` when archived — "Archived · restore to continue".
- draft with launch checks incomplete: `not-started` — "C of T checks".
- draft with all checks complete: `ready` — "Ready to publish" (or
  "Ready · preview recommended" when no recent Student preview).

**Current stage**: new `setup.currentStage` = the first stage that is not done,
where stages 1–5 are done at `ready`/`complete` and Publish only at `complete`;
`publish` when all are done.

**Actions**: new `release-topics` action (priority `high`, destination
`release`) when any Approved question is held by an unreleased Topic, ordered
after `review-questions` in both draft and published primary orders. Primary
action `presentation` loses `dialog` (it opened the removed guide): those
actions open their workspace directly.

## Dashboard (client)

- **Bar**: six linked stages with status and detail; the current stage carries
  `aria-current="step"`. Publish scrolls to and opens the Publish panel.
- **Next step** card: the server's primary action, plus "Up next (n)".
- **Publish panel** (`id="publish-panel"`): launch checklist rows (with their
  existing fix links), a Student preview recommendation ("Preview as student",
  or "Tested recently"), and Publish / Return to draft. Open when the current
  stage is Publish.
- Removed: Launch readiness card, "View launch checklist" disclosure, "Open
  setup guide" button. Preview when no question is approved sends the
  instructor to Questions → To review instead of the old guide.
- The header Publish button stays.
- Tutorial `instructor-course-setup` anchors move to the bar and the Publish panel.

## Tests

- Unit (`instructor-workflow.service.test.ts`): six stage ids/labels; Release
  blocked / hidden / scheduled / ready; Publish states; `currentStage`;
  `release-topics` action and its primary order; no `dialog` presentation.
- Unit (`instructor-dashboard.test.ts`): `release` destination path.
- E2E: `instructor-pipeline.spec.ts` no longer uses the removed guide (Topic/LO
  seeded through the API; stage links use the new names);
  `setup-journey.spec.ts` and its config are deleted; the a11y "guided course
  setup" test becomes a scan of an empty course's Dashboard bar.

## Out of scope

- Spec 3 (one-click whole-course generation on the Generate page).
- Changing publish rules or the launch checklist items.
