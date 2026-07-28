// Integration test — the practice router via supertest, mirroring
// tests/unit/courses.routes.test.ts's makeApp pattern but with req.user set
// to a domain-User fixture carrying courseRoles. attempts.service and
// serving.service are fully mocked.
import express, { type Express } from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import type { User } from '../../server/src/types/domain';

jest.mock('../../server/src/services/serving.service', () => ({
  selectNextQuestion: jest.fn(),
  studentCourseHome: jest.fn(),
}));

jest.mock('../../server/src/services/attempts.service', () => ({
  submitAttempt: jest.fn(),
  getCourseIdForQuestionVersion: jest.fn(),
}));

jest.mock('../../server/src/services/mastery.service', () => ({
  recordSkip: jest.fn(),
}));

jest.mock('../../server/src/services/review-book.service', () => ({
  storeDeferredSummary: jest.fn(),
  getSessionSummaryForStart: jest.fn(),
}));

jest.mock('../../server/src/services/progression.service', () => ({
  getRedirectMaterialSource: jest.fn(),
}));

import { practiceRouter } from '../../server/src/routes/practice.routes';
import { errorHandler } from '../../server/src/middleware/error-handler';
import { selectNextQuestion, studentCourseHome } from '../../server/src/services/serving.service';
import { submitAttempt, getCourseIdForQuestionVersion } from '../../server/src/services/attempts.service';
import { recordSkip } from '../../server/src/services/mastery.service';
import { storeDeferredSummary, getSessionSummaryForStart } from '../../server/src/services/review-book.service';
import { getRedirectMaterialSource } from '../../server/src/services/progression.service';

const courseId = new ObjectId();
const loId = new ObjectId();

function userFixture(courseRoles: User['courseRoles']): User {
  return {
    puid: 'PUID-STUDENT-0001',
    uid: 'student1',
    displayName: 'Student One',
    email: 'student1@example.ubc.ca',
    affiliations: ['student'],
    isAdmin: false,
    courseRoles,
    createdAt: new Date(),
    lastLoginAt: new Date(),
  };
}

const student = userFixture([{ courseId, role: 'student' }]);
const nonEnrolled = userFixture([]);

function makeApp(user?: User): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated = () => Boolean(user);
    (req as { user?: unknown }).user = user;
    next();
  });
  app.use('/api', practiceRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  jest.mocked(selectNextQuestion).mockReset();
  jest.mocked(studentCourseHome).mockReset();
  jest.mocked(submitAttempt).mockReset();
  jest.mocked(getCourseIdForQuestionVersion).mockReset();
  jest.mocked(recordSkip).mockReset();
  jest.mocked(storeDeferredSummary).mockReset();
  jest.mocked(getSessionSummaryForStart).mockReset();
  jest.mocked(getRedirectMaterialSource).mockReset();
});

// -----------------------------------------------------------------------------
// Security-relevant: /practice/next must NEVER leak role/explanation/
// correctness anywhere in the response JSON. Walks the FULL response tree
// (every key at every depth, arrays included) against a denylist, rather than
// spot-checking known field names — so a future field addition can't
// silently reintroduce a leak.
// -----------------------------------------------------------------------------

const DENYLIST = new Set(['role', 'explanation', 'correct']);

function collectKeys(value: unknown, found: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, found);
  } else if (value && typeof value === 'object') {
    for (const [key, val] of Object.entries(value)) {
      found.add(key);
      collectKeys(val, found);
    }
  }
  return found;
}

describe('POST /api/courses/:courseId/practice/next — serving-response no-leak (security)', () => {
  it('never leaks role/explanation/correct anywhere in the JSON tree, and includes the watermark', async () => {
    const questionId = new ObjectId();
    const versionId = new ObjectId();
    jest.mocked(selectNextQuestion).mockResolvedValue({
      question: { _id: questionId } as never,
      version: {
        _id: versionId,
        type: 'mcq',
        stem: 'What is 2+2?',
        difficulty: 'medium',
        options: [
          { key: 'A', text: 'Option A', role: 'correct', explanation: 'Because A is right.' },
          { key: 'B', text: 'Option B', role: 'common-misconception', explanation: 'Because B is a trap.' },
          { key: 'C', text: 'Option C', role: 'partially-correct', explanation: 'Halfway.' },
          { key: 'D', text: 'Option D', role: 'clearly-wrong', explanation: 'Way off.' },
        ],
      } as never,
      degraded: 'none',
    });

    const res = await request(makeApp(student))
      .post(`/api/courses/${courseId.toHexString()}/practice/next`)
      .send({ loId: loId.toHexString(), sessionServedIds: [] });

    expect(res.status).toBe(200);
    const keys = collectKeys(res.body);
    for (const banned of DENYLIST) {
      expect(keys.has(banned)).toBe(false);
    }
    expect(res.body.watermark).toBe(student.uid);
    expect(res.body.options).toEqual([
      { key: 'A', text: 'Option A' },
      { key: 'B', text: 'Option B' },
      { key: 'C', text: 'Option C' },
      { key: 'D', text: 'Option D' },
    ]);
  });

  it('404s when no question is available for the LO', async () => {
    jest.mocked(selectNextQuestion).mockResolvedValue(null);

    const res = await request(makeApp(student))
      .post(`/api/courses/${courseId.toHexString()}/practice/next`)
      .send({ loId: loId.toHexString() });

    expect(res.status).toBe(404);
  });
});

// -----------------------------------------------------------------------------
// Task 5 (IN-Q09/ST-P03): a parameterized question's `/practice/next`
// response substitutes the {{slot}} stem/option placeholders with a freshly
// drawn seed's values, and returns both `paramValues` and `seed` so the
// client can echo them back on submission. resolveParamValues/substituteParams
// (params.service.ts) run for real here — not mocked — over a fixed
// `paramSlots` version, so this also exercises the seeded-draw path
// end-to-end through the route.
// -----------------------------------------------------------------------------
describe('POST /api/courses/:courseId/practice/next — parameterized question', () => {
  it('substitutes stem/options and returns paramValues + seed for a paramSlots version', async () => {
    const questionId = new ObjectId();
    const versionId = new ObjectId();
    jest.mocked(selectNextQuestion).mockResolvedValue({
      question: { _id: questionId } as never,
      version: {
        _id: versionId,
        type: 'mcq',
        stem: 'A loan of {{principal}} at {{rate}}%.',
        difficulty: 'medium',
        paramSlots: [
          { name: 'principal', min: 1000, max: 1000, step: 1 },
          { name: 'rate', min: 5, max: 5, step: 1 },
        ],
        options: [
          { key: 'A', text: 'The rate is {{rate}}%', role: 'correct', explanation: 'e' },
          { key: 'B', text: 'Option B', role: 'common-misconception', explanation: 'e' },
          { key: 'C', text: 'Option C', role: 'partially-correct', explanation: 'e' },
          { key: 'D', text: 'Option D', role: 'clearly-wrong', explanation: 'e' },
        ],
      } as never,
      degraded: 'none',
    });

    const res = await request(makeApp(student))
      .post(`/api/courses/${courseId.toHexString()}/practice/next`)
      .send({ loId: loId.toHexString(), sessionServedIds: [] });

    expect(res.status).toBe(200);
    expect(res.body.stem).toBe('A loan of 1000 at 5%.');
    expect(res.body.options[0]).toEqual({ key: 'A', text: 'The rate is 5%' });
    expect(res.body.paramValues).toEqual({ principal: 1000, rate: 5 });
    expect(typeof res.body.seed).toBe('number');
  });

  it('omits paramValues/seed entirely for a non-parameterized question', async () => {
    const questionId = new ObjectId();
    const versionId = new ObjectId();
    jest.mocked(selectNextQuestion).mockResolvedValue({
      question: { _id: questionId } as never,
      version: {
        _id: versionId,
        type: 'true-false',
        stem: 'Is this true?',
        difficulty: 'easy',
        options: [
          { key: 'T', text: 'True', role: 'correct', explanation: 'e' },
          { key: 'F', text: 'False', role: 'common-misconception', explanation: 'e' },
        ],
      } as never,
      degraded: 'none',
    });

    const res = await request(makeApp(student))
      .post(`/api/courses/${courseId.toHexString()}/practice/next`)
      .send({ loId: loId.toHexString(), sessionServedIds: [] });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('paramValues');
    expect(res.body).not.toHaveProperty('seed');
  });
});

describe('practice routes — 403 non-enrolled', () => {
  it('403s a non-enrolled student on /practice/next', async () => {
    const res = await request(makeApp(nonEnrolled))
      .post(`/api/courses/${courseId.toHexString()}/practice/next`)
      .send({ loId: loId.toHexString() });

    expect(res.status).toBe(403);
    expect(selectNextQuestion).not.toHaveBeenCalled();
  });

  it('403s a non-enrolled student on /home', async () => {
    const res = await request(makeApp(nonEnrolled)).get(`/api/courses/${courseId.toHexString()}/home`);
    expect(res.status).toBe(403);
  });

  it('403s a non-enrolled student before resolving a redirect material source', async () => {
    const res = await request(makeApp(nonEnrolled)).get(
      `/api/courses/${courseId.toHexString()}/los/${loId.toHexString()}` +
      `/materials/${new ObjectId().toHexString()}/source`,
    );

    expect(res.status).toBe(403);
    expect(getRedirectMaterialSource).not.toHaveBeenCalled();
  });
});

describe('GET redirect material source', () => {
  it('redirects an enrolled student to a linked URL material', async () => {
    const materialId = new ObjectId();
    jest.mocked(getRedirectMaterialSource).mockResolvedValue({
      kind: 'url',
      url: 'https://example.com/week-2',
    });

    const res = await request(makeApp(student)).get(
      `/api/courses/${courseId.toHexString()}/los/${loId.toHexString()}` +
      `/materials/${materialId.toHexString()}/source`,
    );

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://example.com/week-2');
    expect(getRedirectMaterialSource).toHaveBeenCalledWith(
      expect.any(ObjectId),
      expect.any(ObjectId),
      expect.any(ObjectId),
    );
  });

  it('404s a missing or unassigned redirect material', async () => {
    jest.mocked(getRedirectMaterialSource).mockResolvedValue(null);

    const res = await request(makeApp(student)).get(
      `/api/courses/${courseId.toHexString()}/los/${loId.toHexString()}` +
      `/materials/${new ObjectId().toHexString()}/source`,
    );

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('material-not-found');
  });
});

describe('POST /api/courses/:courseId/los/:loId/skip', () => {
  it('204s a successful skip', async () => {
    jest.mocked(recordSkip).mockResolvedValue(undefined);

    const res = await request(makeApp(student))
      .post(`/api/courses/${courseId.toHexString()}/los/${loId.toHexString()}/skip`)
      .send({});

    expect(res.status).toBe(204);
    expect(recordSkip).toHaveBeenCalledWith(student.puid, expect.any(ObjectId), expect.any(ObjectId), false);
  });
});

describe('POST /api/attempts', () => {
  it('403s a non-enrolled student (course resolved from the questionVersionId)', async () => {
    const questionVersionId = new ObjectId();
    jest.mocked(getCourseIdForQuestionVersion).mockResolvedValue(courseId);

    const res = await request(makeApp(nonEnrolled))
      .post('/api/attempts')
      .send({ questionVersionId: questionVersionId.toHexString(), loId: loId.toHexString(), mode: 'topic-practice', selectedKey: 'A' });

    expect(res.status).toBe(403);
    expect(submitAttempt).not.toHaveBeenCalled();
  });

  it('404s when the resolved question does not exist', async () => {
    const questionVersionId = new ObjectId();
    jest.mocked(getCourseIdForQuestionVersion).mockResolvedValue(null);

    const res = await request(makeApp(student))
      .post('/api/attempts')
      .send({ questionVersionId: questionVersionId.toHexString(), loId: loId.toHexString(), mode: 'topic-practice', selectedKey: 'A' });

    expect(res.status).toBe(404);
    expect(submitAttempt).not.toHaveBeenCalled();
  });

  it('maps a question-not-servable error to 404', async () => {
    const questionVersionId = new ObjectId();
    jest.mocked(getCourseIdForQuestionVersion).mockResolvedValue(courseId);
    jest.mocked(submitAttempt).mockRejectedValue(new Error('question-not-servable'));

    const res = await request(makeApp(student))
      .post('/api/attempts')
      .send({ questionVersionId: questionVersionId.toHexString(), loId: loId.toHexString(), mode: 'topic-practice', selectedKey: 'A' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('question-not-servable');
  });

  it('200s a submitted attempt', async () => {
    const questionVersionId = new ObjectId();
    jest.mocked(getCourseIdForQuestionVersion).mockResolvedValue(courseId);
    jest.mocked(submitAttempt).mockResolvedValue({
      correct: true,
      feedback: { strategy: 'b', revealed: [] },
      mastery: { loStatus: 'in-progress' },
      reviewBook: { added: false },
    } as never);

    const res = await request(makeApp(student))
      .post('/api/attempts')
      .send({ questionVersionId: questionVersionId.toHexString(), loId: loId.toHexString(), mode: 'topic-practice', selectedKey: 'A' });

    expect(res.status).toBe(200);
    expect(res.body.correct).toBe(true);
  });

  // Final whole-branch review I1: the client (practice-card.ts) now echoes
  // `question.paramValues` back in the `POST /api/attempts` body when the
  // served question was parameterized. This proves the server side of that
  // contract — a `paramValues` field in the request body reaches
  // `submitAttempt`'s input unchanged — so paired with practice.routes.test's
  // "parameterized question" describe above (proving `/practice/next` returns
  // `paramValues` for the client to echo) and attempts.service.test.ts's
  // paramValues-substitution coverage, the full round trip is exercised.
  it('forwards a parameterized submission\'s paramValues from the request body to submitAttempt (I1 client echo contract)', async () => {
    const questionVersionId = new ObjectId();
    jest.mocked(getCourseIdForQuestionVersion).mockResolvedValue(courseId);
    jest.mocked(submitAttempt).mockResolvedValue({
      correct: true,
      feedback: { strategy: 'b', revealed: [] },
      mastery: { loStatus: 'in-progress' },
      reviewBook: { added: false },
    } as never);

    const res = await request(makeApp(student))
      .post('/api/attempts')
      .send({
        questionVersionId: questionVersionId.toHexString(),
        loId: loId.toHexString(),
        mode: 'topic-practice',
        selectedKey: 'A',
        paramValues: { principal: 1000, rate: 5 },
      });

    expect(res.status).toBe(200);
    expect(submitAttempt).toHaveBeenCalledWith(expect.objectContaining({ paramValues: { principal: 1000, rate: 5 } }));
  });
});

describe('GET /api/courses/:courseId/home', () => {
  it('200s the student course home', async () => {
    jest.mocked(studentCourseHome).mockResolvedValue([]);

    const res = await request(makeApp(student)).get(`/api/courses/${courseId.toHexString()}/home`);

    expect(res.status).toBe(200);
    expect(studentCourseHome).toHaveBeenCalledWith(student.puid, expect.any(ObjectId));
  });
});

describe('GET /api/courses/:courseId/session-summary', () => {
  it('200s the session summary', async () => {
    jest.mocked(getSessionSummaryForStart).mockResolvedValue({ welcome: true });

    const res = await request(makeApp(student)).get(`/api/courses/${courseId.toHexString()}/session-summary`);

    expect(res.status).toBe(200);
    expect(getSessionSummaryForStart).toHaveBeenCalledWith(student.puid, expect.any(ObjectId));
  });
});

describe('PUT /api/courses/:courseId/deferred-summary', () => {
  it('200s and stores the deferred summary computed since the given timestamp', async () => {
    const computed = {
      losCovered: [],
      questionsAttempted: 0,
      accuracyByLo: [],
      reviewBookAdditions: [],
      missedQuestions: [],
    };
    jest.mocked(storeDeferredSummary).mockResolvedValue(computed);

    const res = await request(makeApp(student))
      .put(`/api/courses/${courseId.toHexString()}/deferred-summary`)
      .send({ since: '2026-03-01T00:00:00Z' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(computed);
    expect(storeDeferredSummary).toHaveBeenCalledWith(student.puid, expect.any(ObjectId), expect.any(Date));
  });
});
