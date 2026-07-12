import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { validate } from '../../server/src/middleware/validate';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.post(
    '/echo/:id',
    validate({
      params: z.object({ id: z.string().regex(/^[0-9a-f]{24}$/) }),
      body: z.object({ name: z.string().min(1), count: z.coerce.number().int().optional() }),
    }),
    (req, res) => res.json({ params: req.params, body: req.body }),
  );
  return app;
}

describe('validate() middleware', () => {
  const goodId = 'a'.repeat(24);

  it('passes valid requests through with parsed values', async () => {
    const res = await request(makeApp()).post(`/echo/${goodId}`).send({ name: 'x', count: '3', extra: 'stripped' });
    expect(res.status).toBe(200);
    expect(res.body.body).toEqual({ name: 'x', count: 3 }); // coerced + unknown keys stripped
  });

  it('responds 400 with issue paths on invalid body', async () => {
    const res = await request(makeApp()).post(`/echo/${goodId}`).send({ name: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request.');
    expect(res.body.issues[0].path).toBe('body.name');
  });

  it('responds 400 on invalid params', async () => {
    const res = await request(makeApp()).post('/echo/not-an-id').send({ name: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.issues[0].path).toBe('params.id');
  });
});
