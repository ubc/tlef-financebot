/**
 * Regression panel runner — "what is the current state of generation?"
 *
 * Enqueues every PANEL cell as a real generation run, lets the running dev
 * server's worker execute them (the real async path: retrieval, widening,
 * assignment, retries, persistence), reads the records back, and reports:
 *
 *   - per-cell verdicts, and roll-ups by difficulty / type / numericKind /
 *     family — usable = pass + flag;
 *   - HARD assertions on deterministic outcomes, which fail the run:
 *       * no usable question is an unproven numeric (pass/flag without a
 *         verification proof);
 *       * no true/false question is numeric;
 *   - SOFT metrics (reject rate etc.) compared against a committed baseline,
 *     reported as deltas — never as failures, because the reviewer's verdict
 *     wobble (~30% on borderline cases, exp 31) would make that cry wolf.
 *
 * Every created Draft stays in the review queue, labelled `panel:<stamp>`, so
 * the instructor can read the questions behind the numbers; --archive cleans
 * them up (audit-logged) instead.
 *
 * Needs the dev stack up (Mongo, Qdrant, the server's worker). Run from the
 * repo root:
 *   npx tsx scripts/prompt-ab/panel.ts [--save-baseline] [--archive] [--only=<substring>]
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ObjectId } from 'mongodb';
import { enqueueGenerationRun } from '../../server/src/services/generation.service';
import { connectMongo } from '../../server/src/components/mongodb';
import { startJobs, stopJobs } from '../../server/src/components/jobs';
import {
  auditCol, contentRunsCol, losCol, questionsCol, questionVersionsCol,
} from '../../server/src/components/mongodb/collections';
import { PANEL, PANEL_COURSE_ID, PANEL_REQUESTED_BY, type PanelCell } from './panel.config';

const args = new Set(process.argv.slice(2));
const only = [...args].find((a) => a.startsWith('--only='))?.slice('--only='.length);
const BASELINE = path.join(__dirname, 'panel-baseline.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const RESULTS = path.join(__dirname, 'results', `panel-${stamp}.jsonl`);
const REPORT = path.join(__dirname, 'results', `panel-${stamp}.md`);

interface QuestionRecord {
  cell: PanelCell;
  questionId: string;
  decision: string;
  suggestedDifficulty?: string;
  numericKind?: string;
  proven: boolean;
  verifierNote: boolean;
  optionBFired: boolean;
  chunks?: number;
}

interface Tally { n: number; pass: number; flag: number; reject: number; usable: number }
const emptyTally = (): Tally => ({ n: 0, pass: 0, flag: 0, reject: 0, usable: 0 });
const add = (t: Tally, decision: string) => {
  t.n += 1;
  if (decision === 'pass') { t.pass += 1; t.usable += 1; }
  else if (decision === 'flag') { t.flag += 1; t.usable += 1; }
  else t.reject += 1;
};
const pct = (a: number, b: number) => (b === 0 ? '—' : `${Math.round((100 * a) / b)}%`);

async function main() {
  await connectMongo();
  await startJobs();
  const courseId = new ObjectId(PANEL_COURSE_ID);
  const cells = PANEL.filter((cell) => !only || cell.lo.toLowerCase().includes(only.toLowerCase()));
  fs.mkdirSync(path.dirname(RESULTS), { recursive: true });
  fs.writeFileSync(RESULTS, JSON.stringify({ meta: 'panel', cells: cells.length, startedAt: new Date().toISOString() }) + '\n');

  // Enqueue everything up front; the worker runs them with its own concurrency.
  const runs: Array<{ cell: PanelCell; runId: ObjectId }> = [];
  for (const cell of cells) {
    const lo = await losCol().findOne({ courseId, name: cell.lo });
    if (!lo) { console.log(`SKIP unknown LO: ${cell.lo}`); continue; }
    const runId = await enqueueGenerationRun({
      courseId, loId: lo._id, count: cell.count, type: cell.type, difficulty: cell.difficulty, byPuid: PANEL_REQUESTED_BY,
    });
    runs.push({ cell, runId });
  }
  console.log(`enqueued ${runs.length} runs (${runs.reduce((s, r) => s + r.cell.count, 0)} questions); waiting for the worker…`);

  // Poll until every run is terminal.
  const terminal = new Set(['completed', 'partial', 'failed']);
  const deadline = Date.now() + 3 * 60 * 60 * 1000;
  const done = new Map<string, any>();
  while (done.size < runs.length && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 15000));
    for (const { runId } of runs) {
      const key = runId.toHexString();
      if (done.has(key)) continue;
      const run = await contentRunsCol().findOne({ _id: runId });
      if (run && run.kind === 'question-generation' && terminal.has(run.status)) done.set(key, run);
    }
    process.stdout.write(`\r  ${done.size}/${runs.length} runs finished`);
  }
  console.log('');

  // Read every question back.
  const records: QuestionRecord[] = [];
  const createdIds: ObjectId[] = [];
  for (const { cell, runId } of runs) {
    const run = done.get(runId.toHexString());
    if (!run) { console.log(`TIMEOUT ${cell.lo} ${cell.type} ${cell.difficulty}`); continue; }
    const events: string[] = (run.events ?? []).map((e: any) => e.message ?? '');
    // Option B is attributed per candidate: the event names the 1-based item
    // ("Reviewer rejected candidate 2 — retrying"), and createdQuestionIds is
    // in item order when no item failed. With failures the mapping is
    // ambiguous, so every question in that run inherits the run-level answer.
    const rejectedItems = new Set(
      events.map((m) => /rejected candidate (\d+)/.exec(m)?.[1]).filter(Boolean).map(Number),
    );
    const cleanMapping = (run.result?.failures ?? []).length === 0;
    const created: ObjectId[] = run.result?.createdQuestionIds ?? [];
    for (const [index, qid] of created.entries()) {
      const q = await questionsCol().findOne({ _id: qid });
      const v = q ? await questionVersionsCol().findOne({ _id: q.currentVersionId }) : null;
      if (!q || !v) continue;
      createdIds.push(qid);
      const reasoning = String(q.agentDecision?.reasoning ?? '');
      const rec: QuestionRecord = {
        cell, questionId: String(qid),
        decision: String(q.agentDecision?.decision ?? 'none').toLowerCase(),
        suggestedDifficulty: q.agentDecision?.suggestedDifficulty,
        numericKind: v.numericKind,
        proven: Boolean(v.verification),
        verifierNote: /Numeric verification FAILED/.test(reasoning),
        optionBFired: cleanMapping ? rejectedItems.has(index + 1) : rejectedItems.size > 0,
        chunks: run.grounding?.retrievedChunkCount,
      };
      records.push(rec);
      fs.appendFileSync(RESULTS, JSON.stringify({ ...rec, stem: v.stem?.slice(0, 300), reasoning: reasoning.slice(0, 600) }) + '\n');
    }
  }

  // ---- Roll-ups ------------------------------------------------------------
  const by = <K extends string>(key: (r: QuestionRecord) => K) => {
    const m = new Map<K, Tally>();
    for (const r of records) { const k = key(r); if (!m.has(k)) m.set(k, emptyTally()); add(m.get(k)!, r.decision); }
    return m;
  };
  const overall = emptyTally(); records.forEach((r) => add(overall, r.decision));
  const byDifficulty = by((r) => r.cell.difficulty);
  const byType = by((r) => r.cell.type);
  const byKind = by((r) => (r.numericKind === 'numeric' ? 'calculation' : 'conceptual'));
  const byFamily = by((r) => r.cell.family);
  const byCell = by((r) => `${r.cell.lo} | ${r.cell.type} | ${r.cell.difficulty}`);

  // ---- Hard assertions ------------------------------------------------------
  const failures: string[] = [];
  for (const r of records) {
    if (r.numericKind === 'numeric' && !r.proven && r.decision !== 'reject') {
      failures.push(`usable but UNPROVEN numeric: ${r.questionId} (${r.cell.lo}, ${r.cell.difficulty}, ${r.decision})`);
    }
    if (r.cell.type === 'true-false' && r.numericKind === 'numeric') {
      failures.push(`numeric TRUE/FALSE persisted: ${r.questionId} (${r.cell.lo}, ${r.cell.difficulty})`);
    }
  }

  // ---- Baseline -------------------------------------------------------------
  const snapshot = {
    at: new Date().toISOString(), n: records.length,
    overall, byDifficulty: Object.fromEntries(byDifficulty), byType: Object.fromEntries(byType),
    byKind: Object.fromEntries(byKind), byFamily: Object.fromEntries(byFamily), byCell: Object.fromEntries(byCell),
  };
  let baseline: typeof snapshot | null = null;
  if (fs.existsSync(BASELINE)) baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf-8'));
  if (args.has('--save-baseline')) fs.writeFileSync(BASELINE, JSON.stringify(snapshot, null, 2) + '\n');

  // ---- Report ---------------------------------------------------------------
  const row = (label: string, t: Tally, base?: Tally) => {
    const delta = base ? ` | usable Δ ${t.usable - base.usable >= 0 ? '+' : ''}${t.usable - base.usable}, rejects Δ ${t.reject - base.reject >= 0 ? '+' : ''}${t.reject - base.reject}` : '';
    return `| ${label} | ${t.n} | ${t.pass} | ${t.flag} | ${t.reject} | ${pct(t.usable, t.n)}${delta} |`;
  };
  const table = (title: string, m: Map<string, Tally>, baseM?: Record<string, Tally>) => [
    `### ${title}`, '', `| group | n | pass | flag | reject | usable${baseline ? ' | vs baseline' : ''} |`, '|---|---|---|---|---|---|' + (baseline ? '---|' : ''),
    ...[...m.entries()].map(([k, t]) => row(k, t, baseM?.[k])), '',
  ].join('\n');
  const optionB = records.filter((r) => r.optionBFired).length;
  const suggested = records.filter((r) => r.suggestedDifficulty).length;
  const report = [
    `# Regression panel — ${snapshot.at}`, '',
    `${records.length} questions across ${cells.length} cells. Overall: **${overall.pass} pass / ${overall.flag} flag / ${overall.reject} reject — ${pct(overall.usable, overall.n)} usable**.`,
    `Option B fired on ${optionB}; ${suggested} difficulty flags carry a suggested label; ${records.filter((r) => r.verifierNote).length} persisted with a verifier note.`, '',
    failures.length ? `## HARD ASSERTION FAILURES (${failures.length})\n\n${failures.map((f) => `- ${f}`).join('\n')}\n` : '## Hard assertions: all passed\n',
    table('By difficulty', byDifficulty, baseline?.byDifficulty),
    table('By type', byType, baseline?.byType),
    table('By kind (what the generator produced)', byKind, baseline?.byKind),
    table('By family', byFamily, baseline?.byFamily),
    table('By cell', byCell, baseline?.byCell),
    args.has('--save-baseline')
      ? `Saved as the baseline (${BASELINE}).${baseline ? ` Deltas above are against the previous baseline, ${baseline.at}.` : ''}`
      : baseline ? `Baseline: ${baseline.at} (${baseline.n} questions).` : 'No baseline on disk — run with --save-baseline to commit this as the reference.',
  ].join('\n');
  fs.writeFileSync(REPORT, report + '\n');
  console.log('\n' + report);
  console.log(`\nresults -> ${RESULTS}\nreport  -> ${REPORT}`);

  // ---- Label, and leave the questions for the instructor ---------------------
  // The panel's questions stay in the review queue by default (Saurav,
  // 2026-08-23): the numbers say WHERE to look, the questions say WHY, and
  // the instructor's judgment is the test of whether the reviewer's verdicts
  // and suggested labels are right. Each carries a `panel:<stamp>` label so
  // the run is filterable in the bank and archivable as a set later.
  if (createdIds.length) {
    await questionsCol().updateMany({ _id: { $in: createdIds } }, { $addToSet: { labels: `panel:${stamp}` } });
    console.log(`labelled ${createdIds.length} questions panel:${stamp}`);
  }
  if (args.has('--archive') && createdIds.length) {
    const now = new Date();
    const res = await questionsCol().updateMany({ _id: { $in: createdIds }, state: 'draft' }, { $set: { state: 'archived', updatedAt: now } });
    await auditCol().insertMany(createdIds.map((id) => ({
      actorPuid: PANEL_REQUESTED_BY, action: 'question.transition', targetType: 'question', targetId: id,
      courseId, detail: { from: 'draft', to: 'archived', note: `regression panel ${stamp}` }, createdAt: now,
    })) as never[]);
    console.log(`archived ${res.modifiedCount} panel drafts (--archive)`);
  } else if (createdIds.length) {
    console.log('panel questions left in the review queue (pass --archive to clean up automatically)');
  }
  await stopJobs();
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
