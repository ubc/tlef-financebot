# Generate Questions — teaching brief workstation

Independent interactive concept for Stephen. No application APIs or model calls.

Audience: university instructors preparing Physics practice questions. The page's
job is to translate selected learning objectives into a clear generation request
and show its progress through inspectable drafts.

Visual direction: continue the chosen B review workstation and green shell.
Forest #255f38, ink #192b32, slate #617078, canvas #f0f3f4, white #ffffff,
amber #97652c. System sans for UI, Charter/Georgia for question reading, system
monospace for question identifiers. Compact three-panel layout:

    objectives | teaching brief / live question | batch summary / activity

Signature: the same workspace changes from planning a batch to watching drafts
appear. Optional authoring instructions are the focus, with inline count/difficulty;
coverage data helps choose objectives rather than dominating the page.

Critique: keep advanced settings collapsed, avoid oversized metrics above the
form, keep exact batch size visible before generation. A sidebar gap selector uses
the displayed approved + pending counts; it does not silently select every LO.
No source and no objective states offer an explicit recovery action.

Interactions: choose objectives, select coverage gaps, change count/difficulty,
use prompt suggestions, expand format/focus, generate, pause/resume, inspect
completed drafts, review during generation, and approve locally. Top scenario
selector demonstrates missing-source/objective states. Reset clears the demo.

Output is illustrative and repeats three example Physics questions. It is not
produced from the entered prompt, format or selected objectives. Simulated
progress and brief reviewer findings show the proposed experience, not private
model reasoning or real events. All data is in memory and refresh resets it.

Verification: desktop and 390px mobile screenshots inspected; no horizontal page
overflow or browser errors. Objective count controls, prompt suggestions,
generation, pause/resume, first-draft review/approval, reset, and both missing-data
recovery actions exercised in Chromium. Selecting an existing draft stops automatic
selection changes while further drafts arrive. Production code is unchanged.
