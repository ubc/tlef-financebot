// Pure-logic tests for the Pre-seeding Coverage view's threshold rule, thin-LO
// selection, and preset-prompt starters (N9 + I12, Task 15 Task G). No DOM
// needed — `coverageStatus`/`thinLos`/`presetPrompt` are plain data/string
// logic; importing preseeding.ts also pulls in dom.ts's `el` (DOM-touching)
// and api.ts, but merely importing doesn't execute any document access, same
// as review-queue.test.ts/question-bank-helpers.test.ts. See
// client/src/views/instructor/preseeding.ts.
import {
  coverageStatus,
  presetPrompt,
  thinLos,
  PRESET_TEMPLATES,
  THIN_THRESHOLD,
  type PresetTemplateId,
} from '../../client/src/views/instructor/preseeding';
import type { PreseedingLo } from '../../client/src/api';

function lo(overrides: Partial<PreseedingLo> = {}): PreseedingLo {
  return { loId: 'lo-1', loName: 'LO 1', approved: 0, reviewed: 0, target: 5, ...overrides };
}

describe('coverageStatus', () => {
  it('is "empty" when approved is 0', () => {
    expect(coverageStatus(0, 3)).toBe('empty');
  });

  it('is "below-target" when approved is above 0 but under the threshold', () => {
    expect(coverageStatus(1, 3)).toBe('below-target');
    expect(coverageStatus(2, 3)).toBe('below-target');
  });

  it('is "at-target" when approved meets or exceeds the threshold', () => {
    expect(coverageStatus(3, 3)).toBe('at-target');
    expect(coverageStatus(5, 3)).toBe('at-target');
  });

  it('never goes negative — a negative approved count still reads "empty"', () => {
    expect(coverageStatus(-1, 3)).toBe('empty');
  });
});

describe('THIN_THRESHOLD', () => {
  it('is 3 — the Task 8 "below 3 approved" highlight rule, independent of the API target', () => {
    expect(THIN_THRESHOLD).toBe(3);
  });
});

describe('thinLos', () => {
  it('returns only the LOs below the thin threshold (below-target and empty), in order', () => {
    const los = [lo({ loId: 'a', approved: 5 }), lo({ loId: 'b', approved: 2 }), lo({ loId: 'c', approved: 0 })];
    expect(thinLos(los).map((l) => l.loId)).toEqual(['b', 'c']);
  });

  it('returns an empty array when every LO is at target', () => {
    expect(thinLos([lo({ approved: 3 }), lo({ approved: 10 })])).toEqual([]);
  });

  it('returns an empty array for an empty list', () => {
    expect(thinLos([])).toEqual([]);
  });
});

describe('presetPrompt', () => {
  const ids = PRESET_TEMPLATES.map((t) => t.id);

  it('covers all four preset templates declared in PRESET_TEMPLATES', () => {
    expect(ids).toHaveLength(4);
  });

  it('returns non-empty starter text for every preset template id', () => {
    for (const id of ids) {
      expect(presetPrompt(id).length).toBeGreaterThan(0);
    }
  });

  it('returns distinct text per template (chips fill in different starters)', () => {
    const texts = new Set(ids.map((id) => presetPrompt(id)));
    expect(texts.size).toBe(ids.length);
  });

  it('returns the same text for the same id (pure/deterministic)', () => {
    const id: PresetTemplateId = 'numerical-parameterized';
    expect(presetPrompt(id)).toBe(presetPrompt(id));
  });
});
