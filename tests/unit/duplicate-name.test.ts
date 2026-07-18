// Pure-logic test for the client-derived duplicate-term warning (N2). No DOM
// needed — findDuplicateCourse is a plain array scan; importing courses.ts
// also pulls in dom.ts/api.ts, but merely importing doesn't execute any
// document access, so this is safe under jest's node test environment. See
// client/src/views/instructor/courses.ts.
import { findDuplicateCourse } from '../../client/src/views/instructor/courses';
import type { InstructorCourse } from '../../client/src/api';

function course(overrides: Partial<InstructorCourse> = {}): InstructorCourse {
  return {
    _id: 'course-1',
    name: 'Introduction to Finance',
    courseCode: 'COMM 298',
    term: 'Winter Term 1, 2026/27',
    published: false,
    ...overrides,
  };
}

describe('findDuplicateCourse', () => {
  it('matches an existing course ignoring case and surrounding whitespace', () => {
    const existing = course();
    const match = findDuplicateCourse([existing], '  comm 298 ', '  WINTER TERM 1, 2026/27  ');
    expect(match).toBe(existing);
  });

  it('returns undefined when the code differs', () => {
    const existing = course();
    expect(findDuplicateCourse([existing], 'COMM 370', 'Winter Term 1, 2026/27')).toBeUndefined();
  });

  it('returns undefined when the term differs', () => {
    const existing = course();
    expect(findDuplicateCourse([existing], 'COMM 298', 'Winter Term 2, 2026/27')).toBeUndefined();
  });

  it('returns undefined for an empty course list', () => {
    expect(findDuplicateCourse([], 'COMM 298', 'Winter Term 1, 2026/27')).toBeUndefined();
  });

  it('returns undefined when code or term is blank', () => {
    const existing = course();
    expect(findDuplicateCourse([existing], '', 'Winter Term 1, 2026/27')).toBeUndefined();
    expect(findDuplicateCourse([existing], 'COMM 298', '   ')).toBeUndefined();
  });

  it('picks the first matching course among several', () => {
    const first = course({ _id: 'a' });
    const second = course({ _id: 'b' });
    expect(findDuplicateCourse([first, second], 'COMM 298', 'Winter Term 1, 2026/27')).toBe(first);
  });
});
