import { ObjectId } from 'mongodb';
import type { Flag, Question, TaInvite, User } from '../../server/src/types/domain';

jest.mock('../../server/src/components/mongodb/collections', () => ({
  flagsCol: jest.fn(),
  questionsCol: jest.fn(),
  taInvitesCol: jest.fn(),
  usersCol: jest.fn(),
}));
jest.mock('../../server/src/services/capabilities.service', () => ({
  setCourseUserCapabilities: jest.fn(),
}));
jest.mock('../../server/src/services/questions.service', () => ({
  editQuestion: jest.fn(),
}));

import {
  flagsCol,
  questionsCol,
  taInvitesCol,
  usersCol,
} from '../../server/src/components/mongodb/collections';
import { setCourseUserCapabilities } from '../../server/src/services/capabilities.service';
import { editQuestion } from '../../server/src/services/questions.service';
import {
  activatePendingTaInvites,
  addTa,
  escalateFlag,
  resolveQuestionSuggestion,
} from '../../server/src/services/tas.service';

const courseId = new ObjectId();
const questionId = new ObjectId();
const versionId = new ObjectId();
const suggestionId = new ObjectId();
const flagId = new ObjectId();

function taUser(): User {
  return {
    puid: 'PUID-TA', uid: 'ta', displayName: 'Teaching Assistant',
    email: 'ta.person@ubc.ca', affiliations: ['staff'], isAdmin: false,
    courseRoles: [], createdAt: new Date(), lastLoginAt: new Date(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('TA invitation activation (IN-T01/02)', () => {
  it('validates UBC email and catches an active duplicate inline', async () => {
    jest.mocked(taInvitesCol).mockReturnValue({
      findOne: jest.fn(async () => ({
        _id: new ObjectId(), courseId, email: 'ta@ubc.ca', status: 'active',
        invitedAt: new Date(), updatedAt: new Date(),
      } as TaInvite & { _id: ObjectId })),
    } as never);

    await expect(addTa(courseId, 'not-ubc@example.com')).rejects.toThrow('ta-invalid-ubc-email');
    await expect(addTa(courseId, 'TA@UBC.CA')).rejects.toThrow('ta-invite-duplicate');
  });

  it('activates every matching pending invite on login and applies saved permissions', async () => {
    const user = taUser();
    const invite: TaInvite & { _id: ObjectId } = {
      _id: new ObjectId(), courseId, email: user.email, status: 'pending',
      permissions: { 'question.review': true, 'analytics.view': true },
      invitedAt: new Date(), updatedAt: new Date(),
    };
    const activeUser = { ...user, courseRoles: [{ courseId, role: 'ta' as const }] };
    const userUpdate = jest.fn();
    jest.mocked(taInvitesCol).mockReturnValue({
      find: jest.fn(() => ({ toArray: async () => [invite] })),
      updateOne: jest.fn(async () => ({ matchedCount: 1 })),
    } as never);
    jest.mocked(usersCol).mockReturnValue({
      updateOne: userUpdate,
      findOne: jest.fn(async () => activeUser),
    } as never);

    const result = await activatePendingTaInvites(user);

    expect(result.courseRoles).toEqual([{ courseId, role: 'ta' }]);
    expect(userUpdate).toHaveBeenCalledWith(
      { puid: user.puid },
      { $addToSet: { courseRoles: { courseId, role: 'ta' } } },
    );
    expect(setCourseUserCapabilities).toHaveBeenCalledWith(
      courseId, user.puid, invite.permissions, user.puid,
    );
  });
});

describe('TA suggestions and triage', () => {
  it('accepting a suggestion applies exactly its stored patch before resolving it', async () => {
    const patch = { stem: 'Suggested stem', difficulty: 'hard' };
    const question = {
      _id: questionId,
      courseId,
      currentVersionId: versionId,
      currentVersion: 1,
      state: 'pending-review',
      loIds: [],
      themeIds: [],
      labels: [],
      internalNotes: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      suggestions: [{ id: suggestionId, puid: 'PUID-TA', patch, status: 'pending', at: new Date() }],
    } as Question & { _id: ObjectId };
    const updateOne = jest.fn(async () => ({ matchedCount: 1 }));
    jest.mocked(questionsCol).mockReturnValue({
      findOne: jest.fn(async () => question),
      updateOne,
    } as never);

    await resolveQuestionSuggestion(questionId, suggestionId, 'accept', 'PUID-INSTRUCTOR');

    expect(editQuestion).toHaveBeenCalledWith(questionId, patch, 'PUID-INSTRUCTOR');
    expect(updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: questionId, 'suggestions.id': suggestionId }),
      expect.objectContaining({ $set: expect.objectContaining({
        'suggestions.$.status': 'accepted',
        'suggestions.$.resolvedBy': 'PUID-INSTRUCTOR',
      }) }),
    );
  });

  it('escalates an open flag and preserves recommendation, note, and TA identity', async () => {
    const base: Flag & { _id: ObjectId } = {
      _id: flagId, courseId, questionId, questionVersionId: versionId,
      puid: 'PUID-STUDENT', state: 'open', createdAt: new Date(),
    };
    const findOneAndUpdate = jest.fn(async (_filter, update: { $set: Partial<Flag> }) => ({
      ...base, ...update.$set,
    }));
    jest.mocked(flagsCol).mockReturnValue({ findOneAndUpdate } as never);

    const result = await escalateFlag(flagId, 'PUID-TA', 'correct', 'Fix the answer key.');

    expect(result.state).toBe('escalated');
    expect(result.taRecommendation).toEqual(expect.objectContaining({
      recommendation: 'correct', note: 'Fix the answer key.', puid: 'PUID-TA',
    }));
  });
});
