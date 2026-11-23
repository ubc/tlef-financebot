# Instructor course model selection — design

**Date:** 2026-11-23
**Status:** Agreed with the developer in conversation.

## Goal

A course's instructors choose which model each AI step uses for their course,
from Course Settings, without Admin help. They may only pick models FinanceBot
supports; they cannot type or register a model.

## Decisions (developer, 2026-11-23)

- **Model list:** the built-in supported models (`KNOWN_MODELS`: gpt-5.4-nano,
  gpt-5.6-luna, gpt-6-luna, gpt-6.1-sol) plus the server's environment default
  models. Admin-registered custom models are never offered to instructors.
- **Steps:** all five — Generator, Checker, Utility, Outline organizer and
  Mastery evaluator (shown as not yet in use).
- **Ownership:** one shared per-course setting (`course.llmModelSettings`), edited
  by Admin (Platform Console) and by the course's instructors (Course Settings).
  Every save is audited with its actor and which surface made it.

## Behaviour

- `COURSE_MODEL_STEPS` becomes all five pipeline steps (Admin's per-course panel
  shows them too).
- `GET /api/courses/:courseId/models` (course instructor): revision, current
  choice per step, the platform default per step, the effective model per step
  and the instructor-selectable models with their capability profile.
- `PUT /api/courses/:courseId/models` (course instructor): same body as the Admin
  endpoint. A new choice must be in the instructor list; an unchanged existing
  choice (for example an Admin-assigned custom model) is kept; an empty choice
  returns the step to the platform default. Revision conflicts return 409.
- Only the model changes. Reasoning effort and temperature stay the platform's,
  reconciled to the chosen model's capabilities as today.
- Course Settings gets an **AI models** section: one select per step ("Platform
  default (model)" plus the supported models), a short help line per step, and a
  note that a stronger model costs more and the change applies to new runs.

## Not in scope

Per-course reasoning effort/temperature, cost caps, an Admin lock or allowlist.
