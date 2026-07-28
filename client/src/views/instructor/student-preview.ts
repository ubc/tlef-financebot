import {
  getCourseTree,
  getNextPreviewQuestion,
  getPreviewCourseHome,
  submitPreviewAttempt,
  type CourseHomeLo,
  type CourseHomeTheme,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { PracticeSession, type TranscriptEntry } from '../../practice-session.js';
import { currentQuery, type RouteParams } from '../../router.js';
import { emptyState, errorState, loadingState } from '../../ui.js';
import {
  makeQuestionCard,
  type PracticeCardAdapter,
  type PracticeCtx,
} from '../student/practice-card.js';

function previewHref(courseId: string, loId?: string): string {
  const base = `#/instructor/course/${encodeURIComponent(courseId)}/preview`;
  return loId ? `${base}?loId=${encodeURIComponent(loId)}` : base;
}

function previewBanner(): HTMLElement {
  return el(
    'div',
    { class: 'banner banner--welcome', role: 'status' },
    el('p', {
      class: 'banner__text',
      text: 'Instructor preview — you are seeing the approved content available to a student now. No student progress, Review Book entries, flags, or analytics will be saved.',
    }),
  );
}

function renderPicker(
  root: HTMLElement,
  courseId: string,
  courseName: string,
  home: CourseHomeTheme[],
): void {
  if (home.length === 0) {
    root.replaceChildren(
      previewBanner(),
      el('h1', { class: 'view__title', text: `${courseName}: Student Preview` }),
      emptyState('No currently available learning objective has an approved question.'),
    );
    return;
  }

  const themes = home.map((group) =>
    el(
      'section',
      { class: 'theme-card' },
      el('h2', { class: 'theme-card__title', text: group.theme.name }),
      el(
        'div',
        { class: 'lo-list' },
        ...group.los.map((entry) =>
          el(
            'a',
            {
              class: 'lo-row',
              href: previewHref(courseId, entry.lo._id),
            },
            el('span', { class: 'lo-row__name', text: entry.lo.name }),
            el(
              'span',
              { class: 'lo-row__meta' },
              el('span', {
                class: 'lo-row__count',
                text: `${entry.approvedCount} approved question${entry.approvedCount === 1 ? '' : 's'} · Preview →`,
              }),
            ),
          ),
        ),
      ),
    ),
  );

  root.replaceChildren(
    previewBanner(),
    el(
      'div',
      { class: 'view__intro' },
      el('p', { class: 'eyebrow', text: 'Student Preview' }),
      el('h1', { class: 'view__title', text: courseName }),
      el('p', {
        class: 'view__subtitle',
        text: 'Choose a currently released learning objective. Unpublished courses are previewable; non-approved questions remain hidden.',
      }),
    ),
    el('div', { class: 'theme-grid' }, ...themes),
  );
}

function transcriptLine(entry: TranscriptEntry): string {
  if (entry.result.correct) return `✓ Option ${entry.selectedKey} — Correct`;
  const correct = entry.result.feedback.revealed.find((option) => option.correct);
  return correct
    ? `✕ Option ${entry.selectedKey} · Correct: Option ${correct.key}`
    : `✕ Option ${entry.selectedKey} · Follow-up retry available`;
}

function runPreview(
  root: HTMLElement,
  courseId: string,
  courseName: string,
  group: CourseHomeTheme,
  lo: CourseHomeLo,
): void {
  const session = new PracticeSession();
  const ctx: PracticeCtx = {
    courseId,
    theme: group.theme,
    los: [lo],
    loIndex: 0,
    isThemeMode: false,
    mode: 'topic-practice',
  };
  const transcript = el('div', { class: 'transcript' });
  const questionSlot = el('div', {});
  const adapter: PracticeCardAdapter = {
    submit: (input) => submitPreviewAttempt(courseId, input),
    updatesMastery: false,
  };

  const refreshTranscript = (): void => {
    transcript.replaceChildren(
      ...session.transcript.map((entry, index) =>
        el(
          'div',
          {
            class: `transcript__entry transcript__entry--${entry.result.correct ? 'correct' : 'incorrect'}`,
          },
          el(
            'div',
            { class: 'transcript__head' },
            el('span', { class: 'transcript__qlabel mono', text: `Q${index + 1}` }),
            el('span', {
              class: 'transcript__stem',
              text: entry.question.stem.replace(/[#*`$]/g, '').slice(0, 90),
            }),
          ),
          el('p', { class: 'transcript__result', text: transcriptLine(entry) }),
        ),
      ),
    );
  };

  const renderRoundSummary = (): void => {
    const answered = session.roundTranscript.length;
    const correct = session.roundTranscript.filter((entry) => entry.result.correct).length;
    questionSlot.replaceChildren(
      el(
        'section',
        { class: 'practice-round-summary' },
        el('p', { class: 'eyebrow', text: 'Preview round complete' }),
        el('h2', { text: 'You have seen every approved question for this learning objective.' }),
        el('p', { class: 'muted', text: `${answered} answered · ${correct} correct` }),
        el(
          'div',
          { class: 'row' },
          el(
            'button',
            {
              class: 'btn btn--primary',
              type: 'button',
              onclick: () => {
                session.startNextRound();
                void loadQuestion();
              },
            },
            'Continue with repeats',
          ),
          el('a', { class: 'btn btn--ghost', href: previewHref(courseId) }, 'Choose another LO'),
        ),
      ),
    );
  };

  const loadQuestion = async (): Promise<void> => {
    questionSlot.replaceChildren(loadingState('Loading preview question…'));
    try {
      const question = await getNextPreviewQuestion(courseId, {
        loId: lo.lo._id,
        sessionServedIds: session.sessionServedIds,
      });
      if (session.hasServed(question.questionId)) {
        renderRoundSummary();
        return;
      }
      session.recordServed(question);
      questionSlot.replaceChildren(
        makeQuestionCard(
          ctx,
          session,
          question,
          {
            onTranscriptChange: refreshTranscript,
            onNext: () => void loadQuestion(),
            onAdvanceLo: () => {
              window.location.hash = previewHref(courseId).replace(/^#/, '');
            },
            onSkip: () => {
              window.location.hash = previewHref(courseId).replace(/^#/, '');
            },
          },
          false,
          adapter,
        ),
      );
    } catch (error) {
      questionSlot.replaceChildren(errorState((error as Error).message, () => void loadQuestion()));
    }
  };

  root.replaceChildren(
    previewBanner(),
    el(
      'div',
      { class: 'view__intro practice-header' },
      el('a', { class: 'btn btn--ghost btn--sm', href: previewHref(courseId) }, '← All preview topics'),
      el('p', { class: 'eyebrow', text: `${courseName} · ${group.theme.name}` }),
      el('h1', { class: 'view__title', text: lo.lo.name }),
    ),
    transcript,
    questionSlot,
  );
  void loadQuestion();
}

export async function renderStudentPreview(outlet: HTMLElement, params: RouteParams): Promise<void> {
  const courseId = params.id;
  const root = el('div', { class: 'view' }, previewBanner(), loadingState('Loading student preview…'));
  mount(outlet, root);

  try {
    const [home, tree] = await Promise.all([
      getPreviewCourseHome(courseId),
      getCourseTree(courseId),
    ]);
    const loId = currentQuery().get('loId');
    if (!loId) {
      renderPicker(root, courseId, tree.course.name, home);
      return;
    }

    const group = home.find((candidate) =>
      candidate.los.some((entry) => entry.lo._id === loId),
    );
    const lo = group?.los.find((entry) => entry.lo._id === loId);
    if (!group || !lo) {
      root.replaceChildren(
        previewBanner(),
        emptyState('This learning objective is not currently available in student preview.'),
        el('a', { class: 'btn btn--ghost', href: previewHref(courseId) }, 'Back to preview topics'),
      );
      return;
    }
    runPreview(root, courseId, tree.course.name, group, lo);
  } catch (error) {
    root.replaceChildren(
      previewBanner(),
      errorState((error as Error).message, () => void renderStudentPreview(outlet, params)),
    );
  }
}
