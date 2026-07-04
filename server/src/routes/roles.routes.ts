import { Router } from 'express';
import { ensureRole } from '../components/auth';
import { buildRoleArea, ROLE_AREAS } from '../services/roles.service';

// EXAMPLE (role-based authorization reference). One gated endpoint per role:
// GET /api/roles/faculty | /student | /staff. The ensureRole(<role>) guard lets
// through only users whose eduPersonAffiliation includes that role (401 signed
// out, 403 signed in with the wrong role). See components/auth/AGENTS.md.
export const rolesRouter = Router();

for (const role of ROLE_AREAS) {
  rolesRouter.get(`/roles/${role}`, ensureRole(role), (req, res) => {
    res.json(buildRoleArea(role, req.user!));
  });
}
