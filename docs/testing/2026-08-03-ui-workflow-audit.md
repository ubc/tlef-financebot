# UI / Workflow CSS Audit — 2026-08-03

Owner: Stephen

## Outcome

The Phase 3 Admin screenshots exposed a missing shared CSS contract rather than three isolated styling mistakes. Phase 3 views were using `cluster`, `stack--sm`, `checkbox-row`, and direct `.card.stack` composition, but those primitives either did not exist or did not provide card insets. That affected Admin, Analytics, TA management, TA review/triage, and Student Profile surfaces.

The shared primitives are now defined, Admin operations have purpose-built responsive layouts, and the table-heavy Bank/Review/Coverage workflows reflow into cards at phone width. A real-browser route audit covered Instructor, Admin, Student, and TA shells at desktop and 390px widths.

## Sync finding

`npm run sync-plans -- Stephen` completed successfully. There were no new Stephen plan files to publish. Saurav's latest shared plan files were pulled into the working tree, but their content is an older July 17/18 status snapshot and regresses the August 1 reconciliation text. Those files were preserved as Saurav-owned sync output and were not included in this work.

`origin/main` remained at `ba0bae3`; no newer application code needed merging before the audit.

## Defects found and fixed

| Area | Failure | Fix |
| --- | --- | --- |
| Shared cards | Direct `.card.stack` children touched the border | Added the same safe inset as `.card__body`; removed double card margins inside stacks |
| Shared layout | `cluster`, `stack--sm`, `stack--lg`, `checkbox-row` had no CSS | Added wrapping clusters, spacing variants, accessible checkbox sizing, disabled treatment |
| Capability Matrix | Raw inline checkboxes/labels, no hierarchy, cramped toolbar | Added labelled scope toolbar, safety callout, four-column role grid, source labels, one-column phone layout |
| User Directory | Raw identity strings, long IDs collided with Remove, full-width destructive actions | Added identity metadata grid, role rows with safe wrapping, structured assignment form, status handling and deactivation confirmation |
| Platform Settings | Panels had no padding; labels/checkboxes crowded; Save could obscure content | Added section headings/help, two-column model/feature grids, responsive stacking; removed premature sticky Save overlay |
| Question Bank filters | Long LO option forced a select far beyond the viewport | Allowed selects to shrink/wrap and made long filters full-width on phone |
| Question Bank table | Status/Actions were clipped on phone | Reflowed every question row into a labelled card with full-width actions |
| Review Queue table | Review/Approve buttons were clipped on phone | Reflowed rows into labelled cards and wrapped controls/actions |
| Coverage table | Generate/Assign buttons were clipped on phone | Reflowed LO rows into labelled cards with full-width action |
| Topic page header | Session Summary + Start Practice overflowed beside a long title | Stacked page header/actions below 600px |
| LO progress rows | Title collapsed into a few characters per line on phone | Added a two-column mobile grid and full-width practice action |
| Workflow errors | User Directory role/deactivation failures could escape as unhandled promises | Added visible status reporting and guarded destructive actions |
| Filter accessibility | Bank and Review select controls lacked accessible names | Added explicit `aria-label` contracts |

## Browser audit matrix

Legend: D = desktop 1280×720, M = mobile 390×844, O = overflow/clip scan, E = rendered error-state scan.

| Persona | Surfaces audited | Evidence |
| --- | --- | --- |
| Admin | Instructor Grants, User Directory, Capability Matrix, Platform Settings | D/M, O, E, screenshots, WCAG axe |
| Instructor | My Courses, Create Course, Launch Cockpit, Structure, Materials, Content Map, Settings, Exam Templates, Bank, Question Editor, Parameters, Review Queue, Flags, Import, Coverage/Generate, TA management, Analytics | D/M, O, E; populated COMM 298 bank/queue/coverage states |
| Student | My Courses, Course Home, Topic/LO list, Practice selection and feedback, Review Book, Session Summary, Exam Select, Exam History | D/M, O, E; one local test attempt used to inspect feedback state |
| TA | Review Queue, Suggest/Edit/Note/Escalate controls, Flag Triage | D/M, O, E using a temporary local Staff TA role; role removed after audit |

Exam Attempt and Results require an active single-sitting fixture and remain covered by `tests/e2e/exam-mode.spec.ts`, including interruption resume, answer persistence, submission, explanation withholding, results, Review Book, mastery, and analytics.

## Automated regression added

- `tests/e2e/responsive-workflows.spec.ts`
  - creates and cleans a course, long LO, and question fixture;
  - temporarily enables the authenticated test account as Admin and restores it;
  - checks Admin User Directory/Capabilities/Platform Settings and populated Instructor Bank/Queue/Coverage plus TA management/Analytics;
  - asserts no interactive/content element is clipped at 1280px or 390px.
- `tests/a11y/a11y.spec.ts`
  - adds Phase 3 Admin User Directory, Capability Matrix, and Platform Settings WCAG A/AA scans;
  - centralizes the shared axe assertion helper.

Targeted verification at audit time:

```text
responsive-workflows.spec.ts: 1 passed
a11y.spec.ts:                 4 passed
typecheck:                    passed
lint:                         passed
build:                        passed
```

## Review constraints

- Visual inspection used the local application and local test identities only.
- Temporary `faculty.isAdmin` and Staff TA role mutations were restored.
- Saurav-owned synced status files and `.claude/worktrees/` were not staged or modified by this audit.
- No settings were submitted from the Admin Platform Settings browser inspection.
- A Student test attempt was intentionally recorded in the local test database to inspect post-submit feedback CSS.

## Acceptance checklist

- [x] Screenshot-reported Admin layouts have stable content insets and hierarchy.
- [x] Desktop and phone layouts expose every primary/destructive action.
- [x] Long LO/PUID/course ID content does not create horizontal overflow.
- [x] Table workflows become readable cards at phone width.
- [x] Admin operations pass WCAG A/AA axe scans.
- [x] New layout regression test creates and cleans its own fixture.
- [x] Manual test tutorial covers every production persona and feature family.

