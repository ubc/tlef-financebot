# Question Generation Correctness — Task Checklist

**Spec:** `docs/superpowers/specs/2026-11-12-generation-correctness-design.md`
**Branch:** `generation-correctness` (local only).

- [x] **1. Parameter solver.** `question-generation/parameter-solver.ts`: grid
  enumeration (≤4096), greedy pruning to explicit `values`, ≥2 values per slot
  and ≥8 combinations, constant-derived-value findings. Export the per-draw
  check from `numeric-verification.service.ts`. Tests: `parameter-solver.test.ts`.
- [x] **2. Wire into candidate checks.** `inspectCandidate` solves before
  `verifyGeneratedNumerics`; solved slots are stored; report saved as
  `verification.parameterSolver`; constant findings listed. Tests in
  `question-generation-candidate.test.ts`.
- [x] **3. Repair pass.** `generateAndCheck`: triggers, one `repair` call via
  `RegenerateContext`, recheck, keep the better candidate, `agentDecision.repair`
  provenance, `generationRepair` platform flag (default on), live-preview line.
  Tests in `question-generation-pipeline.test.ts`.
- [x] **4. Reader.** Questions reader and question detail show solver
  adjustments and repair provenance; client types.
- [x] **5. Evaluation script.** `scripts/generation-eval.ts` + README note.
- [ ] **6. Gates and docs.** typecheck, lint, unit; `docs/api-contract.md`,
  `tests/AGENTS.md`, root "Current state"; live check: regenerate for the
  trial course's LO 3.
