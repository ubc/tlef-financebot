# Task 15 — Wireframe reference (Figma "Wireframe v0.2")

File: `https://www.figma.com/design/3lSS05Sk1OWpnxFQNyVsM9/Finance-bot` — page/canvas `148:2725` ("Wireframe v0.2"). **Follow roughly**: match layout, structure, and the green/white language; do NOT chase pixel-perfect spacing or exact tokens. Pull a screen live with `get_screenshot(fileKey, nodeId)` when implementing its view.

## Instructor screens in Task-15 scope

| View (Task) | Wireframe | node-id |
|---|---|---|
| My Courses | N1 Instructor Course List | `194:2` |
| Create Course | N2 Create Course | `198:2` |
| Course Dashboard | I1 Course Dashboard | `148:3516` |
| Topic/LO Structure | I2 Topic/LO Hierarchy Editor | `148:3582` |
| Course Settings | I4 Course Settings | `148:3721` |
| Materials | I3 Material Upload & Assignment | `148:3664` |
| Question Bank | I7 Question Bank Browser | `148:3962` |
| Question Detail/Editor | I6 Question Review Detail | `148:3897` |
| Review Queue | I5 Review Queue | `148:3779` |
| Pre-seeding Coverage | N9 Pre-seeding Coverage | `283:68` |
| Custom-prompt generation | I12 Custom Prompt Generation | `148:5283` |
| AI Suggested Hierarchy | N10 AI Suggested Hierarchy | `283:166` |

## Explicitly OUT of Task-15 scope (later phases)
Student screens `1–12`/`S13–S22`; Analytics `I9`/`I10`; TA `T1–T4`; Admin `A1–A5`; exams; Parameterization `I13`; Import `N5`; Split/Merge LO `N4`; Source-changed review `N7`; Regenerate variant `N8`. Their nav entries render but are **inactive/"coming soon"** so the shell matches the wireframe without building out-of-scope destinations.

## Shell (all instructor screens)
Green left sidebar (~240px): `FinanceBot` brand + `INSTRUCTOR` pill; nav groups — **(ungrouped)** My Courses · **(course)** Course Dashboard, Course Structure, Course Materials · **Question Bank** → Review Queue [count badge], Question Bank, ~~Import~~ · ~~Student Analytics~~ · **Course Settings** → Settings, ~~Teaching Assistants~~, ~~Co-instructors~~. Instructor name pinned bottom. Content: page title + `Course Code · Term · Sandbox/Published` sub-line, primary action top-right (dark button, e.g. "Publish Course →").

## Option-role display names (I6)
Internal `OptionRole` → wireframe label:
- `correct` → **Correct Answer**
- `common-misconception` → **Good Confounder**
- `partially-correct` → **Related but Incorrect**
- `clearly-wrong` → **Easy to Eliminate**

## Status/badge vocabulary seen
- Question status: Approved, Pending Review, Pre-Approved(=reviewed), Draft, Paused, Archived.
- Agent decision: Pass, Flag, Reject.
- Coverage: At Target (green), Below Target (amber), Empty (red).
- Material status: Ready / Processing (dot), Auto-classified High/Medium / No match / Unassigned.

## Palette (approx from screenshots — implementer refines against wireframe)
- Sidebar green `#2f7d46`-ish; active nav slightly darker/tinted; brand text white.
- Primary/dark button near-black `#1a1f1a`; ghost button white w/ light border.
- Surface `#ffffff`; muted panel `#f5f6f5`; hairline border `#e5e7e5`; amber `#b7791f`; red `#c0392b`; green text `#2f7d46`.
