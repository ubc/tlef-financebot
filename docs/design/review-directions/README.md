# Review design exploration

Independent interactive prototypes for Stephen, 2026-09-14. No production app changes or API calls.

Audience: university instructors. One task: assess a complete question and decide what to do next.
The familiar green Instructor sidebar stays visually consistent across all directions.

Palette: forest #255f38, ink #192b32, slate #617078, canvas #f0f3f4, paper #ffffff,
review amber #97652c. Status colors carry meaning; the question remains the focal point.
Typography: Charter/Georgia for editorial question reading, system sans-serif for navigation and
workstation content, system monospace for identifiers, progress and mathematical quantities.

A — Editorial desk: outline | readable question document | marginal review notes.
Signature: answer annotations read as teaching feedback beside a typeset question.
B — Review workstation: compact queue | selected question | decision inspector.
Signature: stable selection and decision bar while inspecting several questions.
C — Conversation + document: conversation | versioned live question document.
Signature: revision comparison lives beside the instruction that produced it.

Critique before implementation: avoid large marketing headlines, decorative dashboard metrics,
unrelated illustrations and a generic chat-only page. Each option uses the same actual conceptual
question from the supplied course screenshots. The numerical question uses illustrative sample
values for the supplied parameterized force question, explicitly labeled. Additional queue content,
AI feedback, progress and conversation are demonstration data, not claims about a running model.

Use the top controls to change direction, question, review/edit/generation state and viewport.
Approve/archive affect only the in-memory demo. Generation uses labeled simulated staged events,
not real token streaming. Refresh resets all changes. Choose a direction before implementation.

## B refinement — compact queue and review navigation

B is the default direction. Queue entries use compact metadata, a title and a small status indicator. The lower-left Question board opens a numbered grid; selecting a square changes the active question. The grid highlights the current question and distinguishes awaiting review, attention, approved and rejected states.

Reject opens a dialog with an optional note. Cancel leaves the decision unchanged. Confirm records the local demo decision and displays the note on the question; approval clears a previous rejection note. All text remains in memory and resets on refresh.

The larger queue contains 18 demo items made from three repeated examples, explicitly labeled in the UI. Verified board navigation, rejection with and without a note, cancellation, Escape, status updates, and a 390px mobile viewport.
