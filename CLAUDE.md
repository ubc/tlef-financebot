# CLAUDE.md — FinanceBot

This repository is built by two developers, **Saurav** and **Stephen**, each
running their own agent sessions. This file is loaded into every session; the
full engineering guide is in **AGENTS.md** (and the per-folder `AGENTS.md`
files — always follow the one closest to the files you are editing).

## Identity: ask first, every session

Before doing ANY phase-plan work — reading, writing, or executing tasks from
`docs/superpowers/plans/` — you MUST ask the human which developer you are
working for: **Saurav or Stephen.** Do not assume or guess. A SessionStart hook
(`.claude/settings.json`) reminds you of this at the start of each session.

Once you know who you are:

- Read the root **AGENTS.md → "Two-developer convention"** for the full workflow.
- Only pick up plan tasks whose `**Owner:**` line matches your developer. Never
  start, edit, or "helpfully fix" the other developer's task without flagging it
  to your human first.

## Write your own plan before you build

Before starting a phase, use the superpowers **writing-plans** skill to turn the
core phase document (e.g.
`docs/superpowers/plans/phase-0/2026-07-11-phase-0-foundations.md`) into your
own task-by-task plan, and save it under your name:

```
docs/superpowers/plans/<phase>/<YourName>/
```

for example `docs/superpowers/plans/phase-0/Saurav/`. This is how the other
developer — and their agent — sees what you are working on.

## Share plans

Run this before and after a work session:

```
npm run sync-plans -- <YourName>
```

It publishes your `<YourName>/` plan folder to `main` and pulls the other
developer's latest plans into your working tree, so both sides stay current
without waiting for feature branches to merge. See AGENTS.md for the details and
the branch-protection fallback.
