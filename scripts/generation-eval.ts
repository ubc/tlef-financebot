// Generation evaluation (spec 2026-11-12-generation-correctness-design.md §3).
//
// Measures what a change to question generation actually does: verdicts,
// waste, automatic repairs, parameter-solver adjustments, tokens and time.
// Local only. Makes REAL model calls when it enqueues (--yes); analysing
// existing runs (--runs) is free.
//
//   # dry run: print the plan and an estimate, enqueue nothing
//   npx tsx scripts/generation-eval.ts --course <courseId> --count 1 --difficulties easy,medium,hard
//   # enqueue for real (the running dev server's job worker executes the runs)
//   npx tsx scripts/generation-eval.ts --course <courseId> --count 1 --yes --label after-solver
//   # analyse runs that already happened (no model calls)
//   npx tsx scripts/generation-eval.ts --course <courseId> --runs <runId,runId,...> --label baseline
//
// Output: artifacts/generation-eval-<date>/<label>.json and .md
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ObjectId } from 'mongodb';
import { connectMongo, closeMongo } from '../server/src/components/mongodb';
import { coursesCol, losCol, modelCallReceiptsCol, questionsCol, questionVersionsCol } from '../server/src/components/mongodb/collections';
import { startJobs, stopJobs } from '../server/src/components/jobs';
import { getContentRun } from '../server/src/services/content-runs.service';
import { effectiveLoKind } from '../server/src/services/courses.service';
import { enqueueGenerationPlan, splitByKind, type PlanCell } from '../server/src/services/generation-plan.service';
import type { Difficulty } from '../server/src/types/domain';

/** From the 2026-11-12 Sol trial: ~9k tokens and ~35 s per question. */
const EST_TOKENS_PER_QUESTION = 9000;
const EST_SECONDS_PER_QUESTION = 35;
const POLL_MS = 10_000;
const TIMEOUT_MS = 45 * 60_000;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

interface QuestionRow {
  questionId: string;
  lo: string;
  difficulty: string;
  decision: string;
  numericFailure: boolean;
  repair?: { trigger: string; adopted: boolean; error?: string };
  solverRemoved: Array<{ slot: string; values: number[] }>;
  stem: string;
}

async function enqueue(courseId: ObjectId): Promise<ObjectId[]> {
  const count = Number(arg('count') ?? '1');
  const difficulties = (arg('difficulties') ?? 'easy,medium,hard').split(',') as Difficulty[];
  const loFilter = arg('los')?.split(',');
  const course = await coursesCol().findOne({ _id: courseId });
  if (!course) throw new Error('course not found');
  const los = (await losCol().find({ courseId, archivedAt: { $exists: false } }).sort({ order: 1 }).toArray())
    .filter((lo) => !loFilter || loFilter.includes(lo._id.toHexString()));
  const cells: PlanCell[] = los.flatMap((lo) => difficulties.flatMap((difficulty) =>
    splitByKind(effectiveLoKind(lo), difficulty, count).map((split) => ({ loId: lo._id, difficulty, kind: split.kind, count: split.count }))));
  const questions = cells.reduce((sum, cell) => sum + cell.count, 0);
  console.log(`Plan: ${los.length} LOs × ${difficulties.join('/')} × ${count} = ${questions} questions in ${cells.length} runs`);
  console.log(`Estimate: ~${Math.round((questions * EST_TOKENS_PER_QUESTION) / 1000)}k tokens; ~${Math.round((questions * EST_SECONDS_PER_QUESTION) / 60)} min of model time before concurrency`);
  if (!flag('yes')) {
    console.log('Dry run. Re-run with --yes to enqueue (real model calls).');
    return [];
  }
  await startJobs();
  try {
    const result = await enqueueGenerationPlan(courseId, cells, course.ownerPuid);
    for (const run of result.runs.filter((row) => row.error)) console.warn(`Not started: LO ${run.loId.toHexString()} ${run.difficulty}: ${run.error}`);
    return result.runs.flatMap((run) => (run.runId ? [run.runId] : []));
  } finally {
    await stopJobs();
  }
}

async function waitFor(runIds: ObjectId[]): Promise<void> {
  const started = Date.now();
  for (;;) {
    const runs = await Promise.all(runIds.map((id) => getContentRun(id)));
    const active = runs.filter((run) => run && ['queued', 'running'].includes(run.status)).length;
    process.stdout.write(`\r${runIds.length - active}/${runIds.length} runs finished`);
    if (active === 0) { process.stdout.write('\n'); return; }
    if (Date.now() - started > TIMEOUT_MS) throw new Error('timed out waiting for runs');
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

async function analyse(runIds: ObjectId[]) {
  const rows: QuestionRow[] = [];
  const failures: Array<{ runId: string; code: string; message: string }> = [];
  for (const runId of runIds) {
    const run = await getContentRun(runId);
    if (!run || run.kind !== 'question-generation') continue;
    for (const failure of run.result?.failures ?? []) failures.push({ runId: runId.toHexString(), code: failure.code, message: failure.message });
    const lo = await losCol().findOne({ _id: run.input.loId });
    for (const questionId of run.result?.createdQuestionIds ?? []) {
      const question = await questionsCol().findOne({ _id: questionId });
      if (!question) continue;
      const version = await questionVersionsCol().findOne({ _id: question.currentVersionId });
      const decision = question.agentDecision;
      rows.push({
        questionId: questionId.toHexString(),
        lo: lo?.name ?? run.input.loId.toHexString(),
        difficulty: version?.difficulty ?? '',
        decision: decision?.decision ?? 'none',
        numericFailure: /Numeric verification FAILED/.test(decision?.reasoning ?? ''),
        ...(decision?.repair ? { repair: { trigger: decision.repair.trigger, adopted: decision.repair.adopted, ...(decision.repair.error ? { error: decision.repair.error } : {}) } } : {}),
        solverRemoved: version?.verification?.parameterSolver?.removed ?? [],
        stem: (version?.stem ?? '').replace(/\s+/g, ' ').slice(0, 140),
      });
    }
  }
  const receipts = await modelCallReceiptsCol().find({ runId: { $in: runIds.map((id) => id.toHexString()) } }).toArray();
  const byStage = new Map<string, { calls: number; tokens: number; seconds: number[] }>();
  for (const receipt of receipts) {
    const entry = byStage.get(receipt.stage) ?? { calls: 0, tokens: 0, seconds: [] };
    entry.calls += 1;
    entry.tokens += receipt.usage?.totalTokens ?? 0;
    if (receipt.durationMs) entry.seconds.push(receipt.durationMs / 1000);
    byStage.set(receipt.stage, entry);
  }
  const saved = rows.length;
  const count = (predicate: (row: QuestionRow) => boolean) => rows.filter(predicate).length;
  const totalTokens = [...byStage.values()].reduce((sum, entry) => sum + entry.tokens, 0);
  const summary = {
    runs: runIds.length,
    saved,
    failedItems: failures.length,
    pass: count((row) => row.decision === 'pass'),
    flag: count((row) => row.decision === 'flag'),
    reject: count((row) => row.decision === 'reject'),
    numericFailures: count((row) => row.numericFailure),
    waste: count((row) => row.decision === 'reject' || row.numericFailure) + failures.length,
    repairsAttempted: count((row) => !!row.repair),
    repairsAdopted: count((row) => !!row.repair?.adopted),
    solverAdjusted: count((row) => row.solverRemoved.length > 0),
    tokensPerSavedQuestion: saved ? Math.round(totalTokens / saved) : 0,
    stages: Object.fromEntries([...byStage].map(([stage, entry]) => [stage, { calls: entry.calls, tokens: entry.tokens, medianSeconds: Math.round(median(entry.seconds) * 10) / 10 }])),
  };
  return { summary, rows, failures };
}

function markdown(label: string, result: Awaited<ReturnType<typeof analyse>>): string {
  const { summary, rows, failures } = result;
  const pct = (n: number) => (summary.saved ? `${Math.round((n / (summary.saved + summary.failedItems)) * 100)}%` : '—');
  return [
    `# Generation eval — ${label}`, '',
    `Runs ${summary.runs} · saved ${summary.saved} · failed items ${summary.failedItems}`, '',
    '| pass | flag | reject | numeric failures | waste | repairs (adopted/attempted) | solver adjusted | tokens / saved question |',
    '|---|---|---|---|---|---|---|---|',
    `| ${summary.pass} | ${summary.flag} | ${summary.reject} | ${summary.numericFailures} | ${summary.waste} (${pct(summary.waste)}) | ${summary.repairsAdopted}/${summary.repairsAttempted} | ${summary.solverAdjusted} | ${summary.tokensPerSavedQuestion} |`, '',
    '| stage | calls | tokens | median s |', '|---|---|---|---|',
    ...Object.entries(summary.stages).map(([stage, entry]) => `| ${stage} | ${entry.calls} | ${entry.tokens} | ${entry.medianSeconds} |`), '',
    '| decision | repair | solver | LO | stem |', '|---|---|---|---|---|',
    ...rows.map((row) => `| ${row.decision}${row.numericFailure ? ' (numeric)' : ''} | ${row.repair ? `${row.repair.trigger}${row.repair.adopted ? ' ✓' : ' ✗'}` : ''} | ${row.solverRemoved.map((r) => `${r.slot} ${r.values.join('/')}`).join('; ')} | ${row.lo.slice(0, 40)} | ${row.stem.replace(/\|/g, '/')} |`),
    ...(failures.length ? ['', '## Failed items', ...failures.map((f) => `- ${f.code}: ${f.message.slice(0, 200)}`)] : []),
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const courseArg = arg('course');
  if (!courseArg) throw new Error('--course <courseId> is required');
  const courseId = new ObjectId(courseArg);
  const label = arg('label') ?? `eval-${Date.now()}`;
  await connectMongo();
  try {
    const runIds = arg('runs') ? arg('runs')!.split(',').map((id) => new ObjectId(id)) : await enqueue(courseId);
    if (!runIds.length) return;
    if (!arg('runs')) await waitFor(runIds);
    const result = await analyse(runIds);
    const dir = join('artifacts', `generation-eval-${new Date().toISOString().slice(0, 10)}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${label}.json`), JSON.stringify({ label, courseId: courseArg, runIds: runIds.map(String), ...result }, null, 2));
    writeFileSync(join(dir, `${label}.md`), markdown(label, result));
    console.log(markdown(label, result).split('\n').slice(0, 12).join('\n'));
    console.log(`Wrote ${join(dir, `${label}.md`)}`);
  } finally {
    await closeMongo();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
