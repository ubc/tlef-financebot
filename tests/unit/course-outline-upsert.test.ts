import { ObjectId } from 'mongodb';

jest.mock('../../server/src/components/mongodb/collections', () => ({
  coursesCol: jest.fn(),
  themesCol: jest.fn(),
  losCol: jest.fn(),
  questionsCol: jest.fn(),
  rosterCol: jest.fn(),
  usersCol: jest.fn(),
}));

import {
  coursesCol,
  themesCol,
  losCol,
  questionsCol,
  rosterCol,
  usersCol,
} from '../../server/src/components/mongodb/collections';
import { upsertCourseOutline } from '../../server/src/services/courses.service';

const courseId = new ObjectId();
const storedThemes: Array<{
  _id: ObjectId;
  courseId: ObjectId;
  name: string;
  order: number;
}> = [];
const storedLos: Array<{
  _id: ObjectId;
  courseId: ObjectId;
  themeId: ObjectId;
  name: string;
  order: number;
}> = [];

function matchesObjectId(value: ObjectId, expected: unknown): boolean {
  return expected instanceof ObjectId ? value.equals(expected) : true;
}

function cursor<T extends { order: number }>(rows: T[]) {
  return {
    sort(sort: { order: number }) {
      const sorted = [...rows].sort((a, b) => sort.order < 0 ? b.order - a.order : a.order - b.order);
      return {
        toArray: async () => sorted,
        limit: (count: number) => ({ toArray: async () => sorted.slice(0, count) }),
      };
    },
  };
}

beforeEach(() => {
  storedThemes.splice(0);
  storedLos.splice(0);

  jest.mocked(themesCol).mockReturnValue({
    find: jest.fn((filter: { courseId?: ObjectId }) => cursor(
      storedThemes.filter((theme) => !filter.courseId || matchesObjectId(theme.courseId, filter.courseId)),
    )),
    insertOne: jest.fn(async (theme) => {
      const insertedId = new ObjectId();
      storedThemes.push({ _id: insertedId, ...theme });
      return { insertedId };
    }),
  } as never);
  jest.mocked(losCol).mockReturnValue({
    find: jest.fn((filter: { courseId?: ObjectId; themeId?: ObjectId }) => cursor(
      storedLos.filter((lo) =>
        (!filter.courseId || matchesObjectId(lo.courseId, filter.courseId))
        && (!filter.themeId || matchesObjectId(lo.themeId, filter.themeId)),
      ),
    )),
    insertOne: jest.fn(async (lo) => {
      const insertedId = new ObjectId();
      storedLos.push({ _id: insertedId, ...lo });
      return { insertedId };
    }),
  } as never);

  // These accessors are imported by courses.service but are not part of this
  // outline operation. Stubs make an accidental new dependency fail locally.
  jest.mocked(coursesCol).mockReturnValue({} as never);
  jest.mocked(questionsCol).mockReturnValue({} as never);
  jest.mocked(rosterCol).mockReturnValue({} as never);
  jest.mocked(usersCol).mockReturnValue({} as never);
});

describe('upsertCourseOutline', () => {
  it('reuses active names on retry and only creates the missing tail', async () => {
    const first = await upsertCourseOutline(courseId, {
      themes: [
        {
          name: ' Capital Budgeting ',
          los: ['Calculate NPV', ' calculate npv ', 'Compare IRR'],
        },
        { name: 'Risk and Return', los: ['Measure beta'] },
      ],
    });

    expect(first).toMatchObject({ themesCreated: 2, losCreated: 3 });
    expect(storedThemes).toHaveLength(2);
    expect(storedLos).toHaveLength(3);

    const retry = await upsertCourseOutline(courseId, {
      themes: [
        {
          name: 'capital budgeting',
          los: ['CALCULATE NPV', 'Compare IRR', 'Explain payback'],
        },
        { name: ' risk and return ', los: ['MEASURE BETA'] },
      ],
    });

    expect(retry).toMatchObject({ themesCreated: 0, losCreated: 1 });
    expect(retry.themes[0]).toMatchObject({ created: false });
    expect(retry.themes[0].los.map((lo) => lo.created)).toEqual([false, false, true]);
    expect(storedThemes).toHaveLength(2);
    expect(storedLos).toHaveLength(4);

    const exactRetry = await upsertCourseOutline(courseId, {
      themes: [{
        name: 'Capital Budgeting',
        los: ['Calculate NPV', 'Compare IRR', 'Explain payback'],
      }],
    });
    expect(exactRetry).toMatchObject({ themesCreated: 0, losCreated: 0 });
    expect(storedThemes).toHaveLength(2);
    expect(storedLos).toHaveLength(4);
  });
});
