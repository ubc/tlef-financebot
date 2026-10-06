import type { ObjectId } from 'mongodb';
import { coursesCol, rosterCol } from '../components/mongodb/collections';
import { redeemRegistrationCode } from './registration-codes.service';
import type { User } from '../types/domain';

// -----------------------------------------------------------------------------
// Enrollment service (ST-E02 code + roster cross-check, ST-E03 enrollment
// list). routes/enrollment.routes.ts is the only caller. See
// server/src/services/AGENTS.md.
// -----------------------------------------------------------------------------

/**
 * The four terminal outcomes of an enrollment attempt (ST-E02). `.code` drives
 * the HTTP status mapping in enrollment.routes.ts; kept separate from the
 * message so the route layer owns user-facing wording.
 */
export class EnrollmentError extends Error {
  constructor(public readonly code: 'not-recognized' | 'not-on-roster' | 'course-ended' | 'already-enrolled') {
    super(code);
  }
}

/**
 * Supplemental enrollment after CWL login. Gradebook imports remain separate;
 * legacy shared course codes and roster allowlists no longer authorize joins.
 */
export async function enrollByCode(
  user: User,
  code: string,
): Promise<{ courseId: ObjectId; name: string; courseCode: string }> {
  return redeemRegistrationCode(user, code);
}

/**
 * List every course `user` is enrolled in as a student, with `active` false
 * once past `termEnd` — respecting a per-student `extendedUntil` roster
 * override when one exists (ST-E03).
 */
export async function listEnrollments(
  user: User,
): Promise<Array<{ courseId: ObjectId; name: string; courseCode: string; term: string; active: boolean }>> {
  const studentCourseIds = user.courseRoles.filter((r) => r.role === 'student').map((r) => r.courseId);

  const enrollments = await Promise.all(
    studentCourseIds.map(async (courseId) => {
      const course = await coursesCol().findOne({ _id: courseId });
      if (!course) return null;

      const identifiers = [user.uid, user.email].filter(Boolean).map((s) => s.toLowerCase());
      const rosterHit = await rosterCol().findOne({ courseId, identifier: { $in: identifiers } });
      const ends = rosterHit?.extendedUntil ?? course.termEnd;
      const archived = course.lifecycle === 'archived' || Boolean(course.archivedAt);
      const active = !archived && (!ends || ends >= new Date());

      return { courseId, name: course.name, courseCode: course.courseCode, term: course.term, active };
    }),
  );

  return enrollments.filter((e): e is NonNullable<typeof e> => e !== null);
}
