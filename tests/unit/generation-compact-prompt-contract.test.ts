jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../server/src/components/genai/embeddings', () => ({ embedOne: jest.fn() }));
jest.mock('../../server/src/components/qdrant', () => ({ search: jest.fn() }));
jest.mock('../../server/src/components/jobs', () => ({ defineJob: jest.fn(), enqueueJob: jest.fn() }));
jest.mock('../../server/src/components/mongodb/collections', () => ({}));

import retained from '../fixtures/generation-quality/retained-review-size-2026-10-17.json';
import { authoringIntentInstruction, generationQualityInstruction, renderGenerationQualityReviewPrompt } from '../../server/src/services/generation-quality.service';
import { selectGenerationMemory, type GenerationMemorySnapshot } from '../../server/src/services/generation-memory.service';
import type { GenerationEvidencePacket } from '../../server/src/types/generation-evidence';
import type { AuthoringRequirements, GenerationQualityCandidate } from '../../server/src/types/generation-quality';
import { GENERATOR_V2_PROMPT } from '../../server/src/services/generation.service';
import { assessGenerationQuality } from '../../server/src/services/generation-quality.service';
import { completeJson } from '../../server/src/components/genai/llm';

const cases = retained.cases as unknown as Array<{ id: string; packet: GenerationEvidencePacket; memory: GenerationMemorySnapshot;
  candidate: GenerationQualityCandidate; requirements: AuthoringRequirements }>;
const dataTail = (prompt: string) => prompt.slice(prompt.indexOf('SOURCE EVIDENCE ONLY (S IDs)')).split('\n').filter(line => line.startsWith('{')).join('\n');
const exactLine = (prompt: string, name: string) => prompt.split('\n').find(line => line.startsWith(name));

describe('versioned compaction preserves authoritative data', () => {
  it.each(cases)('retains all source/memory/candidate payloads and teacher constraints for $id', row => {
    const previous = JSON.stringify(row);
    const fresh = { ...row.requirements, authoringPromptProtocol: 'compact-authoring-v1' as const };
    const memory = selectGenerationMemory(row.memory, { query: row.candidate.stem });
    const oldReview = renderGenerationQualityReviewPrompt(row.packet, memory, row.candidate, [], row.requirements);
    const newReview = renderGenerationQualityReviewPrompt(row.packet, memory, row.candidate, [], fresh);
    expect(dataTail(newReview)).toBe(dataTail(oldReview));
    for (const prefix of ['Required changes:', 'Preserved invariants:']) {
      expect(exactLine(newReview, prefix)).toBe(exactLine(oldReview, prefix));
    }
    expect(newReview).toContain(`CANDIDATE: ${JSON.stringify(row.candidate)}`);
    const oldContext = generationQualityInstruction(row.packet, row.memory, row.candidate.stem, row.requirements);
    const newContext = generationQualityInstruction(row.packet, row.memory, row.candidate.stem, fresh);
    expect(dataTail(newContext)).toBe(dataTail(oldContext));
    const params = { type: row.candidate.type, loName: 'Retained objective', kind: 'calculation' as const, chunks: [] };
    const oldGenerator = GENERATOR_V2_PROMPT({ ...params, qualityContext: oldContext });
    const newGenerator = GENERATOR_V2_PROMPT({ ...params, qualityContext: newContext, authoringPromptProtocol: 'compact-authoring-v1' });
    const reference = (prompt: string) => prompt.slice(prompt.indexOf('EXACT function semantics'), prompt.indexOf('For conceptual questions') > 0 ? prompt.indexOf('For conceptual questions') : prompt.indexOf('Conceptual:'));
    if (row.candidate.type === 'mcq') expect(reference(newGenerator)).toBe(reference(oldGenerator));
    expect(JSON.stringify(row)).toBe(previous);
  });

  it.each(['edit-existing', 'create-variant', 'create-independent-task'] as const)('retains the complete original in %s mode', intent => {
    const row = cases[0];
    const requirement = { ...row.requirements, intent, original: row.candidate };
    const old = authoringIntentInstruction(requirement);
    const compact = authoringIntentInstruction({ ...requirement, authoringPromptProtocol: 'compact-authoring-v1' });
    expect(exactLine(compact, 'Original reference:')).toBe(exactLine(old, 'Original reference:'));
    expect(compact).toContain(`Intent: ${intent}`);
    expect(compact).toContain('Required changes:'); expect(compact).toContain('Preserved invariants:');
  });

  it('refuses an unknown prospective selector, including helper entry points', () => {
    const row = cases[0], requirements = { ...row.requirements, authoringPromptProtocol: 'future' as never };
    expect(() => authoringIntentInstruction(requirements)).toThrow('generation-quality-protocol-invalid');
    expect(() => GENERATOR_V2_PROMPT({ type: 'mcq', loName: 'Unknown', chunks: [], authoringPromptProtocol: 'future' as never })).toThrow('generation-quality-protocol-invalid');
  });

  it.each(['baseline', 'grounded-memory-v1'] as const)('refuses compact review outside v2: %s', async policy => {
    const row = cases[0];
    await expect(assessGenerationQuality({ packet: row.packet, memory: row.memory, candidate: row.candidate,
      requirements: { ...row.requirements, authoringPromptProtocol: 'compact-authoring-v1' }, policy, item: 0,
      step: { model: 'scripted-only' } })).rejects.toThrow('generation-quality-protocol-invalid');
    expect(completeJson).not.toHaveBeenCalled();
  });
});
