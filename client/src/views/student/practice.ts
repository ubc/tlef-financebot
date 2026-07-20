// Single-question practice view (ST-P04/P06 + retry-in-place): resolves the
// LO/theme to practice from the route, then runs a serve → submit → next
// loop with a scrollable transcript above the live question. Handles both
// `/practice/:loId` (a single LO) and `/practice-theme/:themeId` (walks the
// theme's LOs in order, starting from the first not-yet-covered one). Card
// rendering (selectable options, lock/reveal, retry-in-place) lives in
// practice-card.ts to keep this file focused on the LO-walking loop.
//
// Skip/End-Session are no longer rendered here (Task 3) — this view still
// owns `doSkip` and `endSessionHref` but hands them to the persistent
// student shell's sidebar context panel via `setPracticeActions()`
// (practice-actions.ts), called on every render that changes what the
// panel should show. `clearPracticeActions()` is not needed for
// correctness: the shell only reads `getPracticeActions()` while
// `isPracticePath(currentPath)` is true (main.ts), so a stale hand-off
// object is simply never looked at once the student navigates away.
import {
  getCourseHome,
  getNextPracticeQuestion,
  listEnrollments,
  skipLo,
  type CourseHomeLo,
  type CourseHomeTheme,
  type PracticeMode,
} from '../../api.js';
import { PracticeSession, type TranscriptEntry } from '../../practice-session.js';
import { el } from '../../dom.js';
import { emptyState, errorState, loadingState } from '../../ui.js';
import { currentQuery } from '../../router.js';
import type { RouteParams } from '../../router.js';
import { breadcrumb, copyrightFooter } from '../../student-ui.js';
import { setPracticeActions } from '../../practice-actions.js';
import { currentLo, makeQuestionCard, type PracticeCtx } from './practice-card.js';

const STATUS_LABELS: Record<string, string> = {
  'not-attempted': 'Not attempted',
  'in-progress': 'In progress',
  covered: 'Covered',
  struggling: 'Struggling',
};

function runPracticeLoop(root: HTMLElement, courseName: string, ctx: PracticeCtx, session: PracticeSession): void {
  const backHref = `#/course/${encodeURIComponent(ctx.courseId)}/theme/${encodeURIComponent(ctx.theme._id)}`;
  const endSessionHref = `#/course/${encodeURIComponent(ctx.courseId)}/summary?since=${encodeURIComponent(session.startedAt.toISOString())}`;

  const breadcrumbSlot = el('div', {});
  const title = el('h1', { class: 'view__title', text: currentLo(ctx).lo.name });
  const header = el(
    'div',
    { class: 'view__intro practice-header' },
    breadcrumbSlot,
    el(
      'div',
      { class: 'row practice-header__row' },
      title,
      el(
        'a',
        { class: 'btn btn--ghost btn--sm', href: `#/course/${encodeURIComponent(ctx.courseId)}/summary` },
        'Session Summary →',
      ),
    ),
  );
  const transcriptEl = el('div', { class: 'transcript' });
  const questionSlot = el('div', {});
  root.replaceChildren(header, transcriptEl, questionSlot, copyrightFooter());

  const refreshBreadcrumb = (): void => {
    breadcrumbSlot.replaceChildren(
      breadcrumb([courseName, ctx.theme.name, `LO ${ctx.loIndex + 1}: ${currentLo(ctx).lo.name}`]),
    );
  };

  // The shell's sidebar hand-off — called on every render that changes the
  // topic/LO/status/answered/correct/onSkip/endSessionHref it shows.
  const refreshActions = (): void => {
    setPracticeActions({
      topicName: ctx.theme.name,
      loName: currentLo(ctx).lo.name,
      statusLabel: STATUS_LABELS[currentLo(ctx).status] ?? currentLo(ctx).status,
      answered: session.transcript.length,
      correct: session.transcript.filter((entry) => entry.result.correct).length,
      onSkip: () => void doSkip(),
      endSessionHref,
    });
  };

  const resultLine = (entry: TranscriptEntry): string => {
    // Never infer the correct option — only render what the API response's
    // `revealed` array actually contains. A full reveal (correct answer, or
    // a miss under Strategy B / a degraded Strategy A with no retry left)
    // includes an entry with `correct: true`; a live Strategy-A retry-gated
    // miss reveals only the chosen option, so no such entry exists and the
    // summary must stay narrower.
    if (entry.result.correct) return `✓ You answered: Option ${entry.selectedKey} (Correct)`;
    const correctReveal = entry.result.feedback.revealed.find((r) => r.correct);
    if (correctReveal) return `✕ You answered: Option ${entry.selectedKey} · Correct: Option ${correctReveal.key}`;
    return `✕ You answered: Option ${entry.selectedKey} — retry the follow-up question above to see more`;
  };

  const refreshTranscript = (): void => {
    transcriptEl.replaceChildren(
      ...session.transcript.map((entry, i) =>
        el(
          'div',
          { class: `transcript__entry transcript__entry--${entry.result.correct ? 'correct' : 'incorrect'}` },
          el(
            'div',
            { class: 'transcript__head' },
            el('span', { class: 'transcript__qlabel mono', text: `Q${i + 1}` }),
            el('span', { class: 'transcript__stem', text: entry.question.stem.replace(/[#*`$]/g, '').slice(0, 90) }),
          ),
          el('p', { class: 'transcript__result', text: resultLine(entry) }),
          el(
            'a',
            {
              class: 'btn btn--ghost btn--sm',
              href: `#/course/${encodeURIComponent(ctx.courseId)}/practice/${encodeURIComponent(entry.loId)}`,
            },
            'Practice this LO more',
          ),
        ),
      ),
    );
    refreshActions();
  };

  const advanceLo = (): void => {
    if (ctx.isThemeMode && ctx.loIndex + 1 < ctx.los.length) {
      ctx.loIndex += 1;
      session.resetAttemptedFlag();
      title.textContent = currentLo(ctx).lo.name;
      refreshBreadcrumb();
      refreshActions();
      void loadQuestion();
    } else {
      window.location.hash = backHref.replace(/^#/, '');
    }
  };

  const doSkip = async (): Promise<void> => {
    try {
      await skipLo(ctx.courseId, currentLo(ctx).lo._id, session.hasAttemptedCurrentLo);
      advanceLo();
    } catch (error) {
      questionSlot.replaceChildren(errorState((error as Error).message, () => void doSkip()));
    }
  };

  const loadQuestion = async (): Promise<void> => {
    questionSlot.replaceChildren(loadingState('Loading next question…'));
    try {
      const question = await getNextPracticeQuestion(ctx.courseId, {
        loId: currentLo(ctx).lo._id,
        sessionServedIds: session.sessionServedIds,
      });
      session.recordServed(question);
      questionSlot.replaceChildren(
        makeQuestionCard(ctx, session, question, {
          onTranscriptChange: refreshTranscript,
          onNext: () => void loadQuestion(),
          onAdvanceLo: advanceLo,
          onSkip: () => void doSkip(),
        }),
      );
    } catch (error) {
      questionSlot.replaceChildren(errorState((error as Error).message, () => void loadQuestion()));
    }
  };

  refreshBreadcrumb();
  refreshActions();
  void loadQuestion();
}

export async function renderPractice(outlet: HTMLElement, params: RouteParams): Promise<void> {
  const courseId = params.id;
  const isThemeMode = params.themeId !== undefined;
  const mode: PracticeMode = currentQuery().get('mode') === 'review-book' ? 'review-book' : 'topic-practice';

  const root = el('div', { class: 'view' }, loadingState('Loading practice…'));
  outlet.append(root);

  try {
    const [home, enrollments] = await Promise.all([getCourseHome(courseId), listEnrollments()]);
    const courseName = enrollments.find((e) => e.courseId === courseId)?.name ?? 'Course';

    if (isThemeMode) {
      const group = home.find((g) => g.theme._id === params.themeId);
      if (!group || group.los.length === 0) {
        root.replaceChildren(emptyState('This theme has no learning objectives to practice yet.'));
        return;
      }
      const los = [...group.los].sort((a, b) => a.lo.order - b.lo.order);
      const startIdx = los.findIndex((l) => l.status !== 'covered');
      const ctx: PracticeCtx = { courseId, theme: group.theme, los, loIndex: startIdx === -1 ? 0 : startIdx, isThemeMode: true, mode };
      runPracticeLoop(root, courseName, ctx, new PracticeSession());
      return;
    }

    let found: { theme: CourseHomeTheme['theme']; lo: CourseHomeLo } | undefined;
    for (const group of home) {
      const lo = group.los.find((l) => l.lo._id === params.loId);
      if (lo) {
        found = { theme: group.theme, lo };
        break;
      }
    }
    if (!found) {
      root.replaceChildren(emptyState('This learning objective is not available to practice.'));
      return;
    }
    const ctx: PracticeCtx = { courseId, theme: found.theme, los: [found.lo], loIndex: 0, isThemeMode: false, mode };
    runPracticeLoop(root, courseName, ctx, new PracticeSession());
  } catch (error) {
    root.replaceChildren(errorState((error as Error).message, () => void renderPractice(outlet, params)));
  }
}
