import express, { type Express } from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import type { Capability, User } from '../../server/src/types/domain';

jest.mock('../../server/src/services/capabilities.service', () => {
  const actual = jest.requireActual('../../server/src/services/capabilities.service') as object;
  return {
    ...actual,
    hasCapability: jest.fn(async (user: User, courseId: ObjectId, capability: Capability) => {
      const role = user.courseRoles.find((entry) => entry.courseId.equals(courseId))?.role;
      if (user.isAdmin || role === 'instructor') return true;
      if (role !== 'ta') return false;
      return capability !== 'question.approve' && capability !== 'flag.resolve';
    }),
  };
});
jest.mock('../../server/src/services/bank.service', () => ({
  browseBank: jest.fn(),
  reviewQueue: jest.fn(),
  getQuestionCourseId: jest.fn(),
  getDistinctQuestionCourseIds: jest.fn(),
  getQuestionDetail: jest.fn(),
}));
jest.mock('../../server/src/services/questions.service', () => ({
  addQuestionInternalNote: jest.fn(),
  editQuestion: jest.fn(),
  transitionQuestion: jest.fn(),
  bulkTransition: jest.fn(),
}));
jest.mock('../../server/src/services/tas.service', () => ({
  addTa: jest.fn(),
  escalateFlag: jest.fn(),
  listTas: jest.fn(),
  proactivelyEscalateQuestion: jest.fn(),
  reinviteTa: jest.fn(),
  resolveQuestionSuggestion: jest.fn(),
  setTaPermissions: jest.fn(),
  suggestQuestionEdit: jest.fn(),
}));
jest.mock('../../server/src/services/flags.service', () => ({
  listFlags: jest.fn(),
}));
jest.mock('../../server/src/components/mongodb/collections', () => ({
  flagsCol: jest.fn(),
}));

import { tasRouter } from '../../server/src/routes/tas.routes';
import { questionsRouter } from '../../server/src/routes/questions.routes';
import { getQuestionCourseId, reviewQueue } from '../../server/src/services/bank.service';
import { transitionQuestion } from '../../server/src/services/questions.service';

const courseId = new ObjectId();
const questionId = new ObjectId();

function ta(): User {
  return {
    puid: 'PUID-TA', uid: 'ta', displayName: 'TA', email: 'ta@ubc.ca',
    affiliations: ['staff'], isAdmin: false, courseRoles: [{ courseId, role: 'ta' }],
    createdAt: new Date(), lastLoginAt: new Date(),
  };
}

function makeApp(user?: User): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated = () => Boolean(user);
    (req as { user?: unknown }).user = user;
    next();
  });
  app.use('/api', tasRouter);
  app.use('/api', questionsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getQuestionCourseId).mockResolvedValue(courseId);
  jest.mocked(reviewQueue).mockResolvedValue([]);
  jest.mocked(transitionQuestion).mockResolvedValue({
    _id: questionId,
    courseId,
    currentVersionId: new ObjectId(),
    currentVersion: 1,
    state: 'reviewed',
    loIds: [], themeIds: [], labels: [], internalNotes: [],
    createdAt: new Date(), updatedAt: new Date(),
  });
});

describe('TA structural authorization and safe review payloads', () => {
  it('lets a TA read/mark reviewed but returns no approve/reject affordance', async () => {
    const queue = await request(makeApp(ta())).get(
      `/api/courses/${courseId.toHexString()}/ta/review-queue`,
    );
    const marked = await request(makeApp(ta())).post(
      `/api/questions/${questionId.toHexString()}/mark-reviewed`,
    );

    expect(queue.status).toBe(200);
    expect(JSON.stringify(queue.body)).not.toMatch(/approve|reject/i);
    expect(marked.status).toBe(200);
    expect(transitionQuestion).toHaveBeenCalledWith(questionId, 'reviewed', 'PUID-TA');
  });

  it('still 403s approved transition when a TA is treated as having every configurable toggle', async () => {
    const response = await request(makeApp(ta()))
      .post(`/api/questions/${questionId.toHexString()}/transition`)
      .send({ to: 'approved' });

    expect(response.status).toBe(403);
    expect(transitionQuestion).not.toHaveBeenCalled();
  });

  it('authenticates before child lookups', async () => {
    const response = await request(makeApp()).post(
      `/api/questions/${questionId.toHexString()}/mark-reviewed`,
    );

    expect(response.status).toBe(401);
    expect(getQuestionCourseId).not.toHaveBeenCalled();
  });
});
