import { ObjectId } from 'mongodb';
import {
  coursesCol,
  themesCol,
  losCol,
  questionsCol,
  rosterCol,
  usersCol,
} from '../../server/src/components/mongodb/collections';

jest.mock('../../server/src/components/mongodb/collections', () => ({
  coursesCol: jest.fn(),
  themesCol: jest.fn(),
  losCol: jest.fn(),
  questionsCol: jest.fn(),
  rosterCol: jest.fn(),
  usersCol: jest.fn(),
}));

import {
  createCourse,
  updateCourse,
  addTheme,
  archiveTheme,
  publishChecklist,
  setPublished,
  putRoster,
} from '../../server/src/services/courses.service';

// Per-collection method mocks, wired onto the mocked accessors in beforeEach —
// follows the tests/unit/users.service.test.ts mocking pattern.
const coursesInsertOne = jest.fn();
const coursesFindOne = jest.fn();
const coursesUpdateOne = jest.fn();
const usersUpdateOne = jest.fn();
const themesFind = jest.fn();
const themesSort = jest.fn();
const themesLimit = jest.fn();
const themesToArray = jest.fn();
const themesInsertOne = jest.fn();
const themesFindOneAndUpdate = jest.fn();
const losFind = jest.fn();
const losToArray = jest.fn();
const losUpdateMany = jest.fn();
const questionsCountDocuments = jest.fn();
const rosterDeleteMany = jest.fn();
const rosterBulkWrite = jest.fn();

beforeEach(() => {
  coursesInsertOne.mockReset();
  coursesFindOne.mockReset();
  coursesUpdateOne.mockReset();
  usersUpdateOne.mockReset();
  themesFind.mockReset();
  themesSort.mockReset();
  themesLimit.mockReset();
  themesToArray.mockReset();
  themesInsertOne.mockReset();
  themesFindOneAndUpdate.mockReset();
  losFind.mockReset();
  losToArray.mockReset();
  losUpdateMany.mockReset();
  questionsCountDocuments.mockReset();
  rosterDeleteMany.mockReset();
  rosterBulkWrite.mockReset();

  themesSort.mockReturnValue({ limit: themesLimit });
  themesLimit.mockReturnValue({ toArray: themesToArray });
  themesFind.mockReturnValue({ sort: themesSort, toArray: themesToArray });
  losFind.mockReturnValue({ toArray: losToArray });

  jest.mocked(coursesCol).mockReturnValue({
    insertOne: coursesInsertOne,
    findOne: coursesFindOne,
    updateOne: coursesUpdateOne,
  } as never);
  jest.mocked(usersCol).mockReturnValue({ updateOne: usersUpdateOne } as never);
  jest.mocked(themesCol).mockReturnValue({
    find: themesFind,
    insertOne: themesInsertOne,
    findOneAndUpdate: themesFindOneAndUpdate,
  } as never);
  jest.mocked(losCol).mockReturnValue({ find: losFind, updateMany: losUpdateMany } as never);
  jest.mocked(questionsCol).mockReturnValue({ countDocuments: questionsCountDocuments } as never);
  jest.mocked(rosterCol).mockReturnValue({ deleteMany: rosterDeleteMany, bulkWrite: rosterBulkWrite } as never);
});

describe('createCourse (IN-S01)', () => {
  it('inserts a sandboxed course with adaptive-strategy defaults and grants the owner instructor role', async () => {
    const insertedId = new ObjectId();
    coursesInsertOne.mockResolvedValue({ insertedId });
    usersUpdateOne.mockResolvedValue({ acknowledged: true });

    const result = await createCourse('PUID-INSTR-0001', {
      name: 'Intro to Finance',
      courseCode: 'COMM 298',
      term: '2026W1',
    });

    const [doc] = coursesInsertOne.mock.calls[0];
    expect(doc.published).toBe(false);
    expect(doc.feedbackStrategy).toBe('adaptive');
    expect(doc.autoPause).toEqual({ minAttempts: 5, flagPercent: 30, flagCount: 15 });
    expect(doc.redirectFailureThreshold).toBe(3);
    expect(typeof doc.registrationCode).toBe('string');
    expect(doc.registrationCode.length).toBeGreaterThanOrEqual(8);
    expect(doc.ownerPuid).toBe('PUID-INSTR-0001');

    const [filter, update] = usersUpdateOne.mock.calls[0];
    expect(filter).toEqual({ puid: 'PUID-INSTR-0001' });
    expect(update.$addToSet.courseRoles).toEqual({ courseId: insertedId, role: 'instructor' });

    expect(result._id).toEqual(insertedId);
  });
});

describe('updateCourse (IN-S02: term dates)', () => {
  it('rejects termEnd <= termStart and never calls updateOne', async () => {
    coursesFindOne.mockResolvedValue({
      _id: new ObjectId(),
      name: 'Intro to Finance',
      courseCode: 'COMM 298',
      term: '2026W1',
    });

    await expect(
      updateCourse(new ObjectId(), {
        termStart: new Date('2026-09-01'),
        termEnd: new Date('2026-01-01'),
      }),
    ).rejects.toThrow('term-end-before-start');

    expect(coursesUpdateOne).not.toHaveBeenCalled();
  });
});

describe('addTheme (hierarchy CRUD)', () => {
  it('orders a new theme at current max + 1', async () => {
    themesToArray.mockResolvedValue([{ order: 2 }]);
    const insertedId = new ObjectId();
    themesInsertOne.mockResolvedValue({ insertedId });
    const courseId = new ObjectId();

    await addTheme(courseId, { name: 'Time Value of Money' });

    expect(themesSort).toHaveBeenCalledWith({ order: -1 });
    expect(themesLimit).toHaveBeenCalledWith(1);
    const [doc] = themesInsertOne.mock.calls[0];
    expect(doc.order).toBe(3);
    expect(doc.courseId).toEqual(courseId);
    expect(doc.name).toBe('Time Value of Money');
  });
});

describe('archiveTheme (cascade to Learning Objectives)', () => {
  it('stamps archivedAt on the theme and on its live LOs with the same timestamp, leaving already-archived LOs untouched', async () => {
    const themeId = new ObjectId();
    themesFindOneAndUpdate.mockImplementation((_filter, update) =>
      Promise.resolve({ _id: themeId, name: 'Theme 1', archivedAt: update.$set.archivedAt }),
    );
    losUpdateMany.mockResolvedValue({ modifiedCount: 2 });

    const theme = await archiveTheme(themeId);

    expect(theme.archivedAt).toBeInstanceOf(Date);

    // The cascade must use the exact same Date instance/value stamped on the
    // theme — not a second `new Date()` call that could drift by a tick —
    // and must only touch LOs of this theme that are not already archived.
    const [loFilter, loUpdate] = losUpdateMany.mock.calls[0];
    expect(loFilter).toEqual({ themeId, archivedAt: { $exists: false } });
    expect(loUpdate.$set.archivedAt).toEqual(theme.archivedAt);
    expect(losUpdateMany).toHaveBeenCalledTimes(1);
  });
});

describe('publishChecklist + setPublished (IN-L06)', () => {
  it('flags a thin LO (<3 approved questions) but still allows publishing', async () => {
    const courseId = new ObjectId();
    const lo1 = { _id: new ObjectId(), name: 'NPV basics' };
    const lo2 = { _id: new ObjectId(), name: 'IRR basics' };
    coursesFindOne.mockResolvedValue({
      _id: courseId,
      termStart: new Date('2026-09-01'),
      termEnd: new Date('2026-12-01'),
      registrationCode: 'ABCD2345',
      published: false,
    });
    themesToArray.mockResolvedValue([{ _id: new ObjectId(), name: 'Theme 1' }]);
    losToArray.mockResolvedValue([lo1, lo2]);
    questionsCountDocuments.mockImplementation(({ loIds }: { loIds: ObjectId }) =>
      Promise.resolve(loIds.equals(lo1._id) ? 5 : 2),
    );

    const checklist = await publishChecklist(courseId);

    expect(checklist).toHaveLength(5);
    const approvedItem = checklist[4];
    expect(approvedItem.ok).toBe(false);
    expect(approvedItem.item).toContain('IRR basics');
    expect(checklist.slice(0, 4).every((c: { ok: boolean }) => c.ok)).toBe(true);

    // IN-L06: a thin-LO warning never blocks publishing.
    coursesUpdateOne.mockResolvedValue({ acknowledged: true });
    coursesFindOne.mockResolvedValue({ _id: courseId, published: true });
    const course = await setPublished(courseId, true);

    expect(coursesUpdateOne).toHaveBeenCalledWith({ _id: courseId }, { $set: { published: true } });
    expect(course.published).toBe(true);
  });
});

describe('putRoster (ST-E02)', () => {
  it('lower-cases and dedupes identifiers, reconciling the roster instead of wiping it', async () => {
    rosterDeleteMany.mockResolvedValue({ deletedCount: 0 });
    rosterBulkWrite.mockResolvedValue({ ok: 1 });
    const courseId = new ObjectId();

    const count = await putRoster(courseId, [' A@ubc.ca ', 'a@ubc.ca', 'b']);

    expect(count).toBe(2);
    const [ops] = rosterBulkWrite.mock.calls[0];
    expect(ops.map((op: { updateOne: { filter: { identifier: string } } }) => op.updateOne.filter.identifier)).toEqual([
      'a@ubc.ca',
      'b',
    ]);
  });

  it('preserves an existing entry\'s extendedUntil and addedAt on re-upload instead of overwriting them', async () => {
    rosterDeleteMany.mockResolvedValue({ deletedCount: 0 });
    rosterBulkWrite.mockResolvedValue({ ok: 1 });
    const courseId = new ObjectId();

    await putRoster(courseId, ['a@ubc.ca', 'newstudent@ubc.ca']);

    // The upsert for an already-present identifier must never carry a $set
    // that would clobber extendedUntil/addedAt on the existing document —
    // only $setOnInsert (a no-op when the doc already exists) is allowed.
    const [ops] = rosterBulkWrite.mock.calls[0];
    const opForExisting = ops.find(
      (op: { updateOne: { filter: { identifier: string } } }) => op.updateOne.filter.identifier === 'a@ubc.ca',
    );
    expect(opForExisting.updateOne.upsert).toBe(true);
    expect(opForExisting.updateOne.update.$set).toBeUndefined();
    expect(opForExisting.updateOne.update.$setOnInsert).toEqual({
      courseId,
      identifier: 'a@ubc.ca',
      addedAt: expect.any(Date),
    });
    expect(Object.prototype.hasOwnProperty.call(opForExisting.updateOne.update.$setOnInsert, 'extendedUntil')).toBe(
      false,
    );
  });

  it('removes an identifier absent from the new list, without touching identifiers still present', async () => {
    rosterDeleteMany.mockResolvedValue({ deletedCount: 1 });
    rosterBulkWrite.mockResolvedValue({ ok: 1 });
    const courseId = new ObjectId();

    const count = await putRoster(courseId, ['keep@ubc.ca']);

    expect(count).toBe(1);
    expect(rosterDeleteMany).toHaveBeenCalledWith({ courseId, identifier: { $nin: ['keep@ubc.ca'] } });
  });

  it('clears the whole roster and returns 0 for an empty/all-blank identifier list', async () => {
    rosterDeleteMany.mockResolvedValue({ deletedCount: 3 });
    const courseId = new ObjectId();

    const count = await putRoster(courseId, ['   ', '']);

    expect(count).toBe(0);
    expect(rosterDeleteMany).toHaveBeenCalledWith({ courseId });
    expect(rosterBulkWrite).not.toHaveBeenCalled();
  });
});
