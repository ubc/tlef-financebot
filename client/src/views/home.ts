// Overview page (the app's home). A short welcome, live system status, and a map
// of the boilerplate's components so a new developer knows what is wired up and
// where to look. The student branch (ST-E01/E02/E03) replaces that stub with a
// real "My courses" list plus a join-by-code control.
import { el } from '../dom.js';
import { emptyState, errorState, eyebrow, loadingState } from '../ui.js';
import { getSession, displayName } from '../auth.js';
import { ApiError, enrollInCourse, listEnrollments, type AuthUser, type Enrollment } from '../api.js';
import { healthCard } from './health.js';

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

function courseRow(enrollment: Enrollment): HTMLElement {
  return el(
    'a',
    { class: 'class-row class-row--link', href: `#/course/${encodeURIComponent(enrollment.courseId)}` },
    el(
      'span',
      { class: 'class-row__main' },
      el('span', { class: 'class-row__code mono', text: enrollment.courseCode }),
      el('span', { class: 'class-row__title', text: enrollment.name }),
    ),
    el(
      'span',
      { class: 'class-row__meta' },
      el('span', { class: 'mono', text: enrollment.term }),
      !enrollment.active ? el('span', { class: 'badge badge--muted', text: 'ENDED' }) : false,
    ),
  );
}

/** "My courses" (ST-E02/E03): the student's enrolled courses plus a
 * join-by-registration-code control. */
function myCoursesCard(): HTMLElement {
  const body = el('div', { class: 'card__body' }, loadingState('Loading your courses…'));
  const codeInput = el('input', { class: 'input', type: 'text', placeholder: 'Registration code', 'aria-label': 'Registration code' }) as HTMLInputElement;
  const joinError = el('p', {});
  const card = el(
    'section',
    { class: 'card' },
    el('div', { class: 'card__head' }, el('div', {}, eyebrow('Student'), el('h2', { class: 'card__title', text: 'My courses' }))),
    body,
    el(
      'div',
      { class: 'card__body' },
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
        el('button', { class: 'btn btn--primary btn--sm', type: 'submit' }, 'Add a course'),
      ),
      joinError,
    ),
  );

  const load = async (): Promise<void> => {
    body.replaceChildren(loadingState('Loading your courses…'));
    try {
      const enrollments = await listEnrollments();
      body.replaceChildren(
        enrollments.length
          ? el('div', {}, ...enrollments.map(courseRow))
          : emptyState('You are not enrolled in any courses yet — add one with a registration code below.'),
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
  return card;
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
    outlet.append(el('div', { class: 'view view--overview' }, intro, myCoursesCard()));
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
