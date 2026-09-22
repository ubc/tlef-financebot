import {
  listEnrollments, getCourseHome, listInstructorCourses, getCourseOutline, getExamHistory, getMyCourseCapabilities,
  type TutorialRole,
} from '../api.js';
import { getSession } from '../auth.js';
import { el, mount } from '../dom.js';
import { confirmDialog } from '../modal.js';
import { setButtonBusy } from '../action-state.js';
import { currentQuery, type RouteParams } from '../router.js';
import { errorState, loadingState } from '../ui.js';
import { loadTutorials, replayTutorialAt, resetTutorials, tutorialRole, TUTORIAL_DEFINITIONS } from '../tutorials.js';

interface HelpCourse { id: string; name: string; active: boolean }
interface Destination { href?: string; reason?: string; label?: string }

async function coursesFor(role: TutorialRole): Promise<HelpCourse[]> {
  if (role === 'admin') return [];
  if (role === 'student') return (await listEnrollments()).map((course) => ({ id: course.courseId, name: `${course.courseCode} · ${course.name}`, active: course.active }));
  if (role === 'instructor') return (await listInstructorCourses()).map((course) => ({ id: course._id, name: `${course.courseCode} · ${course.name}`, active: course.lifecycle !== 'archived' }));
  const roles = getSession().user?.courseRoles.filter((item) => item.role === 'ta') ?? [];
  const outlines = await Promise.allSettled(roles.map((item) => getCourseOutline(item.courseId)));
  return outlines.flatMap((result, index) => result.status === 'fulfilled' ? [{ id: roles[index].courseId, name: `${result.value.course.courseCode} · ${result.value.course.name}`, active: true }] : [{ id: roles[index].courseId, name: `Assigned course ${index + 1}`, active: true }]);
}
async function destinationsFor(role: TutorialRole, course?: HelpCourse): Promise<Record<string, Destination>> {
  const destinations: Record<string, Destination> = {};
  for (const definition of TUTORIAL_DEFINITIONS.filter((item) => item.role === role)) {
    destinations[definition.id] = role === 'admin' ? { href: `#/admin/${definition.path}` }
      : definition.id === 'instructor-welcome' ? { href: '#/instructor/courses' }
      : definition.id === 'student-welcome' ? { href: '#/' }
      : !course ? { reason: role === 'student' ? 'Join a course to use this tutorial.' : 'Select an accessible course to use this tutorial.' }
      : { href: `#/${role === 'student' ? '' : `${role}/`}course/${encodeURIComponent(course.id)}${definition.path ? `/${definition.path}` : ''}` };
  }
  if (role === 'ta') destinations['ta-courses'] = { href: '#/ta/courses' };
  if (!course) return destinations;
  if (role === 'instructor') destinations['instructor-question-editor'] = { href: `#/instructor/course/${encodeURIComponent(course.id)}/bank`, label: 'Open question bank', reason: 'Choose an existing question; its tutorial begins after the editor loads.' };
  if (role === 'instructor') destinations['instructor-collaboration'] = { href: `#/instructor/course/${encodeURIComponent(course.id)}/bank`, label: 'Open question bank', reason: 'Choose an existing question, then select Edit together to begin this walkthrough.' };
  if (role === 'instructor') destinations['instructor-parameters'] = { href: `#/instructor/course/${encodeURIComponent(course.id)}/bank`, label: 'Open question bank', reason: 'Choose a parameterized question, then open Parameters to begin this walkthrough.' };
  if (role === 'ta') destinations['ta-question-review'] = { href: `#/ta/course/${encodeURIComponent(course.id)}/review`, label: 'Open review queue', reason: 'Choose an existing question; its tutorial begins after the detail loads.' };
  if (role === 'ta') {
    const permissions = await getMyCourseCapabilities(course.id);
    if (!permissions['question.review']) for (const id of ['ta-review', 'ta-question-review']) destinations[id] = { reason: 'Question review is unavailable in this course. Ask your Instructor about course permissions.' };
    if (!permissions['flag.triage']) destinations['ta-flags'] = { reason: 'Flag triage is unavailable in this course. Ask your Instructor about course permissions.' };
  }
  if (role !== 'student') return destinations;
  const base = `#/course/${encodeURIComponent(course.id)}`;
  const home = course.active ? await getCourseHome(course.id).catch(() => []) : [];
  const topic = home.find((item) => item.los.some((entry) => entry.approvedCount > 0));
  const lo = topic?.los.find((entry) => entry.approvedCount > 0);
  const reason = !course.active ? 'This course is not currently open for practice. Select an active course.' : 'No practice-ready Learning Objective is available in this course.';
  destinations['student-topics'] = topic ? { href: `${base}/theme/${encodeURIComponent(topic.theme._id)}` } : { reason };
  destinations['student-practice'] = lo ? { href: `${base}/practice/${encodeURIComponent(lo.lo._id)}` } : { reason };
  destinations['student-feedback'] = lo ? { href: `${base}/practice/${encodeURIComponent(lo.lo._id)}`, label: 'Open practice', reason: 'Answer a question to open feedback help.' } : { reason };
  destinations['student-session-summary'] = { href: `${base}/summary`, label: 'Open Session Summary', reason: 'The tutorial is available when you have a saved session summary.' };
  const history = await getExamHistory(course.id).catch(() => []);
  destinations['student-exam-results'] = history.length ? { href: `${base}/exam-attempt/${encodeURIComponent(history[0].attemptId)}/results` }
    : { href: `${base}/exam-history`, label: 'Open exam history', reason: 'Complete a sitting to review your results.' };
  if (!course.active) for (const id of ['student-course-home', 'student-exam-prep']) destinations[id] = { reason };
  return destinations;
}

/** Shared optional product help. Role progress never changes consent or permissions. */
export async function renderTutorialHelp(outlet: HTMLElement, params: RouteParams = {}): Promise<void> {
  const role = tutorialRole();
  const identity = JSON.stringify(getSession().user);
  const root = el('section', { class: 'admin-workbench tutorial-help' }, loadingState('Loading tutorials…'));
  outlet.append(root);
  if (!role) { root.replaceChildren(el('p', { text: 'Use the role menu to return to your primary workspace and its tutorials.' })); return; }
  let generation = 0;
  const fresh = (): boolean => root.isConnected && tutorialRole() === role && JSON.stringify(getSession().user) === identity;
  try {
    const courses = await coursesFor(role);
    if (!fresh()) return;
    const preferred = params.id ?? currentQuery().get('courseId');
    let selected: HelpCourse | undefined = courses.find((course) => course.id === preferred) ?? courses.find((course) => course.active) ?? courses[0];
    const render = async (): Promise<void> => {
      const version = ++generation;
      const [tutorials, destinations] = await Promise.all([loadTutorials(role, true), destinationsFor(role, selected)]);
      if (!fresh() || version !== generation) return;
      const picker = el('select', { class: 'input', 'aria-label': 'Tutorial course' }, ...courses.map((course) => el('option', { value: course.id, selected: selected?.id === course.id ? 'selected' : undefined, text: `${course.name}${course.active ? '' : ' (inactive)'}` }))) as HTMLSelectElement;
      picker.addEventListener('change', () => { selected = courses.find((course) => course.id === picker.value); void render().catch(showError); });
      const reset = el('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, `Reset ${role} tutorials`);
      reset.addEventListener('click', async () => {
        if (reset.getAttribute('aria-busy') === 'true') return;
        if (!await confirmDialog({ title: 'Reset tutorial progress?', message: `Your ${role} walkthroughs will become available as new. Course content is unaffected.`, confirmLabel: 'Reset progress' })) return;
        setButtonBusy(reset, true);
        void resetTutorials(role).then(render).catch(showError).finally(() => setButtonBusy(reset, false));
      });
      const grid = el('div', { class: 'help-lesson-grid' });
      const search = el('input', { class: 'input help-search', type: 'search', placeholder: 'Search a task, e.g. release questions', 'aria-label': 'Search tutorials' }) as HTMLInputElement;
      const renderCards = (): void => {
        const term = search.value.trim().toLowerCase();
        const matches = tutorials.filter(tutorial => `${tutorial.title} ${tutorial.description}`.toLowerCase().includes(term));
        grid.replaceChildren(...matches.map(tutorial => {
          const destination = destinations[tutorial.id] ?? { reason: 'Open the relevant page to use this tutorial.' };
          const button = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: destination.href ? undefined : 'disabled' }, destination.label ?? (tutorial.status === 'not-viewed' ? 'Start walkthrough' : 'Replay walkthrough'));
          button.addEventListener('click', () => { if (destination.href && fresh()) replayTutorialAt(tutorial.id, destination.href); });
          return el('article', { class: 'admin-panel help-lesson' },
            el('small', { class: 'admin-eyebrow', text: `${role} · About ${tutorial.estimatedSeconds} seconds` }),
            el('h3', { text: tutorial.title }), el('p', { class: 'muted', text: tutorial.description }),
            el('small', { class: 'admin-status', text: tutorial.status === 'completed' ? 'Completed' : tutorial.status === 'dismissed' ? 'Skipped' : 'Not viewed' }),
            destination.reason ? el('p', { class: 'help-unavailable', text: destination.reason }) : false, button);
        }));
        if (!matches.length) grid.append(el('div', { class: 'admin-panel admin-empty' }, el('h3', { text: 'No matching tutorials' }), el('p', { text: 'Try a shorter search or browse all walkthroughs for your role.' }), el('button', { class: 'btn btn--ghost', type: 'button', text: 'Show all tutorials', onclick: () => { search.value = ''; renderCards(); search.focus(); } })));
      };
      search.addEventListener('input', renderCards);
      mount(root,
        el('div', { class: 'admin-heading' }, el('div', {}, el('h2', { class: 'help-title', text: 'Help & Tutorials' }), el('p', { class: 'admin-fine', text: 'Short walkthroughs for the task in front of you.' })), reset),
        el('div', { class: 'help-welcome' }, el('div', {}, el('small', { class: 'admin-eyebrow', text: `Your ${role} guide` }), el('h3', { text: 'What would you like to do?' }), el('p', { text: 'Pick a task. Learn the essentials in a few steps, then return to your course.' })),
          courses.length ? el('label', { class: 'form-field' }, el('span', { text: 'Course for tutorials' }), picker) : false),
        search,
        el('div', { class: 'admin-subhead' }, el('h3', { text: `${role[0].toUpperCase()}${role.slice(1)} tutorials` }), el('small', { text: `${tutorials.filter(t => t.status === 'completed').length} of ${tutorials.length} completed · Replay anytime` })), grid,
        role === 'instructor' && selected ? el('aside', { class: 'help-context' }, el('h3', { text: 'More course help' }),
          ...[['structure', 'Open course structure'], ['flags', 'Open flag queue'], ['tas', 'Manage teaching team']].map(([path, label]) => el('a', { class: 'btn btn--ghost btn--sm', href: `#/instructor/course/${encodeURIComponent(selected!.id)}/${path}`, text: label }))) : false);
      renderCards();
    };
    const showError = (error: unknown): void => { if (fresh()) root.replaceChildren(errorState((error as Error).message, () => void render().catch(showError))); };
    await render();
  } catch (error) {
    if (fresh()) root.replaceChildren(errorState((error as Error).message, () => {
      if (!fresh()) return;
      root.remove();
      void renderTutorialHelp(outlet, params);
    }));
  }
}
