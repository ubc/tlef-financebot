# Original-page continuity audit

One actual structural correction illustrates why passing a citation/schema
validator is not sufficient evidence of semantic quality. This is an intermediate
extraction finding, not an observed final-outline failure.

The original finance Chapter 2, PDF page 5, contains a flowchart with investment,
financing and dividend decisions. Production text chunks `C6.S1` and `C7.S1`
split the lower boxes across a boundary. The first model response cited both
sections, but failed source-local citation and name-length rules. Its correction
split the learning points and removed cross-section citations.

The resulting `C7.S1` objective describes how available cash and its return to
owners depend on investment opportunities and owners' preferences. The complete
relationship is visibly present on the original page, but the subject and start
of that relationship occur in `C6.S1`. A point citing only `C7.S1` is therefore
not self-sufficient evidence for every part of its wording.

A final merged LO can legitimately recover support by citing learning points
from both sections. The running final synthesis and original-source review must
be inspected before calling this an actual false refusal, final coverage gap or
incorrect saved question. If the final binding lacks the needed context, the
next repair should retain bounded neighboring original sections or allow exact
multi-section supporting references. It must not waive source checks, treat a
summary as proof or guess unreadable chart values.

The file-only receipt is
`audit-results/quality-lab-2026-10-16-phase-two/source-continuity-audit.json`.
It pins the original PDF, rendered page, complete two chunks, and exact captured
before/after rows. Rendering and inspection made zero provider or database calls.
Professor acceptance remains unmeasured.
