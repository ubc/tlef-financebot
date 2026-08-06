import { ObjectId } from 'mongodb';
import { coursesCol, themesCol, losCol } from '../../server/src/components/mongodb/collections';

jest.mock('../../server/src/components/mongodb/collections', () => ({
  coursesCol: jest.fn(),
  themesCol: jest.fn(),
  losCol: jest.fn(),
}));

import { getCourseOutline } from '../../server/src/services/courses.service';

// Real getCourseOutline against mocked collections — a regression guard for
// the projection itself. tests/unit/course-outline.routes.test.ts mocks
// getCourseOutline wholesale, so it only proves the route handler adds no
// extra fields; it can never catch a service-level regression (e.g. an
// `...theme` spread) that ships courseId/availableFrom/archivedAt/themeId to
// a TA. That's exactly the leak this endpoint exists to prevent.
const themesFind = jest.fn();
const themesSort = jest.fn();
const themesToArray = jest.fn();
const losFind = jest.fn();
const losSort = jest.fn();
const losToArray = jest.fn();
const coursesFindOne = jest.fn();

beforeEach(() => {
  themesFind.mockReset();
  themesSort.mockReset();
  themesToArray.mockReset();
  losFind.mockReset();
  losSort.mockReset();
  losToArray.mockReset();
  coursesFindOne.mockReset();

  themesFind.mockReturnValue({ sort: themesSort });
  themesSort.mockReturnValue({ toArray: themesToArray });
  losFind.mockReturnValue({ sort: losSort });
  losSort.mockReturnValue({ toArray: losToArray });

  jest.mocked(themesCol).mockReturnValue({ find: themesFind } as never);
  jest.mocked(losCol).mockReturnValue({ find: losFind } as never);
  jest.mocked(coursesCol).mockReturnValue({ findOne: coursesFindOne } as never);
  coursesFindOne.mockImplementation(({ _id }: { _id: ObjectId }) => Promise.resolve({
    _id,
    name: 'Corporate Finance',
    courseCode: 'COMM 298',
    section: '101',
    term: '2026W1',
    ownerPuid: 'faculty-puid',
    registrationCode: 'ABCDEFGH',
    published: true,
    feedbackStrategy: 'adaptive',
    autoPause: { minAttempts: 5, flagPercent: 30, flagCount: 15 },
    redirectFailureThreshold: 3,
    reviewBacklogThreshold: 10,
    createdAt: new Date('2026-08-01'),
  }));
});

describe('getCourseOutline (projection regression guard)', () => {
  it('returns only safe course identity fields for TA workspace context', async () => {
    const courseId = new ObjectId();
    themesToArray.mockResolvedValue([]);
    losToArray.mockResolvedValue([]);

    const { course } = await getCourseOutline(courseId);

    expect(course).toEqual({
      name: 'Corporate Finance',
      courseCode: 'COMM 298',
      section: '101',
      term: '2026W1',
    });
    expect(Object.keys(course).sort()).toEqual(['courseCode', 'name', 'section', 'term']);
  });

  it('returns exactly _id/name/order/los on each theme — no courseId, availableFrom, archivedAt, or stray fields', async () => {
    const courseId = new ObjectId();
    const themeId = new ObjectId();
    themesToArray.mockResolvedValue([
      {
        _id: themeId,
        courseId,
        name: 'Time Value of Money',
        order: 0,
        availableFrom: new Date('2026-01-01'),
        archivedAt: undefined,
        stray: 'should never survive',
      },
    ]);
    losToArray.mockResolvedValue([]);

    const { themes } = await getCourseOutline(courseId);

    expect(Object.keys(themes[0]).sort()).toEqual(['_id', 'los', 'name', 'order']);
  });

  it('returns exactly _id/name/order on each LO — no themeId, courseId, or stray fields', async () => {
    const courseId = new ObjectId();
    const themeId = new ObjectId();
    const loId = new ObjectId();
    themesToArray.mockResolvedValue([{ _id: themeId, courseId, name: 'Time Value of Money', order: 0 }]);
    losToArray.mockResolvedValue([
      {
        _id: loId,
        courseId,
        themeId,
        name: 'Discounting',
        order: 0,
        stray: 'should never survive',
      },
    ]);

    const { themes } = await getCourseOutline(courseId);

    expect(Object.keys(themes[0].los[0]).sort()).toEqual(['_id', 'name', 'order']);
  });

  it('matches LOs to their own theme by themeId, not to every theme', async () => {
    const courseId = new ObjectId();
    const theme1 = new ObjectId();
    const theme2 = new ObjectId();
    const lo1 = new ObjectId();
    const lo2 = new ObjectId();
    themesToArray.mockResolvedValue([
      { _id: theme1, courseId, name: 'Theme 1', order: 0 },
      { _id: theme2, courseId, name: 'Theme 2', order: 1 },
    ]);
    losToArray.mockResolvedValue([
      { _id: lo1, courseId, themeId: theme1, name: 'LO 1.1', order: 0 },
      { _id: lo2, courseId, themeId: theme2, name: 'LO 2.1', order: 0 },
    ]);

    const { themes } = await getCourseOutline(courseId);

    expect(themes[0].los.map((lo) => lo._id)).toEqual([lo1]);
    expect(themes[0].los.map((lo) => lo.name)).toEqual(['LO 1.1']);
    expect(themes[1].los.map((lo) => lo._id)).toEqual([lo2]);
    expect(themes[1].los.map((lo) => lo.name)).toEqual(['LO 2.1']);
  });

  it('filters both Themes and LOs on archivedAt: { $exists: false } and sorts by order: 1', async () => {
    const courseId = new ObjectId();
    themesToArray.mockResolvedValue([]);
    losToArray.mockResolvedValue([]);

    await getCourseOutline(courseId);

    expect(themesFind).toHaveBeenCalledWith({ courseId, archivedAt: { $exists: false } });
    expect(themesSort).toHaveBeenCalledWith({ order: 1 });
    expect(losFind).toHaveBeenCalledWith({ courseId, archivedAt: { $exists: false } });
    expect(losSort).toHaveBeenCalledWith({ order: 1 });
  });
});
