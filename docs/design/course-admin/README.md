# Course administration prototypes

Four interactive, English-language proposals sharing the approved green Instructor shell and compact content layout. All content is fictional. No API calls or real mutations. Changes remain in memory and Reset reloads the demo.

- `/exam-templates/`: Midterm/Final switch, topic-level MCQ/T-F mix, live question and point totals, supply warning, timing, results breakdown, save feedback, student experience preview, empty state.
- `/teaching-assistants/`: searchable member roster, active/pending/expired states, UBC invitation dialog, permissions, re-invitation, empty team. Approval and final flag resolution remain Instructor-only.
- `/settings/`: General, Learning experience, Question safeguards, Enrollment, Course lifecycle. Section forms, retained input across sections, roster replacement preview, registration-code confirmation, archive and typed delete demos.
- `/help-tutorials/`: task-based cards, search, Instructor/Student/TA/Admin role preview, walkthrough dialog, completion/replay/reset, no-results state. These demonstrate the interaction, not the full production tutorial catalogue or live page spotlights.

Top controls expose Dark mode, Empty state and Reset. At narrow widths content stacks and a navigation toggle exposes the sidebar.

Implementation distinctions: exam supply is illustrative, not actual assembly eligibility. Role switch is a prototype inspection control, not production authorization. Roster validation and actual CSV uploads remain production responsibilities. Saving settings per section is proposed behavior; current backend contracts must be checked before implementation. Empty settings state means empty roster rather than an absent course.

Verified in Chromium: quantity updates/supply warnings, template switching, invitation and permissions, settings retention and delete confirmation, tutorial completion across steps, all role options, empty/dark states, and no document overflow at 390px. Screenshots inspected at 1440px.
