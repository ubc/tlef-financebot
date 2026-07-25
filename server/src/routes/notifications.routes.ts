import { Router, type NextFunction, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import type { WithId } from 'mongodb';
import { z } from 'zod';
import { ensureApiAuthenticated } from '../components/auth';
import { validate } from '../middleware/validate';
import { listNotifications, markNotificationRead, markAllNotificationsRead } from '../services/notifications.service';
import type { Notification } from '../types/domain';

// The signed-in user's own in-app notifications (§4.3, §9.1) — poll target,
// mark-read, mark-all-read. Deliberately NOT course-scoped by URL: every
// route here operates on `req.user!.puid` only, so a user can never read or
// mark-read another user's notifications (ensureApiAuthenticated() is
// sufficient; there is no course-role guard to apply since there is no
// course-scoped resource in the URL). See routes/AGENTS.md.
export const notificationsRouter = Router();

const objectIdParam = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id.');
const notificationIdParams = z.object({ id: objectIdParam });

// NOT z.coerce.boolean(): that coerces via JS `Boolean(str)`, so a literal
// `?unreadOnly=false` would coerce to `true` (any non-empty string is
// truthy). Restricting to the two literal query values and transforming
// avoids that footgun.
const unreadOnlyParam = z
  .union([z.literal('true'), z.literal('false')])
  .optional()
  .transform((v) => v === 'true');
const listQuery = z.object({ unreadOnly: unreadOnlyParam });

/** Id-mapping response shape (`id` instead of raw `_id`), matching the
 * convention used by flags.routes.ts's `toFlagResponse`. */
function toNotificationResponse(notification: WithId<Notification>): Record<string, unknown> {
  const { _id, ...rest } = notification;
  return { id: _id.toString(), ...rest };
}

/** GET /api/notifications?unreadOnly= -> newest-first, limit 50. Poll target. */
notificationsRouter.get(
  '/notifications',
  validate({ query: listQuery }),
  ensureApiAuthenticated(),
  async (req, res) => {
    // `validate()` already replaced req.query with the parsed+transformed
    // value; the double cast is needed only because the transform makes
    // `unreadOnly` non-optional, which no longer structurally overlaps
    // Express's ParsedQs (see the other routers' single-cast convention,
    // which relies on every query field staying optional).
    const { unreadOnly } = req.query as unknown as z.infer<typeof listQuery>;
    const notifications = await listNotifications(req.user!.puid, { unreadOnly });
    res.json(notifications.map((n) => toNotificationResponse(n)));
  },
);

/** POST /api/notifications/:id/read -> the updated Notification. Scoped to
 * the authenticated user's own notifications. */
notificationsRouter.post(
  '/notifications/:id/read',
  validate({ params: notificationIdParams }),
  ensureApiAuthenticated(),
  async (req, res) => {
    const notification = await markNotificationRead(new ObjectId(String(req.params.id)), req.user!.puid);
    res.json(toNotificationResponse(notification));
  },
);

/** POST /api/notifications/read-all -> { count }. Marks every unread
 * notification for the authenticated user read. */
notificationsRouter.post('/notifications/read-all', ensureApiAuthenticated(), async (req, res) => {
  const count = await markAllNotificationsRead(req.user!.puid);
  res.json({ count });
});

// --- Error normalization -----------------------------------------------------

const NOTIFICATION_ERROR_STATUS: Record<string, number> = {
  'notification-not-found': 404,
};

notificationsRouter.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof Error && Object.hasOwn(NOTIFICATION_ERROR_STATUS, err.message)) {
    res.status(NOTIFICATION_ERROR_STATUS[err.message]).json({ error: err.message });
    return;
  }
  next(err);
});
