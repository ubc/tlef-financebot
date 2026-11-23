# Instructor course model selection — plan

Spec: `docs/superpowers/specs/2026-11-23-instructor-course-models-design.md`

- [x] `COURSE_MODEL_STEPS` = all five steps (server + client); Admin route body accepts them.
- [x] `admin.service`: `instructorSelectableModels()`, `getCourseModels` / `saveCourseModels` with an
      `'admin' | 'instructor'` scope; instructor saves reject non-supported new models; audit records scope.
- [x] `routes/course-models.routes.ts`: `GET|PUT /api/courses/:courseId/models` behind `ensureCourseInstructor`.
- [x] Client API + `views/instructor/course-models-settings.ts` panel, mounted as "AI models" in Course Settings.
- [x] Tests: service validation (custom model rejected for instructors, kept when unchanged), route guard, panel save.
- [x] Docs: `docs/api-contract.md`.
