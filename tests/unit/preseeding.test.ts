// Pure-logic tests for the Pre-seeding Coverage view's threshold rule, thin-LO
// selection, and preset-prompt starters (N9 + I12, Task 15 Task G). No DOM
// needed — `coverageStatus`/`thinLos`/`presetPrompt` are plain data/string
// logic; importing preseeding.ts also pulls in dom.ts's `el` (DOM-touching)
// and api.ts, but merely importing doesn't execute any document access, same
// as review-queue.test.ts/question-bank-helpers.test.ts. See
// client/src/views/instructor/preseeding.ts.
import {
  addSecondaryLo,
  coverageStatus,
  difficultyAfterSecondaryChange,
  generationErrorMessage,
  isActiveRun,
  materialMentionToken,
  runStatusLabel,
  presetPrompt,
  secondaryLosAfterPrimaryChange,
  thinLos,
  MAX_SECONDARY_LOS,
  PRESET_TEMPLATES,
  THIN_THRESHOLD,
  type PresetTemplateId,
} from '../../client/src/views/instructor/preseeding';
import type { PreseedingLo } from '../../client/src/api';

function lo(overrides: Partial<PreseedingLo> = {}): PreseedingLo {
  return { loId: 'lo-1', loName: 'LO 1', approved: 0, reviewed: 0, unapproved: 0, target: 5, ...overrides };
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

describe('materialMentionToken', () => {
  it('uses the plain @filename form when the material name has no spaces', () => {
    expect(materialMentionToken('lecture-3.pdf')).toBe('@lecture-3.pdf');
  });

  it('quotes material names containing spaces for exact server resolution', () => {
    expect(materialMentionToken('Lecture 3.pdf')).toBe('@"Lecture 3.pdf"');
  });
});

describe('generationErrorMessage', () => {
  it('translates the missing-assignment domain code into an actionable message', () => {
    expect(generationErrorMessage('generation-no-assigned-materials')).toContain('Assign at least one');
  });

  it('preserves an unknown message so diagnostics are not hidden', () => {
    expect(generationErrorMessage('unexpected-provider-error')).toBe('unexpected-provider-error');
  });

  it('explains an ended run without calling it a failure', () => {
    expect(generationErrorMessage('generation-ended')).toMatch(/Ended by an instructor/);
  });
});

describe('ending generation runs', () => {
  const error = (code: string) => ({ code, message: code, atStage: 'generating', retryable: true });

  it('labels an instructor-ended run "ended" and every other status as itself', () => {
    expect(runStatusLabel({ status: 'failed', error: error('generation-ended') })).toBe('ended');
    expect(runStatusLabel({ status: 'failed', error: error('server-restarted') })).toBe('failed');
    expect(runStatusLabel({ status: 'running' })).toBe('running');
  });

  it('offers End only while a run is queued or running', () => {
    expect(isActiveRun({ status: 'queued' })).toBe(true);
    expect(isActiveRun({ status: 'running' })).toBe(true);
    expect(isActiveRun({ status: 'partial' })).toBe(false);
    expect(isActiveRun({ status: 'failed' })).toBe(false);
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

describe('multi-LO secondary objective picks', () => {
  it('adds a new objective and refuses an empty pick, the primary, a duplicate, and a full list', () => {
    expect(addSecondaryLo([], 'lo-2', 'lo-1')).toEqual(['lo-2']);
    expect(addSecondaryLo(['lo-2'], 'lo-3', 'lo-1')).toEqual(['lo-2', 'lo-3']);
    expect(addSecondaryLo([], '', 'lo-1')).toEqual([]);
    expect(addSecondaryLo([], 'lo-1', 'lo-1')).toEqual([]);
    expect(addSecondaryLo(['lo-2'], 'lo-2', 'lo-1')).toEqual(['lo-2']);
    expect(addSecondaryLo(['lo-2', 'lo-3'], 'lo-4', 'lo-1')).toEqual(['lo-2', 'lo-3']);
    expect(MAX_SECONDARY_LOS).toBe(2);
  });

  it('never mutates the list it was given', () => {
    const current = ['lo-2'];
    addSecondaryLo(current, 'lo-3', 'lo-1');
    expect(current).toEqual(['lo-2']);
  });

  it('drops a secondary objective that becomes the primary, keeping the rest in order', () => {
    expect(secondaryLosAfterPrimaryChange(['lo-2', 'lo-3'], 'lo-2')).toEqual(['lo-3']);
    expect(secondaryLosAfterPrimaryChange(['lo-2', 'lo-3'], 'lo-9')).toEqual(['lo-2', 'lo-3']);
  });

  it('moves difficulty to hard when the first secondary is added, and never otherwise', () => {
    expect(difficultyAfterSecondaryChange('medium', 0, 1)).toBe('hard');
    expect(difficultyAfterSecondaryChange('easy', 0, 1)).toBe('hard');
    // The instructor's later choice stands: a second addition, or a removal.
    expect(difficultyAfterSecondaryChange('medium', 1, 2)).toBe('medium');
    expect(difficultyAfterSecondaryChange('medium', 1, 0)).toBe('medium');
    // A refused add (list unchanged) changes nothing.
    expect(difficultyAfterSecondaryChange('medium', 0, 0)).toBe('medium');
  });

  it('maps the secondary-objective server codes to instructor-facing text', () => {
    expect(generationErrorMessage('generation-secondary-lo-no-materials')).toMatch(/no ready assigned material/);
    expect(generationErrorMessage('generation-secondary-lo-duplicate: lo-2')).toMatch(/chosen once/);
  });
});
