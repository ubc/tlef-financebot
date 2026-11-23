jest.mock('../../server/src/services/admin.service', () => ({ getInstructorCourseModels: jest.fn(), saveInstructorCourseModels: jest.fn() }));
import express, { type Express } from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import type { User } from '../../server/src/types/domain';
import { courseModelsRouter } from '../../server/src/routes/course-models.routes';
import { errorHandler } from '../../server/src/middleware/error-handler';
import { getInstructorCourseModels, saveInstructorCourseModels } from '../../server/src/services/admin.service';

const courseId = new ObjectId();
const user = (role: 'instructor' | 'ta' | 'student'): User => ({ puid: `PUID-${role}`, uid: role, displayName: role, email: `${role}@example.com`,
  affiliations: [role === 'student' ? 'student' : 'faculty'], isAdmin: false, courseRoles: [{ courseId, role }], createdAt: new Date(), lastLoginAt: new Date() } as User);
function app(who?: User): Express {
  const server = express(); server.use(express.json());
  server.use((req, _res, next) => { (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated = () => Boolean(who); (req as { user?: unknown }).user = who; next(); });
  server.use('/api', courseModelsRouter); server.use(errorHandler); return server;
}
const path = `/api/courses/${courseId.toHexString()}/models`;

beforeEach(() => { jest.mocked(getInstructorCourseModels).mockReset(); jest.mocked(saveInstructorCourseModels).mockReset(); });

describe('course model routes', () => {
  it('lets a course instructor read and save', async () => {
    jest.mocked(getInstructorCourseModels).mockResolvedValue({ revision: 0 } as never);
    jest.mocked(saveInstructorCourseModels).mockResolvedValue({ revision: 1 } as never);
    await request(app(user('instructor'))).get(path).expect(200, { revision: 0 });
    await request(app(user('instructor'))).put(path).send({ revision: 0, overrides: { outlineOrganizer: 'gpt-6.1-sol' } }).expect(200, { revision: 1 });
    expect(saveInstructorCourseModels).toHaveBeenCalledWith(courseId, 0, { outlineOrganizer: 'gpt-6.1-sol' }, 'PUID-instructor');
  });
  it.each(['ta', 'student'] as const)('refuses a %s', async role => {
    const response = await request(app(user(role))).put(path).send({ revision: 0, overrides: {} });
    expect([401, 403]).toContain(response.status);
    expect(saveInstructorCourseModels).not.toHaveBeenCalled();
  });
  it('rejects unknown steps and maps service errors', async () => {
    await request(app(user('instructor'))).put(path).send({ revision: 0, overrides: { validator: 'gpt-6-luna' } }).expect(400);
    jest.mocked(saveInstructorCourseModels).mockRejectedValueOnce(new Error('invalid-model-selector'));
    await request(app(user('instructor'))).put(path).send({ revision: 0, overrides: { generator: 'mine' } }).expect(400, { error: 'invalid-model-selector' });
    jest.mocked(saveInstructorCourseModels).mockRejectedValueOnce(new Error('course-models-conflict'));
    await request(app(user('instructor'))).put(path).send({ revision: 0, overrides: {} }).expect(409);
  });
});
