import {
  analyticsQuery, getAnswerDistribution, getEngagementAnalytics, getFailureRates,
  getLowEngagement, getMyCourseCapabilities, getQuestionPatterns, searchAnalyticsStudents,
  type AnalyticsFilter, type QuestionPattern, type ThemeFailureRate,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { pageHeader } from '../../instructor-ui.js';
import type { RouteParams } from '../../router.js';
import { maybeStartTutorial } from '../../tutorials.js';
import { errorState } from '../../ui.js';

const percent = (value: number | undefined): string => value === undefined ? 'Insufficient data' : `${Math.round(value * 100)}% incorrect`;
const button = (text: string, action: () => void): HTMLButtonElement => el('button', { class: 'btn btn--secondary btn--sm', type: 'button', text, onclick: action });
const message = (error: unknown): string => error instanceof Error ? error.message : 'Unable to load this section.';

export function renderAnalytics(outlet: HTMLElement, params: RouteParams): void {
  const courseId = params.id;
  const base = `#/instructor/course/${encodeURIComponent(courseId)}`;
  const root = el('div', { class: 'view analytics-view' });
  mount(outlet, root);
  const route = location.hash;
  const alive = (): boolean => root.isConnected && location.hash === route;
  let revision = 0, patternRevision = 0, distributionRevision = 0, searchRevision = 0, followRevision = 0;
  let mode: 'topic-practice' | 'exam-prep' = 'topic-practice';
  let filter: AnalyticsFilter = {};
  let rates: ThemeFailureRate[] = [];
  let ratesRevision = -1;
  let individual = false;
  let selectedVersion = '';
  const openThemes = new Set<string>();
  const status = el('p', { class: 'muted', role: 'status' });
  const scope = el('p', { class: 'analytics-scope' });
  const overview = el('div', { class: 'analytics-metrics' });
  const focus = el('div', { class: 'stack' });
  const outcomes = el('div', { class: 'stack' });
  const patternList = el('div', { class: 'analytics-pattern-list' });
  const distribution = el('div', { class: 'analytics-distribution', 'aria-live': 'polite' });
  const weeks = el('div', { class: 'analytics-table-wrap', tabindex: '0', role: 'region', 'aria-label': 'Weekly activity table' });
  const follow = el('div', { class: 'stack' });
  const searchResults = el('div', { class: 'stack', 'aria-live': 'polite' });
  const search = el('input', { class: 'input', placeholder: 'Name or CWL', 'aria-label': 'Student search' });
  const searchArea = el('div', { class: 'stack' });
  const dates = el('select', { class: 'input', 'aria-label': 'Outcome date range', onchange: () => void refresh() },
    ...[7, 28, 84, 0].map((days) => el('option', { value: days, selected: days === 28, text: days ? `Last ${days} days` : 'All time' })));
  const sort = el('select', { class: 'input', 'aria-label': 'Sort outcomes', onchange: () => renderRates() },
    el('option', { value: 'desc', text: 'Highest incorrect rate first' }), el('option', { value: 'asc', text: 'Lowest incorrect rate first' }));
  const lo = el('select', { class: 'input', 'aria-label': 'Question patterns learning objective', onchange: () => { selectedVersion = ''; void loadPatterns(); } }, el('option', { value: '', text: 'All learning objectives' }));
  const inactiveDays = el('select', { class: 'input', 'aria-label': 'Inactive days', onchange: () => void loadFollow() },
    ...[7, 14, 30].map((days) => el('option', { value: days, text: `No attempts in ${days} days` })));
  const practice = button('Topic Practice', () => changeMode('topic-practice'));
  const exam = button('Exam Prep', () => changeMode('exam-prep'));
  function changeMode(next: typeof mode): void { mode = next; void refresh(); }
  const csv = el('a', { class: 'btn btn--ghost btn--sm', text: 'Export weekly CSV' });
  const link = (text: string, path: string): HTMLAnchorElement => el('a', { href: `${base}/${path}`, text });
  const profile = (student: { puid: string; displayName: string; uid: string }): HTMLElement => individual
    ? link(`${student.displayName} · ${student.uid}`, `student/${encodeURIComponent(student.puid)}`)
    : el('span', { text: `${student.displayName} · ${student.uid}` });
  const section = (title: string, anchor: string, ...children: HTMLElement[]): HTMLElement => el('section', { class: 'card stack', 'data-tutorial': anchor }, el('h2', { text: title }), ...children);
  root.append(
    pageHeader('Student Analytics', 'Use observed activity to choose what to review and where to follow up.'),
    section('Evidence overview', 'analytics-overview',
      el('div', { class: 'analytics-controls' }, practice, exam, el('label', {}, 'Date range', dates), button('Refresh', () => { void refresh(); void loadFollow(); })),
      scope, status, overview),
    section('Where to focus', 'analytics-outcomes',
      el('p', { class: 'muted', text: 'Review priorities, not diagnoses of student ability. Rates require at least 5 attempts; active objectives with no activity remain visible.' }), focus,
      el('div', { class: 'analytics-controls' }, el('h3', { text: 'Theme and learning objective outcomes' }), sort), outcomes,
      el('div', { class: 'cluster' }, link('Open Coverage Map', 'content-map'), link('Review student flags', 'flags'))),
    section('Question answer patterns', 'analytics-question-patterns',
      el('p', { class: 'muted', text: 'Compare recorded versions within the selected activity scope. Each attempt counts once, including questions used across multiple objectives.' }),
      el('label', {}, 'Learning objective', lo), patternList, distribution),
    section('Weekly engagement', 'analytics-engagement',
      el('p', { class: 'muted', text: 'Same mode and dates as outcomes. Attempts are submissions, not unique questions. Sessions split after 30 minutes without an attempt. Observed duration is the time between first and last attempts, not time studying.' }), csv, weeks),
    section('Students to check in with', 'analytics-follow-up',
      el('p', { class: 'muted', text: 'Across all modes and dates, independently of the outcome filters. Review their activity and learning context before deciding whether to contact them.' }), inactiveDays, follow,
      el('h3', { text: 'Find a student' }), searchArea),
  );
  function renderRates(): void {
    if (!alive() || ratesRevision !== revision) return;
    const direction = sort.value === 'asc' ? 1 : -1;
    const compare = (a: { failureRate?: number }, b: { failureRate?: number }): number => {
      if (a.failureRate === undefined) return b.failureRate === undefined ? 0 : 1;
      if (b.failureRate === undefined) return -1;
      return direction * (a.failureRate - b.failureRate);
    };
    const allLos = rates.flatMap((theme) => theme.los.map((objective) => ({ ...objective, themeName: theme.name })));
    const priorities = [...allLos].filter((item) => item.failureRate !== undefined && item.failureRate > 0).sort((a, b) => (b.failureRate ?? 0) - (a.failureRate ?? 0)).slice(0, 3);
    focus.replaceChildren(...(priorities.length ? priorities.map((item) => el('article', { class: 'analytics-priority' },
      el('strong', { text: item.name }), el('span', { text: `${percent(item.failureRate)} · ${item.attempts} attempts · ${item.themeName}` }),
      el('div', { class: 'cluster' }, button('Inspect answer patterns', () => { lo.value = item.loId; selectedVersion = ''; void loadPatterns(); lo.focus(); }), link('Review questions', `bank?loId=${encodeURIComponent(item.loId)}`)),
    )) : [el('p', { text: allLos.some((item) => item.failureRate !== undefined) ? 'No incorrect attempts in the objectives with sufficient evidence. Review coverage for gaps.' : 'Not enough evidence to rank objectives yet. Review available questions and let student activity build the sample.' }), link('Review questions', 'bank')]));
    outcomes.replaceChildren(...rates.slice().sort(compare).map((theme) => {
      const detail = el('details', { class: 'analytics-theme', open: openThemes.has(theme.themeId) },
        el('summary', { text: `${theme.name} · ${percent(theme.failureRate)} · ${theme.attempts} attempts` }),
        ...theme.los.slice().sort(compare).map((item) => el('div', { class: 'analytics-outcome' },
          el('div', { class: 'cluster' }, link(item.name, `bank?loId=${encodeURIComponent(item.loId)}`), el('span', { text: `${percent(item.failureRate)} · ${item.attempts} attempts` })),
          item.failureRate !== undefined && el('div', { class: 'analytics-bar', 'aria-hidden': 'true' }, el('span', { style: `width:${Math.round(item.failureRate * 100)}%` })),
          !item.attempts && el('span', { class: 'muted', text: 'No attempts in this scope. Review question availability.' }),
        )));
      detail.addEventListener('toggle', () => { if (detail.open) openThemes.add(theme.themeId); else openThemes.delete(theme.themeId); });
      return detail;
    }));
    if (!rates.length) outcomes.append(el('p', { text: 'No active objectives yet.' }), link('Open Coverage Map', 'content-map'));
    const previous = lo.value;
    lo.replaceChildren(el('option', { value: '', text: 'All learning objectives' }), ...allLos.map((item) => el('option', { value: item.loId, text: `${item.themeName} / ${item.name}` })));
    lo.value = allLos.some((item) => item.loId === previous) ? previous : '';
  }
  async function showDistribution(item: QuestionPattern, snapshot: AnalyticsFilter): Promise<void> {
    const id = ++distributionRevision; selectedVersion = item.versionId;
    distribution.replaceChildren(el('p', { text: 'Loading recorded version…' }));
    try {
      const result = await getAnswerDistribution(courseId, item.questionId, { ...snapshot, versionId: item.versionId });
      if (!alive() || id !== distributionRevision) return;
      distribution.replaceChildren(
        el('h3', { text: `Version ${result.version} · ${result.isCurrent ? 'Current content' : 'Historical content'}` }),
        el('p', { text: result.stem }), el('p', { text: `${result.attempts} attempts · ${result.insufficient ? 'Insufficient data — at least 5 attempts required.' : 'Observed answer choices in the selected scope.'}` }),
        ...(!result.insufficient ? result.options.map((option) => el('div', { class: 'analytics-outcome' },
          el('p', { text: `${option.key}. ${option.text} · ${option.role.replace(/-/g, ' ')} · ${option.count} (${Math.round((option.pct ?? 0) * 100)}%)` }),
          el('div', { class: 'analytics-bar', 'aria-hidden': 'true' }, el('span', { style: `width:${Math.round((option.pct ?? 0) * 100)}%` })))) : []),
        link(`Review question (recorded version ${result.version})`, `bank/${encodeURIComponent(item.questionId)}?analyticsVersionId=${encodeURIComponent(item.versionId)}`),
      );
    } catch (error) { if (alive() && id === distributionRevision) distribution.replaceChildren(errorState(message(error), () => void showDistribution(item, snapshot))); }
  }
  async function loadPatterns(): Promise<void> {
    const id = ++patternRevision; ++distributionRevision;
    const snapshot = { ...filter, ...(lo.value ? { loId: lo.value } : {}) };
    patternList.replaceChildren(el('p', { text: 'Loading question patterns…' })); distribution.replaceChildren();
    try {
      const result = await getQuestionPatterns(courseId, snapshot);
      if (!alive() || id !== patternRevision) return;
      patternList.replaceChildren(el('p', { class: 'muted', text: `Showing ${result.items.length} of ${result.total} question/version groups, ordered by sample size.` }), ...result.items.map((item) => el('article', { class: 'analytics-pattern' },
        el('strong', { text: item.stem }), el('p', { text: `${item.objectiveCount > 1 ? `Across ${item.objectiveCount} learning objectives` : item.loName} · Version ${item.version ?? 'unknown'} · ${item.isCurrent ? 'Current' : 'Historical'} · ${item.attempts} attempts · ${percent(item.failureRate)}` }),
        item.available ? button(`View version ${item.version ?? ''} answers`, () => void showDistribution(item, snapshot)) : link('Review available questions', 'bank'),
      )));
      if (!result.items.length) patternList.append(el('p', { text: 'No question attempts in this scope. Student practice or submitted exams create evidence; try a wider date range or review question availability.' }), link('Review questions', lo.value ? `bank?loId=${lo.value}` : 'bank'));
      const previous = result.items.find((item) => item.versionId === selectedVersion && item.available);
      if (previous) void showDistribution(previous, snapshot);
    } catch (error) { if (alive() && id === patternRevision) patternList.replaceChildren(errorState(message(error), () => void loadPatterns())); }
  }
  async function refresh(): Promise<void> {
    const id = ++revision; ++patternRevision; ++distributionRevision;
    ratesRevision = -1; rates = []; sort.disabled = true;
    const to = new Date(); const days = Number(dates.value);
    filter = { mode, from: new Date(days ? to.getTime() - days * 86_400_000 : 0).toISOString(), to: to.toISOString() };
    const snapshot = { ...filter }; const selectedMode = mode;
    practice.setAttribute('aria-pressed', String(mode === 'topic-practice')); exam.setAttribute('aria-pressed', String(mode === 'exam-prep'));
    scope.textContent = `${mode === 'topic-practice' ? 'Topic Practice' : 'Exam Prep'} · ${days ? `Last ${days} days` : 'All time'} · ${days ? new Date(filter.from!).toLocaleDateString() : 'First recorded activity'} – ${to.toLocaleDateString()} (through ${to.toLocaleTimeString()})`;
    csv.href = `/api/courses/${encodeURIComponent(courseId)}/analytics/engagement.csv?${analyticsQuery(snapshot)}`;
    status.textContent = 'Refreshing selected scope…'; overview.replaceChildren(); focus.replaceChildren(); outcomes.replaceChildren(el('p', { text: 'Loading outcomes…' })); weeks.replaceChildren(el('p', { text: 'Loading engagement…' }));
    patternList.replaceChildren(); distribution.replaceChildren();
    let failed = false;
    await Promise.allSettled([
      (async () => { try {
        const result = await getFailureRates(courseId, selectedMode, snapshot);
        if (!alive() || id !== revision) return;
        rates = result; ratesRevision = id; sort.disabled = false; renderRates();
      } catch (error) { if (alive() && id === revision) { failed = true; outcomes.replaceChildren(errorState(message(error), () => void refresh())); } } })(),
      (async () => { try {
        const result = await getEngagementAnalytics(courseId, snapshot);
        if (!alive() || id !== revision) return;
        overview.replaceChildren(...[
          [String(result.totals.questionsAttempted), 'Attempts in scope'],
          [result.totals.sessionsPerStudent.toFixed(1), 'Sessions per active student'],
          [`${result.totals.avgSessionMinutes.toFixed(1)} min`, 'Mean observed session duration'],
          [`${Math.round(result.totals.loCoverageRate * 100)}%`, 'Active objectives attempted'],
        ].map(([value, label]) => el('div', { class: 'analytics-metric' }, el('strong', { text: value }), el('span', { text: label }))));
        weeks.replaceChildren(el('table', { class: 'analytics-table' },
          el('caption', { text: 'Weekly activity · selected mode and dates · weeks start Sunday (UTC)' }),
          el('thead', {}, el('tr', {}, ...['Week starting', 'Attempts', 'Active students', 'Sessions', 'Observed minutes/session'].map((text) => el('th', { scope: 'col', text })))),
          el('tbody', {}, ...result.weeks.map((week) => el('tr', {}, ...[week.week, String(week.questionsAttempted), String(week.activeStudents), String(week.sessions), week.avgSessionMinutes.toFixed(1)].map((text) => el('td', { text })))))));
        if (!result.totals.questionsAttempted) weeks.prepend(el('p', { text: 'No recorded activity in this scope. Empty weeks are included.' }));
      } catch (error) { if (alive() && id === revision) { failed = true; weeks.replaceChildren(errorState(message(error), () => void refresh())); overview.replaceChildren(el('p', { text: 'Engagement metrics unavailable. Retry this scope below.' })); } } })(),
    ]);
    if (!alive() || id !== revision) return;
    await loadPatterns();
    if (!alive() || id !== revision) return;
    status.textContent = `${failed ? 'Some sections unavailable. Last refresh' : 'Last updated'} ${new Date().toLocaleTimeString()}. Use Refresh for new activity.`;
    void maybeStartTutorial('instructor-analytics', { root });
  }
  async function loadFollow(): Promise<void> {
    const id = ++followRevision;
    if (!individual) { follow.replaceChildren(el('p', { text: 'Named check-in lists require individual analytics permission.' })); return; }
    follow.replaceChildren(el('p', { text: 'Loading check-in list…' }));
    try {
      const students = await getLowEngagement(courseId, Number(inactiveDays.value));
      if (!alive() || id !== followRevision) return;
      follow.replaceChildren(...students.map((student) => el('div', { class: 'cluster' }, profile(student), el('span', { class: 'muted', text: student.lastAttemptAt ? `${student.inactiveDays} days since last attempt` : 'No recorded attempts' }))));
      if (!students.length) follow.append(el('p', { text: 'No students meet this inactivity threshold.' }));
    } catch (error) { if (alive() && id === followRevision) follow.replaceChildren(errorState(message(error), () => void loadFollow())); }
  }
  async function searchStudents(): Promise<void> {
    const id = ++searchRevision;
    if (!search.value.trim()) { searchResults.replaceChildren(el('p', { text: 'Enter a name or CWL to search.' })); return; }
    searchResults.replaceChildren(el('p', { text: 'Searching…' }));
    try {
      const students = await searchAnalyticsStudents(courseId, search.value.trim());
      if (!alive() || id !== searchRevision) return;
      searchResults.replaceChildren(...students.map(profile));
      if (!students.length) searchResults.append(el('p', { text: 'No matching students in this course.' }));
    } catch (error) { if (alive() && id === searchRevision) searchResults.replaceChildren(errorState(message(error), () => void searchStudents())); }
  }
  search.addEventListener('input', () => { ++searchRevision; searchResults.replaceChildren(); });
  async function loadCapabilities(): Promise<void> {
    try {
      const capabilities = await getMyCourseCapabilities(courseId); if (!alive()) return;
      individual = capabilities['analytics.individual'];
      searchArea.replaceChildren(...(individual ? [el('form', { class: 'analytics-controls', onsubmit: (event: Event) => { event.preventDefault(); void searchStudents(); } }, search, el('button', { class: 'btn btn--secondary btn--sm', type: 'submit', text: 'Search' })), searchResults] : [el('p', { text: 'Individual profiles are unavailable with your course permissions.' })]));
      void loadFollow();
    } catch (error) { if (alive()) searchArea.replaceChildren(errorState(`Profile access unavailable: ${message(error)}`, () => void loadCapabilities())); }
  }
  void refresh(); void loadFollow(); void loadCapabilities();
}
