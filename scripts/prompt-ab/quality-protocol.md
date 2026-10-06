# Source-Grounded Question Quality Baseline Protocol

Status: initial evaluation protocol. No teacher labels, paid comparison, or
measured quality improvement is claimed by this document.

The [offline evaluation tools](evaluation/README.md) implement terminal-run
export, blinded teacher review, integrity-checked review import, and descriptive
reporting. Their synthetic walkthrough has no teacher labels. Retrospective
production exports do not satisfy this protocol's prospective experimental
controls, and are excluded from controlled paired comparisons.

## Evaluation boundary

The harness uses fixed source chunks and does not exercise live retrieval,
course authorization, serving, or the full teacher interface. Its model review
verdicts are diagnostics, not teacher acceptance. Keep those limits in every
report. Tests of the accounting plumbing use synthetic responses only.

Before a paid comparison, freeze the fixture manifests, requested slots, bank
snapshot, prompts/policies, provider/model/effort/options, and retry budgets.
Reuse the same starting state for every arm, isolate their generated questions,
repeat stochastic runs, and randomize teacher review order. Teachers should not
see arm names or model review verdicts while labeling candidates.

## Fixed case manifest

Prepare the following cases from teacher-authorized course material. These are
case categories to populate, not existing validated fixtures or labeled examples.

| Case | Target failure or distinction |
| --- | --- |
| Narrow or sparse LO | General finance knowledge beyond the supplied notes; insufficient independent supply |
| Formula-heavy LO | Missing definitions/conditions, source parsing gaps, and numerical correctness |
| Notation-sensitive notes | Same mathematics expressed with a convention inconsistent with the source |
| Bank and repeated-batch case | Same learning task with new wording/numbers versus a new required inference |
| Explicit source selection | Material present elsewhere in the course but excluded from the request |
| Prior-LO dependency case | Allowed versus disallowed prerequisite reasoning, including Hard constructions |
| Local edit case | A notation-only or targeted instruction change without unrelated answer/task changes |

Each manifest must contain:

```ts
interface QualityCaseManifest {
  caseId: string;
  category: string;
  courseScopeId: string; // anonymized evaluation scope
  loId: string;
  loVersion: string;
  objectiveText: string;
  materials: Array<{
    sourceId: string;
    contentHash: string;
    parserVersion: string;
    passages: Array<{ passageId: string; page?: number; text: string }>;
  }>;
  allowedMaterialIds: string[];
  allowedPrerequisiteIds: string[];
  bankSnapshot: Array<{
    questionId: string;
    version: string;
    familyId?: string;
    variantOf?: string;
    content: unknown;
  }>;
  request: {
    type: 'mcq' | 'tf';
    difficulty: 'easy' | 'medium' | 'hard';
    independentSlots: number;
    intentionalVariantSlots: number;
    teacherInstruction?: string;
    previousQuestionVersion?: string;
  };
  rubricVersion: string;
  expectedChecks: string[]; // explicit teacher-authored expectations, not model-generated labels
  labels: null; // leave unannotated until a teacher actually reviews it
}
```

Store only authorized, minimized material excerpts and anonymized identifiers.
Keep the original source available for disputed entailment; a generated source
summary cannot resolve that dispute. Hold out complete LO/material/family groups
from prompt optimization and automatic-judge calibration.

## Teacher rubric

For each candidate, record `present`, `absent`, or `uncertain` for each issue,
plus supporting passage/question IDs and a brief rationale. An uncertain label
does not count as a clean pass. Separate a parsing/evidence gap from confirmed
unsupported content.

| Dimension | Decision rule |
| --- | --- |
| Source scope | Are necessary premises, definitions, conventions, and correct solution steps supported within the allowed sources/prerequisites? General factual truth alone does not establish source scope. |
| Notation | Does the question and correct explanation follow source symbols, units, timing, signs, and financial conventions? Record equivalent but inconsistent notation separately from mathematically wrong notation. |
| Duplicate learning task | Compare concept, required inference, solution path, and target misconception against bank, queue, and batch. New numbers or surface wording alone normally form a variant. Similar wording alone does not prove duplication. |
| Edit fulfillment | For edits, did the exact requested change occur and did required invariant content survive? Label no-op changes and unintended task/answer/numerical-definition changes separately. |
| Difficulty | Does required conceptual work match the requested difficulty? Longer wording alone is not harder. |
| Answer quality | Is the intended answer unambiguous and its correction/explanation correct? Intentional false distractors and false T/F statements are not scope errors merely because they are false. |

Record disposition separately: accepted without substantive edits, accepted
after teacher edits, discarded, intentional variant, unresolved, or source
shortfall. Preserve deterministic numerical checks as an independent measure.
An automatic reviewer pass does not populate a teacher disposition.

## Teacher time and supply

Measure active review minutes for every requested slot, including checking
sources, editing, rejecting, and triaging failures/shortfalls. Define timer
start/stop rules before review; exclude breaks consistently. Record independent
questions accepted, intentional variants accepted, requested slots, and unmet
slots. A lower error rate with almost no usable supply is not a quality win.

Report both all-candidate issue incidence and recommended-output issue
incidence. Include uncertainty, sample size, disagreement resolution, and
teacher time per accepted independent question. A zero accepted denominator
has no finite per-accepted ratio: report unavailable plus absolute time/usage.

## Usage and experiment accounting

The harness records every observed component SDK invocation, including JSON
repair, planning, validation, review, failed candidates, and reject replacement.
Receipt IDs prevent duplicate event delivery from being counted twice. Missing
provider counts remain null; partial totals are recorded subtotals. Separate
quality denominators from usage denominators, which include error rows.

This versioned accounting applies to `harness.ts`. Historical standalone
experiment scripts with private `onUsage` accumulators are not automatically
migrated; their totals must not be treated as equivalent to this baseline.

SDK-internal retries may be unobserved. Embeddings, parsing, and infrastructure
are outside initial LLM accounting. Token totals are not an exact invoice or a
currency cap. Record coverage, actual models/options, repair attempts, pipeline
latency, and cold versus warm evidence/fingerprint preparation separately.
Include preparation in end-to-end consumption once that path is instrumented.

Compare A (current behavior with truthful instrumentation), B (evidence and
memory), and C1 (B plus bounded deterministic repair). C2 (adaptive routing) is
optional only after C1 exposes a concrete routing gap. This protocol does not
implement B/C or fill in any results. Freeze teacher-defined release thresholds
and budgets before generating the paid sample; do not infer success from zero
or one baseline failure.
