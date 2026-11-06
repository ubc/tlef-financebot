jest.mock('../../server/src/config/env', () => ({ env: { llmModelGenerator: 'generator', llmModelValidator: 'validator', llmModelReviewer: 'reviewer' } }));
jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../server/src/components/genai/embeddings', () => ({ embedOne: jest.fn() }));
jest.mock('../../server/src/components/qdrant', () => ({ search: jest.fn() }));
jest.mock('../../server/src/components/jobs', () => ({ defineJob: jest.fn(), enqueueJob: jest.fn() }));

import fixture from '../fixtures/generation-quality/source-interpretation-public-2026-10-17.json';
import retainedContexts from '../fixtures/generation-quality/retained-review-size-2026-10-17.json';
import { createHash } from 'node:crypto';
import { completeJson } from '../../server/src/components/genai/llm';
import { evaluateFormula, parseFormula } from '../../server/src/components/formula';
import { VALIDATOR_PROMPT, REVIEWER_PROMPT, requestedNumericalVariationFailure, type GeneratorOutput } from '../../server/src/services/generation.service';
import { assessGenerationQuality, authoringIntentInstruction, generationQualityInstruction, renderGenerationQualityReviewPrompt } from '../../server/src/services/generation-quality.service';
import { selectGenerationMemory, type GenerationMemoryContent, type GenerationMemorySnapshot } from '../../server/src/services/generation-memory.service';
import { renderSourceCitationSpans, sourceCitationSpans } from '../../server/src/services/generation-citation-spans';
import { V2_SOURCE_INTERPRETATION_RULES } from '../../server/src/services/generation-source-interpretation';
import type { AuthoringRequirements } from '../../server/src/types/generation-quality';
import type { GenerationEvidencePacket } from '../../server/src/types/generation-evidence';

const memory: GenerationMemorySnapshot = { entries: [], snapshotDigest: 'fixture-empty-comparison', truncated: false, missingVersions: 0, consistency: 'best-effort' };
function example(index: number) {
  const row = fixture.cases[index];
  const packet = { id: row.originalPacketId, schemaVersion: 'source-passages-v1', policyVersion: 'grounded-memory-v2',
    courseId: '000000000000000000000001', loIds: [], sourceFingerprint: row.originalPacketSha256, parsingProvenance: 'unrecorded',
    materials: [row.material], passages: row.sourcePassages, findings: [], coverage: { sourceChunks: row.material.chunkCount,
      selectedChunks: row.sourcePassages.length, selectedCharacters: row.sourcePassages.reduce((n, p) => n + p.text.length, 0),
      omittedPassages: 0, truncated: true, searchScope: 'retrieved-chunks-and-immediate-neighbors' } } as unknown as GenerationEvidencePacket;
  const candidate = row.question as unknown as GenerationMemoryContent;
  const requirements: AuthoringRequirements = { intent: 'create-independent-task', requiredChanges: [row.request.prompt], preserve: [] };
  return { row, packet, candidate, requirements };
}
function response(requirements: AuthoringRequirements) {
  return { sourceSupport: 'supported', notation: 'consistent', novelty: 'independent', reasons: ['Fixture review of the supplied source, not a real model assessment.'],
    citations: [{ kind: 'premise', claim: 'The required relationship is taught.', spanIds: ['S1'] }, { kind: 'solution', claim: 'The selected answer follows that relationship.', spanIds: ['S1'] }],
    taskComparisons: [], changes: requirements.requiredChanges.map(requirement => ({ requirement, status: 'fulfilled', reason: 'Fixture finding.' })),
    invariants: [], achievedDifficulty: 'easy', justifiedLength: 'justified', missingPremises: [], findings: [] as unknown[] };
}
async function assess(index: number, result: ReturnType<typeof response>) {
  const input = example(index);
  jest.mocked(completeJson).mockResolvedValue(result);
  return assessGenerationQuality({ ...input, memory, policy: 'grounded-memory-v2', item: index, step: { model: 'fixture-only' } });
}
beforeEach(() => jest.mocked(completeJson).mockReset());

describe('prospective v2 source interpretation instructions', () => {
  it.each([0, 1, 2, 3])('carries the same generic rules once across all v2 boundaries for archived example %i', index => {
    const { packet, candidate, requirements } = example(index);
    const params = { loName: 'Source-bound task', question: candidate as GeneratorOutput, chunks: packet.passages };
    const prompts = [generationQualityInstruction(packet, memory, '', requirements),
      renderGenerationQualityReviewPrompt(packet, selectGenerationMemory(memory), candidate, [], requirements),
      VALIDATOR_PROMPT({ ...params, authoringPolicy: 'grounded-memory-v2' }),
      REVIEWER_PROMPT({ ...params, type: candidate.type, authoringPolicy: 'grounded-memory-v2' })];
    for (const prompt of prompts) {
      expect(prompt.split(V2_SOURCE_INTERPRETATION_RULES)).toHaveLength(2);
      expect(prompt).toContain('reduce/mitigate != eliminate/diversify away');
      expect(prompt).toContain('lists are not exclusive unless the source says only/not');
      expect(prompt).toContain('literal True/False against the whole proposition');
    }
    expect(V2_SOURCE_INTERPRETATION_RULES).not.toMatch(/P0[1-4]|N\d\d|6ad329|Chrysler|Vale/);
  });

  it('keeps baseline/v1 prompt branches outside the new cohort', () => {
    const { packet, candidate } = example(1);
    const params = { loName: 'Risk', question: candidate as GeneratorOutput, chunks: packet.passages };
    for (const prompt of [VALIDATOR_PROMPT(params), REVIEWER_PROMPT(params), generationQualityInstruction(packet, memory, ''),
      renderGenerationQualityReviewPrompt(packet, selectGenerationMemory(memory), candidate, [])]) {
      expect(prompt).not.toContain(V2_SOURCE_INTERPRETATION_RULES);
    }
  });

  it.each([0, 3])('does not waive a source-cited ambiguous-answer finding for archived negative %i', async index => {
    const input = example(index); const judged = response(input.requirements);
    const span = sourceCitationSpans(input.packet).find(s => s.passageId.endsWith('-15-0'))!;
    judged.findings = [{ kind: 'answer-semantics', target: 'options', status: 'defect',
      observation: index === 0 ? 'Mitigation and inability to eliminate can both be true; the key is not unique.' : 'A strategy listed elsewhere is not excluded by the broad can question.',
      correction: 'Clarify the actual source-supported criterion and independently recheck every choice.', sourceSpanIds: [span.id], memoryEntryIds: [] }];
    const result = await assess(index, judged);
    expect(result).toMatchObject({ status: 'withheld', sourceSupport: 'supported' });
    expect(result.findings).toHaveLength(1);
    expect(completeJson).toHaveBeenCalledTimes(1);
  });

  it('keeps the supported two-mechanism positive eligible without introducing a new source requirement', async () => {
    const input = example(1); const result = await assess(1, response(input.requirements));
    expect(result).toMatchObject({ status: 'eligible', sourceSupport: 'supported', notation: 'consistent' });
    expect(result.citations).toHaveLength(2);
  });

  it('retains exact original citation checks even when an optimistic review invokes the new rules', async () => {
    const input = example(1); const judged = response(input.requirements); judged.citations[0].spanIds = ['S999'];
    const result = await assess(1, judged);
    expect(result.status).toBe('withheld'); expect(result.sourceSupport).toBe('uncertain');
  });

  it('does not turn sound arithmetic into a waiver of an unfulfilled teacher clause', async () => {
    const input = example(2); const judged = response(input.requirements);
    judged.changes[0] = { requirement: input.requirements.requiredChanges[0], status: 'unfulfilled',
      reason: 'The task computes Total Beta but does not distinguish beta from total volatility as requested.' };
    const result = await assess(2, judged);
    expect(result.status).toBe('withheld'); expect(result.changes?.[0].status).toBe('unfulfilled');
  });

  it('keeps all sixteen explicit numeric draws distinct without evaluating model-authored code', () => {
    const q = example(2).candidate; let draws = 0;
    const slots = q.paramSlots!; const domains = slots.map(s => s.values!);
    for (const marketBeta of domains[0]) for (const correlation of domains[1]) for (const riskfreeRate of domains[2]) for (const riskPremium of domains[3]) {
      const values = { marketBeta, correlation, riskfreeRate, riskPremium };
      const actual = q.derivedValues!.map(d => {
        const parsed = parseFormula(d.formula); if (!parsed.ok) throw Error(parsed.error);
        const result = evaluateFormula(parsed.ast, values); if (!result.ok) throw Error(result.error);
        return result.value;
      });
      expect(actual[0]).toBeCloseTo(riskfreeRate + marketBeta / correlation * riskPremium, 10);
      expect(new Set(actual.map(n => n.toFixed(2))).size).toBe(4); draws++;
    }
    expect(draws).toBe(16);
  });

  it('shows literal True/False responses separately from their correct corrective feedback', () => {
    const archived = fixture.additionalRegressions.trueFalseCorrectiveFeedback;
    const q = archived.question as unknown as GeneratorOutput;
    expect(q.options.map(o => o.text)).toEqual(['True', 'False']);
    expect(q.options[1].explanation).toContain('can reduce firm-specific risk');
    const prompt = VALIDATOR_PROMPT({ loName: 'Diversification', question: q, chunks: archived.evidence.passages, authoringPolicy: 'grounded-memory-v2' });
    expect(prompt).toContain('Correct feedback explaining a wrong choice is not another correct choice');
    expect(prompt).toContain('Do not waive ambiguous stems/wrong keys');
    expect(prompt).toContain('identical roles are not a relabeling defect');
  });

  it('recognizes the actual CAPM retry as decimal input variation without changing its percentage convention', () => {
    const archived = fixture.additionalRegressions.capmDecimalRequirement;
    const q = archived.question as unknown as GeneratorOutput;
    expect(q.stem).toContain('Rates are percentages, not fractional decimals');
    expect(requestedNumericalVariationFailure(archived.requiredChanges[1], q)).toBeUndefined();
    expect(q.paramSlots!.some(slot => slot.values!.some(value => !Number.isInteger(value)))).toBe(true);
    let draws = 0;
    for (const RiskfreeRate of q.paramSlots![0].values!) for (const Beta of q.paramSlots![1].values!) for (const RiskPremium of q.paramSlots![2].values!) {
      const values = { RiskfreeRate, Beta, RiskPremium };
      const answers = q.derivedValues!.map(definition => {
        const ast = parseFormula(definition.formula); if (!ast.ok) throw Error(ast.error);
        const result = evaluateFormula(ast.ast, values); if (!result.ok) throw Error(result.error);
        return result.value.toFixed(2);
      });
      expect(new Set(answers).size).toBe(4); draws++;
    }
    expect(draws).toBe(27);
  });

  it('labels only an exact server-bound plan row and preserves every teacher requirement byte', () => {
    const archived = fixture.additionalRegressions.capmDecimalRequirement;
    const requiredChanges = archived.requiredChanges;
    const plannedTask = { ...archived.question.taskDescriptor,
      requiredInference: requiredChanges[0].slice('Implement the planned inference: '.length) } as NonNullable<AuthoringRequirements['plannedTask']>;
    const requirements: AuthoringRequirements = { intent: 'create-independent-task', requiredChanges, preserve: ['Keep percent units.'], plannedTask };
    const before = JSON.stringify(requirements);
    expect(authoringIntentInstruction(requirements)).toContain('Server-marked plan row index: none (still binding)');
    requirements.plannedInferenceRequirement = requiredChanges[0];
    const prompt = authoringIntentInstruction(requirements);
    expect(prompt).toContain('Server-marked plan row index: 0 (still binding)');
    expect(prompt).toContain(JSON.stringify(requiredChanges)); expect(prompt).toContain('Keep percent units.');
    expect(prompt).toContain('not fractional-rate encoding');
    expect(prompt).toContain('All other required rows/invariants remain binding; a text prefix alone proves no provenance');
    delete requirements.plannedInferenceRequirement;
    expect(JSON.stringify(requirements)).toBe(before);
  });

  it.each(retainedContexts.cases)('bounds the actual first production source-review prompt for $id without provider dispatch', async context => {
    const packet = context.packet as unknown as GenerationEvidencePacket;
    const requirements = context.requirements as unknown as AuthoringRequirements;
    const before = JSON.stringify(context);
    let captured = ''; let entries = 0;
    // Throw at the injected completion boundary: no provider wrapper, native
    // reservation, database, review correction or successful judgment runs.
    const refuse = async <T>(prompt: string): Promise<T> => { captured = prompt; entries++; throw new Error('offline-before-provider'); };
    const assessment = await assessGenerationQuality({ packet, memory: context.memory as unknown as GenerationMemorySnapshot,
      candidate: { ...context.candidate, type: context.type } as unknown as GenerationMemoryContent,
      requirements, policy: 'grounded-memory-v2', item: 0, step: { model: 'fixture-refused' }, complete: refuse });
    expect(entries).toBe(1); expect(completeJson).not.toHaveBeenCalled();
    expect(assessment.status).toBe('withheld');
    expect(Buffer.byteLength(captured, 'utf8') + 32).toBeLessThanOrEqual(22500);
    expect(captured).toContain(renderSourceCitationSpans(packet));
    const sourceBlock = captured.split('\n\n').find(block => block.startsWith('SOURCE EVIDENCE ONLY (S IDs).'))!;
    const memoryBlock = captured.split('\n\n').find(block => block.startsWith('BANK/QUEUE MEMORY ONLY (M IDs).'))!;
    expect(createHash('sha256').update(sourceBlock).digest('hex')).toBe(context.expectedSourceBlockSha256);
    expect(createHash('sha256').update(memoryBlock).digest('hex')).toBe(context.expectedMemoryBlockSha256);
    expect(captured).toContain(`Required changes: ${JSON.stringify(requirements.requiredChanges)}`);
    expect(captured).toContain(`Preserved invariants: ${JSON.stringify(requirements.preserve)}`);
    expect(captured).toContain(context.memory.snapshotDigest);
    expect(JSON.stringify(context)).toBe(before);
  });
});
