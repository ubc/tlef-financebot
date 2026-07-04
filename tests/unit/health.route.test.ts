// Integration test — a ROUTER via supertest, with its components mocked. Mounts
// the real healthRouter on a bare Express app and drives it over HTTP, but
// replaces the mongodb/qdrant probes so no real connection is attempted.
import express, { type Express } from 'express';
import request from 'supertest';

jest.mock('../../server/src/components/mongodb', () => ({ pingMongo: jest.fn() }));
jest.mock('../../server/src/components/qdrant', () => ({ pingQdrant: jest.fn() }));

import { healthRouter } from '../../server/src/routes/health.routes';
import { pingMongo } from '../../server/src/components/mongodb';
import { pingQdrant } from '../../server/src/components/qdrant';

function makeApp(): Express {
  const app = express();
  app.use('/api', healthRouter);
  return app;
}

describe('GET /api/health', () => {
  it('reports services up and echoes the configured GenAI providers', async () => {
    jest.mocked(pingMongo).mockResolvedValue(true);
    jest.mocked(pingQdrant).mockResolvedValue(true);

    const res = await request(makeApp()).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.services).toEqual({ mongodb: 'up', qdrant: 'up' });
    expect(res.body.genai).toHaveProperty('llmProvider');
    expect(res.body.genai).toHaveProperty('embeddingsModel');
  });

  it('reports down services when the probes fail', async () => {
    jest.mocked(pingMongo).mockResolvedValue(false);
    jest.mocked(pingQdrant).mockResolvedValue(false);

    const res = await request(makeApp()).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.services).toEqual({ mongodb: 'down', qdrant: 'down' });
  });
});
