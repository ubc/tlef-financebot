# Synthetic finance quality fixtures

`synthetic-finance.json` contains ten hand-authored English cases with twelve
candidates. It covers allowed source scope, a real citation without sufficient
support, equivalent mathematics with different notation, numerical variants,
similar wording with a different inference task, queued duplicates, a thin
authored task inventory, and the correction of an intentional false statement.

These fixtures are not teacher judgments or measured model outcomes. Both the
set and every case keep `labels: null` and `expectationOrigin: "fixture-authored"`.
They are separate from the teacher-authorized experiment manifest in
`scripts/prompt-ab/quality-protocol.md`.

The runtime schema is `scripts/prompt-ab/quality-fixture-schema.ts`. It validates
frozen identifiers, original-text hashes, format, explicit expectations and
independent-slot shortfalls. Source hashes cover the original passage IDs,
pages and text; they do not certify the authored concept annotations. Evidence
references in candidates may be out of scope or insufficient by design.

The unit tests use explicit concept, notation and pedagogical fingerprints to
check deterministic decisions. They do not infer entailment or fingerprints
from prose, verify model arithmetic, evaluate retrieval, or demonstrate an
automatic reviewer’s accuracy. Similar fingerprints here are authored truth
for a fixture; a production system would still need calibrated judgments.
The thin inventory defines this test only, not the total supply or maximum
difficulty of a real learning objective.

Run without a model provider or database:

```sh
npm test -- --runInBand tests/unit/quality-fixture-schema.test.ts
```
