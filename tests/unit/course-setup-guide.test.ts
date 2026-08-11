import { parseLearningObjectiveLines } from '../../client/src/views/instructor/course-setup-guide';

describe('course setup guide Learning Objective input', () => {
  it('normalizes common list prefixes and ignores blank lines', () => {
    expect(parseLearningObjectiveLines([
      '  - Explain present value  ',
      '* Calculate net present value',
      '• Compare investment alternatives',
      '1. Recommend an investment',
      '2) Defend the recommendation',
      '',
    ].join('\r\n'))).toEqual([
      'Explain present value',
      'Calculate net present value',
      'Compare investment alternatives',
      'Recommend an investment',
      'Defend the recommendation',
    ]);
  });

  it('deduplicates case-insensitively while preserving the first spelling and order', () => {
    expect(parseLearningObjectiveLines([
      'Evaluate NPV',
      'evaluate npv',
      '  EVALUATE NPV  ',
      'Interpret IRR',
    ].join('\n'))).toEqual(['Evaluate NPV', 'Interpret IRR']);
  });
});
