# Instructor Questions Workspace — Design

Date: 2026-11-09
Status: approved in brainstorming; ready for an implementation plan

## Why

Instructors meet one question in four places: Review Queue, Question Bank,
Flags, and the question detail page. Release to students lives in two more
(Course Structure's Topic settings and the bank's "Manage topic releases").
The result is that an instructor can approve 48 questions and not notice that
students see none of them, because no Topic is released. The local test course
is in exactly this state today.

This is the first of three specs from the instructor-workflow review
(decisions 1–7, 2026-11-09). The other two — the Dashboard progress stepper and
the one-click Generate page — get their own specs later.

## Decisions this spec implements

- **D1** The core outcome is a student practice bank. Main path: Materials →
  Structure → Generate → Review → Release.
- **D2** Review Queue, Question Bank and Flags become one **Questions** page with
  status tabs. Approach C (full rebuild) was chosen over a shared header or a
  panel refactor.
- **D6** Release happens only on the Questions page, per Topic, as the last main
  path step. Course Structure keeps a read-only status label. Whenever approved
  questions are hidden from students, the page says so prominently.
- **D7** Exam Builder stays a secondary tool under "Assess & improve".
- No keyboard shortcuts (YAGNI).

## Navigation and routes

- The instructor sidebar's main path becomes: Dashboard, ① Course Materials,
  ② Course Structure, ③ Generate Questions, ④ **Questions**. "Assess & improve"
  keeps Exam Builder and Student Analytics; its Flags item is removed. Course
  Settings is unchanged.
- New route: `/instructor/course/:id/questions?tab=<tab>&q=<questionId>`.
  `tab` ∈ `review | approved | flags | paused | archived`. `q` selects a
  question in the reader.
- Old routes redirect, preserving `q` where it exists:
  `/queue` → `?tab=review` (`runId` is kept as a highlight, see below),
  `/bank` → `?tab=approved`, `/flags` → `?tab=flags`.
- The question detail page (`/bank/:questionId`), collaborative editor
  (`/bank/:questionId/collaborate`) and parameter config (`/bank/:questionId/params`)
  are unchanged.
- Instructor-side links to `/queue`, `/bank` (list) and `/flags` are updated to
  the new route: dashboard, setup journey, generation workbench, preseeding,
  import, settings, exam builder, courses, tutorial help, question detail,
  collaborative editor, param config and `notification-target.ts`. TA views
  (`views/ta/*`) keep their own routes.

## Page layout

Top to bottom:

1. **Header** — "Questions", a one-line subtitle, and actions:
   Generate more (→ Generate page), Import (→ `/import`), Export CSV.
2. **Release bar** (main path step ⑤)
   - "Released X of Y topics".
   - When the course itself is not published, the bar says so first ("The
     course is not published — students see no questions") and links to the
     Dashboard, where publishing already lives. Topic releases can still be
     prepared.
   - When `hiddenApprovedCount > 0`: an emphasized warning
     "N approved questions are not visible to students yet", with
     **Manage releases**.
   - **Manage releases** opens a panel with one row per Topic: name, approved
     count, current state (released / scheduled for <date> / hidden), and the
     choice Release now / Schedule / Keep hidden. Saving calls the existing
     theme update. This replaces both the bank dialog and the release controls
     in Course Structure's Topic settings, which become a read-only label with a
     link to the Questions page.
3. **Status tabs**, each with a count:
   - **To review** — `draft`, `pending-review`, `reviewed`. Default tab when its
     count is > 0; otherwise **Approved**.
   - **Approved** — `approved`, with a sub-filter
     All / Visible to students / Waiting for release.
   - **Student flags** — every question with an open flag, in any state.
   - **Paused** — `paused`.
   - **Archived** — `archived`.
4. **Body**, two columns:
   - **List** (left): search (stem and LO text), filters (Topic, LO, type,
     difficulty, AI verdict), select-all/checkboxes. Rows show stem preview,
     difficulty, LO, AI verdict badge, open-flag count, and visibility.
   - **Reader** (right): the selected question (below).
   - Narrow screens stack list above reader; the reader opens as a full-width
     view with a back control.

Arriving with `runId` (from the generation workbench) highlights that run's
questions in the To review list without filtering the rest out. This matches
today's Review Queue behaviour.

## Reader

Always shown:

- Meta: type, difficulty, version, Topic and LO.
- Stem and options with the correct answer marked; parameterized questions show
  the stable drawn sample (`sample`) a student would see.
- AI check: verdict (pass / flag / reject), reasoning, and the suggestions list
  (`agentDecision.suggestions`).
- Similarity: nearest in LO and nearest in Topic with score, each linking to
  that question in the reader.
- Source evidence (collapsible).
- Student visibility: "Visible to students" or the reason it is not (course not
  published, Topic not released, release scheduled, content not ready, not
  approved).
- TA suggested edits and internal notes, collapsed with counts when present.

Actions by state:

| State | Primary | Secondary |
|---|---|---|
| To review | **Approve**; Reject (optional reason; archives) | Edit, Edit together, Regenerate (side by side), Open full details |
| Approved | Pause | Edit (returns it to review), Archive |
| Paused | Resume (→ approved) | Archive, Edit |
| Archived | Restore to review | — |

**Student flags** — when the question has open flags, a flag card appears at the
top of the reader, in any tab:

- Each report's reason and source (student / TA / instructor preview test), the
  number of students, and a TA's escalation recommendation when present.
- Actions: **Correct the question** (opens edit), **Archive the question**,
  **Clear the flag**.
- Correcting with "affects correctness" checked shows the remediation checklist
  and **Notify affected students**, with the notified state kept after reload.
- Resolved flags remain visible in a collapsed "Resolved" history.

**Bulk actions** appear when rows are checked: To review → Approve selected /
Reject selected (one optional reason for all); Approved → Archive selected; Paused →
Resume selected / Archive selected.

## Data

### New endpoint

`GET /api/courses/:courseId/question-workspace?tab=<tab>`
Requires `question.review` in the course (403 otherwise).

```ts
interface QuestionWorkspace {
  counts: {
    review: number;
    approved: number;
    approvedVisible: number;
    approvedWaiting: number;
    flags: number;
    paused: number;
    archived: number;
  };
  release: {
    coursePublished: boolean;
    themes: Array<{
      themeId: string;
      name: string;
      availableFrom: string | null;
      released: boolean;
      approvedCount: number;
    }>;
    hiddenApprovedCount: number;
  };
  items: WorkspaceRow[]; // only for the requested tab
}

interface WorkspaceRow extends BankQuestion {
  agentVerdict?: 'pass' | 'flag' | 'reject';
  openFlagCount: number;
  priority?: number;        // To review only, from bank.service reviewQueue()
  studentVisible: boolean;
}
```

- `studentVisible` = approved ∧ course `lifecycle === 'published'` ∧
  `releasedForServing` ∧ `contentReady`. It and `hiddenApprovedCount` are
  computed on the server with `theme-release.ts` (`isThemeReleased` /
  `unreleasedThemeIds` / `releasedForServing`). The client never derives
  visibility. A question tagged to several Topics is visible only if every
  tagged Topic is released, matching serving.
- `agentVerdict` comes from `agentDecision.decision` in the same query. Today's
  Review Queue fetches it with one `getQuestion` per row; the new endpoint
  removes those calls.
- To review is ordered by `priority` (existing under-coverage ranking);
  Approved by Topic then LO order; Student flags by open count, then newest
  flag; Paused and Archived by last update.

### Existing endpoints reused

- `GET /api/questions/:id` — reader detail (agentDecision, notes, versions).
- `GET /api/courses/:courseId/flags` gains an optional `questionId` filter so
  the reader fetches one question's flags.
- Mutations: `transition`, `bulk-transition`, flag `resolve` and remediation
  notify, theme update for release, existing edit/regenerate flows. After any
  successful mutation the page refetches the workspace for the current tab.
- `review-queue` and `questions` browse endpoints stay; TA views and export use
  them.

## Errors

- Stale version (409 from `expectedVersionId`): the reader says the question
  changed, reloads it, and never overwrites silently.
- Bulk partial failure: list the failed questions, keep them checked for retry
  (today's Review Queue behaviour).
- Workspace load failure: whole-page error with Retry; no partial counts.
- Reader detail failure: error in the reader only; the list stays usable.
- Release save failure: the panel keeps the chosen values and shows the error.

## Feature parity checklist

Old pages are deleted only after each item is confirmed on the new page.

Review Queue / review workbench
- [ ] Priority ordering; Topic and LO filters; type filter; AI-verdict filter
- [ ] Run-arrival highlight (`runId`) with "Clear highlight"
- [ ] Approve; Reject with reason; bulk approve / reject with partial-failure report
- [ ] Review context, source evidence, student availability, full AI assessment
- [ ] Edit together; Regenerate side by side; open full details

Question Bank / bank workbench
- [ ] Approved list with visible / waiting split; Paused; Archived
- [ ] Topic releases (now the release bar and panel)
- [ ] Archive single and selected; Restore to review; Restore draft
- [ ] Search, Clear filters, More filters
- [ ] Import questions; Export CSV; Edit question; Open full details
- [ ] Empty states that point to Generate / review / release

Flags
- [ ] Open flags grouped per question; resolved history
- [ ] Correct / Archive / Clear; "Reject & Archive"
- [ ] Correctness-affecting remediation checklist; Notify affected students
      (with persisted notified state)
- [ ] TA escalation with and without a recommendation; "How flags work" help
- [ ] Search

## Testing

Server unit tests (`question-workspace`):
- tab counts, including the visible / waiting split;
- `hiddenApprovedCount` for an unreleased Topic, a future scheduled release,
  `contentReady: false`, a multi-Topic question with one unreleased Topic, and
  an unpublished course;
- Student flags includes flagged questions in any state;
- `agentVerdict` mapping and To review ordering by `priority`;
- 403 without `question.review`.

Flags endpoint: unit test for the `questionId` filter.

Playwright (mocked API), new spec `questions-workspace.spec.ts`:
- old routes redirect to the right tab and keep `q`;
- approve and reject update counts and move the row;
- releasing a Topic in the panel clears the hidden-questions warning;
- flag card: correct / archive / clear, remediation notify;
- bulk partial failure keeps failed rows selected;
- 390px dark layout and axe scan.

## Rollout

1. Ship the endpoint and the Questions page, switch the sidebar, add redirects,
   and update instructor links. Course Structure's release controls become a
   label with a link.
2. Walk the parity checklist.
3. Delete `review-queue.ts`, `review-workbench.ts`, `bank.ts`,
   `bank-workbench.ts`, `bank-editor.ts`, `flags.ts`, their CSS, and the e2e
   specs that only exercised them. Their behaviours are covered by
   `questions-workspace.spec.ts` before deletion.

## Out of scope

- Dashboard progress stepper (spec 2) and the Generate page entry (spec 3).
- TA review and flag-triage views.
- Changing publication states, the release model (still per Topic), or flag
  resolution semantics.
- Keyboard shortcuts.
