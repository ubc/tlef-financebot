/** One bounded, prospective real-provider pass after the v2 refusal fixes.
 * Complete source and Bank/version controls are saved BEFORE the first send.
 * No automatic repeat, adoption, teacher labels, or production mutations. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ObjectId } from 'mongodb';
import { env } from '../server/src/config/env';
import { connectMongo, closeMongo } from '../server/src/components/mongodb';
import { INDEX_SPECS, coursesCol, materialsCol, materialChunksCol, questionsCol, questionVersionsCol, regenerationCandidatesCol, authoringTaskPlansCol, losCol } from '../server/src/components/mongodb/collections';
import { addTheme, addLo } from '../server/src/services/courses.service';
import { assignMaterial } from '../server/src/services/materials.service';
import { createQuestion, transitionQuestion } from '../server/src/services/questions.service';
import { createQuestionGenerationRun, getContentRun } from '../server/src/services/content-runs.service';
import { regenerateQuestion, runTrackedGenerationPipeline, type GenerationInput } from '../server/src/services/generation.service';
import { getPlatformSettings } from '../server/src/services/admin.service';
import { stepModelsFrom, persistedModels, STEP_TEMPERATURE_DEFAULTS } from '../server/src/services/step-models';
import { initializeAuthoringCommitSupport } from '../server/src/services/authoring-commit.service';
import { AuthoringBudget, withAuthoringBudget } from '../server/src/services/authoring-budget.service';
import { withModelUsage, summarizeModelUsage, listModelCalls } from '../server/src/services/model-usage.service';
import { hashSourceChunks, getMaterialSourceReadiness } from '../server/src/services/source-readiness.service';
import { loadGenerationMemory } from '../server/src/services/generation-memory.service';

const argument = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const safeError = (error: unknown) => error instanceof Error ? { name: error.name, message: error.message.replace(/(?:Bearer\s+|api[-_ ]?key[=:]\s*)\S+/gi, '[redacted]').slice(0, 1000) } : { name: 'UnknownError', message: 'unknown-error' };

async function main(): Promise<void> {
  assert.equal(argument('--live'), 'once', 'Paid retest requires explicit --live once; this script never repeats itself.');
  const fixturePath = argument('--fixture'); const output = argument('--output'); assert.ok(fixturePath && output);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.mongodbUri).hostname));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.qdrantUrl).hostname));
  assert.match(env.mongodbDbName, /^financebot_quality_smoke_retest_[a-z0-9_-]+$/);
  assert.equal(env.embeddingsProvider, 'fastembed');
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as { courseId: string; database: string; sources: Array<{ materialId: string; pdfSha256: string; manifest: { sourceTextHash: string } }> };
  assert.equal(fixture.database, env.mongodbDbName);
  const resumePath = argument('--resume-controls');
  const previous = resumePath ? JSON.parse(await readFile(resumePath, 'utf8')) as {
    status: string; budget: { observedSends: number; estimatedInputTokens: number; reservedOutputTokens: number };
    controls: { courseId: string; models: unknown; startingBankHeads: Array<{ _id: string; currentVersionId: string }>; startingBankVersions: unknown[];
      cases: Array<{ name: string; loId: string }> };
  } : undefined;
  const maxSends = Number(argument('--max-sends') ?? (previous ? 40 - previous.budget.observedSends : 40));
  const maxEstimatedTokens = Number(argument('--max-estimated-tokens') ?? (previous ? 600000 - previous.budget.estimatedInputTokens - previous.budget.reservedOutputTokens : 600000));
  assert.ok(Number.isSafeInteger(maxSends) && maxSends > 0 && maxSends <= 40);
  assert.ok(Number.isSafeInteger(maxEstimatedTokens) && maxEstimatedTokens > 0 && maxEstimatedTokens <= 600000);
  if (previous) {
    assert.equal(previous.status, 'completed'); assert.equal(previous.controls.courseId, fixture.courseId);
    assert.ok(maxSends + previous.budget.observedSends <= 40, 'Continuation cannot reset the promised send cap.');
    assert.ok(maxEstimatedTokens + previous.budget.estimatedInputTokens + previous.budget.reservedOutputTokens <= 600000, 'Continuation cannot reset the promised estimated-token cap.');
  }
  await mkdir(path.dirname(output), { recursive: true });
  // Claim a NEW artifact path before writing any fixture records or spending.
  await writeFile(output, JSON.stringify({ status: 'preparing', createdAt: new Date().toISOString(), fixture: path.resolve(fixturePath), paidCalls: 0 }) + '\n', { flag: 'wx' });
  const db = await connectMongo(); const courseId = new ObjectId(fixture.courseId); const actor = `QUALITY-RETEST-OBSERVATIONS-${randomUUID()}`;
  const observations: Array<Record<string, unknown>> = []; let controls: Record<string, unknown> | undefined;
  const budget = new AuthoringBudget(`${courseId}:${actor}`, { maxSends, maxInputTokens: 24000, maxEstimatedTokens });
  let completed = false; let paidWorkStartedAt: number | undefined; let paidWorkFinishedAt: number | undefined;
  const save = async () => writeFile(output, JSON.stringify({ version: 2, status: completed ? 'completed' : 'in-progress',
    fixtureKind: 'Prospective public-PDF v2 observations; no teacher calibration; source-extraction cache absent.', controls, observations, budget: budget.snapshot(),
    paidWorkStartedAt: paidWorkStartedAt ? new Date(paidWorkStartedAt).toISOString() : null,
    paidWorkWallMs: paidWorkStartedAt ? (paidWorkFinishedAt ?? Date.now()) - paidWorkStartedAt : null,
    comparisonLimit: 'Earlier baseline runs are historical context only. This pass is not a paired quality experiment.',
    teacherAcceptance: null, controlProbes: { duplicateSafety: 'Covered by deterministic regression tests and independent candidate audit; no extra paid probe.', unsupportedSafety: 'Covered by deterministic regression tests and original-source audit; no extra paid probe.' } }, null, 2) + '\n');
  try {
    assert.equal((await initializeAuthoringCommitSupport()).available, true);
    for (const spec of INDEX_SPECS.filter(spec => ['authoringTaskPlans', 'questionPedagogicalFingerprints', 'regenerationCandidates'].includes(spec.collection))) await db.collection(spec.collection).createIndex(spec.keys, spec.options);
    const course = await coursesCol().findOne({ _id: courseId }); assert.ok(course?.ownerPuid.startsWith('QUALITY-RETEST-FIXTURE-'));
    assert.equal(await questionsCol().countDocuments({ courseId }), previous ? 1 : 0, 'A continuation must retain exactly the unchanged controlled seed.');
    const sources = await materialsCol().find({ courseId, deletedAt: { $exists: false } }).sort({ name: 1 }).toArray(); assert.equal(sources.length, 2);
    const sourceControls = [];
    for (const source of sources) {
      const frozen = fixture.sources.find(item => item.materialId === source._id.toHexString()); assert.ok(frozen);
      const chunks = await materialChunksCol().find({ courseId, materialId: source._id }).sort({ index: 1 }).toArray();
      assert.equal(hashSourceChunks(chunks), frozen.manifest.sourceTextHash); assert.ok((await getMaterialSourceReadiness(courseId, source._id)).ready);
      sourceControls.push({ material: source, pdfSha256: frozen.pdfSha256, chunks: chunks.map(chunk => ({ index: chunk.index, text: chunk.text, characterCount: chunk.characterCount })) });
    }
    const risk = sources.find(source => source.name.startsWith('Chapter 3:')); const hurdle = sources.find(source => source.name.startsWith('Chapter 4:')); assert.ok(risk && hurdle);
    const { thin, capm, seed } = await (async () => {
      if (previous) {
        const thinId = previous.controls.cases.find(trial => trial.name === 'thin-topic-bank-memory')?.loId;
        const capmId = previous.controls.cases.find(trial => trial.name === 'capm-decimals-notation')?.loId; assert.ok(thinId && capmId);
        const thin = await losCol().findOne({ _id: new ObjectId(thinId), courseId }); const capm = await losCol().findOne({ _id: new ObjectId(capmId), courseId }); assert.ok(thin && capm);
        const frozenHead = previous.controls.startingBankHeads[0]; assert.ok(frozenHead);
        const head = await questionsCol().findOne({ _id: new ObjectId(frozenHead._id), courseId }); assert.ok(head);
        assert.equal(head.currentVersionId.toHexString(), frozenHead.currentVersionId);
        const version = await questionVersionsCol().findOne({ _id: head.currentVersionId, questionId: head._id }); assert.ok(version);
        assert.equal(digest([version]), digest(previous.controls.startingBankVersions), 'The immutable seed content must remain identical.');
        return { thin, capm, seed: { questionId: head._id, version } };
      }
      const theme = await addTheme(courseId, { name: `Bounded v2 verification ${actor.slice(-8)}` });
      const thin = await addLo(courseId, theme._id, { name: 'Distinguish firm-specific and market risk and explain diversification.', kind: 'conceptual' });
      const capm = await addLo(courseId, theme._id, { name: 'Calculate the cost of equity using CAPM, preserving the source notation and units.', kind: 'calculation' });
      for (const [source, lo] of [[risk, thin], [hurdle, capm]] as const) await assignMaterial(source._id, [{ themeId: theme._id, loId: lo._id }], source.revision);
      const seed = await createQuestion({ courseId, themeIds: [theme._id], loIds: [thin._id], type: 'true-false', difficulty: 'easy', numericKind: 'conceptual',
        stem: 'Diversification can reduce firm-specific risk.', createdBy: actor,
        options: [{ key: 'A', text: 'True', role: 'correct', explanation: 'Combining investments can reduce firm-specific risk.' }, { key: 'B', text: 'False', role: 'common-misconception', explanation: 'Firm-specific risk can be diversified; market risk remains.' }],
        agentDecision: { decision: 'pass', reasoning: 'Controlled starting-bank fixture, not a teacher or model evaluation label.', roleAssessment: 'True is correct; False is a common misconception.' } });
      return { thin, capm, seed };
    })();
    for (const sourceControl of sourceControls) {
      const current = await materialsCol().findOne({ _id: sourceControl.material._id, courseId }); assert.ok(current);
      sourceControl.material = current;
    }
    const settings = await getPlatformSettings(); const models = stepModelsFrom(settings);
    if (previous) assert.equal(digest(models), digest(previous.controls.models), 'Do not silently change models or configured options between continuation passes.');
    const startingHeads = await questionsCol().find({ courseId, state: { $ne: 'archived' } }).sort({ _id: 1 }).toArray();
    const startingVersions = await questionVersionsCol().find({ _id: { $in: startingHeads.map(head => head.currentVersionId) } }).sort({ _id: 1 }).toArray();
    const codeFiles = ['server/src/services/generation.service.ts', 'server/src/services/generation-quality.service.ts', 'server/src/services/generation-evidence.service.ts',
      'server/src/services/generation-memory.service.ts', 'server/src/services/authoring-task-plan.service.ts', 'server/src/services/numeric-input-display.service.ts',
      'server/src/services/generation-citation-spans.ts', 'server/src/services/parameter-display.ts', 'server/src/components/genai/llm/index.ts',
      'server/src/components/genai/llm/authoring-budget.ts', 'server/src/components/genai/llm/model-call.ts', 'server/src/types/generation-quality.ts'];
    const codeIdentities = await Promise.all(codeFiles.map(async file => {
      const bytes = await readFile(file); const snapshot = `${output}.code/${file}`; await mkdir(path.dirname(snapshot), { recursive: true }); await writeFile(snapshot, bytes, { flag: 'wx' });
      return { file, sha256: createHash('sha256').update(bytes).digest('hex'), snapshot };
    }));
    const cases = [
      { name: 'thin-topic-bank-memory', lo: thin, material: risk, count: 3, difficulty: 'easy' as const, kind: 'conceptual' as const,
        maxSends: 13, prompt: 'Create independent learning tasks, not paraphrases or numerical variants. The Bank already tests that diversification reduces firm-specific risk. Stay within the source.' },
      { name: 'capm-decimals-notation', lo: capm, material: hurdle, count: 2, difficulty: 'easy' as const, kind: 'calculation' as const,
        maxSends: 9, prompt: 'Use decimal input variations and the notation used by the source. Distinguish beta from total volatility. Compute answers from explicit formulas.' },
      { name: 'outside-scope-and-hardness', lo: thin, material: risk, count: 1, difficulty: 'hard' as const, kind: 'conceptual' as const,
        maxSends: 5, prompt: 'Keep the reading short. Only use this learning objective and original source. Do not invent unsupported prerequisite concepts to make the question hard.' },
    ];
    const regenerationCases = [
      { intent: 'edit-existing' as const, maxSends: 4, prompt: 'Change firm-specific to company-specific. Preserve the True/False option order and keep True correct. Keep the stem short.' },
      { intent: 'create-variant' as const, maxSends: 4, prompt: 'Use a brief different investment context to test the same diversification proposition. Preserve the answer semantics.' },
      { intent: 'create-independent-task' as const, maxSends: 5, prompt: 'Create a different independent True/False learning task grounded in the risk chapter. Do not repeat the proposition that diversification reduces firm-specific risk.' },
    ];
    controls = { contextRecordedAt: new Date().toISOString(), contextTiming: 'frozen-before-first-provider-send', courseId, actor, models,
      provider: env.llmProvider, defaultTemperatures: STEP_TEMPERATURE_DEFAULTS, sourceControls, startingBankHeads: startingHeads, startingBankVersions: startingVersions,
      cases: cases.map(({ lo, material, ...trial }) => ({ ...trial, loId: lo._id, loName: lo.name, materialId: material._id })), regenerationCases,
      codeIdentities, limits: budget.snapshot().limits, policy: 'grounded-memory-v2', repetitions: 1,
      ...(previous ? { continuation: { previousObservations: path.resolve(resumePath!), previousBudget: previous.budget, combinedMaxSends: 40, combinedMaxEstimatedTokens: 600000 } } : {}),
      isolation: 'Created heads archived after each public case. Starting Bank version unchanged. No regeneration candidates adopted.',
      scope: 'Local services with actual Mongo transaction persistence, original PDFs and configured provider. Not authenticated browser acceptance.' };
    controls.controlsHash = digest(controls); await save();
    paidWorkStartedAt = Date.now();
    await withAuthoringBudget(budget, async () => {
      for (const trial of cases) {
        const caseBudget = new AuthoringBudget(`${courseId}:${trial.name}`, { maxSends: trial.maxSends, maxInputTokens: 24000 });
        const input: GenerationInput = { courseId, loId: trial.lo._id, byPuid: actor, count: trial.count, type: 'mcq', difficulty: trial.difficulty, kind: trial.kind,
          prompt: trial.prompt, qualityPolicy: 'grounded-memory-v2', models, pinnedMaterialIds: [trial.material._id], groundingPinned: true };
        const memory = await loadGenerationMemory({ courseId, loIds: [trial.lo._id], includeCrossLo: true, query: trial.prompt });
        const run = await createQuestionGenerationRun({ ...input, type: 'mcq', requestedBy: actor, models: persistedModels(models) });
        const observation: Record<string, unknown> = { case: trial.name, requested: trial.count, policy: 'grounded-memory-v2', repetition: 1,
          preCall: { capturedAt: new Date().toISOString(), memory, memoryDigest: digest(memory), runId: run._id, input, limits: caseBudget.snapshot().limits }, review: null };
        observations.push(observation); await save(); const started = Date.now();
        try { await withAuthoringBudget(caseBudget, () => withModelUsage({ courseId: courseId.toHexString(), actor: { puid: actor }, runId: run._id.toHexString(), stage: 'generation' }, () => runTrackedGenerationPipeline(input, run._id))); }
        catch (error) { observation.error = safeError(error); }
        const snapshot = await getContentRun(run._id);
        const ids = snapshot?.kind === 'question-generation' ? snapshot.result?.createdQuestionIds ?? [] : [];
        const heads = await questionsCol().find({ courseId, _id: { $in: ids } }).toArray();
        const versions = await questionVersionsCol().find({ _id: { $in: heads.map(head => head.currentVersionId) } }).toArray();
        Object.assign(observation, { elapsedMs: Date.now() - started, run: snapshot, candidates: versions, budget: caseBudget.snapshot(),
          taskPlans: await authoringTaskPlansCol().find({ courseId, runId: run._id }).toArray(),
          usage: await summarizeModelUsage({ courseId: courseId.toHexString(), runId: run._id.toHexString() }),
          calls: await listModelCalls({ courseId: courseId.toHexString(), runId: run._id.toHexString(), limit: 100 }) });
        for (const head of heads) await transitionQuestion(head._id, 'archived', actor, head.currentVersionId);
        await save(); console.log(JSON.stringify({ case: trial.name, requested: trial.count, created: heads.length, status: snapshot?.status, sends: caseBudget.snapshot().observedSends }));
      }
      for (const trial of regenerationCases) {
        const caseBudget = new AuthoringBudget(`${courseId}:regeneration-${trial.intent}`, { maxSends: trial.maxSends, maxInputTokens: 24000 });
        const requestId = randomUUID(); const observation: Record<string, unknown> = { case: `regeneration-${trial.intent}`, requested: 1,
          policy: 'grounded-memory-v2', preCall: { capturedAt: new Date().toISOString(), requestId, originalVersionId: seed.version._id, intent: trial.intent,
            prompt: trial.prompt, limits: caseBudget.snapshot().limits, memory: await loadGenerationMemory({ courseId, loIds: [thin._id], includeCrossLo: true, query: trial.prompt }) }, review: null };
        observations.push(observation); await save(); const started = Date.now();
        try {
          await withAuthoringBudget(caseBudget, async () => {
            const result = await regenerateQuestion(seed.questionId, trial.prompt, actor, courseId, { qualityPolicy: 'grounded-memory-v2', requestId, expectedVersionId: seed.version._id, intent: trial.intent });
            const beforeReplay = budget.snapshot().observedSends;
            const replay = await regenerateQuestion(seed.questionId, trial.prompt, actor, courseId, { qualityPolicy: 'grounded-memory-v2', requestId, expectedVersionId: seed.version._id, intent: trial.intent });
            assert.equal(replay.candidateId, result.candidateId); assert.equal(budget.snapshot().observedSends, beforeReplay, 'UUID replay must not call the provider.');
            observation.result = result; observation.replayNoSends = true;
          });
        } catch (error) { observation.error = safeError(error); }
        const candidate = await regenerationCandidatesCol().findOne({ courseId, requestId, requestedBy: actor });
        Object.assign(observation, { elapsedMs: Date.now() - started, candidateRecord: candidate, budget: caseBudget.snapshot(),
          ...(candidate ? { usage: await summarizeModelUsage({ courseId: courseId.toHexString(), runId: candidate.usageRunId }),
            calls: await listModelCalls({ courseId: courseId.toHexString(), runId: candidate.usageRunId, limit: 100 }) } : {}) });
        await save(); console.log(JSON.stringify({ case: `regeneration-${trial.intent}`, status: candidate?.status ?? 'no-candidate', sends: caseBudget.snapshot().observedSends }));
      }
    });
    assert.equal((await questionsCol().findOne({ _id: seed.questionId }))?.currentVersionId.toHexString(), seed.version._id.toHexString());
    assert.equal(await regenerationCandidatesCol().countDocuments({ courseId, status: 'adopted' }), 0);
    completed = true; paidWorkFinishedAt = Date.now();
  } finally { await save(); await closeMongo(); }
}
void main().catch(error => { console.error(JSON.stringify(safeError(error))); process.exitCode = 1; });
