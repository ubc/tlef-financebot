# AGENTS.md — client/

The frontend. Deliberately framework-free and bundler-free: plain TypeScript
authored as native ES modules, compiled by `tsc` and served statically.

## How it works

- Source lives in `client/src/*.ts` (and `client/src/views/*.ts`).
- `tsc -p client/tsconfig.json` compiles it to `client/public/js/**/*.js`.
- The server (`server/src/app.ts`) serves `client/public/` as static files, so
  the compiled JS, `index.html`, and `styles/` are reachable from the root URL.
- `index.html` is a near-empty skeleton (`<div id="app">`) that loads the app as
  a native ES module: `<script type="module" src="/js/main.js"></script>`. All
  UI is built in TypeScript.

## The `.js` import rule (important)

Browsers resolve ES module specifiers literally — TypeScript does not rewrite
them. So when importing one client file from another, use the compiled `.js`
extension in the source (including into subfolders):

```ts
import { checkHealth } from './api.js';        // resolves to compiled ./api.js
import { renderHome } from './views/home.js';  // subfolders work the same way
```

This is enabled by `"moduleResolution": "Bundler"` in `client/tsconfig.json`.
Omitting the extension will compile but fail to load in the browser.

## Structure

Two top-level states, chosen at startup from `GET /api/auth/me`:

- **Logged out → the landing screen** (`views/landing.ts`): brand, a short
  intro, the public health check, and the "Log in with CWL" button. Nothing else
  is reachable — the rest of the app is behind login.
- **Logged in → the app shell** (`main.ts`): a navy sidebar + top bar with a hash
  router swapping views in the main outlet.

| File | Role |
| --- | --- |
| `config.ts` | **The re-skin point.** App name/tagline (`APP`) and the sidebar `NAV` table. |
| `main.ts` | Bootstrap: picks landing vs shell, builds the sidebar/top bar, starts the router, initializes the theme. |
| `router.ts` | Tiny hash router (`#/`, `#/notes`, …). No server SPA fallback needed. |
| `auth.ts` | Caches the session from `/api/auth/me`; derives a display name. |
| `api.ts` | One typed function per endpoint. Centralizes 401 handling (see below). |
| `theme.ts` | Light/dark theme (persisted; `data-theme` on `<html>`). |
| `ui.ts` | Shared UI kit: loading/empty/error states, badges, status dots. |
| `dom.ts` | `el()` / `mount()` / `byId()` — minimal DOM helpers. |
| `views/landing.ts` | Pre-login screen. |
| `views/home.ts` | Overview (dashboard): welcome, system status, component map. |
| `views/health.ts` | Reusable "System status" card (used by landing + home). |
| `views/notes.ts` | EXAMPLE (mongodb demo). Safe to delete. |
| `views/rag.ts` | EXAMPLE (genai + qdrant demo). Safe to delete. |
| `views/members.ts` | The gated members-only area (auth-gating reference). |

## Adding a page

1. Add a typed call in `src/api.ts` for any new endpoint.
2. Add an entry to `NAV` in `src/config.ts` (path, label, group, `demo?`).
3. Create `src/views/<name>.ts` exporting a `render(outlet)` function.
4. Register it in the `ROUTES` table in `src/main.ts`.

## Auth-gating in the UI

The whole app is behind login: when signed out, only the landing screen renders.
Gated views call gated endpoints, and `api.ts` routes any `401` to a single
handler (`setUnauthorizedHandler`, wired in `main.ts`) that re-bootstraps back to
the landing screen — so an expired session mid-use fails gracefully. Remember the
UI gate is only UX; the real enforcement is the server's `ensureApiAuthenticated()`
(see `server/src/components/auth/AGENTS.md`).

## Re-skinning

Two places: `APP` + `NAV` in `src/config.ts`, and the `:root` token block at the
top of `public/styles/main.css` (colors, radius, sidebar width). The deep-navy
sidebar and the monospace treatment for technical data are the visual signature;
both are token-driven.

## Conventions

- `client/tsconfig.json` sets `"types": []` so Node types never leak into browser
  code. The available globals are DOM + ES2020.
- Put all backend calls in `src/api.ts` (one typed function per endpoint). Keep
  response types in sync with the server routes/services.
- Keep views small and self-contained: a `render(outlet)` that builds its own DOM
  and owns its loading/empty/error states.
- The compiled output `client/public/js/` is generated and git-ignored. Never
  edit it by hand and never commit it.
