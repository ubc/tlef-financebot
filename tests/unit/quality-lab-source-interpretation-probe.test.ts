jest.mock('../../server/src/config/env', () => ({ env: { llmProvider: 'openai', llmEndpoint: '', llmRequestTimeoutMs: 180000 } }));
jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../server/src/components/genai/embeddings', () => ({ embedOne: jest.fn() }));
jest.mock('../../server/src/components/qdrant', () => ({ qdrant: {} }));

import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { INTERPRETATION_LIMITS, INTERPRETATION_STEP, executeInterpretation, guardedInterpretationCompletion, interpretationArguments, interpretationPromptShapes, reserveInterpretation,
  runInterpretationCase, validateInterpretationInput, type InterpretationCase, type InterpretationInput, type InterpretationLedger } from '../../scripts/quality-lab/run-source-interpretation-probe';
import { snapshotQualityCandidate } from '../../server/src/services/generation-quality.service';
import { withBatchGenerationMemory } from '../../server/src/services/generation-memory.service';
import type { GeneratorOutput } from '../../server/src/services/generation.service';
import type { GenerationEvidencePacket } from '../../server/src/types/generation-evidence';
import type { GenerationQualityAssessment } from '../../server/src/types/generation-quality';
import type { completeJson } from '../../server/src/components/genai/llm';
import { modelRequestOptions } from '../../server/src/components/genai/llm/model-capabilities';
import type { PublicNativeAdmission } from '../../scripts/quality-lab/public-acceptance-observation';

const candidate: GeneratorOutput = { stem: 'Market risk cannot be diversified away.', difficulty: 'easy', numericKind: 'conceptual', options: [
  { key: 'A', text: 'True', role: 'correct', explanation: 'Market risk affects all investments.' },
  { key: 'B', text: 'False', role: 'common-misconception', explanation: 'Firm-specific effects can average out; market risk remains.' },
] };
const source = 'Firm-specific effects can average out. Market risk affects all investments and cannot be diversified away.';
const packet: GenerationEvidencePacket = { id: 'packet', schemaVersion: 'source-passages-v1', policyVersion: 'grounded-memory-v2', courseId: 'course', loIds: ['lo'],
  sourceFingerprint: 'original', parsingProvenance: 'unrecorded', materials: [{ materialId: 'm', loId: 'lo', role: 'primary', name: 'Risk.pdf', revision: 1, contentHash: 'bytes', activeRunId: null, chunkCount: 1 }],
  passages: [{ id: 'E1', materialId: 'm', loId: 'lo', role: 'primary', materialName: 'Risk.pdf', chunkIndex: 0, start: 0, end: source.length, text: source, selection: 'retrieved' }],
  coverage: { sourceChunks: 1, selectedChunks: 1, selectedCharacters: source.length, omittedPassages: 0, truncated: false, searchScope: 'retrieved-chunks-and-immediate-neighbors' }, findings: [] };
const memory = withBatchGenerationMemory({ entries: [], truncated: false, missingVersions: 0, consistency: 'best-effort', snapshotDigest: 'empty' }, []);
const requirement = 'Keep all questions inside the lecture notes.';
const review = () => ({ sourceSupport: 'supported', notation: 'consistent', novelty: 'independent', reasons: ['The proposition and corrective feedback follow the passage.'],
  citations: [{ kind: 'premise', claim: 'Market risk affects all investments.', spanIds: ['S1'] }, { kind: 'solution', claim: 'Market risk cannot be diversified away.', spanIds: ['S1'] }],
  taskComparisons: [], changes: [{ requirement, status: 'fulfilled', reason: 'The source teaches this proposition.' }], invariants: [], achievedDifficulty: 'easy', justifiedLength: 'justified', missingPremises: [] });
function c(id = 'TF'): InterpretationCase {
  return { id, loName: 'Distinguish risk categories.', type: 'true-false', candidate: structuredClone(candidate), packet: structuredClone(packet), memory: structuredClone(memory),
    requirements: { intent: 'create-independent-task', requiredChanges: [requirement], preserve: [] },
    previousAssessment: { policy: 'grounded-memory-v2', item: 0, status: 'eligible', candidate: snapshotQualityCandidate({ ...candidate, type: 'true-false' }), evidencePacketId: packet.id, memoryDigest: memory.snapshotDigest } as GenerationQualityAssessment,
    sourceReviewTranscriptFile: `/private/tmp/${id}-source.json`, ...(id === 'TF' || id === 'CAPM' ? { roleReview: { validatorTranscriptFile: `/private/tmp/${id}-validator.json`, reviewerTranscriptFile: `/private/tmp/${id}-reviewer.json` } } : {}) };
}
function input(): InterpretationInput {
  const cases = ['P01', 'P02', 'P03', 'P04', 'CAPM', 'TF'].map(id => c(id));
  return { version: 1, cases, identities: cases.flatMap(item => [item.sourceReviewTranscriptFile, ...Object.values(item.roleReview ?? {})].map(file => ({ file, sha256: 'a'.repeat(64) }))), limitations: ['Synthetic offline gate tests, no real quality measure.'] };
}
const admission = (): PublicNativeAdmission => ({ prompt: 'Review the unchanged question.', provider: 'openai', model: INTERPRETATION_STEP.model,
  options: { ...modelRequestOptions(INTERPRETATION_STEP), responseFormat: 'json' }, outputCap: 2000, jsonAttempt: null });
const ledger = (): InterpretationLedger => ({ declarationSha256: 'a'.repeat(64), limits: INTERPRETATION_LIMITS, reservations: [] });

it('keeps all six fixed tuning cases and exact candidate/source/memory identities', () => {
  expect(() => validateInterpretationInput(input())).not.toThrow();
  for (const mutation of [
    (value: InterpretationInput) => { value.cases[0].candidate.stem += ' changed'; },
    (value: InterpretationInput) => { value.cases[0].packet.id = 'different'; },
    (value: InterpretationInput) => { value.cases[0].memory.snapshotDigest = 'different'; },
    (value: InterpretationInput) => { value.cases.pop(); },
    (value: InterpretationInput) => { value.identities = []; },
    (value: InterpretationInput) => { value.cases[4].roleReview = undefined; },
  ]) { const value = input(); mutation(value); expect(() => validateInterpretationInput(value)).toThrow(); }
});

it('enforces the new observed-send ceiling without refunding earlier unknown work', () => {
  const value = ledger();
  for (let i = 0; i < 16; i++) reserveInterpretation(value, value.declarationSha256, admission(), 'P01');
  expect(value.reservations).toHaveLength(16);
  expect(() => reserveInterpretation(value, value.declarationSha256, admission(), 'TF')).toThrow('interpretation-send-cap');
  expect(value.reservations).toHaveLength(16);
});

it('enforces the conservative total independently of the send count', () => {
  const value = ledger(); const large = { ...admission(), prompt: 'x'.repeat(23900) };
  for (let i = 0; i < 12; i++) reserveInterpretation(value, value.declarationSha256, large, 'CAPM');
  expect(() => reserveInterpretation(value, value.declarationSha256, large, 'CAPM')).toThrow('interpretation-total-cap');
  expect(value.reservations).toHaveLength(12);
});

it.each([
  ['model', () => ({ ...admission(), model: 'gpt-6.1-sol' })],
  ['effort', () => ({ ...admission(), options: { ...admission().options, reasoning_effort: 'medium' } })],
  ['output', () => ({ ...admission(), outputCap: 4000 })],
  ['input', () => ({ ...admission(), prompt: 'x'.repeat(24000) })],
  ['stream', () => ({ ...admission(), options: { ...admission().options, stream: true } })],
] as const)('rejects %s drift before charging or dispatching', (_name, make) => {
  const value = ledger(); expect(() => reserveInterpretation(value, value.declarationSha256, make(), 'P01')).toThrow(); expect(value.reservations).toHaveLength(0);
});

it('rejects tampered declaration or ledger state', () => {
  const value = ledger(); expect(() => reserveInterpretation(value, 'b'.repeat(64), admission(), 'P01')).toThrow();
  reserveInterpretation(value, value.declarationSha256, admission(), 'P01'); value.reservations.push(value.reservations[0]);
  expect(() => reserveInterpretation(value, value.declarationSha256, admission(), 'P01')).toThrow();
});

it('runs source, option-role and content checks on one unchanged T/F candidate', async () => {
  const prompts: string[] = []; const before = JSON.stringify(candidate); const values = [review(), { roleAssessment: 'A is correct. B is the incorrect response; its explanation correctly teaches why.' }, { decision: 'pass', reasoning: 'Only True is the correct literal response.' }];
  const complete: typeof completeJson = async <T>(prompt: string) => { prompts.push(prompt); return structuredClone(values[prompts.length - 1]) as T; };
  const checkpoint = jest.fn(async () => undefined); const result = await runInterpretationCase(c(), complete, checkpoint);
  expect(result.assessment.status).toBe('eligible'); expect(result.review?.decision).toBe('pass'); expect(prompts).toHaveLength(3);
  expect(prompts[1]).toContain('Candidate:'); expect(prompts[2]).toContain('Option-role findings:'); expect(JSON.stringify(candidate)).toBe(before);
});

it('keeps a substantive negative withheld without rewriting it or forcing a role pass', async () => {
  let calls = 0; const negative = { ...review(), sourceSupport: 'uncertain', reasons: ['The source does not establish exclusivity.'], missingPremises: ['The alternatives are not excluded.'] };
  const result = await runInterpretationCase(c('P01'), async <T>() => { calls++; return negative as T; }, async () => undefined);
  expect(result.assessment.status).toBe('withheld'); expect(result.validation).toBeNull(); expect(result.review).toBeNull(); expect(calls).toBe(1);
});

it('does not waive an unmet teacher requirement when source support is otherwise valid', async () => {
  const value = { ...review(), changes: [{ requirement, status: 'unfulfilled', reason: 'A necessary clause is missing.' }] };
  const result = await runInterpretationCase(c('P02'), async <T>() => value as T, async () => undefined);
  expect(result.assessment.status).toBe('withheld'); expect(result.assessment.changes?.[0].status).toBe('unfulfilled');
});

it('keeps invalid citations withheld after the one allowed logical review correction', async () => {
  let calls = 0; const value = { ...review(), citations: [{ kind: 'premise', claim: 'Invented.', spanIds: ['S99'] }] };
  const result = await runInterpretationCase(c('P02'), async <T>() => { calls++; return value as T; }, async () => undefined);
  expect(result.assessment.status).toBe('withheld'); expect(result.assessment.sourceSupport).toBe('uncertain'); expect(calls).toBe(2);
});

it('inspects the actual source prompt without producing a semantic observation', async () => {
  const value = input(); value.cases = [c('P01')];
  const shapes = await interpretationPromptShapes(value);
  expect(shapes.shapes).toHaveLength(1); expect(shapes.shapes[0].stage).toBe('quality-review');
  expect(shapes.shapes[0].prompt).toContain(requirement); expect(shapes.shapes[0].prompt).toContain(candidate.stem);
  expect(shapes.shapes[0].utf8InputEstimate).toBe(Buffer.byteLength(shapes.shapes[0].prompt, 'utf8') + 32);
});

it('propagates an oversized real prompt outside the assessor fallback without changing the input cap', async () => {
  const value = input(); value.cases = [c('P01')]; value.cases[0].requirements.requiredChanges.push('x'.repeat(24000));
  await expect(interpretationPromptShapes(value)).rejects.toThrow('P01:quality-review:initial-prompt-too-large');
});

it.each([new Error('transport-failed'), undefined, null])('latches even a falsy completion error swallowed by source assessment: %p', async failure => {
  let sends = 0;
  const guard = guardedInterpretationCompletion(async () => { sends++; throw failure; }, async () => undefined);
  await expect(runInterpretationCase(c('TF'), guard.complete, async () => undefined)).rejects.toBe(failure);
  expect(guard.stopped).toBe(true); expect(sends).toBe(1);
});

it('rejects a wrong declaration hash before creating a live output or calling a provider', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'interpretation-probe-'));
  try {
    const file = path.join(temporary, 'declaration.json'); await writeFile(file, '{}');
    await expect(executeInterpretation(file, createHash('sha256').update('changed').digest('hex'), path.join(temporary, 'live'))).rejects.toThrow();
    await expect(readFile(path.join(temporary, 'live/results.json'))).rejects.toThrow();
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

it.each([
  ['--output', 'out', '--live', 'once', '--declaration', 'd', '--declaration-sha256', 'h', '--live', 'once'],
  ['--output', 'out', '--live', 'yes', '--declaration', 'd', '--declaration-sha256', 'h'],
  ['--output', 'out', '--input', 'fixture'],
  ['--output', 'out', '--input', 'fixture', '--prior-ledgers', 'a,b', '--unknown', 'yes'],
  ['--output'],
])('rejects malformed, duplicate or mixed CLI arguments: %p', (...args) => {
  expect(() => interpretationArguments(args)).toThrow();
});
