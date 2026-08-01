import { ApiError, getStudentAnalytics } from '../../api.js';
import { el, mount } from '../../dom.js';
import { pageHeader } from '../../instructor-ui.js';
import type { RouteParams } from '../../router.js';
import { errorState, loadingState } from '../../ui.js';

async function renderInner(outlet: HTMLElement, courseId: string, puid: string): Promise<void> {
  const body = el('div', {}, loadingState('Loading student analytics…'));
  mount(outlet, el('div', { class: 'view' }, body));
  try {
    const profile = await getStudentAnalytics(courseId, puid);
    body.replaceChildren(
      el('a', { class: 'breadcrumb-back', href: `#/instructor/course/${encodeURIComponent(courseId)}/analytics`, text: '← Back to Student Analytics' }),
      pageHeader(profile.student.displayName, `${profile.student.uid} · ${profile.student.email}`),
      el('section', { class: 'card stack' },
        el('h2', { text: 'Engagement' }),
        el('p', { text: `${profile.engagement.attempts} attempts across ${profile.engagement.sessions} sessions` }),
        el('p', { text: `Topic Practice: ${profile.engagement.topicPracticeAttempts} · Exam Prep: ${profile.engagement.examPrepAttempts}` }),
        profile.engagement.lastAttemptAt ? el('p', { text: `Last active ${new Date(profile.engagement.lastAttemptAt).toLocaleString()}` }) : false,
      ),
      el('section', { class: 'card stack' },
        el('h2', { text: 'Mastery by LO' }),
        ...(profile.mastery.length ? profile.mastery.map((item) => el('div', { class: 'cluster' },
          el('span', { class: 'mono', text: String(item.loId) }),
          el('strong', { text: item.status }),
          el('span', { text: `${Math.round(item.windowAccuracy * 100)}% · ${item.attemptCount} attempts` }),
          item.examVerified ? el('span', { class: 'badge', text: 'Exam verified' }) : false,
          item.rationale ? el('span', { text: item.rationale }) : false,
        )) : [el('p', { class: 'muted', text: 'No mastery records yet.' })]),
      ),
      el('section', { class: 'card stack' },
        el('h2', { text: 'Chronological attempt history' }),
        ...(profile.history.length ? profile.history.map((attempt) => el('p', {
          text: `${new Date(attempt.createdAt).toLocaleString()} · ${attempt.mode} · ${attempt.correct ? 'Correct' : 'Miss'}`,
        })) : [el('p', { class: 'muted', text: 'No attempts yet.' })]),
      ),
      el('section', { class: 'card stack' },
        el('h2', { text: `Review Book (${profile.reviewBook.length})` }),
        el('h2', { text: `Flag events (${profile.flags.length})` }),
        ...profile.flags.map((flag) => el('p', { text: `${flag.state}: ${flag.reason || 'No reason supplied'}` })),
      ),
    );
  } catch (error) {
    const message = error instanceof ApiError ? error.message : (error as Error).message;
    body.replaceChildren(errorState(message, () => void renderInner(outlet, courseId, puid)));
  }
}

export function renderStudentProfile(outlet: HTMLElement, params: RouteParams): void {
  void renderInner(outlet, params.id, params.puid);
}
