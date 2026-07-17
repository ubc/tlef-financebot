// Integration test — generationRouter via supertest, mirroring
// materials.routes.test.ts's makeApp pattern (req.user carries courseRoles).
// The service + jobs component are mocked; this file is only about the ROUTE
// layer: instructor guarding, body validation, enqueue + 202 shape, and the
// preseeding read.
import express, { type Express } from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import type { User } from '../../server/src/types/domain';

jest.mock('../../server/src/components/jobs', () => ({ enqueueJob: jest.fn(), defineJob: jest.fn() }));
jest.mock('../../server/src/services/generation.service', () => ({
  preseedingProgress: jest.fn(),
  GENERATION_JOB: 'generation.run',
}));

import { generationRouter } from '../../server/src/routes/generation.routes';
import { errorHandler } from '../../server/src/middleware/error-handler';
import { enqueueJob } from '../../server/src/components/jobs';
import { preseedingProgress } from '../../server/src/services/generation.service';

const courseId = new ObjectId();
const loId = new ObjectId();

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
  jest.mocked(enqueueJob).mockReset();
  jest.mocked(preseedingProgress).mockReset();
});

describe('POST /api/courses/:courseId/generate (IN-Q10)', () => {
  it('403s a non-instructor and does not enqueue', async () => {
    const res = await request(makeApp(student))
      .post(`/api/courses/${courseId.toHexString()}/generate`)
      .send({ loId: loId.toHexString() });
    expect(res.status).toBe(403);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('400s a missing loId', async () => {
    const res = await request(makeApp(instructor))
      .post(`/api/courses/${courseId.toHexString()}/generate`)
      .send({ count: 3 });
    expect(res.status).toBe(400);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('400s an out-of-range count', async () => {
    const res = await request(makeApp(instructor))
      .post(`/api/courses/${courseId.toHexString()}/generate`)
      .send({ loId: loId.toHexString(), count: 999 });
    expect(res.status).toBe(400);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('202s an instructor, enqueues generation.run with the resolved payload, and returns jobId', async () => {
    const res = await request(makeApp(instructor))
      .post(`/api/courses/${courseId.toHexString()}/generate`)
      .send({ loId: loId.toHexString(), count: 2, type: 'mcq', prompt: 'focus on IRR' });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ jobId: 'generation.run' });
    expect(enqueueJob).toHaveBeenCalledWith('generation.run', {
      courseId: courseId.toHexString(),
      loId: loId.toHexString(),
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
    expect(jest.mocked(enqueueJob).mock.calls[0][1]).toMatchObject({ count: 3 });
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
      .mockResolvedValue([{ loId, loName: 'Compute IRR', approved: 4, reviewed: 1, target: 5 }] as never);

    const res = await request(makeApp(instructor)).get(`/api/courses/${courseId.toHexString()}/preseeding`);

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ loName: 'Compute IRR', approved: 4, reviewed: 1, target: 5 });
    expect(preseedingProgress).toHaveBeenCalledWith(expect.any(ObjectId));
  });
});
