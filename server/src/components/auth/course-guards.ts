import type { RequestHandler } from 'express';
import { ObjectId } from 'mongodb';
import type { CourseRole } from '../../types/domain';

// Course-scoped role guards (IN-S01+). Unlike ensureRole() (affiliation-based:
// faculty/student/staff from the IdP), these check the signed-in user's
// per-course `courseRoles` array against the course a request targets. See
// components/auth/AGENTS.md and server/src/services/courses.service.ts.

/** Resolve the courseId a request targets: route param first, else res.locals
 * (set by routes that look up a child resource like a theme or question). */
function requestCourseId(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]): string | undefined {
  return (req.params as { courseId?: string }).courseId ?? (res.locals.courseId as string | undefined);
}

function ensureCourseRole(role: CourseRole): RequestHandler {
  return (req, res, next) => {
    if (!req.isAuthenticated() || !req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (req.user.isAdmin) return next();
    const courseId = requestCourseId(req, res);
    const match = courseId && req.user.courseRoles.some(
      (r) => r.role === role && r.courseId.toString() === new ObjectId(courseId).toString(),
    );
    if (!match) {
      res.status(403).json({ error: 'You do not have access to this course.' });
      return;
    }
    next();
  };
}

export const ensureCourseInstructor = (): RequestHandler => ensureCourseRole('instructor');
export const ensureCourseStudent = (): RequestHandler => ensureCourseRole('student');
export const ensureCourseTa = (): RequestHandler => ensureCourseRole('ta');
