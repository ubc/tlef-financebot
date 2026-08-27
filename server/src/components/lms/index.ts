import { canvas, createMongoTokenStore, type MongoDbLike } from '@ubc/ubc-genai-toolkit-lms-integration';
import { getDb } from '../mongodb';
import { canvasEnabled } from '../../config/env';

// Binds the LMS integration package to FinanceBot identity and storage. The
// package owns OAuth, refresh, pagination, and roster matching; this file
// owns exactly two decisions — which Mongo collection holds tokens, and which
// application identifier keys them. See components/lms/AGENTS.md.

/** Token-store collection. Keyed by PUID, the canonical CWL identity (users.puid, unique). */
export const CANVAS_TOKEN_COLLECTION = 'lmsCanvasTokens';

let cached: canvas.Config | undefined;

export function isCanvasConfigured(): boolean {
  return canvasEnabled;
}

/**
 * Memoised package config. `loadConfigFromEnv` throws, naming the missing
 * variables, if any of the four CANVAS_* values is unset — callers should
 * check `isCanvasConfigured()` first and never mount the router otherwise.
 */
export function getCanvasConfig(): canvas.Config {
  if (cached) return cached;
  cached = canvas.loadConfigFromEnv({
    // The package types its Db structurally with a wider `createIndex` param
    // than mongodb v7 declares, so `Db` fails to satisfy `MongoDbLike` at the
    // type level while matching it at runtime (findOne/updateOne/deleteOne/
    // createIndex all exist with compatible behaviour). Cast at this one
    // boundary rather than loosen the driver's own types.
    tokenStore: createMongoTokenStore(() => getDb() as unknown as MongoDbLike, { collectionName: CANVAS_TOKEN_COLLECTION }),
    getUserKey: (req) => {
      if (!req.user?.puid) throw new Error('Application authentication required');
      return req.user.puid;
    },
    basePath: '/api/lms/canvas/auth',
  });
  return cached;
}
