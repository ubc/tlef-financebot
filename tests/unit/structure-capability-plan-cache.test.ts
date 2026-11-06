import { createCapabilityPlanCache, type CapabilityPlanCacheInput } from '../../server/src/services/structure-capability-plan-cache';
import type { OutlineGroundingBatch } from '../../server/src/services/structure-outline-grounding';

function input(): CapabilityPlanCacheInput {
  return { protocolHash: 'a'.repeat(64), inputLimit: 46500,
    themes: [{ name: 'Finance', los: [{ name: 'Explain the cash effect.', evidenceIds: ['E1'], materialIds: ['m1'] }] }],
    evidence: [{ id: 'E1', objective: 'Explain the cash effect.', materialId: 'm1', materialName: 'Chapter.pdf', chunkIndex: 0, quote: 'Debt raises cash.' }],
    sections: [{ id: 's1', materialId: 'm1', materialName: 'Chapter.pdf', chunkIndex: 0, text: 'Debt raises cash.' }] };
}
const plan = (text = 'Exact plan prompt'): OutlineGroundingBatch[] => [{ objectives: [], sources: [], prompt: text }];

it('avoids repeating an exact successful pure plan without returning its stored references', () => {
  const cache = createCapabilityPlanCache(), key = input(), produced = plan(), build = jest.fn(() => produced);
  const first = cache.run(key, build); first[0]!.prompt = 'Caller mutation'; produced[0]!.prompt = 'Builder mutation';
  const second = cache.run(structuredClone(key), build);
  expect(second[0]!.prompt).toBe('Exact plan prompt');
  second[0]!.sources.push({ id: 'forged', alias: 'S9', materialId: 'x', materialName: 'Forged', chunkIndex: 0, text: 'Forged' });
  expect(cache.run(key, build)[0]!.sources).toEqual([]);
  expect(build).toHaveBeenCalledTimes(1);
  expect(cache.stats()).toMatchObject({ entries: 1, hits: 2, misses: 1 });
});

it.each(['protocol', 'limit', 'wording', 'point', 'quote', 'original', 'material', 'own-undefined'] as const)(
  'recomputes after an exact %s identity change', changed => {
    const cache = createCapabilityPlanCache(), original = input(), modified = structuredClone(original), build = jest.fn(() => plan());
    cache.run(original, build);
    if (changed === 'protocol') modified.protocolHash = 'b'.repeat(64);
    if (changed === 'limit') modified.inputLimit--;
    if (changed === 'wording') modified.themes[0]!.los[0]!.name += ' A different operation.';
    if (changed === 'point') modified.evidence[0]!.objective += ' A different source point.';
    if (changed === 'quote') modified.evidence[0]!.quote += ' Additional exact clause.';
    if (changed === 'original') modified.sections[0]!.text += ' Additional original context.';
    if (changed === 'material') modified.sections[0]!.materialId = 'another-course-material';
    if (changed === 'own-undefined') modified.sections[0]!.localId = undefined;
    cache.run(modified, build);
    expect(build).toHaveBeenCalledTimes(2);
  });

it('does not cache a failed build or suppress its retry', () => {
  const cache = createCapabilityPlanCache(), build = jest.fn<OutlineGroundingBatch[], []>()
    .mockImplementationOnce(() => { throw new Error('original-unavailable'); }).mockReturnValueOnce(plan());
  expect(() => cache.run(input(), build)).toThrow('original-unavailable');
  expect(cache.stats().entries).toBe(0);
  expect(cache.run(input(), build)[0]!.prompt).toBe('Exact plan prompt');
  expect(build).toHaveBeenCalledTimes(2);
});

it('evicts the least recently used entry and preserves bounded exact plans', () => {
  const cache = createCapabilityPlanCache({ entries: 2 }), a = input(), b = input(), c = input();
  b.inputLimit--; c.inputLimit -= 2;
  const buildA = jest.fn(() => plan('A')), buildB = jest.fn(() => plan('B')), buildC = jest.fn(() => plan('C'));
  cache.run(a, buildA); cache.run(b, buildB); cache.run(a, buildA); cache.run(c, buildC);
  expect(cache.run(a, buildA)[0]!.prompt).toBe('A');
  expect(buildA).toHaveBeenCalledTimes(1);
  cache.run(b, buildB);
  expect(buildB).toHaveBeenCalledTimes(2);
  expect(cache.stats().entries).toBe(2);
});

it('uses serialized-payload bounds and never retains an oversized plan', () => {
  const tiny = plan('A'), probe = createCapabilityPlanCache(); probe.run(input(), () => tiny);
  const cap = probe.stats().serializedBytes, cache = createCapabilityPlanCache({ serializedBytes: cap });
  const build = jest.fn(() => plan('A'.repeat(100)));
  cache.run(input(), build); cache.run(input(), build);
  expect(build).toHaveBeenCalledTimes(2);
  expect(cache.stats()).toMatchObject({ entries: 0, serializedBytes: 0 });
  cache.run(input(), () => tiny);
  expect(cache.stats().serializedBytes).toBe(cap);
});

it('preserves graph sharing, sparse arrays and property order in the input identity', () => {
  const cache = createCapabilityPlanCache(), original = input(), build = jest.fn(() => plan());
  original.sections.push(original.sections[0]!);
  cache.run(original, build);
  const expanded = structuredClone(original); expanded.sections[1] = { ...expanded.sections[0]! };
  cache.run(expanded, build);
  const reordered = structuredClone(expanded), { text, ...section } = reordered.sections[0]!;
  reordered.sections[0] = { text, ...section };
  cache.run(reordered, build);
  const sparse = structuredClone(reordered); sparse.evidence.length = 2;
  cache.run(sparse, build);
  const ownUndefined = structuredClone(sparse); ownUndefined.evidence[1] = undefined as never;
  cache.run(ownUndefined, build);
  expect(build).toHaveBeenCalledTimes(5);
});

it.each([{ entries: 0 }, { entries: 5 }, { serializedBytes: 0 }, { serializedBytes: 16_000_001 }])(
  'refuses invalid or raised process-cache ceilings: %j', limits => {
    expect(() => createCapabilityPlanCache(limits)).toThrow('structure-capability-plan-cache-limit');
  });

it.each(['', 'z'.repeat(64), 'a'.repeat(63)])('refuses an invalid current protocol hash', protocolHash => {
  const cache = createCapabilityPlanCache(), build = jest.fn(() => plan());
  expect(() => cache.run({ ...input(), protocolHash }, build)).toThrow('structure-capability-plan-cache-identity');
  expect(build).not.toHaveBeenCalled();
});
