import { ObjectId } from 'mongodb';
import { coursesCol, lmsRosterEntriesCol } from '../../server/src/components/mongodb/collections';
import { getCourse } from '../../server/src/services/courses.service';
import { canvas } from '@ubc/ubc-genai-toolkit-lms-integration';
import { linkCourse, unlinkCourse, getLink, requireLink, listTeacherCourses } from '../../server/src/services/lms-canvas.service';

jest.mock('../../server/src/components/mongodb/collections', () => ({
  coursesCol: jest.fn(),
  lmsRosterEntriesCol: jest.fn(),
  materialsCol: jest.fn(),
  usersCol: jest.fn(),
}));
jest.mock('../../server/src/services/courses.service', () => ({ getCourse: jest.fn() }));
jest.mock('@ubc/ubc-genai-toolkit-lms-integration', () => ({
  canvas: { getCourses: jest.fn() },
}));

const coursesUpdateOne = jest.fn();
const entriesDeleteMany = jest.fn();
const api = {} as canvas.ApiClient;
const courseId = new ObjectId();

beforeEach(() => {
  coursesUpdateOne.mockReset();
  entriesDeleteMany.mockReset();
  jest.mocked(coursesCol).mockReturnValue({ updateOne: coursesUpdateOne } as never);
  jest.mocked(lmsRosterEntriesCol).mockReturnValue({ deleteMany: entriesDeleteMany } as never);
  jest.mocked(getCourse).mockReset();
  jest.mocked(canvas.getCourses).mockReset();
});

describe('listTeacherCourses', () => {
  it('asks Canvas for teacher enrollments only and strips raw', async () => {
    jest.mocked(canvas.getCourses).mockResolvedValue([{ id: '1', name: 'Demo', code: 'DEMO', raw: { secret: 1 } }]);
    const out = await listTeacherCourses(api);
    expect(canvas.getCourses).toHaveBeenCalledWith(api, { enrollment_type: 'teacher' });
    expect(out).toEqual([{ id: '1', name: 'Demo', code: 'DEMO' }]);
  });
});

describe('linkCourse', () => {
  it('refuses a Canvas course absent from the teacher list and writes nothing', async () => {
    jest.mocked(canvas.getCourses).mockResolvedValue([{ id: '1', name: 'Demo', code: 'DEMO', raw: {} }]);
    await expect(linkCourse(api, courseId, '999', 'PUID-1')).rejects.toThrow('not-teacher');
    expect(coursesUpdateOne).not.toHaveBeenCalled();
  });

  it('stores name/code from the Canvas row, not the caller', async () => {
    jest.mocked(canvas.getCourses).mockResolvedValue([{ id: '1', name: 'FinanceBot Demo', code: 'FINBOT-DEMO', raw: {} }]);
    const link = await linkCourse(api, courseId, '1', 'PUID-1');
    expect(link).toMatchObject({ courseId: '1', name: 'FinanceBot Demo', code: 'FINBOT-DEMO', linkedBy: 'PUID-1' });
    expect(coursesUpdateOne).toHaveBeenCalledWith({ _id: courseId }, { $set: { canvas: link } });
  });
});

describe('unlinkCourse', () => {
  it('clears the link and the course’s Canvas roster entries', async () => {
    await unlinkCourse(courseId);
    expect(coursesUpdateOne).toHaveBeenCalledWith({ _id: courseId }, { $unset: { canvas: '' } });
    expect(entriesDeleteMany).toHaveBeenCalledWith({ courseId });
  });
});

describe('getLink / requireLink', () => {
  it('getLink returns null on an unlinked course', async () => {
    jest.mocked(getCourse).mockResolvedValue({ _id: courseId } as never);
    expect(await getLink(courseId)).toBeNull();
  });
  it('requireLink throws not-linked', async () => {
    jest.mocked(getCourse).mockResolvedValue({ _id: courseId } as never);
    await expect(requireLink(courseId)).rejects.toThrow('not-linked');
  });
  it('requireLink returns the link when present', async () => {
    const link = { courseId: '1', name: 'D', code: 'D', linkedAt: new Date(), linkedBy: 'P' };
    jest.mocked(getCourse).mockResolvedValue({ _id: courseId, canvas: link } as never);
    expect(await requireLink(courseId)).toEqual(link);
  });
});
