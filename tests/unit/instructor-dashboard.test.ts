import { checklistActionFor, workflowActionPath } from '../../client/src/views/instructor/dashboard';

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

  it('keeps the term-date fix in Course Home while retaining Settings as the fallback path', () => {
    expect(checklistActionFor('Term dates set')).toMatchObject({
      command: 'configure-dates',
      path: '/instructor/course/:id/settings',
    });
  });
});

describe('course cockpit workflow destinations', () => {
  it.each([
    ['settings', '/settings'],
    ['structure', '/structure'],
    ['materials', '/materials'],
    ['content-map', '/content-map'],
    ['preseeding', '/preseeding'],
    ['review-queue', '/queue'],
    ['bank', '/bank'],
    ['flags', '/flags'],
    ['analytics', '/analytics'],
  ] as const)('maps %s to its course screen', (destination, suffix) => {
    expect(workflowActionPath(destination, 'course id')).toBe(
      `/instructor/course/course%20id${suffix}`,
    );
  });

  it('maps Preview into the isolated student shell and keeps dashboard commands local', () => {
    expect(workflowActionPath('student-preview', 'abc')).toBe('/preview/course/abc');
    expect(workflowActionPath('dashboard', 'abc')).toBeNull();
  });
});
