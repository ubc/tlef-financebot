# Question Bank — approved collection prototype

For Stephen. Standalone interactive prototype at http://127.0.0.1:6130/. All data
and mutations are simulated in memory; no application APIs, uploads or model calls.

The green sidebar and compact B reader are preserved. Palette: forest #255f38,
ink #192b32, slate #617078, canvas #f0f3f4, paper #ffffff, amber #97652c.
System sans controls, Charter/Georgia question, monospace IDs. The visual signature
is the prominent Topic releases strip: each topic shows its approved count and
released/unscheduled/scheduled status with a direct management action.

Only approved samples appear in the active Bank. Needs-review samples are excluded.
Archived samples have a separate tab. Editing or restoring sends a sample draft to
a separate simulated Review Queue; it leaves the approved collection. The draft
notice exposes the resulting draft. Real version/history retention will be handled
by the existing production service, not by this in-memory model.

Interactions: topic release now/schedule/hold, question board, search/topic/status/
difficulty filters, selection-only bulk archive, student preview, empty state,
dark mode, and full editor. Editor supports title, stem, options, correct answer,
per-option explanations, teaching explanation, topic, objective, difficulty, type,
source reference and internal notes. Adding/removing MCQ options is supported;
changing type replaces the options with appropriate defaults.

Release assumes a published sample course and no additional serving blocks.
Production integration must use authoritative topic/course/version/numerical
verification gates. Dates are simulated; this demo does not run scheduled jobs.
Numerical variable/formula editing and real import remain production integrations.

Verified in Chromium: future topic scheduling, option/explanation/correct-answer
editing, return to review, reset and mobile dark rendering. No page errors or
horizontal mobile overflow. Review Queue header changes are separately implemented
in production source and validated by its ten existing isolated browser cases.
