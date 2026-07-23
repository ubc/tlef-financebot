import express, { type Express } from 'express';
import request from 'supertest';
import { EventEmitter } from 'node:events';
import { ObjectId } from 'mongodb';
import type { User } from '../../server/src/types/domain';

jest.mock('../../server/src/services/content-runs.service', () => ({
  getCourseContentRun: jest.fn(),
  listCourseContentRuns: jest.fn(),
  subscribeToCourseContentRuns: jest.fn(),
}));

import { contentRunsRouter } from '../../server/src/routes/content-runs.routes';
import { errorHandler } from '../../server/src/middleware/error-handler';
import {
  getCourseContentRun,
  listCourseContentRuns,
  subscribeToCourseContentRuns,
} from '../../server/src/services/content-runs.service';

const courseId = new ObjectId();
const runId = new ObjectId();

function userFixture(role: 'instructor' | 'student'): User {
  return {
    puid: `PUID-${role}`,
    uid: role,
    displayName: role,
    email: `${role}@example.com`,
    affiliations: [role === 'instructor' ? 'faculty' : 'student'],
    isAdmin: false,
    courseRoles: [{ courseId, role }],
    createdAt: new Date(),
    lastLoginAt: new Date(),
  };
}

function makeApp(user?: User): Express {
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated = () => Boolean(user);
    (req as { user?: unknown }).user = user;
    next();
  });
  app.use('/api', contentRunsRouter);
  app.use(errorHandler);
  return app;
}

function runFixture() {
  const now = new Date();
  return {
    _id: runId,
    courseId,
    kind: 'material-ingest' as const,
    requestedBy: 'PUID-instructor',
    status: 'running' as const,
    stage: 'embedding' as const,
    completedUnits: 2,
    totalUnits: 4,
    revision: 3,
    events: [{ revision: 3, at: now, type: 'progress', status: 'running', stage: 'embedding', completedUnits: 2 }],
    warnings: [],
    input: {
      materialId: new ObjectId(),
      sourceName: 'lecture.pdf',
      sourceFormat: 'pdf' as const,
      trigger: 'upload' as const,
    },
    createdAt: now,
    updatedAt: now,
  };
}

beforeEach(() => {
  jest.mocked(getCourseContentRun).mockReset();
  jest.mocked(listCourseContentRuns).mockReset();
  jest.mocked(subscribeToCourseContentRuns).mockReset();
});

describe('content run route guards and snapshots', () => {
  it('requires authentication and the target course instructor role', async () => {
    const path = `/api/courses/${courseId.toHexString()}/content-runs`;
    expect((await request(makeApp()).get(path)).status).toBe(401);
    expect((await request(makeApp(userFixture('student'))).get(path)).status).toBe(403);
    expect(listCourseContentRuns).not.toHaveBeenCalled();
  });

  it('lists compact run summaries without the bounded event log', async () => {
    jest.mocked(listCourseContentRuns).mockResolvedValue([runFixture()] as never);
    const res = await request(makeApp(userFixture('instructor')))
      .get(`/api/courses/${courseId.toHexString()}/content-runs?kind=material-ingest&status=running&limit=10`);

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ _id: runId.toHexString(), stage: 'embedding', completedUnits: 2 });
    expect(res.body[0].events).toBeUndefined();
    expect(listCourseContentRuns).toHaveBeenCalledWith(
      expect.any(ObjectId),
      { kind: 'material-ingest', status: 'running', limit: 10 },
    );
  });

  it('returns the full persisted snapshot for a run in the guarded course', async () => {
    jest.mocked(getCourseContentRun).mockResolvedValue(runFixture() as never);
    const res = await request(makeApp(userFixture('instructor')))
      .get(`/api/courses/${courseId.toHexString()}/content-runs/${runId.toHexString()}`);

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
  });

  it('returns an indistinguishable 404 when the run is not in the path course', async () => {
    jest.mocked(getCourseContentRun).mockResolvedValue(null);
    const res = await request(makeApp(userFixture('instructor')))
      .get(`/api/courses/${courseId.toHexString()}/content-runs/${runId.toHexString()}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'content-run-not-found' });
  });

  it('rejects a student SSE subscription before registering a listener', async () => {
    const res = await request(makeApp(userFixture('student')))
      .get(`/api/courses/${courseId.toHexString()}/content-runs/events`);
    expect(res.status).toBe(403);
    expect(subscribeToCourseContentRuns).not.toHaveBeenCalled();
  });

  it('replays recent terminal snapshots on reconnect, then streams live updates and cleans up', async () => {
    const run = runFixture();
    const terminalRun = {
      ...run,
      _id: new ObjectId(),
      status: 'failed' as const,
      revision: 4,
      error: { code: 'server-restarted', message: 'Restarted', atStage: 'embedding', retryable: true },
    };
    jest.mocked(listCourseContentRuns).mockResolvedValue([run, terminalRun] as never);
    let listener: ((next: typeof run) => void) | undefined;
    const unsubscribe = jest.fn();
    jest.mocked(subscribeToCourseContentRuns).mockImplementation((_courseId, next) => {
      listener = next as typeof listener;
      return unsubscribe;
    });

    const routeLayer = (contentRunsRouter as unknown as {
      stack: Array<{
        route?: { path: string; stack: Array<{ handle: (req: unknown, res: unknown, next: (error?: unknown) => void) => Promise<void> }> };
      }>;
    }).stack.find((layer) => layer.route?.path === '/courses/:courseId/content-runs/events');
    const handler = routeLayer!.route!.stack.at(-1)!.handle;

    async function connect() {
      const req = new EventEmitter() as EventEmitter & { params: { courseId: string } };
      req.params = { courseId: courseId.toHexString() };
      const writes: string[] = [];
      const res = {
        status: jest.fn().mockReturnThis(),
        setHeader: jest.fn(),
        flushHeaders: jest.fn(),
        write: jest.fn((chunk: string) => {
          writes.push(chunk);
          return true;
        }),
      };
      const next = jest.fn();
      await handler(req, res, next);
      return { req, writes, next };
    }

    const first = await connect();
    expect(first.writes.join('')).toContain('event: snapshot');
    expect(first.writes.join('')).toContain(runId.toHexString());
    expect(first.writes.join('')).toContain(terminalRun._id.toHexString());
    listener?.({ ...run, revision: 4, completedUnits: 3 });
    expect(first.writes.join('')).toContain(`id: ${runId.toHexString()}:4`);
    expect(first.writes.join('')).toContain('event: run');
    first.req.emit('close');
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    const second = await connect();
    expect(second.writes.join('')).toContain('event: snapshot');
    expect(second.writes.join('')).toContain(terminalRun._id.toHexString());
    expect(listCourseContentRuns).toHaveBeenCalledTimes(2);
    expect(listCourseContentRuns).toHaveBeenLastCalledWith(expect.any(ObjectId), { limit: 100 });
    second.req.emit('close');
  });

  it('unsubscribes without writing when the client closes before snapshot lookup finishes', async () => {
    const run = runFixture();
    let resolveRecent!: (runs: typeof run[]) => void;
    jest.mocked(listCourseContentRuns).mockReturnValue(
      new Promise((resolve) => {
        resolveRecent = resolve;
      }) as never,
    );
    const unsubscribe = jest.fn();
    jest.mocked(subscribeToCourseContentRuns).mockReturnValue(unsubscribe);

    const routeLayer = (contentRunsRouter as unknown as {
      stack: Array<{
        route?: { path: string; stack: Array<{ handle: (req: unknown, res: unknown, next: (error?: unknown) => void) => Promise<void> }> };
      }>;
    }).stack.find((layer) => layer.route?.path === '/courses/:courseId/content-runs/events');
    const handler = routeLayer!.route!.stack.at(-1)!.handle;
    const req = new EventEmitter() as EventEmitter & { params: { courseId: string } };
    req.params = { courseId: courseId.toHexString() };
    const res = {
      status: jest.fn().mockReturnThis(),
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn(),
    };
    const next = jest.fn();

    const handling = handler(req, res, next);
    req.emit('close');
    resolveRecent([run]);
    await handling;

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(res.write).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
