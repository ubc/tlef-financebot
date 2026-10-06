import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import type { User } from '../../server/src/types/domain';

jest.mock('../../server/src/services/content-map.service', () => ({
  getCourseContentMap: jest.fn(),
  getCourseKnowledgeGraph: jest.fn(),
}));

import { contentMapRouter } from '../../server/src/routes/content-map.routes';
import { getCourseContentMap, getCourseKnowledgeGraph } from '../../server/src/services/content-map.service';

const courseId = new ObjectId();

function user(role: 'ta' | 'student'): User {
  return {
    puid: role, uid: role, displayName: role, email: `${role}@ubc.ca`,
    affiliations: ['staff'], isAdmin: false, courseRoles: [{ courseId, role }],
    createdAt: new Date(), lastLoginAt: new Date(),
  };
}

function app(as?: User) {
  const server = express();
  server.use((req, _res, next) => {
    (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated = () => Boolean(as);
    (req as { user?: unknown }).user = as;
    next();
  });
  server.use('/api', contentMapRouter);
  return server;
}

describe('teaching-team coverage reads', () => {
  beforeEach(() => {
    jest.mocked(getCourseContentMap).mockReset().mockResolvedValue({ themes: [], unassignedMaterials: [] });
    jest.mocked(getCourseKnowledgeGraph).mockReset().mockResolvedValue({ nodes: [], edges: [], truncated: false });
  });

  it('allows an assigned TA to read the coverage map and graph', async () => {
    expect((await request(app(user('ta'))).get(`/api/courses/${courseId}/content-map`)).status).toBe(200);
    expect((await request(app(user('ta'))).get(`/api/courses/${courseId}/knowledge-graph`)).status).toBe(200);
  });

  it('rejects students and TAs in another course before reading data', async () => {
    expect((await request(app(user('student'))).get(`/api/courses/${courseId}/content-map`)).status).toBe(403);
    expect((await request(app(user('ta'))).get(`/api/courses/${new ObjectId()}/content-map`)).status).toBe(403);
    expect(getCourseContentMap).not.toHaveBeenCalled();
  });
});
