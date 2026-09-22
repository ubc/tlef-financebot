# Admin operations audit and question diagnostics

## Entry points

- **Admin → Operations & Issues**: user requests, background tasks, and retained change history.
- **Admin → All Questions**: all retained questions, including Draft, Pending Review, Reviewed, Approved, Paused and Archived.
- **User Directory → View activity / Created questions**: user-specific entry points.

Requests can be filtered by user PUID, course, outcome, search text and time range. Background tasks include pre-existing ingestion, question generation and structure generation records. A request accepted with HTTP 202 is not labelled completed: linked jobs supply the eventual outcome. Partial imports, skipped items and unsuccessful verification are distinguished from clean success. Validation details, duration, target IDs and correlation IDs support investigation.

Question creation attribution uses the first version and its generation requester, not the most recent editor. Admin can inspect version history, AI review decisions, formulas, source references, latest 20 student attempts and latest 20 flags. A version-and-seed URL reproduces one deterministic diagnostic sample. An attempt URL uses the attempt's pinned version and saved parameter values. Missing historical parameters are reported explicitly. Read-only reproduction writes no student attempts, mastery or question changes. AI job inspection shows retained inputs, model choices, events, warnings and per-item failures; it does not promise deterministic LLM replay or automatically rerun paid jobs.

## Coverage and limitations

- `operationEvents` begins collecting with this release. It cannot reconstruct unrecorded historical failures. Existing `auditLogs`, `contentRuns`, question versions and attempts remain accessible.
- All completed API requests are observed, including denied, malformed and failed requests. Successful health/session checks, notification polls and live event streams are excluded. The initial request view highlights mutations and problems; All requests also reveals successful reads. An interrupted response is separately labelled; it does not prove that a mutation was rolled back.
- Browser runtime failures, unhandled rejections and central API network failures are reported when connectivity permits. Browser reports are explicitly unverified. They are limited to five reports per minute in the client and 30 per user per minute on the server. A completely offline or crashed browser cannot deliver a report.
- No keystroke recording, DOM/session recording, passwords, authorization headers, SAML responses, uploaded content or full request/response bodies are collected. Input capture allowlists scalar controls. Error text is bounded and common credential patterns are redacted; long evidence strings are marked truncated.
- Audit records are operational diagnostics, not a tamper-evident compliance ledger. Persistence is best-effort with a 100-write in-flight bound. The console shows failed audit write counts and the latest failure for the serving process since restart. A process crash or database outage can leave gaps. No automatic retention deletion is configured.
- Login/logout redirects outside `/api` and non-content Agenda jobs do not have their own lifecycle entries here. Server-side API results and the three durable content-run types have coverage; absence of a log is not proof that an action never occurred.
- Admin-only APIs use the existing `ensureAdmin()` gate. Instructor status and course roles do not grant global audit access. Replay does not impersonate a user or bypass student serving gates.

## Implementation

- Central request middleware creates a server-owned request ID. `AsyncLocalStorage` carries it into durable material, structure and question run creation.
- All database access uses typed collection accessors. `operationEvents` has request-ID, time, actor, outcome and course indexes. Pagination is bounded to 100 results per request (UI uses 25).
- New Admin endpoints live in `admin-diagnostics.routes.ts`; each route independently enforces Admin authorization. `/diagnostics/client-error` accepts only authenticated, bounded reports.
- Content runs remain owned by their existing lifecycle service. Diagnostics only reads them.

## Validation

Real SAML and MongoDB browser coverage in `playwright.admin-diagnostics.config.ts` checks a non-Admin rejection becoming an Admin-visible failure, original creator attribution after editing, task-to-question navigation, pinned attempt replay after reload, and unchanged attempt/version counts. Desktop light and mobile dark pages receive WCAG A/AA scans and overflow checks. Fixtures are synthetic and removed after tests; no LLM/provider request is made.

Unit/API coverage checks Admin isolation, filter validation, request correlation, accepted versus terminal outcomes, partial success, redaction, failed persistence, authenticated browser reporting, exact-version/seed replay and unavailable historical evidence. Run `npm test`, `npm run build`, `npm run lint`, and the dedicated Playwright config against the local app.

Verified locally on 2026-09-18: 114 unit/API suites, 1,455 tests passed; all three real SAML/MongoDB browser scenarios passed (including browser failure reporting and eight scoped accessibility/layout checks). Production build, lint and test TypeScript checks passed. Test fixtures were cleaned up. Changes are local on `codex/admin-audit`; no remote deployment has been performed.

The final manual refresh check found and fixed duplicate logging when a browser error report was interrupted during navigation. The added regression passes, and the repeated live navigation no longer reports a lost audit write.
