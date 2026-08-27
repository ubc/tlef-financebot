# AGENTS.md — components/lms

Wrapper around `@ubc/ubc-genai-toolkit-lms-integration` (Canvas only; Moodle
is deliberately not mounted). Design:
`docs/superpowers/specs/2026-08-27-canvas-integration-design.md`.

Rules:
- The package owns OAuth, token refresh, pagination, file download policy, and
  roster matching. Do not reimplement any of it here or in a service.
- `getUserKey` is `req.user.puid`. Never an email, uid, or display name.
- Tokens live in `lmsCanvasTokens`, owned by the package's Mongo store.
- Matching is on Canvas `integration_id` (= PUID at UBC) only. No fallback.
- Nothing from a Canvas response's `raw` reaches a browser; no PUID or token
  reaches a log line.

Local Canvas: `../local-lms-dev/README.md`.
