// Overview page (the app's home). A short welcome, live system status, and a map
// of the boilerplate's components so a new developer knows what is wired up and
// where to look. The student branch (ST-E01/E02/E03) replaces that stub with a
// real "My courses" list plus a join-by-code control.
import { el } from '../dom.js';
import { emptyState, errorState, eyebrow, loadingState } from '../ui.js';
import { courseCard } from '../course-card.js';
import { pageHeader } from '../instructor-ui.js';
import { getSession, displayName } from '../auth.js';
import {
  ApiError,
  type AuthUser,
  type CourseHomeTheme,
  type Enrollment,
} from '../api.js';
import { healthCard } from './health.js';
import { renderMyCourses } from './instructor/courses.js';
import { copyrightFooter } from '../student-ui.js';
import {
  LIVE_STUDENT_EXPERIENCE,
  type StudentExperience,
} from './student/experience.js';
import { maybeStartStudentTutorial } from '../tutorials.js';

/** The user's primary role, used to route to a role-appropriate home (ST-E01).
 * Admin wins, then an explicit global/course Instructor grant, else student.
 * SAML faculty affiliation alone is identity metadata, not authorization. */
export function primaryRole(user: AuthUser): 'admin' | 'instructor' | 'student' {
  if (user.isAdmin) return 'admin';
  if (
    user.platformInstructor === true
    || user.courseRoles.some((courseRole) => courseRole.role === 'instructor')
  ) {
    return 'instructor';
  }
  return 'student';
}

const ROLE_HEADINGS: Record<ReturnType<typeof primaryRole>, string> = {
  admin: 'Admin console',
  instructor: 'Instructor dashboard',
  student: 'My courses',
};

interface ComponentInfo {
  glyph: string;
  name: string;
  desc: string;
  path: string;
}

const COMPONENTS: ComponentInfo[] = [
  { glyph: '▤', name: 'MongoDB', desc: 'Application data store', path: 'components/mongodb' },
  { glyph: '❋', name: 'Qdrant', desc: 'Vector search for RAG', path: 'components/qdrant' },
  { glyph: '⬡', name: 'SAML / CWL auth', desc: 'Sessions + Shibboleth login', path: 'components/auth' },
  { glyph: '◈', name: 'GenAI toolkit', desc: 'LLM · embeddings · chunking · parsing', path: 'components/genai' },
];

function componentCard(info: ComponentInfo): HTMLElement {
  return el(
    'article',
    { class: 'tile' },
    el('span', { class: 'tile__glyph', 'aria-hidden': 'true', text: info.glyph }),
    el('h3', { class: 'tile__name', text: info.name }),
    el('p', { class: 'tile__desc', text: info.desc }),
    el('code', { class: 'tile__path mono', text: info.path }),
  );
}

/** Sums LO coverage across every Topic in a course's home payload, for the
 * "N/M LOs covered" progress bar on that course's My Courses card. */
function courseCoverage(home: CourseHomeTheme[]): { covered: number; total: number } {
  return home.reduce(
    (acc, group) => {
      const total = group.los.length;
      const covered = group.los.filter((l) => l.status === 'covered').length;
      return { covered: acc.covered + covered, total: acc.total + total };
    },
    { covered: 0, total: 0 },
  );
}

/** Student data and progress use the same course-project card as Instructor. */
function studentCourseCard(
  enrollment: Enrollment,
  coverage: { covered: number; total: number } | null,
  experience: StudentExperience,
): HTMLElement {
  return courseCard({
    courseCode: enrollment.courseCode,
    name: enrollment.name,
    term: enrollment.term,
    href: experience.routes.course(enrollment.courseId),
    status: {
      label: enrollment.active ? 'Active' : 'Ended',
      variant: enrollment.active ? 'approved' : 'archived',
    },
    coverage,
    actionLabel: enrollment.active ? 'Open →' : 'View',
  });
}

/** "My courses" (ST-E02/E03, Figma screen 1): a card grid of the student's
 * enrolled courses plus a dashed-border join-by-registration-code box. */
function myCoursesSection(
  experience: StudentExperience,
  previewCourseId?: string,
): HTMLElement {
  const body = el('div', {}, loadingState('Loading your courses…'));
  const codeInput = el('input', { class: 'input', type: 'text', placeholder: 'Enter registration code', 'aria-label': 'Registration code' }) as HTMLInputElement;
  const joinError = el('p', {});
  const section = el(
    'div',
    { class: 'view view--course-projects view--student-projects' },
    el('header', { 'data-tutorial': 'student-dashboard-intro' },
      pageHeader('My Courses', 'Choose a course project and continue from your current learning progress.'),
    ),
    body,
    !experience.preview && el(
      'div',
      { class: 'join-box', 'data-tutorial': 'registration-code' },
      el('p', { class: 'eyebrow', text: 'Join a course' }),
      el('h2', { class: 'section-title', text: 'Have a one-time registration code?' }),
      el('p', { class: 'muted', text: 'Gradebook imports add most students automatically. If your course is missing, enter an unused code from your instructor. Each code can enroll one CWL account.' }),
      el(
        'form',
        {
          class: 'row',
          onsubmit: (e: Event) => {
            e.preventDefault();
            void join();
          },
        },
        codeInput,
        el('button', { class: 'btn btn--instr-primary btn--sm', type: 'submit' }, 'Join'),
      ),
      joinError,
    ),
    copyrightFooter(),
  );

  const load = async (): Promise<void> => {
    body.replaceChildren(loadingState('Loading your courses…'));
    try {
      const enrollments = await experience.listEnrollments(previewCourseId);
      if (enrollments.length === 0) {
        body.replaceChildren(emptyState(experience.preview
          ? 'No courses are available in this Student Preview.'
          : 'You are not enrolled in any courses yet — add one with a registration code below.'));
        return;
      }
      const homes = await Promise.all(
        enrollments.map((e) => experience.getHome(e.courseId).catch(() => null)),
      );
      body.replaceChildren(
        el(
          'div',
          { class: 'course-list' },
          ...enrollments.map((enrollment, i) => studentCourseCard(
            enrollment,
            homes[i] ? courseCoverage(homes[i] as CourseHomeTheme[]) : null,
            experience,
          )),
        ),
      );
    } catch (error) {
      body.replaceChildren(errorState((error as Error).message, () => void load()));
    }
  };

  const join = async (): Promise<void> => {
    const code = codeInput.value.trim();
    if (!code) return;
    joinError.replaceChildren();
    try {
      await experience.enroll(code, previewCourseId);
      codeInput.value = '';
      void load();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : (error as Error).message;
      joinError.replaceChildren(errorState(message));
    }
  };

  void load();
  return section;
}

export function renderStudentCourses(
  outlet: HTMLElement,
  experience: StudentExperience = LIVE_STUDENT_EXPERIENCE,
  previewCourseId?: string,
): void {
  const root = myCoursesSection(experience, previewCourseId);
  outlet.append(root);
  if (!experience.preview) maybeStartStudentTutorial('student-welcome', { root });
}

export function renderHome(outlet: HTMLElement): void {
  const user = getSession().user;
  const greeting = user ? `Welcome, ${displayName(user)}` : 'Welcome';
  const role = user ? primaryRole(user) : undefined;

  const intro = el(
    'div',
    { class: 'view__intro' },
    eyebrow('Overview'),
    el('h1', { class: 'view__title', text: greeting }),
    role
      ? el('p', { class: 'view__lead', text: role === 'student' ? ROLE_HEADINGS.student : `${ROLE_HEADINGS[role]} — Phase 1 builds this view out. (Signed in as ${role}.)` })
      : el('p', {
          class: 'view__lead',
          text:
            'You are signed in. Everything below the fold is a wired-up integration ' +
            'you can build on — or delete the example pages and keep the shell.',
        }),
  );

  if (role === 'student') {
    renderStudentCourses(outlet);
    return;
  }

  // Keep this direct-rendering branch aligned with main.ts's shell selection:
  // Admin, platform Instructor, or an existing instructor courseRole.
  if (role === 'instructor') {
    void renderMyCourses(outlet);
    return;
  }

  outlet.append(
    el(
      'div',
      { class: 'view view--overview' },
      intro,
      healthCard(),
      el(
        'section',
        { class: 'card' },
        el(
          'div',
          { class: 'card__head' },
          el('div', {}, eyebrow('What’s in the box'), el('h2', { class: 'card__title', text: 'Components' })),
        ),
        el('div', { class: 'tile-grid' }, ...COMPONENTS.map(componentCard)),
      ),
    ),
  );
}
