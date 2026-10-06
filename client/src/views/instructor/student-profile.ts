import { getStudentAnalytics, getAnalyticsExamScores } from '../../api.js';
import { el, mount } from '../../dom.js';
import { pageHeader } from '../../instructor-ui.js';
import type { RouteParams } from '../../router.js';
import { errorState, loadingState } from '../../ui.js';
import { renderRichText } from '../../render.js';
import { scoresPanel } from './analytics-scores.js';

async function renderInner(outlet: HTMLElement, courseId: string, puid: string, workspace: 'instructor' | 'ta'): Promise<void> {
  const root = el('div', { class: 'view student-master-profile' }, loadingState('Loading student profile…')); mount(outlet, root);
  try {
    const profile = await getStudentAnalytics(courseId, puid);
    if (!root.isConnected) return;
    const objectives = profile.objectives ?? [];
    const label = (id: string) => objectives.find(o => o.loId === id)?.name ?? 'Archived learning objective';
    const active = objectives.map(o => ({ ...o, mastery: profile.mastery.find(m => m.loId === o.loId) }));
    const content = el('div', { class: 'master-profile-content' });
    const tabs = el('nav', { class: 'analytics-workbench-tabs', 'aria-label': 'Student profile views' });
    let revision = 0;
    root.replaceChildren(el('a', { class: 'breadcrumb-back', href: `#/${workspace}/course/${encodeURIComponent(courseId)}/analytics`, text: '← Back to Student Analytics' }),
      pageHeader(profile.student.displayName, `Student Master Profile · ${profile.student.uid}`),
      el('p', { class: 'muted', text: 'Latest course-wide mastery and complete recorded history. Independent of dashboard date and mode filters.' }),
      el('div', { class: 'analytics-metrics' }, ...[
        [String(active.filter(o => o.mastery?.status === 'covered').length) + ' / ' + objectives.length, 'Active objectives covered'],
        [String(active.filter(o => !o.mastery || o.mastery.status === 'not-attempted').length), 'Not attempted — not a failure'],
        [String(profile.engagement.attempts), 'Recorded attempts across all modes'],
      ].map(([value, text]) => el('div', { class: 'analytics-metric' }, el('strong', { text: value }), el('span', { text })))),
      el('div', { class: 'master-profile-layout' }, el('div', { class: 'master-profile-main' }, tabs, content),
        el('aside', { class: 'master-teaching-context' }, el('h2', { text: 'Teaching context' }), el('p', { text: 'Mastery is evaluated per learning objective. Inspect the recorded answers before interpreting a struggle signal.' }),
          el('h3', { text: 'Review Book' }), el('p', { text: `${profile.reviewBook.length} saved questions` }),
          el('h3', { text: 'Engagement' }), el('p', { text: `${profile.engagement.sessions} observed sessions · ${profile.engagement.attempts} recorded attempts` }),
          el('p', { text: 'Session duration estimates recorded activity, not time studying. A struggle signal is a prompt for review, not a diagnosis.' }))));
    const rich = (text: string) => { const node = el('div'); renderRichText(node, text); return node; };
    async function show(name: string): Promise<void> {
      const request = ++revision;
      tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.textContent === name)));
      content.replaceChildren();
      if (name === 'Mastery') {
        content.append(el('p', { class: 'muted', text: 'Mastery is a persisted judgment per LO, not a numeric grade. Window accuracy covers the most recent 10 attempts.' }),
          el('div', { class: 'analytics-table-wrap' }, el('table', { class: 'analytics-table' },
            el('thead', {}, el('tr', {}, ...['Learning objective', 'Status', 'Evidence & rationale'].map(text => el('th', { scope: 'col', text })))),
            el('tbody', {}, ...active.map(o => el('tr', {},
              el('td', {}, el('strong', { text: o.name }), el('small', { text: o.topic })),
              el('td', { text: (o.mastery?.status ?? 'not-attempted').replace(/-/g, ' ') }),
              el('td', {}, el('p', { text: o.mastery ? `${o.mastery.attemptCount} attempts · ${Math.round(o.mastery.windowAccuracy * 100)}% recent-window accuracy` : 'No mastery evidence recorded.' }),
                o.mastery?.rationale ? el('p', { text: o.mastery.rationale }) : false,
                o.mastery?.updatedAt ? el('small', { text: `Record updated ${new Date(o.mastery.updatedAt).toLocaleString()}` }) : false,
                o.mastery?.examVerified ? el('small', { text: 'Exam qualifier recorded' }) : false,
                o.mastery?.skipped ? el('small', { text: `Skipped: ${o.mastery.skipped.replace(/-/g, ' ')}` }) : false)))))));
        if (!active.length) content.append(el('p', { text: 'No active learning objectives.' }));
        const retained = profile.mastery.filter(m => !objectives.some(o => o.loId === m.loId));
        if (retained.length) content.append(el('details', {}, el('summary', { text: `${retained.length} retained mastery records for inactive objectives` }), ...retained.map(m => el('p', { text: `${m.status} · ${m.attemptCount} attempts · ${m.rationale ?? ''}` }))));
      }
      if (name === 'Answer history') {
        content.append(el('p', { class: 'muted', text: 'Newest first. Each entry uses its recorded version and saved parameter values.' }));
        for (const a of [...profile.history].reverse()) content.append(el('details', { class: 'master-attempt' },
          el('summary', { text: `${new Date(a.createdAt).toLocaleString()} · ${a.mode} · ${a.correct ? 'Correct' : 'Incorrect'} · ${label(a.loId)}` }),
          el('p', { text: `Selected ${a.selectedKey} · ${a.selectedRole} · ${a.difficulty}${a.isRetry ? ' · Retry' : ''}` }),
          a.stem ? rich(a.stem) : el('p', { text: 'The recorded question version is unavailable. The answer record is retained.' }),
          ...((a.options ?? []).map(o => el('div', { class: 'master-answer' }, rich(`${o.key}. ${o.text}`), el('small', { text: o.role.replace(/-/g, ' ') }), rich(o.explanation))))));
        if (!profile.history.length) content.append(el('p', { text: 'No recorded attempts.' }));
      }
      if (name === 'Exam scores') {
        content.append(loadingState('Loading submitted scores…'));
        try { const scores = await getAnalyticsExamScores(courseId, { puid }); if (request === revision && root.isConnected) content.replaceChildren(scoresPanel(scores.items, courseId, false)); }
        catch (e) { if (request === revision) content.replaceChildren(errorState(e instanceof Error ? e.message : String(e), () => void show(name))); }
      }
      if (name === 'Events & activity') {
        content.append(el('h2', { text: 'Learning activity' }), el('p', { text: `${profile.engagement.sessions} observed sessions · ${profile.engagement.topicPracticeAttempts} Topic Practice attempts · ${profile.engagement.examPrepAttempts} Exam Prep attempts` }),
          el('p', { text: profile.engagement.lastAttemptAt ? `Last activity: ${new Date(profile.engagement.lastAttemptAt).toLocaleString()}` : 'No activity yet.' }),
          el('h3', { text: `Review Book · ${profile.reviewBook.length} saved questions` }),
          ...profile.reviewBook.map(entry => el('p', { text: `Saved question · updated ${new Date(entry.updatedAt).toLocaleString()}` })),
          el('h3', { text: 'Recorded flag events' }), ...profile.flags.map(f => el('article', { class: 'master-attempt' }, el('strong', { text: `${f.state} · ${new Date(f.createdAt).toLocaleString()}` }), el('p', { text: f.reason ?? 'No reason recorded.' }))),
          el('p', { class: 'muted', text: 'This view shows recorded question flags. It does not infer redirect events or past mastery transitions from the latest mastery snapshot.' }));
        if (!profile.flags.length) content.append(el('p', { text: 'No recorded question flags.' }));
      }
    }
    tabs.append(...['Mastery', 'Answer history', 'Exam scores', 'Events & activity'].map(name => el('button', { type: 'button', onclick: () => show(name) }, name)));
    await show('Mastery');
  } catch (e) { root.replaceChildren(errorState(e instanceof Error ? e.message : String(e), () => void renderInner(outlet, courseId, puid, workspace))); }
}
export function renderStudentProfile(outlet: HTMLElement, params: RouteParams, workspace: 'instructor' | 'ta' = 'instructor'): void { void renderInner(outlet, params.id, params.puid, workspace); }
