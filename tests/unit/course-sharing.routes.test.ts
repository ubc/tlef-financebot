import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import type { User } from '../../server/src/types/domain';

jest.mock('../../server/src/services/course-sharing.service', () => ({
  listCourseInstructors: jest.fn(), inviteCourseInstructor: jest.fn(), removeCourseInstructor: jest.fn(), revokeCourseInstructorInvitation: jest.fn(),
}));
import { courseSharingRouter } from '../../server/src/routes/course-sharing.routes';
import { listCourseInstructors, inviteCourseInstructor, removeCourseInstructor, revokeCourseInstructorInvitation } from '../../server/src/services/course-sharing.service';
import { errorHandler } from '../../server/src/middleware/error-handler';

const courseId = new ObjectId();
const invitationId = new ObjectId();
const owner = { puid: 'OWNER', isAdmin: false, courseRoles: [{ courseId, role: 'instructor' }] } as User;
function app(signedIn = true) {
  const value = express();
  value.use(express.json());
  value.use((req, _res, next) => {
    req.isAuthenticated = (() => signedIn) as typeof req.isAuthenticated;
    if (signedIn) req.user = owner;
    next();
  });
  value.use('/api', courseSharingRouter);
  value.use(errorHandler);
  return value;
}
beforeEach(() => { jest.clearAllMocks(); });

it('requires authentication before listing or changing sharing', async () => {
  const client = request(app(false));
  expect((await client.get(`/api/courses/${courseId}/instructors`)).status).toBe(401);
  expect((await client.post(`/api/courses/${courseId}/instructor-invitations`).send({ email: 'person@ubc.ca' })).status).toBe(401);
  expect((await client.delete(`/api/courses/${courseId}/instructors/PERSON`)).status).toBe(401);
  expect(listCourseInstructors).not.toHaveBeenCalled();
  expect(inviteCourseInstructor).not.toHaveBeenCalled();
});

it('uses the authenticated actor and validates mutation inputs', async () => {
  const snapshot = { courseId: courseId.toHexString(), canManage: true };
  jest.mocked(listCourseInstructors).mockResolvedValue(snapshot as never);
  jest.mocked(inviteCourseInstructor).mockResolvedValue(snapshot as never);
  jest.mocked(removeCourseInstructor).mockResolvedValue(snapshot as never);
  jest.mocked(revokeCourseInstructorInvitation).mockResolvedValue(snapshot as never);
  const client = request(app());
  expect((await client.get(`/api/courses/${courseId}/instructors`)).body).toEqual(snapshot);
  expect((await client.post(`/api/courses/${courseId}/instructor-invitations`).send({ identifier: 'faculty', actorPuid: 'SPOOF' })).body).toEqual(snapshot);
  expect(inviteCourseInstructor).toHaveBeenCalledWith(courseId, owner, 'faculty');
  expect((await client.post(`/api/courses/${courseId}/instructor-invitations`).send({ email: 'person@ubc.ca' })).status).toBe(200);
  expect(inviteCourseInstructor).toHaveBeenLastCalledWith(courseId, owner, 'person@ubc.ca');
  expect((await client.delete(`/api/courses/${courseId}/instructor-invitations/${invitationId}`)).status).toBe(200);
  expect(revokeCourseInstructorInvitation).toHaveBeenCalledWith(courseId, owner, invitationId);
  expect((await client.delete(`/api/courses/${courseId}/instructors/PERSON`)).status).toBe(200);
  expect(removeCourseInstructor).toHaveBeenCalledWith(courseId, owner, 'PERSON');
  expect((await client.post(`/api/courses/${courseId}/instructor-invitations`).send({})).status).toBe(400);
});
