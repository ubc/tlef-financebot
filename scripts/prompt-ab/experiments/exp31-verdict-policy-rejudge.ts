/**
 * Experiment 31 — verdict policy, judge-only: re-review persisted questions
 * under the old and new reviewer prompts. No generation; reviewer calls only.
 *
 * Policy under test (Saurav, 2026-08-22): reject is reserved for faults an
 * instructor cannot fix with one edit (wrong facts, wrong key, unservable,
 * tests a DIFFERENT objective); difficulty mismatch, role mislabels and
 * preset-not-followed are flags, with suggestedDifficulty on difficulty flags.
 *
 * Arms, same question, same grounding (reconstructed from the persisted
 * sourceRefs), same validator assessment (persisted roleAssessment):
 *   A "old-policy" — REVIEW_VERDICT_POLICY stripped from the built prompt
 *                    (also a same-day wobble baseline against the original
 *                    persisted verdicts).
 *   B "new-policy" — as shipped.
 *
 * Pre-registered:
 *   - B converts difficulty-only and preset-only rejects to flags, with a
 *     suggestedDifficulty present on every difficulty flag.
 *   - B keeps "tests a different LO", factual and key faults as rejects —
 *     ZERO reject→pass leakage relative to A on those.
 *   - A reproduces the persisted verdicts within documented wobble.
 *
 * Needs Mongo up (the dev stack). AB_LIMIT caps the question count.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ObjectId } from 'mongodb';
import {
  REVIEWER_PROMPT,
  REVIEW_VERDICT_POLICY,
  verifyGeneratedNumerics,
} from '../../../server/src/services/generation.service';
import { completeJson } from '../../../server/src/components/genai/llm';
import { connectMongo } from '../../../server/src/components/mongodb';
import { losCol, questionsCol, questionVersionsCol } from '../../../server/src/components/mongodb/collections';

const MODEL = 'gpt-5.6-luna';
const courseId = new ObjectId('6a7e36845981785988043588');
const OUT = path.join(__dirname, '..', 'results', `exp31-verdict-policy-rejudge-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);

type Verdict = { decision: string; reasoning: string; suggestedDifficulty?: string };

async function main() {
  await connectMongo();
  const limit = Number(process.env.AB_LIMIT ?? 0);
  const cursor = questionsCol().find({ courseId, agentDecision: { $exists: true } }).sort({ createdAt: -1 });
  const questions = limit > 0 ? await cursor.limit(limit).toArray() : await cursor.toArray();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ meta: 'exp31', questions: questions.length, startedAt: new Date().toISOString() }) + '\n');
  console.log(`re-judging ${questions.length} persisted questions under two policies`);

  const tally = { A: { pass: 0, flag: 0, reject: 0 }, B: { pass: 0, flag: 0, reject: 0 } } as Record<string, Record<string, number>>;
  const transitions: Record<string, number> = {};
  let difficultyFlagsWithSuggestion = 0, difficultyFlags = 0;
  let usage = { promptTokens: 0, completionTokens: 0 };
  const track = (u: { promptTokens?: number; completionTokens?: number }) => {
    usage.promptTokens += u.promptTokens ?? 0; usage.completionTokens += u.completionTokens ?? 0;
  };

  for (const q of questions) {
    const v = await questionVersionsCol().findOne({ _id: q.currentVersionId });
    const lo = q.loIds[0] ? await losCol().findOne({ _id: q.loIds[0] }) : null;
    if (!v || !lo) continue;
    const chunks = (v.sourceRefs ?? []).filter((r: any) => r.chunk).map((r: any) => ({ text: String(r.chunk) }));
    const question = {
      stem: v.stem, options: v.options, difficulty: v.difficulty, numericKind: v.numericKind,
      paramSlots: v.paramSlots, derivedValues: v.derivedValues,
    } as any;
    const numerics = verifyGeneratedNumerics(question);
    const common = {
      loName: lo.name, question, type: v.type, chunks,
      roleAssessment: q.agentDecision?.roleAssessment ?? '',
      ...(numerics.failure ? { verificationFailure: numerics.failure } : {}),
      ...(!numerics.failure && question.numericKind === 'numeric' ? { verificationProven: true } : {}),
    };
    const built = REVIEWER_PROMPT(common);
    if (!built.includes(REVIEW_VERDICT_POLICY)) throw new Error('policy block missing from built prompt');
    const promptA = built.replace(`${REVIEW_VERDICT_POLICY}\n`, '');
    const judge = (prompt: string) => completeJson<Verdict>(prompt, { model: MODEL, reasoningEffort: 'high', onUsage: track });
    const [a, b] = await Promise.all([judge(promptA), judge(built)]);
    const norm = (d: string) => String(d).toLowerCase();
    tally.A[norm(a.decision)] = (tally.A[norm(a.decision)] ?? 0) + 1;
    tally.B[norm(b.decision)] = (tally.B[norm(b.decision)] ?? 0) + 1;
    const key = `${norm(a.decision)}→${norm(b.decision)}`;
    transitions[key] = (transitions[key] ?? 0) + 1;
    const isDifficultyFlag = norm(b.decision) === 'flag' && /difficult|calibrat|label/i.test(b.reasoning);
    if (isDifficultyFlag) { difficultyFlags += 1; if (b.suggestedDifficulty) difficultyFlagsWithSuggestion += 1; }
    const record = {
      questionId: String(q._id), lo: lo.name, type: v.type, difficulty: v.difficulty, kind: v.numericKind,
      original: q.agentDecision?.decision,
      A: { decision: a.decision, reasoning: a.reasoning },
      B: { decision: b.decision, reasoning: b.reasoning, suggestedDifficulty: b.suggestedDifficulty ?? null },
    };
    fs.appendFileSync(OUT, JSON.stringify(record) + '\n');
    console.log(`${String(q._id).slice(-6)} ${lo.name.slice(0, 28).padEnd(28)} orig=${record.original} A=${norm(a.decision)} B=${norm(b.decision)}${b.suggestedDifficulty ? ` (→${b.suggestedDifficulty})` : ''}`);
  }

  console.log('\n## Tally — exp31');
  console.log('| arm | pass | flag | reject |\n|---|---|---|---|');
  for (const arm of ['A', 'B']) console.log(`| ${arm === 'A' ? 'old-policy' : 'new-policy'} | ${tally[arm].pass ?? 0} | ${tally[arm].flag ?? 0} | ${tally[arm].reject ?? 0} |`);
  console.log('\ntransitions A→B:', JSON.stringify(transitions));
  console.log(`difficulty flags in B: ${difficultyFlags}, with suggestedDifficulty: ${difficultyFlagsWithSuggestion}`);
  console.log(`tokens in/out: ${usage.promptTokens}/${usage.completionTokens}`);
  console.log('results ->', OUT);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
