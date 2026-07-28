import { ObjectId } from 'mongodb';
import { losCol, themesCol } from '../../server/src/components/mongodb/collections';
import {
  migrateScript,
  previewScriptMigration,
} from '../../server/src/services/import.service';
import { createQuestion } from '../../server/src/services/questions.service';

jest.mock('../../server/src/components/genai/llm', () => ({
  completeJson: jest.fn(),
}));

jest.mock('../../server/src/components/mongodb/collections', () => ({
  losCol: jest.fn(),
  themesCol: jest.fn(),
}));

jest.mock('../../server/src/services/questions.service', () => ({
  createQuestion: jest.fn(),
}));

const mockCreateQuestion = createQuestion as jest.MockedFunction<typeof createQuestion>;
const mockLosCol = losCol as jest.MockedFunction<typeof losCol>;
const mockThemesCol = themesCol as jest.MockedFunction<typeof themesCol>;

const courseId = new ObjectId();
const script = `function generate(random) {
  return {
    vars: {
      principal: 1000 + Math.floor(random() * 10) * 100,
      rate: 5
    }
  };
}`;

const validInput = {
  type: 'mcq' as const,
  stem: 'What is the return on {{principal}} at {{rate}}%?',
  options: [
    { key: 'A', text: '{{principal}} × {{rate}}%', explanation: 'Correct setup.' },
    { key: 'B', text: '{{principal}} + {{rate}}', explanation: 'This adds unlike values.' },
    { key: 'C', text: '{{principal}} ÷ {{rate}}', explanation: 'This reverses the rate.' },
    { key: 'D', text: '{{principal}} − {{rate}}', explanation: 'This subtracts the rate.' },
  ],
  correctKey: 'A',
  difficulty: 'medium' as const,
  script,
};

jest.setTimeout(15_000);

describe('parameterized-script migration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLosCol.mockReturnValue({ findOne: jest.fn() } as never);
    mockThemesCol.mockReturnValue({ findOne: jest.fn() } as never);
    mockCreateQuestion.mockResolvedValue({
      questionId: new ObjectId(),
      version: { _id: new ObjectId() },
    } as never);
  });

  it('runs a valid script with a fixed seed and creates a parameterized Draft', async () => {
    const preview = await previewScriptMigration(validInput);
    const result = await migrateScript(courseId, {
      ...validInput,
      byPuid: 'faculty-puid',
      sourceName: 'legacy-generator.js',
    });

    expect(preview.mismatches).toEqual([]);
    expect(preview.sampleValues).toEqual(result.sampleValues);
    expect(preview.sampleValues).toEqual({
      principal: expect.any(Number),
      rate: 5,
    });
    expect(preview.sampleStem).not.toContain('{{');
    expect(result.questionId).toEqual(expect.any(ObjectId));
    expect(mockCreateQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        courseId,
        stem: validInput.stem,
        generateScript: script,
        createdBy: 'faculty-puid',
        provenance: {
          kind: 'script-migration',
          sourceName: 'legacy-generator.js',
        },
      }),
    );
  });

  it('lists variable/template mismatches and never inserts', async () => {
    const mismatched = {
      ...validInput,
      stem: 'What is the return on {{principal}} over {{years}} years?',
    };

    const preview = await previewScriptMigration(mismatched);
    const result = await migrateScript(courseId, {
      ...mismatched,
      byPuid: 'faculty-puid',
    });

    expect(preview.mismatches).toEqual([
      'vars.rate has no matching {{rate}} placeholder in the stem',
      '{{years}} has no matching generated vars.years',
    ]);
    expect(result.mismatches).toEqual(preview.mismatches);
    expect(result).not.toHaveProperty('questionId');
    expect(mockCreateQuestion).not.toHaveBeenCalled();
  });

  it('blocks an unresolved placeholder in an option from being imported', async () => {
    const preview = await previewScriptMigration({
      ...validInput,
      options: validInput.options.map((option, index) =>
        index === 1 ? { ...option, text: '{{missingOptionValue}}' } : option,
      ),
    });

    expect(preview.mismatches).toContain(
      '{{missingOptionValue}} has no matching generated vars.missingOptionValue',
    );
  });

  it('surfaces an infinite loop as a clean 400 without inserting', async () => {
    await expect(
      previewScriptMigration({
        ...validInput,
        script: 'function generate(){ while (true) {} }',
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'script-validation-failed:param-timeout',
    });
    expect(mockCreateQuestion).not.toHaveBeenCalled();
  });
});
