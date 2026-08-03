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

  // Review fix (round 2): `correction`'s refId is a questionVERSION id
  // (remediation.service.ts sends refType: 'questionVersion'), and the flag
  // queue stamps `data-question-id` with the QUESTION id. A `?question=` here
  // could never match, so the kind routes to the queue with no highlight param.
  it('routes correction to the flag queue with no highlight param', () => {
    const target = notificationTarget(notification({ kind: 'correction', refId: 'qv-4' }), 'ta');
    expect(target).toBe('/ta/course/course-1/flags');
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
