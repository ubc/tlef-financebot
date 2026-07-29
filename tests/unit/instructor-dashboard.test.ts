import { checklistActionFor } from '../../client/src/views/instructor/dashboard';

describe('course dashboard checklist actions', () => {
  it.each([
    ['Term dates set', 'Set dates', '/settings'],
    ['At least one Theme', 'Add Topic', '/structure'],
    ['At least one Learning Objective', 'Add LO', '/structure'],
    ['Registration code generated', 'Open Settings', '/settings'],
    ['Every LO has ≥3 Approved questions', 'Generate Questions', '/preseeding'],
  ])('maps “%s” to its recovery screen', (label, text, pathSuffix) => {
    const action = checklistActionFor(label);
    expect(action?.text).toBe(text);
    expect(action?.path.endsWith(pathSuffix)).toBe(true);
  });

  it('leaves an unknown future checklist item without a misleading destination', () => {
    expect(checklistActionFor('Unknown requirement')).toBeUndefined();
  });
});
