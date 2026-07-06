import { Router } from 'express';
import { pingMongo } from '../components/mongodb';
import { pingQdrant } from '../components/qdrant';
import { isAcademicApiConfigured, pingAcademicApi } from '../components/academic-api';
import { env } from '../config/env';

export const healthRouter = Router();

/**
 * GET /api/health
 *
 * Liveness check. Reports the status of each connected component so a single
 * request tells you whether the app and its dependencies are healthy. `services`
 * holds up/down reachability; `genai` echoes the configured providers/models
 * (config, not a live probe, so the check stays fast). Add more entries as
 * components are built up.
 */
healthRouter.get('/health', async (_req, res) => {
  const [mongoUp, qdrantUp, academicUp] = await Promise.all([
    pingMongo(),
    pingQdrant(),
    pingAcademicApi(),
  ]);
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      mongodb: mongoUp ? 'up' : 'down',
      qdrant: qdrantUp ? 'up' : 'down',
      // Only report the Academic API when it is configured; otherwise it is an
      // optional, disabled feature rather than a "down" dependency.
      ...(isAcademicApiConfigured() ? { academicApi: academicUp ? 'up' : 'down' } : {}),
    },
    genai: {
      llmProvider: env.llmProvider,
      llmModel: env.llmDefaultModel,
      embeddingsProvider: env.embeddingsProvider,
      embeddingsModel: env.embeddingsModel,
    },
  });
});
