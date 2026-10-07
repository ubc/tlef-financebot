import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { ensureApiAuthenticated } from '../components/auth';
import { ensureCourseInstructor } from '../components/auth/course-guards';
import { validate } from '../middleware/validate';
import { changeCoursePerson, inviteCoursePerson, listCoursePeople, removeCoursePeople } from '../services/course-people.service';

export const coursePeopleRouter = Router();
const params = z.object({ courseId: z.string().regex(/^[0-9a-f]{24}$/) });
const role = z.enum(['student', 'ta', 'instructor']);
const permissions = z.object({ 'question.review': z.boolean().optional(), 'question.mark-reviewed': z.boolean().optional(), 'flag.triage': z.boolean().optional(),
  'question.suggest-edit': z.boolean().optional(), 'analytics.view': z.boolean().optional(), 'analytics.individual': z.boolean().optional() }).strict().optional();
coursePeopleRouter.get('/courses/:courseId/people', ensureApiAuthenticated(), validate({ params, query: z.object({
  page: z.coerce.number().int().min(1).max(1000000).optional(), pageSize: z.coerce.number().refine(n => [10, 25, 50].includes(n)).optional(),
  search: z.string().max(200).optional(), role: role.optional(), status: z.enum(['active', 'pending', 'banned', 'expired', 'deactivated']).optional(),
  tab: z.enum(['people', 'invitations']).optional(),
}) }), ensureCourseInstructor(), async (req, res) => {
  res.json(await listCoursePeople(new ObjectId(String(req.params.courseId)), req.user!, req.query as Parameters<typeof listCoursePeople>[2]));
});
coursePeopleRouter.post('/courses/:courseId/people', ensureApiAuthenticated(), validate({ params, body: z.object({ identifier: z.string().trim().min(2).max(254), role, permissions }).strict() }), ensureCourseInstructor(), async (req, res) => {
  res.status(201).json(await inviteCoursePerson(new ObjectId(String(req.params.courseId)), req.user!, req.body.identifier, req.body.role, req.body.permissions));
});
coursePeopleRouter.patch('/courses/:courseId/people/:id', ensureApiAuthenticated(), validate({ params: params.extend({ id: z.string().min(3).max(300) }), body: z.object({
  expectedRevision: z.number().int().nonnegative(), action: z.enum(['role', 'ban', 'unban', 'cancel', 'remove']), role: role.optional(), permissions, reason: z.string().max(500).optional(),
}).strict() }), ensureCourseInstructor(), async (req, res) => {
  res.json(await changeCoursePerson(new ObjectId(String(req.params.courseId)), req.user!, String(req.params.id), req.body.expectedRevision, req.body));
});
coursePeopleRouter.post('/courses/:courseId/people/remove', ensureApiAuthenticated(), validate({ params, body: z.object({
  people: z.array(z.object({ id: z.string().min(3).max(300), expectedRevision: z.number().int().nonnegative() }).strict()).min(1).max(100)
    .refine(people => new Set(people.map(person => person.id)).size === people.length, 'Duplicate people are not allowed.'),
}).strict() }), ensureCourseInstructor(), async (req, res) => {
  res.json(await removeCoursePeople(new ObjectId(String(req.params.courseId)), req.user!, req.body.people));
});
