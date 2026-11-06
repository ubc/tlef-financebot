import type { GenerationEvidencePacket } from '../../server/src/types/generation-evidence';
import type { GenerationMemorySnapshot } from '../../server/src/services/generation-memory.service';
import type { AuthoringTaskPlan } from '../../server/src/types/authoring-task';
import type { AuthoringRequirements } from '../../server/src/types/generation-quality';
import { caseControls, fixtureHash, hashControl, sha256, validateFixture, type FrozenFixture, type LabCase } from './protocol';

interface RetainedObservation {
  case: string;
  preCall: { memory: GenerationMemorySnapshot };
  run: { result: { quality: { evidence: GenerationEvidencePacket } } };
  taskPlans: AuthoringTaskPlan[];
}
export interface RetainedCorpus {
  status: string;
  controls: { sourceControls: FrozenFixture['sourceControls']; startingBankHeads: unknown[]; startingBankVersions: unknown[] };
  observations: RetainedObservation[];
}
interface PromptBuilder {
  instruction(packet: GenerationEvidencePacket, memory: GenerationMemorySnapshot, query: string, requirements: AuthoringRequirements): string;
  generator(params: { type: LabCase['request']['type']; loName: string; difficulty: LabCase['request']['difficulty']; prompt: string;
    chunks: Array<{ text: string; materialId: string; chunkIndex: number }>; kind: LabCase['request']['kind']; qualityContext: string }): string;
}

/** Historical inputs are tuning fixtures, never relabelled as held-out data. */
export function freezeRetainedCases(corpus: RetainedCorpus, raw: string, observationsPath: string, builder: PromptBuilder): FrozenFixture {
  if (corpus.status !== 'completed') throw new Error('quality-lab-retained-pass-not-complete');
  const thin = corpus.observations.find(item => item.case === 'thin-topic-bank-memory');
  const numeric = corpus.observations.find(item => item.case === 'capm-decimals-notation');
  if (!thin || !numeric) throw new Error('quality-lab-retained-cases-missing');
  const task = (observation: RetainedObservation, item: number) => {
    const descriptor = observation.taskPlans[0]?.slots.find(slot => slot.item === item)?.descriptor;
    if (!descriptor) throw new Error('quality-lab-retained-task-missing');
    return structuredClone(descriptor);
  };
  const definitions = [
    { id: 'thin-topic-independent', observation: thin, task: task(thin, 0), request: {
      loName: 'Distinguish firm-specific and market risk and explain diversification.', type: 'mcq' as const, kind: 'conceptual' as const, difficulty: 'easy' as const,
      instructions: 'Create one independent application task, not a paraphrase or a changed-number variant. The Bank already tests that diversification reduces firm-specific risk. Use only the source.' },
      description: 'Thin topic with a seeded recall question. Same vocabulary is not a duplicate verdict; compare the required inference and solution path.' },
    { id: 'capm-decimal-notation', observation: numeric, task: task(numeric, 0), request: {
      loName: 'Calculate the cost of equity using CAPM, preserving source notation and units.', type: 'mcq' as const, kind: 'calculation' as const, difficulty: 'easy' as const,
      instructions: 'Use decimal input variations and the source percentage notation. Distinguish beta from total volatility. Compute every answer from explicit formulas and display every input.' },
      description: 'Parameterized numerical task. Decimal domains, displayed premises, computed distractors and source percentage units are independently checked.' },
    { id: 'diagram-actor-ownership', observation: thin, task: { ...task(thin, 2),
      requiredInference: 'Distinguish firm and investor diversification actions only when the supplied diagram retains an unambiguous actor-to-action relationship.',
      solutionPath: ['Identify the actor in the original source.', 'Use only an unambiguous source-supported relation for that actor.', 'If a diagram relation is flattened or unclear, choose another supported task rather than transfer a different actor’s action.'],
      misconception: 'Attributing a firm strategy to an investor based on flattened diagram labels.' }, request: {
      loName: 'Distinguish firm-specific and market risk and explain diversification.', type: 'mcq' as const, kind: 'conceptual' as const, difficulty: 'medium' as const,
      instructions: 'Preserve the diagram’s firm/investor row ownership. Do not transfer firm actions to investors. If the original extracted relation is ambiguous, choose an unambiguous supported task and disclose the limitation in taskDescriptor.' },
      description: 'Known extraction-sensitive actor relation. A plausible general-finance answer is insufficient without original-source entailment.' },
    { id: 'thin-topic-hardness-scope', observation: thin, task: { ...task(thin, 0), targetDifficulty: 'hard' as const,
      requiredInference: 'Apply only reasoning supported by the thin risk/diversification source without inventing advanced prerequisite concepts to meet a hard label.' }, request: {
      loName: 'Distinguish firm-specific and market risk and explain diversification.', type: 'mcq' as const, kind: 'conceptual' as const, difficulty: 'hard' as const,
      instructions: 'Keep the reading short. Do not introduce utility maximization, portfolio optimization, factor models or other untaught prerequisites to make this hard. Report the actual earned difficulty if the source cannot support a hard independent task.' },
      description: 'Unsupported hardness pressure. An honest lower-difficulty or withheld slot remains in the requested denominator.' },
  ];
  const cases: LabCase[] = definitions.map(definition => {
    const packet = structuredClone(definition.observation.run.result.quality.evidence);
    const memory = structuredClone(definition.observation.preCall.memory);
    const requirements: AuthoringRequirements = { intent: 'create-independent-task', preserve: [], requestedDifficulty: definition.request.difficulty,
      requiredChanges: [definition.request.instructions], plannedTask: definition.task };
    const generatorPrompt = builder.generator({ ...definition.request, prompt: definition.request.instructions,
      chunks: packet.passages.map(passage => ({ materialId: passage.materialId, chunkIndex: passage.chunkIndex, text: passage.text })),
      qualityContext: builder.instruction(packet, memory, `${definition.request.loName}\n${definition.request.instructions}`, requirements) });
    const item: LabCase = { id: definition.id, split: 'tuning', description: definition.description, request: definition.request, packet, memory, requirements,
      generatorPrompt, generatorPromptSha256: sha256(generatorPrompt), controlsSha256: '', teacherAcceptance: null };
    item.controlsSha256 = hashControl(caseControls(item));
    return item;
  });
  const fixture: FrozenFixture = { version: 1, createdAt: new Date().toISOString(), origin: { observationsPath, observationsSha256: sha256(raw),
    purpose: 'Prospective same-input generator comparison using frozen public-PDF source/Bank controls from the October 14 tuning corpus.' },
    sourceControls: structuredClone(corpus.controls.sourceControls), bankHeads: structuredClone(corpus.controls.startingBankHeads),
    bankVersions: structuredClone(corpus.controls.startingBankVersions), cases, fixtureSha256: '', limitations: [
      'These sources and failure patterns were inspected during engineering; all four cases are tuning cases, not held-out evaluation.',
      'All model arms receive byte-identical generator prompts per case. A single repetition is a pilot and cannot establish a general model ranking.',
      'Frozen retrieved passages are not full pedagogical coverage of all 132 source pages. Full originals/chunks and PDF hashes are retained separately for audit.',
      'Teacher acceptance labels remain null. Model eligibility and deterministic numerical proof are distinct from teacher acceptance.',
      'No source, Bank, generated question, student record or global model configuration is written by the comparison runner.',
    ] };
  fixture.fixtureSha256 = fixtureHash(fixture); validateFixture(fixture); return fixture;
}
