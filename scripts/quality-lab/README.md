# Frozen-input authoring quality lab

These command-line recorders run controlled experiments. The model-comparison
and review-only runners do not save, adopt or publish questions. The separately
declared public acceptance runner exercises real Draft persistence and explicit
candidate adoption in owned local fixtures; it never publishes them. The HTML
book reads their English JSON evidence separately.

## First model pilot

The prospective matrix has five exact requested model/effort arms:

| Arm | Requested model | Reasoning effort |
| --- | --- | --- |
| luna-low | `gpt-6-luna` | low |
| luna-medium | `gpt-6-luna` | medium |
| luna-high | `gpt-6-luna` | high |
| sol-medium | `gpt-6.1-sol` | medium |
| sol-high | `gpt-6.1-sol` | high |

Each receives the same frozen source packet, current Bank snapshot, task request
and **byte-identical generator prompt for that case**. Model ID and effort are
explicit request options. All arms have the same 8,000-token generator output cap,
including reasoning. A fixed `gpt-6.1-sol` at medium effort assesses each successfully
parsed candidate with the production grounding/novelty parser and a 6,000-token
cap. Sol generator arms share a model family with this judge; that limitation is
recorded and model judgment is never described as teacher acceptance.

The four cases cover a thin-topic Bank duplicate, source percentage notation with
decimal CAPM inputs, diagram actor ownership, and unsupported hardness pressure.
They reuse public-PDF sources inspected during October 14 debugging and therefore
are **tuning cases**. A single repetition is a pilot, not evidence of a general
model ranking. Held-out cases must use separate, previously uninspected source
identities; the fixture validator rejects source overlap between splits.

Schedule rotation reduces fixed model-order confounding without claiming random
assignment. All generators run before judges and repairs so optional repairs
cannot consume the budget of a later generator arm. Failed, invalid, missing and
budget-stopped slots remain in the 20-slot denominator. Source excerpts are
retrieval controls, not a claim that the entire book is pedagogically covered.

## Freeze and inspect without model calls

```bash
npx tsx scripts/quality-lab/freeze-retained.ts \
  --observations audit-results/generation-quality-retest-2026-10-14/observations-after-repair.json \
  --output audit-results/quality-lab-2026-10-16/frozen-model-cases.json

npx tsx scripts/quality-lab/run-model-comparison.ts \
  --fixture audit-results/quality-lab-2026-10-16/frozen-model-cases.json \
  --output audit-results/quality-lab-2026-10-16/model-preflight
```

These commands make zero model calls. All output paths must be new. Fixture
hashes cover the exact prompts and original source/Bank/task controls. Original
passage coordinates are checked against the complete retained chunk archive.
Full PDF hashes and original chunk text are kept in ignored evidence rather than
committed to the repository.

## One explicitly authorized paid execution

Do not run until the root experiment owner has frozen code and authorized this
execution. The first phase shares one durable conservative ledger with outline
and repair work: at most **100 reserved SDK invocations / 2,000,000 conservative
estimated input plus reserved output tokens**. The global 200,000 input ceiling
supports document extraction, while every question/judge send stays at 24,000.

```bash
npx tsx scripts/quality-lab/run-model-comparison.ts \
  --fixture audit-results/quality-lab-2026-10-16/frozen-model-cases.json \
  --output audit-results/quality-lab-2026-10-16/model-pilot \
  --ledger audit-results/quality-lab-2026-10-16/phase-one-ledger.json \
  --scope quality-lab-2026-10-16-phase-one \
  --max-sends 100 --max-estimated-tokens 2000000 \
  --ledger-input-limit 200000 --repair-candidates 2 --live once
```

The portable JSON helper may send one correction after invalid JSON; both actual
prompts and both raw visible replies are retained and both consume the same
budget. At most two selected withheld candidates may enter the production
evidence-bound repair path, with an additional shared eight-send repair cap and
one semantic repair cycle per original candidate. Original candidate hashes and
before/after assessments remain separate. A changed input or a new repaired
candidate is never presented as the same original output.

The disk ledger reserves before dispatch and never releases a failed or unknown
reservation. Reopening a process cannot reset its scope or caps. It fails closed
on a concurrent/abandoned lock; inspect the live process and recorded state
before resolving a lock. It never steals a lock automatically. A reservation may
be conservative if a later in-process guard prevents dispatch; reported observed
sends and reserved sends are separate counts.

## Capturing production calls from other runners

`createCapturedCompletion` in `completion.ts` returns an injectable `complete`
callback and `captures` array. Use the same ledger path/scope/limits for outline,
validation and repair calls. Supply the real `completeJson`, exact model ID,
explicit low/medium/high effort, output cap, and an optional immutable-code guard.
Per-stage input/output ceilings must be declared before sending. Existing
`beforeRequest`, `onText`, `onAttempt`, `onUsage` and usage context are composed.

Each transcript contains exact input messages and options, every visible raw
response before JSON parsing, per-attempt provider events, reported nullable
tokens, reasoning/cache token subsets, latency, transport/JSON failures and parsed
output. Hidden chain of thought is not captured. A request option named JSON is
not a strict native schema guarantee in the toolkit's streaming transport.

Requested model IDs are never renamed. Native actual model IDs must match a
prospectively declared exact allowlist; missing or different response identities
stop the controlled experiment. Unknown options, implicit effort/default model,
code changes during the run, input-cap failures and evidence-write failures also
stop rather than silently falling back.

Reported tokens cover observed SDK invocations only. Hidden SDK/provider retries,
embedding calls, document parsing and infrastructure remain excluded. Byte-based
admission estimates are deliberately conservative and are not a dollar invoice.
Teacher labels remain null until an actual teacher supplies them. No model
ranking, reduced review-time claim or complete saved-batch yield is established
by this pilot alone.

## Retained negative controls and actual correction

Run `run-validation-controls.ts` separately from the generator matrix so its
purposely selected defects do not change the model comparison denominator. The
default controls are the retained incorrect firm/investor relation and the
fractional CAPM variant with an explicit earlier-candidate comparator. The exact
original semantic fields, source coordinates, memory and requirements are
frozen before any call. Historical decision labels are removed from the new
model input. Historical results remain context, because their judge model, cap
and citation protocol differed.

```bash
node --import tsx scripts/quality-lab/run-validation-controls.ts \
  --probes audit-results/generation-quality-retest-2026-10-14/quality-only-probes.json \
  --output audit-results/quality-lab-2026-10-16/validation-controls-preflight
```

After root authorization, use a new output directory and append:

```bash
  --paired-matrix audit-results/quality-lab-2026-10-16/model-pilot/results.json \
  --ledger audit-results/quality-lab-2026-10-16/phase-one-ledger.json \
  --scope quality-lab-2026-10-16-phase-one --live once
```

The fixed Sol medium judge first evaluates the unchanged retained candidate.
Only validated actionable findings can start one production evidence-bound
content repair. The two controls share an eight-send repair cap inside the
existing phase ledger. A new candidate, independent revalidation and the full
before/after audit are retained. Uncertain diagram extraction, missing source
support, a schema failure, an unchanged candidate or exhausted budget cannot be
converted to success by the harness. No initial question generation, adoption,
teacher judgment or source/Bank mutation occurs.

## Original statistics extraction: matched old/new prompt

`run-extraction-pair.ts` recovers the actual extraction prompt, passage partition
and validators from the retained October 14 implementation snapshot and current
trusted repository code using TypeScript declarations. Baseline Git-object and
file hashes are checked. It reads the exact retained Statistics PDF page 6;
neither its source text nor a historical raw reply is fabricated. Both arms use
the same original text, numbered passages, instructor options, Luna medium and
8,000-token cap. Raw output, each protocol's own validation, and the common new
strict passage-accounting result are separate observations.

```bash
node --import tsx scripts/quality-lab/run-extraction-pair.ts \
  --output audit-results/quality-lab-2026-10-16/extraction-pair-preflight \
  --ledger audit-results/quality-lab-2026-10-16/phase-one-ledger.json \
  --scope quality-lab-2026-10-16-phase-one
```

Preflight uses zero DB/API/network calls. The measured first-send conservative
reservations are 13,156 tokens for the retained prompt and 14,391 for the new
prompt: 27,547 total, including both 8,000-token output allowances. Root-authorized
execution uses a new output directory and `--live once`, with at most four
observed sends including JSON corrections. One page/repetition cannot establish
general multi-file semantic coverage; teacher acceptance stays null.

## Ten-file outline preflight and bounded owned-fixture execution

```bash
node --import tsx scripts/quality-lab/run-outline-experiment.ts \
  --fixture audit-results/quality-lab-2026-10-16/corpus-fixture.json \
  --output audit-results/quality-lab-2026-10-16/outline-ten-preflight \
  --ledger audit-results/quality-lab-2026-10-16/phase-one-ledger.json \
  --scope quality-lab-2026-10-16-phase-one
```

This preflight reads local JSON/PDF/code files only and preserves every selected
original chunk. For the complete physical ten-file fixture it records 599 PDF
pages, 671 source sections and 48 production extraction batches. At the explicit
10,000-token observer cap, exact first-attempt extraction reservations total
**795,670 conservative input + 480,000 output = 1,275,670 tokens**, before JSON
correction, partial-row recovery, single-section fallback or synthesis. The
remaining first-phase allowance cannot complete this cold full corpus. The
runner therefore refuses that known-doomed cold minimum before connecting to
Mongo or calling a provider.

An explicitly selected incremental experiment may add `--chapters 3,6`; the
receipt lists every excluded file and cannot be described as complete ten-file
coverage. A later full-scope run can reuse independently validated source-local
cache rows under matching model/prompt/source identities. Completion of all ten
files remains a separate outstanding experiment until actual evidence proves it.

For root-authorized live work, append `--live once` with a new output directory.
The runner requires the owned local Mongo instance on port 27029, its exact
fixture database/course owner, replica support, unchanged full source manifests,
and unchanged code snapshots before every model send. The exact production
`generateStructure` path performs extraction, validation, cache writes and
synthesis; it never applies Topics/LOs, publishes questions or changes Admin
model defaults. Observer 10,000 means `min(12000,10000)` extraction and
`min(24000,10000)` synthesis; production default 12,000/24,000 caps remain separate.

`serialize-admission.ts` serializes only the same-process before-dispatch evidence
and ledger critical section. The two production provider workers remain
concurrent. Cross-process lock contention still fails closed. Every actual
attempt shares the phase ledger, and partial/error outputs plus source receipts,
observer events, full raw I/O and final source-inventory coverage are retained.

## Guaranteed zero-model warm-cache probe

```bash
node --import tsx scripts/quality-lab/run-outline-warm-cache.ts \
  --prior audit-results/quality-lab-2026-10-16/outline-subset-live \
  --output audit-results/quality-lab-2026-10-16/outline-warm-preflight
```

Preflight reads local receipts only. The root may run the production cache path
against the same owned Mongo fixture with a new output directory and
`--live cache-only`. Source fingerprint, model/effort/caps, options, fixture and
cache-related code must match the completed cold run. The cold-minimum guard is
exempted only because the injected completion has no provider reference and
throws on every cache miss, while an enclosing native budget independently
allows zero sends. No budget or ledger is reset.

The probe creates a disposable diagnostic structure run without enqueuing an
Agenda job. It records actual cache receipts and progress. If production needs
uncached final synthesis, it fails honestly with `cache-miss`, keeps the exact
blocked request and terminalizes the diagnostic run. It never substitutes a
historical outline for a missing production cache. Time to a cache miss must not
be presented as complete warm-generation latency. A genuinely reused full result
is compared with the cold outline/evidence content hash, separately from runtime
cache metadata. Database/CPU costs and professor-confirmed quality remain outside
the zero-model-token observation.
