import {
  ApiError,
  getAnswerDistribution,
  getEngagementAnalytics,
  getFailureRates,
  getLowEngagement,
  searchAnalyticsStudents,
  type ThemeFailureRate,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { pageHeader } from '../../instructor-ui.js';
import type { RouteParams } from '../../router.js';
import { errorState, loadingState } from '../../ui.js';

interface ChartInstance { destroy(): void }
interface ChartConstructor {
  new (context: CanvasRenderingContext2D, config: Record<string, unknown>): ChartInstance;
}
declare const Chart: ChartConstructor | undefined;

function percent(value: number | undefined): string {
  return value === undefined ? 'Insufficient data (<5 attempts)' : `${Math.round(value * 100)}%`;
}

async function renderInner(outlet: HTMLElement, courseId: string): Promise<void> {
  const body = el('div', {}, loadingState('Loading course analytics…'));
  mount(outlet, el('div', { class: 'view' }, body));
  let mode: 'topic-practice' | 'exam-prep' = 'topic-practice';
  let rates: ThemeFailureRate[];
  let engagement;
  let inactive;
  try {
    [rates, engagement, inactive] = await Promise.all([
      getFailureRates(courseId, mode),
      getEngagementAnalytics(courseId),
      getLowEngagement(courseId),
    ]);
  } catch (error) {
    const message = error instanceof ApiError ? error.message : (error as Error).message;
    body.replaceChildren(errorState(message, () => void renderInner(outlet, courseId)));
    return;
  }

  const rateTable = el('div', { class: 'stack' });
  const chartCanvas = el('canvas', { role: 'img', 'aria-label': 'Failure rates by Theme' }) as HTMLCanvasElement;
  let chart: ChartInstance | undefined;
  function renderRates(): void {
    rateTable.replaceChildren(...rates.map((theme) => el(
      'details',
      { class: 'card' },
      el('summary', { text: `${theme.name}: ${percent(theme.failureRate)} (${theme.attempts} attempts)` }),
      el('ul', {}, ...theme.los.map((lo) => el('li', { text: `${lo.name}: ${percent(lo.failureRate)} (${lo.attempts})` }))),
    )));
    chart?.destroy();
    const context = chartCanvas.getContext('2d');
    if (context && typeof Chart !== 'undefined') {
      chart = new Chart(context, {
        type: 'bar',
        data: {
          labels: rates.map((theme) => theme.name),
          datasets: [{
            label: 'Failure rate (%)',
            data: rates.map((theme) => theme.failureRate === undefined ? null : theme.failureRate * 100),
            backgroundColor: '#c65d3b',
          }],
        },
        options: { responsive: true, scales: { y: { beginAtZero: true, max: 100 } } },
      });
    }
  }

  const modeStatus = el('span', { 'aria-live': 'polite' });
  async function switchMode(next: typeof mode): Promise<void> {
    mode = next;
    modeStatus.textContent = 'Loading…';
    try {
      rates = await getFailureRates(courseId, mode);
      renderRates();
      modeStatus.textContent = '';
    } catch (error) {
      modeStatus.textContent = error instanceof ApiError ? error.message : (error as Error).message;
    }
  }

  const questionId = el('input', { class: 'input', placeholder: 'Question id', 'aria-label': 'Question id' }) as HTMLInputElement;
  const distribution = el('div', { 'aria-live': 'polite' });
  const studentQuery = el('input', { class: 'input', placeholder: 'Name or CWL', 'aria-label': 'Student search' }) as HTMLInputElement;
  const studentResults = el('div', { class: 'stack', 'aria-live': 'polite' });

  body.replaceChildren(
    pageHeader('Student Analytics', 'Theme/LO outcomes, answer patterns, engagement, and individual drill-down.'),
    el('section', { class: 'card stack' },
      el('div', { class: 'cluster' },
        el('button', { class: 'btn btn--secondary btn--sm', type: 'button', text: 'Topic Practice', onclick: () => void switchMode('topic-practice') }),
        el('button', { class: 'btn btn--secondary btn--sm', type: 'button', text: 'Exam Prep', onclick: () => void switchMode('exam-prep') }),
        modeStatus,
      ),
      chartCanvas,
      rateTable,
    ),
    el('section', { class: 'card stack' },
      el('h2', { text: 'Engagement' }),
      el('div', { class: 'cluster' },
        el('strong', { text: `${engagement.totals.questionsAttempted} questions` }),
        el('span', { text: `${engagement.totals.sessionsPerStudent.toFixed(1)} sessions/student` }),
        el('span', { text: `${engagement.totals.avgSessionMinutes.toFixed(1)} avg minutes/session` }),
        el('span', { text: `${Math.round(engagement.totals.loCoverageRate * 100)}% LO coverage` }),
      ),
      el('a', {
        class: 'btn btn--ghost btn--sm',
        href: `/api/courses/${encodeURIComponent(courseId)}/analytics/engagement.csv`,
        text: 'Export weekly CSV',
      }),
    ),
    el('section', { class: 'card stack' },
      el('h2', { text: 'Answer distribution' }),
      el('div', { class: 'cluster' }, questionId, el('button', {
        class: 'btn btn--secondary btn--sm', type: 'button', text: 'Analyze',
        onclick: async () => {
          try {
            const result = await getAnswerDistribution(courseId, questionId.value.trim());
            distribution.replaceChildren(el('div', { class: 'stack' },
              result.insufficient ? el('p', { text: 'Insufficient data (<5 attempts).' }) : false,
              result.misconceptionHighlight ? el('p', { class: 'alert alert--warning', text: 'Common misconception is unusually frequent.' }) : false,
              el('ul', {}, ...result.options.map((option) => el('li', { text: `${option.key} (${option.role}): ${option.count} · ${percent(option.pct)}` }))),
            ));
          } catch (error) {
            distribution.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
          }
        },
      })),
      distribution,
    ),
    el('section', { class: 'card stack' },
      el('h2', { text: `Low engagement (${inactive.length})` }),
      ...(inactive.length ? inactive.map((student) => el('a', {
        href: `#/instructor/course/${encodeURIComponent(courseId)}/student/${encodeURIComponent(student.puid)}`,
        text: `${student.displayName} (${student.uid}) · ${student.lastAttemptAt ? `${student.inactiveDays} inactive days` : 'no attempts'}`,
      })) : [el('p', { class: 'muted', text: 'No inactive students at the selected threshold.' })]),
    ),
    el('section', { class: 'card stack' },
      el('h2', { text: 'Find a student' }),
      el('div', { class: 'cluster' }, studentQuery, el('button', {
        class: 'btn btn--secondary btn--sm', type: 'button', text: 'Search',
        onclick: async () => {
          try {
            const students = await searchAnalyticsStudents(courseId, studentQuery.value);
            studentResults.replaceChildren(...students.map((student) => el('a', {
              href: `#/instructor/course/${encodeURIComponent(courseId)}/student/${encodeURIComponent(student.puid)}`,
              text: `${student.displayName} · ${student.uid}`,
            })));
          } catch (error) {
            studentResults.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
          }
        },
      })),
      studentResults,
    ),
  );
  renderRates();
}

export function renderAnalytics(outlet: HTMLElement, params: RouteParams): void {
  void renderInner(outlet, params.id);
}
