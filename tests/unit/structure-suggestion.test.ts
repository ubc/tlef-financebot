import {
  canApplySuggestion,
  setSuggestionTopicSelected,
} from '../../client/src/views/instructor/structure';

describe('AI hierarchy suggestion selection', () => {
  it('clears child LOs with a deselected Topic and restores them when reselected', () => {
    const theme = {
      checked: true,
      los: [{ checked: true }, { checked: false }],
    };

    setSuggestionTopicSelected(theme, false);
    expect(theme).toEqual({
      checked: false,
      los: [{ checked: false }, { checked: false }],
    });

    setSuggestionTopicSelected(theme, true);
    expect(theme).toEqual({
      checked: true,
      los: [{ checked: true }, { checked: true }],
    });
  });

  it('requires every selected Topic to contain at least one selected LO', () => {
    expect(canApplySuggestion([
      { checked: true, los: [{ checked: false }] },
    ])).toBe(false);
    expect(canApplySuggestion([
      { checked: true, los: [{ checked: true }] },
      { checked: true, los: [{ checked: false }] },
    ])).toBe(false);
    expect(canApplySuggestion([
      { checked: true, los: [{ checked: true }] },
      { checked: false, los: [{ checked: false }] },
    ])).toBe(true);
  });
});
