# Structure coverage gap pass — design

**Date:** 2026-11-23
**Status:** Agreed with the developer in conversation ("Label points + gap pass").

## Problem

Run `6b04777be6746ab63ca48288` (COMM 298, 8 lectures): 469 extracted learning
points, 338 credited after the original-source review, 131 gaps. The outline
cited all 469; every gap came from the review not crediting a point to the LO it
was assigned to (74 of 120 supported LOs got partial credit).

The 469 points are a raw per-section ledger: the same concept recurs in a
lecture's objectives slide, its body, its summary and the practice file;
worked-example numbers and agenda bullets are points too; many are compound
sentences. So "131 gaps" mixes four things:

- examples, agenda bullets and administration — need no LO;
- points another LO (or several together) already teaches — under-credited;
- points of an LO the review withheld;
- genuine missing capabilities (e.g. why bonds are "fixed income", why issuers
  set coupons so bonds start near par).

## Design

After the normal review and admission, for runs without the capability protocol:

1. **Gap check (Utility model).** Every learning point not mapped to an admitted
   LO is sent, in batches of up to 60, with the admitted outline as a stable
   system prompt (`T3.L2  topic — LO`). For each point the model returns:
   - `role`: `core` (a teachable capability), `example` (a worked example,
     specific numbers or a named case), `overview` (an agenda/objectives-slide
     bullet restating other points) or `admin`;
   - `coveredBy`: up to three outline LO IDs that together teach the point's
     capability, or `[]`;
   - a short reason.
   Invalid rows are dropped (the point stays a gap). A point with `coveredBy` is
   added to those LOs' evidence and materials.
2. **Gap fill (Outline organizer model).** Remaining `core` points go to one call
   that may write new LOs — following `OUTLINE_LO_WORDING_RULES` — each placed in
   an existing topic by exact name and citing only gap point IDs. It must not
   restate an existing LO.
3. **Review of new LOs (Utility).** New LOs go through the same
   `reviewStructureProposal` against original sections (no checkpoint); only
   supported LOs with credited coverage are merged into their topics.

The pass is best-effort: any failure other than the run being stopped is
recorded and the reviewed outline is kept as it was.

`coverage.gapPass` records counts by role, credits, new LOs (proposed /
supported / withheld) and each checked point's role, `coveredBy` and reason. The
Source coverage panel shows it; `example` / `overview` / `admin` gaps are
reported separately from `core` gaps.

## Limits

- Gap-check credit is a model judgment that an admitted LO teaches the point; it
  is not an original-source review of the LO (that already happened). New LOs do
  get the source review.
- Outline repair / consolidation start from the review checkpoint, which does not
  include gap-pass changes.
- Expected cost for 8 lectures: ~2–3 Utility calls (prompt-cached outline
  prefix), one organizer call, a few review calls.
