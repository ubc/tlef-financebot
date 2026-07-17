import path from 'node:path';
import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { isProduction } from './config/env';
import { healthRouter } from './routes/health.routes';
import { notesRouter } from './routes/notes.routes';
import { ragRouter } from './routes/rag.routes';
import { membersRouter } from './routes/members.routes';
import { rolesRouter } from './routes/roles.routes';
import { classesRouter } from './routes/classes.routes';
import { coursesRouter } from './routes/courses.routes';
import { questionsRouter } from './routes/questions.routes';
import { enrollmentRouter } from './routes/enrollment.routes';
import { practiceRouter } from './routes/practice.routes';
import { reviewBookRouter } from './routes/review-book.routes';
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

  app.use(
    helmet({
      // The client is plain static files served same-origin; keep CSP simple.
      contentSecurityPolicy: isProduction ? undefined : false,
    }),
  );
  // Generous global API limit — protects against runaways, not normal use
  // (concurrency target is 250 active sessions, PRD §2).
  app.use(
    '/api',
    rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false }),
  );

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
  app.use('/api', classesRouter); // EXAMPLE (Academic API classes demo) — role-gated; safe to remove.
  app.use('/api', coursesRouter); // Courses/Hierarchy/Roster (IN-S01/S02/S03, IN-L06) — instructor authoring surface.
  app.use('/api', questionsRouter); // Question bank browse/filter, review queue, editing, transitions (IN-Q02/Q05/Q08).
  app.use('/api', enrollmentRouter); // Enrollment by code + roster cross-check (ST-E02/E03).
  app.use(authRouter); // /auth/* (login, callback, logout) + public /api/auth/me
  app.use('/api', practiceRouter); // Attempts + adaptive feedback + Review Book auto-collection (ST-P04, ST-R01).
  app.use('/api', reviewBookRouter); // Review Book browsing/bookmarking + session summaries (ST-R02..R07, ST-P10/P11).

  // Serve the compiled client. Any non-API request falls through to here.
  app.use(express.static(CLIENT_PUBLIC_DIR));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
