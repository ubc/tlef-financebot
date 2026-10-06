import { peopleCourse } from '../services/course-people.service';
import { Router } from 'express';
import { z } from 'zod';
import { ensureCourseInstructor } from '../components/auth/course-guards';
import { validate } from '../middleware/validate';
import { createRegistrationCodes, deleteRegistrationCode, listRegistrationCodes, revokeRegistrationCode } from '../services/registration-codes.service';
import { ObjectId } from 'mongodb';

export const registrationCodesRouter = Router();
const courseParams = z.object({ courseId: z.string().regex(/^[0-9a-f]{24}$/) });
const createBody = z.object({ count: z.number().int().min(1).max(50), requestId: z.string().uuid() }).strict();
const listQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().refine(value => [10, 25, 50].includes(value)).default(25),
  status: z.enum(['available', 'claimed', 'used', 'revoked', 'expired']).optional(),
}).strict();

registrationCodesRouter.get('/courses/:courseId/registration-codes', validate({ params: courseParams }), ensureCourseInstructor(), validate({ query: listQuery }),
  async (req, res) => res.json(await listRegistrationCodes(new ObjectId(String(req.params.courseId)), listQuery.parse(req.query))));
registrationCodesRouter.post('/courses/:courseId/registration-codes', validate({ params: courseParams }), ensureCourseInstructor(), validate({ body: createBody }),
  async (req, res) => {
    const courseId = new ObjectId(String(req.params.courseId));
    await peopleCourse(courseId, req.user!, true);
    res.status(201).json(await createRegistrationCodes(courseId, req.user!.puid, req.body.count, req.body.requestId));
  });
registrationCodesRouter.delete('/courses/:courseId/registration-codes/:codeId',
  validate({ params: courseParams.extend({ codeId: z.string().uuid() }) }), ensureCourseInstructor(),
  async (req, res) => {
    await peopleCourse(new ObjectId(String(req.params.courseId)), req.user!, true);
    await revokeRegistrationCode(new ObjectId(String(req.params.courseId)), String(req.params.codeId), req.user!.puid);
    res.status(204).end();
  });
registrationCodesRouter.delete('/courses/:courseId/registration-codes/:codeId/record',
  validate({ params: courseParams.extend({ codeId: z.string().uuid() }) }), ensureCourseInstructor(),
  async (req, res) => {
    await peopleCourse(new ObjectId(String(req.params.courseId)), req.user!, true);
    await deleteRegistrationCode(new ObjectId(String(req.params.courseId)), String(req.params.codeId), req.user!.puid);
    res.status(204).end();
  });
