import type { RequestHandler } from 'express';
import { classifyProbe } from '../services/request-probe.service';

/** Reject unrelated exploit endpoints before body parsing, sessions or DB reads. */
export const rejectApiProbe: RequestHandler = (req, res, next) => {
  if (!classifyProbe(req.originalUrl)) { next(); return; }
  res.locals.probeRejected = true;
  res.status(404).json({ error: 'Not Found' });
};
