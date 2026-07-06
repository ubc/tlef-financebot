import { Router } from 'express';
import { ensureApiAuthenticated } from '../components/auth';
import { buildAcademicProfile } from '../services/academic.service';

// The signed-in user's academic record, looked up from the Academic API (or the
// local FakeAcademicAPI) by their CWL PUID. Auth-gated: only reachable while
// signed in, since it depends on the SAML session identity. See
// components/academic-api and services/academic.service.
export const academicRouter = Router();

/** GET /api/academic/me -> the signed-in user's person + course record. Auth-gated. */
academicRouter.get('/academic/me', ensureApiAuthenticated(), async (req, res) => {
  // req.user is guaranteed present by the guard. Errors reaching the Academic
  // API surface as thrown errors with a `status`, handled centrally (Express 5
  // forwards async rejections to the error handler).
  res.json(await buildAcademicProfile(req.user!));
});
