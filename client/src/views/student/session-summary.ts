// Session summary (ST-P10/P11, Figma wireframe screen 7): stat-tile row,
// a "Topics This Session" accordion (topic header + per-LO accuracy),
// a "Missed Questions — Added to Review Book" list linking back into the
// Review Book, a client-derived "Recommended next steps" banner, three
// wireframe actions (Continue Practice / Go to Review Book / Back to
// Course), and the existing "Defer to next session" action from Task 14
// (ST-P10) kept as a fourth, visually secondary text link — it ends the
// session without continuing, which the wireframe's three-button row
// doesn't cover.
import {
  deferSessionSummary,
  getCourseHome,
  getReviewBook,
  getSessionSummary,
  listEnrollments,
  type CourseHomeLo,
  type CourseHomeTheme,
  type SessionEndSummary,
} from '../../api.js';
import { el } from '../../dom.js';
import { emptyState, errorState, loadingState } from '../../ui.js';
import { renderRichText } from '../../render.js';
import { currentQuery } from '../../router.js';
import type { RouteParams } from '../../router.js';
import { copyrightFooter, pageHeader, statTile } from '../../student-ui.js';

interface LoMeta {
  loId: string;
  loName: string;
  order: number;
  themeId: string;
  themeName: string;
  themeOrder: number;
}

function buildLoMeta(home: CourseHomeTheme[]): Map<string, LoMeta> {
  const map = new Map<string, LoMeta>();
  for (const group of home) {
    for (const entry of group.los) {
      map.set(entry.lo._id, {
        loId: entry.lo._id,
        loName: entry.lo.name,
        order: entry.lo.order,
        themeId: group.theme._id,
        themeName: group.theme.name,
        themeOrder: group.theme.order,
      });
    }
  }
  return map;
}

/** The first not-yet-covered LO across the whole course, in Topic/LO order —
 * used both for "Continue Practice" and the "Recommended next steps" line.
 * Derived entirely from `getCourseHome` data already fetched for this view;
 * no new endpoint. */
function findNextUncovered(home: CourseHomeTheme[]): { themeName: string; lo: CourseHomeLo } | undefined {
  const flat = [...home]
    .sort((a, b) => a.theme.order - b.theme.order)
    .flatMap((g) => [...g.los].sort((a, b) => a.lo.order - b.lo.order).map((lo) => ({ themeName: g.theme.name, lo })));
  return flat.find((entry) => entry.lo.status !== 'covered');
}

function overallAccuracy(rows: SessionEndSummary['accuracyByLo']): { correct: number; attempted: number; pct: number } {
  const correct = rows.reduce((sum, r) => sum + r.correct, 0);
  const attempted = rows.reduce((sum, r) => sum + r.attempted, 0);
  return { correct, attempted, pct: attempted > 0 ? Math.round((correct / attempted) * 100) : 0 };
}

interface TopicSummary {
  themeId: string;
  themeName: string;
  themeOrder: number;
  themeStatus: 'covered' | 'in-progress' | 'not-attempted';
  rows: Array<SessionEndSummary['accuracyByLo'][number] & { loName: string; order: number }>;
}

function themeStatusFor(home: CourseHomeTheme[], themeId: string): TopicSummary['themeStatus'] {
  const group = home.find((g) => g.theme._id === themeId);
  if (!group) return 'in-progress';
  const total = group.los.length;
  const covered = group.los.filter((l) => l.status === 'covered').length;
  if (total > 0 && covered === total) return 'covered';
  return group.los.some((l) => l.status !== 'not-attempted') ? 'in-progress' : 'not-attempted';
}

function groupByTopic(
  rows: SessionEndSummary['accuracyByLo'],
  loMeta: Map<string, LoMeta>,
  home: CourseHomeTheme[],
): TopicSummary[] {
  const byTheme = new Map<string, TopicSummary>();
  for (const row of rows) {
    const meta = loMeta.get(row.loId);
    const themeId = meta?.themeId ?? 'unknown';
    const topic = byTheme.get(themeId) ?? {
      themeId,
      themeName: meta?.themeName ?? 'Other',
      themeOrder: meta?.themeOrder ?? Number.MAX_SAFE_INTEGER,
      themeStatus: themeStatusFor(home, themeId),
      rows: [],
    };
    topic.rows.push({ ...row, loName: meta?.loName ?? row.loId, order: meta?.order ?? 0 });
    byTheme.set(themeId, topic);
  }
  return [...byTheme.values()]
    .sort((a, b) => a.themeOrder - b.themeOrder)
    .map((topic) => ({ ...topic, rows: [...topic.rows].sort((a, b) => a.order - b.order) }));
}

function loAccuracyRow(row: TopicSummary['rows'][number]): HTMLElement {
  return el(
    'div',
    { class: 'summary-lo-row' },
    el('span', { class: 'summary-lo-row__name', text: row.loName }),
    el('span', { class: 'summary-lo-row__accuracy', text: `${row.correct} / ${row.attempted} correct` }),
  );
}

const TOPIC_STATUS_LABEL: Record<TopicSummary['themeStatus'], string> = {
  covered: 'Covered',
  'in-progress': 'In Progress',
  'not-attempted': 'Not Attempted',
};

function topicAccordion(topic: TopicSummary): HTMLElement {
  const correct = topic.rows.reduce((sum, r) => sum + r.correct, 0);
  const attempted = topic.rows.reduce((sum, r) => sum + r.attempted, 0);
  const statusLabel = TOPIC_STATUS_LABEL[topic.themeStatus];

  const losPanel = el('div', { class: 'summary-topic__los', hidden: true }, ...topic.rows.map(loAccuracyRow));
  const caret = el(
    'button',
    {
      class: 'summary-topic__caret',
      type: 'button',
      'aria-expanded': 'false',
      'aria-label': `Expand ${topic.themeName}`,
      onclick: () => {
        const expanded = caret.getAttribute('aria-expanded') === 'true';
        caret.setAttribute('aria-expanded', String(!expanded));
        losPanel.hidden = expanded;
        caret.textContent = expanded ? '▸' : '▾';
      },
    },
    '▸',
  );

  return el(
    'div',
    { class: 'summary-topic' },
    el(
      'div',
      { class: 'summary-topic__header' },
      caret,
      el(
        'div',
        { class: 'summary-topic__text' },
        el('p', { class: 'summary-topic__name', text: topic.themeName }),
        el('p', {
          class: 'summary-topic__meta',
          text: `${topic.rows.length} LO(s) · ${correct}/${attempted} correct · ${statusLabel}`,
        }),
      ),
    ),
    losPanel,
  );
}

function missedList(
  courseId: string,
  additions: SessionEndSummary['reviewBookAdditions'],
  stems: Map<string, string>,
): HTMLElement {
  return el(
    'section',
    { class: 'summary-section' },
    el('h2', { class: 'section-title', text: 'Missed Questions — Added to Review Book' }),
    el(
      'div',
      { class: 'summary-missed' },
      ...additions.map((addition) => {
        const stemEl = el('p', { class: 'summary-missed__stem' });
        const stem = stems.get(addition.questionId);
        if (stem) renderRichText(stemEl, stem.slice(0, 140));
        else stemEl.textContent = 'This question is no longer in your Review Book.';
        return el(
          'div',
          { class: 'summary-missed__row' },
          stemEl,
          el(
            'a',
            { class: 'summary-missed__link', href: `#/course/${encodeURIComponent(courseId)}/review-book` },
            'Review →',
          ),
        );
      }),
    ),
  );
}

/** Fetches stems for this session's missed-question links by reusing the
 * existing `getReviewBook` call (its entries already carry `question.stem`)
 * rather than adding a new endpoint — `SessionEndSummary.reviewBookAdditions`
 * only carries `questionId`. */
async function loadMissedStems(
  courseId: string,
  additions: SessionEndSummary['reviewBookAdditions'],
): Promise<Map<string, string>> {
  if (additions.length === 0) return new Map();
  try {
    const groups = await getReviewBook(courseId, 'date');
    const map = new Map<string, string>();
    for (const group of groups) for (const entry of group.entries) map.set(entry.questionId, entry.question.stem);
    return map;
  } catch {
    return new Map();
  }
}

function recommendedNextSteps(summary: SessionEndSummary, home: CourseHomeTheme[]): string {
  const next = findNextUncovered(home);
  const totalLos = home.reduce((sum, g) => sum + g.los.length, 0);
  const bits: string[] = [];
  if (next) bits.push(`Continue with "${next.lo.lo.name}" in ${next.themeName}`);
  else if (totalLos > 0) bits.push("You've covered every LO in this course — nice work");
  if (summary.missedQuestions.length > 0) {
    bits.push(`review ${summary.missedQuestions.length} missed question(s) in your Review Book`);
  }
  return bits.length > 0 ? `${bits.join(', then ')}.` : 'Keep practicing to build up your mastery profile.';
}

function summaryBody(
  courseId: string,
  summary: SessionEndSummary,
  home: CourseHomeTheme[],
  stems: Map<string, string>,
): HTMLElement {
  const loMeta = buildLoMeta(home);
  const topics = groupByTopic(summary.accuracyByLo, loMeta, home);
  const { correct, pct } = overallAccuracy(summary.accuracyByLo);

  return el(
    'div',
    { class: 'stack' },
    el(
      'div',
      { class: 'stat-tile-row' },
      statTile(summary.losCovered.length, 'LOs Covered'),
      statTile(summary.questionsAttempted, 'Questions Answered'),
      statTile(correct, 'Correct Answers', 'good'),
      statTile(`${pct}%`, 'Accuracy', pct >= 70 ? 'good' : pct >= 40 ? 'warn' : 'bad'),
      statTile(summary.reviewBookAdditions.length, 'Review Book Added'),
    ),
    el(
      'section',
      { class: 'summary-section' },
      el('h2', { class: 'section-title', text: 'Topics This Session' }),
      topics.length
        ? el('div', { class: 'summary-topics' }, ...topics.map(topicAccordion))
        : emptyState('No topics were touched this session.'),
    ),
    summary.reviewBookAdditions.length > 0 ? missedList(courseId, summary.reviewBookAdditions, stems) : false,
    el(
      'div',
      { class: 'banner' },
      el(
        'p',
        { class: 'banner__text' },
        el('strong', { text: 'Recommended next steps: ' }),
        recommendedNextSteps(summary, home),
      ),
    ),
  );
}

export async function renderSessionSummary(outlet: HTMLElement, params: RouteParams): Promise<void> {
  const courseId = params.id;
  const sessionStart = new Date();
  // "End session" (practice.ts) navigates here with `?since=<ISO timestamp>`
  // — the practice view's own session start. In that case this is the
  // CURRENT session ending, not a start-of-next-session greeting: reuse the
  // same sessionEndSummary plumbing as "Defer to next session" below
  // (deferSessionSummary computes it live AND stores it) instead of a new
  // fetch/recompute path.
  const sinceParam = currentQuery().get('since');
  const endingSession = sinceParam !== null;

  const root = el('div', { class: 'view' }, loadingState('Loading your summary…'));
  outlet.append(root);

  try {
    const [home, enrollments] = await Promise.all([getCourseHome(courseId), listEnrollments()]);
    const courseName = enrollments.find((e) => e.courseId === courseId)?.name ?? 'Course';

    const state = endingSession
      ? { welcome: false, deferred: await deferSessionSummary(courseId, new Date(sinceParam as string)) }
      : await getSessionSummary(courseId);

    const subtitle = `${courseName} · ${endingSession ? 'Session ended' : state.welcome ? 'Get started' : 'Previous session'}`;
    const header = pageHeader('Session Summary', subtitle);

    if (state.welcome || !state.deferred) {
      root.replaceChildren(
        header,
        emptyState("You don't have a stored summary yet — practice a few questions first."),
        copyrightFooter(),
      );
      return;
    }

    const summary = state.deferred;
    const stems = await loadMissedStems(courseId, summary.reviewBookAdditions);
    const body = summaryBody(courseId, summary, home, stems);

    const next = findNextUncovered(home);
    const continueHref = next
      ? `#/course/${encodeURIComponent(courseId)}/practice/${encodeURIComponent(next.lo.lo._id)}`
      : `#/course/${encodeURIComponent(courseId)}`;

    const deferSlot = el('div', { class: 'summary-defer' });
    if (endingSession) {
      deferSlot.append(el('p', { class: 'state__text', text: 'Session ended — this will greet you next time.' }));
    } else {
      deferSlot.append(
        el(
          'button',
          {
            class: 'summary-defer__link',
            type: 'button',
            onclick: async () => {
              const btn = deferSlot.firstElementChild as HTMLButtonElement;
              btn.disabled = true;
              try {
                await deferSessionSummary(courseId, sessionStart);
                deferSlot.replaceChildren(el('p', { class: 'state__text', text: 'Saved — this will greet you next time.' }));
              } catch (error) {
                deferSlot.replaceChildren(errorState((error as Error).message));
              }
            },
          },
          'Defer to next session',
        ),
      );
    }

    const actions = el(
      'div',
      { class: 'summary-actions' },
      el(
        'div',
        { class: 'row' },
        el('a', { class: 'btn btn--instr-primary', href: continueHref }, 'Continue Practice'),
        el(
          'a',
          { class: 'btn btn--ghost', href: `#/course/${encodeURIComponent(courseId)}/review-book` },
          'Go to Review Book',
        ),
        el('a', { class: 'btn btn--ghost', href: `#/course/${encodeURIComponent(courseId)}` }, 'Back to Course'),
      ),
      deferSlot,
    );

    root.replaceChildren(header, body, actions, copyrightFooter());
  } catch (error) {
    root.replaceChildren(errorState((error as Error).message, () => void renderSessionSummary(outlet, params)));
  }
}
