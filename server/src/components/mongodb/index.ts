import { MongoClient, type Db } from 'mongodb';
import { env } from '../../config/env';

// A single MongoClient is shared for the whole process. The driver maintains an
// internal connection pool, so you must NOT create a client per request.
let client: MongoClient | undefined;
let db: Db | undefined;

/**
 * Connect to MongoDB and cache the client + database. Idempotent: calling it
 * again returns the already-connected database. Call this once during startup
 * (see server/src/server.ts) so a bad URI / unreachable server fails fast.
 */
export async function connectMongo(): Promise<Db> {
  if (db) return db;
  const created = new MongoClient(env.mongodbUri);
  await created.connect();
  client = created;
  db = created.db(env.mongodbDbName);
  return db;
}

/** The connected database. Throws if `connectMongo()` has not run yet. */
export function getDb(): Db {
  if (!db) {
    throw new Error('MongoDB is not connected. Call connectMongo() during startup first.');
  }
  return db;
}

/** The underlying client (needed by e.g. connect-mongo for the session store). */
export function getMongoClient(): MongoClient {
  if (!client) {
    throw new Error('MongoDB is not connected. Call connectMongo() during startup first.');
  }
  return client;
}

/** Lightweight liveness check used by GET /api/health. Never throws. */
export async function pingMongo(): Promise<boolean> {
  if (!db) return false;
  try {
    await db.command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

/** Close the connection and clear cached state (used on shutdown / in tests). */
export async function closeMongo(): Promise<void> {
  await client?.close();
  client = undefined;
  db = undefined;
}
