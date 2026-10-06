# FinanceBot Question Generation Quality: Research and Improvement Proposal

Research date: October 3, 2026. Status: a design proposal for review. The proposed generation changes have not been implemented, and their quality benefits have not been validated.

The delivery sequence, acceptance gates, and token accounting design are documented in [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md).

FinanceBot already has a multi-role LLM workflow, numerical verification, bounded retries, and a durable job system. The recommendation is to build on this foundation with course evidence preparation, a teaching plan for each question, bank and batch memory, and a constrained generation agent that selects actions according to the reason for failure. Adopting LangGraph is an implementation choice; quality improvements must come from additional information and checks, and must be demonstrated through teacher evaluation.

This research read the current workspace source and historical experiments, and shallow-cloned three open-source projects. The workspace contains other uncommitted development changes, so the source findings below do not confirm what is deployed. This research did not call paid models to generate questions, run evaluation scripts that write to the question bank, or reproduce historical experiments.

## The Current Backend Flow

The public question bank path is in [generation.service.ts](../../../server/src/services/generation.service.ts), with `runTrackedGenerationPipeline` as its entry point.

```text
Teacher request → validate course and LO → freeze generation parameters → contentRun → Agenda
  → retrieve material using the LO name and teacher prompt
  → generate each question, with deterministic numerical verification and bounded feedback retries
  → Validator checks option roles and the declared Hard construction
  → Reviewer checks facts, material support, difficulty, and misconceptions
  → if rejected and the feature is enabled, regenerate once with the critique
  → save final pass, flag, and reject candidates as Drafts
  → teacher decides whether to approve
```

| Capability | Already implemented | Boundary relevant to the reported issues |
| --- | --- | --- |
| Planning | Allocates work by LO, difficulty, type, and approved question counts; Hard uses an experimentally evaluated construction rotation | A quantity quota does not establish how many independent teaching angles the material supports |
| Retrieval | Retrieves six relevant passages by default; under some conditions Hard adds two passages from earlier LOs | Questions in the same batch share retrieval results; definitions, notation, or necessary conditions may not enter the top-k results |
| Review | Validator and Reviewer both see retrieved material | They share retrieval blind spots; there is no independently checkable mapping from individual requirements to evidence |
| Memory | Mongo stores questions, versions, runs, and teacher-related records | Public generation calls do not receive the existing Bank, Queue, or questions already generated in the same batch |
| Feedback repair | Numerical errors receive targeted feedback; reject can trigger one retry | Flag does not trigger a retry; the workflow cannot return to retrieval for missing evidence or change the teaching plan after detecting repetition |
| Run state | Agenda, contentRuns, revision CAS, SSE, and cancellation checks | Public candidates are mainly held in memory; a restart explicitly fails interrupted work rather than resuming from a checkpoint for each candidate |

The term "agent" should describe behavior here. Existing models perform fixed roles, while the server decides every call path. There is no loop in which a model chooses a tool, receives a new observation, and decides the next action. This is a multi-role AI workflow, and the existing investment should be preserved.

`renderChunks` does not truncate retrieved passages. The precise problem is selecting a limited set of passages, rather than truncating the passages already retrieved. Reviewer does have access to lecture material.

Two exceptions also matter: Exam Builder includes request interpretation and exact duplicate checks for private questions; Structure Generation already includes analysis across segmented full material, passageId reference validation, and retries that split a failed batch. They provide possible reuse points, but do not yet form a teaching-level semantic deduplication and evidence loop for the public question bank.

## What the Existing Experiments Tell Us

Sources: [prompt-engineering-tests.md](../../prompt-engineering-tests.md), [reviewer-agent-tests.md](../../reviewer-agent-tests.md), and the [existing panel](../../../scripts/prompt-ab/panel.ts). These are historical repository records; they were not rerun for this research.

- Experiment 10 already found that giving Reviewer the material helps. The current implementation includes this improvement, so it cannot be presented again as a new intervention.
- In Experiment 26, a small experiment covering one LO and six questions per arm, LLM selection of a Hard construction produced only three methods, while deterministic rotation produced six. This does not establish that all model planning is ineffective, but it directly challenges the assumption that adding a planner call increases diversity.
- A regression panel already covers 64 questions across 32 cells. Its historical `usable` metric mainly reflects automated Reviewer decisions and numerical verification, and includes flag. It cannot be interpreted directly as the teacher's first-pass acceptance rate.
- The project deliberately retained flags that a human could repair. A question entering the queue after a difficulty mismatch is identified is partly a business policy, rather than evidence that the reviewer entirely missed the problem.

The new proposal should extend these existing experiment assets with metrics for the actual complaints: source scope, notation, teaching repetition, edit fulfillment, and review time. Hard construction rotation remains a strong baseline.

## The Proposed Generation Agent

The recommendation is a constrained coordinator that invokes existing generation, review, and numerical tools. A model may propose which evidence to look up, which error to repair, or which new teaching angle to use. The program controls course scope, action parameters, budget, termination, and saving. The first pilot should route findings to tools using deterministic rules. Only if rule-based routing exposes a specific limitation should an experiment measure the benefit of model-selected actions. Vendor-native tool calling is not a prerequisite: `completeJson` can return JSON, followed by server-side validation of actions, parameters, source scope, and budget with a closed Zod schema before execution. The TypeScript generic on the current `completeJson` does not provide runtime schema validation.

```text
Freeze the request and source versions
  → prepare course evidence and notation conventions
  → read existing questions and batch assignments, then form a plan for each question
  → generate from the plan
  → run numerical, structural, source, and teaching-repetition checks
      → requirements met: enter the existing teacher review process
      → evidence missing: retrieve more within the original course scope
      → notation or wording problem: make a local repair
      → teaching repetition: select a different teaching angle
      → insufficient evidence or exhausted budget: retain reasons and diagnostic candidates, and report the shortfall
```

Missing evidence must not be resolved by searching the internet for other finance knowledge. Insufficient course material and a retrieval miss must be distinguished: the workflow may reread relevant source text and neighboring passages. If support is still missing, report "sufficient evidence was not found within this run's allowed scope and retrieval budget," rather than asserting that the entire course lacks the knowledge. A graph framework does not make this business decision for us.

## How Course Evidence Can Reduce Out-of-Scope Content

First, build a traceable inventory from allowed materials, including concepts, formulas, symbol definitions, applicability conditions, and passage IDs. Reuse Structure Generation's segmentation and reference validation approach, and cache by material content version. Mark gaps when text or formula parsing is incomplete, rather than filling them from the model's general knowledge.

An LLM-extracted inventory is a retrieval index that can itself be wrong. Review must return to the frozen source text and necessary neighboring content; a summary must not become a new authority for facts. A valid ID also does not establish that a summary is accurate. Deleting material, updating its version, or changing the allowed scope must invalidate relevant caches, and source eligibility must be checked again before saving.

Each generation run's evidence set is bounded by the course, LO, explicitly selected materials, and allowed prerequisite knowledge. The current mechanism that automatically uses earlier LOs for Hard should be evaluated separately: knowledge within the course may still fall outside the teacher's intended scope for the current LO. This proposal recommends explicitly recording allowed prerequisites; the default policy should be validated against teacher examples.

Each question plan must identify the knowledge and evidence it needs. After generation, the program verifies that references exist and belong to allowed materials. Semantic review determines whether the question's premises and correct solution are actually supported. A real reference does not establish a valid inference, so both checks are needed.

Numbers and scenarios may vary, and reasoning may combine material already taught. The requirement is to avoid silently introducing untaught premises. Distractors and False statements in T/F questions do not themselves have to be true; the check concerns the targeted misconception, correct answer, and corrective explanation.

The testable hypothesis is that recovering missing evidence and checking knowledge dependencies will reduce the proportion of questions that are factually correct but outside the course's coverage. If PDF formula parsing is the actual cause, the repair belongs in material processing; extra review calls are insufficient.

## How Question Plans Can Reduce Repetition

Preserve the existing Hard construction rotation. New planning should produce the following checkable artifact:

```json
{
  "itemId": "slot-03",
  "conceptIds": ["course-concept-id"],
  "cognitiveTask": "Compare the applicability conditions of two solution methods",
  "solutionOutline": ["Identify the conditions", "Select a method", "Draw the conclusion"],
  "targetMisconception": "Omitting a required condition",
  "evidenceIds": ["source-passage-id"],
  "differenceFromExisting": {"questionId": "existing-id", "difference": "Adds a condition-selection task"},
  "requestedDifficulty": "medium"
}
```

This is a proposed data contract, not actual course content or an experiment result. `differenceFromExisting` is a claim to verify; a generator's own assertion must not count as a passed check.

A model may propose candidate angles from evidence. The server assigns work using existing questions, coverage, and explicit rules. This does not replace a rotation rule that already works. The first version should summarize concepts and solution tasks from current question versions within the same LO, preserving question family and variant relationships.

Use normalized text to find exact duplicates, embeddings to retrieve similar questions, and then a check of concepts, cognitive tasks, and solution paths for candidate neighbors. Changing numbers or a scenario will usually count as a variant, rather than a new independent angle; that definition must match the course's practice goals.

Allocate tasks within a batch before generation; concurrent runs share reserved plans. Rechecking recently written questions before saving reduces the risk of concurrent duplicates, but two batches can still both observe "no duplicate" and then both write. When stronger protection is needed, serialize the final check and commit by course or overlapping LO scope, including other runs' reserved plans and pending review candidates. Semantic deduplication cannot obtain the same guarantee as a database unique index alone; aggregate checks and teacher sampling remain necessary.

If the material supports only three reasonable angles but ten independent questions are requested, report the capacity shortfall and distinguish "acceptable new questions," "variants within the same family," and "unmet quantity." Returning fewer questions must not make the pass rate appear better; evaluation must also measure supply and coverage.

## How Review Findings Become Actions

Preserve existing numerical verification and Validator. Output the relevant Reviewer judgments as structured findings, rather than retaining only pass, flag, reject, and a long explanation.

| Finding | Next action | Exit condition |
| --- | --- | --- |
| Missing evidence | Look up the missing definition, formula, or condition within allowed materials | Repair after finding support, or report that sufficient evidence remains unavailable within this run's scope and budget |
| Inconsistent notation | Change only notation and related formulas, then rerun numerical verification | Matches confirmed course notation |
| Teaching repetition | Reference the conflicting question ID and replace the question plan | A new angle is supported by material and passes the repetition check |
| Difficulty mismatch | Try a cognitive task supported by the material, or propose a lower difficulty | Extra length does not substitute for difficulty; the teacher's target is not silently changed |
| Numerical failure | Continue using the existing verifier's specific diagnosis | Obtain a numerical verification result or stop |
| Unfulfilled edit | Make a local repair according to the teacher's request | The requested change is complete, and content required to remain unchanged is preserved |

Initially allow at most two content-repair rounds, with a shared limit on observed API attempts and elapsed time across nested retries. Record provider-reported token consumption and its coverage; missing usage must not appear as zero. A currency cap requires sufficiently complete accounting, versioned pricing, and reservations, and is a later capability. Count network retries separately from content repairs when the provider exposes them. Serious source or numerical failures must not be offset by soft scores such as fluent wording. Retain unresolved outputs as failure diagnostics, rather than mixing them into qualified candidates recommended for direct teacher review. Any separate presentation in the existing queue must preserve the teacher's ability to inspect failed questions.

Evidence gaps, duplicate conflicts, and teacher instructions should enter the state. Repair calls should receive the original request, original question, specific finding, and allowed changes. Resending the same prompt is not a useful reflection loop.

Regeneration should distinguish a local edit from a new variant. The current fixed instruction to create an "obviously different alternative" may conflict with "change only the notation." Updated review should see the old question, user request, and new question together, check both changes and invariants, and save the adoption or rejection result.

## A Worked Teaching Example

The following hypothetical example explains the flow; it does not imply that this research read a course's complete lecture notes.

Suppose the notes support direct application of one formula and interpretation of one variable. The bank already contains two direct-substitution questions, and the teacher requests six different Hard questions.

The current flow tries to generate each question using the material and Hard construction requirements. The generator does not see the two existing questions and does not first assess whether six independent angles are supported. Even if review detects low difficulty, it may flag the question and pass it to the teacher.

The new flow records the direct-substitution task already covered, then proposes remaining angles supported by the material. If a Hard plan needs additional theory not taught in the notes, the evidence check requires another lookup in the original materials; if support cannot be found, that plan is discarded. The eventual report might say, "The evidence supports two new angles; the remainder are suitable as numerical variants, and the current evidence is insufficient for six Hard questions."

This does not claim that a machine knows the absolute capacity for questions. It exposes a previously implicit business conflict, lets the teacher confirm the boundary, and removes unsupported requirements from the generator's unconstrained choices.

## Integration with the Current Stack

The first stage continues using TypeScript services, the existing UBC LLM wrapper, Mongo, Qdrant, Agenda, contentRuns, and SSE. Evidence, plans, checks, and repair become typed functions; `contentRuns` remains the authority for run status shown to users.

Durable state should at least include the request snapshot, material versions, bank snapshot, plans, each candidate attempt, check results, repair actions, and budget. Persist a stable slotId and target questionId on first execution, keeping candidate attempts separate from the final question. Final writes use a unique index for the run and plan item, together with upsert or CAS; retries must not create a new target identity. If a question has been saved but the run status was not updated before interruption, recovery first reconciles the committed result by stable identity and then updates run status, rather than simply creating another question. The concrete persistence protocol needs separate concurrency and interruption tests.

LangGraph.js may carry these nodes when branching and recovery requirements grow. Its current runtime supports CommonJS but requires Node 20 or later; deployment must be checked against the Node 18 baseline documented in this repository. If graph checkpoints are also used, they should store execution context while contentRuns owns business state, preventing two systems from independently deciding that a run is complete.

Cache course knowledge preparation by material version and update bank summaries by question version. Prefer batch planning, restrict semantic similarity checks to retrieved neighbors, and trigger content repair only for a specific failure. Initially record provider-reported LLM tokens, coverage gaps, latency, and recorded tokens per approved independent question; a small call count is not a cost measurement. Report cold and warm caches separately, include instrumented evidence extraction, bank summaries, checkers, failed calls, and retries, and state any amortization. Embeddings, parsing, and other unmetered work remain explicit exclusions. Report monetary cost only when provider usage and pricing coverage support it, with an estimate label and exclusions; do not call the initial LLM subtotal whole-system expenditure.

Proceed through four independently acceptable deliveries:

1. Add evidence and bank snapshots, teacher judgments, and truthful model-usage records to the existing harness to establish a replayable baseline. First confirm that the reported issues can appear in the evaluation.
2. Add evidence preparation and bank context, and directly evaluate arm B. This delivery can enter an independent pilot without a graph framework or automatic prompt optimization.
3. Behind the same calling interface, add per-question plans, structured findings, and a bounded action loop to evaluate arm C. `GenerationContext`, `QuestionPlan`, and `QualityFinding` are proposed data types, initially composed at existing service boundaries; the agent loop does not belong in routes.
4. Switch courses gradually after blinded teacher evaluation, retaining the old path for fallback. Introduce LangGraph.js or DSPy separately only when actual burdens in branch recovery or prompt optimization justify them.

## How to Establish That the Proposal Is Worth Implementing

Extend the existing panel and harness before creating incompatible quality definitions. The existing `panel.ts` creates Drafts in the bank; a pilot should use an isolated course or an evaluation adapter without business writes. This research did not run it.

The experiment has three steps:

1. Calibrate checkers with teacher-confirmed failures and valid cases. Include missing sources, real references that do not support a conclusion, the same task with different numbers, legitimate variants, notation changes, and local edits. Measure missed failures and false alarms, rather than just rejection counts.
2. Use the same material, bank snapshot, model configuration, and requests to compare current flow A, B with evidence and bank context, and C1 with additional per-question planning and deterministic repair routing. This tests whether the planning-and-repair combination adds value beyond providing fuller context. To establish the value of model-selected actions, compare C1 with C2 using the same information, tools, and budget. Do not attribute all benefits of bundled changes to agent autonomy.
3. Start with shadow runs or an isolated pilot and blinded teacher review. Normal student use continues through the existing approval and publication path.

The suggested first round covers six LOs, including thin material, computation, conceptual topics, and topics with substantial prerequisites. Request six questions per LO per arm and repeat twice. A and C1 together cover at most 144 requested slots; adding B makes 216. Some slots may explicitly remain unfilled and must count toward the shortfall. This sample can identify direction and major issues, but cannot establish general effectiveness across courses. Final evaluation must also reserve course materials or question families that were not used for tuning.

| Metric | Definition |
| --- | --- |
| Out-of-scope rate | Proportion that teachers identify as depending on unallowed knowledge; report all candidates and recommended outputs separately |
| Unintended repetition rate | Proportion without a new teaching task relative to the batch or existing bank; count legitimate variants separately, and report all candidates and recommended outputs separately |
| First-pass acceptance | Proportion accepted without substantive changes; AI pass is not a substitute |
| Teacher time | Actual review and editing time per approved question, including inspection of shortfall reports and failure diagnostics |
| Effective supply | Approved independent questions divided by requested slots, alongside coverage, variant counts, rejections, and unmet slots |
| Edit fulfillment | Whether requested changes and invariants are both satisfied |
| Consumption and cost | Initially, recorded LLM tokens divided by approved independent questions, with coverage, exclusions, and latency; add monetary estimates only when usage/pricing coverage permits. No accepted independent questions means the ratio is undefined |

Proposed pilot targets are at least a halving of out-of-scope and unintended repetition rates, approximately one quarter less teacher review time, no regression in numerical correctness, effective supply meeting a minimum agreed per LO before evaluation, and recorded LLM usage/latency within predefined limits with sufficient reporting coverage. Monetary budget comparisons require the later pricing capability. Minimum supply must reflect material capacity and be set before inspecting experiment results; rejecting most requests and returning one question cannot automatically count as success. These are proposed acceptance targets, not validated gains. Expand the sample if the baseline has too few relevant failures; zero or one error cannot support a meaningful percentage conclusion.

If B meets the targets and C1 adds no improvement, adopt B and remove planning or loops without demonstrated benefit. If C2 does not outperform C1, retain deterministic routing. If checkers frequently block valid questions, improve the criteria and evidence first. If generation repeatedly lacks knowledge, inspect material processing and scope policy. This proposal can be falsified by the experiment.

## Open-Source Research and Learning Path

This research only cloned and read source code. It did not install dependencies for these repositories or execute their notebooks.

| Project | Local directory | Pinned commit | Mechanisms informing this proposal |
| --- | --- | --- | --- |
| [LangGraph](https://github.com/langchain-ai/langgraph) | `/Users/fanhaocheng/tlef/research-langgraph` | `9a0394d88b2211f299dcd69df92db3480c69ee61` | Conditional routing, state, checkpoints, and bounded feedback loops |
| [DSPy](https://github.com/stanfordnlp/dspy) | `/Users/fanhaocheng/tlef/research-dspy` | `ba3f9198efe5d125c7c1a2b40b1f1e6166209bd2` | Feedback attributed to individual modules, prompt optimization, and separate validation and testing |
| [Promptfoo](https://github.com/promptfoo/promptfoo) | `/Users/fanhaocheng/tlef/research-promptfoo` | `c4863c94b4d932ba3ede9997723df9c5b72b6218` | Wrapping an existing API flow, configuring controlled comparisons, and producing inspectable results |

Suggested learning order:

1. Read FinanceBot's `runTrackedGenerationPipeline`, `retrieveChunks`, `GENERATOR_PROMPT`, and `REVIEWER_PROMPT`. Map the information that each model call actually receives. Then read historical Experiment 26 to understand why more model calls do not necessarily provide more information.
2. Read [LangGraph's Self-RAG example](https://github.com/langchain-ai/langgraph/blob/9a0394d88b2211f299dcd69df92db3480c69ee61/examples/rag/langgraph_self_rag.ipynb) to learn that retrieval relevance, generation grounding, and task fulfillment are separate judgments. The example directory is archived; use the [current JavaScript documentation](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph) for new implementation. Do not copy the old example's direct retries or loops without business budgets unchanged.
3. Read [Promptfoo's full RAG example](https://github.com/promptfoo/promptfoo/tree/c4863c94b4d932ba3ede9997723df9c5b72b6218/examples/eval-rag-full) and [TypeScript provider](https://github.com/promptfoo/promptfoo/blob/c4863c94b4d932ba3ede9997723df9c5b72b6218/examples/provider-custom/typescript/customProvider.ts). Learn to run different implementations against the same inputs and compare them; FinanceBot still needs its own teaching evaluation criteria.
4. Finally, read `metric_with_feedback` in the [DSPy enterprise task example](https://github.com/stanfordnlp/dspy/blob/ba3f9198efe5d125c7c1a2b40b1f1e6166209bd2/docs/docs/tutorials/gepa_facilitysupportanalyzer/index.ipynb). Turn "poor quality" into a diagnosable reason. Once evidence and bank tools are stable, optimize prompts offline and revalidate the actual pipeline after exporting to TypeScript; do not assume results from a Python adapter automatically transfer.

Current DSPy also supports code optimization. This proposal considers only offline prompt optimization for ordinary modules, without letting an optimizer automatically change production business logic. Split final test data by material, LO, or question family; different numerical versions of the same question must not appear in both optimization and test sets.

[Anthropic's explanation of workflows and agents](https://www.anthropic.com/engineering/building-effective-agents) provides a reference for terminology and feedback loops. The specific course constraints, repetition definitions, exit conditions, and acceptance targets here are engineering proposals for FinanceBot; the open-source frameworks do not establish these business benefits.
