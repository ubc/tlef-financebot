// In-app notification bell (§4.3, §9.1) — Task 3. A persistent top-bar
// widget: one instance is built into each shell's `topbar__right` (see
// main.ts's buildInstructorShell/buildStudentShell), so unlike a per-view
// widget it must keep polling ACROSS navigations, only stopping when the
// shell itself is torn down (logout, or a 401 re-bootstrap replacing the
// whole app root). Follows the same self-teardown-via-isConnected pattern as
// views/instructor/materials.ts's poll loop, just checked against this
// widget's own wrapper element instead of a per-view root.
import { el, mount } from './dom.js';
import { listNotifications, markNotificationRead, markAllNotificationsRead, type AppNotification } from './api.js';

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
 * tiering) via `.notif-item--elevated`. Opening the panel marks nothing read
 * automatically -- only clicking an individual (unread) notification, or
 * "Mark all read", does; that keeps a quick glance at the badge from
 * silently clearing state the user hasn't actually looked at yet.
 */
export function createNotificationBell(): HTMLElement {
  const button = el(
    'button',
    { class: 'icon-btn notif-bell', type: 'button', 'aria-label': 'Notifications', title: 'Notifications' },
    '🔔',
  );
  const badge = el('span', { class: 'notif-bell__badge' });
  const panel = el('div', { class: 'notif-panel' });
  const wrap = el('div', { class: 'notif-bell-wrap' }, button, badge, panel);

  let notifications: AppNotification[] = [];
  let open = false;
  let intervalId: ReturnType<typeof setInterval> | undefined;

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
        onclick: () => void handleOpenItem(n),
      },
      el('span', { class: 'notif-item__icon', 'aria-hidden': 'true', text: n.priority === 'elevated' ? '⚠' : '●' }),
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
          { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => void handleMarkAll() },
          'Mark all read',
        ),
      ),
      el('div', { class: 'notif-panel__list' }, ...notifications.map((n) => renderItem(n))),
    );
  }

  async function handleOpenItem(n: AppNotification): Promise<void> {
    if (n.readAt) return;
    try {
      const updated = await markNotificationRead(n.id);
      notifications = notifications.map((x) => (x.id === n.id ? updated : x));
    } catch {
      // Transient failure -- leave local state as-is; the next poll reconciles.
    }
    syncBadge();
    renderPanel();
  }

  async function handleMarkAll(): Promise<void> {
    try {
      await markAllNotificationsRead();
      const now = new Date().toISOString();
      notifications = notifications.map((n) => (n.readAt ? n : { ...n, readAt: now }));
    } catch {
      // Transient failure -- leave local state as-is; the next poll reconciles.
    }
    syncBadge();
    renderPanel();
  }

  function toggle(): void {
    open = !open;
    renderPanel();
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
      document.removeEventListener('click', onDocumentClick);
      return;
    }
    if (open && !wrap.contains(e.target as Node)) {
      open = false;
      renderPanel();
    }
  }
  document.addEventListener('click', onDocumentClick);

  async function poll(): Promise<void> {
    if (!wrap.isConnected) {
      if (intervalId !== undefined) {
        clearInterval(intervalId);
        intervalId = undefined;
      }
      return;
    }
    try {
      notifications = await listNotifications();
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
    '🔔',
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
