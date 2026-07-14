import { Router } from 'express';
import { ensureRole } from '../components/auth';
import { getClassList, getMyClasses } from '../services/classes.service';

// EXAMPLE (Academic API demo) — the classes feature. Role-gated: faculty and
// students have classes; staff get 403 (and no nav item client-side, but the
// guard here is the real enforcement). Errors thrown by the service carry
// their own status (403 not-your-section, 404 unknown section, 502 Academic
// API unavailable) and flow to the central error handler — Express 5 forwards
// rejected async handlers automatically. Safe to delete along with
// classes.service.ts and the client classes view.
export const classesRouter = Router();

/** GET /api/classes -> MyClasses (teaching + enrolled, grouped by term). */
classesRouter.get('/classes', ensureRole('faculty', 'student'), async (req, res) => {
  res.json(await getMyClasses(req.user!));
});

/** GET /api/classes/:sectionId/students -> ClassList. Instructor-only. */
classesRouter.get('/classes/:sectionId/students', ensureRole('faculty'), async (req, res) => {
  // Express 5 types a route param as string | string[]; a single named segment
  // is always a string at runtime.
  res.json(await getClassList(req.user!, String(req.params.sectionId)));
});
