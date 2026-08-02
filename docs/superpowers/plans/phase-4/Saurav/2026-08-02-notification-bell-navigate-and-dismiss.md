# Notification Bell — Navigate & Dismiss Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Owner:** Saurav

**Goal:** Make the notification bell actionable — clicking a notification navigates to the relevant flag queue and dismisses it, opening the bell clears the unread badge, and a "Clear all" button empties the list for good.

**Architecture:** Dismissal becomes server-side state (a `dismissedAt` timestamp on the `Notification` document) because the bell polls every 30s and would otherwise resurrect anything cleared only in the browser. Route resolution lives in a new pure client module, `client/src/notification-target.ts`, so it is unit-testable under Jest's Node environment — the bell's own DOM behaviour is covered by Playwright instead (see `tests/AGENTS.md`: units are server-side; client DOM belongs to the e2e layer). Both flag-queue views gain a query-param-driven scroll-and-highlight so a notification lands the user on the exact flag.

**Tech Stack:** TypeScript, Express + MongoDB (server), vanilla TS + hash router (client), Jest + ts-jest + supertest (unit), Playwright (e2e).

## Global Constraints

- **Product decision (confirmed with Saurav, 2026-08-02):** clicking a notification dismisses it iPhone-style. This is safe *because the flag queue is the durable record* — the notification is a disposable nudge, not the only pointer to the work.
- **"Clear all" clears everything**, read or unread. Not just read ones.
- **Opening the bell clears the unread badge.** This intentionally reverses the existing decision documented at `client/src/notifications-bell.ts:37-40`; that comment MUST be rewritten, not left contradicting the code.
- **Destination is the flag queue for both audiences**, never the instructor question editor — TAs have no question editor, and the queue is where the flag reasons and Return/Edit/Archive actions live. Role gating inside the queue decides what each audience can actually do.
- **Students never navigate.** `notificationTarget` returns `null` for the student audience, and the student bell keeps its current click-to-dismiss-only behaviour.
- Client sibling imports MUST use an explicit `.js` extension (`client/AGENTS.md` ".js import rule").
- No database or SDK calls directly in a route (`server/src/routes/AGENTS.md`) — all Mongo access goes through the service layer.
- Every notification service call is scoped by the **authenticated** user's `puid`, never one taken from body/params/query. Preserve this in the new endpoints.
- Commit after every task. Do not add `Co-Authored-By: Claude` trailers.

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `server/src/types/domain.ts` | `Notification` shape | Modify — add `dismissedAt?: Date` |
| `server/src/services/notifications.service.ts` | All Mongo access for notifications | Modify — filter dismissed out of `listNotifications`; add `dismissNotification`, `dismissAllNotifications` |
| `server/src/routes/notifications.routes.ts` | HTTP surface | Modify — add `POST /notifications/:id/dismiss`, `POST /notifications/dismiss-all` |
| `client/src/notification-target.ts` | **Create** — pure `(notification, audience) → path \| null` mapping | New |
| `client/src/api.ts` | Typed fetch bindings | Modify — add `dismissNotification`, `dismissAllNotifications` |
| `client/src/notifications-bell.ts` | Bell widget behaviour | Modify — audience param, open-clears-badge, click navigates + dismisses, "Clear all" |
| `client/src/main.ts` | Shell construction | Modify — pass audience at the three `createNotificationBell()` call sites |
| `client/src/views/instructor/flags.ts` | Instructor flag queue | Modify — group data attributes + highlight from `?flag=` / `?question=` |
| `client/src/views/ta/flag-triage.ts` | TA flag triage | Modify — card data attribute + highlight from `?flag=` |
| `client/public/styles/main.css` | Styles | Modify — `--highlight` treatment |
| `tests/unit/notification-target.test.ts` | **Create** — routing table coverage | New |
| `tests/unit/notifications.service.test.ts` | Service coverage | Modify |
| `tests/unit/notifications.routes.test.ts` | Route coverage | Modify |
| `tests/e2e/notification-bell.spec.ts` | **Create** — browser behaviour | New |

---

### Task 1: Server — dismissal state and service functions

**Files:**
- Modify: `server/src/types/domain.ts:585-595`
- Modify: `server/src/services/notifications.service.ts:199-228`
- Test: `tests/unit/notifications.service.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `dismissNotification(id: ObjectId, puid: string): Promise<WithId<Notification>>` — throws `'notification-not-found'` on id/owner mismatch.
  - `dismissAllNotifications(puid: string): Promise<number>` — returns count modified.
  - `listNotifications` keeps its existing signature `(puid: string, opts?: { unreadOnly?: boolean })` but now excludes dismissed documents.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/notifications.service.test.ts`, following the existing `jest.mock('../../server/src/components/mongodb/collections')` pattern already at the top of that file. Add `dismissNotification`, `dismissAllNotifications`, and `listNotifications` to the import block from `notifications.service`.

```ts
describe('dismissal', () => {
  it('listNotifications excludes dismissed notifications', async () => {
    const toArray = jest.fn().mockResolvedValue([]);
    const limit = jest.fn().mockReturnValue({ toArray });
    const sort = jest.fn().mockReturnValue({ limit });
    const find = jest.fn().mockReturnValue({ sort });
    (notificationsCol as jest.Mock).mockReturnValue({ find });

    await listNotifications('PUID-1');

    expect(find).toHaveBeenCalledWith({
      recipientPuid: 'PUID-1',
      dismissedAt: { $exists: false },
    });
  });

  it('listNotifications combines unreadOnly with the dismissed filter', async () => {
    const toArray = jest.fn().mockResolvedValue([]);
    const limit = jest.fn().mockReturnValue({ toArray });
    const sort = jest.fn().mockReturnValue({ limit });
    const find = jest.fn().mockReturnValue({ sort });
    (notificationsCol as jest.Mock).mockReturnValue({ find });

    await listNotifications('PUID-1', { unreadOnly: true });

    expect(find).toHaveBeenCalledWith({
      recipientPuid: 'PUID-1',
      readAt: { $exists: false },
      dismissedAt: { $exists: false },
    });
  });

  it('dismissNotification scopes the update to the owning puid', async () => {
    const id = new ObjectId();
    const updated = { _id: id, recipientPuid: 'PUID-1' } as WithId<Notification>;
    const findOneAndUpdate = jest.fn().mockResolvedValue(updated);
    (notificationsCol as jest.Mock).mockReturnValue({ findOneAndUpdate });

    const result = await dismissNotification(id, 'PUID-1');

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { _id: id, recipientPuid: 'PUID-1' },
      { $set: { dismissedAt: expect.any(Date) } },
      { returnDocument: 'after' },
    );
    expect(result).toBe(updated);
  });

  it('dismissNotification throws when the id/owner pair does not match', async () => {
    (notificationsCol as jest.Mock).mockReturnValue({
      findOneAndUpdate: jest.fn().mockResolvedValue(null),
    });

    await expect(dismissNotification(new ObjectId(), 'PUID-OTHER')).rejects.toThrow('notification-not-found');
  });

  it('dismissAllNotifications clears every non-dismissed notification and returns the count', async () => {
    const updateMany = jest.fn().mockResolvedValue({ modifiedCount: 4 });
    (notificationsCol as jest.Mock).mockReturnValue({ updateMany });

    const count = await dismissAllNotifications('PUID-1');

    expect(updateMany).toHaveBeenCalledWith(
      { recipientPuid: 'PUID-1', dismissedAt: { $exists: false } },
      { $set: { dismissedAt: expect.any(Date) } },
    );
    expect(count).toBe(4);
  });
});
```

Note: `Notification` is already imported as a type in that file's import block; if not, add `import type { Notification } from '../../server/src/types/domain';`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/unit/notifications.service.test.ts -t dismissal`
Expected: FAIL — `dismissNotification is not a function` / `dismissAllNotifications is not a function`, and the two `listNotifications` cases failing on the missing `dismissedAt` filter.

- [ ] **Step 3: Add the field to the domain type**

In `server/src/types/domain.ts`, inside `interface Notification`, add `dismissedAt` immediately after `readAt`:

```ts
  readAt?: Date;
  /** Set when the recipient dismisses the notification from the bell (click
   * or "Clear all"). Dismissed documents are retained for audit but never
   * returned by listNotifications() — the flag queue, not the bell, is the
   * durable record of outstanding work. */
  dismissedAt?: Date;
  createdAt: Date;
```

- [ ] **Step 4: Implement the service changes**

In `server/src/services/notifications.service.ts`, replace `listNotifications` and append the two new functions after `markAllNotificationsRead`:

```ts
export async function listNotifications(
  puid: string,
  opts?: { unreadOnly?: boolean },
): Promise<WithId<Notification>[]> {
  const filter = {
    recipientPuid: puid,
    ...(opts?.unreadOnly ? { readAt: { $exists: false } } : {}),
    // Dismissed notifications stay in the collection but leave the bell for
    // good -- the 30s client poll would otherwise resurrect anything the
    // user cleared.
    dismissedAt: { $exists: false },
  };
  return notificationsCol().find(filter).sort({ createdAt: -1 }).limit(NOTIFICATIONS_LIST_LIMIT).toArray();
}

/** Dismiss one notification. Scoped by (id, recipientPuid) exactly like
 * markNotificationRead, so a user can only ever dismiss their OWN. */
export async function dismissNotification(id: ObjectId, puid: string): Promise<WithId<Notification>> {
  const updated = await notificationsCol().findOneAndUpdate(
    { _id: id, recipientPuid: puid },
    { $set: { dismissedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!updated) throw new Error('notification-not-found');
  return updated;
}

/** Dismiss every not-yet-dismissed notification for this puid ("Clear all");
 * returns the count touched. Deliberately clears read AND unread -- the bell
 * is a nudge surface, and the flag queue keeps the underlying work. */
export async function dismissAllNotifications(puid: string): Promise<number> {
  const result = await notificationsCol().updateMany(
    { recipientPuid: puid, dismissedAt: { $exists: false } },
    { $set: { dismissedAt: new Date() } },
  );
  return result.modifiedCount;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest tests/unit/notifications.service.test.ts`
Expected: PASS — the new `dismissal` block plus every pre-existing test in the file.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck:server
git add server/src/types/domain.ts server/src/services/notifications.service.ts tests/unit/notifications.service.test.ts
git commit -m "feat(notifications): server-side dismissal state"
```

---

### Task 2: Server — dismiss endpoints

**Files:**
- Modify: `server/src/routes/notifications.routes.ts:7` (import), after `:72` (routes)
- Test: `tests/unit/notifications.routes.test.ts`

**Interfaces:**
- Consumes: `dismissNotification(id, puid)`, `dismissAllNotifications(puid)` from Task 1.
- Produces:
  - `POST /api/notifications/:id/dismiss` → the updated notification, id-mapped via the existing `toNotificationResponse`.
  - `POST /api/notifications/dismiss-all` → `{ count: number }`.

**Route-ordering note:** register `dismiss-all` BEFORE `:id/dismiss` is not required here (the paths differ in shape, and `:id` is regex-validated to a 24-hex ObjectId so `dismiss-all` cannot match it), but keep `dismiss-all` adjacent to `read-all` for readability.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/notifications.routes.test.ts`, extend the `jest.mock` factory to include the two new service functions, add them to the import block, then append these describes:

```ts
describe('POST /api/notifications/:id/dismiss', () => {
  it('401s when signed out', async () => {
    const res = await request(makeApp(false)).post(`/api/notifications/${VALID_ID}/dismiss`);
    expect(res.status).toBe(401);
    expect(dismissNotification).not.toHaveBeenCalled();
  });

  it('dismisses with the AUTHENTICATED puid, not a caller-supplied one', async () => {
    (dismissNotification as jest.Mock).mockResolvedValue({
      _id: new ObjectId(VALID_ID),
      recipientPuid: TEST_PUID,
      kind: 'flag',
      priority: 'standard',
      body: 'x',
      createdAt: new Date(),
      dismissedAt: new Date(),
    });

    const res = await request(makeApp(true))
      .post(`/api/notifications/${VALID_ID}/dismiss`)
      .send({ recipientPuid: 'PUID-ATTACKER' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(VALID_ID);
    expect(dismissNotification).toHaveBeenCalledWith(expect.any(ObjectId), TEST_PUID);
  });

  it('rejects a malformed id before reaching the service', async () => {
    const res = await request(makeApp(true)).post('/api/notifications/not-an-objectid/dismiss');
    expect(res.status).toBe(400);
    expect(dismissNotification).not.toHaveBeenCalled();
  });

  it('404s when the service reports notification-not-found', async () => {
    (dismissNotification as jest.Mock).mockRejectedValue(new Error('notification-not-found'));
    const res = await request(makeApp(true)).post(`/api/notifications/${VALID_ID}/dismiss`);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/notifications/dismiss-all', () => {
  it('401s when signed out', async () => {
    const res = await request(makeApp(false)).post('/api/notifications/dismiss-all');
    expect(res.status).toBe(401);
    expect(dismissAllNotifications).not.toHaveBeenCalled();
  });

  it('returns the dismissed count for the authenticated user', async () => {
    (dismissAllNotifications as jest.Mock).mockResolvedValue(7);
    const res = await request(makeApp(true)).post('/api/notifications/dismiss-all');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 7 });
    expect(dismissAllNotifications).toHaveBeenCalledWith(TEST_PUID);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/unit/notifications.routes.test.ts`
Expected: FAIL — 404s from Express for the unregistered routes.

- [ ] **Step 3: Implement the routes**

In `server/src/routes/notifications.routes.ts`, extend the service import on line 7:

```ts
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  dismissNotification,
  dismissAllNotifications,
} from '../services/notifications.service';
```

Then insert after the `read-all` route (currently ending at line 72):

```ts
/** POST /api/notifications/:id/dismiss -> the updated Notification. Clicking
 * a notification in the bell dismisses it; the flag queue remains the durable
 * record of the underlying work. Scoped to the authenticated user's own. */
notificationsRouter.post(
  '/notifications/:id/dismiss',
  validate({ params: notificationIdParams }),
  ensureApiAuthenticated(),
  async (req, res) => {
    const notification = await dismissNotification(new ObjectId(String(req.params.id)), req.user!.puid);
    res.json(toNotificationResponse(notification));
  },
);

/** POST /api/notifications/dismiss-all -> { count }. "Clear all" empties the
 * bell entirely, read and unread alike. */
notificationsRouter.post('/notifications/dismiss-all', ensureApiAuthenticated(), async (req, res) => {
  const count = await dismissAllNotifications(req.user!.puid);
  res.json({ count });
});
```

The existing `NOTIFICATION_ERROR_STATUS` map already routes `'notification-not-found'` to 404, so the error path needs no change.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/unit/notifications.routes.test.ts`
Expected: PASS — all describes, old and new.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck:server
git add server/src/routes/notifications.routes.ts tests/unit/notifications.routes.test.ts
git commit -m "feat(notifications): dismiss and dismiss-all endpoints"
```

---

### Task 3: Client — the notification → route mapping

**Files:**
- Create: `client/src/notification-target.ts`
- Test: `tests/unit/notification-target.test.ts`

**Interfaces:**
- Consumes: `AppNotification` and `NotificationKind` from `client/src/api.ts:2455-2475`.
- Produces:
  - `export type NotificationAudience = 'instructor' | 'ta' | 'student';`
  - `export function notificationTarget(n: AppNotification, audience: NotificationAudience): string | null` — returns a **router path with no leading `#`**, e.g. `/instructor/course/abc/flags?flag=xyz`, or `null` when there is nowhere meaningful to go.

**Routing table (all 7 kinds — `NotificationKind` has more members than the four obvious ones):**

| kind | destination | query |
| --- | --- | --- |
| `flag` | flag queue | `?flag=<refId>` |
| `flag-resolved` | flag queue | `?flag=<refId>` |
| `auto-pause` | flag queue | `?question=<refId>` |
| `correction` | flag queue | `?question=<refId>` |
| `daily-summary` | flag queue | none |
| `review-backlog` | review queue (instructor `/queue`, TA `/review`) | none |
| `redirect` | `null` — student-facing, no staff surface | — |

This module is pure (no DOM, no imports beyond a type), which is what makes it unit-testable under Jest's `testEnvironment: 'node'` — see `tests/AGENTS.md`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/notification-target.test.ts`:

```ts
// Pure routing logic for the notification bell -- unit-testable precisely
// because it touches no DOM (tests/AGENTS.md: units are Node-env; client DOM
// behaviour belongs to the Playwright layer).
import { notificationTarget } from '../../client/src/notification-target';
import type { AppNotification, NotificationKind } from '../../client/src/api';

function notification(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 'n1',
    recipientPuid: 'PUID-1',
    courseId: 'course-1',
    kind: 'flag',
    priority: 'standard',
    body: 'A question was flagged.',
    createdAt: '2026-08-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('notificationTarget', () => {
  it('sends students nowhere', () => {
    expect(notificationTarget(notification(), 'student')).toBeNull();
  });

  it('returns null when the notification has no course', () => {
    expect(notificationTarget(notification({ courseId: undefined }), 'instructor')).toBeNull();
  });

  it('routes a flag to the instructor flag queue, highlighting the flag', () => {
    const target = notificationTarget(notification({ kind: 'flag', refId: 'flag-9' }), 'instructor');
    expect(target).toBe('/instructor/course/course-1/flags?flag=flag-9');
  });

  it('routes a flag to the TA flag queue for TAs', () => {
    const target = notificationTarget(notification({ kind: 'flag', refId: 'flag-9' }), 'ta');
    expect(target).toBe('/ta/course/course-1/flags?flag=flag-9');
  });

  it('routes flag-resolved by flag id too', () => {
    const target = notificationTarget(notification({ kind: 'flag-resolved', refId: 'flag-3' }), 'instructor');
    expect(target).toBe('/instructor/course/course-1/flags?flag=flag-3');
  });

  it('routes auto-pause by question id', () => {
    const target = notificationTarget(notification({ kind: 'auto-pause', refId: 'q-7' }), 'instructor');
    expect(target).toBe('/instructor/course/course-1/flags?question=q-7');
  });

  it('routes correction by question id', () => {
    const target = notificationTarget(notification({ kind: 'correction', refId: 'q-4' }), 'ta');
    expect(target).toBe('/ta/course/course-1/flags?question=q-4');
  });

  it('routes review-backlog to each audience own review surface', () => {
    expect(notificationTarget(notification({ kind: 'review-backlog' }), 'instructor'))
      .toBe('/instructor/course/course-1/queue');
    expect(notificationTarget(notification({ kind: 'review-backlog' }), 'ta'))
      .toBe('/ta/course/course-1/review');
  });

  it('routes daily-summary to the flag queue with no highlight', () => {
    expect(notificationTarget(notification({ kind: 'daily-summary' }), 'instructor'))
      .toBe('/instructor/course/course-1/flags');
  });

  it('returns null for the student-facing redirect kind', () => {
    expect(notificationTarget(notification({ kind: 'redirect', refId: 'x' }), 'instructor')).toBeNull();
  });

  it('still lands on the queue when the ref id is missing', () => {
    expect(notificationTarget(notification({ kind: 'flag', refId: undefined }), 'instructor'))
      .toBe('/instructor/course/course-1/flags');
  });

  it('encodes ids that need escaping', () => {
    const target = notificationTarget(
      notification({ courseId: 'a/b', kind: 'flag', refId: 'c d' }),
      'instructor',
    );
    expect(target).toBe('/instructor/course/a%2Fb/flags?flag=c%20d');
  });

  it('never throws on an unknown kind', () => {
    const rogue = notification({ kind: 'something-new' as NotificationKind });
    expect(notificationTarget(rogue, 'instructor')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/unit/notification-target.test.ts`
Expected: FAIL — `Cannot find module '../../client/src/notification-target'`.

- [ ] **Step 3: Implement the module**

Create `client/src/notification-target.ts`:

```ts
// Where a notification takes you when you click it in the bell (§4.3).
// Kept as a standalone pure module rather than a helper inside
// notifications-bell.ts so it can be unit-tested under Jest's Node
// environment -- the bell itself is DOM-bound and is covered by Playwright
// instead (tests/AGENTS.md).
import type { AppNotification } from './api.js';

export type NotificationAudience = 'instructor' | 'ta' | 'student';

/**
 * The in-app destination for a notification, or null when there isn't one:
 * students (whose bell is informational only), anything missing the
 * `courseId` every course-scoped route needs, or a kind with no staff
 * surface to land on.
 *
 * Flag-ish kinds all land on the FLAG QUEUE rather than the instructor
 * question editor: the queue is where the flag reasons and the
 * Return/Edit/Archive actions live, and it exists for TAs too (the question
 * editor does not). The subject is passed as a query param for the view to
 * scroll to and highlight -- `?flag=` when the ref is a flag, `?question=`
 * when it is a question. A kind whose ref is missing still routes to the
 * queue, just without a highlight; landing on the right surface beats doing
 * nothing.
 */
export function notificationTarget(n: AppNotification, audience: NotificationAudience): string | null {
  if (audience === 'student') return null;
  if (!n.courseId) return null;

  const course = encodeURIComponent(n.courseId);
  const flags = audience === 'ta' ? `/ta/course/${course}/flags` : `/instructor/course/${course}/flags`;
  const review = audience === 'ta' ? `/ta/course/${course}/review` : `/instructor/course/${course}/queue`;
  const ref = n.refId ? encodeURIComponent(n.refId) : undefined;

  switch (n.kind) {
    case 'flag':
    case 'flag-resolved':
      return ref ? `${flags}?flag=${ref}` : flags;
    case 'auto-pause':
    case 'correction':
      return ref ? `${flags}?question=${ref}` : flags;
    case 'review-backlog':
      return review;
    case 'daily-summary':
      return flags;
    // 'redirect' is student-facing; anything unrecognised is deliberately
    // inert rather than guessed at.
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/unit/notification-target.test.ts`
Expected: PASS — 13 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck:client
git add client/src/notification-target.ts tests/unit/notification-target.test.ts
git commit -m "feat(notifications): map notifications to their in-app destination"
```

---

### Task 4: Client — bell behaviour (navigate, dismiss, clear all)

**Files:**
- Modify: `client/src/api.ts` (append after line 2491)
- Modify: `client/src/notifications-bell.ts:34-149` and `:184-215`
- Modify: `client/src/main.ts:214`, `:326`, `:514`

**Interfaces:**
- Consumes: `notificationTarget`, `NotificationAudience` (Task 3); `POST /api/notifications/:id/dismiss` and `/dismiss-all` (Task 2).
- Produces:
  - `dismissNotification(id: string): Promise<AppNotification>` and `dismissAllNotifications(): Promise<{ count: number }>` in `api.ts`.
  - `createNotificationBell(audience: NotificationAudience): HTMLElement` — **signature change**, all three call sites must be updated in the same commit or the client build breaks.

**Behaviour being built:**
1. Opening the panel marks everything read → badge goes to zero.
2. Clicking an item removes it from the list, closes the panel, navigates to its target (if any), and persists the dismissal.
3. The panel header's "Mark all read" becomes **"Clear all"**, which empties the list.

- [ ] **Step 1: Add the API bindings**

Append to `client/src/api.ts` after `markAllNotificationsRead` (line 2491):

```ts
/** POST /api/notifications/:id/dismiss -> the updated notification. Clicking
 * a notification in the bell dismisses it for good. */
export function dismissNotification(id: string): Promise<AppNotification> {
  return request<AppNotification>(`/api/notifications/${encodeURIComponent(id)}/dismiss`, { method: 'POST' });
}

/** POST /api/notifications/dismiss-all -> { count }. "Clear all". */
export function dismissAllNotifications(): Promise<{ count: number }> {
  return request<{ count: number }>('/api/notifications/dismiss-all', { method: 'POST' });
}
```

- [ ] **Step 2: Update the bell's imports and signature**

In `client/src/notifications-bell.ts`, replace the import on line 10 and add the target import:

```ts
import {
  listNotifications,
  markAllNotificationsRead,
  dismissNotification,
  dismissAllNotifications,
  type AppNotification,
} from './api.js';
import { notificationTarget, type NotificationAudience } from './notification-target.js';
```

`markNotificationRead` is no longer used by the bell — remove it from the import. Leave the `api.ts` export in place; it is still a valid endpoint.

Then change the signature on line 42:

```ts
export function createNotificationBell(audience: NotificationAudience): HTMLElement {
```

- [ ] **Step 3: Rewrite the doc comment that now contradicts the code**

Replace the comment block at lines 34-41 with:

```ts
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
```

- [ ] **Step 4: Replace the click / mark-all handlers**

Replace `handleOpenItem` and `handleMarkAll` (lines 115-139) with:

```ts
  /** Click = go there and dismiss. The list is updated optimistically so the
   * panel never shows a row the user has already dealt with; a failed
   * dismissal is simply reconciled by the next poll rather than surfaced,
   * matching how the rest of this widget treats transient errors. */
  async function handleActivate(n: AppNotification): Promise<void> {
    const target = notificationTarget(n, audience);
    notifications = notifications.filter((x) => x.id !== n.id);
    open = false;
    syncBadge();
    renderPanel();
    if (target) window.location.hash = target;
    try {
      await dismissNotification(n.id);
      broadcastNotificationsChanged();
    } catch {
      // Transient failure -- the next poll restores the row rather than
      // silently swallowing it.
    }
  }

  /** "Clear all" -- empties the bell, read and unread alike. Rolled back on
   * failure because, unlike a single dismissal, silently dropping the whole
   * list would be a large and confusing loss to reconcile 30s later. */
  async function handleClearAll(): Promise<void> {
    const previous = notifications;
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
```

- [ ] **Step 5: Point the item and header at the new handlers**

In `renderItem` (line 76), change the click handler:

```ts
        onclick: () => void handleActivate(n),
```

In `renderPanel` (lines 105-109), replace the "Mark all read" button:

```ts
        el(
          'button',
          { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => void handleClearAll() },
          'Clear all',
        ),
```

In `toggle` (lines 141-144):

```ts
  function toggle(): void {
    open = !open;
    renderPanel();
    if (open) void markPanelRead();
  }
```

- [ ] **Step 6: Update the three shell call sites**

In `client/src/main.ts`:
- line 214 (TA shell): `createNotificationBell('ta'), createThemeToggle(),`
- line 326 (instructor shell): `createNotificationBell('instructor'),`
- line 514 (student shell): `config.preview ? createAnonymousNotificationBell() : createNotificationBell('student'),`

`createAnonymousNotificationBell()` is unchanged — it has no live inbox.

- [ ] **Step 7: Typecheck, lint, and run the full unit suite**

Run: `npm run typecheck:client && npm run lint && npx jest`
Expected: PASS. The typecheck is the real gate here — it is what proves all three call sites were updated for the new required parameter.

- [ ] **Step 8: Commit**

```bash
git add client/src/api.ts client/src/notifications-bell.ts client/src/main.ts
git commit -m "feat(notifications): bell navigates on click and clears on demand"
```

---

### Task 5: Client — scroll to and highlight the subject flag

**Files:**
- Modify: `client/src/views/instructor/flags.ts:577-642` and its import block
- Modify: `client/src/views/ta/flag-triage.ts` (whole file — 59 lines)
- Modify: `client/public/styles/main.css`

**Interfaces:**
- Consumes: the `?flag=<id>` / `?question=<id>` query params produced by `notificationTarget` (Task 3); `currentQuery()` from `client/src/router.ts:46`.
- Produces: no exported API — purely in-view behaviour.

**Why data attributes:** the instructor view groups flags by question version, so a `?flag=` lookup has to find the *group containing* that flag. Stamping both the question id and the member flag ids onto `.flag-group` lets one lookup serve both param shapes.

- [ ] **Step 1: Instructor view — stamp identifiers onto each group**

In `client/src/views/instructor/flags.ts`, add `currentQuery` to the existing router import, then in `groupRow` (line 618) replace the return:

```ts
    return el(
      'div',
      {
        class: 'flag-group',
        'data-question-id': group.questionId,
        'data-flag-ids': group.flags.map((flag) => flag.id).join(' '),
      },
      row,
      remediationPanel(group),
    );
```

- [ ] **Step 2: Instructor view — highlight after render**

Add this function inside `renderFlagQueueInner`, immediately above `renderResults`:

```ts
  /** A notification click lands here with ?flag= or ?question= (see
   * client/src/notification-target.ts). Scroll that group into view and mark
   * it, so the user sees the thing they were notified about rather than the
   * top of an undifferentiated queue. A stale id (flag already resolved and
   * filtered out) simply highlights nothing -- being on the right page is
   * still the right outcome. */
  function highlightFromQuery(): void {
    const query = currentQuery();
    const flagId = query.get('flag');
    const questionId = query.get('question');
    if (!flagId && !questionId) return;

    const groups = Array.from(resultsContainer.querySelectorAll<HTMLElement>('.flag-group'));
    const match = groups.find((group) =>
      questionId
        ? group.dataset.questionId === questionId
        : (group.dataset.flagIds ?? '').split(' ').includes(flagId as string),
    );
    if (!match) return;

    for (const group of groups) group.classList.remove('flag-group--highlight');
    match.classList.add('flag-group--highlight');
    match.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
```

Then call it as the last statement of `renderResults()` (after the `mount(...)` call, line 641):

```ts
    highlightFromQuery();
```

- [ ] **Step 3: TA view — stamp and highlight**

In `client/src/views/ta/flag-triage.ts`, add the router import:

```ts
import { currentQuery, type RouteParams } from '../../router.js';
```

Change `flagCard`'s returned `article` (line 26) to carry the id:

```ts
    return el('article', { class: 'card stack', 'data-flag-id': flag.id },
```

Then, after the `body.replaceChildren(...)` call (line 54), add:

```ts
  // A notification click lands here with ?flag= (see notification-target.ts).
  // The TA view is a flat list, so the lookup is a direct id match. A stale
  // id highlights nothing, which is the right outcome for a flag that has
  // already been escalated out of the open list.
  const flagId = currentQuery().get('flag');
  if (flagId) {
    const match = body.querySelector<HTMLElement>(`[data-flag-id="${CSS.escape(flagId)}"]`);
    if (match) {
      match.classList.add('card--highlight');
      match.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
```

- [ ] **Step 4: Add the highlight style**

Append to `client/public/styles/main.css`:

```css
/* Notification landing highlight: a notification click deep-links into the
   flag queue (see client/src/notification-target.ts), and this is what marks
   the row it landed on. Uses outline rather than border so the ring does not
   reflow the grid-based .flag-row layout. */
.flag-group--highlight,
.card--highlight {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 6px;
  animation: notif-landing 2.4s ease-out;
}

@keyframes notif-landing {
  0%,
  40% {
    background-color: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  100% {
    background-color: transparent;
  }
}

@media (prefers-reduced-motion: reduce) {
  .flag-group--highlight,
  .card--highlight {
    animation: none;
  }
}
```

Before writing this, grep `client/public/styles/main.css` for `--accent` and confirm that token exists in both the instructor and student themes; if the codebase uses a different accent variable name, use that one instead. Both shells must show a visible ring — Phase 4 Task 2 established WCAG AA contrast in both, and this must not regress it.

- [ ] **Step 5: Verify the build and full suite**

Run: `npm run typecheck:client && npm run lint && npx jest`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/views/instructor/flags.ts client/src/views/ta/flag-triage.ts client/public/styles/main.css
git commit -m "feat(flags): scroll to and highlight the flag a notification points at"
```

---

### Task 6: End-to-end coverage and plan status

**Files:**
- Create: `tests/e2e/notification-bell.spec.ts`
- Modify: `docs/superpowers/plans/phase-4/Saurav/STATUS.md`

**Interfaces:**
- Consumes: everything from Tasks 1-5.
- Produces: no code API.

This is where the bell's DOM behaviour gets its real coverage — Jest runs in the Node environment with no jsdom installed, so browser behaviour cannot be unit-tested here (`tests/AGENTS.md:66-69`).

- [ ] **Step 1: Read two existing specs before writing**

Read `tests/e2e/app.spec.ts` (for the `test.use({ storageState: AUTH_FILE })` logged-in pattern) and `tests/e2e/flag-loop.spec.ts` (for how flags are seeded and how that suite avoids depending on ambient dev-database state — commit `315d1dd` fixed exactly that class of flakiness, so do not reintroduce it).

- [ ] **Step 2: Write the spec**

Create `tests/e2e/notification-bell.spec.ts` covering, with the bell opened from a logged-in instructor shell:

1. **Opening clears the badge** — badge visible with a count, click the bell, badge becomes hidden.
2. **Clicking a flag notification navigates** — click a `flag` row, assert `page.url()` matches `/#\/instructor\/course\/[^/]+\/flags\?flag=/`, and that a `.flag-group--highlight` element is visible.
3. **Clicking removes the row** — reopen the bell, assert the clicked notification's body text is gone from the panel.
4. **Dismissal survives a reload** — `page.reload()`, open the bell, assert it is still gone (this is the assertion that actually proves the server-side `dismissedAt` works and the 30s poll cannot resurrect it).
5. **"Clear all" empties the panel** — click it, assert `.notif-panel__empty` with "No notifications yet." is visible, and that it stays empty after a reload.

Seed the notifications the test needs rather than relying on whatever the dev database happens to hold.

- [ ] **Step 3: Run the e2e suite**

Run: `npx playwright test tests/e2e/notification-bell.spec.ts`
Expected: PASS. If the run cannot reach a live server in this environment, say so explicitly in the task report rather than marking the step done.

- [ ] **Step 4: Run the a11y suite**

Run: `npm run test:a11y`
Expected: PASS — the new outline/animation must not regress the WCAG AA contrast work landed in commit `6e3874a`.

- [ ] **Step 5: Update STATUS.md**

Record in `docs/superpowers/plans/phase-4/Saurav/STATUS.md`: the bug fix, the three product decisions (click dismisses; opening clears the badge; "Clear all" clears everything), the rationale that the flag queue is the durable record, and the reversal of the old "opening marks nothing read" rule so the next reader does not "fix" it back.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/notification-bell.spec.ts docs/superpowers/plans/phase-4/Saurav/STATUS.md
git commit -m "test(e2e): notification bell navigate, dismiss, and clear-all"
```

---

## Notes and known edge cases

- **Re-clicking the same notification target.** The router only re-renders on `hashchange`. If the user is already at `#/instructor/course/X/flags?flag=Y` and activates a notification with the identical target, the hash does not change and no re-scroll happens. Harmless — they are already looking at the thing — and not worth special-casing.
- **`markNotificationRead` becomes unused by the bell** but stays exported in `api.ts` and live as a route. It is a valid single-notification operation and removing it is out of scope for a bug fix.
- **Dismissed documents are retained**, not deleted, so the audit trail survives and a future "recently dismissed" view stays possible.
- **No migration is needed.** `dismissedAt: { $exists: false }` matches every pre-existing document, so all current notifications remain visible until explicitly dismissed.
