import { openPeopleInvitation } from './course-people-invite.js';
import { el } from './dom.js';
import { confirmDialog } from './modal.js';
import { loadingState } from './ui.js';
import {
  addCourseInstructor, getCourseSharing, removeCourseInstructor, revokeCourseInvitation,
  type CourseInstructorMember, type CourseSharingSummary,
} from './course-sharing-api.js';

interface SharingPanel {
  element: HTMLElement;
  refresh(): Promise<void>;
  busy(): boolean;
  dispose(): void;
}

let instance = 0;
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : 'Course sharing could not be updated. Try again.';

/** A restricted destination, never a bearer token or public access grant. */
export function restrictedCourseLink(courseId: string): string {
  return `${window.location.origin}/#/instructor/course/${encodeURIComponent(courseId)}?workspace=instructor`;
}

/** Shared by the topbar Share dialog and the Co-instructors page. */
export function createCourseSharingPanel(courseId: string): SharingPanel {
  const id = `course-sharing-${++instance}`;
  let summary: CourseSharingSummary | undefined;
  let pending = false;
  let mutationPending = false;
  let disposed = false;
  let generation = 0;
  const root = el('section', { class: 'course-sharing', 'aria-label': 'Course sharing' });
  const courseName = el('h3', { class: 'course-sharing__course', text: 'Course access' });
  const courseMeta = el('p', { class: 'course-sharing__meta' });
  const notice = el('p', { class: 'course-sharing__notice', role: 'status', 'aria-live': 'polite' });
  const errors = el('p', { class: 'course-sharing__error', role: 'alert' });
  const list = el('div', { class: 'course-sharing__members' }, loadingState('Loading course access…'));
  const identifier = el('input', {
    id: `${id}-identifier`, class: 'input', type: 'text', required: true, maxlength: 254,
    placeholder: 'name@ubc.ca or CWL', autocomplete: 'off', 'aria-describedby': `${id}-invite-note`,
  });
  const add = el('button', { class: 'btn btn--instr-primary course-sharing__primary', type: 'submit', text: 'Add co-instructor' });
  const invitationForm = el('form', {
    class: 'course-sharing__invite', hidden: true,
    onsubmit: (event: Event) => {
      event.preventDefault();
      if (pending || !summary?.canManage) return undefined;
      const account = identifier.value.trim().toLowerCase();
      const validEmail = /^[^@\s]+@(?:[a-z0-9-]+\.)*ubc\.ca$/i.test(account);
      const validCwl = /^[a-z0-9._-]{2,64}$/i.test(account);
      if (!(account.includes('@') ? validEmail : validCwl)) {
        errors.textContent = 'Enter a UBC email address or CWL login name.';
        identifier.focus();
        return undefined;
      }
      return mutate(async () => {
        const next = await addCourseInstructor(courseId, account);
        identifier.value = '';
        return next;
      }, next => account.includes('@') && next.invitations.some(invitation => invitation.email === account && invitation.status === 'pending')
        ? 'Invitation saved. Access starts when this person signs in with the matching UBC account.'
        : 'Co-instructor access is active.');
    },
  },
  el('label', { class: 'course-sharing__label', for: `${id}-identifier`, text: 'UBC email or CWL' }),
  el('div', { class: 'course-sharing__invite-row' }, identifier, add),
  el('p', { id: `${id}-invite-note`, class: 'course-sharing__note', text: 'Email can invite someone before first sign-in. A CWL login name must belong to an existing account. No email is sent.' }));
  const readOnly = el('p', { class: 'course-sharing__readonly', hidden: true, text: 'Only the course owner or an Admin can add or remove co-instructors.' });
  const refresh = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Refresh access', onclick: () => load() });
  const link = el('input', {
    class: 'input course-sharing__link', type: 'text', readonly: true,
    'aria-label': 'Restricted course link', value: restrictedCourseLink(courseId),
    onclick: () => link.select(),
  });
  const copy = el('button', {
    class: 'btn btn--secondary btn--sm', type: 'button', text: 'Copy link',
    onclick: async () => {
      errors.textContent = '';
      try {
        await navigator.clipboard.writeText(link.value);
        if (!disposed) notice.textContent = 'Course link copied. Only people with course access can open it.';
      } catch {
        if (disposed) return;
        link.focus(); link.select();
        errors.textContent = 'The link could not be copied automatically. Copy the selected course link.';
      }
    },
  });
  root.append(
    el('header', { class: 'course-sharing__heading' }, el('div', {}, courseName, courseMeta), refresh),
    notice, errors, invitationForm, readOnly,
    el('section', { 'aria-labelledby': `${id}-people` }, el('h3', { id: `${id}-people`, class: 'course-sharing__section-title', text: 'People with access' }), list),
    el('section', { class: 'course-sharing__restricted', 'aria-labelledby': `${id}-restricted` },
      el('h3', { id: `${id}-restricted`, class: 'course-sharing__section-title', text: 'Restricted course link' }),
      el('p', { class: 'course-sharing__note', text: 'Only people already added to this course can open this link. Sharing the link does not grant access.' }),
      el('div', { class: 'course-sharing__link-row' }, link, copy)),
  );

  function setPending(value: boolean): void {
    pending = value;
    refresh.disabled = value;
    identifier.disabled = value;
    add.disabled = value || !summary?.canManage;
    root.querySelectorAll<HTMLButtonElement>('[data-sharing-mutation]').forEach(button => { button.disabled = value; });
    root.setAttribute('aria-busy', String(value));
    root.dispatchEvent(new CustomEvent('course-sharing-busy', { detail: mutationPending }));
  }

  function memberRow(member: CourseInstructorMember): HTMLElement {
    const label = member.displayName || member.email || member.puid;
    const remove = summary?.canManage && member.role !== 'owner'
      ? el('button', {
        class: 'btn btn--ghost btn--sm course-sharing__remove', type: 'button', 'data-sharing-mutation': true,
        'aria-label': `Remove ${label}`, text: 'Remove',
        onclick: () => removeMember(member),
      }) : false;
    return el('div', { class: 'course-sharing__person', 'data-member-puid': member.puid },
      el('span', { class: 'course-sharing__avatar', 'aria-hidden': true, text: label.split(/\s+/).map(word => word[0]).slice(0, 2).join('').toUpperCase() }),
      el('div', { class: 'course-sharing__person-copy' }, el('strong', { text: label }),
        el('span', { class: 'course-sharing__note', text: member.email || member.puid }),
        member.deactivated ? el('span', { class: 'course-sharing__note', text: 'Account inactive — platform access is blocked' }) : false),
      el('span', { class: 'course-sharing__badge', text: member.role === 'owner' ? 'Owner' : 'Co-instructor' }), remove);
  }

  function apply(next: CourseSharingSummary): void {
    summary = next;
    courseName.textContent = next.courseName;
    courseMeta.textContent = [next.courseCode, next.section ? `Section ${next.section}` : '', next.term].filter(Boolean).join(' · ');
    invitationForm.hidden = !next.canManage;
    readOnly.hidden = next.canManage;
    const invitations = next.invitations.filter(invitation => invitation.status === 'pending');
    list.replaceChildren(...next.members.map(memberRow),
      ...invitations.map(invitation => el('div', { class: 'course-sharing__person', 'data-invitation-id': invitation.id },
        el('span', { class: 'course-sharing__avatar', 'aria-hidden': true, text: '@' }),
        el('div', { class: 'course-sharing__person-copy' }, el('strong', { text: invitation.email }),
          el('span', { class: 'course-sharing__note', text: 'Awaiting first CWL sign-in' })),
        el('span', { class: 'course-sharing__badge course-sharing__badge--pending', text: 'Pending' }),
        next.canManage ? el('button', {
          class: 'btn btn--ghost btn--sm course-sharing__remove', type: 'button', 'data-sharing-mutation': true,
          'aria-label': `Revoke invitation for ${invitation.email}`, text: 'Revoke',
          onclick: () => revokeInvitation(invitation.id, invitation.email),
        }) : false)),
      ...(!next.members.length && !invitations.length ? [el('p', { class: 'course-sharing__note', text: 'No co-instructors have been added.' })] : []),
    );
    setPending(pending);
  }

  async function load(): Promise<void> {
    if (pending || disposed) return;
    const version = ++generation;
    setPending(true); errors.textContent = '';
    if (!summary) list.replaceChildren(loadingState('Loading course access…'));
    try {
      const next = await getCourseSharing(courseId);
      if (disposed || version !== generation) return;
      apply(next);
    } catch (error) {
      if (disposed || version !== generation) return;
      errors.textContent = errorMessage(error);
      if (!summary) list.replaceChildren(el('p', { class: 'course-sharing__note', text: 'Course access could not be loaded. Use Refresh access to try again.' }));
    } finally {
      if (!disposed && version === generation) setPending(false);
    }
  }

  async function mutate(action: () => Promise<CourseSharingSummary>, message: string | ((next: CourseSharingSummary) => string)): Promise<void> {
    if (pending || disposed || !summary?.canManage) return;
    mutationPending = true;
    setPending(true); errors.textContent = ''; notice.textContent = '';
    try {
      const next = await action();
      if (disposed) return;
      apply(next);
      notice.textContent = typeof message === 'function' ? message(next) : message;
    } catch (error) {
      if (!disposed) errors.textContent = errorMessage(error);
    } finally {
      mutationPending = false;
      if (!disposed) setPending(false);
    }
  }

  async function removeMember(member: CourseInstructorMember): Promise<void> {
    if (pending || !summary?.canManage) return;
    if (!await confirmDialog({ title: 'Remove co-instructor?', message: `${member.displayName || member.email || member.puid} will lose Instructor access to this course. Their authored content and other course roles are retained.`, confirmLabel: 'Remove co-instructor', tone: 'danger' })) return;
    await mutate(() => removeCourseInstructor(courseId, member.puid), 'Co-instructor access removed.');
    if (!disposed) refresh.focus();
  }

  async function revokeInvitation(invitationId: string, address: string): Promise<void> {
    if (pending || !summary?.canManage) return;
    if (!await confirmDialog({ title: 'Revoke invitation?', message: `Remove the saved course invitation for ${address}? They will no longer receive access from this invitation.`, confirmLabel: 'Revoke invitation', tone: 'danger' })) return;
    await mutate(() => revokeCourseInvitation(courseId, invitationId), 'Invitation revoked.');
    if (!disposed) refresh.focus();
  }

  return { element: root, refresh: load, busy: () => mutationPending, dispose: () => { disposed = true; generation++; } };
}

/** Share and People use the same role-aware invitation form. */
export function openCourseSharing(courseId: string): void { void openPeopleInvitation(courseId, true); }
