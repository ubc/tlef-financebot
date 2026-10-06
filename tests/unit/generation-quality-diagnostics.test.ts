jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../server/src/components/mongodb/collections', () => ({}));

import { ObjectId } from 'mongodb';
import { completeJson } from '../../server/src/components/genai/llm';
import { snapshotQualityCandidate } from '../../server/src/services/generation-quality.service';
import type { GenerationMemoryContent } from '../../server/src/services/generation-memory.service';
import type { GenerationEvidencePacket } from '../../server/src/types/generation-evidence';
import type { GenerationQualityRunResult } from '../../server/src/types/generation-quality';

function candidate(): GenerationMemoryContent {
  return {
    type: 'mcq',
    stem: 'For stock beta {{BETA}}, which CAPM return is required?',
    options: [
      { key: 'A', text: '{{RETURN}}%', role: 'correct', explanation: 'Use beta to scale the market risk premium.' },
      { key: 'B', text: '{{WRONG}}%', role: 'common-misconception', explanation: 'Total volatility is not the CAPM beta.' },
    ],
    numericKind: 'numeric',
    paramSlots: [{ name: 'BETA', description: 'Stock beta', min: 0.5, max: 1.5, step: 0.1, values: [0.5, 0.75, 1.25] }],
    derivedValues: [
      { name: 'RETURN', formula: '4 + BETA * 6' },
      { name: 'WRONG', formula: '4 + 0.4 * 6', errorModel: 'Mistakes total volatility for beta.' },
    ],
  };
}

afterEach(() => expect(completeJson).not.toHaveBeenCalled());

it('preserves a normal numerical candidate exactly with a stable full-content hash and no truncation', () => {
  const original = candidate();
  const snapshot = snapshotQualityCandidate(original);
  const { contentHash, truncated, ...content } = snapshot;
  expect(content).toEqual(original);
  expect(truncated).toBe(false);
  expect(contentHash).toMatch(/^[a-f0-9]{64}$/);
  expect(snapshotQualityCandidate(candidate()).contentHash).toBe(contentHash);
  const changed = candidate(); changed.options[0].explanation += ' This changes the checked explanation.';
  expect(snapshotQualityCandidate(changed).contentHash).not.toBe(contentHash);
});

it('does not add absent numerical fields to a conceptual diagnostic', () => {
  const original: GenerationMemoryContent = { type: 'true-false', stem: 'Total volatility always equals beta.',
    options: [
      { key: 'T', text: 'True', role: 'common-misconception', explanation: 'Total and systematic risk differ.' },
      { key: 'F', text: 'False', role: 'correct', explanation: 'Beta measures systematic risk.' },
    ], numericKind: 'conceptual' };
  expect(snapshotQualityCandidate(original)).toEqual({ ...original, contentHash: expect.any(String), truncated: false });
  expect(snapshotQualityCandidate(original)).not.toHaveProperty('paramSlots');
});

it('omits source/prompt/provider metadata at every object level and keeps hashes tied to intended question fields', () => {
  const clean = candidate();
  const extra = {
    ...clean,
    prompt: 'HIDDEN_INSTRUCTOR_PROMPT', providerResponse: 'HIDDEN_PROVIDER_BODY',
    sourceRefs: [{ materialId: new ObjectId(), chunk: 'HIDDEN_FULL_SOURCE_DOCUMENT' }],
    options: clean.options.map(option => ({ ...option, prompt: 'HIDDEN_OPTION_METADATA' })),
    paramSlots: clean.paramSlots!.map(slot => ({ ...slot, source: 'HIDDEN_SLOT_METADATA' })),
    derivedValues: clean.derivedValues!.map(value => ({ ...value, rawResponse: 'HIDDEN_FORMULA_METADATA' })),
  };
  const snapshot = snapshotQualityCandidate(extra);
  expect(JSON.stringify(snapshot)).not.toContain('HIDDEN_');
  expect(snapshot).not.toHaveProperty('sourceRefs');
  expect(snapshot.options[0]).not.toHaveProperty('prompt');
  expect(snapshot.paramSlots![0]).not.toHaveProperty('source');
  expect(snapshot.derivedValues![0]).not.toHaveProperty('rawResponse');
  expect(snapshot.contentHash).toBe(snapshotQualityCandidate(clean).contentHash);
});

it('clips long strings and large collections while explicitly marking the result as truncated', () => {
  const original = candidate();
  original.stem = 's'.repeat(12001);
  original.options = Array.from({ length: 9 }, () => ({ key: 'k'.repeat(17), text: 't'.repeat(4001),
    role: 'correct', explanation: 'e'.repeat(6001) }));
  original.paramSlots = Array.from({ length: 33 }, () => ({ name: 'n'.repeat(81), description: 'd'.repeat(301),
    min: 0.25, max: 4.75, step: 0.25, values: Array.from({ length: 201 }, (_, index) => index / 4) }));
  original.derivedValues = Array.from({ length: 33 }, () => ({ name: 'n'.repeat(81), formula: 'f'.repeat(1001), errorModel: 'm'.repeat(501) }));
  const snapshot = snapshotQualityCandidate(original);
  expect(snapshot.truncated).toBe(true);
  expect(snapshot.stem).toHaveLength(12000);
  expect(snapshot.options).toHaveLength(8);
  expect(snapshot.options[0].key).toHaveLength(16);
  expect(snapshot.options[0].text).toHaveLength(4000);
  expect(snapshot.options[0].explanation).toHaveLength(6000);
  expect(snapshot.paramSlots).toHaveLength(32);
  expect(snapshot.paramSlots![0].name).toHaveLength(80);
  expect(snapshot.paramSlots![0].description).toHaveLength(300);
  expect(snapshot.paramSlots![0].values).toHaveLength(200);
  expect(snapshot.paramSlots![0]).toMatchObject({ min: 0.25, max: 4.75, step: 0.25 });
  expect(snapshot.derivedValues).toHaveLength(32);
  expect(snapshot.derivedValues![0].name).toHaveLength(80);
  expect(snapshot.derivedValues![0].formula).toHaveLength(1000);
  expect(snapshot.derivedValues![0].errorModel).toHaveLength(500);
});

it('marks truncation when only allowed numerical values exceed the limit and hashes the omitted tail', () => {
  const first = candidate(); first.paramSlots![0].values = Array.from({ length: 201 }, (_, index) => index);
  const second = candidate(); second.paramSlots![0].values = [...first.paramSlots![0].values]; second.paramSlots![0].values[200] = 999;
  const firstSnapshot = snapshotQualityCandidate(first);
  const secondSnapshot = snapshotQualityCandidate(second);
  expect(firstSnapshot.truncated).toBe(true);
  expect(firstSnapshot.paramSlots).toEqual(secondSnapshot.paramSlots);
  expect(firstSnapshot.contentHash).not.toBe(secondSnapshot.contentHash);
});

it('hashes original intended text even when different tails are omitted from the diagnostic', () => {
  const first = candidate(); first.stem = 'x'.repeat(12000) + 'FIRST OMITTED TAIL';
  const second = candidate(); second.stem = 'x'.repeat(12000) + 'SECOND OMITTED TAIL';
  expect(snapshotQualityCandidate(first).stem).toBe(snapshotQualityCandidate(second).stem);
  expect(snapshotQualityCandidate(first).contentHash).not.toBe(snapshotQualityCandidate(second).contentHash);
});

it('copies diagnostic arrays so later candidate changes cannot rewrite recorded question content', () => {
  const original = candidate();
  const snapshot = snapshotQualityCandidate(original);
  original.options[0].text = 'Changed'; original.paramSlots![0].values![0] = 999; original.derivedValues![0].formula = '999';
  expect(snapshot.options[0].text).toBe('{{RETURN}}%');
  expect(snapshot.paramSlots![0].values![0]).toBe(0.5);
  expect(snapshot.derivedValues![0].formula).toBe('4 + BETA * 6');
});

it('does not copy malformed model metadata through fields reserved for finite numeric bounds and values', () => {
  const malformed = candidate() as unknown as Record<string, unknown>;
  malformed.paramSlots = [{ name: 'BETA', min: { prompt: 'HIDDEN_NUMERIC_OBJECT' }, max: 'HIDDEN_NUMERIC_STRING',
    step: Infinity, values: [0.5, NaN, { source: 'HIDDEN_VALUE_OBJECT' }, 'HIDDEN_VALUE_STRING', -Infinity, 1.25] }];
  const snapshot = snapshotQualityCandidate(malformed as unknown as GenerationMemoryContent);
  expect(JSON.stringify(snapshot)).not.toContain('HIDDEN_');
  expect(snapshot.truncated).toBe(true);
  expect(snapshot.paramSlots![0]).not.toHaveProperty('min');
  expect(snapshot.paramSlots![0]).not.toHaveProperty('max');
  expect(snapshot.paramSlots![0]).not.toHaveProperty('step');
  expect(snapshot.paramSlots![0].values).toEqual([0.5, 1.25]);
});

it('retains the complete typed evidence packet in run results for later snapshot inspection', () => {
  const evidence: GenerationEvidencePacket = {
    id: 'snapshot-id', schemaVersion: 'source-passages-v1', policyVersion: 'grounded-memory-v1',
    courseId: '000000000000000000000001', loIds: ['000000000000000000000002'], sourceFingerprint: 'source-digest',
    parsingProvenance: 'unrecorded',
    materials: [{ materialId: '000000000000000000000003', name: 'Week 1.pdf', role: 'primary', loId: '000000000000000000000002',
      loName: 'Systematic risk', revision: 7, activeRunId: '000000000000000000000004', contentHash: 'material-digest', chunkCount: 4 }],
    passages: [{ id: 'E1', materialId: '000000000000000000000003', materialName: 'Week 1.pdf', role: 'primary',
      loId: '000000000000000000000002', loName: 'Systematic risk', chunkIndex: 1, start: 0, end: 25,
      text: 'Beta is systematic risk.', selection: 'neighbor' }],
    coverage: { sourceChunks: 4, selectedChunks: 1, selectedCharacters: 25, omittedPassages: 2, truncated: true,
      searchScope: 'retrieved-chunks-and-immediate-neighbors' },
    findings: [{ code: 'evidence-budget-truncated', message: 'Two passages exceeded the budget.', passageIds: [] }],
  };
  const result: GenerationQualityRunResult = { policy: 'grounded-memory-v1', assessments: [], evidence };
  const restored = JSON.parse(JSON.stringify(result)) as GenerationQualityRunResult;
  expect(restored.evidence).toEqual(evidence);
  expect(restored.evidence!.materials[0]).toMatchObject({ revision: 7, activeRunId: '000000000000000000000004', loName: 'Systematic risk' });
  expect(restored.evidence!.passages[0]).toMatchObject({ start: 0, end: 25, selection: 'neighbor' });
});
