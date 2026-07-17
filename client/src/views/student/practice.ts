// Single-question practice view (ST-P04/P06 + retry-in-place): resolves the
// LO/theme to practice from the route, then runs a serve → submit → next
// loop with a scrollable transcript above the live question. Handles both
// `/practice/:loId` (a single LO) and `/practice-theme/:themeId` (walks the
// theme's LOs in order, starting from the first not-yet-covered one). Card
// rendering (selectable options, lock/reveal, retry-in-place) lives in
// practice-card.ts to keep this file focused on the LO-walking loop.
import { getCourseHome, getNextPracticeQuestion, skipLo, type CourseHomeLo, type CourseHomeTheme, type PracticeMode } from '../../api.js';
import { PracticeSession } from '../../practice-session.js';
import { el } from '../../dom.js';
import { emptyState, errorState, eyebrow, loadingState } from '../../ui.js';
import { currentQuery } from '../../router.js';
import type { RouteParams } from '../../router.js';
import { currentLo, makeQuestionCard, type PracticeCtx } from './practice-card.js';

function runPracticeLoop(root: HTMLElement, ctx: PracticeCtx, session: PracticeSession): void {
  const backHref = `#/course/${encodeURIComponent(ctx.courseId)}/theme/${encodeURIComponent(ctx.theme._id)}`;
  const endSessionHref = `#/course/${encodeURIComponent(ctx.courseId)}/summary?since=${encodeURIComponent(session.startedAt.toISOString())}`;
  const title = el('h1', { class: 'view__title', text: currentLo(ctx).lo.name });
  const header = el(
    'div',
    { class: 'view__intro' },
    el(
      'div',
      { class: 'row' },
      el('a', { class: 'btn btn--ghost btn--sm', href: backHref }, '← Back'),
      el('a', { class: 'btn btn--ghost btn--sm', href: endSessionHref }, 'End session'),
    ),
    eyebrow(ctx.theme.name),
    title,
  );
  const transcriptEl = el('div', { class: 'transcript' });
  const questionSlot = el('div', {});
  root.replaceChildren(header, transcriptEl, questionSlot);

  const refreshTranscript = (): void => {
    transcriptEl.replaceChildren(
      ...session.transcript.map((entry) =>
        el(
          'div',
          { class: `transcript__entry transcript__entry--${entry.result.correct ? 'correct' : 'incorrect'}` },
          el('span', { class: 'transcript__stem', text: entry.question.stem.replace(/[#*`$]/g, '').slice(0, 90) }),
          el('span', { class: 'mono', text: entry.result.correct ? 'Correct' : 'Missed' }),
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
  };

  const advanceLo = (): void => {
    if (ctx.isThemeMode && ctx.loIndex + 1 < ctx.los.length) {
      ctx.loIndex += 1;
      session.resetAttemptedFlag();
      title.textContent = currentLo(ctx).lo.name;
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

  void loadQuestion();
}

export async function renderPractice(outlet: HTMLElement, params: RouteParams): Promise<void> {
  const courseId = params.id;
  const isThemeMode = params.themeId !== undefined;
  const mode: PracticeMode = currentQuery().get('mode') === 'review-book' ? 'review-book' : 'topic-practice';

  const root = el('div', { class: 'view' }, loadingState('Loading practice…'));
  outlet.append(root);

  try {
    const home = await getCourseHome(courseId);

    if (isThemeMode) {
      const group = home.find((g) => g.theme._id === params.themeId);
      if (!group || group.los.length === 0) {
        root.replaceChildren(emptyState('This theme has no learning objectives to practice yet.'));
        return;
      }
      const los = [...group.los].sort((a, b) => a.lo.order - b.lo.order);
      const startIdx = los.findIndex((l) => l.status !== 'covered');
      const ctx: PracticeCtx = { courseId, theme: group.theme, los, loIndex: startIdx === -1 ? 0 : startIdx, isThemeMode: true, mode };
      runPracticeLoop(root, ctx, new PracticeSession());
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
    runPracticeLoop(root, ctx, new PracticeSession());
  } catch (error) {
    root.replaceChildren(errorState((error as Error).message, () => void renderPractice(outlet, params)));
  }
}
