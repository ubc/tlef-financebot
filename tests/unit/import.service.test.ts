import fs from 'node:fs';
import path from 'node:path';
import { ObjectId } from 'mongodb';
import { completeJson } from '../../server/src/components/genai/llm';
import { losCol, themesCol } from '../../server/src/components/mongodb/collections';
import {
  commitImport,
  isParameterizable,
  parseImport,
  type ImportCandidate,
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

const mockCompleteJson = completeJson as jest.MockedFunction<typeof completeJson>;
const mockCreateQuestion = createQuestion as jest.MockedFunction<typeof createQuestion>;
const mockLosCol = losCol as jest.MockedFunction<typeof losCol>;
const mockThemesCol = themesCol as jest.MockedFunction<typeof themesCol>;

const fixtures = path.resolve(__dirname, '../fixtures');
const readFixture = (name: string): string => fs.readFileSync(path.join(fixtures, name), 'utf8');

describe('parseImport', () => {
  it('parses four valid CSV rows and reports the broken row without blocking them', () => {
    const result = parseImport('csv', readFixture('import-sample.csv'));

    expect(result.candidates).toHaveLength(4);
    expect(result.failures).toEqual([
      expect.objectContaining({ line: 6, reason: expect.stringContaining('options') }),
    ]);
    expect(result.candidates[0]).toMatchObject({
      type: 'mcq',
      correctKey: 'B',
      parameterizable: true,
    });
    expect(result.candidates[3]).toMatchObject({
      type: 'true-false',
      correctKey: 'T',
    });
  });

  it('parses JSON including an other candidate and keeps one invalid item as a failure', () => {
    const result = parseImport('json', readFixture('import-sample.json'));

    expect(result.candidates).toHaveLength(4);
    expect(result.candidates.some((candidate) => candidate.type === 'other')).toBe(true);
    expect(result.failures).toEqual([
      expect.objectContaining({ line: 5, reason: expect.stringContaining('stem') }),
    ]);
  });

  it('parses four QTI choiceInteraction items and identifies the broken item', () => {
    const result = parseImport('qti', readFixture('import-sample-qti.xml'));

    expect(result.candidates).toHaveLength(4);
    expect(result.candidates.map((candidate) => candidate.type)).toEqual([
      'mcq',
      'mcq',
      'mcq',
      'true-false',
    ]);
    expect(result.failures).toEqual([
      expect.objectContaining({ line: 'qti-broken', reason: expect.stringContaining('correct') }),
    ]);
  });

  it('rejects an unsupported format explicitly', () => {
    expect(() => parseImport('yaml' as 'csv', 'stem: nope')).toThrow('unsupported-import-format:yaml');
  });

  it('accepts the common T/F CSV type spelling', () => {
    const result = parseImport(
      'csv',
      [
        'type,stem,optionA,optionB,correct',
        'T/F,Present value discounts future cash flows.,True,False,T',
      ].join('\n'),
    );

    expect(result.failures).toEqual([]);
    expect(result.candidates[0]).toMatchObject({
      type: 'true-false',
      correctKey: 'T',
    });
  });

  it('flags only stems with distinct numeric values and a currency, percent, or rate cue', () => {
    expect(isParameterizable('Invest $100 at a 5% rate for 2 years.')).toBe(true);
    expect(isParameterizable('Invest $100 today and receive $100 next year.')).toBe(false);
    expect(isParameterizable('Which statement best describes diversification?')).toBe(false);
  });
});

describe('commitImport', () => {
  const courseId = new ObjectId();
  const themeId = new ObjectId();
  const loId = new ObjectId();

  beforeEach(() => {
    jest.clearAllMocks();
    mockThemesCol.mockReturnValue({
      findOne: jest.fn().mockResolvedValue({ _id: themeId, courseId }),
    } as never);
    mockLosCol.mockReturnValue({
      findOne: jest.fn().mockResolvedValue({ _id: loId, courseId, themeId }),
    } as never);
    mockCreateQuestion.mockResolvedValue({
      questionId: new ObjectId(),
      version: { _id: new ObjectId() },
    } as never);
  });

  it('creates Draft-backed questions and labels parameterizable and auto-converted items', async () => {
    const candidates: ImportCandidate[] = [
      {
        type: 'mcq',
        stem: 'A $100 investment earns 5% for 2 years. Which expression is correct?',
        options: ['A', 'B', 'C', 'D'].map((key) => ({
          key,
          text: `Option ${key}`,
          explanation: '',
        })),
        correctKey: 'B',
        difficulty: 'medium',
        parameterizable: true,
      },
      {
        type: 'other',
        stem: 'Explain why opportunity cost is incremental.',
        options: [],
        correctKey: '',
        difficulty: 'medium',
        parameterizable: false,
      },
    ];
    mockCompleteJson.mockResolvedValue({
      type: 'mcq',
      stem: 'Why is opportunity cost included?',
      options: [
        { key: 'A', text: 'It is a forgone benefit.', explanation: 'Correct.' },
        { key: 'B', text: 'It is a sunk cost.', explanation: 'Sunk costs are excluded.' },
        { key: 'C', text: 'It is financing.', explanation: 'Financing is separate.' },
        { key: 'D', text: 'It is depreciation.', explanation: 'Not necessarily.' },
      ],
      correctKey: 'A',
      difficulty: 'medium',
    } as never);

    const result = await commitImport(courseId, candidates, {
      themeId,
      loId,
      byPuid: 'faculty-puid',
    });

    expect(result).toEqual({ imported: 2, autoConverted: 1 });
    expect(mockCreateQuestion).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        courseId,
        loIds: [loId],
        themeIds: [themeId],
        labels: ['convertible-to-parameterized'],
      }),
    );
    expect(mockCreateQuestion).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'mcq',
        labels: ['auto-converted'],
      }),
    );
  });

  it('revalidates untrusted preview candidates before writing anything', async () => {
    await expect(
      commitImport(
        courseId,
        [
          {
            type: 'mcq',
            stem: 'Broken',
            options: [{ key: 'A', text: 'Only option', explanation: '' }],
            correctKey: 'A',
            parameterizable: false,
          },
        ],
        { byPuid: 'faculty-puid' },
      ),
    ).rejects.toThrow('invalid-import-candidate:expected-4-options');

    expect(mockCreateQuestion).not.toHaveBeenCalled();
  });

  it('rejects an LO assignment from another course', async () => {
    mockLosCol.mockReturnValue({
      findOne: jest.fn().mockResolvedValue({
        _id: loId,
        courseId: new ObjectId(),
        themeId,
      }),
    } as never);

    await expect(
      commitImport(
        courseId,
        [
          {
            type: 'true-false',
            stem: 'A valid statement.',
            options: [
              { key: 'T', text: 'True', explanation: '' },
              { key: 'F', text: 'False', explanation: '' },
            ],
            correctKey: 'T',
            parameterizable: false,
          },
        ],
        { loId, byPuid: 'faculty-puid' },
      ),
    ).rejects.toThrow('lo-not-in-course');

    expect(mockCreateQuestion).not.toHaveBeenCalled();
  });
});
