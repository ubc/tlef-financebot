import type { Session } from './auth.js';
import { el } from './dom.js';
import { currentQuery } from './router.js';

export type WorkspaceRole = 'admin' | 'instructor' | 'ta' | 'student';
export const ROLE_LABELS: Record<WorkspaceRole, string> = { admin: 'Admin', instructor: 'Instructor', ta: 'TA', student: 'Student' };
const memory = new Map<string, WorkspaceRole>();

export function availableWorkspaceRoles(session: Session): WorkspaceRole[] {
  const user = session.user;
  if (!user) return [];
  if (user.isAdmin) return ['admin', 'instructor', 'ta', 'student'];
  if (user.platformInstructor || user.courseRoles.some(entry => entry.role === 'instructor')) return ['instructor', 'ta', 'student'];
  if (user.courseRoles.some(entry => entry.role === 'ta')) return ['ta', 'student'];
  return ['student'];
}

/** A presentation preference only. The authenticated session and grants never change. */
export function selectedWorkspaceRole(session: Session): WorkspaceRole {
  const roles = availableWorkspaceRoles(session);
  const requested = currentQuery().get('workspace') as WorkspaceRole | null;
  if (requested && roles.includes(requested)) return requested;
  const key = `financebot:workspace-role:${session.user?.puid ?? ''}`;
  let saved = memory.get(key);
  try { saved = sessionStorage.getItem(key) as WorkspaceRole ?? saved; } catch { /* memory fallback */ }
  return saved && roles.includes(saved) ? saved : roles[0] ?? 'student';
}

/** Called after the router has accepted navigation, including unsaved-work guards. */
export function rememberWorkspaceRole(session: Session, role: WorkspaceRole): void {
  if (!availableWorkspaceRoles(session).includes(role)) return;
  const key = `financebot:workspace-role:${session.user?.puid ?? ''}`;
  memory.set(key, role);
  try { sessionStorage.setItem(key, role); } catch { /* memory fallback */ }
}

export function workspaceCourseId(): string | undefined {
  const match = /^#\/(?:instructor\/|preview\/|ta\/)?course\/([^/?]+)/.exec(location.hash);
  return match ? decodeURIComponent(match[1]) : undefined;
}

export function canPreviewCourse(session: Session, courseId?: string): boolean {
  return Boolean(session.user && (session.user.isAdmin || session.user.courseRoles.some(entry =>
    (!courseId || entry.courseId === courseId) && (entry.role === 'instructor' || entry.role === 'ta'))));
}

export function workspaceHref(session: Session, role: WorkspaceRole, courseId = workspaceCourseId()): string {
  const user = session.user;
  const teaches = courseId && (user?.isAdmin || user?.courseRoles.some(entry => entry.courseId === courseId && entry.role === 'instructor'));
  const teachingTeam = courseId && canPreviewCourse(session, courseId);
  const path = role === 'admin' ? '/admin/users'
    : role === 'instructor' ? teaches ? `/instructor/course/${encodeURIComponent(courseId!)}` : '/instructor/courses'
      : role === 'ta' ? teachingTeam ? `/ta/course/${encodeURIComponent(courseId!)}/review` : '/ta/courses'
        : availableWorkspaceRoles(session).length > 1
          ? teachingTeam ? `/preview/course/${encodeURIComponent(courseId!)}` : '/preview/courses'
          : '/';
  return `#${path}?workspace=${role}`;
}

export function createRoleSwitcher(session: Session, current: WorkspaceRole): HTMLElement {
  const roles = availableWorkspaceRoles(session);
  const primary = roles[0];
  const details = el('details', { class: 'role-switcher' });
  const trigger = el('summary', { class: 'role-switcher__trigger', role: 'button', 'aria-expanded': 'false', 'aria-controls': 'workspace-role-options', 'aria-label': `Switch role, current role ${ROLE_LABELS[current]}` },
    el('span', { class: 'role-switcher__label', text: ROLE_LABELS[current] }));
  const menu = el('nav', { class: 'role-switcher__menu', id: 'workspace-role-options', 'aria-label': 'Switch role' },
    el('span', { class: 'role-switcher__hint', text: 'Workspace' }),
    ...roles.map(role => el('a', {
      class: 'role-switcher__option', href: workspaceHref(session, role),
      'aria-current': role === current ? 'page' : undefined,
      'aria-label': role === primary && current !== primary ? `Back to ${ROLE_LABELS[role]}` : `Switch to ${ROLE_LABELS[role]}`,
      onclick: (event: Event) => {
        if (role === current) event.preventDefault();
        details.open = false;
      },
    }, el('span', { text: role === primary && current !== primary ? `Back to ${ROLE_LABELS[role]}` : ROLE_LABELS[role] }),
    role === current ? el('span', { 'aria-hidden': 'true', text: '✓' }) : false)),
  );
  // Resolve course context at opening time; the shell survives in-course navigation.
  details.addEventListener('toggle', () => {
    trigger.setAttribute('aria-expanded', String(details.open));
    if (!details.open) return;
    menu.querySelectorAll<HTMLAnchorElement>('a').forEach((link, index) => { link.href = workspaceHref(session, roles[index]); });
  });
  details.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.stopPropagation(); details.open = false; trigger.focus(); }
  });
  details.addEventListener('focusout', event => {
    if (event.relatedTarget instanceof Node && !details.contains(event.relatedTarget)) details.open = false;
  });
  details.append(trigger, menu);
  return details;
}
