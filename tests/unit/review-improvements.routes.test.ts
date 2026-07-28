import express, { type Express } from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import type { User } from '../../server/src/types/domain';

jest.mock('../../server/src/services/generation-blueprints.service', () => ({
  createGenerationBlueprint: jest.fn(),
  enqueueBlueprintRun: jest.fn(),
  listGenerationBlueprints: jest.fn(),
  updateGenerationBlueprint: jest.fn(),
  retryGenerationRun: jest.fn(),
}));
jest.mock('../../server/src/services/content-map.service', () => ({
  getCourseContentMap: jest.fn(),
}));
jest.mock('../../server/src/services/content-runs.service', () => ({
  getCourseContentRun: jest.fn(),
  listCourseContentRuns: jest.fn(),
  subscribeToCourseContentRuns: jest.fn(),
}));

import { generationBlueprintsRouter } from '../../server/src/routes/generation-blueprints.routes';
import { contentMapRouter } from '../../server/src/routes/content-map.routes';
import { contentRunsRouter } from '../../server/src/routes/content-runs.routes';
import { errorHandler } from '../../server/src/middleware/error-handler';
import {
  createGenerationBlueprint,
  retryGenerationRun,
} from '../../server/src/services/generation-blueprints.service';
import { getCourseContentMap } from '../../server/src/services/content-map.service';

const courseId = new ObjectId();

function userFixture(courseRoles: User['courseRoles']): User {
  return {
    puid: 'PUID-INSTR',
    uid: 'faculty',
    displayName: 'Faculty',
    email: 'faculty@example.ubc.ca',
    affiliations: ['faculty'],
    isAdmin: false,
    courseRoles,
    createdAt: new Date(),
    lastLoginAt: new Date(),
  };
}

const instructor = userFixture([{ courseId, role: 'instructor' }]);
const outsider = userFixture([]);

function makeApp(user?: User): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated = () => Boolean(user);
    (req as { user?: unknown }).user = user;
    next();
  });
  app.use('/api', generationBlueprintsRouter);
  app.use('/api', contentMapRouter);
  app.use('/api', contentRunsRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('review-improvement instructor routes', () => {
  it('creates a course-scoped generation blueprint for an instructor', async () => {
    const loId = new ObjectId();
    const blueprintId = new ObjectId();
    jest.mocked(createGenerationBlueprint).mockResolvedValue({
      _id: blueprintId,
      courseId,
      name: 'Week 2 recipe',
      loId,
      count: 4,
      type: 'mcq',
    } as never);

    const response = await request(makeApp(instructor))
      .post(`/api/courses/${courseId.toHexString()}/generation-blueprints`)
      .send({
        name: 'Week 2 recipe',
        loId: loId.toHexString(),
        count: 4,
        type: 'mcq',
      });

    expect(response.status).toBe(201);
    expect(createGenerationBlueprint).toHaveBeenCalledWith(
      expect.any(ObjectId),
      instructor.puid,
      expect.objectContaining({ name: 'Week 2 recipe', loId: expect.any(ObjectId), count: 4 }),
    );
  });

  it('rejects an outsider before creating a blueprint', async () => {
    const response = await request(makeApp(outsider))
      .post(`/api/courses/${courseId.toHexString()}/generation-blueprints`)
      .send({
        name: 'Forbidden',
        loId: new ObjectId().toHexString(),
        count: 4,
        type: 'mcq',
      });

    expect(response.status).toBe(403);
    expect(createGenerationBlueprint).not.toHaveBeenCalled();
  });

  it('returns the unified content map only within the instructor course scope', async () => {
    jest.mocked(getCourseContentMap).mockResolvedValue({
      themes: [],
      unassignedMaterials: [],
    });

    const allowed = await request(makeApp(instructor)).get(
      `/api/courses/${courseId.toHexString()}/content-map`,
    );
    const denied = await request(makeApp(outsider)).get(
      `/api/courses/${courseId.toHexString()}/content-map`,
    );

    expect(allowed.status).toBe(200);
    expect(allowed.body).toEqual({ themes: [], unassignedMaterials: [] });
    expect(denied.status).toBe(403);
    expect(getCourseContentMap).toHaveBeenCalledTimes(1);
  });

  it('creates a distinct exact retry and returns its new run id', async () => {
    const originalRunId = new ObjectId();
    const retryRunId = new ObjectId();
    jest.mocked(retryGenerationRun).mockResolvedValue(retryRunId);

    const response = await request(makeApp(instructor)).post(
      `/api/courses/${courseId.toHexString()}/content-runs/${originalRunId.toHexString()}/retry`,
    );

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ runId: retryRunId.toHexString() });
    expect(retryGenerationRun).toHaveBeenCalledWith(
      expect.any(ObjectId),
      expect.any(ObjectId),
      instructor.puid,
    );
  });
});
