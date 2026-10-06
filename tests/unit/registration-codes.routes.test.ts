jest.mock('../../server/src/services/course-people.service', () => ({ peopleCourse: jest.fn(async () => ({ canManage: true })) }));
import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
jest.mock('../../server/src/services/registration-codes.service', () => ({
  listRegistrationCodes: jest.fn(async () => ({ codes: [], truncated: false })),
  createRegistrationCodes: jest.fn(async () => ({ ids: ['issued'] })),
  revokeRegistrationCode: jest.fn(),
  deleteRegistrationCode: jest.fn(),
}));
import { registrationCodesRouter } from '../../server/src/routes/registration-codes.routes';
import { createRegistrationCodes, deleteRegistrationCode, listRegistrationCodes } from '../../server/src/services/registration-codes.service';

const courseId = new ObjectId();
const base = `/api/courses/${courseId}/registration-codes`;
function app(role?: string, target = courseId) {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => Boolean(role)) as typeof req.isAuthenticated;
    if (role) req.user = { puid: 'TEACHER', isAdmin: role === 'admin', courseRoles: [{ courseId: target, role }] } as never;
    next();
  });
  app.use('/api', registrationCodesRouter);
  return app;
}
test.each([undefined, 'student', 'ta'])('code receipts and creation are denied to %s', async role => {
  const status = role ? 403 : 401;
  await request(app(role)).get(base).expect(status);
  await request(app(role)).post(base).send({ count: 1, requestId: 'e4f2f037-8512-460a-b1d4-3481c9f366b0' }).expect(status);
});
test('instructors cannot inspect another course codes', async () => {
  await request(app('instructor', new ObjectId())).get(base).expect(403);
});
test('instructor batch validation bounds writes and uses the session identity', async () => {
  await request(app('instructor')).post(base).send({ count: 51, requestId: 'e4f2f037-8512-460a-b1d4-3481c9f366b0' }).expect(400);
  await request(app('instructor')).post(base).send({ count: 2, requestId: 'e4f2f037-8512-460a-b1d4-3481c9f366b0' }).expect(201);
  expect(createRegistrationCodes).toHaveBeenLastCalledWith(courseId, 'TEACHER', 2, 'e4f2f037-8512-460a-b1d4-3481c9f366b0');
});
test('page/status query is bounded and forwarded to the service', async () => {
  await request(app('instructor')).get(`${base}?page=2&pageSize=10&status=used`).expect(200);
  expect(listRegistrationCodes).toHaveBeenLastCalledWith(courseId, { page: 2, pageSize: 10, status: 'used' });
  await request(app('instructor')).get(`${base}?page=0`).expect(400);
  await request(app('instructor')).get(`${base}?pageSize=10000`).expect(400);
  await request(app('instructor')).get(`${base}?status=bad`).expect(400);
});
test('record deletion is Instructor-only, course-scoped and does not accept malformed IDs', async () => {
  const codeId = 'e4f2f037-8512-460a-b1d4-3481c9f366b0';
  await request(app('ta')).delete(`${base}/${codeId}/record`).expect(403);
  await request(app('instructor')).delete(`${base}/bad/record`).expect(400);
  await request(app('instructor')).delete(`${base}/${codeId}/record`).expect(204);
  expect(deleteRegistrationCode).toHaveBeenLastCalledWith(courseId, codeId, 'TEACHER');
});
