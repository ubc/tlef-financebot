// Pure-logic tests for the Materials view's (I3) shared assignment helpers —
// the classification confidence->label mapping, the assignment-summary
// formatter, and the add/remove assignment mutators reused by both the
// Materials view's "Assign Material" panel (n3) and Structure's (I2) LO
// detail "Assigned Course Materials" panel. No DOM needed — these are plain
// data transforms; importing the module also pulls in dom.ts/api.ts, but
// merely importing doesn't execute any document access, so this is safe
// under jest's node test environment. See
// client/src/views/instructor/material-assign.ts.
import {
  addAssignment,
  assignmentSummary,
  classificationLabel,
  removeAssignment,
} from '../../client/src/views/instructor/material-assign';
import type { CourseTree, Material } from '../../client/src/api';

function tree(): CourseTree {
  return {
    course: {
      _id: 'course-1',
      name: 'Intro to Finance',
      courseCode: 'COMM 298',
      term: 'Winter Term 1, 2026/27',
      published: false,
      feedbackStrategy: 'adaptive',
      autoPause: { minAttempts: 5, flagPercent: 30, flagCount: 15 },
    },
    themes: [
      {
        _id: 'theme-1',
        name: 'Time Value of Money',
        order: 0,
        los: [
          { _id: 'lo-1', name: 'Present & future value', order: 0, themeId: 'theme-1' },
          { _id: 'lo-2', name: 'Annuities & perpetuities', order: 1, themeId: 'theme-1' },
          { _id: 'lo-3', name: 'Compounding frequency', order: 2, themeId: 'theme-1' },
        ],
      },
      {
        _id: 'theme-2',
        name: 'Risk & Return',
        order: 1,
        los: [
          { _id: 'lo-4', name: 'Expected return & variance', order: 0, themeId: 'theme-2' },
          { _id: 'lo-5', name: 'Diversification & beta', order: 1, themeId: 'theme-2' },
        ],
      },
    ],
  };
}

function material(overrides: Partial<Material> = {}): Material {
  return {
    _id: 'material-1',
    courseId: 'course-1',
    name: 'lecture-slides-ch1.pdf',
    format: 'pdf',
    status: 'ready',
    assignments: [],
    uploadedAt: '2026-06-12T00:00:00.000Z',
    ...overrides,
  };
}

describe('classificationLabel', () => {
  it('returns High at or above 0.8', () => {
    expect(classificationLabel(0.8)).toBe('High');
    expect(classificationLabel(0.95)).toBe('High');
  });

  it('returns Medium at or above 0.5 and below 0.8', () => {
    expect(classificationLabel(0.5)).toBe('Medium');
    expect(classificationLabel(0.79)).toBe('Medium');
  });

  it('returns No match below 0.5', () => {
    expect(classificationLabel(0.49)).toBe('No match');
    expect(classificationLabel(0)).toBe('No match');
  });
});

describe('assignmentSummary', () => {
  it('returns Unassigned for a material with no assignments', () => {
    expect(assignmentSummary(material(), tree())).toBe('Unassigned');
  });

  it('formats a single LO', () => {
    const m = material({ assignments: [{ themeId: 'theme-2', loId: 'lo-5' }] });
    expect(assignmentSummary(m, tree())).toBe('Topic 2, LO 2');
  });

  it('collapses a contiguous run of LOs into a range', () => {
    const m = material({
      assignments: [
        { themeId: 'theme-1', loId: 'lo-1' },
        { themeId: 'theme-1', loId: 'lo-2' },
        { themeId: 'theme-1', loId: 'lo-3' },
      ],
    });
    expect(assignmentSummary(m, tree())).toBe('Topic 1, LO 1-3');
  });

  it('lists non-contiguous LOs individually', () => {
    const m = material({
      assignments: [
        { themeId: 'theme-1', loId: 'lo-1' },
        { themeId: 'theme-1', loId: 'lo-3' },
      ],
    });
    expect(assignmentSummary(m, tree())).toBe('Topic 1, LO 1, 3');
  });

  it('joins assignments spanning multiple Topics', () => {
    const m = material({
      assignments: [
        { themeId: 'theme-1', loId: 'lo-1' },
        { themeId: 'theme-2', loId: 'lo-4' },
      ],
    });
    expect(assignmentSummary(m, tree())).toBe('Topic 1, LO 1; Topic 2, LO 1');
  });

  it('formats a theme-only assignment (no loId) as just the Topic', () => {
    const m = material({ assignments: [{ themeId: 'theme-2' }] });
    expect(assignmentSummary(m, tree())).toBe('Topic 2');
  });
});

describe('addAssignment', () => {
  it('appends a new themeId/loId pair', () => {
    const result = addAssignment([], 'theme-1', 'lo-1');
    expect(result).toEqual([{ themeId: 'theme-1', loId: 'lo-1' }]);
  });

  it('does not duplicate an existing pair', () => {
    const existing = [{ themeId: 'theme-1', loId: 'lo-1' }];
    expect(addAssignment(existing, 'theme-1', 'lo-1')).toEqual(existing);
  });

  it('leaves the input array untouched (returns a new array)', () => {
    const existing = [{ themeId: 'theme-1', loId: 'lo-1' }];
    const result = addAssignment(existing, 'theme-2', 'lo-4');
    expect(existing).toHaveLength(1);
    expect(result).toHaveLength(2);
  });

  it('supports a theme-only assignment when loId is omitted', () => {
    expect(addAssignment([], 'theme-1')).toEqual([{ themeId: 'theme-1' }]);
  });
});

describe('removeAssignment', () => {
  it('removes a matching themeId/loId pair', () => {
    const existing = [
      { themeId: 'theme-1', loId: 'lo-1' },
      { themeId: 'theme-1', loId: 'lo-2' },
    ];
    expect(removeAssignment(existing, 'theme-1', 'lo-1')).toEqual([{ themeId: 'theme-1', loId: 'lo-2' }]);
  });

  it('is a no-op when nothing matches', () => {
    const existing = [{ themeId: 'theme-1', loId: 'lo-1' }];
    expect(removeAssignment(existing, 'theme-2', 'lo-9')).toEqual(existing);
  });
});
