import { ObjectId } from 'mongodb';

jest.mock('../../server/src/components/jobs', () => ({ defineJob: jest.fn(), scheduleRecurring: jest.fn(async () => undefined) }));
jest.mock('../../server/src/components/mongodb/collections', () => ({ assessmentAttemptsCol: jest.fn(), previewAssessmentAttemptsCol: jest.fn() }));
jest.mock('../../server/src/services/assessment-attempts.service', () => ({ expireAssessmentWindow: jest.fn() }));
jest.mock('../../server/src/services/assessment-preview.service', () => ({ expirePreviewAssessmentWindow: jest.fn() }));

import { defineJob, scheduleRecurring } from '../../server/src/components/jobs';
import { assessmentAttemptsCol, previewAssessmentAttemptsCol } from '../../server/src/components/mongodb/collections';
import { expireAssessmentWindow } from '../../server/src/services/assessment-attempts.service';
import { expirePreviewAssessmentWindow } from '../../server/src/services/assessment-preview.service';
import { ASSESSMENT_WINDOW_EXPIRY_JOB, registerAssessmentWindowJobs, sweepAssessmentWindows } from '../../server/src/services/assessment-window-jobs.service';

const now = new Date('2026-10-13T21:00:00.000Z');
const courseId = new ObjectId();
type Query = Record<string, unknown>;
type SweepRow = {
  _id: ObjectId; courseId: ObjectId; deadline: Date; submittedAt?: Date;
  window?: { id: string; expiresAt: Date }; expiresAt?: Date;
  puid: string; instructorPuid: string; previewSessionId: string; access: 'restricted' | 'unrestricted';
};
let live: SweepRow[], previews: SweepRow[];
let liveFind: jest.Mock, previewFind: jest.Mock, log: jest.SpyInstance;

function valueAt(record: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Query)[key] : undefined, record);
}
function matches(record: SweepRow, query: Query): boolean {
  return Object.entries(query).every(([key, expected]) => {
    if (key === '$or') return (expected as Query[]).some(clause => matches(record, clause));
    const actual = valueAt(record, key);
    const operators = expected as Query;
    if ('$exists' in operators && (actual !== undefined) !== operators.$exists) return false;
    if ('$lte' in operators && !(actual instanceof Date && actual.getTime() <= Number(operators.$lte))) return false;
    if ('$gt' in operators && !(actual instanceof Date && actual.getTime() > Number(operators.$gt))) return false;
    return true;
  });
}
function fakeCollection(rows: () => SweepRow[]) {
  const find = jest.fn((query: Query, _options: unknown) => {
    let maximum = Infinity;
    const cursor: { sort: jest.Mock; limit: jest.Mock; toArray: jest.Mock } = {
      sort: jest.fn((_sort: unknown) => cursor),
      limit: jest.fn((limit: number) => { maximum = limit; return cursor; }),
      toArray: jest.fn(async () => rows().filter(row => matches(row, query)).sort((a, b) => a.deadline.getTime() - b.deadline.getTime()).slice(0, maximum)),
    };
    return cursor;
  });
  return { find };
}
function row(offset: number, override: Partial<SweepRow> = {}): SweepRow {
  return {
    _id: new ObjectId(), courseId, deadline: new Date(now.getTime() + offset),
    puid: 'STUDENT-PRIVATE', instructorPuid: 'TEACHER-PRIVATE',
    previewSessionId: 'a9194d00-9e61-4f7a-9037-47711e8ba59b', access: 'restricted',
    ...override,
  };
}
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(now);
  live = []; previews = [];
  const liveCollection = fakeCollection(() => live), previewCollection = fakeCollection(() => previews);
  liveFind = liveCollection.find; previewFind = previewCollection.find;
  jest.mocked(assessmentAttemptsCol).mockReturnValue(liveCollection as never);
  jest.mocked(previewAssessmentAttemptsCol).mockReturnValue(previewCollection as never);
  jest.mocked(expireAssessmentWindow).mockImplementation(async (_courseId, attemptId) => {
    const attempt = live.find(item => item._id.equals(attemptId));
    if (!attempt || attempt.submittedAt) return false;
    attempt.submittedAt = now; return true;
  });
  jest.mocked(expirePreviewAssessmentWindow).mockImplementation(async (_courseId, attemptId) => {
    const attempt = previews.find(item => item._id.equals(attemptId));
    if (!attempt || attempt.submittedAt) return false;
    attempt.submittedAt = now; return true;
  });
  log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { log.mockRestore(); jest.useRealTimers(); });

test('import does not register work; explicit registration installs the scheduled sweep after startup', async () => {
  expect(defineJob).not.toHaveBeenCalled();
  expect(scheduleRecurring).not.toHaveBeenCalled();
  await registerAssessmentWindowJobs();
  expect(defineJob).toHaveBeenCalledWith(ASSESSMENT_WINDOW_EXPIRY_JOB, expect.any(Function));
  expect(scheduleRecurring).toHaveBeenCalledWith(ASSESSMENT_WINDOW_EXPIRY_JOB, '30 seconds');
  const handler = jest.mocked(defineJob).mock.calls[0][1];
  live.push(row(-1));
  await handler(undefined);
  expect(expireAssessmentWindow).toHaveBeenCalledTimes(1);
});

test('finalizes due deadlines and expired window leases, keeping receipt TTL and terminal states separate', async () => {
  const deadline = row(-1), boundary = row(0), lease = row(60_000, { window: { id: 'abandoned-window', expiresAt: now } });
  live.push(deadline, boundary, lease, row(60_000), row(-1, { submittedAt: now }));
  const preview = row(60_000, { window: { id: 'preview-window', expiresAt: new Date(now.getTime() - 1) }, expiresAt: new Date(now.getTime() + 60_000), access: 'unrestricted' });
  previews.push(preview, row(-1, { expiresAt: now }), row(-1, { expiresAt: new Date(now.getTime() - 1) }), row(-1, { expiresAt: new Date(now.getTime() + 60_000), submittedAt: now }));
  await expect(sweepAssessmentWindows()).resolves.toEqual({ checked: 4, submitted: 4, failed: 0 });
  expect(expireAssessmentWindow).toHaveBeenCalledWith(courseId, deadline._id, 'STUDENT-PRIVATE');
  expect(expireAssessmentWindow).toHaveBeenCalledWith(courseId, boundary._id, 'STUDENT-PRIVATE');
  expect(expireAssessmentWindow).toHaveBeenCalledWith(courseId, lease._id, 'STUDENT-PRIVATE');
  expect(expirePreviewAssessmentWindow).toHaveBeenCalledWith(courseId, preview._id, {
    instructorPuid: preview.instructorPuid, previewSessionId: preview.previewSessionId, access: 'unrestricted',
  });
  expect(liveFind.mock.calls[0][0]).toEqual({ submittedAt: { $exists: false }, $or: [{ deadline: { $lte: now } }, { 'window.expiresAt': { $lte: now } }] });
  expect(previewFind.mock.calls[0][0]).toMatchObject({ expiresAt: { $gt: now } });
  await expect(sweepAssessmentWindows()).resolves.toEqual({ checked: 0, submitted: 0, failed: 0 });
});

test('each collection has an independent bounded batch and later sweeps drain the backlog', async () => {
  live.push(...Array.from({ length: 5 }, (_, index) => row(-5000 + index)));
  previews.push(...Array.from({ length: 5 }, (_, index) => row(-5000 + index, { expiresAt: new Date(now.getTime() + 60_000) })));
  await expect(sweepAssessmentWindows(2)).resolves.toEqual({ checked: 4, submitted: 4, failed: 0 });
  expect(liveFind.mock.results[0].value.limit).toHaveBeenCalledWith(2);
  expect(previewFind.mock.results[0].value.limit).toHaveBeenCalledWith(2);
  await expect(sweepAssessmentWindows(2)).resolves.toEqual({ checked: 4, submitted: 4, failed: 0 });
  await expect(sweepAssessmentWindows(2)).resolves.toEqual({ checked: 2, submitted: 2, failed: 0 });
});

test('raced or renewed attempts are checked but never counted as newly submitted', async () => {
  live.push(row(-1)); previews.push(row(-1, { expiresAt: new Date(now.getTime() + 60_000) }));
  jest.mocked(expireAssessmentWindow).mockResolvedValueOnce(false);
  jest.mocked(expirePreviewAssessmentWindow).mockResolvedValueOnce(false);
  await expect(sweepAssessmentWindows()).resolves.toEqual({ checked: 2, submitted: 0, failed: 0 });
});

test('one failed attempt does not block either later attempts or the other collection; logs exclude identity and error payloads', async () => {
  const broken = row(-3);
  live.push(broken, row(-2)); previews.push(row(-1, { expiresAt: new Date(now.getTime() + 60_000) }));
  jest.mocked(expireAssessmentWindow).mockRejectedValueOnce(new Error('PRIVATE student answer/provider payload'));
  await expect(sweepAssessmentWindows()).resolves.toEqual({ checked: 3, submitted: 2, failed: 1 });
  expect(log).toHaveBeenCalledWith(expect.stringContaining(broken._id.toHexString()));
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE|STUDENT|TEACHER|answer/);
});

test.each(['live', 'preview'] as const)('a failed %s collection scan does not prevent the independent scan', async source => {
  live.push(row(-1)); previews.push(row(-1, { expiresAt: new Date(now.getTime() + 60_000) }));
  (source === 'live' ? liveFind : previewFind).mockImplementationOnce(() => { throw new Error('database unavailable'); });
  await expect(sweepAssessmentWindows()).resolves.toEqual({ checked: 1, submitted: 1, failed: 1 });
  expect(liveFind).toHaveBeenCalledTimes(1); expect(previewFind).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalledWith(expect.stringContaining('could not be scanned'));
});

test('zero batches perform no scan and extreme batch requests remain bounded', async () => {
  await expect(sweepAssessmentWindows(0)).resolves.toEqual({ checked: 0, submitted: 0, failed: 0 });
  expect(liveFind).not.toHaveBeenCalled(); expect(previewFind).not.toHaveBeenCalled();
  await sweepAssessmentWindows(100_000);
  expect(liveFind.mock.results[0].value.limit).toHaveBeenCalledWith(500);
  expect(previewFind.mock.results[0].value.limit).toHaveBeenCalledWith(500);
});
