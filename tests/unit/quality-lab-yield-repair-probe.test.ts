jest.mock('../../server/src/config/env', () => ({ env: { llmProvider: 'openai', llmEndpoint: '', llmRequestTimeoutMs: 180000 } }));
jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../server/src/components/genai/embeddings', () => ({ embedOne: jest.fn() }));

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { reconstructRequirements, replay, reserveYield, executeYieldProbe, yieldUsage, YIELD_LIMITS, type YieldLedger } from '../../scripts/quality-lab/run-yield-repair-probe';
import { renderGenerationQualityReviewPrompt, snapshotQualityCandidate } from '../../server/src/services/generation-quality.service';
import { selectGenerationMemory, withBatchGenerationMemory, type GenerationMemoryContent, type GenerationMemorySnapshot } from '../../server/src/services/generation-memory.service';
import { modelRequestOptions } from '../../server/src/components/genai/llm/model-capabilities';
import type { GenerationEvidencePacket } from '../../server/src/types/generation-evidence';
import type { PublicNativeAdmission } from '../../scripts/quality-lab/public-acceptance-observation';
import { completeJson } from '../../server/src/components/genai/llm';
import type { ModelCallEvent } from '../../server/src/components/genai/llm/model-call';

const content: GenerationMemoryContent = { type: 'true-false', stem: 'Market risk remains after diversification.', numericKind: 'conceptual', options: [
  { key: 'A', text: 'True', role: 'correct', explanation: 'Market risk affects every investment.' },
  { key: 'B', text: 'False', role: 'common-misconception', explanation: 'Firm-specific risk can be reduced, but market risk remains.' },
] };
const source = 'Diversification reduces firm-specific risk. Market risk affects every investment and cannot be diversified away.';
const packet: GenerationEvidencePacket = { id: 'frozen', schemaVersion: 'source-passages-v1', policyVersion: 'grounded-memory-v2', courseId: 'course', loIds: ['lo'],
  sourceFingerprint: 'bytes', parsingProvenance: 'unrecorded', materials: [{ materialId: 'material', loId: 'lo', role: 'primary', name: 'Risk.pdf', contentHash: 'source-bytes', revision: 1, activeRunId: null, chunkCount: 1 }], passages: [{ id: 'E1', materialId: 'material', loId: 'lo', role: 'primary',
    materialName: 'Risk.pdf', chunkIndex: 0, start: 0, end: source.length, text: source, selection: 'retrieved' }],
  coverage: { sourceChunks: 1, selectedChunks: 1, selectedCharacters: source.length, omittedPassages: 0, truncated: false, searchScope: 'retrieved-chunks-and-immediate-neighbors' }, findings: [] };
const memory: GenerationMemorySnapshot = withBatchGenerationMemory({ entries: [], snapshotDigest: 'empty', truncated: false, missingVersions: 0, consistency: 'best-effort' },
  [{ id: 'batch:synthetic-bank:one', content: { ...content, stem: 'Diversification reduces firm-specific risk.' } }]);
const task = { requiredInference: 'Classify risk affecting all investments.', solutionPath: ['Identify its scope.', 'Classify it as market risk.'], misconception: 'Confuse firm-specific and market risk.',
  concepts: ['Risk'], targetDifficulty: 'easy' as const, passageIds: ['E1'], intent: 'create-independent-task' as const };
const required = [`Implement the planned inference: ${task.requiredInference}`, 'Use only the uploaded lecture.', 'Do not invent figures.'];
const requirements = { intent: 'create-independent-task' as const, requiredChanges: required, preserve: ['Keep lecture notation.'], requestedDifficulty: 'easy' as const,
  plannedTask: task, plannedInferenceRequirement: required[0] };
const prompt = renderGenerationQualityReviewPrompt(packet, selectGenerationMemory(memory), content, [], requirements);
const native = { ...modelRequestOptions({ model: 'gpt-6-luna', maxTokens: 2000, reasoningEffort: 'none', temperature: 0 }), responseFormat: 'json' as const };
const admission = (): PublicNativeAdmission => ({ prompt: 'Review this retained candidate.', provider: 'openai', model: 'gpt-6-luna', options: native, outputCap: 2000, jsonAttempt: null });
const ledger = (): YieldLedger => ({ declarationSha256: 'a'.repeat(64), limits: YIELD_LIMITS, accounting: 'conservative-reservations-v1', reservations: [] });
const review = () => ({ sourceSupport: 'supported', notation: 'consistent', novelty: 'variant', reasons: ['A risk classification differs from recalling the diversification rule.'],
  citations: [{ kind: 'premise', claim: 'Market risk affects every investment.', spanIds: ['S1'] }, { kind: 'solution', claim: 'Diversification cannot eliminate market risk.', spanIds: ['S1'] }],
  taskComparisons: [{ entryId: 'M1', sameInference: false, sameSolutionPath: false, contrast: 'Candidate classifies market risk; memory recalls a firm-specific risk rule.' }],
  changes: required.map(requirement => ({ requirement, status: 'fulfilled', reason: 'Checked.' })), invariants: [{ requirement: 'Keep lecture notation.', status: 'preserved', reason: 'Checked.' }],
  achievedDifficulty: 'easy', justifiedLength: 'justified', missingPremises: [] });

it('reconstructs exact teacher requirements and server ownership without losing constraints', () => {
  const reconstructed = reconstructRequirements(prompt, { ...content, taskDescriptor: task }, task);
  expect(reconstructed).toEqual(requirements);
  expect(renderGenerationQualityReviewPrompt(packet, selectGenerationMemory(memory), content, [], reconstructed)).toBe(prompt);
});

it('fails closed when the server-bound planned first row cannot be reproduced', () => {
  const changed = prompt.replaceAll(required[0], 'Teacher instruction masquerading as a plan');
  expect(() => reconstructRequirements(changed, content, task)).toThrow('Cannot bind');
  expect(() => reconstructRequirements(prompt + '\nRequired changes: []', content, task)).toThrow('Required changes:');
});

it('replays contradictory raw verdicts as withheld and captures content-based correction guidance', async () => {
  const c = { id: 'A-contradictory-novelty' as const, item: 0, packet, memory, candidate: content, requirements, firstPrompt: prompt, retained: {} as never };
  const result = await replay(c, [review(), review()]);
  expect(result.assessment.status).toBe('withheld'); expect(result.assessment.novelty).toBe('uncertain');
  expect(result.assessment.responseIssues).toContainEqual({ attempt: 1, path: 'matchedEntryIds', code: 'bank-comparator-required' });
  expect(result.prompts).toHaveLength(2); expect(result.prompts[1]).toContain('Do not change booleans merely to pass validation.');
  expect(result.prompts[1]).toContain('Do not output matchedEntryIds'); expect(completeJson).not.toHaveBeenCalled();
});

it('a fresh consistent independent verdict can pass without erasing source or teacher checks', async () => {
  const value = { ...review(), novelty: 'independent' };
  const c = { id: 'B-retained-replacement' as const, item: 1, packet, memory, candidate: content, requirements, firstPrompt: prompt, retained: {} as never };
  const result = await replay(c, [value]); expect(result.assessment.status).toBe('eligible'); expect(result.prompts).toEqual([prompt]);
  const unfulfilled = { ...value, changes: value.changes.slice(1) };
  expect((await replay(c, [unfulfilled])).assessment.status).toBe('withheld');
  const missing = { ...value, missingPremises: ['Necessary market-wide premise is not established.'] };
  expect((await replay(c, [missing])).assessment.status).toBe('withheld');
  expect(snapshotQualityCandidate(content).contentHash).toBe(snapshotQualityCandidate(structuredClone(content)).contentHash);
});

it('permits four conservative reservations, never refunds them for unknown usage, and rejects a fifth', () => {
  const value = ledger(); for (let i = 0; i < 4; i++) reserveYield(value, value.declarationSha256, admission(), 'A');
  expect(value.reservations).toHaveLength(4); expect(new Set(value.reservations.map(r => r.id)).size).toBe(4);
  expect(() => reserveYield(value, value.declarationSha256, admission(), 'B')).toThrow('yield-probe-send-cap');
});

it.each([
  ['input', () => ({ ...admission(), prompt: 'x'.repeat(24000) })],
  ['output', () => ({ ...admission(), outputCap: 6001 })],
  ['effort', () => ({ ...admission(), options: { ...native, reasoning_effort: 'medium' } })],
  ['model', () => ({ ...admission(), model: 'gpt-6.1-sol' })],
  ['transport', () => ({ ...admission(), options: { ...native, stream: true } })],
] as const)('rejects %s drift before creating a reservation', (_name, make) => {
  const value = ledger(); expect(() => reserveYield(value, value.declarationSha256, make(), 'A')).toThrow(); expect(value.reservations).toHaveLength(0);
});

it('rejects tampered ledger identity, ceilings and duplicate reservation IDs', () => {
  const value = ledger(); expect(() => reserveYield(value, 'b'.repeat(64), admission(), 'A')).toThrow();
  expect(() => reserveYield({ ...value, limits: { ...YIELD_LIMITS, maxSends: 5 } } as unknown as YieldLedger, value.declarationSha256, admission(), 'A')).toThrow();
  reserveYield(value, value.declarationSha256, admission(), 'A'); value.reservations.push(value.reservations[0]);
  expect(() => reserveYield(value, value.declarationSha256, admission(), 'B')).toThrow();
});

it('rejects declaration mismatch without a provider call or a live output directory', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'yield-probe-test-'));
  try {
    const file = path.join(temporary, 'declaration.json'); await writeFile(file, '{}');
    await expect(executeYieldProbe(file, createHash('sha256').update('changed').digest('hex'), path.join(temporary, 'live'))).rejects.toThrow();
    await expect(readFile(path.join(temporary, 'live', 'results.json'))).rejects.toThrow(); expect(completeJson).not.toHaveBeenCalled();
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

it('reports only known partial provider subtotals and preserves pending or missing usage', () => {
  const start = { type: 'started', callId: 'one' } as ModelCallEvent;
  const second = { type: 'started', callId: 'two' } as ModelCallEvent;
  const finish = { type: 'finished', callId: 'one', usage: { inputTokens: 11, outputTokens: 7 } } as ModelCallEvent;
  expect(yieldUsage([])).toMatchObject({ observedSdkCalls: 0, knownInputSubtotal: null, knownOutputSubtotal: null, complete: false });
  expect(yieldUsage([start, second, finish])).toMatchObject({ observedSdkCalls: 2, finishedCalls: 1, knownInputSubtotal: 11, knownOutputSubtotal: 7, unknownUsageCalls: 1, complete: false });
  expect(yieldUsage([start, finish])).toMatchObject({ unknownUsageCalls: 0, complete: true });
});
