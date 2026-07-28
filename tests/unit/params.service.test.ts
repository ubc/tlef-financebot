import type { ParamSlot } from '../../server/src/types/domain';

jest.mock('../../server/src/components/param-worker', () => ({
  executeGenerate: jest.fn(),
}));

import { executeGenerate } from '../../server/src/components/param-worker';
import { resolveParamValues, substituteParams, findUnusedParamSlots, seededRandom } from '../../server/src/services/params.service';

const mockExecuteGenerate = executeGenerate as jest.Mock;

describe('params.service', () => {
  afterEach(() => jest.clearAllMocks());

  describe('resolveParamValues — slot draw', () => {
    const rateSlot: ParamSlot = { name: 'rate', min: 1, max: 10, step: 1 };

    it('respects min/max/step (every draw across many seeds lands on an allowed step)', async () => {
      for (let seed = 0; seed < 200; seed += 1) {
        const values = await resolveParamValues({ paramSlots: [rateSlot] }, seed);
        expect(values).toBeDefined();
        const v = values!.rate;
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(10);
        expect((v - 1) % 1).toBe(0);
      }
    });

    it('is seed-deterministic: same seed -> identical draw, different seed -> (typically) different draw', async () => {
      const a = await resolveParamValues({ paramSlots: [{ name: 'x', min: 0, max: 1000, step: 1 }] }, 42);
      const b = await resolveParamValues({ paramSlots: [{ name: 'x', min: 0, max: 1000, step: 1 }] }, 42);
      const c = await resolveParamValues({ paramSlots: [{ name: 'x', min: 0, max: 1000, step: 1 }] }, 43);
      expect(a).toEqual(b);
      expect(a).not.toEqual(c);
    });

    it('draws from a fine step correctly (e.g. step 0.5 over [0,2])', async () => {
      const slot: ParamSlot = { name: 'p', min: 0, max: 2, step: 0.5 };
      const seen = new Set<number>();
      for (let seed = 0; seed < 100; seed += 1) {
        const values = await resolveParamValues({ paramSlots: [slot] }, seed);
        seen.add(values!.p);
      }
      for (const v of seen) {
        expect([0, 0.5, 1, 1.5, 2]).toContain(v);
      }
    });

    it('picks from an explicit `values` set (seeded) instead of min/max/step when given', async () => {
      const slot: ParamSlot = { name: 'choice', values: [3, 7, 11] };
      for (let seed = 0; seed < 50; seed += 1) {
        const values = await resolveParamValues({ paramSlots: [slot] }, seed);
        expect([3, 7, 11]).toContain(values!.choice);
      }
    });

    it('resolves multiple slots from the same seed deterministically', async () => {
      const slots: ParamSlot[] = [
        { name: 'a', min: 0, max: 5, step: 1 },
        { name: 'b', min: 100, max: 200, step: 10 },
      ];
      const first = await resolveParamValues({ paramSlots: slots }, 7);
      const second = await resolveParamValues({ paramSlots: slots }, 7);
      expect(first).toEqual(second);
      expect(Object.keys(first!).sort()).toEqual(['a', 'b']);
    });

    it('returns undefined when neither generateScript nor paramSlots is present', async () => {
      await expect(resolveParamValues({}, 1)).resolves.toBeUndefined();
      await expect(resolveParamValues({ paramSlots: [] }, 1)).resolves.toBeUndefined();
    });
  });

  describe('resolveParamValues — generateScript delegates to the sandbox', () => {
    it('calls executeGenerate(script, seed) and returns its resolved vars verbatim, without touching paramSlots', async () => {
      mockExecuteGenerate.mockResolvedValue({ rate: 4.5, principal: 1200 });
      const values = await resolveParamValues(
        { generateScript: 'function generate(random){ return { vars: { rate: 4.5, principal: 1200 } }; }', paramSlots: [{ name: 'ignored', min: 0, max: 1 }] },
        99,
      );
      expect(mockExecuteGenerate).toHaveBeenCalledWith(expect.stringContaining('function generate'), 99);
      expect(mockExecuteGenerate).toHaveBeenCalledTimes(1);
      expect(values).toEqual({ rate: 4.5, principal: 1200 });
    });

    it('propagates a sandbox rejection (e.g. param-timeout) to the caller', async () => {
      mockExecuteGenerate.mockRejectedValue(new Error('param-timeout'));
      await expect(
        resolveParamValues({ generateScript: 'function generate(){ while(true){} }' }, 1),
      ).rejects.toThrow('param-timeout');
    });
  });

  describe('substituteParams', () => {
    it('substitutes a placeholder in the stem', () => {
      expect(substituteParams('A loan of {{principal}} at {{rate}}%.', { principal: 1000, rate: 5 })).toBe(
        'A loan of 1000 at 5%.',
      );
    });

    it('substitutes placeholders in option text and explanation strings (same function, called per-string)', () => {
      const values = { rate: 5 };
      expect(substituteParams('The rate is {{rate}}%', values)).toBe('The rate is 5%');
      expect(substituteParams('Because {{rate}} > 3, this is correct.', values)).toBe('Because 5 > 3, this is correct.');
    });

    it('leaves an unmatched placeholder verbatim rather than blanking it', () => {
      expect(substituteParams('{{known}} and {{unknown}}', { known: 1 })).toBe('1 and {{unknown}}');
    });

    it('is a no-op on text with no placeholders', () => {
      expect(substituteParams('plain text', { x: 1 })).toBe('plain text');
    });
  });

  describe('findUnusedParamSlots — validation warnings', () => {
    it('flags a defined slot with no matching {{placeholder}} in the stem', () => {
      const warnings = findUnusedParamSlots('The rate is {{rate}}%.', [
        { name: 'rate', min: 1, max: 10 },
        { name: 'principal', min: 100, max: 1000 },
      ]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/principal/);
    });

    it('returns no warnings when every slot is referenced', () => {
      const warnings = findUnusedParamSlots('{{a}} and {{b}}', [{ name: 'a' }, { name: 'b' }]);
      expect(warnings).toEqual([]);
    });

    it('returns no warnings for an empty slot list', () => {
      expect(findUnusedParamSlots('no placeholders here', [])).toEqual([]);
    });
  });

  describe('seededRandom', () => {
    it('produces the same sequence for the same seed', () => {
      const r1 = seededRandom(123);
      const r2 = seededRandom(123);
      const seq1 = [r1(), r1(), r1()];
      const seq2 = [r2(), r2(), r2()];
      expect(seq1).toEqual(seq2);
    });

    it('produces values in [0, 1)', () => {
      const r = seededRandom(5);
      for (let i = 0; i < 50; i += 1) {
        const v = r();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    });
  });
});
