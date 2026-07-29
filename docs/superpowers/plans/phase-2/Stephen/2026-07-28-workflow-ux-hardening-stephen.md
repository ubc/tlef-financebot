# FinanceBot workflow and UX hardening — Stephen

**Owner:** Stephen  
**Branch strategy:** small, independently reviewable `codex/workflow-ux-hardening-round-*` PRs  
**Started:** 2026-07-28

## Goal

Repeatedly exercise the application as an Instructor and as an anonymous
Student Preview user, then fix low-risk workflow bugs and confusing UX without
large architectural or visual rewrites.

## Required workflow loops

### Instructor A — structure first

1. Create a course and inspect the publish checklist and quick actions.
2. Set term dates.
3. Manually create Topics and LOs.
4. Upload materials.
5. Review and accept/modify/reject material-to-LO suggestions.
6. Generate MCQ and T/F questions across multiple LOs/difficulties.
7. Review agent feedback, edit, approve, and verify Question Bank state.
8. Process Student flags through Edit/Return/Reject & Archive.

### Instructor B — materials first

1. Create a course and upload materials before a hierarchy exists.
2. Generate the Topic/LO hierarchy with AI.
3. Review/edit/deselect suggestions and apply them.
4. Verify supporting materials are assigned automatically to the created LOs.
5. Generate, review, edit, and approve grounded questions.

### Student Preview

1. Enter Student View from Course Dashboard.
2. Practice with the configured feedback strategy.
3. Flag a question with a comment and optionally send it as TEST.
4. End a session and inspect Session Summary.
5. Review missed/bookmarked questions in Review Book.
6. Exit Preview and verify Instructor notifications/Flags refresh.

## UX review lens

- Every action should explain its consequence in plain language.
- Internal terms such as `assignment`, run codes, and state-machine errors must
  not be the only user-facing explanation.
- Doomed actions should be prevented before they create failed durable runs.
- After an async operation, the next useful action should be obvious.
- Empty states and retry states must explain how to recover.
- Preserve existing visual language; no broad redesign.

## Round 1 priorities

- [x] Establish the structure-first Instructor and Student Preview browser
      baseline.
- [x] Verify the merged AI hierarchy auto-assignment path end to end.
- [x] Prevent generation when an LO has no ready assigned material and provide
      a direct recovery action.
- [x] Replace raw generation failure codes with useful user-facing messages.
- [x] Add direct checklist actions and a Settings quick action for missing term
      dates.
- [x] Verify OpenAI embedding-provider compatibility and define a safe Qdrant
      384 → 1536 dimension migration path.
- [x] Exercise question review, approval, flags, notifications, and Student
      Preview paths.
- [x] Run targeted tests plus the full regression suite.
- [x] Update `Stephen/STATUS.md` with evidence and unresolved findings.

## OpenAI embeddings configuration finding

The existing embeddings adapter already supports:

```env
EMBEDDINGS_PROVIDER=openai
EMBEDDINGS_MODEL=text-embedding-3-small
```

It reuses `LLM_API_KEY` and leaves the official endpoint unset. The model's
default vector dimension is 1536, while the current FastEmbed model is 384.
Existing per-course Qdrant collections therefore need an explicit migration or
re-ingestion strategy; changing only the environment variables is not safe for
collections that already contain 384-dimensional points.

## Guardrails

- Never read, print, or commit API keys.
- Do not delete staging/local course data or Qdrant collections automatically.
- Keep changes scoped to failures observed in the stated workflows.
- Add regression coverage for every production-code fix.
- Record findings before and after each PR-sized round.
