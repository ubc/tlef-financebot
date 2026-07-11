import path from 'node:path';
import express, { type Express } from 'express';
import cors from 'cors';
import { healthRouter } from './routes/health.routes';
import { notesRouter } from './routes/notes.routes';
import { ragRouter } from './routes/rag.routes';
import { membersRouter } from './routes/members.routes';
import { rolesRouter } from './routes/roles.routes';
import { academicRouter } from './routes/academic.routes';
import { authRouter } from './routes/auth.routes';
import { configureAuth } from './components/auth';
import { errorHandler, notFoundHandler } from './middleware/error-handler';

/** Absolute path to the client's static output (HTML/CSS + compiled JS). */
const CLIENT_PUBLIC_DIR = path.resolve(__dirname, '../../client/public');

/**
 * Build the Express application. Kept separate from `server.ts` so tests can
 * create an app without binding to a port.
 */
export function createApp(): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());
  // The SAML callback is posted as form-urlencoded, so parse that too.
  app.use(express.urlencoded({ extended: false }));

  // Sessions + passport. Order matters: session -> initialize -> session.
  const { passport, sessionMiddleware } = configureAuth();
  app.use(sessionMiddleware);
  app.use(passport.initialize());
  app.use(passport.session());

  // API routes are mounted under /api. Add new routers here as features grow.
  app.use('/api', healthRouter); // public (used by the pre-login landing screen).
  app.use('/api', notesRouter); // EXAMPLE (mongodb demo) — auth-gated; safe to remove.
  app.use('/api', ragRouter); // EXAMPLE (genai + qdrant RAG demo) — auth-gated; safe to remove.
  app.use('/api', membersRouter); // EXAMPLE (auth-gating reference) — gated members area.
  app.use('/api', rolesRouter); // EXAMPLE (role-based authorization) — per-role areas.
  app.use('/api', academicRouter); // Academic API lookup — auth-gated (the signed-in user's record).
  app.use(authRouter); // /auth/* (login, callback, logout) + public /api/auth/me

  // Serve the compiled client. Any non-API request falls through to here.
  app.use(express.static(CLIENT_PUBLIC_DIR));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
