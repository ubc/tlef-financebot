# Negative outline verdicts must not credit coverage or block sibling results

The first whole ten-source v2 acceptance attempt remains failed. Its retained
receipt is
`audit-results/quality-lab-2026-10-16-outline-v2-acceptance/live/results.json`,
run `6ad2d15e19a66b1237767be5`. It stopped after 641,013 ms, 20 observed sends and
1,004,330 conservative reservation units. Reported usage was 194,215 input and
81,903 output tokens. The durable partial receipt retained 102 of 142 reviews:
82 source-supported and 20 withheld. Those results/costs are historical; this
repair does not turn them into a completed outline.

## Exact L96 failure

L96 combined operating-income uncertainty, debt constraints and their value
cost, risk/tax factors and debt-ratio comparisons. Its assigned point E603 asks
learners to interpret recession-year operating-income changes and the reported
standard deviation of EBIT percentage changes. E603 resolves only to original
S361, Chapter 8 chunk 45, which contains that table and its 19.17% standard
deviation.

The initial review called L96 supported and claimed E603 as covered, but did not
cite S361. Rejecting that positive coverage claim is necessary: another own
original is not interchangeable with the point's bound original.

The bounded correction changed the source verdict to unsupported, with a reason
about the LO's implied value-cost method for book-debt constraints. It still
listed E603 while omitting S361. The old coverage check rejected this already
negative row and stopped the remaining outline. Thus the terminal error combined
two different situations: an invalid **positive** coverage claim and irrelevant
coverage bookkeeping on a row that could never admit an LO. This report does
not endorse the model's substantive book-debt judgment as teacher truth.

## Minimal repair

All positive source/citation/coverage gates remain strict. A positive claim that
E603 is covered without S361 still fails. Its correction diagnostic now names
the point and its own permissible supporting sources:

```json
{
  "reason": "structure-grounding-review-coverage: E603 requires citation of one of [S361]",
  "coverageRequirements": [
    { "evidenceId": "E603", "requiredSourceIds": ["S361"] }
  ]
}
```

The existing one-cycle correction receives those precise diagnostics. It can
cite an actual required original or remove an unjustified coverage claim; it
cannot invent a source or obtain a forced positive verdict.

Unsupported and uncertain reviews now have canonical `coveredEvidenceIds: []`.
Their known model-reported point IDs may be retained separately:

```json
{
  "ignoredModelCoverage": {
    "authoritative": false,
    "reason": "negative-source-verdict",
    "evidenceIds": ["E599", "E600", "E601", "E602", "E603", "E631", "E632", "E633"]
  }
}
```

That diagnostic is computed by the server, bounded by the existing 200-ID schema
limit, and never used to map coverage, supply source proof or admit an LO. It
retains the raw claim instead of silently turning it into authority. Models
cannot inject the diagnostic through extra response fields. Unknown/duplicate
point IDs, foreign/duplicate source IDs and missing/duplicate objective identities
still fail closed. A negative row's valid citation IDs are still checked against
its own original binding.

Admission independently rejects fabricated nonempty negative coverage and
positive findings carrying ignored negative diagnostics. Existing v1 records
are not rewritten, normalized or reclassified. The changed behavior applies to
freshly validated v2 findings only.

## Verification and remaining scope

The focused grounding suite passes 57 tests, including the minimal retained
L96/E603/S361 identity reproduction, a supported counterexample that still fails
without S361, negative/uncertain withholding, sibling retention, no mapped credit,
strict identity checks, diagnostic tampering and historical v1 preservation.
Scoped ESLint and strict standalone TypeScript also pass.

A file-only replay used the retained L96 request's exact learning-point/source
bindings and both raw responses. The original positive response still fails
with the precise E603/S361 diagnostic. The corrected unsupported response is
retained as negative with zero canonical coverage and eight ignored model IDs.
That replay tests reference accounting, not semantic accuracy, a historical
canonical-hash replacement or persistence. It made zero provider/DB calls.

No model comparison code, generation helper, live budget, source manifest or
fixture changed. No paid rerun was performed under the old frozen manifest. A
new prospectively controlled whole run is required to establish completion and
its final source/coverage outcomes; this offline repair alone does not establish
better LO quality, teacher acceptance or saved question supply.
