import express, { type Express, type RequestHandler } from 'express';
import { ObjectId } from 'mongodb';
import request from 'supertest';
import { importRouter } from '../../server/src/routes/import.routes';
import { commitImport, parseImport } from '../../server/src/services/import.service';

jest.mock('../../server/src/components/auth/course-guards', () => ({
  ensureCourseInstructor:
    (): RequestHandler =>
    (req, res, next): void => {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required.' });
        return;
      }
      next();
    },
}));

jest.mock('../../server/src/services/import.service', () => ({
  parseImport: jest.fn(),
  commitImport: jest.fn(),
}));

const mockParseImport = parseImport as jest.MockedFunction<typeof parseImport>;
const mockCommitImport = commitImport as jest.MockedFunction<typeof commitImport>;

const courseId = new ObjectId();
const candidate = {
  type: 'mcq' as const,
  stem: 'Which answer is correct?',
  options: ['A', 'B', 'C', 'D'].map((key) => ({
    key,
    text: `Option ${key}`,
    explanation: '',
  })),
  correctKey: 'A',
  difficulty: 'easy' as const,
  parameterizable: false,
};

function makeApp(authenticated = true): Express {
  const app = express();
  app.use(express.json());
  if (authenticated) {
    app.use((req, _res, next) => {
      req.user = {
        puid: 'faculty-puid',
        uid: 'faculty',
        displayName: 'Faculty',
        email: '',
        affiliations: ['faculty'],
        isAdmin: false,
        courseRoles: [{ courseId, role: 'instructor' }],
        createdAt: new Date(),
        lastLoginAt: new Date(),
      };
      next();
    });
  }
  app.use('/api', importRouter);
  app.use(
    (
      error: Error & { status?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(error.status ?? 500).json({ error: error.message });
    },
  );
  return app;
}

describe('question import routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParseImport.mockReturnValue({ candidates: [candidate], failures: [] });
    mockCommitImport.mockResolvedValue({ imported: 1, autoConverted: 0 });
  });

  it('previews one supported multipart file and derives the format from its extension', async () => {
    const response = await request(makeApp())
      .post(`/api/courses/${courseId.toHexString()}/import/preview`)
      .attach('file', Buffer.from('type,stem'), 'questions.csv');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      format: 'csv',
      candidates: [candidate],
      failures: [],
    });
    expect(mockParseImport).toHaveBeenCalledWith('csv', 'type,stem');
  });

  it('returns an inline 400 naming an unsupported extension', async () => {
    const response = await request(makeApp())
      .post(`/api/courses/${courseId.toHexString()}/import/preview`)
      .attach('file', Buffer.from('question: nope'), 'questions.yaml');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'unsupported-import-format:.yaml' });
    expect(mockParseImport).not.toHaveBeenCalled();
  });

  it('rejects a preview request without a file', async () => {
    const response = await request(makeApp()).post(
      `/api/courses/${courseId.toHexString()}/import/preview`,
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'import-file-required' });
  });

  it('commits revalidated candidates using the signed-in instructor identity', async () => {
    const themeId = new ObjectId();
    const loId = new ObjectId();
    const response = await request(makeApp())
      .post(`/api/courses/${courseId.toHexString()}/import/commit`)
      .send({ candidates: [candidate], themeId: themeId.toHexString(), loId: loId.toHexString() });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ imported: 1, autoConverted: 0 });
    expect(mockCommitImport).toHaveBeenCalledWith(
      courseId,
      [candidate],
      expect.objectContaining({
        themeId,
        loId,
        byPuid: 'faculty-puid',
      }),
    );
  });

  it('surfaces semantic candidate validation as an inline 400', async () => {
    mockCommitImport.mockRejectedValue(
      Object.assign(new Error('invalid-import-candidate:expected-4-options'), {
        status: 400,
      }),
    );

    const response = await request(makeApp())
      .post(`/api/courses/${courseId.toHexString()}/import/commit`)
      .send({ candidates: [candidate] });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'invalid-import-candidate:expected-4-options',
    });
  });

  it('keeps both endpoints instructor-authenticated', async () => {
    const preview = await request(makeApp(false))
      .post(`/api/courses/${courseId.toHexString()}/import/preview`)
      .attach('file', Buffer.from('[]'), 'questions.json');
    const commit = await request(makeApp(false))
      .post(`/api/courses/${courseId.toHexString()}/import/commit`)
      .send({ candidates: [candidate] });

    expect(preview.status).toBe(401);
    expect(commit.status).toBe(401);
    expect(mockParseImport).not.toHaveBeenCalled();
    expect(mockCommitImport).not.toHaveBeenCalled();
  });
});
