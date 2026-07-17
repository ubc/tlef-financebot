// Unit test — generation.service (PRD §9.1, IN-Q10): the three-agent pipeline
// (generator -> structure validator -> reviewer) and the pre-seeding progress
// rollup. llm/qdrant/embeddings/questions.service/collections/materials are all
// MOCKED — this pins the ORCHESTRATION (which model each step uses, that every
// decision is persisted as a Draft, retry/skip on bad options, per-LO counts),
// not real model output. Task 8 Step 1 cases:
//   1. the three steps run with the three DISTINCT configured models
//   2. a reviewer `reject` STILL inserts a Draft carrying agentDecision.reject
//   3. generator output failing option invariants is retried once, then skipped
//   4. preseedingProgress counts approved/reviewed per LO
jest.mock('../../server/src/config/env', () => ({
  env: {
    llmModelGenerator: 'gen-model',
    llmModelValidator: 'val-model',
    llmModelReviewer: 'rev-model',
    llmDefaultModel: 'default-model',
  },
}));
jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../server/src/components/genai/embeddings', () => ({ embedOne: jest.fn() }));
jest.mock('../../server/src/components/qdrant', () => ({ search: jest.fn() }));
jest.mock('../../server/src/services/questions.service', () => ({ createQuestion: jest.fn() }));
jest.mock('../../server/src/services/materials.service', () => ({
  courseCollection: jest.fn(() => 'course-abc'),
}));
jest.mock('../../server/src/components/jobs', () => ({ defineJob: jest.fn(), enqueueJob: jest.fn() }));
jest.mock('../../server/src/components/mongodb/collections', () => ({
  losCol: jest.fn(),
  questionsCol: jest.fn(),
}));

import { ObjectId } from 'mongodb';
import { runGenerationPipeline, preseedingProgress } from '../../server/src/services/generation.service';
import { completeJson } from '../../server/src/components/genai/llm';
import { embedOne } from '../../server/src/components/genai/embeddings';
import { search } from '../../server/src/components/qdrant';
import { createQuestion } from '../../server/src/services/questions.service';
import { losCol, questionsCol } from '../../server/src/components/mongodb/collections';

const loFindOne = jest.fn();
const loToArray = jest.fn();
const countDocuments = jest.fn();

function validOptions() {
  return [
    { key: 'A', text: '10%', role: 'correct', explanation: 'right' },
    { key: 'B', text: '5%', role: 'common-misconception', explanation: 'mix-up' },
    { key: 'C', text: '8%', role: 'partially-correct', explanation: 'close' },
    { key: 'D', text: '99%', role: 'clearly-wrong', explanation: 'nope' },
  ];
}
function generatorOutput(options = validOptions()) {
  return { stem: 'What is the IRR?', options, difficulty: 'medium' };
}

const courseId = new ObjectId();
const loId = new ObjectId();
const themeId = new ObjectId();
const materialId = new ObjectId();

beforeEach(() => {
  jest.mocked(completeJson).mockReset();
  jest.mocked(embedOne).mockReset();
  jest.mocked(search).mockReset();
  jest.mocked(createQuestion).mockReset();
  loFindOne.mockReset();
  loToArray.mockReset();
  countDocuments.mockReset();

  jest.mocked(losCol).mockReturnValue({
    findOne: loFindOne,
    find: jest.fn(() => ({ sort: jest.fn(() => ({ toArray: loToArray })), toArray: loToArray })),
  } as never);
  jest.mocked(questionsCol).mockReturnValue({ countDocuments } as never);

  loFindOne.mockResolvedValue({ _id: loId, courseId, themeId, name: 'Compute IRR' });
  jest.mocked(embedOne).mockResolvedValue([0.1, 0.2, 0.3]);
  jest.mocked(search).mockResolvedValue([
    { id: 'p1', score: 0.9, payload: { materialId: materialId.toHexString(), chunk: 'IRR context' } },
  ]);
  jest.mocked(createQuestion).mockResolvedValue({
    questionId: new ObjectId(),
    version: { _id: new ObjectId() },
  } as never);
});

describe('runGenerationPipeline — three-agent orchestration (IN-Q05/Q10)', () => {
  it('runs generator, validator, reviewer with the three distinct configured models', async () => {
    jest
      .mocked(completeJson)
      .mockResolvedValueOnce(generatorOutput())
      .mockResolvedValueOnce({ roleAssessment: 'each role fits' })
      .mockResolvedValueOnce({ decision: 'pass', reasoning: 'accurate and clear' });

    const ids = await runGenerationPipeline({ courseId, loId, count: 1, byPuid: 'PUID-INSTR' });

    expect(ids).toHaveLength(1);
    expect(completeJson).toHaveBeenCalledTimes(3);
    expect(jest.mocked(completeJson).mock.calls[0][1]?.model).toBe('gen-model');
    expect(jest.mocked(completeJson).mock.calls[1][1]?.model).toBe('val-model');
    expect(jest.mocked(completeJson).mock.calls[2][1]?.model).toBe('rev-model');
  });

  it('grounds retrieval in the course collection and records sourceRefs + agentDecision', async () => {
    jest
      .mocked(completeJson)
      .mockResolvedValueOnce(generatorOutput())
      .mockResolvedValueOnce({ roleAssessment: 'roles ok' })
      .mockResolvedValueOnce({ decision: 'flag', reasoning: 'double-check the rounding' });

    await runGenerationPipeline({ courseId, loId, count: 1, prompt: 'focus on IRR', byPuid: 'PUID-INSTR' });

    expect(search).toHaveBeenCalledWith('course-abc', [0.1, 0.2, 0.3], 6);
    const arg = jest.mocked(createQuestion).mock.calls[0][0];
    expect(arg.courseId).toEqual(courseId);
    expect(arg.loIds).toEqual([loId]);
    expect(arg.themeIds).toEqual([themeId]);
    expect(arg.createdBy).toBe('PUID-INSTR');
    expect(arg.agentDecision).toEqual({
      decision: 'flag',
      reasoning: 'double-check the rounding',
      roleAssessment: 'roles ok',
    });
    expect(arg.sourceRefs).toEqual([{ materialId, chunk: 'IRR context' }]);
  });

  it('still inserts a Draft when the reviewer REJECTS (nothing is auto-discarded)', async () => {
    jest
      .mocked(completeJson)
      .mockResolvedValueOnce(generatorOutput())
      .mockResolvedValueOnce({ roleAssessment: 'roles ok' })
      .mockResolvedValueOnce({ decision: 'reject', reasoning: 'factually wrong' });

    const ids = await runGenerationPipeline({ courseId, loId, count: 1, byPuid: 'PUID-INSTR' });

    expect(ids).toHaveLength(1);
    expect(createQuestion).toHaveBeenCalledTimes(1);
    expect(jest.mocked(createQuestion).mock.calls[0][0].agentDecision?.decision).toBe('reject');
    // createQuestion itself sets state:'draft'; the pipeline must never publish.
  });

  it('retries the generator once on invalid options, then succeeds', async () => {
    const bad = generatorOutput([
      { key: 'A', text: 'x', role: 'correct', explanation: '' },
      { key: 'B', text: 'y', role: 'correct', explanation: '' }, // two correct -> invalid
    ]);
    jest
      .mocked(completeJson)
      .mockResolvedValueOnce(bad) // generator attempt 1 (invalid)
      .mockResolvedValueOnce(generatorOutput()) // generator attempt 2 (valid)
      .mockResolvedValueOnce({ roleAssessment: 'roles ok' })
      .mockResolvedValueOnce({ decision: 'pass', reasoning: 'ok' });

    const ids = await runGenerationPipeline({ courseId, loId, count: 1, byPuid: 'PUID-INSTR' });

    expect(ids).toHaveLength(1);
    expect(createQuestion).toHaveBeenCalledTimes(1);
  });

  it('skips the question (no insert) and warns when options are invalid twice', async () => {
    const bad = generatorOutput([{ key: 'A', text: 'x', role: 'correct', explanation: '' }]); // 1 option -> invalid
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.mocked(completeJson).mockResolvedValueOnce(bad).mockResolvedValueOnce(bad);

    const ids = await runGenerationPipeline({ courseId, loId, count: 1, byPuid: 'PUID-INSTR' });

    expect(ids).toHaveLength(0);
    expect(createQuestion).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('preseedingProgress — per-LO approved/reviewed counts (IN-Q10)', () => {
  it('returns approved and reviewed counts per LO with target 5', async () => {
    const lo1 = new ObjectId();
    const lo2 = new ObjectId();
    loToArray.mockResolvedValue([
      { _id: lo1, courseId, name: 'LO one', order: 1 },
      { _id: lo2, courseId, name: 'LO two', order: 2 },
    ]);
    countDocuments.mockImplementation(async (filter: { loIds: ObjectId; state: string }) => {
      if (filter.loIds.equals(lo1)) return filter.state === 'approved' ? 4 : 2;
      if (filter.loIds.equals(lo2)) return filter.state === 'approved' ? 0 : 1;
      return 0;
    });

    const result = await preseedingProgress(courseId);

    expect(result).toEqual([
      { loId: lo1, loName: 'LO one', approved: 4, reviewed: 2, target: 5 },
      { loId: lo2, loName: 'LO two', approved: 0, reviewed: 1, target: 5 },
    ]);
  });
});
