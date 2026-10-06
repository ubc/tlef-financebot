/**
 * Prompt A/B harness — the standardized runner behind the experiments in
 * docs/prompt-engineering-tests.md (experiments 20+ ran on ad-hoc scratchpad
 * copies of this loop; this is that loop, kept).
 *
 * An experiment is arms × cells × n:
 *   - an ARM varies exactly one thing (a chunk set, a prompt transform, or
 *     per-step model options);
 *   - a CELL is a fixture LO plus a target difficulty;
 *   - arms are interleaved inner-most, so a mid-run failure still leaves every
 *     completed cell covered in every arm.
 *
 * Discipline the runner enforces, learned the hard way (experiment 16's
 * postmortem): every record — full question, roles, reviewer reasoning — is
 * appended to the results JSONL BEFORE any aggregation, so nothing is ever
 * lost to a cleanup step. Observed model invocations and nullable provider
 * usage are captured independently of question acceptance or failure.
 *
 * Run an experiment: npx tsx scripts/prompt-ab/experiments/<name>.ts
 * (from the repo root; .env supplies the provider credentials).
 *
 * This harness measures the GENERATION pipeline (generator → deterministic
 * verifier → validator → reviewer, optionally with the Option-B reject
 * retry). It does not touch Mongo or Qdrant — grounding comes from committed
 * fixtures — so it runs with no services up. Anything needing serving,
 * mastery, or live retrieval is out of scope by design.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  GENERATOR_PROMPT,
  VALIDATOR_PROMPT,
  REVIEWER_PROMPT,
  REVIEWER_REJECT_FEEDBACK,
  verifyGeneratedNumerics,
} from '../../server/src/services/generation.service';
import { completeJson } from '../../server/src/components/genai/llm';
import { withModelCallContext, withModelCallObserver, type ModelCallEvent } from '../../server/src/components/genai/llm/model-call';
import { aggregateHarnessUsage, createHarnessUsageTracker, formatRecordedTokens, type HarnessUsageSummary } from './usage-summary';
import type { ReasoningEffort } from '../../server/src/types/domain';

/** The generator's JSON shape, as the production verifier types it. */
type Generated = Parameters<typeof verifyGeneratedNumerics>[0];

export interface FixtureChunk { text: string; supporting?: boolean }
export interface Fixture { lo: string; chunks: FixtureChunk[] }

export interface StepOptions {
  model?: string;
  reasoningEffort?: ReasoningEffort;
  temperature?: number;
}

export interface Arm {
  label: string;
  /** Overrides the cell fixture's chunks (e.g. a widened or relabeled set). */
  chunks?: FixtureChunk[];
  /** Applied to the built generator prompt — strip or append a block to make
   * this arm differ. Prefer exact-match replace of an exported constant. */
  transformPrompt?: (prompt: string) => string;
  /** Runs BEFORE generation and may call the LLM (a planning pass, e.g.
   * move-first two-pass). Its `appendix` is appended to the built generator
   * prompt; its `planned` value is recorded on the run record. Component LLM
   * calls inherit the experiment observer automatically. The legacy `track`
   * callback remains accepted but does not double-count observed calls. */
  prePass?: (ctx: {
    lo: string;
    difficulty?: string;
    chunks: FixtureChunk[];
    i: number;
    model: string;
    track: (u: { promptTokens?: number; completionTokens?: number }) => void;
  }) => Promise<{ appendix: string; planned?: unknown }>;
  /** Per-question assigned hardness move, passed through GENERATOR_PROMPT's
   * real assignedMove param (the pipeline's own insertion point) — use this,
   * not prePass, when probing the shipped assignment mechanism. */
  assignedMoveFor?: (i: number) => string | undefined;
  generator?: StepOptions;
  validator?: StepOptions;
  reviewer?: StepOptions;
}

export interface Cell {
  fixture: string;
  difficulty?: 'easy' | 'medium' | 'hard';
}

export interface Experiment {
  /** Slug used in the results filename, e.g. 'exp24-option-b-retry'. */
  name: string;
  /** Pre-registered BEFORE the run; recorded into the results file. */
  hypothesis: string;
  arms: Arm[];
  cells: Cell[];
  n: number;
  /** 'retry-on-reject' mirrors production Option B: one regeneration with the
   * reviewer's critique quoted back, then the replacement is judged exactly
   * as the original was. */
  mode: 'single-shot' | 'retry-on-reject';
  /** Defaults for every step unless an arm overrides: model gpt-5.6-luna,
   * generator+reviewer at effort high, validator at completeJson defaults —
   * the conditions of experiments 20-23. */
  defaults?: { model?: string };
}

/** Per-question record appended to the JSONL. Kept flat and stringify-safe. */
export interface RunRecord {
  arm: string;
  fixture: string;
  target?: string;
  i: number;
  /** A prePass planner's output (e.g. the chosen move), when the arm has one. */
  planned?: unknown;
  selfLabel?: string;
  hardnessMove?: string;
  numericKind?: string;
  helperSteps?: number;
  derivedCount?: number;
  stem?: string;
  options?: unknown;
  paramSlots?: unknown;
  derivedValues?: unknown;
  verificationFailure?: string | null;
  roleAssessment?: string;
  moveAssessment?: string;
  decision?: string;
  reasoning?: string;
  difficultyComplaint?: boolean;
  retryFired?: boolean;
  retry?: Omit<RunRecord, 'arm' | 'fixture' | 'target' | 'i' | 'retryFired' | 'retry'>;
  usage?: HarnessUsageSummary;
  modelCalls?: ModelCallEvent[];
  pipelineElapsedMs?: number;
  error?: string;
}

const DEFAULT_MODEL = 'gpt-5.6-luna';

export function loadFixtures(): Record<string, Fixture> {
  const raw = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures.json'), 'utf-8'),
  ) as Record<string, Fixture | string>;
  const fixtures: Record<string, Fixture> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'string') fixtures[key] = value;
  }
  return fixtures;
}

/** Heuristic flag over the reviewer's reasoning; the tally counts it, the
 * human reads the reasoning. Matches the phrasings observed across
 * experiments 14-23. */
function hasDifficultyComplaint(reasoning: string): boolean {
  return /relabel|overstated|too high|too easy|better calibrated|miscalibrat|one-step substitution|not (a )?hard/i
    .test(reasoning);
}

function helperStepCount(generated: Generated): { helpers: number; derived: number } {
  const derived = generated.derivedValues ?? [];
  const optionNames = new Set(
    (generated.options ?? []).flatMap((o) =>
      [...String(o.text).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1])),
  );
  return {
    helpers: derived.filter((d) => !optionNames.has(d.name)).length,
    derived: derived.length,
  };
}

async function judgeOnce(args: {
  lo: string;
  chunks: FixtureChunk[];
  generated: Generated;
  arm: Arm;
  model: string;
  assignedMove?: string;
  item: number;
  candidateAttempt: number;
}): Promise<Omit<RunRecord, 'arm' | 'fixture' | 'target' | 'i'>> {
  const { lo, chunks, generated, arm, model, assignedMove, item, candidateAttempt } = args;
  const verification = verifyGeneratedNumerics(generated);
  const validator = await completeJson<{ roleAssessment: string; moveAssessment?: string }>(
    VALIDATOR_PROMPT({
      loName: lo, question: generated, chunks,
      ...(assignedMove ? { assignedMove } : {}),
    }),
    { model, ...arm.validator, usageContext: { stage: 'validator', item, candidateAttempt } },
  );
  const reviewer = await completeJson<{ decision: string; reasoning: string }>(
    REVIEWER_PROMPT({
      loName: lo,
      question: generated,
      chunks,
      ...(verification.failure ? { verificationFailure: verification.failure } : {}),
      ...(!verification.failure && generated.numericKind === 'numeric' ? { verificationProven: true } : {}),
      roleAssessment: validator.roleAssessment,
      ...(validator.moveAssessment ? { moveAssessment: validator.moveAssessment } : {}),
    }),
    { model, reasoningEffort: 'high', ...arm.reviewer, usageContext: { stage: 'reviewer', item, candidateAttempt } },
  );
  const { helpers, derived } = helperStepCount(generated);
  return {
    selfLabel: generated.difficulty,
    hardnessMove: generated.hardnessMove,
    numericKind: generated.numericKind,
    helperSteps: helpers,
    derivedCount: derived,
    stem: generated.stem,
    options: generated.options,
    paramSlots: generated.paramSlots,
    derivedValues: generated.derivedValues,
    verificationFailure: verification.failure ?? null,
    roleAssessment: validator.roleAssessment,
    ...(validator.moveAssessment ? { moveAssessment: validator.moveAssessment } : {}),
    decision: reviewer.decision,
    reasoning: reviewer.reasoning,
    difficultyComplaint: hasDifficultyComplaint(String(reviewer.reasoning ?? '')),
  };
}

export async function runExperiment(spec: Experiment): Promise<string> {
  const fixtures = loadFixtures();
  const outPath = path.join(
    __dirname, 'results',
    `${spec.name}-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`,
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ meta: spec.name, hypothesis: spec.hypothesis, mode: spec.mode, n: spec.n,
    usageMeasurementVersion: 1, usageScope: 'observed-llm-sdk-invocations',
    usageExclusions: ['unobserved SDK retries', 'embeddings', 'parsing', 'infrastructure'],
    teacherLabels: 'not collected',
    settings: { defaults: spec.defaults, cells: spec.cells, arms: spec.arms.map(arm => ({ label: arm.label,
      generator: arm.generator, validator: arm.validator, reviewer: arm.reviewer, prePass: !!arm.prePass })) },
    startedAt: new Date().toISOString() }) + '\n');
  const model = spec.defaults?.model ?? DEFAULT_MODEL;
  const records: RunRecord[] = [];

  for (const cell of spec.cells) {
    const fixture = fixtures[cell.fixture];
    if (!fixture) throw new Error(`unknown fixture: ${cell.fixture}`);
    for (let i = 1; i <= spec.n; i += 1) {
      for (const arm of spec.arms) {
        const tracker = createHarnessUsageTracker();
        const startedAt = Date.now();
        // Historical prePass implementations pass this to onUsage. Calls are
        // now observed at the component boundary, including failed/no-usage
        // requests, so this compatibility callback must not add a second bill.
        const track = (): void => {};
        const base: RunRecord = { arm: arm.label, fixture: cell.fixture, target: cell.difficulty, i };
        const tag = `${arm.label}/${cell.fixture}/${cell.difficulty ?? 'any'}/#${i}`;
        await withModelCallObserver(tracker.observe, async () => {
        try {
          const chunks = arm.chunks ?? fixture.chunks;
          const assignedMove = arm.assignedMoveFor?.(i);
          let genPrompt = GENERATOR_PROMPT({
            type: 'mcq', loName: fixture.lo, difficulty: cell.difficulty, chunks,
            ...(assignedMove ? { assignedMove } : {}),
          });
          if (arm.transformPrompt) genPrompt = arm.transformPrompt(genPrompt);
          let planned: unknown;
          if (arm.prePass) {
            const pre = await withModelCallContext({ stage: 'prepass', item: i, candidateAttempt: 0 }, undefined, () => arm.prePass!({
              lo: fixture.lo, difficulty: cell.difficulty, chunks, i, model, track,
            }));
            genPrompt = `${genPrompt}\n\n${pre.appendix}`;
            planned = pre.planned;
          }
          const generated = await completeJson<Generated>(genPrompt, {
            model, reasoningEffort: 'high', ...arm.generator, usageContext: { stage: 'generator', item: i, candidateAttempt: 0 },
          });
          const first = await judgeOnce({ lo: fixture.lo, chunks, generated, arm, model, assignedMove, item: i, candidateAttempt: 0 });
          let record: RunRecord = { ...base, ...(planned !== undefined ? { planned } : {}), ...first };

          if (spec.mode === 'retry-on-reject' && String(first.decision).toLowerCase() === 'reject') {
            // Production Option B: regenerate ONCE with the critique quoted
            // back (generateValidQuestion appends the feedback below the full
            // prompt), judge the replacement the same way, keep both records.
            const retryPrompt = `${genPrompt}\n\n${REVIEWER_REJECT_FEEDBACK(String(first.reasoning ?? ''), generated)}`;
            const regenerated = await completeJson<Generated>(retryPrompt, {
              model, reasoningEffort: 'high', ...arm.generator, usageContext: { stage: 'generator', item: i, candidateAttempt: 1 },
            });
            const second = await judgeOnce({ lo: fixture.lo, chunks, generated: regenerated, arm, model, assignedMove, item: i, candidateAttempt: 1 });
            record = { ...record, retryFired: true, retry: second };
          }

          record.usage = tracker.summarize();
          record.modelCalls = tracker.snapshot();
          record.pipelineElapsedMs = Math.max(0, Date.now() - startedAt);
          records.push(record);
          fs.appendFileSync(outPath, JSON.stringify(record) + '\n');
          const retryNote = record.retryFired ? ` -> retry: ${record.retry?.decision}` : '';
          console.log(`${tag}: label=${record.selfLabel} kind=${record.numericKind} ` +
            `verify=${record.verificationFailure ? 'FAIL' : 'ok'} reviewer=${record.decision}` +
            `${record.difficultyComplaint ? ' [difficulty complaint]' : ''}${retryNote}`);
        } catch (err) {
          const record: RunRecord = { ...base, error: String(err), usage: tracker.summarize(), modelCalls: tracker.snapshot(),
            pipelineElapsedMs: Math.max(0, Date.now() - startedAt) };
          records.push(record);
          fs.appendFileSync(outPath, JSON.stringify(record) + '\n');
          console.log(`${tag}: ERROR ${String(err)}`);
        }
        });
      }
    }
  }

  printTally(spec, records);
  console.log(`\nresults -> ${outPath}`);
  return outPath;
}

/** Markdown tally, shaped for pasting into docs/prompt-engineering-tests.md. */
function printTally(spec: Experiment, records: RunRecord[]): void {
  console.log(`\n## Tally — ${spec.name}\n`);
  console.log('| arm | numeric/conceptual | label==target | proofs | pass/flag/reject | difficulty complaints | retries fired -> converted | recorded tokens in/out/total | usage status; reported/observed calls; unknown |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const arm of spec.arms) {
    const rows = records.filter((r) => r.arm === arm.label && !r.error);
    const routing = `${rows.filter((r) => r.numericKind === 'numeric').length}/${rows.filter((r) => r.numericKind === 'conceptual').length}`;
    const labelMatch = `${rows.filter((r) => r.selfLabel === r.target).length}/${rows.length}`;
    const proofs = `${rows.filter((r) => r.numericKind === 'numeric' && !r.verificationFailure).length}/${rows.filter((r) => r.numericKind === 'numeric').length}`;
    const dec = (d: string) => rows.filter((r) => String(r.decision).toLowerCase() === d).length;
    const complaints = rows.filter((r) => r.difficultyComplaint).length;
    const retries = rows.filter((r) => r.retryFired);
    const converted = retries.filter((r) => String(r.retry?.decision).toLowerCase() !== 'reject' && !r.retry?.difficultyComplaint).length;
    const usage = aggregateHarnessUsage(records.filter(record => record.arm === arm.label));
    console.log(`| ${arm.label} | ${routing} | ${labelMatch} | ${proofs} | ${dec('pass')}/${dec('flag')}/${dec('reject')} | ${complaints} | ${retries.length} -> ${converted} | ` +
      `${formatRecordedTokens(usage.inputTokens)}/${formatRecordedTokens(usage.outputTokens)}/${formatRecordedTokens(usage.totalTokens)} | ` +
      `${usage.status}; ${usage.reportedCalls}/${usage.observedCalls}; ${usage.unknownCalls} |`);
  }
  console.log('\nRecorded usage includes failed and rejected candidates. Partial totals are subtotals; missing counts are not zero. ' +
    'Observed SDK invocations do not establish physical retry counts or billed cost. Embeddings/parsing/infrastructure are excluded. ' +
    'Model review decisions are not teacher acceptance or independent-question supply.');
  const errors = records.filter((r) => r.error).length;
  if (errors > 0) console.log(`\nERRORS: ${errors} record(s) — read the JSONL.`);
}
