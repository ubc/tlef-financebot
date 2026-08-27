import type { ObjectId } from 'mongodb';
import { canvas } from '@ubc/ubc-genai-toolkit-lms-integration';
import { coursesCol, lmsRosterEntriesCol } from '../components/mongodb/collections';
import { getCourse } from './courses.service';

// Canvas integration service (Phase 6). Owns the course link, file import
// (Task 3), and roster sync (Task 4). The package owns every Canvas call;
// this file owns FinanceBot's decisions about them. Design:
// docs/superpowers/specs/2026-08-27-canvas-integration-design.md

export interface CourseLink {
  courseId: string;
  name: string;
  code: string;
  linkedAt: Date;
  linkedBy: string;
}

/** Courses the connected Canvas identity TEACHES — the only linkable ones. */
export async function listTeacherCourses(
  api: canvas.ApiClient,
): Promise<Array<{ id: string; name: string; code: string }>> {
  const courses = await canvas.getCourses(api, { enrollment_type: 'teacher' });
  return courses.map((c) => ({ id: c.id, name: c.name, code: c.code }));
}

export async function getLink(courseId: ObjectId): Promise<CourseLink | null> {
  const course = await getCourse(courseId);
  return course.canvas ?? null;
}

/** Throws `not-linked`. Every course-scoped Canvas read starts here so the
 * external course id can only ever come from the stored link. */
export async function requireLink(courseId: ObjectId): Promise<CourseLink> {
  const link = await getLink(courseId);
  if (!link) throw new Error('not-linked');
  return link;
}

/**
 * Link a Canvas course. Refused (`not-teacher`) unless the id appears in the
 * connected identity's teacher list — a stored token proves a credential,
 * not instructor status on that course. Name/code are taken from Canvas's
 * row, never from the caller.
 */
export async function linkCourse(
  api: canvas.ApiClient,
  courseId: ObjectId,
  canvasCourseId: string,
  byPuid: string,
): Promise<CourseLink> {
  const teaching = await listTeacherCourses(api);
  const match = teaching.find((c) => c.id === canvasCourseId);
  if (!match) throw new Error('not-teacher');
  const link: CourseLink = { courseId: match.id, name: match.name, code: match.code, linkedAt: new Date(), linkedBy: byPuid };
  await coursesCol().updateOne({ _id: courseId }, { $set: { canvas: link } });
  return link;
}

/** Clear the link and the course's synced Canvas roster. Imported materials
 * stay — they are FinanceBot's now. */
export async function unlinkCourse(courseId: ObjectId): Promise<void> {
  await coursesCol().updateOne({ _id: courseId }, { $unset: { canvas: '' } });
  await lmsRosterEntriesCol().deleteMany({ courseId });
}
