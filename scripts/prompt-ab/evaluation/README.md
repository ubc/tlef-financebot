# Offline quality evaluation

This tool connects FinanceBot's recorded generation results to blinded teacher
review and explicit quality, supply, time, and token denominators. It does not
call a model, connect to MongoDB, execute question code, or generate teacher
labels. The CLI imports only local JSON files. A separate authenticated API
exports existing records without generating or changing course content.

## Try the complete workflow without a provider

From the repository root:

```sh
npx tsx scripts/prompt-ab/evaluation/cli.ts demo scripts/prompt-ab/results/quality-demo
```

Open `scripts/prompt-ab/results/quality-demo/review.html` in a browser. It works
offline, with no external assets. Enter an anonymized reviewer ID, inspect the
source and comparison questions, label each dimension, and record active review
minutes manually. Use **Download review JSON** to save work. The page does not
silently persist reviews: download before closing it, and use **Resume previous
reviews** to continue. Conflicting imports require explicit adjudication.

The demo uses identical authored candidates in both arms. Labels start empty,
usage is unavailable, and all reports say **synthetic**. It demonstrates the
workflow; it is not a measured model experiment or genuine teacher evidence.

After saving the downloaded review file as `reviews.json`:

```sh
npx tsx scripts/prompt-ab/evaluation/cli.ts report \
  scripts/prompt-ab/results/quality-demo/dataset.json \
  scripts/prompt-ab/results/quality-demo/private-review-key.json \
  reviews.json scripts/prompt-ab/results/quality-demo-report
```

Read `report.md` for the main measures and `report.json` for per-case counts,
all five issue dimensions, comparison exclusions, measurement coverage, and
judge confusion matrices. Existing files are never overwritten. Choose a new
output directory for a revised report.

## Review real generation records

1. In **Generate questions → Generation activity → View steps**, use **Download
   evaluation export** for a terminal generation run. Course Instructors and
   Admins can use it; the endpoint does not grant TA or Student access. The
   direct route is `GET /api/courses/:courseId/content-runs/:runId/evaluation-export`.
2. Keep each downloaded export private. It contains original question/source
   content and safe usage data, not only aggregate counts. No account identity,
   request/session correlation, credentials, or provider response bodies are
   included. Source content itself may still contain identifying information;
   minimize and authorize the material before sharing a review file.
3. Prepare a manifest with the teaching context against which a teacher should
   judge each run. Copy original source text, specify allowed prerequisite
   roles, and include the relevant starting Bank/Queue questions if they were
   actually recorded. Never substitute today's bank and call it the old bank.
   Use incomplete coverage when a historical snapshot is unavailable.
4. Import the manifest. Paths in `runs[].file` are relative to the manifest.

```sh
npx tsx scripts/prompt-ab/evaluation/cli.ts import \
  exports/manifest.json scripts/prompt-ab/results/course-review
```

A minimal manifest shape follows. Replace the instructional placeholders with
authorized original evidence. The request must exactly match each export's
count, format, difficulty, and instructor instruction. Use `mixed` when the
recorded run has no difficulty. Different requests need different cases.

```json
{
  "experimentId": "capm-retrospective-01",
  "cases": [{
    "caseId": "capm-risk",
    "repetitions": 1,
    "context": {
      "objective": "Paste the recorded learning objective or state the retrospective review objective.",
      "request": { "type": "mcq", "difficulty": "easy", "count": 2, "instruction": "" },
      "sources": [{ "id": "lecture-excerpt-1", "role": "primary", "text": "Paste the authorized original passage here." }],
      "bank": [],
      "coverage": {
        "sourcesComplete": false,
        "bankComplete": false,
        "notes": ["Historical starting bank is unavailable; sources are partial excerpts."]
      }
    }
  }],
  "runs": [
    { "file": "baseline.json", "caseId": "capm-risk", "repetition": 1 },
    { "file": "pilot.json", "caseId": "capm-risk", "repetition": 1 }
  ]
}
```

Each `bank` entry has `id` and `content`. Content uses the existing question
shape: `type`, `stem`, `options` with `key/text/role/explanation`, and optional
`numericKind`, `paramSlots`, and `derivedValues`. See `schema.ts` and the demo
dataset for complete examples. Bounds are 100 cases, 200 observed runs, 100
requested slots per run, 200 source passages and 200 bank questions per case,
and 50 MiB per CLI input file.
Blind review preparation additionally limits each review set to 500 observed
slots and 25 MiB of serialized card content, including repeated source context.
Split larger datasets into complete case/repetition groups to keep comparisons
and same-batch context intact.

**Historical imports are always retrospective.** They can support descriptive
issue analysis, but cannot establish a controlled A/B effect or matched-context
judge-error rate. The adapter never converts them to pre-run snapshots based on matching
course/LO IDs, model names, or current database content. It preserves every slot,
including an explicit missing outcome when the original cannot be recovered.

## Blinding and integrity

Share **only `review.html`** with a reviewer. Keep `dataset.json` and
`private-review-key.json` with the evaluator. The review file omits arm names,
models, automatic findings, usage, storage outcomes, and original run IDs.
Source and comparison IDs become local `S1`, `Q1`, and `B1` aliases. Same-run
earlier final candidates are available for judging repeated learning tasks.
Random ordering and opaque review IDs reduce presentation bias; recognizable
content or teacher instructions can still reveal an experimental condition.

The private key binds the dataset and every review card's question, source,
bank, and earlier-candidate content. Changing evidence or reusing stale labels
fails import. Missing/truncated candidates or mismatched context permit only
triage notes, time, and unresolved/source-shortfall dispositions. Missing earlier
candidates are an explicit novelty coverage limitation. Unknown evidence IDs,
duplicate/conflicting labels, invalid times, or completed anonymous/unassigned
reviews are rejected. The tool accepts one adjudicated reviewer file per report;
it does not silently combine disagreeing raters.

Content is rendered as text and formula syntax is literal. No parameter script,
formula code, HTML from course material, or external asset is executed. A
Content Security Policy blocks network dependencies. The hashes detect accidental
content changes; they are not signatures authenticating who supplied a manifest.

## How to read the report

- **Supply:** every manifest repetition and requested independent slot stays in
  the denominator, even if an entire arm is missing. Saved questions accepted
  unchanged or after edits with duplication explicitly absent count as delivered
  independent supply. Accepted variants and acceptable withheld candidates are
  separate. Unreviewed outputs leave supply unresolved; they are not teacher
  rejections.
- **Incidence:** source, notation, duplication, difficulty, and answer issues are
  reported with present/absent/uncertain/unreviewed counts. Resolved-only and
  reviewed-including-uncertain denominators are explicit. Saved-output incidence
  is separate from all-slot incidence. A saved Draft is not teacher acceptance.
- **Time and usage:** source-checking, editing, rejecting, and failure triage all
  count as active review time. Usage summaries cover recorded calls across all
  attempts, including repair, failure, and withheld output. Call-list pagination
  does not shrink the run's accounting summary. Unknown values stay null, partial
  totals stay recorded subtotals, and zero accepted supply has no finite
  per-accepted ratio. Historical numerical proofs are reported independently;
  absent proofs stay unknown. Imported latency measures recorded run start to
  finish; it excludes queue wait and any preparation outside that interval.
- **Judge calibration:** compare resolved teacher source/notation/duplication
  labels with automatic judgments only when the original generation context is
  declared frozen and source/bank coverage is complete. Retrospective/unrecorded
  contexts remain excluded because differences in supplied reference material
  could otherwise look like judge mistakes. False-accept share is teacher failures among
  reviewed automatic passes. False-reject share is teacher passes among reviewed
  automatic withholds. Show these denominators and unresolved coverage, rather
  than calling a model's own pass rate accuracy.
- **Comparison:** descriptive paired deltas require matching declared pre-run
  context and control hashes, complete source/bank context, isolated arms, and
  both recorded policies. Hash equality checks declarations; it cannot prove
  historical execution. Missing or uncertain teacher labels remain visible. No
  automatic winner, causal claim, or quality threshold is inferred.

## Preparing a prospective experiment

Use `prepare <dataset.json> <output-directory>` for a validated dataset following
`schema.ts`. Cases declare every planned repetition. Each recorded run must
contain every requested slot exactly once, including explicit missing records.
`contextHash` binds the full case context. `controlsHash` should bind the same
effective models/options, retry budgets, prompts common to both arms, numerical
checks, and Hard rotation; the intended policy treatment is the controlled
difference. `hash <json-file>` produces the canonical SHA-256 of a supplied
snapshot. Preserve that snapshot alongside the experiment.

Freeze the manifest **before** paid generation, isolate starting banks and
source versions, and capture settings and outputs as they execute. Do not change
retrospective imports to `before-generation` to make a comparison pass. This CLI
does not launch A/B generation or freeze a live database; prospective execution
and capture remain a separate step. Teacher labels, randomized review, and the
[evaluation protocol](../quality-protocol.md) are needed before any rollout claim.

## Verification

```sh
npm test -- --runInBand tests/unit/quality-evaluation-cli.test.ts \
  tests/unit/quality-evaluation-import.test.ts tests/unit/quality-evaluation-metrics.test.ts \
  tests/unit/quality-evaluation-review.test.ts tests/unit/generation-evaluation.service.test.ts \
  tests/unit/generation-evaluation.routes.test.ts
```

All tests use synthetic data and local files. The repository unit network guard
remains enabled. No provider credentials are required.

The standalone review browser suite also needs no application server:

```sh
npx playwright test --config playwright.quality-evaluation.config.ts
```

It intercepts its own HTML fixture and blocks other requests, checking download,
resume, stale/conflicting reviews, reviewer identity, hostile literal content,
triage-only cards, and desktop/mobile accessibility.
