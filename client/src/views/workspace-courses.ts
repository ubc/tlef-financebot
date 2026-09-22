import { getPreviewCourseIdentity, listAdminCourses, listInstructorCourses, type AdminCourseOption } from '../api.js';
import { getSession, type Session } from '../auth.js';
import { courseCard } from '../course-card.js';
import { el, mount } from '../dom.js';
import { pageHeader } from '../instructor-ui.js';
import { emptyState, errorState, loadingState } from '../ui.js';
import { attachTutorial } from '../tutorials.js';

/** Identity-only choices: selecting a workspace never grants course membership. */
async function workspaceCourses(session: Session): Promise<AdminCourseOption[]> {
  if (session.user?.isAdmin) return listAdminCourses();
  const courses = session.user?.platformInstructor || session.user?.courseRoles.some(entry => entry.role === 'instructor')
    ? await listInstructorCourses() : [];
  const known = new Set(courses.map(course => course._id));
  const taIds = [...new Set(session.user?.courseRoles.filter(entry => entry.role === 'ta' && !known.has(entry.courseId)).map(entry => entry.courseId))];
  const taCourses = await Promise.all(taIds.map(async _id => {
    const course = await getPreviewCourseIdentity(_id);
    return { ...course, _id, lifecycle: 'published' as const };
  }));
  return [...courses.map(course => ({ ...course, lifecycle: course.lifecycle ?? (course.published ? 'published' : 'draft') })), ...taCourses];
}

export function renderWorkspaceCourses(outlet: HTMLElement, role: 'ta' | 'student'): void {
  const session = getSession();
  const body = el('div', {}, loadingState('Loading courses…'));
  const root = el('div', { class: 'view view--course-projects course-projects' },
    pageHeader('My Courses', role === 'student' ? 'Choose a course to explore as an anonymous Student. Preview progress stays separate from student records.' : 'Choose a course to open its TA workspace.'), body);
  async function load(): Promise<void> {
    body.replaceChildren(loadingState('Loading courses…'));
    try {
      const courses = await workspaceCourses(session);
      if (!root.isConnected) return;
      body.replaceChildren(courses.length ? el('div', { class: 'course-list' }, ...courses.map(course => courseCard({
        ...course,
        href: role === 'student' ? `#/preview/course/${encodeURIComponent(course._id)}` : `#/ta/course/${encodeURIComponent(course._id)}/review`,
        status: { label: role === 'student' ? 'Student Preview' : 'TA workspace', variant: 'neutral' },
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
