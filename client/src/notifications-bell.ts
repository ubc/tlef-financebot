// In-app notification bell (§4.3, §9.1) — Task 3. A persistent top-bar
// widget: one instance is built into each shell's `topbar__right` (see
// main.ts's buildInstructorShell/buildStudentShell), so unlike a per-view
// widget it must keep polling ACROSS navigations, only stopping when the
// shell itself is torn down (logout, or a 401 re-bootstrap replacing the
// whole app root). Follows the same self-teardown-via-isConnected pattern as
// views/instructor/materials.ts's poll loop, just checked against this
// widget's own wrapper element instead of a per-view root.
import { el, mount } from './dom.js';
import {
  listNotifications,
  markAllNotificationsRead,
  dismissNotification,
  dismissAllNotifications,
  type AppNotification,
} from './api.js';
import { broadcastNotificationsChanged, subscribeNotificationsChanged } from './notification-sync.js';
import { notificationTarget, type NotificationAudience } from './notification-target.js';

const POLL_INTERVAL_MS = 30_000;

function unreadCount(notifications: AppNotification[]): number {
  return notifications.filter((n) => !n.readAt).length;
}

/** Compact relative timestamp ("just now", "5m ago", "3h ago", "2d ago"),
 * falling back to a plain date past a week -- notifications are meant to be
 * skimmed, not audited, so precision to the minute isn't the goal. */
function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Builds the bell + its dropdown panel, and starts 30s polling immediately.
 * Elevated notifications (auto-pause) get a distinct border + icon (§4.3
 * tiering) via `.notif-item--elevated`.
 *
 * Interaction model (confirmed with Saurav, 2026-08-02) is the phone-style
 * one: OPENING the panel marks everything read, so the badge is a "since you
 * last looked" counter; CLICKING an item navigates to the relevant flag
 * queue and dismisses it; "Clear all" empties the list outright. Dismissal is
 * safe here because the bell is a nudge surface, not a record -- the flag
 * queue retains every flag regardless of what happens in here. This reverses
 * the earlier "opening marks nothing read" rule, which left the badge
 * stuck-on and the list growing without bound.
 */
export function createNotificationBell(audience: NotificationAudience): HTMLElement {
  const button = el(
    'button',
    { class: 'icon-btn notif-bell', type: 'button', 'aria-label': 'Notifications', title: 'Notifications' },
    el('span', { class: 'notif-bell__icon', 'aria-hidden': 'true' }),
  );
  const badge = el('span', { class: 'notif-bell__badge' });
  const panel = el('div', { class: 'notif-panel' });
  const wrap = el('div', { class: 'notif-bell-wrap' }, button, badge, panel);

  let notifications: AppNotification[] = [];
  let open = false;
  let intervalId: ReturnType<typeof setInterval> | undefined;
  const unsubscribeNotificationsChanged = subscribeNotificationsChanged(() => void poll());
  // Ids dismissed locally (single or "clear all") whose server confirmation
  // is still in flight. poll() runs on a 30s interval, on window focus, and
  // on visibilitychange -- any of those can land mid-request and, without
  // this guard, would overwrite the optimistic removal with the
  // not-yet-dismissed server list until the *next* tick fixes it (up to 30s
  // of a resurrected row/list). poll() filters these ids out of whatever it
  // fetches; the handlers add an id when they start a dismiss and remove it
  // once the server request settles, success or failure.
  const pendingDismissIds = new Set<string>();

  function syncBadge(): void {
    const count = unreadCount(notifications);
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.hidden = count === 0;
    // Fold the unread count into the button's own accessible name -- it must
    // not live only in the sibling badge <span>, which sits outside the
    // button and so isn't announced as part of it.
    const label = count > 0 ? `Notifications (${count} unread)` : 'Notifications';
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
  }

  function renderItem(n: AppNotification): HTMLElement {
    const unread = !n.readAt;
    return el(
      'button',
      {
        class: `notif-item${n.priority === 'elevated' ? ' notif-item--elevated' : ''}${unread ? ' notif-item--unread' : ''}`,
        type: 'button',
        onclick: () => void handleActivate(n),
      },
      el('span', {
        class: `notif-item__icon${n.priority === 'elevated' ? ' notif-item__icon--elevated' : ''}`,
        'aria-hidden': 'true',
      }),
      el(
        'div',
        { class: 'notif-item__body' },
        el('p', { class: 'notif-item__text', text: n.body }),
        el('span', { class: 'notif-item__time', text: formatRelative(n.createdAt) }),
      ),
    );
  }

  function renderPanel(): void {
    button.setAttribute('aria-expanded', String(open));
    panel.hidden = !open;
    if (!open) return;
    if (notifications.length === 0) {
      mount(panel, el('p', { class: 'notif-panel__empty', text: 'No notifications yet.' }));
      return;
    }
    mount(
      panel,
      el(
        'div',
        { class: 'notif-panel__head' },
        el('span', { text: 'Notifications' }),
        el(
          'button',
          { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => void handleClearAll() },
          'Clear all',
        ),
      ),
      el('div', { class: 'notif-panel__list' }, ...notifications.map((n) => renderItem(n))),
    );
  }

  /** Click = go there and dismiss. The list is updated optimistically so the
   * panel never shows a row the user has already dealt with; a failed
   * dismissal is simply reconciled by the next poll rather than surfaced,
   * matching how the rest of this widget treats transient errors. */
  async function handleActivate(n: AppNotification): Promise<void> {
    const target = notificationTarget(n, audience);
    notifications = notifications.filter((x) => x.id !== n.id);
    open = false;
    pendingDismissIds.add(n.id);
    syncBadge();
    renderPanel();
    if (target) window.location.hash = target;
    try {
      await dismissNotification(n.id);
      broadcastNotificationsChanged();
    } catch {
      // Transient failure -- the next poll restores the row rather than
      // silently swallowing it.
    } finally {
      // Either the server now agrees it's dismissed (so it won't be in the
      // next poll's response anyway), or the request failed and the id must
      // stop being filtered so a legitimate poll-driven restore can happen.
      pendingDismissIds.delete(n.id);
    }
  }

  /** "Clear all" -- empties the bell, read and unread alike. Rolled back on
   * failure because, unlike a single dismissal, silently dropping the whole
   * list would be a large and confusing loss to reconcile 30s later. */
  async function handleClearAll(): Promise<void> {
    const previous = notifications;
    previous.forEach((n) => pendingDismissIds.add(n.id));
    notifications = [];
    syncBadge();
    renderPanel();
    try {
      await dismissAllNotifications();
      broadcastNotificationsChanged();
    } catch {
      notifications = previous;
      syncBadge();
      renderPanel();
    } finally {
      previous.forEach((n) => pendingDismissIds.delete(n.id));
    }
  }

  /** Opening the panel is the "I have looked at these" signal, so it clears
   * the badge. Fire-and-forget: the badge is already zeroed locally, and the
   * next poll reconciles if the request failed. */
  async function markPanelRead(): Promise<void> {
    if (unreadCount(notifications) === 0) return;
    const now = new Date().toISOString();
    notifications = notifications.map((n) => (n.readAt ? n : { ...n, readAt: now }));
    syncBadge();
    renderPanel();
    try {
      await markAllNotificationsRead();
      broadcastNotificationsChanged();
    } catch {
      // Transient failure -- next poll reconciles.
    }
  }

  function toggle(): void {
    open = !open;
    renderPanel();
    if (open) void markPanelRead();
  }

  button.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle();
  });

  // Click-outside closes the panel. Self-tears-down the moment `wrap` is no
  // longer attached (shell rebuilt on logout / 401 re-bootstrap) instead of
  // requiring an explicit unmount hook, mirroring the poll loop's own
  // isConnected self-teardown below.
  function onDocumentClick(e: MouseEvent): void {
    if (!wrap.isConnected) {
      removeGlobalListeners();
      return;
    }
    if (open && !wrap.contains(e.target as Node)) {
      open = false;
      renderPanel();
    }
  }
  document.addEventListener('click', onDocumentClick);

  function refreshWhenVisible(): void {
    if (document.visibilityState === 'visible') void poll();
  }

  function removeGlobalListeners(): void {
    document.removeEventListener('click', onDocumentClick);
    document.removeEventListener('visibilitychange', refreshWhenVisible);
    window.removeEventListener('focus', refreshWhenVisible);
    unsubscribeNotificationsChanged();
  }

  // An Instructor commonly keeps this shell open beside a Student Preview
  // tab. Refresh immediately when they return instead of making that
  // two-tab workflow wait for the next 30-second poll.
  document.addEventListener('visibilitychange', refreshWhenVisible);
  window.addEventListener('focus', refreshWhenVisible);

  async function poll(): Promise<void> {
    if (!wrap.isConnected) {
      if (intervalId !== undefined) {
        clearInterval(intervalId);
        intervalId = undefined;
      }
      removeGlobalListeners();
      return;
    }
    try {
      const fetched = await listNotifications();
      // Drop anything still mid-dismiss locally -- the server may not have
      // processed that request yet, and applying its stale response here
      // would resurrect a row (or the whole list, for "clear all") that the
      // user already dismissed, with nothing to fix it until the next tick.
      notifications = pendingDismissIds.size === 0 ? fetched : fetched.filter((n) => !pendingDismissIds.has(n.id));
    } catch {
      // Transient failure -- keep the last known list and try again next tick.
    }
    syncBadge();
    if (open) renderPanel();
  }

  intervalId = setInterval(() => void poll(), POLL_INTERVAL_MS);
  // Shell builders call createNotificationBell() while constructing the
  // topbar, before that topbar is appended to the document. Calling poll()
  // synchronously here made its `!wrap.isConnected` teardown branch cancel
  // the interval permanently on every normal page load. A microtask still
  // populates immediately from the user's perspective, but runs after the
  // synchronous shell construction/mount has completed.
  queueMicrotask(() => void poll());

  syncBadge();
  renderPanel();

  return wrap;
}

/** The exact student-shell bell treatment with an intentionally empty,
 * non-persisting inbox for a fresh anonymous Preview session. */
export function createAnonymousNotificationBell(): HTMLElement {
  const button = el(
    'button',
    {
      class: 'icon-btn notif-bell',
      type: 'button',
      'aria-label': 'Notifications',
      title: 'Notifications',
      'aria-expanded': 'false',
    },
    el('span', { class: 'notif-bell__icon', 'aria-hidden': 'true' }),
  );
  const badge = el('span', { class: 'notif-bell__badge', hidden: true });
  const panel = el(
    'div',
    { class: 'notif-panel', hidden: true },
    el('p', { class: 'notif-panel__empty', text: 'No notifications yet.' }),
  );
  const wrap = el('div', { class: 'notif-bell-wrap' }, button, badge, panel);
  button.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(!open));
    panel.hidden = open;
  });
  return wrap;
}
