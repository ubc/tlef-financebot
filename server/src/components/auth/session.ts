import type { RequestHandler } from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import { getMongoClient } from '../mongodb';
import { env, isProduction } from '../../config/env';

/**
 * Build the express-session middleware, backed by MongoDB (connect-mongo). The
 * session store reuses the already-connected client from the mongodb component
 * rather than opening a second connection, so `connectMongo()` MUST have run
 * first (it has: server.ts connects before creating the app).
 */
export function createSessionMiddleware(): RequestHandler {
  return session({
    secret: env.sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      client: getMongoClient(),
      dbName: env.mongodbDbName,
      collectionName: 'sessions',
    }),
    cookie: {
      httpOnly: true,
      // Local dev is HTTP, so secure cookies would never be sent. Enable in prod.
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    },
  });
}
