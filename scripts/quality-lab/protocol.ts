import { createHash } from 'node:crypto';
import type { CompleteJsonOptions, ModelCallEvent, ModelSendAdmission } from '../../server/src/components/genai/llm';
import type { Difficulty, QuestionKind, QuestionType } from '../../server/src/types/domain';

// Frozen question-lab fixtures recorded retired v2 shapes. Only the source
// coordinates validateFixture checks are typed; the rest stays opaque.
type FrozenRecord = Record<string, unknown>;
interface FrozenSourcePacket extends FrozenRecord {
  passages: Array<{ id: string; materialId: string; chunkIndex: number; start: number; end: number; text: string }>;
  findings: Array<{ code: string }>;
}

export type LabEffort = 'low' | 'medium' | 'high';
export interface LabArm { id: string; model: 'gpt-6-luna' | 'gpt-6.1-sol'; effort: LabEffort; allowedActualModels: string[] }
export const MODEL_ARMS: readonly LabArm[] = [
  { id: 'luna-low', model: 'gpt-6-luna', effort: 'low', allowedActualModels: ['gpt-6-luna'] },
  { id: 'luna-medium', model: 'gpt-6-luna', effort: 'medium', allowedActualModels: ['gpt-6-luna'] },
  { id: 'luna-high', model: 'gpt-6-luna', effort: 'high', allowedActualModels: ['gpt-6-luna'] },
  { id: 'sol-medium', model: 'gpt-6.1-sol', effort: 'medium', allowedActualModels: ['gpt-6.1-sol'] },
  { id: 'sol-high', model: 'gpt-6.1-sol', effort: 'high', allowedActualModels: ['gpt-6.1-sol'] },
];
export interface LabCase {
  id: string;
  split: 'tuning' | 'held-out';
  description: string;
  request: { loName: string; type: QuestionType; kind: QuestionKind; difficulty: Difficulty; instructions: string };
  packet: FrozenSourcePacket;
  memory: FrozenRecord;
  requirements: FrozenRecord;
  generatorPrompt: string;
  generatorPromptSha256: string;
  controlsSha256: string;
  teacherAcceptance: null;
}
export interface FrozenFixture {
  version: 1;
  createdAt: string;
  origin: { observationsPath: string; observationsSha256: string; purpose: string };
  sourceControls: Array<{ material: { _id: string; name: string; [key: string]: unknown }; pdfSha256: string; chunks: Array<{ index: number; text: string; [key: string]: unknown }> }>;
  bankHeads: unknown[];
  bankVersions: unknown[];
  cases: LabCase[];
  fixtureSha256: string;
  limitations: string[];
}
export interface ScheduledCell { id: string; caseId: string; arm: LabArm; repetition: number; order: number }
export interface LabRequest {
  stage: string;
  prompt: string;
  model: string;
  effort: LabEffort;
  maxOutputTokens: number;
  /** Per-stage bound within the ledger's prospective global input ceiling. */
  maxInputTokens?: number;
  productionRequestedOutputCap?: number;
  allowedActualModels: string[];
  /** Limits the portable JSON helper's correction attempt without changing it. */
  maxSends: 1 | 2;
}
export interface CapturedAttempt {
  number: number;
  input: { prompt: string; systemPrompt: string | null; messages: Array<{ role: 'user'; content: string }>; options: Record<string, unknown>; provider: string; model: string; outputCap: number };
  inputSha256: string;
  rawVisibleText: string;
  events: ModelCallEvent[];
  dispatch: 'prepared' | 'started' | 'finished';
}
export interface CapturedCompletion<T = unknown> {
  version: 1;
  stage: string;
  request: LabRequest;
  startedAt: string;
  elapsedMs: number;
  attempts: CapturedAttempt[];
  status: 'succeeded' | 'failed';
  parsed: T | null;
  error: { name: string; message: string } | null;
  modelIdentityVerified: boolean;
  hiddenReasoning: 'not-captured';
  transport: 'toolkit-streamConversation-visible-content; JSON option is not strict native schema';
}
export type JsonCompletion = <T>(prompt: string, options?: CompleteJsonOptions) => Promise<T>;
export type CaptureSink = (snapshot: CapturedCompletion) => void | Promise<void>;

/** Canonical JSON hashes exclude key insertion order but never normalize text. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`;
  throw new Error('quality-lab-non-json-control');
}
export const sha256 = (text: string | Uint8Array): string => createHash('sha256').update(text).digest('hex');
export const hashControl = (value: unknown): string => sha256(canonicalJson(value));
export const caseControls = (value: LabCase): unknown => ({ request: value.request, packet: value.packet, memory: value.memory, requirements: value.requirements });
export function fixtureHash(fixture: Omit<FrozenFixture, 'fixtureSha256'> | FrozenFixture): string {
  const rest = { ...fixture } as Partial<FrozenFixture>; delete rest.fixtureSha256;
  return hashControl(rest);
}
export function validateFixture(fixture: FrozenFixture): void {
  if (fixture.version !== 1 || fixtureHash(fixture) !== fixture.fixtureSha256) throw new Error('quality-lab-fixture-hash-mismatch');
  if (!fixture.cases.length || new Set(fixture.cases.map(item => item.id)).size !== fixture.cases.length) throw new Error('quality-lab-invalid-cases');
  const sourceIds = new Set(fixture.sourceControls.map(source => source.material._id));
  if (sourceIds.size !== fixture.sourceControls.length) throw new Error('quality-lab-duplicate-material');
  const splits = new Map<string, string>();
  for (const item of fixture.cases) {
    if (item.teacherAcceptance !== null || item.controlsSha256 !== hashControl(caseControls(item)) || item.generatorPromptSha256 !== sha256(item.generatorPrompt)) throw new Error(`quality-lab-case-control-mismatch:${item.id}`);
    if (!item.packet.passages.length || item.packet.findings.some(finding => finding.code === 'source-text-damage')) throw new Error(`quality-lab-invalid-source-packet:${item.id}`);
    for (const passage of item.packet.passages) {
      const source = fixture.sourceControls.find(entry => entry.material._id === passage.materialId);
      const chunk = source?.chunks.find(entry => entry.index === passage.chunkIndex);
      if (!sourceIds.has(passage.materialId) || !chunk || chunk.text.slice(passage.start, passage.end) !== passage.text) throw new Error(`quality-lab-source-coordinate-mismatch:${item.id}:${passage.id}`);
      const previous = splits.get(passage.materialId);
      if (previous && previous !== item.split) throw new Error('quality-lab-tuning-heldout-source-overlap');
      splits.set(passage.materialId, item.split);
    }
  }
}
export function scheduleCells(fixture: FrozenFixture, repetitions: number, arms: readonly LabArm[] = MODEL_ARMS): ScheduledCell[] {
  validateFixture(fixture);
  if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 10) throw new Error('quality-lab-invalid-repetitions');
  if (!arms.length || new Set(arms.map(arm => arm.id)).size !== arms.length) throw new Error('quality-lab-invalid-arms');
  for (const arm of arms) {
    const known = MODEL_ARMS.find(value => value.id === arm.id);
    if (!known || known.model !== arm.model || known.effort !== arm.effort || !arm.allowedActualModels.length || arm.allowedActualModels.some(model => !model.trim())) throw new Error('quality-lab-unrecognized-model-arm');
  }
  const cells: ScheduledCell[] = [];
  for (let repetition = 1; repetition <= repetitions; repetition++) for (const [index, item] of fixture.cases.entries()) {
    for (let offset = 0; offset < arms.length; offset++) {
      const arm = arms[(offset + index + repetition - 1) % arms.length]!;
      cells.push({ id: `${item.id}--${arm.id}--r${repetition}`, caseId: item.id, arm: structuredClone(arm), repetition, order: cells.length });
    }
  }
  return cells;
}
/** The admitted native options must retain exact requested IDs and effort. */
export function assertRequestShape(request: LabRequest, admission: ModelSendAdmission): void {
  if (admission.model !== request.model || admission.options.model !== request.model) throw new Error('quality-lab-model-fallback');
  if (admission.options.reasoning_effort !== request.effort || 'temperature' in admission.options) throw new Error('quality-lab-reasoning-option-mismatch');
  if (admission.outputCap !== request.maxOutputTokens || admission.options.max_completion_tokens !== request.maxOutputTokens) throw new Error('quality-lab-output-cap-mismatch');
  if (admission.jsonAttempt >= request.maxSends) throw new Error('quality-lab-cell-send-cap');
}
export function safeError(error: unknown): { name: string; message: string } {
  const message = error instanceof Error ? error.message : 'Unknown failure';
  return { name: error instanceof Error ? error.name : 'UnknownError', message: message
    .replace(/\bBearer\s+[^\s,;"']+/gi, '[redacted]')
    .replace(/\b(?:api[-_ ]?key|authorization|access[-_ ]?token|secret)(?:\s+(?:(?:was\s+)?provided|supplied))?\s*(?:[=:]|\bis\b)\s*["']?[^\s,;"']+/gi, '[credential redacted]')
    .replace(/\bsk-[a-zA-Z0-9_-]+/g, '[credential redacted]')
    .replace(/https?:\/\/[^\s)]+/g, '[endpoint redacted]').slice(0, 1600) };
}
