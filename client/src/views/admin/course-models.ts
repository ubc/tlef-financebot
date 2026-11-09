import { ApiError, COURSE_MODEL_STEPS, getAdminCourseModels, listAdminCourses, saveAdminCourseModels,
  type AdminCourseModels, type AdminCourseOption, type CourseModelStep } from '../../api.js';
import { courseCard } from '../../course-card.js';
import { el } from '../../dom.js';
import { confirmDialog } from '../../modal.js';
import { errorState, loadingState } from '../../ui.js';

function normalizeCourseSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export function createCourseModelsPanel(labels: Record<CourseModelStep, string>) {
  const body = el('div');
  const status = el('p', { class: 'form-status', role: 'status' });
  const search = el('input', { class: 'input', type: 'search', placeholder: 'e.g. PHYS 100 or Jane Smith',
    'aria-describedby': 'course-model-search-status', disabled: true });
  const searchStatus = el('small', { class: 'muted', id: 'course-model-search-status', role: 'status' });
  const results = el('div', { class: 'ac-course-model-results' });
  const catalog = el('div', {},
    el('header', { class: 'ac-config-intro' }, el('div', {},
      el('h2', { text: 'Course models' }),
      el('p', { text: 'Find a course and open its model settings.' }),
    )),
    el('div', { class: 'ac-course-model-picker' },
      el('label', {}, el('strong', { text: 'Search by course or instructor' }), search),
      searchStatus, results),
  );
  const back = el('button', { class: 'btn btn--secondary', type: 'button', text: '← Back to courses', onclick: closeCourse });
  const title = el('h2', { tabindex: -1 });
  const identity = el('p');
  const detail = el('div', { hidden: true },
    el('header', { class: 'ac-config-intro ac-course-model-detail' },
      back, title, identity,
      el('p', { text: 'Inherited stages follow Platform Settings.' }),
    ), body, status,
  );
  const root = el('div', { class: 'ac-config-pane' }, catalog, detail);
  let courses: AdminCourseOption[] = [];
  let courseId = '';
  let selectedCard: HTMLElement | undefined;
  let saved: AdminCourseModels | undefined;
  let draft: AdminCourseModels['overrides'] = {};
  let pending = false;
  let loading = 0;
  const changes = () => COURSE_MODEL_STEPS.filter(step => draft[step] !== saved?.overrides[step]);
  const courseLabel = (course: AdminCourseOption) => [
    course.courseCode, course.section && `Section ${course.section}`, course.term, course.name,
    course.owner?.displayName,
    course.lifecycle === 'archived' ? 'Archived' : '',
  ].filter(Boolean).join(' · ');

  function refreshCourseResults(): void {
    const terms = normalizeCourseSearch(search.value).trim().split(/\s+/).filter(Boolean);
    const matches = courses.filter(course => {
      const searchable = normalizeCourseSearch(`${courseLabel(course)} ${course.courseCode.replace(/\s+/g, '')}`);
      return terms.every(term => searchable.includes(term));
    });
    results.replaceChildren(...matches.map(course => courseCard({
      courseCode: course.courseCode, name: course.name, term: course.term, section: course.section,
      instructor: course.owner?.displayName ?? 'Unknown instructor',
      status: course.lifecycle === 'published' ? { label: 'Published', variant: 'approved' }
        : course.lifecycle === 'archived' ? { label: 'Archived', variant: 'archived' }
        : { label: 'Sandbox', variant: 'neutral' },
      actionLabel: 'Model settings →',
      onSelect: event => {
        selectedCard = event.currentTarget as HTMLElement;
        catalog.hidden = true;
        detail.hidden = false;
        title.textContent = `${course.courseCode} · ${course.name}`;
        identity.textContent = [course.term, course.section && `Section ${course.section}`,
          `Instructor: ${course.owner?.displayName ?? 'Unknown instructor'}`].filter(Boolean).join(' · ');
        title.focus();
        void load(course._id);
      },
    })));
    const count = `${matches.length} ${matches.length === 1 ? 'course' : 'courses'}`;
    searchStatus.textContent = terms.length
      ? matches.length ? `${count} found` : 'No courses match your search.'
      : courses.length ? `${count} available` : 'No courses available.';
  }

  search.oninput = refreshCourseResults;

  async function loadCourses(): Promise<void> {
    search.disabled = true;
    results.replaceChildren(loadingState('Loading courses…'));
    try {
      courses = await listAdminCourses();
      search.disabled = courses.length === 0;
      refreshCourseResults();
    } catch {
      results.replaceChildren(errorState('Unable to load courses.', () => { void loadCourses(); }));
    }
  }

  async function load(id: string): Promise<void> {
    const request = ++loading;
    courseId = id;
    saved = undefined;
    draft = {};
    status.textContent = '';
    body.replaceChildren(loadingState('Loading course models…'));
    try {
      const response = await getAdminCourseModels(id);
      if (request !== loading) return;
      saved = response;
      draft = { ...response.overrides };
      render();
    } catch {
      if (request === loading) body.replaceChildren(errorState('Unable to load this course’s model settings.', () => { void load(id); }));
    }
  }

  async function closeCourse(): Promise<void> {
    if (pending) return;
    if (changes().length && !await confirmDialog({
      title: 'Discard course model changes?',
      message: 'Going back will discard the unsaved model choices for this course.',
      confirmLabel: 'Discard and go back',
      cancelLabel: 'Keep editing',
    })) return;
    ++loading;
    courseId = '';
    saved = undefined;
    draft = {};
    body.replaceChildren();
    status.textContent = '';
    detail.hidden = true;
    catalog.hidden = false;
    (selectedCard ?? search).focus();
    selectedCard = undefined;
  }

  function render(): void {
    if (!saved) return;
    const config = saved;
    const reset = el('button', { class: 'btn btn--secondary', type: 'button', text: 'Discard', disabled: pending || !changes().length,
      onclick: () => { draft = { ...config.overrides }; status.textContent = ''; render(); } });
    const save = el('button', { class: 'btn btn--primary', type: 'button', text: 'Review course changes', disabled: pending || !changes().length, onclick: () => commit() });
    const rows = COURSE_MODEL_STEPS.map(step => {
      const choice = draft[step];
      const modelIds = [...new Set([...config.availableModels, ...(choice ? [choice] : []), ...(config.overrides[step] ? [config.overrides[step]] : [])])].sort();
      const select = el('select', { class: 'input', id: `course-model-${step}`, 'aria-label': `${labels[step]} course model`, disabled: pending },
        el('option', { value: '', text: `Inherit platform · ${config.platformModels[step].model}` }),
        ...modelIds.map(model => el('option', { value: model, text: model })));
      select.value = choice ?? '';
      select.onchange = () => {
        if (select.value) draft[step] = select.value;
        else delete draft[step];
        status.textContent = '';
        save.disabled = reset.disabled = !changes().length;
      };
      const savedSource = config.overrides[step] ? 'Course override' : 'Inherited';
      return el('label', { class: 'ac-config-setting ac-course-model-setting' },
        el('span', {}, el('strong', { text: labels[step] }),
          el('small', { text: `Currently ${config.effectiveModels[step].model} · ${savedSource}` })),
        select);
    });
    back.disabled = pending;
    body.replaceChildren(
      el('div', { class: 'ac-config-setting-list' }, ...rows),
      el('footer', { class: 'ac-course-model-footer' },
        el('p', { class: 'ac-note', text: 'The course keeps compatible platform parameters for the chosen model. The reserved Mastery evaluator has no course setting.' }),
        el('div', { class: 'ac-actions' }, reset, save),
      ),
    );
  }

  async function commit(): Promise<void> {
    if (!saved || pending || !changes().length) return;
    const config = saved;
    const id = courseId;
    const course = courses.find(item => item._id === id);
    pending = true;
    render();
    try {
      const approved = await confirmDialog({
        title: 'Save course model choices?',
        message: [
          course ? courseLabel(course) : '',
          ...changes().map(step => `${labels[step]} → ${draft[step] ?? `Inherit platform (${config.platformModels[step].model})`}`),
        ].join('\n'),
        confirmLabel: 'Save course models',
      });
      if (!approved || !root.isConnected) return;
      const response = await saveAdminCourseModels(id, config.revision, draft);
      saved = response;
      draft = { ...response.overrides };
      status.textContent = 'Course model choices saved.';
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        status.replaceChildren('Another administrator changed these settings. ', el('button', {
          class: 'btn btn--ghost', type: 'button', text: 'Reload course models', onclick: async () => {
            if (await confirmDialog({ title: 'Reload course models?', message: 'Reloading discards your unsaved choices.', confirmLabel: 'Reload' })) await load(id);
          },
        }));
      } else status.textContent = 'Unable to save course models. Your choices are still here.';
    } finally {
      pending = false;
      render();
      root.querySelector<HTMLSelectElement>('#course-model-generator')?.focus();
    }
  }

  void loadCourses();
  return { root, dirty: () => changes().length > 0, pending: () => pending };
}
