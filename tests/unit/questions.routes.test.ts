// Integration test — the questionsRouter via supertest, mirroring
// tests/unit/courses.routes.test.ts's makeApp pattern but with req.user set
// to a domain-User fixture carrying courseRoles. bank.service and
// questions.service are both fully mocked.
import express, { type Express } from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import type { User } from '../../server/src/types/domain';

jest.mock('../../server/src/services/bank.service', () => ({
  browseBank: jest.fn(),
  reviewQueue: jest.fn(),
  getQuestionCourseId: jest.fn(),
  getDistinctQuestionCourseIds: jest.fn(),
  getQuestionDetail: jest.fn(),
}));

jest.mock('../../server/src/services/questions.service', () => ({
  editQuestion: jest.fn(),
  transitionQuestion: jest.fn(),
  bulkTransition: jest.fn(),
}));

import { questionsRouter } from '../../server/src/routes/questions.routes';
import { errorHandler } from '../../server/src/middleware/error-handler';
import {
  browseBank,
  reviewQueue,
  getQuestionCourseId,
  getDistinctQuestionCourseIds,
  getQuestionDetail,
} from '../../server/src/services/bank.service';
import { editQuestion, transitionQuestion, bulkTransition } from '../../server/src/services/questions.service';

const courseId = new ObjectId();
const otherCourseId = new ObjectId();
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
  app.use('/api', questionsRouter);
  // Mounts the real central error handler (not just questionsRouter's
  // router-scoped normalizer) so the 500-propagation test below exercises
  // the actual production path a non-domain error takes, rather than
  // Express's default fallback handler.
  app.use(errorHandler);
  return app;
}

function mcqOption(overrides: Partial<{ key: string; text: string; role: string; explanation: string }> = {}) {
  return { key: 'A', text: 'Option A', role: 'correct', explanation: 'Because', ...overrides };
}

beforeEach(() => {
  jest.mocked(getQuestionCourseId).mockReset();
  jest.mocked(getDistinctQuestionCourseIds).mockReset();
  jest.mocked(browseBank).mockReset();
  jest.mocked(reviewQueue).mockReset();
  jest.mocked(getQuestionDetail).mockReset();
  jest.mocked(editQuestion).mockReset();
  jest.mocked(transitionQuestion).mockReset();
  jest.mocked(bulkTransition).mockReset();
});

describe('GET /api/courses/:courseId/questions (browse, IN-Q08)', () => {
  it('403s a non-instructor', async () => {
    const res = await request(makeApp(student)).get(`/api/courses/${courseId.toHexString()}/questions`);
    expect(res.status).toBe(403);
    expect(browseBank).not.toHaveBeenCalled();
  });

  it('maps the service _id to the contract id field', async () => {
    const current = { _id: new ObjectId(), version: 1, stem: 'x' };
    jest.mocked(browseBank).mockResolvedValue({
      total: 1,
      questions: [
        {
          _id: questionId,
          courseId,
          currentVersionId: current._id,
          currentVersion: 1,
          state: 'draft',
          loIds: [],
          themeIds: [],
          labels: [],
          internalNotes: [],
          createdAt: new Date(),
          updatedAt: new Date(),
          current,
        },
      ],
    } as never);

    const res = await request(makeApp(instructor)).get(`/api/courses/${courseId.toHexString()}/questions`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.questions[0].id).toBe(questionId.toHexString());
    expect(res.body.questions[0]._id).toBeUndefined();
    expect(res.body.questions[0].current.stem).toBe('x');
  });
});

// Review finding 2: questions.routes.ts's browse route is the first use of
// `validate({ query })` in this repo. These tests prove each filter is
// parsed and reaches `browseBank` with the correctly typed value (state as a
// string, loId/themeId coerced to ObjectId, etc.) — the regression the
// finding actually asked about. They do NOT exercise validate.ts's
// Object.defineProperty shadowing of Express 5's req.query getter: every
// field here is a string passthrough, so if that shadowing silently no-op'd
// and left the raw, unparsed `req.query` in place, `?state=approved` would
// still produce `{ state: 'approved' }` and these assertions would still
// pass. Nothing previously asserted a filter actually reaches browseBank at
// all — a regression that silently passed `{}` through would have passed all
// prior tests.
describe('GET /api/courses/:courseId/questions — filter surface (IN-Q08, finding 2)', () => {
  beforeEach(() => {
    jest.mocked(browseBank).mockResolvedValue({ total: 0, questions: [] } as never);
  });

  it('parses and passes the state filter to browseBank', async () => {
    await request(makeApp(instructor)).get(`/api/courses/${courseId.toHexString()}/questions?state=approved`);

    const [, filters] = jest.mocked(browseBank).mock.calls[0];
    expect(filters).toEqual({ state: 'approved' });
  });

  it('parses and passes the loId filter to browseBank as an ObjectId', async () => {
    const loId = new ObjectId();
    await request(makeApp(instructor)).get(
      `/api/courses/${courseId.toHexString()}/questions?loId=${loId.toHexString()}`,
    );

    const [, filters] = jest.mocked(browseBank).mock.calls[0];
    expect(filters.loId).toBeInstanceOf(ObjectId);
    expect((filters.loId as ObjectId).equals(loId)).toBe(true);
  });

  it('parses and passes the themeId filter to browseBank as an ObjectId', async () => {
    const themeId = new ObjectId();
    await request(makeApp(instructor)).get(
      `/api/courses/${courseId.toHexString()}/questions?themeId=${themeId.toHexString()}`,
    );

    const [, filters] = jest.mocked(browseBank).mock.calls[0];
    expect(filters.themeId).toBeInstanceOf(ObjectId);
    expect((filters.themeId as ObjectId).equals(themeId)).toBe(true);
  });

  it('parses and passes the type filter to browseBank', async () => {
    await request(makeApp(instructor)).get(`/api/courses/${courseId.toHexString()}/questions?type=true-false`);

    const [, filters] = jest.mocked(browseBank).mock.calls[0];
    expect(filters).toEqual({ type: 'true-false' });
  });

  it('parses and passes the difficulty filter to browseBank', async () => {
    await request(makeApp(instructor)).get(`/api/courses/${courseId.toHexString()}/questions?difficulty=hard`);

    const [, filters] = jest.mocked(browseBank).mock.calls[0];
    expect(filters).toEqual({ difficulty: 'hard' });
  });

  it('parses and passes the label filter to browseBank', async () => {
    await request(makeApp(instructor)).get(
      `/api/courses/${courseId.toHexString()}/questions?label=student-flagged`,
    );

    const [, filters] = jest.mocked(browseBank).mock.calls[0];
    expect(filters).toEqual({ label: 'student-flagged' });
  });

  it('400s an invalid state value without calling browseBank', async () => {
    const res = await request(makeApp(instructor)).get(
      `/api/courses/${courseId.toHexString()}/questions?state=bogus`,
    );

    expect(res.status).toBe(400);
    expect(browseBank).not.toHaveBeenCalled();
  });

  it('400s a malformed loId without calling browseBank', async () => {
    const res = await request(makeApp(instructor)).get(
      `/api/courses/${courseId.toHexString()}/questions?loId=not-an-object-id`,
    );

    expect(res.status).toBe(400);
    expect(browseBank).not.toHaveBeenCalled();
  });

  // Finding 4: includeArchived is not part of the HTTP contract — a request
  // sending it must still 200 (unknown query keys are stripped by zod, not
  // rejected) and must NOT reach browseBank as a filter.
  it('strips an includeArchived query param rather than passing it through', async () => {
    const res = await request(makeApp(instructor)).get(
      `/api/courses/${courseId.toHexString()}/questions?includeArchived=true`,
    );

    expect(res.status).toBe(200);
    const [, filters] = jest.mocked(browseBank).mock.calls[0];
    expect(filters).not.toHaveProperty('includeArchived');
  });

  it('omits agentDecision and internalNotes from the browse response — toBankItem\'s explicit field pick', async () => {
    const current = { _id: new ObjectId(), version: 1, stem: 'x' };
    jest.mocked(browseBank).mockResolvedValue({
      total: 1,
      questions: [
        {
          _id: questionId,
          courseId,
          currentVersionId: current._id,
          currentVersion: 1,
          state: 'draft',
          loIds: [],
          themeIds: [],
          labels: [],
          internalNotes: [{ puid: 'PUID-INSTR-0001', text: 'teaching-team-only note', at: new Date() }],
          agentDecision: { decision: 'pass', reasoning: 'looks fine', roleAssessment: 'ok' },
          createdAt: new Date(),
          updatedAt: new Date(),
          current,
        },
      ],
    } as never);

    const res = await request(makeApp(instructor)).get(`/api/courses/${courseId.toHexString()}/questions`);

    expect(res.status).toBe(200);
    expect(res.body.questions[0].agentDecision).toBeUndefined();
    expect(res.body.questions[0].internalNotes).toBeUndefined();
  });
});

describe('GET /api/courses/:courseId/review-queue (IN-Q02)', () => {
  it('403s a non-instructor', async () => {
    const res = await request(makeApp(student)).get(`/api/courses/${courseId.toHexString()}/review-queue`);
    expect(res.status).toBe(403);
    expect(reviewQueue).not.toHaveBeenCalled();
  });
});

describe('single-question routes authenticate before the stash DB lookup', () => {
  it('401s a signed-out GET /questions/:questionId without calling getQuestionCourseId', async () => {
    const res = await request(makeApp(undefined)).get(`/api/questions/${questionId.toHexString()}`);
    expect(res.status).toBe(401);
    expect(getQuestionCourseId).not.toHaveBeenCalled();
  });

  it('404s when the question does not exist', async () => {
    jest.mocked(getQuestionCourseId).mockResolvedValue(null);

    const res = await request(makeApp(instructor)).get(`/api/questions/${questionId.toHexString()}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('question-not-found');
  });

  it('403s a non-instructor of the question\'s course', async () => {
    jest.mocked(getQuestionCourseId).mockResolvedValue(otherCourseId);

    const res = await request(makeApp(instructor)).get(`/api/questions/${questionId.toHexString()}`);

    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/questions/:questionId (IN-Q03)', () => {
  beforeEach(() => {
    jest.mocked(getQuestionCourseId).mockResolvedValue(courseId);
  });

  it('validates options element shape via zod (missing explanation) without calling the service', async () => {
    const res = await request(makeApp(instructor))
      .patch(`/api/questions/${questionId.toHexString()}`)
      .send({ options: [{ key: 'A', text: 'Option A', role: 'correct' }] });

    expect(res.status).toBe(400);
    expect(editQuestion).not.toHaveBeenCalled();
  });

  it('rejects an invalid option role via zod without calling the service', async () => {
    const res = await request(makeApp(instructor))
      .patch(`/api/questions/${questionId.toHexString()}`)
      .send({ options: [mcqOption({ role: 'not-a-real-role' })] });

    expect(res.status).toBe(400);
    expect(editQuestion).not.toHaveBeenCalled();
  });

  it('does NOT enforce option count in zod — a 3-option MCQ patch reaches the service', async () => {
    jest.mocked(editQuestion).mockRejectedValue(new Error('invalid-options:expected-4-options'));

    const res = await request(makeApp(instructor))
      .patch(`/api/questions/${questionId.toHexString()}`)
      .send({ options: [mcqOption({ key: 'A' }), mcqOption({ key: 'B', role: 'clearly-wrong' })] });

    expect(editQuestion).toHaveBeenCalled();
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid-options:expected-4-options');
  });

  it('200s a valid patch and returns the service result', async () => {
    const version = { _id: new ObjectId(), version: 2, stem: 'Updated' };
    jest.mocked(editQuestion).mockResolvedValue(version as never);

    const res = await request(makeApp(instructor))
      .patch(`/api/questions/${questionId.toHexString()}`)
      .send({ stem: 'Updated' });

    expect(res.status).toBe(200);
    expect(res.body.stem).toBe('Updated');
  });
});

describe('POST /api/questions/:questionId/transition (IN-Q04/Q07)', () => {
  beforeEach(() => {
    jest.mocked(getQuestionCourseId).mockResolvedValue(courseId);
  });

  it('409s with the service\'s invalid-transition message', async () => {
    jest.mocked(transitionQuestion).mockRejectedValue(new Error('invalid-transition:draft->approved'));

    const res = await request(makeApp(instructor))
      .post(`/api/questions/${questionId.toHexString()}/transition`)
      .send({ to: 'approved' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('invalid-transition:draft->approved');
  });

  it('409s when another reviewer already changed the expected state', async () => {
    jest.mocked(transitionQuestion).mockRejectedValue(new Error('question-conflict'));

    const res = await request(makeApp(instructor))
      .post(`/api/questions/${questionId.toHexString()}/transition`)
      .send({ to: 'approved' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('question-conflict');
  });

  it('200s a valid transition', async () => {
    jest.mocked(transitionQuestion).mockResolvedValue({
      _id: questionId,
      courseId,
      state: 'approved',
    } as never);

    const res = await request(makeApp(instructor))
      .post(`/api/questions/${questionId.toHexString()}/transition`)
      .send({ to: 'approved' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(questionId.toHexString());
    expect(res.body.state).toBe('approved');
  });
});

describe('POST /api/questions/bulk-transition (privilege-escalation guard, Saurav decision)', () => {
  it('401s a signed-out caller without calling getDistinctQuestionCourseIds', async () => {
    const res = await request(makeApp(undefined))
      .post('/api/questions/bulk-transition')
      .send({ questionIds: [questionId.toHexString()], to: 'approved' });

    expect(res.status).toBe(401);
    expect(getDistinctQuestionCourseIds).not.toHaveBeenCalled();
  });

  it('403s (not 400) when the ids span more than one course', async () => {
    jest.mocked(getDistinctQuestionCourseIds).mockResolvedValue([courseId, otherCourseId]);

    const res = await request(makeApp(instructor))
      .post('/api/questions/bulk-transition')
      .send({ questionIds: [questionId.toHexString(), new ObjectId().toHexString()], to: 'approved' });

    expect(res.status).toBe(403);
    expect(bulkTransition).not.toHaveBeenCalled();
  });

  it('403s when none of the ids resolve to a course', async () => {
    jest.mocked(getDistinctQuestionCourseIds).mockResolvedValue([]);

    const res = await request(makeApp(instructor))
      .post('/api/questions/bulk-transition')
      .send({ questionIds: [questionId.toHexString()], to: 'approved' });

    expect(res.status).toBe(403);
  });

  // Pins the indistinguishable-403 ruling (stashCourseIdFromBulk's doc
  // comment): the span-check 403 and ensureCourseInstructor()'s ordinary
  // guard 403 must be byte-identical, so a caller can't tell "ids span
  // courses" apart from "no access to the resolved course" by response body.
  // Compares the two actual bodies to each other (not to a hardcoded
  // literal) so this still catches a regression if NO_COURSE_ACCESS_BODY's
  // wording changes on one call site but not the other.
  it('returns the same status and body for the span-check 403 as for the ordinary instructor guard 403', async () => {
    // Span-check 403: the ids resolve to more than one course.
    jest.mocked(getDistinctQuestionCourseIds).mockResolvedValue([courseId, otherCourseId]);
    const spanRes = await request(makeApp(instructor))
      .post('/api/questions/bulk-transition')
      .send({ questionIds: [questionId.toHexString(), new ObjectId().toHexString()], to: 'approved' });

    // Guard 403: the ids resolve to a single course the instructor has no
    // role in — reaches ensureCourseInstructor() normally via stashCourseIdFromBulk.
    jest.mocked(getDistinctQuestionCourseIds).mockResolvedValue([otherCourseId]);
    const guardRes = await request(makeApp(instructor))
      .post('/api/questions/bulk-transition')
      .send({ questionIds: [questionId.toHexString()], to: 'approved' });

    expect(spanRes.status).toBe(403);
    expect(guardRes.status).toBe(403);
    expect(spanRes.status).toBe(guardRes.status);
    expect(spanRes.body).toEqual(guardRes.body);
  });

  it('stashes the single resolved courseId and lets ensureCourseInstructor guard normally', async () => {
    jest.mocked(getDistinctQuestionCourseIds).mockResolvedValue([courseId]);
    jest.mocked(bulkTransition).mockResolvedValue(2);

    const res = await request(makeApp(instructor))
      .post('/api/questions/bulk-transition')
      .send({ questionIds: [questionId.toHexString(), new ObjectId().toHexString()], to: 'approved' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 2 });
  });

  it('403s an instructor of a different course than the one the ids resolve to', async () => {
    jest.mocked(getDistinctQuestionCourseIds).mockResolvedValue([otherCourseId]);

    const res = await request(makeApp(instructor))
      .post('/api/questions/bulk-transition')
      .send({ questionIds: [questionId.toHexString()], to: 'approved' });

    expect(res.status).toBe(403);
    expect(bulkTransition).not.toHaveBeenCalled();
  });

  it('propagates a bulkTransition infrastructure error to the central error handler (500), not a swallowed success', async () => {
    jest.mocked(getDistinctQuestionCourseIds).mockResolvedValue([courseId]);
    jest.mocked(bulkTransition).mockRejectedValue(new Error('connection timed out'));

    const res = await request(makeApp(instructor))
      .post('/api/questions/bulk-transition')
      .send({ questionIds: [questionId.toHexString()], to: 'approved' });

    // questionsRouter's normalizer doesn't recognize this message, so it
    // falls through (via next(err)) to the real errorHandler mounted in
    // makeApp — proving the error isn't swallowed as a false success, and
    // that the response matches the contract's error format.
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'connection timed out' });
  });
});
