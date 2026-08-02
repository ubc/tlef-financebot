// Integration test — a GATED router via supertest, following
// tests/unit/notes.route.test.ts's pattern exactly (see tests/AGENTS.md).
// Verifies the real ensureApiAuthenticated() guard (401 when signed out,
// through when signed in) while mocking the service layer. A tiny middleware
// stands in for passport by setting req.isAuthenticated()/req.user, so no
// real session store is needed.
//
// The property that matters most here (per Finding 3 of the Task 3 review):
// this route is deliberately NOT course-scoped, so the ONLY thing keeping a
// user from reading/mark-reading another user's notifications is that every
// service call is scoped by the AUTHENTICATED session's own puid -- never
// one a caller could inject via query/body/params. These tests assert the
// exact args passed to the service, not just the HTTP status, to pin that.
import express, { type Express } from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';

jest.mock('../../server/src/services/notifications.service', () => ({
  listNotifications: jest.fn(),
  markNotificationRead: jest.fn(),
  markAllNotificationsRead: jest.fn(),
  dismissNotification: jest.fn(),
  dismissAllNotifications: jest.fn(),
}));

import { notificationsRouter } from '../../server/src/routes/notifications.routes';
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  dismissNotification,
  dismissAllNotifications,
} from '../../server/src/services/notifications.service';

const TEST_PUID = 'PUID-TEST-0001';
const VALID_ID = '507f1f77bcf86cd799439011';

function makeApp(authenticated: boolean): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // Stand in for passport (the real ensureApiAuthenticated guard calls these).
    (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated = () => authenticated;
    (req as { user?: unknown }).user = authenticated ? { puid: TEST_PUID } : undefined;
    next();
  });
  app.use('/api', notificationsRouter);
  return app;
}

beforeEach(() => {
  jest.mocked(listNotifications).mockReset();
  jest.mocked(markNotificationRead).mockReset();
  jest.mocked(markAllNotificationsRead).mockReset();
  jest.mocked(dismissNotification).mockReset();
  jest.mocked(dismissAllNotifications).mockReset();
});

describe('notifications routes (auth-gated)', () => {
  describe('GET /api/notifications', () => {
    it('returns 401 and does not call listNotifications when signed out', async () => {
      const res = await request(makeApp(false)).get('/api/notifications');
      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
      expect(listNotifications).not.toHaveBeenCalled();
    });

    it('when signed in, calls listNotifications with the SESSION puid (never a caller-supplied one) and the default unreadOnly:false', async () => {
      jest.mocked(listNotifications).mockResolvedValue([]);

      const res = await request(makeApp(true)).get('/api/notifications');

      expect(res.status).toBe(200);
      expect(listNotifications).toHaveBeenCalledTimes(1);
      expect(listNotifications).toHaveBeenCalledWith(TEST_PUID, { unreadOnly: false });
    });

    it('passes unreadOnly:true through when the query param is set', async () => {
      jest.mocked(listNotifications).mockResolvedValue([]);

      const res = await request(makeApp(true)).get('/api/notifications?unreadOnly=true');

      expect(res.status).toBe(200);
      expect(listNotifications).toHaveBeenCalledWith(TEST_PUID, { unreadOnly: true });
    });
  });

  describe('POST /api/notifications/:id/read', () => {
    it('returns 401 and does not call markNotificationRead when signed out', async () => {
      const res = await request(makeApp(false)).post(`/api/notifications/${VALID_ID}/read`);
      expect(res.status).toBe(401);
      expect(markNotificationRead).not.toHaveBeenCalled();
    });

    it('when signed in, calls markNotificationRead with the URL id and the SESSION puid', async () => {
      jest.mocked(markNotificationRead).mockResolvedValue({
        _id: new ObjectId(VALID_ID),
        recipientPuid: TEST_PUID,
        kind: 'flag',
        priority: 'standard',
        body: 'A question was flagged.',
        createdAt: new Date(),
        readAt: new Date(),
      } as never);

      const res = await request(makeApp(true)).post(`/api/notifications/${VALID_ID}/read`);

      expect(res.status).toBe(200);
      expect(markNotificationRead).toHaveBeenCalledTimes(1);
      const [idArg, puidArg] = jest.mocked(markNotificationRead).mock.calls[0];
      expect(idArg).toBeInstanceOf(ObjectId);
      expect(idArg.toString()).toBe(VALID_ID);
      expect(puidArg).toBe(TEST_PUID);
    });
  });

  describe('POST /api/notifications/read-all', () => {
    it('returns 401 and does not call markAllNotificationsRead when signed out', async () => {
      const res = await request(makeApp(false)).post('/api/notifications/read-all');
      expect(res.status).toBe(401);
      expect(markAllNotificationsRead).not.toHaveBeenCalled();
    });

    it('when signed in, calls markAllNotificationsRead with the SESSION puid', async () => {
      jest.mocked(markAllNotificationsRead).mockResolvedValue(3);

      const res = await request(makeApp(true)).post('/api/notifications/read-all');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ count: 3 });
      expect(markAllNotificationsRead).toHaveBeenCalledWith(TEST_PUID);
    });
  });
});

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
