// Pure-logic tests for the TA views' shared helpers. DOM-free by design —
// see client/src/views/ta/ta-ui.ts.
import {
  buildSuggestionPatch,
  pendingSuggestionCount,
  topicLoLabel,
  type CourseOutlineForLabel,
} from '../../client/src/views/ta/ta-ui';

const outline: CourseOutlineForLabel = {
  themes: [
    { _id: 't1', name: 'Time Value of Money', order: 0, los: [{ _id: 'l1', name: 'Discounting', order: 0 }, { _id: 'l2', name: 'Annuities', order: 1 }] },
    { _id: 't2', name: 'Risk', order: 1, los: [{ _id: 'l3', name: 'Beta', order: 0 }] },
  ],
};

describe('topicLoLabel', () => {
  it('numbers topics and LOs by position, one-indexed', () => {
    expect(topicLoLabel(outline, ['l2'], [])).toBe('Topic 1 / LO 2');
  });

  it('joins multiple LOs within a topic and multiple topics with a semicolon', () => {
    expect(topicLoLabel(outline, ['l1', 'l2'], [])).toBe('Topic 1 / LO 1, LO 2');
    expect(topicLoLabel(outline, ['l1', 'l3'], [])).toBe('Topic 1 / LO 1; Topic 2 / LO 1');
  });

  it('falls back to the bare topic when only a themeId matches', () => {
    expect(topicLoLabel(outline, [], ['t2'])).toBe('Topic 2');
  });

  it('renders an em dash when nothing matches', () => {
    expect(topicLoLabel(outline, ['nope'], [])).toBe('—');
    expect(topicLoLabel(outline, [], [])).toBe('—');
  });
});

describe('pendingSuggestionCount', () => {
  const at = '2026-08-01T00:00:00.000Z';
  it('counts only pending suggestions', () => {
    expect(pendingSuggestionCount({ suggestions: [
      { id: 's1', puid: 'p', patch: { stem: 'a' }, status: 'pending', at },
      { id: 's2', puid: 'p', patch: { stem: 'b' }, status: 'accepted', at },
      { id: 's3', puid: 'p', patch: { stem: 'c' }, status: 'discarded', at },
    ] })).toBe(1);
  });

  it('is 0 for an empty list', () => {
    expect(pendingSuggestionCount({ suggestions: [] })).toBe(0);
  });
});

describe('buildSuggestionPatch', () => {
  const original = { stem: 'What is NPV?', difficulty: 'medium' as const };

  it('returns null when nothing changed — an empty suggestion is never submitted', () => {
    expect(buildSuggestionPatch(original, { stem: 'What is NPV?', difficulty: 'medium' })).toBeNull();
  });

  it('returns null when the draft stem is only whitespace', () => {
    expect(buildSuggestionPatch(original, { stem: '   ', difficulty: 'medium' })).toBeNull();
  });

  it('includes only the fields that actually changed', () => {
    expect(buildSuggestionPatch(original, { stem: 'What is net present value?', difficulty: 'medium' }))
      .toEqual({ stem: 'What is net present value?' });
    expect(buildSuggestionPatch(original, { stem: 'What is NPV?', difficulty: 'hard' }))
      .toEqual({ difficulty: 'hard' });
    expect(buildSuggestionPatch(original, { stem: 'Define NPV.', difficulty: 'hard' }))
      .toEqual({ stem: 'Define NPV.', difficulty: 'hard' });
  });
});
