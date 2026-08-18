import type { ParamSlot } from '../../server/src/types/domain';

jest.mock('../../server/src/components/param-worker', () => ({
  executeGenerate: jest.fn(),
}));

import { executeGenerate } from '../../server/src/components/param-worker';
import {
  drawCollisionFreeParams,
  drawQuestionSample,
  resolveParamValues,
  stableSeedsForId,
  substituteParams,
  findUnusedParamSlots,
  seededRandom,
  SERVE_DRAW_ATTEMPTS,
} from '../../server/src/services/params.service';

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

    it('substitutes a placeholder nested inside a LaTeX brace group', () => {
      // Displayed text is markdown + KaTeX (GENERATOR_PROMPT's FORMATTING
      // block), so a placeholder can legitimately sit inside `{}`. The name
      // pattern must start with a letter, so in `{{{PV}}}` the match starts at
      // the SECOND brace and LaTeX's own braces survive.
      expect(substituteParams(String.raw`$\frac{{{PV}}}{2}$`, { PV: 429.07 })).toBe(String.raw`$\frac{429.07}{2}$`);
      expect(substituteParams(String.raw`$\sqrt{{{X}}}$`, { X: 16 })).toBe(String.raw`$\sqrt{16}$`);
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

  // Serve-time guard (Saurav's design, 2026-08-17): redraw when two options
  // would DISPLAY identically. Two collision classes reach a serve despite a
  // proof — the proof samples 100 draws rather than enumerating, and proofs
  // stored before display-precision checking compared raw doubles.
  describe('drawCollisionFreeParams', () => {
    const option = (key: string, text: string) =>
      ({ key, text, role: 'correct' as const, explanation: '' });

    // X draws 1 or 2. B is the constant 2, so X=2 renders options A and B
    // identically ("2" vs "2") while X=1 is clean ("1" vs "2").
    const version = {
      paramSlots: [{ name: 'X', min: 1, max: 2, step: 1 }],
      derivedValues: [
        { name: 'A', formula: 'X' },
        { name: 'B', formula: '2' },
      ],
      options: [option('A', '{{A}}'), option('B', '{{B}}')],
    };

    /** Finds real seeds producing each X, so the test drives the guard through
     * the genuine resolution path instead of mocking it. */
    async function seedsFor(): Promise<{ colliding: number; clean: number }> {
      let colliding = -1;
      let clean = -1;
      for (let seed = 0; seed < 100 && (colliding < 0 || clean < 0); seed += 1) {
        const values = await resolveParamValues(version, seed);
        if (values!.X === 2 && colliding < 0) colliding = seed;
        if (values!.X === 1 && clean < 0) clean = seed;
      }
      return { colliding, clean };
    }

    it('returns the first draw when nothing collides', async () => {
      const { clean } = await seedsFor();
      const seedFn = jest.fn(() => clean);
      const result = await drawCollisionFreeParams(version, seedFn);
      expect(result.seed).toBe(clean);
      expect(seedFn).toHaveBeenCalledTimes(1);
    });

    it('redraws past a display collision and returns the clean seed', async () => {
      const { colliding, clean } = await seedsFor();
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const seeds = [colliding, clean];
      const result = await drawCollisionFreeParams(version, () => seeds.shift()!);
      expect(result.seed).toBe(clean);
      expect(result.paramValues!.X).toBe(1);
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });

    it('gives up after SERVE_DRAW_ATTEMPTS and serves the last draw anyway', async () => {
      // A always equals B ("X" vs "X") — no reroll can fix it. Serving anyway
      // is deliberate: never worse than the behaviour this replaces, and a
      // question colliding on EVERY draw cannot hold a verification proof.
      const hopeless = { ...version, derivedValues: [{ name: 'A', formula: 'X' }, { name: 'B', formula: 'X' }] };
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      let calls = 0;
      const result = await drawCollisionFreeParams(hopeless, () => { calls += 1; return calls; });
      expect(calls).toBe(SERVE_DRAW_ATTEMPTS);
      expect(result.paramValues).toBeDefined();
      expect(warn).toHaveBeenCalledTimes(SERVE_DRAW_ATTEMPTS);
      warn.mockRestore();
    });

    it('returns immediately for a conceptual question', async () => {
      const seedFn = jest.fn(() => 7);
      const result = await drawCollisionFreeParams(
        { options: [option('A', 'Statement one'), option('B', 'Statement two')] },
        seedFn,
      );
      expect(result.paramValues).toBeUndefined();
      expect(seedFn).toHaveBeenCalledTimes(1);
    });
  });
});

// The list-row student preview (2026-08-17). Saurav asked for rows to read as a
// student sees them, "so it's easier on the eyes without the variables".
describe('drawQuestionSample — the instructor-facing student preview', () => {
  const version = {
    stem: 'Discount {{AMOUNT}} at {{RATE}}%.',
    paramSlots: [
      { name: 'AMOUNT', min: 100, max: 900, step: 100 },
      { name: 'RATE', min: 3, max: 9, step: 1 },
    ] as ParamSlot[],
    derivedValues: [],
    options: [
      { key: 'A', text: '{{AMOUNT}} at {{RATE}}%', role: 'correct' as const, explanation: '' },
      { key: 'B', text: 'half of {{AMOUNT}}', role: 'clearly-wrong' as const, explanation: '' },
    ],
  };

  it('substitutes every placeholder out of the stem and options', async () => {
    const sample = await drawQuestionSample(version, () => 4242);
    expect(sample.parameterized).toBe(true);
    // No placeholder survives, in EITHER notation — the whole point of the row.
    expect(sample.stem).not.toMatch(/\{\{|\}\}/);
    expect(sample.stem).toMatch(/^Discount \d+ at \d+%\.$/);
    expect(sample.options.map((o) => o.text).join(' ')).not.toMatch(/\{\{/);
  });

  // Explanations are carried so instructor surfaces can RENDER the rationale
  // instead of showing LaTeX source (Saurav, 2026-08-17: a `\frac{...}` chain
  // in the editing textarea "can be very hard to read").
  it('carries each option EXPLANATION, substituted like the text', async () => {
    const withExplanations = {
      ...version,
      options: [
        { key: 'A', text: '{{AMOUNT}}', role: 'correct' as const, explanation: 'Discount {{AMOUNT}} once at {{RATE}}%.' },
        { key: 'B', text: 'half', role: 'clearly-wrong' as const, explanation: 'Halving ignores the {{RATE}}% rate.' },
      ],
    };
    const sample = await drawQuestionSample(withExplanations, () => 4242);
    // Substituted, not raw: the student's card substitutes explanations too, so
    // an instructor reading `{{RATE}}` here would see something no student does.
    expect(sample.options[0].explanation).toMatch(/^Discount \d+ once at \d+%\.$/);
    expect(sample.options.map((o) => o.explanation).join(' ')).not.toMatch(/\{\{/);
  });

  it('carries explanations for a conceptual question too, unsubstituted', async () => {
    const conceptual = {
      stem: 'Why does diversification reduce unsystematic risk?',
      paramSlots: [] as ParamSlot[],
      derivedValues: [],
      options: [{ key: 'A', text: 'Shocks offset', role: 'correct' as const, explanation: 'Uncorrelated shocks cancel.' }],
    };
    const sample = await drawQuestionSample(conceptual, () => 7);
    expect(sample.options[0].explanation).toBe('Uncorrelated shocks cancel.');
  });

  it('tolerates an option with no explanation at all', async () => {
    const noExplanation = {
      ...version,
      options: [{ key: 'A', text: '{{AMOUNT}}', role: 'correct' as const }],
    } as unknown as Parameters<typeof drawQuestionSample>[0];
    const sample = await drawQuestionSample(noExplanation, () => 1);
    expect(sample.options[0].explanation).toBe('');
  });

  it('returns the stored text for a CONCEPTUAL question rather than nothing', async () => {
    // question-detail's panel renders nothing when !parameterized, which is
    // right for an "example" but wrong for a row: a conceptual row must still
    // print its stem instead of going blank.
    const conceptual = {
      stem: 'Why does diversification reduce unsystematic risk?',
      paramSlots: [] as ParamSlot[],
      derivedValues: [],
      options: [{ key: 'A', text: 'Shocks offset', role: 'correct' as const, explanation: '' }],
    };
    const sample = await drawQuestionSample(conceptual, () => 7);
    expect(sample.parameterized).toBe(false);
    expect(sample.stem).toBe('Why does diversification reduce unsystematic risk?');
    expect(sample.options[0].text).toBe('Shocks offset');
  });

  it('falls back to the template instead of throwing when a formula is broken', async () => {
    const broken = {
      stem: 'Value is {{BAD}}.',
      paramSlots: [] as ParamSlot[],
      derivedValues: [{ name: 'BAD', formula: 'NOPE(' }],
      options: [{ key: 'A', text: '{{BAD}}', role: 'correct' as const, explanation: '' }],
    };
    const sample = await drawQuestionSample(broken, () => 1);
    expect(sample.parameterized).toBe(false);
    expect(sample.stem).toBe('Value is {{BAD}}.');
  });
});

describe('stableSeedsForId — why list rows do not churn', () => {
  const version = {
    stem: 'Discount {{AMOUNT}} at {{RATE}}%.',
    paramSlots: [
      { name: 'AMOUNT', min: 100, max: 900, step: 100 },
      { name: 'RATE', min: 3, max: 9, step: 1 },
    ] as ParamSlot[],
    derivedValues: [],
    options: [{ key: 'A', text: '{{AMOUNT}}', role: 'correct' as const, explanation: '' }],
  };
  const ID = '507f1f77bcf86cd799439011';

  it('gives the same question the same sample on every render', async () => {
    const first = await drawQuestionSample(version, stableSeedsForId(ID));
    const second = await drawQuestionSample(version, stableSeedsForId(ID));
    // The test that fails if someone swaps in drawSeed(): the numbers would
    // change on every page load, which reads as instability to an instructor
    // re-reading the same row.
    expect(second.stem).toBe(first.stem);
  });

  it('gives DIFFERENT questions different draws, not one shared constant', () => {
    expect(stableSeedsForId(ID)()).not.toBe(stableSeedsForId('507f1f77bcf86cd799439012')());
  });

  it('advances, so the collision guard can still reroll — deterministically', () => {
    const seeds = stableSeedsForId(ID);
    const drawn = [seeds(), seeds(), seeds()];
    expect(new Set(drawn).size).toBe(3);
    const again = stableSeedsForId(ID);
    expect([again(), again(), again()]).toEqual(drawn);
  });
});
