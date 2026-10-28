import type { ErrorRequestHandler, RequestHandler } from 'express';
import { operationContext } from '../services/operation-context';
import { exceptionDiagnostics } from '../services/exception-diagnostics';

/** Catch-all for requests that match no route. */
export const notFoundHandler: RequestHandler = (_req, res) => {
  res.locals.routingComplete = true;
  res.status(404).json({ error: 'Not Found' });
};

/**
 * Centralized error handler. Express identifies this as an error handler by its
 * four-argument signature, so `next` must stay in the parameter list even
 * though it is unused.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // Stream/body-parser aborts after the client closes are already audited as
  // interrupted requests. Do not emit a second server exception or write JSON.
  const transportClosed = req.aborted || res.destroyed;
  const disconnect = err?.type === 'request.aborted' || ['ECONNABORTED', 'ECONNRESET', 'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE', 'ABORT_ERR'].includes(err?.code);
  if (transportClosed && disconnect) { if (!res.destroyed) res.destroy(); return; }
  const exception = exceptionDiagnostics(err);
  res.locals.operationException = exception;
  console.error('[http.exception]', JSON.stringify({ requestId: operationContext.getStore() ?? null, exception, headersSent: res.headersSent }));
  if (res.headersSent || res.destroyed || req.aborted) { if (!res.destroyed) res.destroy(); return; }
  const status = typeof err?.status === 'number' ? err.status : 500;
  res.status(status).json({ error: err?.message ?? 'Internal Server Error' });
};
