# Question Pages Into the Questions Workspace — Design

Date: 2026-11-18
Status: implemented (phases 1–3, 2026-11-18)

## Why

The Questions workspace (spec `2026-11-09-instructor-questions-workspace-design.md`)
made one page for reviewing, approving and releasing questions, but it left
three older pages unchanged:

- **Question details** — `/instructor/course/:id/bank/:questionId`
  (`question-detail.ts`, ~1,200 lines)
- **Parameterization Configuration** — `.../bank/:questionId/params`
  (`param-config.ts`, ~540 lines)
- **Edit together** — `.../bank/:questionId/collaborate`
  (`collaborative-editor.ts`, Yjs shared drafts)

These pages use the older visual style and are hard to find: they open only
from text links ("Open full details ↗", "More actions") or from the flag card.
Instructors now have two editors for the same question that can do different
things. The reader's **Edit** changes stem, option text and explanations;
everything else needs Question details. The Parameters button appears on every
question, so on a conceptual question it opens an empty table that looks
abandoned.

## Goal

The Questions workspace is the only place an instructor reads, edits, fixes and
configures a question. The three pages go away as destinations; their URLs
redirect into the workspace.

## What each page does today, and where it goes

| Capability | Today | After |
|---|---|---|
| Edit stem, option text, explanations | Reader **Edit** and Question details | Reader **Edit** (one editor) |
| Option roles (correct / confounder / …) | Shown read-only in both | Unchanged, read-only (out of scope) |
| Difficulty | Question details | Inspector **Settings** tab |
| Topics & LOs (add / remove) | Question details | Inspector **Settings** tab |
| AI check, repair and solver notes, answer structure | Both (reader has most) | Inspector **Review** tab |
| Source evidence, similarity, origin & family | Split across both | Inspector **Review** tab |
| Generation tokens | Both | Inspector **Review** tab |
| TA suggested edits (Load into editor / Accept exactly / Discard) | Question details | Inspector **Team** tab |
| Internal review comments | Question details | Inspector **Team** tab |
| Student preview with a drawn sample | Question details ("Student preview" tab) | Reader **Preview** mode |
| Regenerate side by side | Question details (`intent=regenerate`) | Reader **Compare** mode |
| Fix a flagged question, reply to flagging students, resolve flags | Question details (`from=flags&intent=edit`) | Flag card → reader **Edit** with a reply step |
| Archive from a flag | Question details (`intent=archive`) | Flag card, in place |
| Recorded analytics version (`analyticsVersionId`) | Question details notice | Reader notice |
| Parameter slots, derived values, sample draws | Parameterization page | Reader **Parameters** mode (parameterized questions only) |
| Live co-editing with co-instructors | Edit together page | Removed (D5) |

## Decisions

- **D1** No new server endpoints. Every action already has an API:
  `editQuestion`, `getQuestion`, `getQuestionSample`, `patchQuestionParams`,
  `previewQuestionParams`, `regenerateQuestion`, `resolveFlag`,
  `notifyRemediation`, `resolveTaQuestionSuggestion`, `addQuestionInternalNote`,
  `getAnswerDistribution`, `transitionQuestion`. Server rules (versioning,
  `expectedVersionId` / `expectedTags` concurrency checks) do not change. An
  edit returns an approved or paused question to review only when the client
  sends `submitForReview: true`; the workspace's editors always send it for
  those states (today neither editor does — fixed first in phase 1).
- **D2** The reader's middle pane gets **modes**, chosen with a small segmented
  control at the top of the pane: **Read** (default), **Edit**, **Preview**,
  and, when they apply, **Parameters** and **Compare**. Only one mode is open
  at a time. Leaving a mode with unsaved changes asks first (the reader already
  locks navigation while editing).
- **D3** The right inspector gets three **tabs**: **Review** (default),
  **Settings**, **Team**. The Team tab shows a count when TA suggestions are
  pending.
- **D4** Fixing a flagged question happens in the reader. The flag card's
  **Correct the question** opens Edit mode with a "Reply to flagging students"
  field. **Save and resolve** saves the edit, resolves the open flags for that
  version and notifies real students, as Question details does today. Test
  flags from Instructor Preview are resolved but never notify anyone. The
  standalone "Instructor Preview Test Flag" banner is dropped; the flag card
  already labels test reports.
- **D5** Edit together is removed. It is rarely used, and keeping it means
  maintaining a second editor, a long-lived SSE connection that polls the
  database, and the `yjs` dependency. Co-instructors still edit the same
  question safely: the normal edit's `expectedVersionId` check reports a
  conflict instead of overwriting. Removal covers:
  - Client: `collaborative-editor.ts`, `question-collaboration-api.ts`,
    `styles/collaborative-editor.css` (and its `<link>` in `index.html`), the
    `/collaborate` route in `main.ts`, the links from the reader and Question
    details, the `instructor-collaboration` tutorial (`tutorial-definitions.ts`,
    `tutorial-help.ts`, `tutorials.service.ts`).
  - Server: `question-collaboration.routes.ts` (and its mount in `app.ts`),
    `question-collaboration.service.ts`, `types/collaboration.ts`, the
    `questionDraftsCol` / `questionPresenceCol` accessors and their indexes,
    and the `collaborationDraftId` / `collaborationCommitId` input path in
    `questions.service.ts`.
  - Build and tests: the `yjs` dependency and its vendoring in
    `vendor-client-libs.mjs`, `playwright.collaboration.config.ts`,
    `question-collaboration.spec.ts`, the two `question-collaboration` unit
    tests, and the collaboration cases in the questions service/route tests.
  - Docs: `AGENTS.md` files and `docs/api-contract.md` entries for the routes.

  Existing data: shared drafts are unsaved work, never question versions, so
  nothing saved is lost. `questionPresence` empties itself (TTL index).
  Course deletion keeps deleting both collections by name so leftover
  `questionDrafts` documents still go with their course. Versions that already
  carry `collaborationDraftId` / `collaborationCommitId` keep them; the fields
  stay optional in `QuestionVersion` as history.
- **D6** The Parameters mode appears only for parameterized questions (the
  question has `paramSlots`, or its stem has `{{placeholders}}`). The
  Parameters header button on conceptual questions goes away with the page.
- **D7** Old URLs keep working by redirecting into the workspace (the
  workspace already opens the right tab for a `q` outside the current tab):

  | Old URL | Redirects to |
  |---|---|
  | `/bank/:questionId` | `/questions?q=:questionId` |
  | `/bank/:questionId?intent=regenerate` | `/questions?q=…&mode=compare` |
  | `/bank/:questionId?from=flags&flagVersionId=…&intent=edit` | `/questions?tab=flags&q=…&mode=edit&flagVersionId=…` |
  | `/bank/:questionId?from=flags&…&intent=archive` | `/questions?tab=flags&q=…` (flag card asks to archive) |
  | `/bank/:questionId?analyticsVersionId=…` | `/questions?q=…&analyticsVersionId=…` |
  | `/bank/:questionId/params` | `/questions?q=…&mode=params` |
  | `/bank/:questionId/collaborate` | `/questions?q=…` (D5) |

  In-app links (analytics, exam builder, import results, similarity links,
  notifications, tutorials) are updated to the new URLs directly, so the
  redirects only serve bookmarks and old notifications.
- **D8** Parameters and Compare collapse the inspector instead of opening as an
  overlay, so the instructor stays in the same page and the same question (see
  Layout).

## Layout

```
┌ list ─────┬ reader ───────────────────────────────┬ inspector ─────────┐
│           │ [flag card, when flagged]              │ Review│Settings│Team│
│           │ Read │ Edit │ Preview │ Parameters │ … │                    │
│           │                                        │                    │
│           │   (mode content, scrolls)              │  (tab content,     │
│           │                                        │   scrolls)         │
│           ├────────────────────────────────────────┤                    │
│           │ More actions ▸   [state actions]       │                    │
└───────────┴────────────────────────────────────────┴────────────────────┘
```

- **Read** is today's reader view.
- **Edit** is today's inline editor plus, for parameterized questions,
  placeholder handling (`toDisplayPlaceholders` / `toStoredPlaceholders`) so
  the "fix them in full details" warning is no longer needed.
- **Preview** shows the student view with a drawn sample and **Draw another
  sample**.
- **Parameters** carries the param-config editor (slot table, derived values,
  preview of five draws, **Save parameters**).
- **Compare** carries the regenerate panel: prompt, **Generate alternative**,
  current and generated versions side by side with the generated version's
  check, **Replace with variant**.
- **Parameters and Compare collapse the inspector** (D8): the slot table and
  the side-by-side versions need the width, so the reader takes the inspector's
  column while either mode is open. Leaving the mode restores the inspector on
  the tab it showed before. The question list stays visible. At narrow widths,
  where the inspector is stacked under the reader, it is hidden the same way.
- "Open full details ↗" links are removed.
- At narrow widths (container ≤ 820px), the inspector stacks under the reader
  as it does today; the mode control wraps.

## Phases

Each phase ships on its own and leaves the app working.

1. **Settings and Preview in the workspace.** Inspector tabs (Review, Settings,
   Team) with difficulty, Topics & LOs, TA suggestions and internal comments.
   Reader modes Read / Edit / Preview. After this, most visits to Question
   details are unnecessary.
2. **Flags, Compare and analytics in the workspace.** Flag correction with
   reply and resolve in the reader (D4), Compare mode, the
   `analyticsVersionId` notice. Flag card and analytics links point at the
   workspace.
3. **Parameters, redirects and removal.** Parameters mode (D6). Redirects
   (D7). Remove Edit together (D5). Delete `question-detail.ts`, `param-config.ts`
   and their CSS, and update `client/AGENTS.md`, `docs/api-contract.md` (if
   any documented route changes) and the tutorials.

## Testing

- Unit tests for the URL mapping (old URL → workspace URL, D7).
- E2E (Playwright, mocked API as in `questions-workspace.spec.ts`):
  - Settings tab changes difficulty and adds/removes an LO; a stale tag set
    shows the existing conflict message.
  - TA suggestion: Load into editor, Accept exactly, Discard.
  - Flag fix: Correct the question → edit → reply → Save and resolve; real
    flags notify, test flags do not.
  - Compare: generate alternative, replace with variant; blocked while edits
    are unsaved.
  - Parameters mode shows only on a parameterized question; saving params and
    drawing previews.
  - Each old URL in D7 lands on the right tab, question and mode.
- Existing specs that drive the old pages are moved to the workspace:
  `flag-loop`, `numeric-parameterization`, `question-edit-concurrency`,
  `instructor-sample-render`, `exam-builder`, `analytics-dashboard`,
  `custom-generation` and `role-tutorials`. `question-collaboration` is
  deleted with D5.
- The 390px dark layout check (with axe) keeps passing.

## Out of scope

- Editing option roles, adding or removing options.
- Changing how edits move a question between states.
- TA views (`views/ta/*`), which keep their own routes.
- Live co-editing in the reader.
- Dropping the `questionDrafts` / `questionPresence` collections from
  production databases.
