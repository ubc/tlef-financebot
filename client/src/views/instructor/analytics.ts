import {
  getAnalyticsExamScores, analyticsQuery, getAnswerDistribution, getEngagementAnalytics, getFailureRates,
  getLowEngagement, getMyCourseCapabilities, getQuestionPatterns, searchAnalyticsStudents,
  type AnalyticsFilter, type QuestionPattern, type ThemeFailureRate,
} from '../../api.js';
import { scoresPanel } from './analytics-scores.js';
import { el, mount } from '../../dom.js';
import { pageHeader } from '../../instructor-ui.js';
import type { RouteParams } from '../../router.js';
import { maybeStartTutorial } from '../../tutorials.js';
import { errorState } from '../../ui.js';

const percent = (value: number | undefined): string => value === undefined ? 'Insufficient data' : `${Math.round((1 - value) * 100)}% correct`;
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
  let selectedTopic = '';
  let questionTopic = '';
  let patternRows: QuestionPattern[] = [];
  let patternTotal = 0;
  const questionSearch = el('input', { class: 'input', type: 'search', 'aria-label': 'Search questions', placeholder: 'Search questions, topics or objectives…' });
  const status = el('p', { class: 'analytics-updated', role: 'status' });
  const scope = el('p', { class: 'analytics-scope' });
  const overview = el('div', { class: 'analytics-metrics' });
  const focus = el('div', { class: 'analytics-focus-list' });
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
  const lo = el('select', { class: 'input', 'aria-label': 'Question patterns learning objective', onchange: () => { selectedVersion = ''; questionTopic = ''; void loadPatterns(); } }, el('option', { value: '', text: 'All learning objectives' }));
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
      el('div', { class: 'analytics-controls analytics-toolbar' }, el('div', { class: 'analytics-segmented', role: 'group', 'aria-label': 'Activity mode' }, practice, exam), el('label', {}, 'Date range', dates), button('Refresh', () => { void refresh(); void loadFollow(); })),
      el('div', { class: 'analytics-scope-line' }, scope, status), overview),
    el('section', { class: 'card analytics-topic-panel', 'data-tutorial': 'analytics-outcomes' },
      el('div', { class: 'analytics-topic-main' },
        el('header', { class: 'analytics-panel-heading' }, el('div', {}, el('h2', { text: 'Topic performance' }), el('p', { text: 'Explore topics, then inspect the evidence for each objective.' })), sort), outcomes),
      el('aside', { class: 'analytics-inspector', 'aria-label': 'Topic detail' },
        el('span', { class: 'analytics-eyebrow', text: 'TOPIC DETAIL' }), el('h2', { text: 'Learning objectives' }), focus,
        el('p', { class: 'muted', text: 'Rates require 5 attempts. No activity means no evidence, not poor performance.' }),
        el('div', { class: 'analytics-related-links' }, link('Open Coverage Map', 'content-map'), link('Review student flags', 'flags')))),
    section('Question answer patterns', 'analytics-question-patterns',
      el('p', { class: 'muted', text: 'Compare recorded versions within the selected activity scope. Each attempt counts once, including questions used across multiple objectives.' }),
      el('div', { class: 'analytics-controls' }, questionSearch, el('label', {}, 'Learning objective', lo)), patternList, distribution),
    section('Weekly engagement', 'analytics-engagement',
      el('p', { class: 'muted', text: 'Same mode and dates as outcomes. Attempts are submissions, not unique questions. Sessions split after 30 minutes without an attempt. Observed duration is the time between first and last attempts, not time studying.' }), csv, weeks),
    section('Students to check in with', 'analytics-follow-up',
      el('p', { class: 'muted', text: 'Across all modes and dates, independently of the outcome filters. Review their activity and learning context before deciding whether to contact them.' }), inactiveDays, follow,
      el('h3', { text: 'Find a student' }), searchArea),
  );

  const guide = el('details', { class: 'analytics-metric-guide' }, el('summary', { text: 'Metric guide' }), el('p', { text: 'Attempt accuracy is correct answers divided by recorded attempts, including retries. Rates need at least 5 attempts. Exam scores use earned / possible points for submitted sittings. Mastery is a separate judgment per objective. Profiles use the latest course-wide evidence, independently of dashboard filters.' }));
  root.querySelector('.page-header')?.append(guide);
  const scoreBody = el('div');
  const scoreSection = section('Exam scores', 'analytics-scores', el('p', { class: 'muted', text: 'Submitted Exam Prep sittings only. These are practice exam scores, not official course grades.' }), scoreBody);
  root.append(scoreSection);
  const tabbar = el('nav', { class: 'analytics-workbench-tabs', 'aria-label': 'Analytics views' });
  let activeTab = 'Topics';
  const panels: Record<string, HTMLElement[]> = {
    Topics: [root.querySelector<HTMLElement>('[data-tutorial="analytics-outcomes"]')!],
    Questions: [root.querySelector<HTMLElement>('[data-tutorial="analytics-question-patterns"]')!],
    Scores: [scoreSection],
    Students: [root.querySelector<HTMLElement>('[data-tutorial="analytics-follow-up"]')!],
    Engagement: [root.querySelector<HTMLElement>('[data-tutorial="analytics-engagement"]')!],
  };
  function showTab(name: string): void {
    activeTab = name;
    Object.entries(panels).forEach(([key, nodes]) => nodes.forEach(n => { n.hidden = key !== activeTab; }));
    tabbar.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.textContent === activeTab)));
    if (name === 'Scores') void loadScores();
  }
  tabbar.append(...Object.keys(panels).map(name => button(name, () => showTab(name))));
  root.insertBefore(tabbar, panels.Topics[0]); showTab('Topics');
  let scoreRevision = 0;
  async function loadScores(): Promise<void> {
    const request = ++scoreRevision;
    if (!individual) { scoreBody.replaceChildren(el('p', { text: 'Student score records require individual analytics permission.' })); return; }
    if (mode !== 'exam-prep') { scoreBody.replaceChildren(el('p', { text: 'Practice accuracy is not a grade. Switch to Exam Prep to inspect submitted scores.' }), button('View Exam Prep scores', () => changeMode('exam-prep'))); return; }
    scoreBody.replaceChildren(el('p', { text: 'Loading submitted scores…' }));
    try {
      const result = await getAnalyticsExamScores(courseId, { from: filter.from, to: filter.to });
      if (!alive() || request !== scoreRevision) return;
      scoreBody.replaceChildren(scoresPanel(result.items, courseId));
      if (result.excludedUnscored) scoreBody.append(el('p', { text: `${result.excludedUnscored} submitted records have no valid score and are excluded.` }));
    } catch (e) { if (alive() && request === scoreRevision) scoreBody.replaceChildren(errorState(message(e), () => void loadScores())); }
  }
  function renderRates(): void {
    if (!alive() || ratesRevision !== revision) return;
    const direction = sort.value === 'asc' ? 1 : -1;
    const compare = (a: { failureRate?: number }, b: { failureRate?: number }): number => {
      if (a.failureRate === undefined) return b.failureRate === undefined ? 0 : 1;
      if (b.failureRate === undefined) return -1;
      return direction * (a.failureRate - b.failureRate);
    };
    const allLos = rates.flatMap((theme) => theme.los.map((objective) => ({ ...objective, themeName: theme.name })));
    if (!rates.some(t => t.themeId === selectedTopic)) selectedTopic = rates[0]?.themeId ?? '';
    const selected = rates.find(t => t.themeId === selectedTopic);
    if (selected) focus.replaceChildren(el('h3', { class: 'analytics-topic-title', text: selected.name }),
      ...selected.los.map(item => el('div', { class: 'analytics-lo-detail' }, button(item.name + ' →', () => { lo.value = item.loId; questionTopic = ''; selectedVersion = ''; showTab('Questions'); void loadPatterns(); }), el('small', { text: `${percent(item.failureRate)} · ${item.attempts} attempts` }))),
      button('Inspect topic questions →', () => { questionTopic = selected.themeId; lo.value = ''; questionSearch.value = ''; selectedVersion = ''; showTab('Questions'); void loadPatterns(); }), el('p', { text: 'Select an objective to inspect its recorded question answers.' }));
    const tableBody = el('tbody');
    for (const theme of rates.slice().sort(compare)) {
      tableBody.append(el('tr', { class: theme.themeId === selectedTopic ? 'analytics-selected-row' : '' },
        el('td', {}, button(theme.name, () => { selectedTopic = theme.themeId; if (openThemes.has(theme.themeId)) openThemes.delete(theme.themeId); else openThemes.add(theme.themeId); renderRates(); })),
        el('td', { text: percent(theme.failureRate) }), el('td', { text: `${theme.failureRate === undefined ? '—' : Math.round(theme.attempts * (1 - theme.failureRate))} / ${theme.attempts}` })));
      selectedTopic = theme.themeId; if (openThemes.has(theme.themeId)) for (const item of theme.los.slice().sort(compare)) tableBody.append(el('tr', { class: 'analytics-lo-row' },
        el('td', {}, button(item.name + ' →', () => { lo.value = item.loId; questionTopic = ''; selectedVersion = ''; showTab('Questions'); void loadPatterns(); })),
        el('td', { text: percent(item.failureRate) }), el('td', { text: `${item.failureRate === undefined ? '—' : Math.round(item.attempts * (1 - item.failureRate))} / ${item.attempts}` })));
    }
    tableBody.querySelectorAll<HTMLButtonElement>('tr:not(.analytics-lo-row) td:first-child button').forEach((b, i) => { b.setAttribute('aria-expanded', String(openThemes.has(rates.slice().sort(compare)[i].themeId))); b.prepend(el('span', { class: 'analytics-chevron', 'aria-hidden': 'true', text: '›' })); });
    outcomes.replaceChildren(
      el('div', { class: 'analytics-table-wrap' }, el('table', { class: 'analytics-table' }, el('thead', {}, el('tr', {}, ...['Topic / learning objective', 'Accuracy', 'Correct / attempts'].map(text => el('th', { scope: 'col', text })))), tableBody)));
    if (!rates.length) outcomes.append(
      el('div', { class: 'analytics-empty-state', role: 'status' },
        el('span', { class: 'analytics-empty-state__icon', 'aria-hidden': 'true', text: '◇' }),
        el('div', {},
          el('h3', { text: 'No active objectives yet' }),
          el('p', { text: 'Add learning objectives to the course structure to start tracking topic performance.' })),
        el('a', { class: 'btn btn--instr-primary btn--sm', href: `${base}/content-map`, text: 'Open Coverage Map' })),
    );
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
      const evidence = [...distribution.children];
      const questionDetail = el('div', { class: 'analytics-recorded-question' }, ...evidence.slice(0, 3));
      const reviewLink = evidence[evidence.length - 1];
      if (reviewLink?.tagName === 'A') questionDetail.append(reviewLink);
      distribution.replaceChildren(questionDetail, el('div', { class: 'analytics-answer-selection' }, el('h3', { text: 'Answer selection' }), ...evidence.slice(3, -1)));
    } catch (error) { if (alive() && id === distributionRevision) distribution.replaceChildren(errorState(message(error), () => void showDistribution(item, snapshot))); }
  }
  function drawPatterns(snapshot: AnalyticsFilter): void {
    const query = questionSearch.value.trim();
    const items = patternRows;
    patternList.replaceChildren(el('p', { class: 'muted', text: `Showing ${items.length} of ${patternTotal} question/version groups. Results match the selected topic, objective and search.` }),
      el('div', { class: 'analytics-table-wrap' }, el('table', { class: 'analytics-table' },
        el('thead', {}, el('tr', {}, ...['Question / recorded version', 'Accuracy', 'Attempts'].map(text => el('th', { scope: 'col', text })))),
        el('tbody', {}, ...items.map(item => el('tr', { class: item.versionId === selectedVersion ? 'analytics-selected-row' : '' },
          el('td', {}, el('strong', { text: item.stem }), el('p', { text: `${item.objectiveCount > 1 ? `Across ${item.objectiveCount} learning objectives` : item.loName} · Version ${item.version ?? 'unknown'} · ${item.isCurrent ? 'Current' : 'Historical'}` }),
            item.available ? button(`View version ${item.version ?? ''} answers`, () => { selectedVersion = item.versionId; drawPatterns(snapshot); }) : link('Review available questions', 'bank')),
          el('td', { text: percent(item.failureRate) }), el('td', { text: String(item.attempts) })))))));
    if (!items.length) { ++distributionRevision; distribution.replaceChildren(); patternList.append(el('p', { text: query ? 'No matching questions. Try another search or select a learning objective.' : 'No question attempts in this scope. Try a wider date range.' })); return; }
    const selected = items.find(item => item.versionId === selectedVersion && item.available) ?? items.find(item => item.available);
    if (selected) void showDistribution(selected, snapshot);
  }
  let questionTimer: ReturnType<typeof setTimeout>;
  questionSearch.addEventListener('input', () => { ++patternRevision; ++distributionRevision; clearTimeout(questionTimer); questionTimer = setTimeout(() => { if (alive()) void loadPatterns(); }, 250); });
  async function loadPatterns(): Promise<void> {
    const id = ++patternRevision; ++distributionRevision;
    const snapshot = { ...filter, ...(lo.value ? { loId: lo.value } : {}), ...(questionTopic ? { themeId: questionTopic } : {}), ...(questionSearch.value.trim() ? { q: questionSearch.value.trim() } : {}) };
    patternList.replaceChildren(el('p', { text: 'Loading question patterns…' })); distribution.replaceChildren();
    try {
      const result = await getQuestionPatterns(courseId, snapshot);
      if (!alive() || id !== patternRevision) return;
      patternRows = result.items; patternTotal = result.total; drawPatterns(snapshot);
    } catch (error) { if (alive() && id === patternRevision) patternList.replaceChildren(errorState(message(error), () => void loadPatterns())); }
  }
  async function refresh(): Promise<void> {
    const id = ++revision; ++patternRevision; ++distributionRevision;
    ratesRevision = -1; rates = []; sort.disabled = true;
    const to = new Date(); const days = Number(dates.value);
    filter = { mode, from: new Date(days ? to.getTime() - days * 86_400_000 : 0).toISOString(), to: to.toISOString() };
    const snapshot = { ...filter }; const selectedMode = mode;
    if (activeTab === 'Scores') void loadScores();
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
          [result.totals.correctAttempts !== undefined && result.totals.questionsAttempted >= 5 ? `${Math.round(result.totals.correctAttempts / result.totals.questionsAttempted * 100)}%` : '—', 'Attempt accuracy · 5 attempts required'],
          [String(result.totals.questionsAttempted), 'Recorded attempts · includes retries'],
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

    searchResults.replaceChildren(el('p', { text: 'Searching…' }));
    try {
      const students = await searchAnalyticsStudents(courseId, search.value.trim());
      if (!alive() || id !== searchRevision) return;
      searchResults.replaceChildren(el('p', { class: 'muted', text: 'Course directory · up to 50 matching students. Profiles show the latest course-wide evidence.' }), el('div', { class: 'analytics-table-wrap' }, el('table', { class: 'analytics-table' },
        el('thead', {}, el('tr', {}, ...['Student', 'Mastery signals', 'Last activity', 'Action'].map(text => el('th', { scope: 'col', text })))),
        el('tbody', {}, ...students.map(student => el('tr', {}, el('td', {}, el('strong', { text: student.displayName }), el('p', { text: student.uid })), el('td', { text: student.strugglingObjectives ? `${student.strugglingObjectives} objectives need attention` : 'View mastery profile' }), el('td', { text: student.lastAttemptAt ? new Date(student.lastAttemptAt).toLocaleDateString() : 'No recorded attempts' }), el('td', {}, link('Open profile →', `student/${encodeURIComponent(student.puid)}`))))))));
      if (!students.length) searchResults.append(el('p', { text: 'No matching students in this course.' }));
    } catch (error) { if (alive() && id === searchRevision) searchResults.replaceChildren(errorState(message(error), () => void searchStudents())); }
  }
  let searchTimer: ReturnType<typeof setTimeout>;
  search.addEventListener('input', () => { ++searchRevision; searchResults.replaceChildren(); clearTimeout(searchTimer); searchTimer = setTimeout(() => { if (alive() && individual) void searchStudents(); }, 250); });
  async function loadCapabilities(): Promise<void> {
    try {
      const capabilities = await getMyCourseCapabilities(courseId); if (!alive()) return;
      individual = capabilities['analytics.individual'];
      if (activeTab === 'Scores') void loadScores();
      searchArea.replaceChildren(...(individual ? [el('form', { class: 'analytics-controls', onsubmit: (event: Event) => { event.preventDefault(); return searchStudents(); } }, search, el('button', { class: 'btn btn--secondary btn--sm', type: 'submit', text: 'Search' })), searchResults] : [el('p', { text: 'Individual profiles are unavailable with your course permissions.' })]));
      void loadFollow(); if (individual) void searchStudents();
    } catch (error) { if (alive()) searchArea.replaceChildren(errorState(`Profile access unavailable: ${message(error)}`, () => void loadCapabilities())); }
  }
  void refresh(); void loadFollow(); void loadCapabilities();
}
