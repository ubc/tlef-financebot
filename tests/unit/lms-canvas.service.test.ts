import { ObjectId } from 'mongodb';
import { coursesCol, lmsRosterEntriesCol } from '../../server/src/components/mongodb/collections';
import { getCourse } from '../../server/src/services/courses.service';
import { canvas } from '@ubc/ubc-genai-toolkit-lms-integration';
import { linkCourse, unlinkCourse, getLink, requireLink, listTeacherCourses, listImportableFiles, importFiles } from '../../server/src/services/lms-canvas.service';
import { createMaterials } from '../../server/src/services/materials.service';
import { materialsCol } from '../../server/src/components/mongodb/collections';

jest.mock('../../server/src/components/mongodb/collections', () => ({
  coursesCol: jest.fn(),
  lmsRosterEntriesCol: jest.fn(),
  materialsCol: jest.fn(),
  usersCol: jest.fn(),
}));
jest.mock('../../server/src/services/courses.service', () => ({ getCourse: jest.fn() }));
jest.mock('@ubc/ubc-genai-toolkit-lms-integration', () => ({
  canvas: { getCourses: jest.fn(), getCourseFiles: jest.fn(), downloadFile: jest.fn() },
}));
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
const linkedCourse = { _id: undefined as unknown as ObjectId, canvas: { courseId: 'C1', name: 'D', code: 'D', linkedAt: new Date(), linkedBy: 'P' } };
const api = {} as canvas.ApiClient;
const courseId = new ObjectId();

beforeEach(() => {
  coursesUpdateOne.mockReset();
  entriesDeleteMany.mockReset();
  jest.mocked(coursesCol).mockReturnValue({ updateOne: coursesUpdateOne } as never);
  jest.mocked(lmsRosterEntriesCol).mockReturnValue({ deleteMany: entriesDeleteMany } as never);
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
