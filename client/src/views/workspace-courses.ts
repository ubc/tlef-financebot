import { ApiError, getPreviewCourseIdentity, listAdminCourses, listInstructorCourses, type AdminCourseOption } from '../api.js';
import { getSession, type Session } from '../auth.js';
import { courseCard } from '../course-card.js';
import { el, mount } from '../dom.js';
import { pageHeader } from '../instructor-ui.js';
import { emptyState, errorState, loadingState } from '../ui.js';
import { attachTutorial } from '../tutorials.js';

/** Identity-only choices: selecting a workspace never grants course membership. */
export async function workspaceCourses(session: Session, restricted = false): Promise<AdminCourseOption[]> {
  if (session.user?.isAdmin) {
    const courses = await listAdminCourses();
    return restricted ? courses.filter(course => course.lifecycle === 'published') : courses;
  }
  const courses = session.user?.platformInstructor || session.user?.courseRoles.some(entry => entry.role === 'instructor')
    ? await listInstructorCourses() : [];
  const known = new Set(courses.map(course => course._id));
  const taIds = [...new Set(session.user?.courseRoles.filter(entry => entry.role === 'ta' && !known.has(entry.courseId)).map(entry => entry.courseId))];
  const taCourses = await Promise.all(taIds.map(async _id => {
    try {
      const course = await getPreviewCourseIdentity(_id, restricted);
      return { ...course, _id, lifecycle: 'published' as const };
    } catch (error) {
      if (restricted && error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }));
  const instructorCourses = courses.map(course => ({ ...course, lifecycle: course.lifecycle ?? (course.published ? 'published' : 'draft') }));
  return [...(restricted ? instructorCourses.filter(course => course.lifecycle === 'published') : instructorCourses),
    ...taCourses.filter((course): course is NonNullable<typeof course> => course !== null)];
}

export function renderWorkspaceCourses(outlet: HTMLElement, role: 'ta' | 'student', restricted = false): void {
  const session = getSession();
  const body = el('div', {}, loadingState('Loading courses…'));
  const root = el('div', { class: 'view view--course-projects course-projects' },
    pageHeader('My Courses', role === 'student'
      ? restricted ? 'Only published courses appear here. Preview progress stays separate from student records.' : 'Preview any course as an anonymous Student, including unpublished courses. Progress stays separate from student records.'
      : 'Choose a course to open its TA workspace.'), body);
  async function load(): Promise<void> {
    body.replaceChildren(loadingState('Loading courses…'));
    try {
      const courses = await workspaceCourses(session, restricted && role === 'student');
      if (!root.isConnected) return;
      body.replaceChildren(courses.length ? el('div', { class: 'course-list' }, ...courses.map(course => courseCard({
        ...course,
        href: role === 'student' ? `#/preview/${restricted ? 'restricted/' : ''}course/${encodeURIComponent(course._id)}` : `#/ta/course/${encodeURIComponent(course._id)}/review`,
        status: { label: role === 'student' ? restricted ? 'Published course' : 'Student Preview' : 'TA workspace', variant: 'neutral' },
      }))) : emptyState('No courses are available for this role yet. Use the role menu to return to your workspace.'));
      if (role === 'ta') attachTutorial(root, 'ta-courses', {
        'ta-course-heading': '.page-header',
        'ta-course-list': '.course-list',
      });
    } catch (error) {
      if (root.isConnected) body.replaceChildren(errorState(error instanceof Error ? error.message : 'Courses could not be loaded.', () => void load()));
    }
  }
  mount(outlet, root);
  void load();
}
