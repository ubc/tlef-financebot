import type { RequestHandler } from 'express';

const AUTH_REQUIRED = Object.freeze({ error: 'Authentication required.' });
const ADMIN_REQUIRED = Object.freeze({ error: 'Admin access required.' });
const PLATFORM_INSTRUCTOR_REQUIRED = Object.freeze({ error: 'Platform Instructor access required.' });

function requireAuthenticated(
  nextCheck: (user: Express.User) => boolean,
  forbiddenBody: Readonly<{ error: string }>,
): RequestHandler {
  return (req, res, next) => {
    if (!req.isAuthenticated() || !req.user) {
      res.status(401).json(AUTH_REQUIRED);
      return;
    }
    if (!nextCheck(req.user)) {
      res.status(403).json(forbiddenBody);
      return;
    }
    next();
  };
}

/** Platform-wide Admin gate. Admin membership remains env/IdP-login managed. */
export const ensureAdmin = (): RequestHandler =>
  requireAuthenticated((user) => user.isAdmin, ADMIN_REQUIRED);

/**
 * Authorizes global Instructor entry points such as course creation.
 * Existing-course access remains protected by ensureCourseInstructor().
 */
export const ensurePlatformInstructor = (): RequestHandler =>
  requireAuthenticated(
    (user) => user.isAdmin || user.platformInstructor === true,
    PLATFORM_INSTRUCTOR_REQUIRED,
  );
