// Offline production prompt/receipt wiring. Arithmetic is real; judgments are
// explicitly scripted, and provider/embedding/queue/database boundaries denied.
jest.mock('../../server/src/config/env', () => ({ env: { llmModelGenerator: 'generator', llmModelValidator: 'validator', llmModelReviewer: 'reviewer' } }));
jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../server/src/components/genai/embeddings', () => ({ embedOne: jest.fn(() => { throw new Error('embedding denied'); }) }));
jest.mock('../../server/src/components/qdrant', () => ({ search: jest.fn(() => { throw new Error('vector denied'); }) }));
jest.mock('../../server/src/components/jobs', () => ({ defineJob: jest.fn(), enqueueJob: jest.fn(() => { throw new Error('queue denied'); }) }));
jest.mock('../../server/src/components/param-worker', () => ({ executeGenerate: jest.fn(() => { throw new Error('worker denied'); }) }));

import { BSON } from 'mongodb';
import fixture from '../fixtures/generation-quality/retained-review-size-2026-10-17.json';
import { completeJson } from '../../server/src/components/genai/llm';
import { executeGenerate } from '../../server/src/components/param-worker';
import { VALIDATOR_PROMPT, REVIEWER_PROMPT, verifyGeneratedNumerics, type GeneratorOutput } from '../../server/src/services/generation.service';
import { assessGenerationQuality, renderGenerationQualityReviewPrompt, snapshotQualityCandidate } from '../../server/src/services/generation-quality.service';
import { selectGenerationMemory, type GenerationMemoryContent, type GenerationMemorySnapshot } from '../../server/src/services/generation-memory.service';
import { generationNumericReview, generationNumericReviewMetadata, generationNumericReviewReceiptMatches, assertGenerationNumericReviewProtocol, generationNumericReviewStageBinding, generationNumericReviewStageMatches } from '../../server/src/services/generation-numeric-review.service';
import { NUMERIC_REVIEW_PROTOCOL, renderGenerationNumericReviewWitness } from '../../server/src/services/generation-numeric-review';
import type { AuthoringRequirements, GenerationQualityAssessment } from '../../server/src/types/generation-quality';
import type { GenerationEvidencePacket } from '../../server/src/types/generation-evidence';

function example(id = 'CAPM') {
  const row = fixture.cases.find(value => value.id === id)!;
  const candidate = structuredClone({ ...row.candidate, type: row.type }) as unknown as GenerationMemoryContent;
  const packet = row.packet as unknown as GenerationEvidencePacket;
  const memory = row.memory as unknown as GenerationMemorySnapshot;
  const requirements: AuthoringRequirements = { intent: 'create-independent-task', requiredChanges: [], preserve: [], numericReviewProtocol: NUMERIC_REVIEW_PROTOCOL };
  const question = row.candidate as unknown as GeneratorOutput;
  const chunks = packet.passages.map(passage => ({ materialId: passage.materialId, chunkIndex: passage.chunkIndex, text: passage.text }));
  return { row, candidate, packet, memory, requirements, question, chunks };
}
function scriptedReview(requirements: AuthoringRequirements, sourceSupport = 'supported') {
  return { sourceSupport, notation: 'consistent', novelty: 'independent', reasons: ['SCRIPTED OFFLINE judgment, not a model-quality result.'],
    citations: [{ kind: 'premise', claim: 'SCRIPTED source premise.', spanIds: ['S1'] }, { kind: 'solution', claim: 'SCRIPTED source solution.', spanIds: ['S1'] }],
    taskComparisons: [], changes: requirements.requiredChanges.map(requirement => ({ requirement, status: 'fulfilled', reason: 'SCRIPTED clause check.' })),
    invariants: requirements.preserve.map(requirement => ({ requirement, status: 'preserved', reason: 'SCRIPTED invariant check.' })), achievedDifficulty: 'easy', justifiedLength: 'justified', missingPremises: [] };
}
beforeEach(() => jest.mocked(completeJson).mockReset());
afterEach(() => expect(executeGenerate).not.toHaveBeenCalled());

describe('explicit numerical review pin at production boundaries', () => {
  it.each(['P03', 'CAPM'])('adds the real fresh rendered %s sample to role/content/quality prompts without replacing the full original candidate', id => {
    const { candidate, packet, memory, requirements, question, chunks } = example(id);
    const witness = generationNumericReview(candidate, NUMERIC_REVIEW_PROTOCOL)!;
    expect(witness.status).toBe('available');
    const fragment = renderGenerationNumericReviewWitness(witness, candidate);
    const prompts = [VALIDATOR_PROMPT({ loName: 'Source-bound finance operation', type: 'mcq', question, chunks, authoringPolicy: 'grounded-memory-v2', numericReviewProtocol: NUMERIC_REVIEW_PROTOCOL }),
      REVIEWER_PROMPT({ loName: 'Source-bound finance operation', type: 'mcq', question, chunks, authoringPolicy: 'grounded-memory-v2', numericReviewProtocol: NUMERIC_REVIEW_PROTOCOL, verificationProven: true }),
      renderGenerationQualityReviewPrompt(packet, selectGenerationMemory(memory), candidate, [], requirements)];
    for (const prompt of prompts) {
      expect(prompt.split(fragment)).toHaveLength(2);
      expect(prompt).toContain('never source or semantic approval');
      expect(prompt).toContain(candidate.stem);
      for (const option of candidate.options) { expect(prompt).toContain(option.text); expect(prompt).toContain(option.explanation!); }
    }
    // Source originals and numeric definitions remain independently visible.
    expect(prompts[0]).toContain(packet.passages[0].text);
    expect(prompts[1]).toContain('"paramSlots"'); expect(prompts[1]).toContain('"derivedValues"');
    expect(prompts[2]).toContain(memory.entries[0].content.stem);
    expect(completeJson).not.toHaveBeenCalled();
  });

  it('preserves historical absent/own-undefined prompt bytes and wrapper behavior', () => {
    const { candidate, question, chunks, packet, memory } = example();
    const base = { loName: 'Historical course task', type: 'mcq' as const, question, chunks, authoringPolicy: 'grounded-memory-v2' as const };
    expect(generationNumericReview(candidate, undefined)).toBeUndefined();
    expect(generationNumericReviewMetadata(candidate, undefined)).toBeUndefined();
    expect(VALIDATOR_PROMPT(base)).toBe(VALIDATOR_PROMPT({ ...base, numericReviewProtocol: undefined }));
    expect(REVIEWER_PROMPT(base)).toBe(REVIEWER_PROMPT({ ...base, numericReviewProtocol: undefined }));
    const requirements: AuthoringRequirements = { intent: 'create-independent-task', requiredChanges: [], preserve: [] };
    const legacy = renderGenerationQualityReviewPrompt(packet, selectGenerationMemory(memory), candidate, [], requirements);
    expect(legacy).toBe(renderGenerationQualityReviewPrompt(packet, selectGenerationMemory(memory), candidate, [], { ...requirements, numericReviewProtocol: undefined }));
    for (const prompt of [VALIDATOR_PROMPT(base), REVIEWER_PROMPT(base), legacy]) expect(prompt).not.toContain('SERVER NUMERIC EXAMPLE');
  });

  it('keeps the complete existing role/content strings and quality prefix when adding the explicit sample', () => {
    const { candidate, question, chunks, packet, memory, requirements } = example();
    const base = { loName: 'Exact original source operation', type: 'mcq' as const, question, chunks, authoringPolicy: 'grounded-memory-v2' as const };
    const fragment = renderGenerationNumericReviewWitness(generationNumericReview(candidate, NUMERIC_REVIEW_PROTOCOL)!, candidate);
    expect(VALIDATOR_PROMPT({ ...base, numericReviewProtocol: NUMERIC_REVIEW_PROTOCOL }).replace('\n\n' + fragment, '')).toBe(VALIDATOR_PROMPT(base));
    expect(REVIEWER_PROMPT({ ...base, numericReviewProtocol: NUMERIC_REVIEW_PROTOCOL }).replace('\n\n' + fragment, '')).toBe(REVIEWER_PROMPT(base));
    const without = { ...requirements }; delete without.numericReviewProtocol;
    const original = renderGenerationQualityReviewPrompt(packet, selectGenerationMemory(memory), candidate, [], without);
    const added = renderGenerationQualityReviewPrompt(packet, selectGenerationMemory(memory), candidate, [], requirements);
    expect(added.startsWith(original + '\n\n' + fragment)).toBe(true);
    expect(added).toContain('stemQuote must quote the ORIGINAL CANDIDATE stem verbatim');
  });

  it.each(['unknown-v9', null, false, 1])('rejects unknown explicit selector %p before model use', bad => {
    const { candidate, question } = example();
    expect(() => generationNumericReview(candidate, bad)).toThrow('generation-numeric-review-protocol-invalid');
    expect(() => VALIDATOR_PROMPT({ loName: 'Source task', question, authoringPolicy: 'grounded-memory-v2', numericReviewProtocol: bad as never })).toThrow('generation-numeric-review-protocol-invalid');
    expect(completeJson).not.toHaveBeenCalled();
  });

  it.each(['baseline', 'grounded-memory-v1'] as const)('refuses the explicit pin with %s rather than activating a historical branch', policy => {
    expect(() => assertGenerationNumericReviewProtocol(NUMERIC_REVIEW_PROTOCOL, policy)).toThrow('generation-numeric-review-policy-invalid');
    const { question } = example();
    expect(() => VALIDATOR_PROMPT({ loName: 'Source task', question, numericReviewProtocol: NUMERIC_REVIEW_PROTOCOL })).toThrow('generation-numeric-review-policy-invalid');
    expect(() => REVIEWER_PROMPT({ loName: 'Source task', question, numericReviewProtocol: NUMERIC_REVIEW_PROTOCOL })).toThrow('generation-numeric-review-policy-invalid');
    expect(completeJson).not.toHaveBeenCalled();
  });

  it('refuses unknown/non-v2 quality execution pins before dispatching the mocked provider', async () => {
    const { candidate, packet, memory, requirements } = example();
    const args = { candidate, packet, memory, requirements, item: 0, step: { model: 'SCRIPTED-ONLY' } };
    await expect(assessGenerationQuality({ ...args, policy: 'baseline' })).rejects.toThrow('generation-numeric-review-policy-invalid');
    await expect(assessGenerationQuality({ ...args, policy: 'grounded-memory-v2', requirements: { ...requirements, numericReviewProtocol: 'unknown-v9' } as unknown as AuthoringRequirements }))
      .rejects.toThrow('generation-numeric-review-protocol-invalid');
    expect(completeJson).not.toHaveBeenCalled();
  });

  it.each(['P03', 'CAPM'])('recomputes metadata from the real canonical %s snapshot and survives BSON round trips', id => {
    const { candidate, requirements } = example(id);
    const canonical = snapshotQualityCandidate(candidate);
    const metadata = generationNumericReviewMetadata(canonical, NUMERIC_REVIEW_PROTOCOL)!;
    expect(metadata.status).toBe('available');
    const assessment = { policy: 'grounded-memory-v2', status: 'eligible', candidate: canonical, numericReview: metadata } as GenerationQualityAssessment;
    expect(generationNumericReviewReceiptMatches(assessment, requirements, canonical)).toBe(true);
    const restored = BSON.deserialize(BSON.serialize({ assessment, requirements, canonical }));
    expect(generationNumericReviewReceiptMatches(restored.assessment, restored.requirements, restored.canonical)).toBe(true);
    expect(generationNumericReviewMetadata(snapshotQualityCandidate(BSON.deserialize(BSON.serialize(candidate)) as GenerationMemoryContent), NUMERIC_REVIEW_PROTOCOL)).toEqual(metadata);
    expect(JSON.stringify(metadata)).not.toContain('verifiedAt');
  });

  it('rejects changed/fabricated metadata, a changed canonical candidate and BSON null drift', () => {
    const { candidate, requirements } = example(); const canonical = snapshotQualityCandidate(candidate);
    const metadata = generationNumericReviewMetadata(canonical, NUMERIC_REVIEW_PROTOCOL)!;
    const assessment = { policy: 'grounded-memory-v2', status: 'eligible', candidate: canonical, numericReview: metadata } as GenerationQualityAssessment;
    const wrong = structuredClone(assessment);
    if (wrong.numericReview!.status !== 'available') throw new Error('missing numeric metadata');
    wrong.numericReview!.bindingHash = '0'.repeat(64);
    expect(generationNumericReviewReceiptMatches(wrong, requirements, canonical)).toBe(false);
    const changed = structuredClone(candidate); changed.options[0].explanation += ' Changed feedback.';
    expect(generationNumericReviewReceiptMatches(assessment, requirements, snapshotQualityCandidate(changed))).toBe(false);
    const invalid = structuredClone(candidate); invalid.paramSlots![0].description = undefined;
    const nullVersion = BSON.deserialize(BSON.serialize(invalid, { ignoreUndefined: false })) as GenerationMemoryContent;
    expect(generationNumericReview(nullVersion, NUMERIC_REVIEW_PROTOCOL)!.status).toBe('unavailable');
    expect(generationNumericReviewReceiptMatches({ ...assessment, numericReview: null } as unknown as GenerationQualityAssessment, requirements, canonical)).toBe(false);
  });

  it('binds unavailable cached stages to the exact canonical candidate separately from their shared reason', () => {
    const { candidate } = example(); const bad = structuredClone(candidate);
    bad.options[0].text = 'literal';
    const first = snapshotQualityCandidate(bad); const binding = generationNumericReviewStageBinding(first, NUMERIC_REVIEW_PROTOCOL)!;
    expect(binding.receipt.status).toBe('unavailable'); expect(binding.candidate).toEqual(first);
    expect(generationNumericReviewStageMatches(binding, first, NUMERIC_REVIEW_PROTOCOL)).toBe(true);
    const other = structuredClone(bad); other.stem += ' Additional exact clause.';
    const next = generationNumericReviewStageBinding(snapshotQualityCandidate(other), NUMERIC_REVIEW_PROTOCOL)!;
    expect(next.receipt).toEqual(binding.receipt); expect(next.candidate).not.toEqual(binding.candidate);
    expect(generationNumericReviewStageMatches(binding, next.candidate, NUMERIC_REVIEW_PROTOCOL)).toBe(false);
    expect(generationNumericReviewStageMatches(BSON.deserialize(BSON.serialize(binding)) as typeof binding, first, NUMERIC_REVIEW_PROTOCOL)).toBe(true);
  });

  it('does not make the declared key a financial/source authority', async () => {
    const { candidate, packet, requirements } = example();
    const memory: GenerationMemorySnapshot = { entries: [], snapshotDigest: 'scripted-empty', truncated: false, missingVersions: 0, consistency: 'best-effort' };
    jest.mocked(completeJson).mockResolvedValue(scriptedReview(requirements, 'unsupported'));
    const result = await assessGenerationQuality({ packet, memory, candidate, requirements, policy: 'grounded-memory-v2', item: 0, step: { model: 'SCRIPTED-ONLY' } });
    expect(result.numericReview?.status).toBe('available'); expect(result.sourceSupport).toBe('unsupported'); expect(result.status).toBe('withheld');
    expect(completeJson).toHaveBeenCalledTimes(1);
  });

  it('retains teacher-clause refusal despite a valid deterministic witness and stores fresh metadata on a scripted positive', async () => {
    const { candidate, packet, requirements } = example();
    const memory: GenerationMemorySnapshot = { entries: [], snapshotDigest: 'scripted-empty', truncated: false, missingVersions: 0, consistency: 'best-effort' };
    requirements.requiredChanges = ['Keep this exact teacher instruction.'];
    const negative = scriptedReview(requirements); negative.changes[0].status = 'unfulfilled';
    jest.mocked(completeJson).mockResolvedValueOnce(negative).mockResolvedValueOnce(scriptedReview(requirements));
    const args = { packet, memory, candidate, requirements, policy: 'grounded-memory-v2' as const, item: 0, step: { model: 'SCRIPTED-ONLY' } };
    const withheld = await assessGenerationQuality(args); expect(withheld.status).toBe('withheld'); expect(withheld.numericReview?.status).toBe('available');
    const positive = await assessGenerationQuality(args); expect(positive.status).toBe('eligible');
    expect(positive.numericReview).toEqual(generationNumericReviewMetadata(snapshotQualityCandidate(candidate), NUMERIC_REVIEW_PROTOCOL));
    expect(generationNumericReviewReceiptMatches(positive, requirements, snapshotQualityCandidate(candidate))).toBe(true);
    expect(completeJson).toHaveBeenCalledTimes(2);
  });

  it('records conceptual T/F as not-applicable without running a legacy worker or deriving source approval', () => {
    const { candidate, question, chunks, packet, memory, requirements } = example('TF');
    expect(generationNumericReview(candidate, NUMERIC_REVIEW_PROTOCOL)).toMatchObject({ status: 'not-applicable', reason: 'no-numeric-template' });
    const base = { loName: 'Source conceptual task', type: 'true-false' as const, question, chunks, authoringPolicy: 'grounded-memory-v2' as const };
    const prompt = REVIEWER_PROMPT({ ...base, numericReviewProtocol: NUMERIC_REVIEW_PROTOCOL });
    expect(prompt).toBe(REVIEWER_PROMPT(base)); expect(prompt).not.toContain('SERVER NUMERIC EXAMPLE');
    expect(VALIDATOR_PROMPT({ ...base, numericReviewProtocol: NUMERIC_REVIEW_PROTOCOL })).toBe(VALIDATOR_PROMPT(base));
    const noPin = { ...requirements }; delete noPin.numericReviewProtocol;
    expect(renderGenerationQualityReviewPrompt(packet, selectGenerationMemory(memory), candidate, [], requirements))
      .toBe(renderGenerationQualityReviewPrompt(packet, selectGenerationMemory(memory), candidate, [], noPin));
    const canonical = snapshotQualityCandidate(candidate), binding = generationNumericReviewStageBinding(canonical, NUMERIC_REVIEW_PROTOCOL)!;
    expect(binding.receipt.status).toBe('not-applicable');
    expect(generationNumericReviewStageMatches(binding, canonical, NUMERIC_REVIEW_PROTOCOL)).toBe(true);
    expect(generationNumericReviewStageMatches(binding, snapshotQualityCandidate({ ...candidate, stem: candidate.stem + ' Changed exact clause.' }), NUMERIC_REVIEW_PROTOCOL)).toBe(false);
    expect(verifyGeneratedNumerics(question).failure).toBeUndefined();
  });
});
