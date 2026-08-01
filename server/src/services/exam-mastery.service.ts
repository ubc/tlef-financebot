import type { ObjectId } from 'mongodb';
import { enqueueJob } from '../components/jobs';

export const EXAM_MASTERY_JOB = 'exam.mastery-pass';

/** Enqueue only the durable ExamAttempt id. Task 4 owns the idempotent worker. */
export async function enqueueExamMasteryPass(examAttemptId: ObjectId): Promise<void> {
  await enqueueJob(EXAM_MASTERY_JOB, { examAttemptId: examAttemptId.toHexString() });
}
