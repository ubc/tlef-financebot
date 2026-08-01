import { ObjectId } from 'mongodb';
import { defineJob, enqueueJob } from '../components/jobs';
import {
  attemptsCol,
  examAttemptsCol,
  masteryCol,
} from '../components/mongodb/collections';

export const EXAM_MASTERY_JOB = 'exam.mastery-pass';

export interface ExamMasteryJobData {
  examAttemptId: string;
}

/** Enqueue only the durable ExamAttempt id. */
export async function enqueueExamMasteryPass(examAttemptId: ObjectId): Promise<void> {
  await enqueueJob<ExamMasteryJobData>(EXAM_MASTERY_JOB, {
    examAttemptId: examAttemptId.toHexString(),
  });
}

/**
 * Apply the post-exam qualifier in one idempotent batch. Exam answers already
 * exist as AttemptRecords, but they never enter the live practice mastery
 * cadence: this worker only annotates profiles for LOs missed in the exam and
 * deliberately leaves the practice-derived status/tier/window untouched.
 */
export async function runExamMasteryPass(data: ExamMasteryJobData): Promise<void> {
  let examAttemptId: ObjectId;
  try {
    examAttemptId = new ObjectId(data.examAttemptId);
  } catch {
    return;
  }
  const attempt = await examAttemptsCol().findOne({
    _id: examAttemptId,
    submittedAt: { $exists: true },
  });
  if (!attempt || attempt.masteryPassCompletedAt) return;

  const records = await attemptsCol().find({ examAttemptId, correct: false }).toArray();
  const missedLos = new Map(records.map((record) => [record.loId.toHexString(), record.loId]));
  const updatedAt = new Date();
  for (const loId of missedLos.values()) {
    await masteryCol().updateOne(
      { puid: attempt.puid, courseId: attempt.courseId, loId },
      {
        $set: { examVerified: true, updatedAt },
        $setOnInsert: {
          puid: attempt.puid,
          courseId: attempt.courseId,
          loId,
          status: 'not-attempted',
          attemptCount: 0,
          windowAccuracy: 0,
          windowRoles: {},
          currentTier: 'easy',
          attemptsSinceEvaluation: 0,
        },
      },
      { upsert: true },
    );
  }
  await examAttemptsCol().updateOne(
    { _id: examAttemptId, masteryPassCompletedAt: { $exists: false } },
    { $set: { masteryPassCompletedAt: updatedAt } },
  );
}

/** Register after startJobs(); never call defineJob at module load. */
export function registerExamMasteryJobs(): void {
  defineJob<ExamMasteryJobData>(EXAM_MASTERY_JOB, runExamMasteryPass);
}
