/** Prospective real-provider checks on public PDFs already indexed in a
 * disposable local database. Outputs are candidates, never teacher labels. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { env } from '../server/src/config/env';
import { connectMongo, closeMongo } from '../server/src/components/mongodb';
import { INDEX_SPECS, coursesCol, materialsCol, questionsCol, questionVersionsCol } from '../server/src/components/mongodb/collections';
import { addTheme, addLo } from '../server/src/services/courses.service';
import { assignMaterial } from '../server/src/services/materials.service';
import { createQuestion, transitionQuestion } from '../server/src/services/questions.service';
import { createQuestionGenerationRun, getContentRun } from '../server/src/services/content-runs.service';
import { regenerateQuestion, runTrackedGenerationPipeline, type GenerationInput } from '../server/src/services/generation.service';
import { getPlatformSettings } from '../server/src/services/admin.service';
import { stepModelsFrom, persistedModels } from '../server/src/services/step-models';
import { initializeAuthoringCommitSupport } from '../server/src/services/authoring-commit.service';
import { AuthoringBudget, withAuthoringBudget } from '../server/src/services/authoring-budget.service';
import { withModelUsage, summarizeModelUsage } from '../server/src/services/model-usage.service';

async function main(): Promise<void> {
  const argument = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
  const fixturePath = argument('--fixture'), output = argument('--output');
  const repetitions = Number(argument('--repetitions') ?? 2);
  const policySelection = argument('--policies') ?? 'both';
  assert.ok(['both', 'baseline', 'grounded-memory-v2'].includes(policySelection), 'Policies must be both, baseline or grounded-memory-v2.');
  assert.ok(Number.isInteger(repetitions) && repetitions >= 1 && repetitions <= 3, 'Repetitions must be 1–3.');
  assert.ok(fixturePath && output, 'Pass --fixture <indexed-corpus.json> --output <observations.json>.');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.mongodbUri).hostname));
  assert.match(env.mongodbDbName, /^financebot_quality_smoke_[a-z0-9_-]+$/);
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as { courseId: string; database: string };
  assert.equal(fixture.database, env.mongodbDbName);
  const db = await connectMongo();
  const courseId = new ObjectId(fixture.courseId), actor = `QUALITY-OBSERVATIONS-${randomUUID()}`;
  const observations: Array<Record<string, unknown>> = [];
  let controls: Record<string, unknown> | undefined;
  const budget = new AuthoringBudget(`${courseId}:${actor}`, { maxSends: 120, maxEstimatedTokens: 4_000_000 });
  try {
    assert.equal((await initializeAuthoringCommitSupport()).available, true, 'These acceptance checks require real transactional commits.');
    for (const spec of INDEX_SPECS.filter(spec => ['authoringTaskPlans', 'questionPedagogicalFingerprints', 'regenerationCandidates'].includes(spec.collection))) await db.collection(spec.collection).createIndex(spec.keys, spec.options);
    assert.ok(await coursesCol().findOne({ _id: courseId }));
    const sources = await materialsCol().find({ courseId, status: 'ready', deletedAt: { $exists: false } }).toArray();
    const risk = sources.find(source => source.name.startsWith('Chapter 3:'));
    const hurdle = sources.find(source => source.name.startsWith('Chapter 4:'));
    assert.ok(risk && hurdle, 'The public risk and hurdle-rate chapters must be indexed.');
    const theme = await addTheme(courseId, { name: `Quality verification ${actor.slice(-8)}` });
    const thin = await addLo(courseId, theme._id, { name: 'Distinguish firm-specific and market risk and explain diversification.', kind: 'conceptual' });
    const capm = await addLo(courseId, theme._id, { name: 'Calculate the cost of equity using CAPM, preserving the source notation and units.', kind: 'calculation' });
    for (const [source, lo] of [[risk, thin], [hurdle, capm]] as const) await assignMaterial(source._id, [...source.assignments, { themeId: theme._id, loId: lo._id }], source.revision ?? 0);
    const seed = await createQuestion({ courseId, themeIds: [theme._id], loIds: [thin._id], type: 'true-false', difficulty: 'easy', numericKind: 'conceptual',
      stem: 'Diversification can reduce firm-specific risk.', createdBy: actor,
      options: [{ key: 'A', text: 'True', role: 'correct', explanation: 'Combining investments can reduce firm-specific risk.' }, { key: 'B', text: 'False', role: 'common-misconception', explanation: 'Firm-specific risk can be diversified; market risk remains.' }],
      agentDecision: { decision: 'pass', reasoning: 'Controlled starting-bank fixture, not an AI evaluation label.', roleAssessment: 'True is correct; False is a common misconception.' } });
    const settings = await getPlatformSettings(); const models = stepModelsFrom(settings);
    const startingHeads = await questionsCol().find({ courseId, state: { $ne: 'archived' } }).sort({ _id: 1 }).toArray();
    const startingVersions = await questionVersionsCol().find({ _id: { $in: startingHeads.map(head => head.currentVersionId) } }).sort({ _id: 1 }).toArray();
    assert.equal(startingHeads.length, 1, 'A fresh comparison course must contain only the controlled starting question.');
    controls = { models, repetitions, policySelection, startingBankVersion: seed.version._id, startingBankQuestion: seed.questionId,
      contextRecordedAt: new Date().toISOString(), contextTiming: 'frozen-before-generation', startingBankHeads: startingHeads, startingBankVersions: startingVersions,
      sourceSnapshots: [risk, hurdle].map(source => ({ materialId: source._id, name: source.name, manifest: source.sourceManifest })),
      isolation: 'Each generated head is archived before the next arm; the starting question remains unchanged.',
      executionOrder: 'Arms alternate by case and repetition to avoid always running baseline first.',
      limits: budget.snapshot().limits };
    controls.controlsHash = createHash('sha256').update(JSON.stringify(controls)).digest('hex');
    const cases = [
      { name: 'thin-topic-bank-memory', lo: thin, material: risk, count: 3, difficulty: 'easy' as const, kind: 'conceptual' as const, prompt: 'Create independent learning tasks, not paraphrases or numerical variants. The Bank already tests that diversification reduces firm-specific risk. Stay within the source.' },
      { name: 'capm-decimals-notation', lo: capm, material: hurdle, count: 2, difficulty: 'easy' as const, kind: 'calculation' as const, prompt: 'Use decimal input variations and the notation used by the source. Distinguish beta from total volatility. Compute answers from explicit formulas.' },
      { name: 'outside-scope-and-hardness', lo: thin, material: risk, count: 1, difficulty: 'hard' as const, kind: 'conceptual' as const, prompt: 'Keep the reading short. Only use this learning objective and original source. Do not invent unsupported prerequisite concepts to make the question hard.' },
    ];
    await withAuthoringBudget(budget, async () => {
      for (let repetition = 1; repetition <= repetitions; repetition++) for (const [caseIndex, trial] of cases.entries()) for (const policy of policySelection === 'baseline' ? ['baseline'] as const : policySelection === 'grounded-memory-v2' ? ['grounded-memory-v2'] as const : (caseIndex + repetition) % 2 ? ['baseline', 'grounded-memory-v2'] as const : ['grounded-memory-v2', 'baseline'] as const) {
        const input: GenerationInput = { courseId, loId: trial.lo._id, byPuid: actor, count: trial.count, type: 'mcq', difficulty: trial.difficulty, kind: trial.kind, prompt: trial.prompt, qualityPolicy: policy, models, pinnedMaterialIds: [trial.material._id], groundingPinned: true };
        const run = await createQuestionGenerationRun({ ...input, requestedBy: actor, type: 'mcq', models: persistedModels(models) });
        const started = Date.now();
        await withModelUsage({ courseId: courseId.toHexString(), actor: { puid: actor }, runId: run._id.toHexString(), stage: 'generation' }, () => runTrackedGenerationPipeline(input, run._id));
        const snapshot = await getContentRun(run._id);
        const heads = await questionsCol().find({ courseId, _id: { $in: snapshot?.kind === 'question-generation' ? snapshot.result?.createdQuestionIds ?? [] : [] } }).toArray();
        const versions = await questionVersionsCol().find({ _id: { $in: heads.map(head => head.currentVersionId) } }).toArray();
        observations.push({ case: trial.name, repetition, policy, requested: trial.count, elapsedMs: Date.now() - started, run: snapshot, candidates: versions,
          usage: await summarizeModelUsage({ courseId: courseId.toHexString(), runId: run._id.toHexString() }), review: null });
        // Both arms start from the same Bank. Prior output remains in retained
        // run/version evidence, while archived heads are excluded from memory.
        for (const head of heads) await transitionQuestion(head._id, 'archived', actor, head.currentVersionId);
        await mkdir(dirname(output), { recursive: true });
        await writeFile(output, JSON.stringify({ version: 1, fixtureKind: 'public-PDF prospective model observations; no teacher calibration', controls, observations, budget: budget.snapshot() }, null, 2));
        console.log(JSON.stringify({ case: trial.name, repetition, policy, requested: trial.count, created: heads.length, status: snapshot?.status }));
      }
      for (const intent of ['edit-existing', 'create-variant', 'create-independent-task'] as const) {
        const prompt = intent === 'edit-existing' ? 'Change firm-specific to company-specific. Preserve the True/False option order and keep True correct. Keep the stem short.' : intent === 'create-variant' ? 'Use a brief different investment context to test the same diversification proposition. Preserve the answer semantics.' : 'Create a different independent True/False learning task grounded in the risk chapter. Do not repeat the proposition that diversification reduces firm-specific risk.';
        const requestId = randomUUID(), started = Date.now();
        const result = await regenerateQuestion(seed.questionId, prompt, actor, courseId, { qualityPolicy: 'grounded-memory-v2', requestId, expectedVersionId: seed.version._id, intent });
        const replay = await regenerateQuestion(seed.questionId, prompt, actor, courseId, { qualityPolicy: 'grounded-memory-v2', requestId, expectedVersionId: seed.version._id, intent });
        assert.equal(replay.candidateId, result.candidateId, 'HTTP retries must not spend again.');
        observations.push({ case: `regeneration-${intent}`, policy: 'grounded-memory-v2', requested: 1, elapsedMs: Date.now() - started, result, review: null });
      }
    });
  } finally {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify({ version: 1, fixtureKind: 'public-PDF prospective model observations; no teacher calibration', controls, observations, budget: budget.snapshot() }, null, 2));
    await closeMongo();
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
