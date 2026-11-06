/** Offline prompt admission reconstruction. Never sends to a model. Frozen
 * input/context is exact; changed or missing dependency snapshots are marked. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { GENERATOR_PROMPT, GENERATOR_V2_PROMPT, HARDNESS_MOVE_MENU } from '../server/src/services/generation.service';
import { generationQualityInstruction, authoringIntentInstruction } from '../server/src/services/generation-quality.service';
import { renderSourceCitationSpans } from '../server/src/services/generation-citation-spans';
import { estimateAuthoringTokens } from '../server/src/components/genai/llm/authoring-budget';
import type { GenerationEvidencePacket } from '../server/src/types/generation-evidence';
import type { GenerationMemorySnapshot } from '../server/src/services/generation-memory.service';
import type { AuthoringRequirements } from '../server/src/types/generation-quality';
import type { PedagogicalTaskDescriptor } from '../server/src/types/authoring-task';
import type { Difficulty } from '../server/src/types/domain';

const argument = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
type Observation = { case: string; preCall: { memory: GenerationMemorySnapshot; input: { prompt?: string; difficulty?: Difficulty; kind?: 'conceptual' | 'calculation' } };
  candidateRecord?: { prompt: string; requirements: AuthoringRequirements; evidence: GenerationEvidencePacket; memory: GenerationMemorySnapshot;
    original: { type: 'mcq' | 'true-false'; difficulty: Difficulty; stem: string } };
  taskPlans?: Array<{ slots: Array<{ item: number; descriptor: PedagogicalTaskDescriptor }> }>; run?: { result: { quality: { evidence: GenerationEvidencePacket } } } };

async function main(): Promise<void> {
  const input = argument('--observations'); const output = argument('--output'); assert.ok(input && output);
  const recorded = JSON.parse(await readFile(input, 'utf8')) as { controls: { codeIdentities: Array<{ file: string; sha256: string }>; cases: Array<{ name: string; loName: string }> }; observations: Observation[] };
  const dependencies = await Promise.all(recorded.controls.codeIdentities.map(async dependency => {
    const current = hash(await readFile(dependency.file, 'utf8'));
    return { ...dependency, currentSha256: current, matchesRecorded: current === dependency.sha256 };
  }));
  const items = [];
  for (const observation of recorded.observations.filter(observation => observation.run)) {
    const evidence = observation.run!.result.quality.evidence; const memory = observation.preCall.memory;
    const trial = recorded.controls.cases.find(trial => trial.name === observation.case); assert.ok(trial);
    for (const plan of observation.taskPlans ?? []) for (const slot of plan.slots) {
      const prompt = observation.preCall.input.prompt;
      const requirements: AuthoringRequirements = { intent: 'create-independent-task', preserve: [], requestedDifficulty: observation.preCall.input.difficulty,
        plannedTask: slot.descriptor, requiredChanges: [`Implement the planned inference: ${slot.descriptor.requiredInference}`, ...(prompt?.trim() ? [prompt.trim()] : [])] };
      const context = generationQualityInstruction(evidence, memory, `${trial.loName}\n${prompt ?? ''}`, requirements);
      const chunks = evidence.passages.map(passage => ({ materialId: passage.materialId, chunkIndex: passage.chunkIndex, text: passage.text }));
      // Hard move assignment was randomized and not recorded before refusal.
      // Report the full known menu range rather than inventing an exact move.
      const moves = slot.descriptor.targetDifficulty === 'hard' ? HARDNESS_MOVE_MENU : [{ id: 'none', text: undefined }];
      const measure = (text: string) => ({ rawPromptBytes: Buffer.byteLength(text), streamingEnvelopeBytes: Buffer.byteLength(JSON.stringify([{ role: 'user', content: text }])),
        actualStreamingEstimate: estimateAuthoringTokens(JSON.stringify([{ role: 'user', content: text }])), rawPromptSha256: hash(text), streamingEnvelopeSha256: hash(JSON.stringify([{ role: 'user', content: text }])) });
      items.push({ case: observation.case, item: slot.item, sourcePassages: evidence.passages.length,
        sourceOriginalBytes: evidence.passages.reduce((sum, passage) => sum + Buffer.byteLength(passage.text), 0),
        sourceRenderingBytes: Buffer.byteLength(renderSourceCitationSpans(evidence)), authoringIntentBytes: Buffer.byteLength(authoringIntentInstruction(requirements)),
        completeQualityContextBytes: Buffer.byteLength(context),
        builds: moves.map(move => {
          const args = { type: 'mcq' as const, loName: trial.loName, difficulty: slot.descriptor.targetDifficulty, prompt, chunks, kind: observation.preCall.input.kind,
            qualityContext: context, assignedMove: move.text, secondaryLoNames: [] };
          return { assignedMove: move.id, v2: measure(GENERATOR_V2_PROMPT(args)), legacy: measure(GENERATOR_PROMPT(args)),
            v2BaseWithoutSourceContextBytes: Buffer.byteLength(GENERATOR_V2_PROMPT({ ...args, qualityContext: '' })) };
        }) });
    }
  }
  const regenerationItems = recorded.observations.filter(observation => observation.candidateRecord).map(observation => {
    const candidate = observation.candidateRecord!; const trial = recorded.controls.cases.find(trial => trial.name === 'thin-topic-bank-memory'); assert.ok(trial);
    const context = generationQualityInstruction(candidate.evidence, candidate.memory, `${trial.loName}\n${candidate.prompt}`, candidate.requirements);
    const prompt = GENERATOR_V2_PROMPT({ type: candidate.original.type, loName: trial.loName, prompt: candidate.prompt,
      difficulty: candidate.requirements.intent === 'edit-existing' ? undefined : candidate.original.difficulty,
      chunks: [], secondaryLoNames: [], qualityContext: context });
    return { case: observation.case, originalVersionPresent: true, completeQualityContextBytes: Buffer.byteLength(context),
      rawPromptBytes: Buffer.byteLength(prompt), streamingEnvelopeBytes: Buffer.byteLength(JSON.stringify([{ role: 'user', content: prompt }])),
      nonStreamingEstimate: estimateAuthoringTokens(prompt), streamingEstimate: estimateAuthoringTokens(JSON.stringify([{ role: 'user', content: prompt }])),
      rawPromptSha256: hash(prompt), streamingEnvelopeSha256: hash(JSON.stringify([{ role: 'user', content: prompt }])) };
  });
  const productionCapFits = items.every(item => item.builds.every(build => build.v2.actualStreamingEstimate <= 24000)) && regenerationItems.every(item => item.streamingEstimate <= 24000);
  const diagnosis = { version: 1, providerCalls: 0, dependencies, items, regenerationItems, productionCapFits,
    limitation: 'The pass saved code hashes, not source snapshots of every rendering dependency. Changed dependencies make this a current-code reconstruction, not an exact recovery of old refused prompt bytes. The public streaming estimator includes the serialized user-message envelope; hard move was unrecorded and is shown as the whole known menu.' };
  await writeFile(output, JSON.stringify(diagnosis, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ output, providerCalls: 0, productionCapFits, dependencyChanges: dependencies.filter(dependency => !dependency.matchesRecorded).map(dependency => dependency.file),
    public: items.map(item => ({ case: item.case, item: item.item, sourceRenderingBytes: item.sourceRenderingBytes, qualityContextBytes: item.completeQualityContextBytes,
      streamingEstimateMin: Math.min(...item.builds.map(build => build.v2.actualStreamingEstimate)), streamingEstimateMax: Math.max(...item.builds.map(build => build.v2.actualStreamingEstimate)) })), regenerationItems }));
  assert.ok(productionCapFits, 'Normal initial prompts do not fit the production24k input cap. Stop before paid sends.');
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'prompt-inspection-failed'); process.exitCode = 1; });
