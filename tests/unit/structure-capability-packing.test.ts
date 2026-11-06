import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { StructureEvidence, StructureResult } from '../../server/src/types/structure';
import * as distinctness from '../../server/src/services/structure-capability-distinctness';
import { planOutlineGrounding } from '../../server/src/services/structure-outline-grounding';
import { estimateCapabilityReviewSend, planCapabilityOutlineGrounding, selectCapabilityOutlineGroundingBatch,
  structureOutlineReviewProtocolHash, type CapabilityOutlineGroundingBatch } from '../../server/src/services/structure-capability-grounding';
import { measureCapabilityPackingPrompt, OUTLINE_CAPABILITY_PACKING_LIMITS, planOutlineCapabilityPacking,
  type CapabilityPackingRenderer } from '../../server/src/services/structure-capability-packing';

const protocol = 'outline-capability-distinctness-v1' as const;
const suffix = '\n\nYour previous reply was not valid JSON. Respond with ONLY the JSON value — no prose, no explanation, no code fences.';
const clone = <T>(value: T): T => structuredClone(value);

function fixture(count = 8, padding = 2400, inputLimit = 16000) {
  const sections = Array.from({ length: 3 }, (_, index) => ({ id: `section-${index}`, materialId: `material-${index}`,
    materialName: `Chapter ${index + 1}.pdf`, chunkIndex: 0,
    text: `Source ${index + 1}: dividends reduce equity value; expected appreciation equals equity return less dividend yield.\n` + 'Complete original teaching conditions. '.repeat(Math.ceil(padding / 39)),
  }));
  const evidence: StructureEvidence[] = Array.from({ length: count }, (_, index) => {
    const source = sections[index % 3];
    return { id: `E${index + 1}`, objective: `Assess taught financing operation ${index + 1} from chapter ${index % 3 + 1}.`,
      materialId: source.materialId, materialName: source.materialName, chunkIndex: 0, quote: source.text };
  });
  const themes: StructureResult['themes'] = evidence.map((point, index) => ({ name: `Topic ${index + 1}`, los: [{
    name: `Assess financing operation ${index + 1} using the stated chapter ${index % 3 + 1} conditions.`, evidenceIds: [point.id], materialIds: [point.materialId],
  }] }));
  const ordinary = planOutlineGrounding(themes, evidence, sections, inputLimit);
  const context = distinctness.planOutlineCapabilityDistinctness(ordinary, protocol)!;
  const first = distinctness.selectOutlineCapabilityContext(context, [context.candidateIds[0]]);
  const stored: CapabilityOutlineGroundingBatch = { objectives: first.objectives.filter(row => first.candidateIds.includes(row.id)),
    sources: [], prompt: '', capabilityContext: first };
  const sent = selectCapabilityOutlineGroundingBatch(stored, first.candidateIds);
  const capabilityPrompt = distinctness.renderOutlineCapabilityDistinctness(first);
  const prefix = sent.prompt.slice(0, sent.prompt.length - capabilityPrompt.length);
  const renderer: CapabilityPackingRenderer = { wrapPrompt: prompt => prefix + prompt,
    estimateNative: estimateCapabilityReviewSend, jsonCorrectionSuffix: suffix };
  return { sections, evidence, themes, ordinary, context, renderer, inputLimit,
    fallbackGroups: ordinary.map(batch => batch.objectives.map(row => row.id)) };
}

afterEach(() => jest.restoreAllMocks());

describe('shared private trial rendering and real final context authority', () => {
  it('preserves every packet field and exact source byte, changing only a fixed-width non-authoritative trial hash', () => {
    const { context } = fixture();
    const snapshot = clone(context);
    const trial = distinctness.prepareOutlineCapabilityTrialRenderer(context);
    for (const ids of [['L1'], ['L1', 'L4'], ['L1', 'L2', 'L3', 'L4']]) {
      const actualContext = distinctness.selectOutlineCapabilityContext(context, ids);
      const actual = distinctness.renderOutlineCapabilityDistinctness(actualContext), sized = trial(ids);
      const split = (value: string) => {
        const boundary = value.lastIndexOf('\n\n');
        return { instructions: value.slice(0, boundary), packet: JSON.parse(value.slice(boundary + 2)) };
      };
      const a = split(actual), b = split(sized);
      expect(a.instructions).toBe(b.instructions);
      expect(b.packet.contextHash).toBe('0'.repeat(64));
      expect(a.packet).toEqual({ ...b.packet, contextHash: actualContext.contextHash });
      expect(Buffer.byteLength(actual, 'utf8')).toBe(Buffer.byteLength(sized, 'utf8'));
      expect(estimateCapabilityReviewSend(actual)).toBe(estimateCapabilityReviewSend(sized));
      expect(estimateCapabilityReviewSend(actual + suffix)).toBe(estimateCapabilityReviewSend(sized + suffix));
    }
    expect(context).toEqual(snapshot);
    const retained = trial(['L1']); context.sources[0].text += ' Caller mutation after preparation.';
    expect(trial(['L1'])).toBe(retained);
    expect(() => distinctness.selectOutlineCapabilityContext(context, ['L1'])).toThrow('context-changed');
  });

  it('refuses stale/unknown context bindings and invalid selections before providing a trial renderer', () => {
    const { context } = fixture();
    const stale = clone(context); stale.protocolHash = '0'.repeat(64);
    expect(() => distinctness.prepareOutlineCapabilityTrialRenderer(stale)).toThrow('context-changed');
    const trial = distinctness.prepareOutlineCapabilityTrialRenderer(context);
    for (const ids of [[], ['L1', 'L1'], ['L999']]) expect(() => trial(ids)).toThrow('selection-identity');
  });

  it('checks conflicting global point definitions even before selecting a group that could hide the conflict', () => {
    const f = fixture(3);
    const batches = clone(f.ordinary);
    const objectives = batches.flatMap(batch => batch.objectives);
    objectives[1].evidenceIds = [objectives[0].evidenceIds[0]];
    objectives[1].learningPoints[0].id = objectives[0].evidenceIds[0];
    const context = distinctness.planOutlineCapabilityDistinctness(batches, protocol)!;
    expect(() => distinctness.prepareOutlineCapabilityTrialRenderer(context)).toThrow('learning-point-alias-conflict');
  });
});

describe('deterministic source-overlap grouping with exact recursive fallback', () => {
  it('reduces complete-original repetition while preserving all global candidates, source points, peers and comparison identities', () => {
    const f = fixture();
    const snapshot = clone(f.context);
    const plan = planOutlineCapabilityPacking(f.context, f.inputLimit, f.fallbackGroups, f.renderer);
    expect(plan).toEqual(planOutlineCapabilityPacking(f.context, f.inputLimit, f.fallbackGroups, f.renderer));
    expect(plan.minimumAdditionalUnits).toBeLessThanOrEqual(plan.fallbackMinimumAdditionalUnits);
    expect(plan.strategy).toBe('largest-singleton-source-overlap');
    expect(plan.searchComplete).toBe(true);
    expect(plan.groups.every(group => group.length <= 4)).toBe(true);
    expect(plan.groups.flat().sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))).toEqual(f.context.candidateIds);
    const production = planCapabilityOutlineGrounding(f.themes, f.evidence, f.sections, f.inputLimit, protocol);
    expect(production.map(batch => batch.objectives.map(row => row.id))).toEqual(plan.groups);
    const comparisons: string[] = [];
    for (const [index, batch] of production.entries()) {
      const send = selectCapabilityOutlineGroundingBatch(batch, batch.objectives.map(row => row.id));
      const context = (send as CapabilityOutlineGroundingBatch).capabilityContext;
      expect(context.contextHash).not.toBe('0'.repeat(64));
      expect(context).toEqual(distinctness.selectOutlineCapabilityContext(f.context, batch.objectives.map(row => row.id)));
      expect(measureCapabilityPackingPrompt(send.prompt, f.inputLimit, f.renderer)).toEqual(plan.measurements[index]);
      expect(batch.prompt).toBe(''); expect(batch.sources).toEqual([]);
      const packet = JSON.parse(send.prompt.slice(send.prompt.lastIndexOf('\n\n') + 2));
      expect(packet.originalSections).toEqual(context.sources.map(({ alias, materialName, chunkIndex, text }) => ({ id: alias, material: materialName, chunkIndex, text })));
      const points = new Map(packet.learningPoints.map((row: { id: string }) => [row.id, row]));
      for (const row of batch.objectives) expect(row.learningPoints.map(point => points.get(point.id))).toEqual(row.learningPoints);
      comparisons.push(...packet.requiredComparisons.map((row: unknown) => JSON.stringify(row)));
    }
    const expected = f.context.nominations.flatMap(row => row.peerIds.map(peerId => JSON.stringify({ objectiveId: row.objectiveId, peerId,
      pairId: f.context.pairs.find(pair => [pair.firstId, pair.secondId].includes(row.objectiveId) && [pair.firstId, pair.secondId].includes(peerId))!.id })));
    expect(comparisons.sort()).toEqual(expected.sort());
    expect(f.context).toEqual(snapshot);
  });

  it('keeps the cheaper complete recursive plan when a greedy local choice would regress it', () => {
    const f = fixture(6, 0);
    const prepared = jest.spyOn(distinctness, 'prepareOutlineCapabilityTrialRenderer').mockReturnValue(ids => ids.join(','));
    const renderer: CapabilityPackingRenderer = { wrapPrompt: prompt => prompt, jsonCorrectionSuffix: '', estimateNative: prompt => {
      if (prompt === 'L1,L2,L3' || prompt === 'L4,L5,L6' || prompt === 'L1,L4') return 1000;
      if (!prompt.includes(',')) return prompt === 'L1' ? 4000 : 3000;
      return 5000;
    } };
    const plan = planOutlineCapabilityPacking(f.context, 4000, [['L1', 'L2', 'L3'], ['L4', 'L5', 'L6']], renderer);
    expect(plan).toMatchObject({ strategy: 'recursive', searchComplete: true, minimumAdditionalUnits: 14000,
      groups: [['L1', 'L2', 'L3'], ['L4', 'L5', 'L6']] });
    expect(prepared).toHaveBeenCalledTimes(1);
  });

  it('preserves the original recursive plan on an exact reservation tie', () => {
    const f = fixture(4, 0);
    jest.spyOn(distinctness, 'prepareOutlineCapabilityTrialRenderer').mockReturnValue(ids => ids.join(','));
    const renderer = { wrapPrompt: (prompt: string) => prompt, estimateNative: () => 1000, jsonCorrectionSuffix: '' };
    const plan = planOutlineCapabilityPacking(f.context, 4000, [f.context.candidateIds], renderer);
    expect(plan).toMatchObject({ strategy: 'recursive', groups: [f.context.candidateIds], minimumAdditionalUnits: 7000 });
  });

  it('bounds speculative groups at16000 and returns the already complete fallback instead of partial work', () => {
    const f = fixture(400, 0, 46500);
    const prepared = jest.spyOn(distinctness, 'prepareOutlineCapabilityTrialRenderer').mockReturnValue(ids => ids.join(','));
    const renderer = { wrapPrompt: (prompt: string) => prompt, estimateNative: (prompt: string) => prompt.includes(',') ? 100000 : 1000, jsonCorrectionSuffix: '' };
    const fallback = f.context.candidateIds.map(id => [id]);
    const plan = planOutlineCapabilityPacking(f.context, 4000, fallback, renderer);
    expect(plan).toMatchObject({ strategy: 'recursive', groups: fallback, searchComplete: false, searchStopReason: 'trial-limit', trialGroups: 16000 });
    expect(plan.groups.flat()).toEqual(f.context.candidateIds);
    expect(prepared).toHaveBeenCalledTimes(1);
    expect(OUTLINE_CAPABILITY_PACKING_LIMITS).toEqual({ candidates: 4, shortlist: 16, trialGroups: 16000, output: 6000 });
  });

  it.each(['missing', 'duplicate', 'foreign', 'empty'] as const)('refuses an incomplete or corrupt fallback identity: %s', changed => {
    const f = fixture(3, 0), fallback = [clone(f.context.candidateIds)];
    if (changed === 'missing') fallback[0].pop();
    if (changed === 'duplicate') fallback[0][1] = fallback[0][0];
    if (changed === 'foreign') fallback[0][1] = 'L999';
    if (changed === 'empty') fallback[0] = [];
    expect(() => planOutlineCapabilityPacking(f.context, 16000, fallback, f.renderer)).toThrow('fallback-identity');
  });
});

describe('unchanged input/native/correction caps and legacy branch', () => {
  const renderer = { estimateNative: estimateCapabilityReviewSend, jsonCorrectionSuffix: suffix };
  it('retains explicit empty-outline refusal while preserving historical absent-selector empty output', () => {
    expect(planCapabilityOutlineGrounding([], [], [], 16000)).toEqual([]);
    expect(() => planCapabilityOutlineGrounding([], [], [], 16000, protocol)).toThrow('proposal-identity');
  });
  it('refuses native JSON escaping overflow even when raw text fits', () => {
    const measured = measureCapabilityPackingPrompt('"'.repeat(3000), 4000, renderer);
    expect(measured.rawInput).toBeLessThan(4000); expect(measured.nativeInput).toBeGreaterThan(5500); expect(measured.fits).toBe(false);
  });
  it('reserves the exact existing first JSON correction rather than testing only the initial send', () => {
    const measured = measureCapabilityPackingPrompt('"'.repeat(2680), 4000, renderer);
    expect(measured.nativeInput).toBeLessThanOrEqual(5500); expect(measured.jsonRetryInput).toBeGreaterThan(5500); expect(measured.fits).toBe(false);
  });
  it('keeps the raw input cap and rejects malformed estimates or inputs', () => {
    expect(measureCapabilityPackingPrompt('a'.repeat(4000), 4000, renderer).fits).toBe(false);
    for (const limit of [NaN, 0, 3999, 4000.5]) expect(() => measureCapabilityPackingPrompt('text', limit, renderer)).toThrow('packing-input');
    for (const value of [NaN, -1, 100.5, 0]) expect(() => measureCapabilityPackingPrompt('text', 4000, { ...renderer, estimateNative: () => value })).toThrow('packing-estimate');
  });
  it('leaves the absent-selector result and original module bytes unchanged while binding the new explicit packing file', () => {
    const f = fixture(3, 0);
    expect(planCapabilityOutlineGrounding(f.themes, f.evidence, f.sections, 16000)).toEqual(planOutlineGrounding(f.themes, f.evidence, f.sections, 16000));
    const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
    expect(sha('server/src/services/structure-outline-grounding.ts')).toBe('a6f9fa23f3b7b35c9f2dd52a85303953f9e4e3917c59356fdd0ef1c1e6acf366');
    expect(sha('server/src/services/structure-outline-review.ts')).toBe('35cf0002adee090161bf33644f72f03516abc07320ecacbd05064ed76dbe9d74');
    const packing = readFileSync('server/src/services/structure-capability-packing.ts');
    expect(packing.length).toBeGreaterThan(0);
    expect(structureOutlineReviewProtocolHash(protocol)).not.toBe(structureOutlineReviewProtocolHash());
    expect(f.context.protocolHash).toBe(distinctness.outlineCapabilityDistinctnessProtocolHash());
  });
});
