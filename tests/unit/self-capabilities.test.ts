import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import type { User } from '../../server/src/types/domain';

jest.mock('../../server/src/components/mongodb/collections', () => ({ capabilitySettingsCol: jest.fn() }));
import { capabilitySettingsCol } from '../../server/src/components/mongodb/collections';
import { selfCapabilitiesRouter } from '../../server/src/routes/capabilities.routes';

const courseId = new ObjectId();
const user = (role: 'student' | 'ta' | 'instructor' = 'ta'): User => ({
  puid: 'SELF', uid: 'self', displayName: 'Self', email: 'self@ubc.ca', affiliations: [],
  isAdmin: false, courseRoles: [{ courseId, role }], createdAt: new Date(), lastLoginAt: new Date(),
});
function app(account?: User) {
  const instance = express();
  instance.use((req, _res, next) => { req.user = account; req.isAuthenticated = (() => Boolean(account)) as typeof req.isAuthenticated; next(); });
  instance.use('/api', selfCapabilitiesRouter);
  return instance;
}
beforeEach(() => { jest.mocked(capabilitySettingsCol).mockReturnValue({ findOne: jest.fn(async ({ scope }) => scope === 'course' ? { assignments: { 'question.suggest-edit': { ta: false }, 'question.mark-reviewed': { ta: false }, 'question.approve': { ta: true }, 'flag.resolve': { ta: true } } } : null) } as never); });
test('signed-out and foreign-course reads are denied', async () => {
  expect((await request(app()).get(`/api/courses/${courseId}/capabilities/me`)).status).toBe(401);
  expect((await request(app(user())).get(`/api/courses/${new ObjectId()}/capabilities/me`)).status).toBe(403);
});
test('restricted TA sees only its own booleans with hard denies intact', async () => {
  const response = await request(app(user())).get(`/api/courses/${courseId}/capabilities/me?puid=OTHER&role=admin`);
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ 'question.review': true, 'question.suggest-edit': false, 'question.mark-reviewed': false, 'question.approve': false, 'flag.resolve': false });
  expect(Object.values(response.body).every((value) => typeof value === 'boolean')).toBe(true);
  expect(response.body).not.toHaveProperty('assignments');
});
test('Instructor TA View keeps the real Instructor permission projection', async () => {
  const response = await request(app(user('instructor'))).get(`/api/courses/${courseId}/capabilities/me`);
  expect(response.status).toBe(200);
  expect(response.body['question.suggest-edit']).toBe(true);
  expect(response.body['question.approve']).toBe(true);
});
