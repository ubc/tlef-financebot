import { ObjectId } from 'mongodb';
import { enrollByCode, EnrollmentError, listEnrollments } from '../../server/src/services/enrollment.service';
import { coursesCol, rosterCol, usersCol, lmsRosterEntriesCol } from '../../server/src/components/mongodb/collections';
import type { User } from '../../server/src/types/domain';

jest.mock('../../server/src/components/mongodb/collections', () => ({
  coursesCol: jest.fn(),
  rosterCol: jest.fn(),
  usersCol: jest.fn(),
  lmsRosterEntriesCol: jest.fn(),
}));

const coursesFindOne = jest.fn();
const rosterFindOne = jest.fn();
const usersUpdateOne = jest.fn();
const lmsFindOne = jest.fn();

beforeEach(() => {
  coursesFindOne.mockReset();
  rosterFindOne.mockReset();
  usersUpdateOne.mockReset();
  jest.mocked(coursesCol).mockReturnValue({ findOne: coursesFindOne } as never);
  jest.mocked(rosterCol).mockReturnValue({ findOne: rosterFindOne } as never);
  jest.mocked(usersCol).mockReturnValue({ updateOne: usersUpdateOne } as never);
  // Phase 6: default to "not on the Canvas roster" so every pre-existing case
  // runs unchanged.
  lmsFindOne.mockReset().mockResolvedValue(null);
  jest.mocked(lmsRosterEntriesCol).mockReturnValue({ findOne: lmsFindOne } as never);
});

const courseId = new ObjectId();
const activeCourse = {
  _id: courseId,
  name: 'Intro Finance',
  courseCode: 'COMM 298',
  published: true,
  termEnd: new Date(Date.now() + 86_400_000),
};
const student = { puid: 'P1', uid: 'student1', email: 's1@ubc.ca', courseRoles: [] } as unknown as User;

describe('enrollByCode (ST-E02, ST-E03)', () => {
  it('enrolls when code matches and the CWL identity is on the roster', async () => {
    coursesFindOne.mockResolvedValue(activeCourse);
    rosterFindOne.mockResolvedValue({ courseId, identifier: 'student1' });
    usersUpdateOne.mockResolvedValue({});
    const result = await enrollByCode(student, 'GOODCODE');
    expect(result.courseId).toEqual(courseId);
    expect(usersUpdateOne).toHaveBeenCalledWith(
      { puid: 'P1' },
      { $addToSet: { courseRoles: { courseId, role: 'student' } } },
    );
  });

  it('rejects a valid code when not on the roster (distinct message, ST-E02)', async () => {
    coursesFindOne.mockResolvedValue(activeCourse);
    rosterFindOne.mockResolvedValue(null);
    await expect(enrollByCode(student, 'GOODCODE')).rejects.toMatchObject({ code: 'not-on-roster' });
    expect(usersUpdateOne).not.toHaveBeenCalled();
  });

  it('rejects an unknown code', async () => {
    coursesFindOne.mockResolvedValue(null);
    await expect(enrollByCode(student, 'BADCODE')).rejects.toMatchObject({ code: 'not-recognized' });
  });

  it('rejects an expired course', async () => {
    coursesFindOne.mockResolvedValue({ ...activeCourse, termEnd: new Date(Date.now() - 1000) });
    rosterFindOne.mockResolvedValue({ courseId, identifier: 'student1' });
    await expect(enrollByCode(student, 'GOODCODE')).rejects.toMatchObject({ code: 'course-ended' });
  });

  it('is idempotent: already enrolled -> already-enrolled, no duplicate', async () => {
    coursesFindOne.mockResolvedValue(activeCourse);
    rosterFindOne.mockResolvedValue({ courseId, identifier: 'student1' });
    const enrolled: User = { ...student, courseRoles: [{ courseId, role: 'student' }] };
    await expect(enrollByCode(enrolled, 'GOODCODE')).rejects.toMatchObject({ code: 'already-enrolled' });
    expect(usersUpdateOne).not.toHaveBeenCalled();
  });
});

describe('EnrollmentError', () => {
  it('carries the error code and is an instance of Error', () => {
    const err = new EnrollmentError('not-recognized');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('not-recognized');
  });
});

describe('listEnrollments (ST-E03)', () => {
  it('marks a course active when the term has not ended', async () => {
    coursesFindOne.mockResolvedValue(activeCourse);
    const enrolledStudent: User = { ...student, courseRoles: [{ courseId, role: 'student' }] };
    const result = await listEnrollments(enrolledStudent);
    expect(result).toEqual([
      { courseId, name: 'Intro Finance', courseCode: 'COMM 298', term: undefined, active: true },
    ]);
  });

  it('marks a course inactive once past termEnd, respecting per-student extendedUntil', async () => {
    const endedCourse = { ...activeCourse, term: '2026W1', termEnd: new Date(Date.now() - 1000) };
    coursesFindOne.mockResolvedValue(endedCourse);
    rosterFindOne.mockResolvedValue({ courseId, identifier: 'student1', extendedUntil: new Date(Date.now() + 86_400_000) });
    const enrolledStudent: User = { ...student, courseRoles: [{ courseId, role: 'student' }] };
    const result = await listEnrollments(enrolledStudent);
    expect(result).toEqual([
      { courseId, name: 'Intro Finance', courseCode: 'COMM 298', term: '2026W1', active: true },
    ]);
  });

  it('marks an archived course inactive even when the student has an extension', async () => {
    coursesFindOne.mockResolvedValue({
      ...activeCourse,
      lifecycle: 'archived',
      archivedAt: new Date(),
    });
    rosterFindOne.mockResolvedValue({
      courseId,
      identifier: 'student1',
      extendedUntil: new Date(Date.now() + 86_400_000),
    });
    const enrolledStudent: User = { ...student, courseRoles: [{ courseId, role: 'student' }] };

    await expect(listEnrollments(enrolledStudent)).resolves.toEqual([
      { courseId, name: 'Intro Finance', courseCode: 'COMM 298', term: undefined, active: false },
    ]);
  });
});

describe('enrollByCode with a synced Canvas roster (Phase 6)', () => {
  it('enrolls a student on the Canvas roster by PUID with no CSV entry', async () => {
    coursesFindOne.mockResolvedValue(activeCourse);
    rosterFindOne.mockResolvedValue(null);
    lmsFindOne.mockResolvedValue({ courseId, puid: 'P1', name: 'S' });
    usersUpdateOne.mockResolvedValue({});
    const result = await enrollByCode(student, 'GOODCODE');
    expect(result.courseId).toEqual(courseId);
    expect(lmsFindOne).toHaveBeenCalledWith({ courseId, puid: 'P1' });
  });

  it('still refuses a student on neither roster', async () => {
    coursesFindOne.mockResolvedValue(activeCourse);
    rosterFindOne.mockResolvedValue(null);
    lmsFindOne.mockResolvedValue(null);
    await expect(enrollByCode(student, 'GOODCODE')).rejects.toMatchObject({ code: 'not-on-roster' });
  });

  it('does not consult the Canvas roster when the CSV roster already matched', async () => {
    coursesFindOne.mockResolvedValue(activeCourse);
    rosterFindOne.mockResolvedValue({ courseId, identifier: 'student1' });
    usersUpdateOne.mockResolvedValue({});
    await enrollByCode(student, 'GOODCODE');
    expect(lmsFindOne).not.toHaveBeenCalled();
  });

  it('a Canvas-only student is active until termEnd (no extendedUntil path)', async () => {
    coursesFindOne.mockResolvedValue(activeCourse);
    rosterFindOne.mockResolvedValue(null);
    lmsFindOne.mockResolvedValue({ courseId, puid: 'P1' });
    const enrolled = { ...student, courseRoles: [{ courseId, role: 'student' as const }] } as User;
    const [row] = await listEnrollments(enrolled);
    expect(row.active).toBe(true);
  });
});
