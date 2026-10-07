import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
jest.mock('../../server/src/services/course-people.service', () => ({ listCoursePeople: jest.fn(async () => ({ people: [], total: 0 })), inviteCoursePerson: jest.fn(async () => ({ id: 'PERSON', status: 'active' })), changeCoursePerson: jest.fn(async () => ({ revision: 2 })), removeCoursePeople: jest.fn(async () => ({ removed: ['puid:PERSON'], failed: [] })) }));
import { coursePeopleRouter } from '../../server/src/routes/course-people.routes';
import { inviteCoursePerson, listCoursePeople, changeCoursePerson, removeCoursePeople } from '../../server/src/services/course-people.service';

const id = new ObjectId();
const base = `/api/courses/${id}/people`;
function app(role?: string, target = id) {
  const app = express(); app.use(express.json()); app.use((req, _res, next) => {
    req.isAuthenticated = (() => Boolean(role)) as typeof req.isAuthenticated;
    if (role) req.user = { puid: 'ACTOR', isAdmin: role === 'admin', courseRoles: [{ courseId: target, role }] } as never;
    next();
  }); app.use('/api', coursePeopleRouter); return app;
}
test.each([undefined, 'student', 'ta'])('directory identities and mutations are denied to %s', async role => {
  for (const r of [request(app(role)).get(base), request(app(role)).post(base).send({ identifier: 'person@ubc.ca', role: 'student' }), request(app(role)).patch(`${base}/puid:PERSON`).send({ action: 'ban', expectedRevision: 0 }), request(app(role)).post(`${base}/remove`).send({ people: [{ id: 'puid:PERSON', expectedRevision: 0 }] })]) await r.expect(role ? 403 : 401);
});
test('single and bulk removal require revisions and reject unbounded or forged payloads', async () => {
  await request(app('instructor')).patch(`${base}/puid:PERSON`).send({ action: 'remove', expectedRevision: 3 }).expect(200);
  expect(changeCoursePerson).toHaveBeenLastCalledWith(id, expect.anything(), 'puid:PERSON', 3, { action: 'remove', expectedRevision: 3 });
  const people = [{ id: 'puid:PERSON', expectedRevision: 3 }];
  await request(app('admin')).post(`${base}/remove`).send({ people }).expect(200, { removed: ['puid:PERSON'], failed: [] });
  expect(removeCoursePeople).toHaveBeenLastCalledWith(id, expect.objectContaining({ isAdmin: true }), people);
  for (const body of [{ people: [] }, { people: [...people, ...people] }, { people: [{ id: 'puid:PERSON' }] },
    { people, actorPuid: 'OWNER' }, { people: Array.from({ length: 101 }, (_, n) => ({ id: `puid:${n}`, expectedRevision: 0 })) }]) {
    await request(app('instructor')).post(`${base}/remove`).send(body).expect(400);
  }
  await request(app('instructor', new ObjectId())).post(`${base}/remove`).send({ people }).expect(403);
});
test('another course cannot inspect this directory', async () => { await request(app('instructor', new ObjectId())).get(base).expect(403); });
test('page, search, role and status are bounded and forwarded', async () => {
  await request(app('instructor')).get(`${base}?page=2&pageSize=25&search=alex&role=ta&status=banned`).expect(200);
  expect(listCoursePeople).toHaveBeenLastCalledWith(id, expect.objectContaining({ puid: 'ACTOR' }), { page: 2, pageSize: 25, search: 'alex', role: 'ta', status: 'banned' });
  await request(app('instructor')).get(`${base}?pageSize=1000`).expect(400);
  await request(app('instructor')).get(`${base}?page=-1`).expect(400);
});
test('role choice and identity come only from validated body and session', async () => {
  await request(app('instructor')).post(base).send({ identifier: 'person@ubc.ca', role: 'ta', permissions: { 'question.suggest-edit': false } }).expect(201);
  expect(inviteCoursePerson).toHaveBeenLastCalledWith(id, expect.objectContaining({ puid: 'ACTOR' }), 'person@ubc.ca', 'ta', { 'question.suggest-edit': false });
  await request(app('instructor')).post(base).send({ identifier: 'person@ubc.ca', role: 'admin' }).expect(400);
  await request(app('instructor')).post(base).send({ identifier: 'person@ubc.ca', role: 'ta', permissions: { 'question.approve': true } }).expect(400);
  await request(app('instructor')).post(base).send({ identifier: 'person@ubc.ca', role: 'student', puid: 'OTHER' }).expect(400);
});
test('revision is mandatory; role changes cannot request owner/Admin roles', async () => {
  await request(app('instructor')).patch(`${base}/puid:PERSON`).send({ action: 'role', role: 'instructor', expectedRevision: 3 }).expect(200);
  expect(changeCoursePerson).toHaveBeenLastCalledWith(id, expect.objectContaining({ puid: 'ACTOR' }), 'puid:PERSON', 3, { action: 'role', role: 'instructor', expectedRevision: 3 });
  await request(app('instructor')).patch(`${base}/puid:PERSON`).send({ action: 'ban' }).expect(400);
  await request(app('instructor')).patch(`${base}/puid:PERSON`).send({ action: 'role', role: 'owner', expectedRevision: 0 }).expect(400);
});
