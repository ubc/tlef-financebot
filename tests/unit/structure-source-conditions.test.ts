import { buildStructureConditionContext, validateStructureConditionContext, structureConditionPromptContext,
  assertStructureConditionPromptBudget, type StructureConditionContextInput } from '../../server/src/services/structure-source-conditions';
import { splitSourcePassages } from '../../server/src/services/source-passages';
import type { StructureEvidence } from '../../server/src/types/structure';
import retained from './fixtures/structure-source-conditions-retained.json';

function fixture(): StructureConditionContextInput {
  const text = 'Forecast finite cash flows and add terminal value.\n'.repeat(8)
    + 'Stable-growth value is next-period cash flow / (r - g).\n'
    + 'Growth cannot exceed economy growth; risk, margins and returns must be stable.\n';
  const section = { id: 'S635', localId: 'C32.S1', materialId: 'chapter12', chunkIndex: 31, text };
  const passages = splitSourcePassages({ ...section, id: section.localId }, 'line-boundary-v2');
  expect(passages).toHaveLength(2);
  const point = (index: number): StructureEvidence => ({ id: index ? 'E947' : 'E946', materialId: section.materialId,
    materialName: 'Valuation', chunkIndex: section.chunkIndex, objective: index ? 'Calculate stable-growth value.' : 'Forecast finite-period value.',
    sourcePassageId: passages[index].id, quote: passages[index].text });
  return { sourceFingerprint: 'frozen-current-source', passagePolicy: 'line-boundary-v2', sections: [section],
    materials: [{ materialId: section.materialId, sourceTextHash: 'raw-text-hash', parserVersion: 'native-v1', chunkerVersion: 'chunk-v1' }],
    evidence: [point(0), point(1)], extractions: [{ sectionId: section.id, row: { sectionId: section.localId,
      objectives: [], knowledge: [{ kind: 'condition', name: 'Growth cannot exceed economy growth; risk, margins and returns must be stable.',
        passageId: passages[1].id, quote: passages[1].text }] } }] };
}

it('retains exact source-bound conditions separately from objective and coverage identities', () => {
  const input = fixture(); const before = JSON.stringify(input); const context = buildStructureConditionContext(input);
  expect(context).toMatchObject({ version: 'source-condition-context-v1', linkedConditions: 1, orphanConditions: 0 });
  expect(context.conditions[0]).toMatchObject({ id: expect.stringMatching(/^K[0-9a-f]{64}$/), evidenceIds: ['E947'] });
  expect(context.originals[0]).toMatchObject({ id: expect.stringMatching(/^P[0-9a-f]{64}$/), materialId: 'chapter12', sectionId: 'C32.S1', passageId: 'C32.S1.P2' });
  expect(structureConditionPromptContext(context, [input.evidence[0]]).conditions).toEqual([]);
  const prompt = structureConditionPromptContext(context, [input.evidence[1]]);
  expect(prompt.conditions[0]).toEqual({ id: 'K1', name: input.extractions[0].row.knowledge[0].name, evidenceIds: ['E947'], originalIds: ['CP1'] });
  expect(JSON.stringify(prompt)).not.toContain('quote');
  expect(JSON.stringify(input)).toBe(before);
  expect(Object.isFrozen(context.conditions[0])).toBe(true);
});

it('remaps only E aliases when an unchanged pack uses local learning-point IDs', () => {
  const input = fixture(); const context = buildStructureConditionContext(input);
  const prompt = structureConditionPromptContext(context, [{ ...input.evidence[1], id: 'E1' }]);
  expect(prompt.conditions[0].evidenceIds).toEqual(['E1']);
  expect(context.conditions[0].evidenceIds).toEqual(['E947']);
});

it.each(['material', 'chunk', 'section', 'disjoint-passage'] as const)('does not join a condition through a foreign %s binding', mismatch => {
  const input = fixture();
  if (mismatch === 'material') input.evidence[1].materialId = 'foreign-material';
  if (mismatch === 'chunk') input.evidence[1].chunkIndex++;
  if (mismatch === 'section') input.evidence[1].sourcePassageId = 'C32.S2.P2';
  if (mismatch === 'disjoint-passage') input.evidence = [input.evidence[0]];
  const context = buildStructureConditionContext(input);
  expect(context.conditions[0].evidenceIds).toEqual([]);
  expect(context).toMatchObject({ linkedConditions: 0, orphanConditions: 1 });
  expect(structureConditionPromptContext(context, input.evidence).conditions).toEqual([]);
  expect(structureConditionPromptContext(context, input.evidence, true).unlinkedConditions).toHaveLength(1);
});

it('retains a supporting-passage condition and never transfers it by textual similarity', () => {
  const input = fixture(); const first = input.evidence[0]; const second = input.evidence[1];
  first.supportingPassages = [{ passageId: second.sourcePassageId!, quote: second.quote }];
  const context = buildStructureConditionContext(input);
  expect(context.conditions[0].evidenceIds).toEqual(['E946', 'E947']);
  expect(structureConditionPromptContext(context, [{ ...second, objective: 'A different capability with the same source words.' }]).conditions).toEqual([]);
});

it.each(['condition-quote', 'supporting-quote', 'passage-policy'] as const)('rejects a stale %s instead of rebinding historical references', change => {
  const input = fixture();
  if (change === 'condition-quote') input.extractions[0].row.knowledge[0].quote += ' invented';
  if (change === 'supporting-quote') input.extractions[0].row.knowledge[0].supportingPassages = [{ passageId: 'C32.S1.P1', quote: 'invented original' }];
  if (change === 'passage-policy') input.passagePolicy = 'word-boundary-v1';
  expect(() => buildStructureConditionContext(input)).toThrow('structure-condition-original-changed');
});

it.each(['sourceTextHash', 'parserVersion', 'chunkerVersion'] as const)('invalidates a restored sidecar after %s changes', field => {
  const input = fixture(); const context = buildStructureConditionContext(input);
  const changed = structuredClone(input); changed.materials[0][field] += '-changed';
  expect(() => validateStructureConditionContext(context, changed)).toThrow('structure-condition-context-changed');
  expect(buildStructureConditionContext(changed).conditions[0].id).not.toBe(context.conditions[0].id);
});

it('refuses a modified restored context hash and leaves concept/formula entries outside the condition ledger', () => {
  const input = fixture(); const condition = input.extractions[0].row.knowledge[0];
  input.extractions[0].row.knowledge.push({ ...condition, kind: 'formula', name: 'Value = CF / (r - g)' }, { ...condition, kind: 'concept', name: 'Read the activity; no answer is supplied.' });
  const context = buildStructureConditionContext(input);
  expect(context.conditions).toHaveLength(1);
  const changed = structuredClone(context); changed.conditions[0].name = 'Infer a definitive convertible-preferred answer.';
  expect(() => structureConditionPromptContext(changed, input.evidence)).toThrow('structure-condition-context-changed');
});

it('keeps an unchanged scoped pack byte-identical when an unrelated chapter is prepended', () => {
  const input = fixture(); const before = structureConditionPromptContext(buildStructureConditionContext(input), [input.evidence[1]]);
  const foreign = fixture(); foreign.sections[0] = { ...foreign.sections[0], id: 'S1', materialId: 'foreign' };
  foreign.materials[0].materialId = 'foreign'; foreign.extractions[0].sectionId = 'S1';
  foreign.extractions[0].row.knowledge[0].name = 'A different chapter condition.';
  foreign.evidence = foreign.evidence.map(point => ({ ...point, id: `foreign-${point.id}`, materialId: 'foreign' }));
  const combined = { ...input, sourceFingerprint: 'with-another-chapter', sections: [...foreign.sections, ...input.sections],
    materials: [...foreign.materials, ...input.materials], extractions: [...foreign.extractions, ...input.extractions], evidence: [...foreign.evidence, ...input.evidence] };
  expect(structureConditionPromptContext(buildStructureConditionContext(combined), [input.evidence[1]])).toEqual(before);
});

it('admits the whole bounded prompt or refuses it without truncating any context', () => {
  const input = fixture(); const context = buildStructureConditionContext(input);
  const prompt = JSON.stringify(structureConditionPromptContext(context, input.evidence, true));
  expect(() => assertStructureConditionPromptBudget(prompt, 32)).toThrow('structure-condition-context-too-large');
  expect(() => assertStructureConditionPromptBudget(prompt, Buffer.byteLength(prompt) + 64)).not.toThrow();
  expect(context.conditions).toHaveLength(1);
});

it('repairs the retained E482/E947 input omission without changing any historical objective or source record', () => {
  const input = retained.input as StructureConditionContextInput; const before = JSON.stringify(input);
  const context = buildStructureConditionContext(input);
  expect(context).toMatchObject({ linkedConditions: 4, orphanConditions: 0 });
  const e482 = structureConditionPromptContext(context, input.evidence.filter(point => point.id === 'E482'));
  expect(e482.conditions).toHaveLength(3);
  expect(e482.conditions.some(row => row.name === 'If the next-best alternative is renting or leasing the asset, opportunity cost is the expected present value of after-tax rental or lease revenues.')).toBe(true);
  const e947 = structureConditionPromptContext(context, input.evidence.filter(point => point.id === 'E947'));
  expect(e947.conditions).toHaveLength(1);
  expect(e947.conditions[0].name).toBe('The stable growth rate cannot be higher than the growth rate of the economy in which the firm operates; in stable growth, the firm must have stability in risk, margins, and accounting returns.');
  expect(structureConditionPromptContext(context, input.evidence.filter(point => point.id === 'E946')).conditions).toEqual([]);
  expect(context.originals.find(row => row.passageId === 'C32.S1.P2')?.quote).toContain('cannot\n     be higher than the growth rate of the economy');
  expect(JSON.stringify(input)).toBe(before);
  expect(input.evidence).toHaveLength(3);
});

it('refuses missing extraction rows instead of silently declaring a partial condition catalog complete', () => {
  const input = fixture(); input.extractions = [];
  expect(() => buildStructureConditionContext(input)).toThrow('structure-condition-extraction-incomplete');
});
