import {
  ApiError,
  getInstructorWorkflow,
  getQuestionWorkspace,
  restoreCourse,
  updateCourse,
} from '../../api.js';
import { setButtonBusy } from '../../action-state.js';
import { el, mount } from '../../dom.js';
import { statusBadge } from '../../instructor-ui.js';
import { startAnonymousPreview } from '../../preview-session.js';
import { currentQuery, type RouteParams } from '../../router.js';
import { errorState, loadingState } from '../../ui.js';
import { checklistActionFor, openCourseDatesDialog } from './dashboard.js';
import { createTopicReleaseEditor } from './questions-release.js';

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);

function focusSection(section: HTMLElement): void {
  section.scrollIntoView({ block: 'start' });
  section.focus({ preventScroll: true });
}

async function renderPublication(outlet: HTMLElement, courseId: string): Promise<void> {
  const root = el('div', { class: 'view view--course-project course-publication' }, loadingState('Loading release and publishing…'));
  mount(outlet, root);

  const coursePath = `/instructor/course/${encodeURIComponent(courseId)}`;
  const query = currentQuery();
  try {
    const [workflow, workspace] = await Promise.all([
      getInstructorWorkflow(courseId),
      getQuestionWorkspace(courseId, 'approved'),
    ]);
    if (!root.isConnected) return;

    let data = workflow;
    let lifecycle = workflow.course.lifecycle;
    let revision = workflow.course.revision ?? 0;
    let savingRelease = false;
    let updatingCourse = false;
    const checklist = el('ul', { class: 'course-publication__checks' });
    const progress = el('div', { class: 'course-publication__progress', role: 'status' });
    const refreshError = el('div', { role: 'alert' });
    const actionError = el('div', { role: 'alert' });
    const status = el('div', { 'aria-live': 'polite' });
    const releaseIntro = el('p', { class: 'muted course-publication__intro' });
    const publishButton = el('button', { class: 'btn btn--instr-primary', type: 'button' }) as HTMLButtonElement;
    const preview = el('div', { class: 'course-publication__preview' });

    const releaseEditor = createTopicReleaseEditor(
      workspace.release,
      refreshChecklist,
      (busy) => {
        savingRelease = busy;
        publishButton.disabled = busy || updatingCourse;
      },
    );
    const releaseHeading = el('h2', { id: 'topic-release-title', class: 'section-title', text: 'Topic release' });
    const releaseSection = el('section', { class: 'project-panel course-publication__release', tabindex: '-1', 'aria-labelledby': 'topic-release-title' },
      releaseHeading,
      releaseIntro,
      releaseEditor,
    );

    function renderChecklist(): void {
      const { completed, total } = data.readiness;
      mount(progress,
        el('span', { text: `${completed} of ${total} launch checks complete` }),
        el('progress', { 'aria-label': 'Launch checks complete', max: Math.max(total, 1), value: completed }),
      );
      const items = [...data.readiness.checklist].sort((a, b) => Number(a.ok) - Number(b.ok));
      mount(checklist, ...items.map(({ item, ok }) => {
        const [, label = item, details] = /^(.*?) \((?:thin|not yet): ([\s\S]*)\)$/.exec(item) ?? [];
        const action = ok ? undefined : checklistActionFor(label);
        const thin = details && label.startsWith('Every LO');
        const held = details && label.startsWith('Every Topic');
        const count = data.counts.thinLos;
        return el('li', { class: `course-publication__check${ok ? ' is-complete' : ''}` },
          el('span', { class: 'course-publication__mark', 'aria-hidden': 'true', text: ok ? '✓' : '!' }),
          el('div', { class: 'course-publication__check-copy' },
            el('strong', { text: thin ? 'Approved question coverage' : held ? 'Topic release coverage' : label.replace('At least one Theme', 'At least one Topic') }),
            el('span', { class: 'sr-only', text: ok ? 'Complete' : 'Needs attention' }),
            thin || held
              ? el('details', { class: 'course-publication__details' },
                el('summary', { text: thin
                  ? `${count ? `${count} learning objective${count === 1 ? ' has' : 's have'}` : 'Some learning objectives have'} fewer than 3 approved questions`
                  : 'View unreleased Topics' }),
                el('p', { tabindex: '0', text: details }),
              ) : false,
          ),
          action?.command === 'configure-dates'
            ? el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => {
              if (!updatingCourse) openCourseDatesDialog({ ...data, course: { ...data.course, revision } }, () => void refreshChecklist());
            } }, action.text)
            : held || label === 'Every Topic released'
              ? !ok && el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => focusSection(releaseSection) }, 'Manage releases')
              : action
                ? el('a', { class: 'btn btn--ghost btn--sm', href: `#${action.path.replace(':id', encodeURIComponent(courseId))}`, text: action.text })
                : false,
        );
      }));
    }

    function renderPublicationState(): void {
      const published = lifecycle === 'published';
      const archived = lifecycle === 'archived';
      const canPreview = data.counts.approvedQuestions > 0;
      mount(status,
        statusBadge(published ? 'Published' : archived ? 'Archived' : 'Draft', published ? 'approved' : 'neutral'),
        el('p', { text: published
          ? 'Enrolled students can practise approved questions in released Topics during the course term.'
          : archived ? 'Restore this course to draft to continue preparing it.'
            : 'Publishing opens the course to eligible students. Topic release controls when approved questions become available.' }),
      );
      releaseIntro.textContent = published
        ? 'An approved question becomes available when every Topic it belongs to is released.'
        : 'Set release dates before publishing. Students can access released questions after the course opens.';
      publishButton.textContent = archived ? 'Restore course' : published ? 'Return to draft' : 'Publish course';
      const previewCopy = !canPreview
        ? 'Approve at least one question to try the student experience.'
        : data.setup.previewTested ? 'Tested recently.' : 'Check the student experience before launch.';
      mount(preview,
        el('h3', { text: 'Student preview' }),
        el('p', { class: 'muted', text: previewCopy }),
        canPreview
          ? el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => {
            startAnonymousPreview(courseId);
            window.location.hash = `/preview/course/${encodeURIComponent(courseId)}`;
          } }, 'Preview as student')
          : el('a', { class: 'btn btn--ghost btn--sm', href: `#${coursePath}/questions?tab=review`, text: 'Review questions' }),
      );
    }

    let refreshRequest = 0;
    async function refreshChecklist(): Promise<void> {
      const request = ++refreshRequest;
      refreshError.replaceChildren();
      try {
        const current = await getInstructorWorkflow(courseId);
        if (request !== refreshRequest || updatingCourse) return;
        data = current;
        lifecycle = current.course.lifecycle;
        revision = current.course.revision ?? 0;
        renderChecklist();
        renderPublicationState();
      } catch (error) {
        if (request === refreshRequest) mount(refreshError, errorState(`Could not refresh launch checks. ${errorText(error)}`, () => void refreshChecklist()));
      }
    }

    publishButton.addEventListener('click', async () => {
      if (updatingCourse || savingRelease) return;
      updatingCourse = true;
      ++refreshRequest;
      publishButton.disabled = true;
      releaseEditor.disabled = true;
      setButtonBusy(publishButton, true);
      actionError.replaceChildren();
      try {
        const course = lifecycle === 'archived'
          ? await restoreCourse(courseId)
          : await updateCourse(courseId, { published: lifecycle !== 'published' }, revision);
        lifecycle = course.lifecycle ?? (course.published ? 'published' : 'draft');
        revision = course.revision ?? revision + 1;
        renderPublicationState();
      } catch (error) {
        mount(actionError, errorState(errorText(error)));
        if (error instanceof ApiError && error.status === 409) {
          updatingCourse = false;
          await refreshChecklist();
        }
      } finally {
        updatingCourse = false;
        publishButton.disabled = false;
        releaseEditor.disabled = false;
        setButtonBusy(publishButton, false);
      }
    });

    const launchHeading = el('h2', { id: 'launch-checks-title', class: 'section-title', tabindex: '-1', text: 'Launch checklist' });
    const launch = el('section', { class: 'project-panel course-publication__launch', id: 'publish-panel', 'aria-labelledby': 'launch-checks-title' },
      el('header', {}, launchHeading, progress),
      refreshError,
      checklist,
    );
    const controls = el('section', { class: 'project-panel course-publication__controls', 'aria-labelledby': 'publication-title' },
      el('h2', { id: 'publication-title', class: 'section-title', text: 'Course publication' }),
      status,
      actionError,
      publishButton,
      preview,
    );

    renderChecklist();
    renderPublicationState();
    mount(root,
      el('header', { class: 'course-publication__header' },
        el('div', {},
          el('h1', { text: 'Release & Publish' }),
          el('p', { class: 'muted', text: data.course.name }),
        ),
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => focusSection(releaseSection) }, 'Topic release ↓'),
      ),
      el('div', { class: 'course-publication__grid' }, launch, controls),
      releaseSection,
    );

    const topicId = query.get('topic');
    if (topicId) {
      const topic = releaseSection.querySelector<HTMLElement>(`[data-theme-id="${CSS.escape(topicId)}"]`);
      if (topic) {
        topic.scrollIntoView({ block: 'nearest' });
        topic.querySelector<HTMLInputElement>('input:checked')?.focus({ preventScroll: true });
      } else {
        focusSection(releaseSection);
      }
    } else if (query.get('section') === 'release') {
      focusSection(releaseSection);
    } else if (query.get('section') === 'publish') {
      launchHeading.focus({ preventScroll: true });
    }
  } catch (error) {
    mount(root, errorState(errorText(error), () => void renderPublication(outlet, courseId)));
  }
}

export function renderCoursePublication(outlet: HTMLElement, { id }: RouteParams): void {
  void renderPublication(outlet, id);
}
