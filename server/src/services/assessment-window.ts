import type { AssessmentSubmissionReason, AssessmentWindowLease } from '../types/exam-builder';
import { examError } from './question-variant.service';

export const ASSESSMENT_WINDOW_LEASE_MS = 120_000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export interface WindowAttempt { deadline: Date; submittedAt?: Date; window?: AssessmentWindowLease; submissionReason?: AssessmentSubmissionReason; }
export function validateAssessmentWindowId(id: string): void { if (!uuid.test(id)) examError('Invalid exam window identifier.', 400); }
export function assessmentWindowLease(id: string, now = new Date()): AssessmentWindowLease { validateAssessmentWindowId(id); return { id, expiresAt: new Date(now.getTime() + ASSESSMENT_WINDOW_LEASE_MS) }; }
export function windowDueReason(attempt: WindowAttempt, now = new Date()): 'deadline' | 'connection-lost' | undefined {
  if (attempt.deadline.getTime() <= now.getTime()) return 'deadline';
  if (attempt.window && attempt.window.expiresAt.getTime() <= now.getTime()) return 'connection-lost';
  return undefined;
}
/** Pin the lease value as well as the answer revision: a heartbeat can defeat
 * an expiry write that was computed from an older lease. */
export function windowCas(attempt: WindowAttempt) {
  return attempt.window ? { 'window.id': attempt.window.id, 'window.expiresAt': attempt.window.expiresAt } : { window: { $exists: false } };
}
export function requireWindowOwner(attempt: WindowAttempt, windowId?: string): void {
  if (windowId !== undefined) validateAssessmentWindowId(windowId);
  if (attempt.window && attempt.window.id !== windowId) examError('This attempt belongs to another exam window. Return to the original window.');
}
export function windowReceipt(attempt: WindowAttempt) {
  return { submitted: Boolean(attempt.submittedAt), serverTime: new Date().toISOString(), ...(attempt.window ? { windowExpiresAt: attempt.window.expiresAt.toISOString() } : {}), ...(attempt.submissionReason ? { submissionReason: attempt.submissionReason } : {}) };
}
