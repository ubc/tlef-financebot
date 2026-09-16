# Student Analytics design prototype

Sample data only. No access to live student identities or records. PRD reviewed:
- docs/PRD.md §6.4, IN-A01–06: mode-separated topic/LO rates, question distributions,
  engagement, individual answer history/mastery/events, permission-aware exports.
- §9.2: four-state mastery, recent-10 statistics, asynchronous evaluator rationale,
  separate exam qualifier, served-LO attribution.
- §4.1: retained course records and consent/governance.

## Information architecture
Topics → objective inspection → question/version distributions.
Questions → exact recorded version and answer counts.
Scores → submitted Exam Prep sittings only; never call practice accuracy a grade.
Students → Student Master Profile (mastery, answer history, exam results, events).

Mode/date scopes apply to performance. The profile explicitly shows a separate
latest, course-wide mastery snapshot. No attempts != zero performance.
Rates suppressed below five attempts; denominator visible; retries included.
Question versions must remain separated.

## Current APIs vs proposed work
Existing: topic/LO failure rates; version-specific question patterns and answer
distributions; weekly engagement; permission-gated student search and profiles
(history, mastery rationale, Review Book, flags, engagement summary).
Needed for full design: instructor submitted-sitting score endpoint with earned /
possible points, template/version/date scope and explicit multiple-sitting policy;
rich chronological attempt details with rendered served values and option selections;
complete typed flag/redirect events; evaluation timestamps and progression timeline;
profile summary aggregates (do not infer them from truncated history responses).
Named student access continues to require analytics.individual. No export control is
simulated; consent-aware export is a separate implementation requirement.

This prototype uses illustrative options outside its first question and labels that
limitation. Student examples are independent profile fixtures, not a roster-wide
reconciliation of every aggregate attempt. Production must derive all counts from
the same scoped attempt records and pinned versions.


## Production implementation — 2026-09-15
The application now uses live APIs in Topics, Questions, Scores, Students, and
Engagement tabs. Topic rows expand into objectives and open version-specific
question analysis. Date/mode scopes, the five-attempt floor, and weekly CSV remain.
Scores use submitted Exam Prep sittings with earned/possible points, per-template
histograms and repeat-sitting disclosure. Named scores require individual access.
The Student Master Profile shows active objective labels, persisted mastery and
rationale, pinned-version answers rendered with saved values, submitted exam scores,
Review Book and recorded flags. Mastery is explicitly a course-wide snapshot.
No synthetic redirect history or mastery-transition timeline is presented; those
require additional stored event data. The static prototype remains sample-only.
