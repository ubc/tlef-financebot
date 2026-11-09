import {
  allocateSlots, angleMenu, CALCULATION_ANGLES, CONCEPTUAL_ANGLES, itemPlan,
} from '../../server/src/services/question-generation/slots';

const base = { type: 'mcq' as const, chunkCount: 6, seed: 'run-a', hardnessMoves: [] as (string | undefined)[] };

describe('angleMenu', () => {
  it('uses the conceptual menu for conceptual and true/false questions', () => {
    expect(angleMenu('conceptual', 'mcq')).toBe(CONCEPTUAL_ANGLES);
    expect(angleMenu('calculation', 'true-false')).toBe(CONCEPTUAL_ANGLES);
  });
  it('uses the calculation menu for calculation MCQs', () => {
    expect(angleMenu('calculation', 'mcq')).toBe(CALCULATION_ANGLES);
  });
  it('interleaves both menus, conceptual first, when kind is unset', () => {
    const menu = angleMenu(undefined, 'mcq');
    expect(menu).toHaveLength(CONCEPTUAL_ANGLES.length + CALCULATION_ANGLES.length);
    expect(menu[0]).toBe(CONCEPTUAL_ANGLES[0]);
    expect(menu[1]).toBe(CALCULATION_ANGLES[0]);
    expect(menu[2]).toBe(CONCEPTUAL_ANGLES[1]);
  });
});

describe('allocateSlots', () => {
  it('gives every slot a distinct angle up to the menu length', () => {
    const slots = allocateSlots({ ...base, count: 5, kind: 'calculation' });
    expect(new Set(slots.map(s => s.angle.id)).size).toBe(5);
    expect(slots.map(s => s.item)).toEqual([0, 1, 2, 3, 4]);
  });
  it('cycles the menu when count exceeds it', () => {
    const slots = allocateSlots({ ...base, count: CONCEPTUAL_ANGLES.length + 1, kind: 'conceptual' });
    expect(slots[CONCEPTUAL_ANGLES.length].angle).toBe(slots[0].angle);
  });
  it('is deterministic for a seed and rotates the start for a different seed', () => {
    const a1 = allocateSlots({ ...base, count: 3, kind: 'conceptual', seed: 'run-a' });
    const a2 = allocateSlots({ ...base, count: 3, kind: 'conceptual', seed: 'run-a' });
    expect(a1).toEqual(a2);
    const starts = new Set(['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8']
      .map(seed => allocateSlots({ ...base, count: 1, kind: 'conceptual', seed })[0].angle.id));
    expect(starts.size).toBeGreaterThan(1);
  });
  it('rotates the chunk focus across retrieved chunks', () => {
    const slots = allocateSlots({ ...base, count: 4, kind: 'conceptual', chunkCount: 3 });
    expect(slots.map(s => s.focusChunk)).toEqual([0, 1, 2, 0]);
  });
  it('has no chunk focus when nothing was retrieved', () => {
    expect(allocateSlots({ ...base, count: 2, kind: 'conceptual', chunkCount: 0 }).map(s => s.focusChunk)).toEqual([undefined, undefined]);
  });
  it('passes hardness moves through by item', () => {
    const slots = allocateSlots({ ...base, count: 2, kind: 'calculation', hardnessMoves: ['move-a', 'move-b'] });
    expect(slots.map(s => s.hardnessMove)).toEqual(['move-a', 'move-b']);
  });
});

describe('itemPlan', () => {
  const slot = allocateSlots({ ...base, count: 2, kind: 'conceptual' })[1];
  const at = new Date('2026-11-09T10:00:00Z');

  it('names the slot angle and quotes its focus chunk with collapsed whitespace', () => {
    const chunks = [{ text: 'first' }, { materialId: 'm2', text: '  Inertia   is\n the tendency…  ', supporting: true }];
    expect(itemPlan(slot, chunks, at)).toEqual({
      item: 1, startedAt: at, angleId: slot.angle.id, angleLabel: slot.angle.label,
      source: { materialId: 'm2', excerpt: 'Inertia is the tendency…', supporting: true },
    });
  });

  it('bounds the excerpt and omits the source when the slot has no chunk', () => {
    const long = itemPlan({ ...slot, focusChunk: 0 }, [{ text: 'x'.repeat(900) }], at);
    expect(long.source!.excerpt).toHaveLength(601);
    expect(long.source!.excerpt.endsWith('…')).toBe(true);
    expect(itemPlan({ ...slot, focusChunk: undefined }, [], at).source).toBeUndefined();
  });

  it('gives every angle an instructor-facing label', () => {
    for (const angle of [...CONCEPTUAL_ANGLES, ...CALCULATION_ANGLES]) expect(angle.label.length).toBeGreaterThan(3);
  });
});
