import {
  applyGapCredits, gapCheckPrompts, gapFillPrompt, gapFillThemes, mergeGapObjectives, outlineLoId, uncoveredPoints, validateGapCheck, validateGapFill,
} from '../../server/src/services/structure-gap-pass';
import type { StructureEvidence, StructureResult } from '../../server/src/types/structure';

const point = (id: string, materialId = 'm1', objective = `Point ${id}`): StructureEvidence =>
  ({ id, objective, materialId, materialName: `Material ${materialId}`, chunkIndex: 0, quote: `Quote for ${id}` });
const evidence = [point('E1'), point('E2'), point('E3', 'm2'), point('E4', 'm2'), point('E5', 'm3')];
const themes: StructureResult['themes'] = [
  { name: 'Bonds', los: [{ name: 'Price a coupon bond.', evidenceIds: ['E1'], materialIds: ['m1'] }, { name: 'Explain YTM.', evidenceIds: ['E2'], materialIds: ['m1'] }] },
  { name: 'Stocks', los: [{ name: 'Apply the Gordon Growth Model.', evidenceIds: [], materialIds: [] }] },
];
const loIds = new Set(['T1.L1', 'T1.L2', 'T2.L1']);

describe('coverage gap pass', () => {
  it('finds points no LO cites and labels LOs T{topic}.L{lo}', () => {
    expect(uncoveredPoints(themes, evidence).map(row => row.id)).toEqual(['E3', 'E4', 'E5']);
    expect(outlineLoId(1, 0)).toBe('T2.L1');
  });
  it('puts the outline in a stable system prompt and the points in the task', () => {
    const a = gapCheckPrompts(themes, [evidence[2]!]); const b = gapCheckPrompts(themes, [evidence[3]!]);
    expect(a.system).toBe(b.system);
    expect(a.system).toContain('T1.L2  Bonds — Explain YTM.');
    expect(a.system).not.toContain('Point E3');
    expect(a.task).toContain('Point E3');
  });
  it('keeps each valid row and drops unknown points, roles, LO IDs and duplicates', () => {
    const rows = validateGapCheck({ points: [
      { id: 'E3', role: 'core', coveredBy: ['T1.L1'], reason: 'Same pricing skill.' },
      { id: 'E3', role: 'example', coveredBy: [], reason: 'duplicate' },
      { id: 'E4', role: 'trivia', coveredBy: [], reason: 'bad role' },
      { id: 'E5', role: 'example', coveredBy: ['T9.L9'], reason: 'bad LO' },
      { id: 'E9', role: 'core', coveredBy: [], reason: 'not requested' },
    ] }, ['E3', 'E4', 'E5'], loIds);
    expect(rows).toEqual([{ id: 'E3', role: 'core', coveredBy: ['T1.L1'], reason: 'Same pricing skill.' }]);
    expect(validateGapCheck('nonsense', ['E3'], loIds)).toEqual([]);
  });
  it('credits a point and its material to every covering LO without mutating the input', () => {
    const before = JSON.stringify(themes);
    const next = applyGapCredits(themes, [{ id: 'E3', role: 'core', coveredBy: ['T1.L1', 'T2.L1'], reason: '' }], evidence);
    expect(next[0]!.los[0]).toMatchObject({ evidenceIds: ['E1', 'E3'], materialIds: ['m1', 'm2'] });
    expect(next[1]!.los[0]).toMatchObject({ evidenceIds: ['E3'], materialIds: ['m2'] });
    expect(JSON.stringify(themes)).toBe(before);
    expect(uncoveredPoints(next, evidence).map(row => row.id)).toEqual(['E4', 'E5']);
  });
  it('asks for new LOs with the wording rules but without the per-topic count rule', () => {
    const prompt = gapFillPrompt(themes, [evidence[3]!], ['Rule one.', 'Unless the instructor set counts, give each topic 3 to 7 LOs.']);
    expect(prompt).toContain('Rule one.');
    expect(prompt).not.toContain('3 to 7 LOs');
    expect(prompt).toContain('Point E4');
  });
  it('accepts new LOs only in existing topics, citing unused gap IDs, never restating an LO', () => {
    const valid = validateGapFill({ objectives: [
      { topic: 'Bonds', name: 'Explain why bonds are fixed-income securities.', evidenceIds: ['E4', 'E1'] },
      { topic: 'Options', name: 'Value a call option.', evidenceIds: ['E5'] },
      { topic: 'Stocks', name: 'Apply the Gordon Growth Model.', evidenceIds: ['E5'] },
      { topic: 'Stocks', name: 'Explain dividend yield.', evidenceIds: ['E4'] },
      { topic: 'Stocks', name: 'Distinguish ex-dividend from with-dividend prices.', evidenceIds: ['E5'] },
    ] }, themes, ['E4', 'E5']);
    expect(valid).toEqual([
      { topic: 'Bonds', name: 'Explain why bonds are fixed-income securities.', evidenceIds: ['E4'] },
      { topic: 'Stocks', name: 'Distinguish ex-dividend from with-dividend prices.', evidenceIds: ['E5'] },
    ]);
  });
  it('groups new LOs under their topics for review and appends the admitted ones', () => {
    const fresh = gapFillThemes(themes, [{ topic: 'Stocks', name: 'Distinguish ex-dividend prices.', evidenceIds: ['E5'] }], evidence);
    expect(fresh).toEqual([{ name: 'Stocks', los: [{ name: 'Distinguish ex-dividend prices.', evidenceIds: ['E5'], materialIds: ['m3'] }] }]);
    const merged = mergeGapObjectives(themes, fresh);
    expect(merged[1]!.los.map(lo => lo.name)).toEqual(['Apply the Gordon Growth Model.', 'Distinguish ex-dividend prices.']);
    expect(merged[0]!.los).toHaveLength(2);
  });
});
