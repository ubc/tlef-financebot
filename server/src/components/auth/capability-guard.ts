import type { RequestHandler } from 'express';
import { ObjectId } from 'mongodb';
import type { Capability } from '../../types/domain';
import { hasCapability } from '../../services/capabilities.service';
import { NO_COURSE_ACCESS_BODY } from './course-guards';

function requestCourseId(
  req: Parameters<RequestHandler>[0],
  res: Parameters<RequestHandler>[1],
): string | undefined {
  return (req.params as { courseId?: string }).courseId
    ?? (res.locals.courseId as string | undefined);
}

export function ensureCapability(capability: Capability): RequestHandler {
  return (req, res, next) => {
    if (!req.isAuthenticated() || !req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const rawCourseId = requestCourseId(req, res);
    if (!rawCourseId || !ObjectId.isValid(rawCourseId)) {
      res.status(403).json(NO_COURSE_ACCESS_BODY);
      return;
    }
    hasCapability(req.user, new ObjectId(rawCourseId), capability)
      .then((allowed) => {
        if (!allowed) {
          res.status(403).json(NO_COURSE_ACCESS_BODY);
          return;
        }
        next();
      })
      .catch(next);
  };
}
