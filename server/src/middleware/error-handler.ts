import type { ErrorRequestHandler, RequestHandler } from 'express';

/** Catch-all for requests that match no route. */
export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'Not Found' });
};

/**
 * Centralized error handler. Express identifies this as an error handler by its
 * four-argument signature, so `next` must stay in the parameter list even
 * though it is unused.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error('[error]', err);
  const status = typeof err?.status === 'number' ? err.status : 500;
  res.status(status).json({ error: err?.message ?? 'Internal Server Error' });
};
