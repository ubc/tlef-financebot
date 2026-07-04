// Integration test — a GATED router via supertest. Verifies the real
// ensureApiAuthenticated() guard (401 when signed out, through when signed in)
// while mocking the service layer. A tiny middleware stands in for passport by
// setting req.isAuthenticated()/req.user, so no real session store is needed.
import express, { type Express } from 'express';
import request from 'supertest';

jest.mock('../../server/src/services/notes.service', () => ({
  listNotes: jest.fn(),
  createNote: jest.fn(),
}));

import { notesRouter } from '../../server/src/routes/notes.routes';
import { listNotes, createNote } from '../../server/src/services/notes.service';

function makeApp(authenticated: boolean): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // Stand in for passport (the real ensureApiAuthenticated guard calls these).
    (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated = () => authenticated;
    (req as { user?: unknown }).user = authenticated ? { nameId: 'u1', attributes: {} } : undefined;
    next();
  });
  app.use('/api', notesRouter);
  return app;
}

describe('notes routes (auth-gated)', () => {
  it('returns 401 and does not touch the service when signed out', async () => {
    const res = await request(makeApp(false)).get('/api/notes');
    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
    expect(listNotes).not.toHaveBeenCalled();
  });

  it('lists notes when signed in', async () => {
    jest.mocked(listNotes).mockResolvedValue([
      { _id: '1', text: 'hi', createdAt: new Date() } as never,
    ]);
    const res = await request(makeApp(true)).get('/api/notes');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('validates then creates a note when signed in', async () => {
    jest.mocked(createNote).mockResolvedValue({ _id: '2', text: 'new', createdAt: new Date() } as never);

    const missing = await request(makeApp(true)).post('/api/notes').send({});
    expect(missing.status).toBe(400);
    expect(createNote).not.toHaveBeenCalled();

    const created = await request(makeApp(true)).post('/api/notes').send({ text: 'new' });
    expect(created.status).toBe(201);
    expect(createNote).toHaveBeenCalledWith('new');
  });
});
