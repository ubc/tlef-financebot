import { ObjectId } from 'mongodb';
import { coursesCol, lmsRosterEntriesCol, usersCol } from '../../server/src/components/mongodb/collections';
import { getCourse } from '../../server/src/services/courses.service';
import { canvas } from '@ubc/ubc-genai-toolkit-lms-integration';
import { linkCourse, unlinkCourse, getLink, requireLink, listTeacherCourses, listImportableFiles, importFiles, syncRoster, getCanvasRoster } from '../../server/src/services/lms-canvas.service';
import { createMaterials } from '../../server/src/services/materials.service';
import { materialsCol } from '../../server/src/components/mongodb/collections';

jest.mock('../../server/src/components/mongodb/collections', () => ({
  coursesCol: jest.fn(),
  lmsRosterEntriesCol: jest.fn(),
  materialsCol: jest.fn(),
  usersCol: jest.fn(),
}));
jest.mock('../../server/src/services/courses.service', () => ({ getCourse: jest.fn() }));
jest.mock('@ubc/ubc-genai-toolkit-lms-integration', () => {
  class CanvasGradeExportError extends Error {
    constructor(message: string, public readonly reason: string) { super(message); }
  }
  return {
    rosterFieldCoverage: (users: Array<{ integrationId?: string }>) => ({
      total: users.length,
      integrationId: users.filter((u) => u.integrationId).length,
      sisId: 0,
      email: 0,
      loginId: 0,
    }),
    canvas: {
      CanvasGradeExportError,
      getCourses: jest.fn(),
      getCourseFiles: jest.fn(),
      downloadFile: jest.fn(),
      getCourseUsers: jest.fn(),
      matchCourseRoster: jest.fn(),
      explainUnmatched: jest.fn(),
    },
  };
});
jest.mock('../../server/src/services/materials.service', () => ({
  createMaterials: jest.fn(),
  detectUploadFormat: (name: string) => (name.endsWith('.pdf') ? 'pdf' : name.endsWith('.docx') ? 'docx' : undefined),
  MAX_FILES_PER_UPLOAD: 20,
  MAX_UPLOAD_BYTES: 50 * 1024 * 1024,
}));
jest.mock('node:fs/promises', () => ({ writeFile: jest.fn().mockResolvedValue(undefined), rm: jest.fn().mockResolvedValue(undefined) }));

const coursesUpdateOne = jest.fn();
const entriesDeleteMany = jest.fn();
const materialsFindToArray = jest.fn();
const materialsUpdateOne = jest.fn();
const usersFindToArray = jest.fn();
const entriesInsertMany = jest.fn();
const entriesFindToArray = jest.fn();
const linkedCourse = { _id: undefined as unknown as ObjectId, canvas: { courseId: 'C1', name: 'D', code: 'D', linkedAt: new Date(), linkedBy: 'P' } };
const api = {} as canvas.ApiClient;
const courseId = new ObjectId();

beforeEach(() => {
  coursesUpdateOne.mockReset();
  entriesDeleteMany.mockReset();
  jest.mocked(coursesCol).mockReturnValue({ updateOne: coursesUpdateOne } as never);
  jest.mocked(lmsRosterEntriesCol).mockReturnValue({
    deleteMany: entriesDeleteMany,
    insertMany: entriesInsertMany,
    find: () => ({ sort: () => ({ toArray: entriesFindToArray }) }),
  } as never);
  usersFindToArray.mockReset().mockResolvedValue([]);
  entriesInsertMany.mockReset();
  entriesFindToArray.mockReset().mockResolvedValue([]);
  jest.mocked(usersCol).mockReturnValue({ find: () => ({ project: () => ({ toArray: usersFindToArray }) }) } as never);
  jest.mocked(canvas.getCourseUsers).mockReset();
  jest.mocked(canvas.matchCourseRoster).mockReset();
  jest.mocked(canvas.explainUnmatched).mockReset();
  jest.mocked(getCourse).mockReset();
  jest.mocked(canvas.getCourses).mockReset();
  jest.mocked(canvas.getCourseFiles).mockReset();
  jest.mocked(canvas.downloadFile).mockReset();
  jest.mocked(createMaterials).mockReset();
  materialsFindToArray.mockReset().mockResolvedValue([]);
  materialsUpdateOne.mockReset();
  jest.mocked(materialsCol).mockReturnValue({
    find: () => ({ project: () => ({ toArray: materialsFindToArray }) }),
    updateOne: materialsUpdateOne,
  } as never);
  linkedCourse._id = courseId;
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

describe('listImportableFiles', () => {
  it('keeps only formats upload accepts, under the size limit, and flags imported ones', async () => {
    jest.mocked(getCourse).mockResolvedValue(linkedCourse as never);
    jest.mocked(canvas.getCourseFiles).mockResolvedValue([
      { id: '10', courseId: 'C1', name: 'Week 1.pdf', filename: 'w1.pdf', size: 1000, updatedAt: '2026-08-01', raw: {} },
      { id: '11', courseId: 'C1', name: 'notes.exe', filename: 'notes.exe', size: 10, raw: {} },
      { id: '12', courseId: 'C1', name: 'huge.pdf', filename: 'huge.pdf', size: 60 * 1024 * 1024, raw: {} },
      { id: '13', courseId: 'C1', name: 'Week 2.docx', filename: 'w2.docx', size: 500, raw: {} },
    ]);
    materialsFindToArray.mockResolvedValue([{ origin: { externalFileId: '13' } }]);
    const out = await listImportableFiles(api, courseId);
    expect(canvas.getCourseFiles).toHaveBeenCalledWith(api, 'C1');
    expect(out).toEqual([
      { id: '10', name: 'Week 1.pdf', size: 1000, updatedAt: '2026-08-01', alreadyImported: false },
      { id: '13', name: 'Week 2.docx', size: 500, updatedAt: undefined, alreadyImported: true },
    ]);
  });
});

describe('importFiles', () => {
  const files = [
    { id: '10', courseId: 'C1', name: 'Week 1.pdf', filename: 'w1.pdf', size: 1000, updatedAt: '2026-08-01T00:00:00Z', raw: {} },
    { id: '13', courseId: 'C1', name: 'Week 2.docx', filename: 'w2.docx', size: 500, raw: {} },
  ];
  beforeEach(() => {
    jest.mocked(getCourse).mockResolvedValue(linkedCourse as never);
    jest.mocked(canvas.getCourseFiles).mockResolvedValue(files);
  });

  it('skips already-imported ids without downloading', async () => {
    materialsFindToArray.mockResolvedValue([{ origin: { externalFileId: '10' } }]);
    jest.mocked(canvas.downloadFile).mockResolvedValue({ data: new Uint8Array([1]), size: 1 });
    jest.mocked(createMaterials).mockResolvedValue([{ _id: new ObjectId(), name: 'Week 2.docx' }] as never);
    const out = await importFiles(api, courseId, ['10', '13'], 'P', '/tmp/uploads');
    expect(out.skipped).toEqual(['10']);
    expect(canvas.downloadFile).toHaveBeenCalledTimes(1);
    expect(canvas.downloadFile).toHaveBeenCalledWith(api, 'C1', '13', { maxBytes: 50 * 1024 * 1024 });
    expect(out.created).toHaveLength(1);
  });

  it('one failed download does not stop the others', async () => {
    jest.mocked(canvas.downloadFile)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ data: new Uint8Array([1]), size: 1 });
    jest.mocked(createMaterials).mockResolvedValue([{ _id: new ObjectId() }] as never);
    const out = await importFiles(api, courseId, ['10', '13'], 'P', '/tmp/uploads');
    expect(out.failed).toEqual([{ id: '10', reason: 'download-failed' }]);
    expect(out.created).toHaveLength(1);
  });

  it('hands createMaterials a path under uploadDir with the Canvas name, and stamps origin', async () => {
    jest.mocked(canvas.downloadFile).mockResolvedValue({ data: new Uint8Array([1]), size: 1 });
    const created = { _id: new ObjectId(), name: 'Week 1.pdf' };
    jest.mocked(createMaterials).mockResolvedValue([created] as never);
    await importFiles(api, courseId, ['10'], 'P', '/tmp/uploads');
    const [, uploaded, by] = jest.mocked(createMaterials).mock.calls[0];
    expect(by).toBe('P');
    expect(uploaded[0].originalname).toBe('Week 1.pdf');
    expect(uploaded[0].path.startsWith('/tmp/uploads/')).toBe(true);
    expect(uploaded[0].path.endsWith('.pdf')).toBe(true);
    expect(materialsUpdateOne).toHaveBeenCalledWith(
      { _id: created._id },
      { $set: { origin: expect.objectContaining({ provider: 'canvas', externalCourseId: 'C1', externalFileId: '10', sourceUpdatedAt: new Date('2026-08-01T00:00:00Z') }) } },
    );
  });

  it('reports ids not in the course as not-found without downloading', async () => {
    const out = await importFiles(api, courseId, ['999'], 'P', '/tmp/uploads');
    expect(out.failed).toEqual([{ id: '999', reason: 'not-found' }]);
    expect(canvas.downloadFile).not.toHaveBeenCalled();
  });
});

describe('syncRoster', () => {
  const roster = [
    { id: '2', name: 'CPSC Student', integrationId: '42000001', raw: {} },
    { id: '3', name: 'Unenrolled Student', integrationId: '42999999', raw: {} },
    { id: '4', name: 'Conflict Student', raw: {} },
  ];
  const report = {
    courseId: 'C1',
    matched: [{ key: '42000001', appUserId: '42000001', lmsUserId: '2', name: 'CPSC Student', matchedBy: 'integrationId' }],
    appOnly: [{ key: '42000002', appUserId: '42000002', reason: 'unknown' }],
    rosterOnly: [{ lmsUserId: '3', name: 'Unenrolled Student', key: '42999999' }],
    ambiguous: [],
    coverage: { total: 3, integrationId: 2, sisId: 0, email: 0, loginId: 0 },
  };
  beforeEach(() => {
    jest.mocked(getCourse).mockResolvedValue(linkedCourse as never);
    jest.mocked(canvas.explainUnmatched).mockImplementation(async (_a, _c, r) => r);
  });

  it('offers only students of this course as appUsers, keyed by puid', async () => {
    usersFindToArray.mockResolvedValue([{ puid: '42000001' }, { puid: '42000002' }]);
    jest.mocked(canvas.getCourseUsers).mockResolvedValue(roster);
    jest.mocked(canvas.matchCourseRoster).mockResolvedValue(report as never);
    await syncRoster(api, courseId);
    expect(canvas.matchCourseRoster).toHaveBeenCalledWith(api, 'C1', [
      { appUserId: '42000001', key: '42000001' },
      { appUserId: '42000002', key: '42000002' },
    ]);
  });

  it('stores only users with an integrationId, replacing the previous set', async () => {
    jest.mocked(canvas.getCourseUsers).mockResolvedValue(roster);
    jest.mocked(canvas.matchCourseRoster).mockResolvedValue(report as never);
    const out = await syncRoster(api, courseId);
    expect(entriesDeleteMany).toHaveBeenCalledWith({ courseId });
    const inserted = entriesInsertMany.mock.calls[0][0];
    expect(inserted.map((e: { puid: string }) => e.puid)).toEqual(['42000001', '42999999']);
    expect(inserted[0]).toMatchObject({ provider: 'canvas', externalCourseId: 'C1', externalUserId: '2', name: 'CPSC Student', matchedBy: 'integrationId' });
    expect(out.stored).toBe(2);
    expect(out.coverage).toEqual({ total: 3, integrationId: 2, sisId: 0, email: 0, loginId: 0 });
  });

  it('writes nothing when the package refuses on roster-coverage', async () => {
    jest.mocked(canvas.getCourseUsers).mockResolvedValue([{ id: '9', name: 'Blank', raw: {} }]);
    jest.mocked(canvas.matchCourseRoster).mockRejectedValue(new canvas.CanvasGradeExportError('x', 'roster-coverage'));
    await expect(syncRoster(api, courseId)).rejects.toMatchObject({ reason: 'roster-coverage' });
    expect(entriesDeleteMany).not.toHaveBeenCalled();
    expect(entriesInsertMany).not.toHaveBeenCalled();
  });

  it('an empty Canvas roster clears the set without throwing', async () => {
    jest.mocked(canvas.getCourseUsers).mockResolvedValue([]);
    jest.mocked(canvas.matchCourseRoster).mockResolvedValue({ ...report, matched: [], rosterOnly: [], coverage: { total: 0, integrationId: 0, sisId: 0, email: 0, loginId: 0 } } as never);
    const out = await syncRoster(api, courseId);
    expect(entriesDeleteMany).toHaveBeenCalledWith({ courseId });
    expect(entriesInsertMany).not.toHaveBeenCalled();
    expect(out.stored).toBe(0);
  });
});

describe('getCanvasRoster', () => {
  it('returns puid+name only, with the latest syncedAt', async () => {
    const t = new Date('2026-08-27T10:00:00Z');
    entriesFindToArray.mockResolvedValue([{ puid: 'A', name: 'a', syncedAt: t, externalUserId: '1' }]);
    expect(await getCanvasRoster(courseId)).toEqual({ syncedAt: t, entries: [{ puid: 'A', name: 'a' }] });
  });
  it('reports null syncedAt when never synced', async () => {
    expect(await getCanvasRoster(courseId)).toEqual({ syncedAt: null, entries: [] });
  });
});
