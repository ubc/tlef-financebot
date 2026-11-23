# Structure generation (Topics & LOs) — reliability, visibility, speed

**Date:** 2026-11-23
**Status:** Agreed with the developer in conversation; P0–P2 implementing, P3–P4 next.

## Evidence

Run `6b0461d71da659dfff935dee` (COMM 298, 8 lecture PDFs, 254 sections,
Utility model `gpt-6-luna`, reasoning `none`) failed after 443 s with
`structure-review-budget-exhausted`. Receipts:

| Stage | Calls | Retries | Input | Output | Wall |
|---|---|---|---|---|---|
| source-extraction | 48 | 17 | 112,627 | 78,859 | 319 s |
| outline-synthesis | 3 | 0 | 91,088 | 5,685 | 26 s |
| outline-organization | 1 | 0 | 16,925 | 5,484 | 32 s |
| outline-source-review | 8 | 4 | 63,688 | 5,748 | 64 s (stopped) |

Reported usage was 284k input + 96k output tokens; the conservative admission
ledger had reached 1,952,046 of its 2,000,000-unit ceiling (UTF-8 bytes per input
plus the full output cap per send, never settled). Review stopped at 38 of 94
objectives.

While the review ran, the run still said stage `synthesizing` with the message
"Merging all … packs", so the page looked frozen at the last streamed objective.

## P0 — A normal course must be able to finish

- **Corpus-scaled ceiling.** The structure run's `maxEstimatedTokens` becomes
  `clamp(16,000 units × sections, min = AUTHORING_MAX_ESTIMATED_TOKENS,
  max = AUTHORING_STRUCTURE_MAX_ESTIMATED_TOKENS [default 12,000,000])`.
  This run used ~7.7k units per section before review stopped; a full review is
  projected at ~10.8k, so 16k leaves ~1.5× headroom. Accounting stays
  conservative and unsettled (the review checkpoint, consolidation and repair
  invariants depend on it); only the ceiling grows, and every inherited limit is
  read from the run's own recorded budget, so downstream checks stay coherent.
- **Visible review stage.** The run moves to stage `checking` before the first
  review send, with "Checking objectives against their sources · n of N" after
  each receipt.
- **Honest failure text** for `structure-review-budget-exhausted`: completed
  source analysis is cached, so generating again reuses it.

## P1 — See what is happening

- Structure page shows the run's token usage and model calls, reusing
  `GET /content-runs/:runId/usage` and `renderModelUsage` / `renderModelCalls`
  (already used by question generation).

## P2 — Faster extraction

- Extraction concurrency: the hard `Math.min(2, …)` cap is removed; the default
  `AUTHORING_EXTRACTION_CONCURRENCY` becomes 4 (bounded by the process-wide
  `AUTHORING_PROVIDER_CONCURRENCY`, default 4).
- Investigate the 35% correction rate in extraction (17/48) and 50% in review
  (4/8) and fix the dominant cause.

## P3 — Outline quality (next)

Measured problems in the Luna draft: 88 LOs for 8 classes, 29 words on average,
compound LOs, near-duplicates (1.2/1.5, 1.4/1.6, 7.4/8.1/8.2, 15.1/15.7/15.8),
case-bound LOs (WeWork, Hydro One), non-MCQ-assessable LOs (spreadsheet skills),
topics of 1–9 LOs, and annuity/perpetuity (27 source mentions) collapsed into one
LO while amortization got nine. Planned: synthesis constraints (one skill per LO,
concise with no fixed word limit (the developer dropped an initial 20-word cap), no case-bound or tool-operation LOs, 3–7 LOs per topic, proportional
coverage), and per-stage models (Luna for extraction; Sol for synthesis,
organization and review) — decided by P4 data.

## P4 — Measurement (next)

A `scripts/structure-eval.ts` harness on this fixed 8-file set reporting wall
time, tokens, retries, LO count, words per LO, near-duplicate pairs, per-material
coverage and topic balance, run for Luna, Sol and hybrid.
