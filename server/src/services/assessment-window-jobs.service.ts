import { defineJob, scheduleRecurring } from '../components/jobs';
import { assessmentAttemptsCol, previewAssessmentAttemptsCol } from '../components/mongodb/collections';
import { expireAssessmentWindow } from './assessment-attempts.service';
import { expirePreviewAssessmentWindow } from './assessment-preview.service';

export const ASSESSMENT_WINDOW_EXPIRY_JOB = 'assessment.window-expiry';
const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;

/** Bound each collection independently so a large live backlog cannot hide Preview expiry. */
export async function sweepAssessmentWindows(limit = DEFAULT_BATCH_SIZE): Promise<{ checked: number; submitted: number; failed: number }> {
  const batchSize = Number.isFinite(limit) ? Math.min(MAX_BATCH_SIZE, Math.max(0, Math.trunc(limit))) : DEFAULT_BATCH_SIZE;
  const counts = { checked: 0, submitted: 0, failed: 0 };
  if (!batchSize) return counts;
  const now = new Date();
  const due = {
    submittedAt: { $exists: false },
    $or: [{ deadline: { $lte: now } }, { 'window.expiresAt': { $lte: now } }],
  };

  try {
    const attempts = await assessmentAttemptsCol().find(due, {
      projection: { _id: 1, courseId: 1, puid: 1 },
    }).sort({ deadline: 1, _id: 1 }).limit(batchSize).toArray();
    for (const attempt of attempts) {
      counts.checked++;
      try {
        if (await expireAssessmentWindow(attempt.courseId, attempt._id, attempt.puid)) counts.submitted++;
      } catch {
        counts.failed++;
        // Keep identities, saved answers and provider/database payloads out of job logs.
        console.error(`[assessment.window-expiry] Live attempt ${attempt._id.toHexString()} could not be finalized.`);
      }
    }
  } catch {
    counts.failed++;
    console.error('[assessment.window-expiry] Live attempts could not be scanned.');
  }

  try {
    const attempts = await previewAssessmentAttemptsCol().find({ ...due, expiresAt: { $gt: now } }, {
      projection: { _id: 1, courseId: 1, instructorPuid: 1, previewSessionId: 1, access: 1 },
    }).sort({ deadline: 1, _id: 1 }).limit(batchSize).toArray();
    for (const attempt of attempts) {
      counts.checked++;
      try {
        if (await expirePreviewAssessmentWindow(attempt.courseId, attempt._id, {
          instructorPuid: attempt.instructorPuid,
          previewSessionId: attempt.previewSessionId,
          access: attempt.access,
        })) counts.submitted++;
      } catch {
        counts.failed++;
        console.error(`[assessment.window-expiry] Preview attempt ${attempt._id.toHexString()} could not be finalized.`);
      }
    }
  } catch {
    counts.failed++;
    console.error('[assessment.window-expiry] Preview attempts could not be scanned.');
  }
  return counts;
}

/** Call only after startJobs(); importing this module must not start Agenda work. */
export async function registerAssessmentWindowJobs(): Promise<void> {
  defineJob(ASSESSMENT_WINDOW_EXPIRY_JOB, async () => { await sweepAssessmentWindows(); });
  await scheduleRecurring(ASSESSMENT_WINDOW_EXPIRY_JOB, '30 seconds');
}
