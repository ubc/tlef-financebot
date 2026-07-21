// Overview page (the app's home). A short welcome, live system status, and a map
// of the boilerplate's components so a new developer knows what is wired up and
// where to look. The student branch (ST-E01/E02/E03) replaces that stub with a
// real "My courses" list plus a join-by-code control.
import { el } from '../dom.js';
import { badge, emptyState, errorState, eyebrow, loadingState } from '../ui.js';
import { getSession, displayName } from '../auth.js';
import {
  ApiError,
  enrollInCourse,
  getCourseHome,
  listEnrollments,
  type AuthUser,
  type CourseHomeTheme,
  type Enrollment,
} from '../api.js';
import { healthCard } from './health.js';
import { renderMyCourses } from './instructor/courses.js';
import { pageHeader, copyrightFooter } from '../student-ui.js';

/** The user's primary role, used to route to a role-appropriate home (ST-E01).
 * Admin wins, then instructor (faculty affiliation), else student. Phase 1
 * replaces the stub sections below with real views; this split stays. */
export function primaryRole(user: AuthUser): 'admin' | 'instructor' | 'student' {
  if (user.isAdmin) return 'admin';
  if (user.affiliations.includes('faculty')) return 'instructor';
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

/** A single "My Courses" card (Figma screen 1): name, code · term, an
 * Active/Ended badge, an LO-coverage progress bar, and a primary action that
 * reads "Open →" for active courses or "View" for ended ones. */
function courseCard(enrollment: Enrollment, coverage: { covered: number; total: number } | null): HTMLElement {
  const { covered, total } = coverage ?? { covered: 0, total: 0 };
  return el(
    'article',
    { class: 'theme-card' },
    el(
      'div',
      { class: 'course-tile__head' },
      el('h3', { class: 'theme-card__title', text: enrollment.name }),
      badge(enrollment.active ? 'Active' : 'Ended', enrollment.active ? 'up' : 'muted'),
    ),
    el('p', { class: 'theme-card__coverage-label mono', text: `${enrollment.courseCode} · ${enrollment.term}` }),
    el(
      'div',
      { class: 'theme-card__coverage' },
      el('div', { class: 'coverage-bar' }, el('div', { class: 'coverage-bar__fill', style: `width:${total ? (covered / total) * 100 : 0}%` })),
      el('span', { class: 'theme-card__coverage-label mono', text: `${covered}/${total} LOs covered` }),
    ),
    el(
      'a',
      {
        class: `btn btn--sm ${enrollment.active ? 'btn--instr-primary' : 'btn--ghost'}`,
        href: `#/course/${encodeURIComponent(enrollment.courseId)}`,
      },
      enrollment.active ? 'Open →' : 'View',
    ),
  );
}

/** "My courses" (ST-E02/E03, Figma screen 1): a card grid of the student's
 * enrolled courses plus a dashed-border join-by-registration-code box. */
function myCoursesSection(): HTMLElement {
  const body = el('div', {}, loadingState('Loading your courses…'));
  const codeInput = el('input', { class: 'input', type: 'text', placeholder: 'Enter registration code', 'aria-label': 'Registration code' }) as HTMLInputElement;
  const joinError = el('p', {});
  const section = el(
    'div',
    { class: 'view' },
    pageHeader('My Courses', ''),
    body,
    el(
      'div',
      { class: 'join-box' },
      el('p', { class: 'join-box__label', text: 'Enter registration code' }),
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
      const enrollments = await listEnrollments();
      if (enrollments.length === 0) {
        body.replaceChildren(emptyState('You are not enrolled in any courses yet — add one with a registration code below.'));
        return;
      }
      const homes = await Promise.all(
        enrollments.map((e) => getCourseHome(e.courseId).catch(() => null)),
      );
      body.replaceChildren(
        el(
          'div',
          { class: 'theme-grid' },
          ...enrollments.map((enrollment, i) => courseCard(enrollment, homes[i] ? courseCoverage(homes[i] as CourseHomeTheme[]) : null)),
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
      await enrollInCourse(code);
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
    outlet.append(myCoursesSection());
    return;
  }

  // A `faculty`-affiliated user who doesn't (yet) qualify for the full green
  // instructor shell (main.ts's `isInstructor` needs `isAdmin` or an
  // `instructor` courseRole) still lands here with `role === 'instructor'`
  // (see `primaryRole` above). Render My Courses directly rather than the
  // generic "Phase 1 builds this view out" stub — it already owns its own
  // header/empty-state, so it replaces the intro rather than following it
  // (Task 15, Task B).
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
