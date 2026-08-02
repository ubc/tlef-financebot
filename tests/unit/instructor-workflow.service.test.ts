import { ObjectId } from 'mongodb';

jest.mock('../../server/src/services/analytics.service', () => ({ lowEngagement: jest.fn() }));
jest.mock('../../server/src/services/bank.service', () => ({
  browseBank: jest.fn(),
  reviewQueue: jest.fn(),
}));
jest.mock('../../server/src/services/content-map.service', () => ({ getCourseContentMap: jest.fn() }));
jest.mock('../../server/src/services/courses.service', () => ({
  getCourseTree: jest.fn(),
  publishChecklist: jest.fn(),
}));
jest.mock('../../server/src/services/flags.service', () => ({ listFlags: jest.fn() }));

import { lowEngagement } from '../../server/src/services/analytics.service';
import { browseBank, reviewQueue } from '../../server/src/services/bank.service';
import { getCourseContentMap } from '../../server/src/services/content-map.service';
import { getCourseTree, publishChecklist } from '../../server/src/services/courses.service';
import { listFlags } from '../../server/src/services/flags.service';
import { instructorWorkflowSummary } from '../../server/src/services/instructor-workflow.service';

const courseId = new ObjectId();
const themeId = new ObjectId();
const loId = new ObjectId();

const completeChecklist = [
  { item: 'Term dates set', ok: true },
  { item: 'At least one Theme', ok: true },
  { item: 'At least one Learning Objective', ok: true },
  { item: 'Registration code generated', ok: true },
  { item: 'Every LO has ≥3 Approved questions', ok: true },
];

function mockCourse(lifecycle: 'draft' | 'published' | 'archived' = 'draft'): void {
  jest.mocked(getCourseTree).mockResolvedValue({
    _id: courseId,
    name: 'Finance Fundamentals',
    courseCode: 'COMM 298',
    section: '001',
    term: '2026W1',
    lifecycle,
    published: lifecycle === 'published',
    themes: [],
  } as never);
}

function mockHealthyContent(): void {
  jest.mocked(getCourseContentMap).mockResolvedValue({
    themes: [{
      themeId,
      name: 'Time Value',
      order: 0,
      los: [{
        loId,
        name: 'Discount cash flows',
        order: 0,
        materials: [],
        materialCounts: {},
        questionCounts: {
          draft: 0,
          'pending-review': 0,
          reviewed: 0,
          approved: 5,
          paused: 0,
          archived: 0,
        },
        gaps: [],
      }],
    }],
    unassignedMaterials: [],
  });
}

beforeEach(() => {
  mockCourse();
  jest.mocked(publishChecklist).mockResolvedValue(completeChecklist);
  mockHealthyContent();
  jest.mocked(reviewQueue).mockResolvedValue([]);
  jest.mocked(browseBank).mockResolvedValue({ total: 5, questions: [] });
  jest.mocked(listFlags).mockResolvedValue([]);
  jest.mocked(lowEngagement).mockResolvedValue([]);
});

describe('Instructor workflow summary', () => {
  it('turns an empty course into blocking setup actions', async () => {
    jest.mocked(publishChecklist).mockResolvedValue(completeChecklist.map((item) => ({ ...item, ok: false })));
    jest.mocked(getCourseContentMap).mockResolvedValue({ themes: [], unassignedMaterials: [] });
    jest.mocked(browseBank).mockResolvedValue({ total: 0, questions: [] });

    const result = await instructorWorkflowSummary(courseId);

    expect(result.readiness).toMatchObject({ completed: 0, total: 5, percent: 0 });
    expect(result.counts).toMatchObject({ topics: 0, learningObjectives: 0, approvedQuestions: 0 });
    expect(result.actions.map((action) => action.id)).toEqual(['configure-course', 'build-structure']);
    expect(result.actions.every((action) => action.priority === 'blocking')).toBe(true);
  });

  it('prioritizes content, review, flag, and engagement work from existing state', async () => {
    const materialId = new ObjectId();
    const materialRunId = new ObjectId();
    const generationRunId = new ObjectId();
    jest.mocked(getCourseContentMap).mockResolvedValue({
      themes: [{
        themeId,
        name: 'Time Value',
        order: 0,
        los: [{
          loId,
          name: 'Discount cash flows',
          order: 0,
          materials: [],
          materialCounts: {},
          questionCounts: {
            draft: 2,
            'pending-review': 1,
            reviewed: 0,
            approved: 1,
            paused: 0,
            archived: 0,
          },
          latestGenerationRun: { runId: generationRunId, status: 'partial', stage: 'persisting' },
          gaps: ['thin-approved-set'],
        }],
      }],
      unassignedMaterials: [{
        materialId,
        name: 'Week 1 slides',
        kind: 'lecture',
        status: 'failed',
        assessmentLike: false,
        latestRun: { runId: materialRunId, status: 'failed', stage: 'parsing' },
      }],
    });
    jest.mocked(reviewQueue).mockResolvedValue([{}, {}] as never);
    jest.mocked(browseBank).mockResolvedValue({ total: 1, questions: [] });
    jest.mocked(listFlags).mockImplementation(async (_id, state) => (
      state === 'open' ? [{ state: 'open' }] : [{ state: 'escalated' }]
    ) as never);
    jest.mocked(lowEngagement).mockResolvedValue([{ puid: 'P1' }] as never);

    const result = await instructorWorkflowSummary(courseId);

    expect(result.counts).toMatchObject({
      thinLos: 1,
      unassignedMaterials: 1,
      contentIssues: 2,
      reviewQueue: 2,
      openFlags: 2,
      lowEngagementStudents: 1,
    });
    expect(result.actions.map((action) => action.id)).toEqual([
      'assign-materials',
      'repair-content',
      'seed-thin-los',
      'review-questions',
      'resolve-flags',
      'follow-up-students',
      'preview-course',
      'publish-course',
    ]);
    expect(result.actions.slice(0, 5).every((action) => action.priority === 'high')).toBe(true);
  });

  it('reduces a healthy published course to one monitoring recommendation', async () => {
    mockCourse('published');

    const result = await instructorWorkflowSummary(courseId);

    expect(result.readiness.percent).toBe(100);
    expect(result.actions).toEqual([
      expect.objectContaining({ id: 'monitor-course', destination: 'analytics', priority: 'normal' }),
    ]);
  });

  it('offers one restore action instead of mutable work for an archived course', async () => {
    mockCourse('archived');
    jest.mocked(publishChecklist).mockResolvedValue(completeChecklist.map((item) => ({ ...item, ok: false })));

    const result = await instructorWorkflowSummary(courseId);

    expect(result.actions).toEqual([
      expect.objectContaining({ id: 'restore-course', destination: 'dashboard', priority: 'normal' }),
    ]);
  });
});
