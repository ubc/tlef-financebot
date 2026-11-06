/** Four quality-only checks on existing retained candidates, never generation
 * or adoption. The parent keeps a conservative hard cap while each one-send
 * leaf explicitly exercises opt-in reported-usage settlement. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ObjectId } from 'mongodb';
import { env } from '../server/src/config/env';
import { connectMongo, closeMongo } from '../server/src/components/mongodb';
import { materialsCol, materialChunksCol, questionsCol, questionVersionsCol } from '../server/src/components/mongodb/collections';
import { assessGenerationQuality, renderGenerationQualityReviewPrompt } from '../server/src/services/generation-quality.service';
import { AuthoringBudget, withAuthoringBudget } from '../server/src/services/authoring-budget.service';
import { estimateAuthoringTokens } from '../server/src/components/genai/llm/authoring-budget';
import { loadGenerationMemory, withBatchGenerationMemory, selectGenerationMemory, checkGenerationMemory, type GenerationMemoryContent, type GenerationMemorySnapshot } from '../server/src/services/generation-memory.service';
import { hashSourceChunks, getMaterialSourceReadiness } from '../server/src/services/source-readiness.service';
import { withModelUsage, summarizeModelUsage, listModelCalls } from '../server/src/services/model-usage.service';
import { getPlatformSettings } from '../server/src/services/admin.service';
import { stepModelsFrom } from '../server/src/services/step-models';
import type { GenerationEvidencePacket } from '../server/src/types/generation-evidence';
import type { AuthoringRequirements } from '../server/src/types/generation-quality';
import type { PedagogicalTaskDescriptor } from '../server/src/types/authoring-task';
import type { Difficulty } from '../server/src/types/domain';

const argument = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Observation = { case: string; preCall: { input: { prompt?: string; difficulty?: Difficulty; loId: string } }; run: { _id: string; result: { quality: { evidence: GenerationEvidencePacket } } };
  taskPlans: Array<{ slots: Array<{ item: number; descriptor: PedagogicalTaskDescriptor; candidate?: GenerationMemoryContent }> }> };

async function main(): Promise<void> {
  assert.equal(argument('--live'), 'once', 'This explicitly paid, quality-only probe requires --live once.');
  const sourcePath = argument('--observations'); const output = argument('--output'); const preflightPath = argument('--preflight'); assert.ok(sourcePath && output && preflightPath);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.mongodbUri).hostname));
  assert.match(env.mongodbDbName, /^financebot_quality_smoke_retest_[a-z0-9_-]+$/);
  const recorded = JSON.parse(await readFile(sourcePath, 'utf8')) as { status: string; controls: { courseId: string; models: unknown; sourceControls: Array<{ material: { _id: string; sourceManifest: { sourceTextHash: string } } }>; startingBankVersions: unknown[] }; observations: Observation[] };
  assert.equal(recorded.status, 'completed');
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ status: 'preparing', paidCalls: 0 }) + '\n', { flag: 'wx' });
  const courseId = new ObjectId(recorded.controls.courseId); const actor = `QUALITY-REVIEW-PROBE-${randomUUID()}`;
  const rootBudget = new AuthoringBudget(`${courseId}:${actor}`, { maxSends: 4, maxEstimatedTokens: 120000, maxInputTokens: 24000 });
  const outcomes: Array<Record<string, unknown>> = []; let controls: Record<string, unknown> | undefined; let completed = false;
  const save = () => writeFile(output, JSON.stringify({ version: 1, status: completed ? 'completed' : 'in-progress', qualityOnly: true, sourceObservations: sourcePath,
    controls, outcomes, budget: rootBudget.snapshot(), teacherAcceptance: null, savedQuestions: 0, adoptedCandidates: 0,
    limit: 'No generator, validator or generic reviewer calls. Reuses retained outputs; eligibility is not a saved version or teacher acceptance. Leaf settlement does not loosen the conservative parent hard cap.' }, null, 2) + '\n');
  await connectMongo();
  try {
    const sourceControls = [];
    for (const frozen of recorded.controls.sourceControls) {
      const materialId = new ObjectId(frozen.material._id); const material = await materialsCol().findOne({ _id: materialId, courseId }); assert.ok(material);
      const chunks = await materialChunksCol().find({ courseId, materialId }).sort({ index: 1 }).toArray();
      assert.equal(hashSourceChunks(chunks), frozen.material.sourceManifest.sourceTextHash); assert.ok((await getMaterialSourceReadiness(courseId, materialId)).ready);
      sourceControls.push({ material, chunks: chunks.map(chunk => ({ index: chunk.index, text: chunk.text })) });
    }
    const heads = await questionsCol().find({ courseId, state: { $ne: 'archived' } }).sort({ _id: 1 }).toArray(); assert.equal(heads.length, 1);
    const versions = await questionVersionsCol().find({ _id: { $in: heads.map(head => head.currentVersionId) } }).sort({ _id: 1 }).toArray();
    assert.equal(hash(versions), hash(recorded.controls.startingBankVersions), 'Immutable Bank seed must remain unchanged.');
    const models = stepModelsFrom(await getPlatformSettings()); assert.equal(hash(models), hash(recorded.controls.models));
    const thin = recorded.observations.find(observation => observation.case === 'thin-topic-bank-memory'); const capm = recorded.observations.find(observation => observation.case === 'capm-decimals-notation'); assert.ok(thin && capm);
    const selected = [{ name: 'classification-positive', observation: thin, item: 0, negativeControl: false },
      { name: 'capm-percentage-positive', observation: capm, item: 0, negativeControl: false },
      { name: 'investor-firm-row-negative', observation: thin, item: 2, negativeControl: true },
      { name: 'capm-fraction-variant-negative', observation: capm, item: 1, negativeControl: true }];
    const firstNumeric = capm.taskPlans[0]!.slots.find(slot => slot.item === 0)?.candidate; assert.ok(firstNumeric);
    const probes: Array<{ name: string; candidate: GenerationMemoryContent; packet: GenerationEvidencePacket; memory: GenerationMemorySnapshot;
      requirements: AuthoringRequirements; item: number; negativeControl: boolean;
      preflight: { rawPromptBytes: number; streamingEnvelopeBytes: number; rawSendEstimate: number; conservativeEnvelopeEstimate: number; rawPromptSha256: string; envelopeSha256: string; actualTransport: string };
      originalObservation: { runId: string; item: number }; comparatorProvenance?: { id: string; source: string; runId: string; item: number; bankWrite: boolean } }> = [];
    for (const trial of selected) {
      const slot = trial.observation.taskPlans[0]!.slots.find(slot => slot.item === trial.item); assert.ok(slot?.candidate);
      const candidate = slot.candidate; const packet = trial.observation.run.result.quality.evidence;
      const initialMemory = await loadGenerationMemory({ courseId, loIds: [new ObjectId(trial.observation.preCall.input.loId)], includeCrossLo: true });
      const comparatorId = `batch:quality-probe:${capm.run._id}:0`;
      const memory = trial.name === 'capm-fraction-variant-negative' ? withBatchGenerationMemory(initialMemory, [{ id: comparatorId, content: firstNumeric }]) : initialMemory;
      const prompt = trial.observation.preCall.input.prompt;
      const requirements: AuthoringRequirements = { intent: 'create-independent-task', preserve: [], requestedDifficulty: trial.observation.preCall.input.difficulty,
        plannedTask: slot.descriptor, requiredChanges: [`Implement the planned inference: ${slot.descriptor.requiredInference}`, ...(prompt?.trim() ? [prompt.trim()] : []),
          ...(trial.observation === thin ? ['Preserve table/diagram actor rows; firm strategies must not be attributed to investors. Do not infer relations from flattened labels.'] : [])] };
      const query = `${candidate.stem} ${candidate.options.filter(option => option.role === 'correct').map(option => `${option.text} ${option.explanation}`).join(' ')}`;
      const selection = selectGenerationMemory(memory, { query }); const shown = new Set(selection.entries.map(entry => entry.id));
      const hints = checkGenerationMemory(candidate, memory).filter(match => match.kind === 'possible-variant' && shown.has(match.entryId)).map(match => match.entryId);
      const rendered = renderGenerationQualityReviewPrompt(packet, selection, candidate, hints, requirements);
      const envelope = JSON.stringify([{ role: 'user', content: rendered }]);
      const preflight = { rawPromptBytes: Buffer.byteLength(rendered), streamingEnvelopeBytes: Buffer.byteLength(envelope),
        rawSendEstimate: estimateAuthoringTokens(rendered), conservativeEnvelopeEstimate: estimateAuthoringTokens(envelope), rawPromptSha256: createHash('sha256').update(rendered).digest('hex'),
        envelopeSha256: createHash('sha256').update(envelope).digest('hex'), actualTransport: 'Non-streaming sendMessage; envelope is an additional conservative preflight bound.' };
      assert.ok(preflight.conservativeEnvelopeEstimate <= 24000, `Probe ${trial.name} does not fit the production input cap. Stop before all paid sends.`);
      probes.push({ name: trial.name, candidate, packet, memory, requirements, item: trial.item, preflight, negativeControl: trial.negativeControl,
        originalObservation: { runId: trial.observation.run._id, item: trial.item },
        ...(trial.name === 'capm-fraction-variant-negative' ? { comparatorProvenance: { id: comparatorId, source: 'explicit same-batch reference from an earlier retained candidate', runId: capm.run._id, item: 0, bankWrite: false } } : {}) });
    }
    const files = ['server/src/services/generation-quality.service.ts', 'server/src/services/generation-citation-spans.ts', 'server/src/services/generation-memory.service.ts',
      'server/src/components/genai/llm/authoring-budget.ts', 'server/src/components/genai/llm/index.ts', 'server/src/components/genai/llm/model-call.ts', 'server/src/types/generation-quality.ts', 'server/src/types/authoring-budget.ts'];
    const code = await Promise.all(files.map(async file => { const bytes = await readFile(file); const snapshot = `${output}.code/${file}`; await mkdir(path.dirname(snapshot), { recursive: true });
      await writeFile(snapshot, bytes, { flag: 'wx' }); return { file, snapshot, sha256: createHash('sha256').update(bytes).digest('hex') }; }));
    controls = { capturedAt: new Date().toISOString(), courseId, actor, sourceControls, bankHeads: heads, bankVersions: versions, models, code, probes,
      limits: rootBudget.snapshot().limits, parentAccounting: 'conservative-reservations-v1', leafAccounting: 'reported-usage-settlement-v1', perProbeMaxSends: 1,
      changedInput: 'Both thin-topic contexts add the explicit actor-row ownership requirement. CAPM variant-negative adds a retained first-numeric same-batch comparator. Other source/Bank/candidate content remains unchanged.',
      mutationScope: 'Only model call/session receipts; no source, question, task-plan, candidate adoption or student-record writes.' };
    controls.controlsHash = hash(controls); await writeFile(preflightPath, JSON.stringify({ providerCalls: 0, controls, allWithinProductionInputCap: true }, null, 2) + '\n', { flag: 'wx' }); await save();
    console.log(JSON.stringify({ preflight: true, probes: probes.map(probe => ({ name: probe.name, estimate: probe.preflight.conservativeEnvelopeEstimate })), rootMaxSends: 4, rootMaxEstimatedTokens: 120000 }));
    await withAuthoringBudget(rootBudget, async () => {
      for (const probe of probes) {
        const leaf = new AuthoringBudget(`${courseId}:${probe.name}`, { maxSends: 1, maxEstimatedTokens: 120000, maxInputTokens: 24000 }, undefined, { accounting: 'reported-usage-settlement-v1' });
        const runId = `quality-probe:${randomUUID()}`; const started = Date.now();
        const assessment = await withAuthoringBudget(leaf, () => withModelUsage({ courseId: courseId.toHexString(), actor: { puid: actor }, runId, stage: 'quality-review-probe' }, () =>
          assessGenerationQuality({ packet: probe.packet, memory: probe.memory, candidate: probe.candidate, requirements: probe.requirements, item: probe.item, step: models.reviewer, policy: 'grounded-memory-v2' })));
        const receipt = leaf.snapshot(); const calls = await listModelCalls({ courseId: courseId.toHexString(), runId, limit: 100 });
        const knownSucceeded = calls.items.length === 1 && calls.items[0]!.outcome === 'succeeded' && receipt.usageCompleteness === 'complete';
        if (knownSucceeded) { assert.equal(receipt.admissionTokens, receipt.reportedInputTokens! + receipt.reportedOutputTokens!); assert.equal(receipt.pendingSends, 0); assert.equal(receipt.settledSends, 1); }
        outcomes.push({ name: probe.name, item: probe.item, negativeControl: probe.negativeControl, elapsedMs: Date.now() - started, assessment, budget: receipt,
          usage: await summarizeModelUsage({ courseId: courseId.toHexString(), runId }), calls, settlementVerifiedForKnownSuccessfulCall: knownSucceeded, teacherAcceptance: null, saved: false, adopted: false });
        await save(); console.log(JSON.stringify({ probe: probe.name, status: assessment.status, source: assessment.sourceSupport, novelty: assessment.novelty,
          leafSends: receipt.observedSends, parentSends: rootBudget.snapshot().observedSends }));
      }
    });
    assert.equal(rootBudget.snapshot().accounting, 'conservative-reservations-v1'); assert.ok(rootBudget.snapshot().observedSends <= 4);
    assert.ok(rootBudget.snapshot().estimatedInputTokens + rootBudget.snapshot().reservedOutputTokens <= 120000); completed = true;
  } finally { await save(); await closeMongo(); }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'quality-probe-failed'); process.exitCode = 1; });
