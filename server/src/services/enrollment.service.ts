import type { ObjectId } from 'mongodb';
import { coursesCol, rosterCol, usersCol } from '../components/mongodb/collections';
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
 * Enroll `user` into the course identified by `code`. Requires both a
 * matching, published course AND a roster entry for the caller's CWL identity
 * (uid or email, case-insensitively) — the registration code alone never
 * grants access (ST-E02). Idempotent: re-enrolling an already-enrolled
 * student throws rather than writing a duplicate courseRoles entry.
 */
export async function enrollByCode(
  user: User,
  code: string,
): Promise<{ courseId: ObjectId; name: string; courseCode: string }> {
  const course = await coursesCol().findOne({ registrationCode: code.trim().toUpperCase() });
  if (!course || !course.published) throw new EnrollmentError('not-recognized');

  const identifiers = [user.uid, user.email].filter(Boolean).map((s) => s.toLowerCase());
  const rosterHit = await rosterCol().findOne({ courseId: course._id, identifier: { $in: identifiers } });
  if (!rosterHit) throw new EnrollmentError('not-on-roster');

  const ends = rosterHit.extendedUntil ?? course.termEnd;
  if (ends && ends < new Date()) throw new EnrollmentError('course-ended');

  if (user.courseRoles.some((r) => r.role === 'student' && r.courseId.toString() === course._id.toString())) {
    throw new EnrollmentError('already-enrolled');
  }

  await usersCol().updateOne(
    { puid: user.puid },
    { $addToSet: { courseRoles: { courseId: course._id, role: 'student' as const } } },
  );

  return { courseId: course._id, name: course.name, courseCode: course.courseCode };
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
      const active = !ends || ends >= new Date();

      return { courseId, name: course.name, courseCode: course.courseCode, term: course.term, active };
    }),
  );

  return enrollments.filter((e): e is NonNullable<typeof e> => e !== null);
}
