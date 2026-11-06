// Integration test — generationRouter via supertest, mirroring
// materials.routes.test.ts's makeApp pattern (req.user carries courseRoles).
// The service is mocked; this file is only about the ROUTE
// layer: instructor guarding, body validation, enqueue + 202 shape, and the
// preseeding read.
import express, { type Express } from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import type { User } from '../../server/src/types/domain';

jest.mock('../../server/src/services/generation.service', () => ({
  enqueueGenerationRun: jest.fn(),
  preseedingProgress: jest.fn(),
  MAX_SECONDARY_LOS: 2,
  PRESET_PROMPTS: [
    { label: 'Calculation question', text: 'Write a calculation question.' },
    { label: 'Concept check', text: 'Write a concept check.' },
    { label: 'Common-misconception probe', text: 'Probe a misconception.' },
    { label: 'Applied scenario', text: 'Write an applied scenario.' },
  ],
}));
jest.mock('../../server/src/services/generation-plan.service', () => ({
  autoGenerationPlan: jest.fn(), enqueueGenerationPlan: jest.fn(), PLAN_MAX_CELLS: 120, PLAN_MAX_COUNT: 20,
}));
jest.mock('../../server/src/services/generation-blueprints.service', () => ({ enqueueBlueprintRun: jest.fn() }));
jest.mock('../../server/src/services/question-generation/pipeline', () => ({ regenerateQuestionVariant: jest.fn() }));

import { generationRouter } from '../../server/src/routes/generation.routes';
import { errorHandler } from '../../server/src/middleware/error-handler';
import {
  enqueueGenerationRun,
  preseedingProgress,
} from '../../server/src/services/generation.service';
import { regenerateQuestionVariant } from '../../server/src/services/question-generation/pipeline';
import { enqueueGenerationPlan } from '../../server/src/services/generation-plan.service';
import { enqueueBlueprintRun } from '../../server/src/services/generation-blueprints.service';

const courseId = new ObjectId();
const loId = new ObjectId();
const questionId = new ObjectId();

function userFixture(courseRoles: User['courseRoles']): User {
  return {
    puid: 'PUID-INSTR-0001',
    uid: 'instr1',
    displayName: 'Instructor One',
    email: 'instr1@example.ubc.ca',
    affiliations: ['faculty'],
    isAdmin: false,
    courseRoles,
    createdAt: new Date(),
    lastLoginAt: new Date(),
  };
}
const instructor = userFixture([{ courseId, role: 'instructor' }]);
const student = userFixture([{ courseId, role: 'student' }]);

function makeApp(user?: User): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated = () => Boolean(user);
    (req as { user?: unknown }).user = user;
    next();
  });
  app.use('/api', generationRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  jest.mocked(enqueueGenerationRun).mockReset();
  jest.mocked(enqueueGenerationRun).mockResolvedValue(new ObjectId());
  jest.mocked(preseedingProgress).mockReset();
  jest.mocked(regenerateQuestionVariant).mockReset();
  jest.mocked(enqueueGenerationPlan).mockReset();
  jest.mocked(enqueueGenerationPlan).mockResolvedValue({ runs: [] });
  jest.mocked(enqueueBlueprintRun).mockReset();
  jest.mocked(enqueueBlueprintRun).mockResolvedValue(new ObjectId());
});

describe('blueprint runs', () => {
  it('starts a blueprint run with only the course, blueprint and actor', async () => {
    const blueprintId = new ObjectId();
    const res = await request(makeApp(instructor)).post(`/api/courses/${courseId.toHexString()}/generate`)
      .send({ blueprintId: blueprintId.toHexString() });
    expect(res.status).toBe(202);
    expect(enqueueBlueprintRun).toHaveBeenCalledWith(courseId, blueprintId, instructor.puid);
    expect(enqueueGenerationRun).not.toHaveBeenCalled();
  });
});

describe('Task 10 presets and regeneration', () => {
  it('returns presets only to an instructor', async () => {
    const denied = await request(makeApp(student)).get('/api/generation/presets');
    expect(denied.status).toBe(403);

    const allowed = await request(makeApp(instructor)).get('/api/generation/presets');
    expect(allowed.status).toBe(200);
    expect(allowed.body).toHaveLength(4);
  });

  it('regenerate passes only the prompt through and returns the variant', async () => {
    jest.mocked(regenerateQuestionVariant).mockResolvedValue({ variant: { stem: 'S' } } as never);
    const res = await request(makeApp(instructor)).post(`/api/courses/${courseId}/questions/${questionId}/regenerate`).send({ prompt: 'Use bonds' });
    expect(res.status).toBe(200);
    expect(jest.mocked(regenerateQuestionVariant)).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'Use bonds' }));
  });

  it('regenerates through a course-scoped instructor route without saving', async () => {
    jest.mocked(regenerateQuestionVariant).mockResolvedValue({
      variant: { stem: 'Alternative', options: [], difficulty: 'medium' },
    } as never);

    const res = await request(makeApp(instructor))
      .post(`/api/courses/${courseId.toHexString()}/questions/${loId.toHexString()}/regenerate`)
      .send({ prompt: 'Change the scenario.' });

    expect(res.status).toBe(200);
    expect(res.body.variant.stem).toBe('Alternative');
    expect(regenerateQuestionVariant).toHaveBeenCalledWith({
      questionId: loId,
      courseId,
      prompt: 'Change the scenario.',
      byPuid: 'PUID-INSTR-0001',
    });
  });

  it('rejects non-instructors and empty regeneration prompts', async () => {
    const denied = await request(makeApp(student))
      .post(`/api/courses/${courseId.toHexString()}/questions/${loId.toHexString()}/regenerate`)
      .send({ prompt: 'Change it.' });
    expect(denied.status).toBe(403);

    const invalid = await request(makeApp(instructor))
      .post(`/api/courses/${courseId.toHexString()}/questions/${loId.toHexString()}/regenerate`)
      .send({ prompt: '   ' });
    expect(invalid.status).toBe(400);
    expect(regenerateQuestionVariant).not.toHaveBeenCalled();
  });
});

describe('POST /api/courses/:courseId/generate (IN-Q10)', () => {
  it('403s a non-instructor and does not enqueue', async () => {
    const res = await request(makeApp(student))
      .post(`/api/courses/${courseId.toHexString()}/generate`)
      .send({ loId: loId.toHexString() });
    expect(res.status).toBe(403);
    expect(enqueueGenerationRun).not.toHaveBeenCalled();
  });

  it('400s a missing loId', async () => {
    const res = await request(makeApp(instructor))
      .post(`/api/courses/${courseId.toHexString()}/generate`)
      .send({ count: 3 });
    expect(res.status).toBe(400);
    expect(enqueueGenerationRun).not.toHaveBeenCalled();
  });

  it('400s an out-of-range count', async () => {
    const res = await request(makeApp(instructor))
      .post(`/api/courses/${courseId.toHexString()}/generate`)
      .send({ loId: loId.toHexString(), count: 999 });
    expect(res.status).toBe(400);
    expect(enqueueGenerationRun).not.toHaveBeenCalled();
  });

  it('202s an instructor, creates a durable run with the resolved payload, and returns its runId', async () => {
    const runId = new ObjectId();
    jest.mocked(enqueueGenerationRun).mockResolvedValue(runId);
    const res = await request(makeApp(instructor))
      .post(`/api/courses/${courseId.toHexString()}/generate`)
      .send({ loId: loId.toHexString(), count: 2, type: 'mcq', prompt: 'focus on IRR' });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ runId: runId.toHexString() });
    expect(enqueueGenerationRun).toHaveBeenCalledWith({
      courseId,
      loId,
      count: 2,
      type: 'mcq',
      prompt: 'focus on IRR',
      byPuid: 'PUID-INSTR-0001',
    });
  });

  it('defaults count when omitted', async () => {
    await request(makeApp(instructor))
      .post(`/api/courses/${courseId.toHexString()}/generate`)
      .send({ loId: loId.toHexString() });
    expect(jest.mocked(enqueueGenerationRun).mock.calls[0]![0]).toMatchObject({ count: 3 });
  });

  it('returns a recoverable conflict before enqueue when the LO has no assigned material', async () => {
    jest.mocked(enqueueGenerationRun).mockRejectedValue(new Error('generation-no-assigned-materials'));

    const res = await request(makeApp(instructor))
      .post(`/api/courses/${courseId.toHexString()}/generate`)
      .send({ loId: loId.toHexString() });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'generation-no-assigned-materials' });
  });

  describe('multi-LO generation (secondaryLoIds)', () => {
    const secondA = new ObjectId();
    const secondB = new ObjectId();
    const post = (body: Record<string, unknown>) =>
      request(makeApp(instructor)).post(`/api/courses/${courseId.toHexString()}/generate`).send(body);

    it('passes up to two distinct secondary objectives through as ObjectIds', async () => {
      const res = await post({
        loId: loId.toHexString(),
        secondaryLoIds: [secondA.toHexString(), secondB.toHexString()],
      });
      expect(res.status).toBe(202);
      expect(jest.mocked(enqueueGenerationRun).mock.calls[0]![0]).toMatchObject({
        loId,
        secondaryLoIds: [secondA, secondB],
      });
    });

    it('omits the field entirely when the list is empty', async () => {
      await post({ loId: loId.toHexString(), secondaryLoIds: [] });
      expect(jest.mocked(enqueueGenerationRun).mock.calls[0]![0]).not.toHaveProperty('secondaryLoIds');
    });

    it('400s more than two, a repeat of the primary, a duplicate, and a mix with blueprintId', async () => {
      const third = new ObjectId();
      for (const body of [
        { loId: loId.toHexString(), secondaryLoIds: [secondA, secondB, third].map((id) => id.toHexString()) },
        { loId: loId.toHexString(), secondaryLoIds: [loId.toHexString()] },
        { loId: loId.toHexString(), secondaryLoIds: [secondA.toHexString(), secondA.toHexString()] },
        { blueprintId: new ObjectId().toHexString(), secondaryLoIds: [secondA.toHexString()] },
      ]) {
        const res = await post(body);
        expect(res.status).toBe(400);
      }
      expect(enqueueGenerationRun).not.toHaveBeenCalled();
    });

    it('maps the secondary-objective service errors to actionable statuses', async () => {
      for (const [code, status] of [
        ['generation-secondary-lo-no-materials', 409],
        ['generation-secondary-lo-duplicate', 400],
        ['generation-secondary-lo-no-grounding', 422],
      ] as const) {
        jest.mocked(enqueueGenerationRun).mockRejectedValueOnce(new Error(code));
        const res = await post({ loId: loId.toHexString(), secondaryLoIds: [secondA.toHexString()] });
        expect(res.status).toBe(status);
        expect(res.body).toEqual({ error: code });
      }
    });
  });
});

describe('GET /api/courses/:courseId/preseeding (IN-Q10)', () => {
  it('403s a non-instructor', async () => {
    const res = await request(makeApp(student)).get(`/api/courses/${courseId.toHexString()}/preseeding`);
    expect(res.status).toBe(403);
    expect(preseedingProgress).not.toHaveBeenCalled();
  });

  it('200s an instructor and returns the per-LO progress', async () => {
    jest
      .mocked(preseedingProgress)
      .mockResolvedValue([
        { loId, loName: 'Compute IRR', approved: 4, reviewed: 1, unapproved: 3, target: 5 },
      ] as never);

    const res = await request(makeApp(instructor)).get(`/api/courses/${courseId.toHexString()}/preseeding`);

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      loName: 'Compute IRR',
      approved: 4,
      reviewed: 1,
      unapproved: 3,
      target: 5,
    });
    expect(preseedingProgress).toHaveBeenCalledWith(expect.any(ObjectId));
  });
});

