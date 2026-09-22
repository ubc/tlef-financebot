import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { ensureApiAuthenticated } from '../components/auth/guards';
import { validate } from '../middleware/validate';
import { inviteCourseInstructor, listCourseInstructors, removeCourseInstructor, revokeCourseInstructorInvitation } from '../services/course-sharing.service';

export const courseSharingRouter = Router();
const objectId = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id.');
const courseParams = z.object({ courseId: objectId });
const invitationParams = courseParams.extend({ invitationId: objectId });
const memberParams = courseParams.extend({ puid: z.string().trim().min(1).max(200) });
const invitationBody = z.object({
  identifier: z.string().trim().min(2).max(254).optional(),
  // Retain the original request shape for existing clients while they migrate.
  email: z.string().trim().email().max(254).optional(),
}).refine(body => Boolean(body.identifier || body.email), { message: 'Enter a UBC email or CWL login name.' });

courseSharingRouter.get('/courses/:courseId/instructors', ensureApiAuthenticated(), validate({ params: courseParams }), async (req, res) => {
  res.json(await listCourseInstructors(new ObjectId(String(req.params.courseId)), req.user!));
});
courseSharingRouter.post('/courses/:courseId/instructor-invitations', ensureApiAuthenticated(), validate({ params: courseParams, body: invitationBody }), async (req, res) => {
  res.json(await inviteCourseInstructor(new ObjectId(String(req.params.courseId)), req.user!, String(req.body.identifier ?? req.body.email)));
});
courseSharingRouter.delete('/courses/:courseId/instructor-invitations/:invitationId', ensureApiAuthenticated(), validate({ params: invitationParams }), async (req, res) => {
  res.json(await revokeCourseInstructorInvitation(new ObjectId(String(req.params.courseId)), req.user!, new ObjectId(String(req.params.invitationId))));
});
courseSharingRouter.delete('/courses/:courseId/instructors/:puid', ensureApiAuthenticated(), validate({ params: memberParams }), async (req, res) => {
  res.json(await removeCourseInstructor(new ObjectId(String(req.params.courseId)), req.user!, String(req.params.puid)));
});
