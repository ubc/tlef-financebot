jest.mock('../../server/src/components/mongodb/collections', () => ({
  examTemplatesCol: jest.fn(),
  losCol: jest.fn(),
  questionsCol: jest.fn(),
  questionVersionsCol: jest.fn(),
  themesCol: jest.fn(),
}));

import { ObjectId } from 'mongodb';
import {
  examTemplatesCol,
  losCol,
  questionsCol,
  questionVersionsCol,
  themesCol,
} from '../../server/src/components/mongodb/collections';
import {
  activeTemplates,
  listTemplates,
  saveTemplate,
  type ExamTemplateInput,
} from '../../server/src/services/exam-templates.service';

const templateFind = jest.fn();
const templateFindOneAndUpdate = jest.fn();
const themeFind = jest.fn();
const loFind = jest.fn();
const questionFind = jest.fn();
const versionFind = jest.fn();

const themeToArray = jest.fn();
const loToArray = jest.fn();
const questionToArray = jest.fn();
const versionToArray = jest.fn();
const templateToArray = jest.fn();
const templateSort = jest.fn(() => ({ toArray: templateToArray }));

const courseId = new ObjectId();
const themeId = new ObjectId();
const loId = new ObjectId();

function input(overrides: Partial<ExamTemplateInput> = {}): ExamTemplateInput {
  return {
    kind: 'midterm',
    themes: [{ themeId, mcqCount: 3, tfCount: 1, pointsPerQuestion: 2 }],
    availabilityStart: new Date('2026-09-01T00:00:00.000Z'),
    availabilityEnd: new Date('2026-09-30T23:59:59.000Z'),
    loBreakdown: true,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(examTemplatesCol).mockReturnValue({
    find: templateFind,
    findOneAndUpdate: templateFindOneAndUpdate,
  } as never);
  jest.mocked(themesCol).mockReturnValue({ find: themeFind } as never);
  jest.mocked(losCol).mockReturnValue({ find: loFind } as never);
  jest.mocked(questionsCol).mockReturnValue({ find: questionFind } as never);
  jest.mocked(questionVersionsCol).mockReturnValue({ find: versionFind } as never);

  templateFind.mockReturnValue({ sort: templateSort });
  themeFind.mockReturnValue({ toArray: themeToArray });
  loFind.mockReturnValue({ toArray: loToArray });
  questionFind.mockReturnValue({ toArray: questionToArray });
  versionFind.mockReturnValue({ toArray: versionToArray });

  themeToArray.mockResolvedValue([{ _id: themeId, courseId, name: 'Time Value of Money' }]);
  loToArray.mockResolvedValue([{ _id: loId, courseId, themeId, name: 'Discounting' }]);
  questionToArray.mockResolvedValue([]);
  versionToArray.mockResolvedValue([]);
  templateFindOneAndUpdate.mockImplementation((_filter, update) => Promise.resolve({
    _id: new ObjectId(),
    ...update.$set,
  }));
});

describe('saveTemplate (IN-S07)', () => {
  it('allows an omitted time limit but rejects a missing Theme count', async () => {
    const saved = await saveTemplate(courseId, input());

    expect(saved.template.timeLimitMinutes).toBeUndefined();

    const invalid = input({
      themes: [{ themeId, tfCount: 1, pointsPerQuestion: 2 } as never],
    });
    await expect(saveTemplate(courseId, invalid)).rejects.toThrow(
      'exam-template-invalid-counts',
    );
    expect(templateFindOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('reports the exact split-aware Approved-question shortfall without blocking save', async () => {
    const mcqVersionIds = [new ObjectId(), new ObjectId()];
    const tfVersionId = new ObjectId();
    questionToArray.mockResolvedValue([
      { _id: new ObjectId(), loIds: [loId], themeIds: [themeId], currentVersionId: mcqVersionIds[0] },
      { _id: new ObjectId(), loIds: [loId], themeIds: [themeId], currentVersionId: mcqVersionIds[1] },
      { _id: new ObjectId(), loIds: [loId], themeIds: [themeId], currentVersionId: tfVersionId },
    ]);
    versionToArray.mockResolvedValue([
      { _id: mcqVersionIds[0], type: 'mcq' },
      { _id: mcqVersionIds[1], type: 'mcq' },
      { _id: tfVersionId, type: 'true-false' },
    ]);

    const result = await saveTemplate(courseId, input());

    expect(result.warnings).toEqual([
      {
        themeId,
        themeName: 'Time Value of Money',
        requested: 4,
        available: 3,
      },
    ]);
    expect(templateFindOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(questionFind).toHaveBeenCalledWith(expect.objectContaining({
      courseId,
      state: 'approved',
    }));
  });

  it('upserts the same course/kind so later settings replace that template', async () => {
    await saveTemplate(courseId, input({ kind: 'final', timeLimitMinutes: 90 }));

    expect(templateFindOneAndUpdate).toHaveBeenCalledWith(
      { courseId, kind: 'final' },
      { $set: expect.objectContaining({ courseId, kind: 'final', timeLimitMinutes: 90 }) },
      { upsert: true, returnDocument: 'after' },
    );
  });

  it('rejects a Theme outside the course before writing', async () => {
    themeToArray.mockResolvedValue([]);

    await expect(saveTemplate(courseId, input())).rejects.toThrow(
      'exam-template-theme-not-in-course',
    );
    expect(templateFindOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('template reads', () => {
  it('lists both kinds in stable kind order', async () => {
    templateToArray.mockResolvedValue([{ kind: 'midterm' }, { kind: 'final' }]);

    await expect(listTemplates(courseId)).resolves.toEqual([
      { kind: 'midterm' },
      { kind: 'final' },
    ]);
    expect(templateFind).toHaveBeenCalledWith({ courseId });
    expect(templateSort).toHaveBeenCalledWith({ kind: 1 });
  });

  it('treats both availability boundaries as active', async () => {
    const now = new Date('2026-09-15T12:00:00.000Z');
    templateToArray.mockResolvedValue([{ kind: 'midterm' }]);

    await activeTemplates(courseId, now);

    expect(templateFind).toHaveBeenCalledWith({
      courseId,
      availabilityStart: { $lte: now },
      availabilityEnd: { $gte: now },
    });
  });
});
