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
jest.mock('../../server/src/services/materials.service', () => ({ listMaterials: jest.fn() }));
jest.mock('../../server/src/services/preview.service', () => ({ hasRecentPreviewAttempt: jest.fn() }));

import { lowEngagement } from '../../server/src/services/analytics.service';
import { browseBank, reviewQueue } from '../../server/src/services/bank.service';
import { getCourseContentMap } from '../../server/src/services/content-map.service';
import { getCourseTree, publishChecklist } from '../../server/src/services/courses.service';
import { listFlags } from '../../server/src/services/flags.service';
import { listMaterials } from '../../server/src/services/materials.service';
import { hasRecentPreviewAttempt } from '../../server/src/services/preview.service';
import { instructorWorkflowSummary } from '../../server/src/services/instructor-workflow.service';

const courseId = new ObjectId();
const themeId = new ObjectId();
const loId = new ObjectId();
const materialId = new ObjectId();
const instructorPuid = 'PUID-INSTRUCTOR';

const completeChecklist = [
  { item: 'Term dates set', ok: true },
  { item: 'At least one Theme', ok: true },
  { item: 'At least one Learning Objective', ok: true },
  { item: 'Registration code generated', ok: true },
  { item: 'Every LO has ≥3 Approved questions', ok: true },
];

const emptyContentChecklist = completeChecklist.map((item) => ({
  ...item,
  ok: item.item === 'Term dates set' || item.item === 'Registration code generated',
}));

function material(
  status: 'processing' | 'ready' | 'failed' = 'ready',
  assignments: Array<{ themeId: ObjectId; loId?: ObjectId }> = [{ themeId, loId }],
) {
  return {
    _id: materialId,
    courseId,
    name: 'Week 1 slides.pdf',
    format: 'pdf' as const,
    kind: 'lecture' as const,
    status,
    ...(status === 'failed' ? { error: 'embedding-failed' } : {}),
    assignments,
    uploadedAt: new Date('2026-08-07T00:00:00.000Z'),
  };
}

function contentMapMaterial(
  status: 'processing' | 'ready' | 'failed' = 'ready',
  latestRun?: { runId: ObjectId; status: 'queued' | 'running' | 'completed' | 'partial' | 'failed'; stage: string },
) {
  return {
    materialId,
    name: 'Week 1 slides.pdf',
    kind: 'lecture' as const,
    status,
    assessmentLike: false,
    ...(latestRun ? { latestRun } : {}),
  };
}

function mockCourse(lifecycle: 'draft' | 'published' | 'archived' = 'draft'): void {
  const termStart = new Date('2026-09-08T00:00:00.000Z');
  const termEnd = new Date('2026-12-07T23:59:59.999Z');
  jest.mocked(getCourseTree).mockResolvedValue({
    _id: courseId,
    name: 'Finance Fundamentals',
    courseCode: 'COMM 298',
    section: '001',
    term: '2026W1',
    termStart,
    termEnd,
    lifecycle,
    published: lifecycle === 'published',
    themes: [],
  } as never);
}

function mockHealthyContent(overrides: {
  gaps?: Array<'no-material' | 'no-approved-questions' | 'thin-approved-set'>;
  latestGenerationRun?: { runId: ObjectId; status: 'queued' | 'running' | 'completed' | 'partial' | 'failed'; stage: string };
  approved?: number;
} = {}): void {
  const approved = overrides.approved ?? 5;
  jest.mocked(getCourseContentMap).mockResolvedValue({
    themes: [{
      themeId,
      name: 'Time Value',
      order: 0,
      los: [{
        loId,
        name: 'Discount cash flows',
        order: 0,
        materials: [contentMapMaterial()],
        materialCounts: { lecture: 1 },
        questionCounts: {
          draft: 0,
          'pending-review': 0,
          reviewed: 0,
          approved,
          paused: 0,
          archived: 0,
        },
        ...(overrides.latestGenerationRun ? { latestGenerationRun: overrides.latestGenerationRun } : {}),
        gaps: overrides.gaps ?? [],
      }],
    }],
    unassignedMaterials: [],
  });
}

function mockEmptyCourseContent(): void {
  jest.mocked(publishChecklist).mockResolvedValue(emptyContentChecklist);
  jest.mocked(getCourseContentMap).mockResolvedValue({ themes: [], unassignedMaterials: [] });
  jest.mocked(listMaterials).mockResolvedValue([]);
  jest.mocked(reviewQueue).mockResolvedValue([]);
  jest.mocked(browseBank).mockResolvedValue({ total: 0, questions: [] });
}

function summarize() {
  return instructorWorkflowSummary(courseId, instructorPuid);
}

beforeEach(() => {
  mockCourse();
  jest.mocked(publishChecklist).mockResolvedValue(completeChecklist);
  mockHealthyContent();
  jest.mocked(listMaterials).mockResolvedValue([material()] as never);
  jest.mocked(reviewQueue).mockResolvedValue([]);
  jest.mocked(browseBank).mockResolvedValue({ total: 5, questions: [] });
  jest.mocked(listFlags).mockResolvedValue([]);
  jest.mocked(lowEngagement).mockResolvedValue([]);
  jest.mocked(hasRecentPreviewAttempt).mockResolvedValue(false);
});

describe('Instructor workflow summary', () => {
  it('includes saved course dates and checks Preview without creating a session', async () => {
    const result = await summarize();

    expect(result.course).toMatchObject({
      termStart: new Date('2026-09-08T00:00:00.000Z'),
      termEnd: new Date('2026-12-07T23:59:59.999Z'),
    });
    expect(hasRecentPreviewAttempt).toHaveBeenCalledWith(courseId, instructorPuid);
  });

  it('derives the truthful five-step state and authoring-path decision for an empty course', async () => {
    mockEmptyCourseContent();

    const result = await summarize();

    expect(result.readiness).toMatchObject({ completed: 2, total: 5, percent: 40 });
    expect(result.counts).toMatchObject({
      topics: 0,
      learningObjectives: 0,
      materials: 0,
      readyMaterials: 0,
      processingMaterials: 0,
      failedMaterials: 0,
      totalQuestions: 0,
    });
    expect(result.setup.steps.map(({ id, status, detail, blockedBy }) => ({ id, status, detail, blockedBy })))
      .toEqual([
        { id: 'sources', status: 'not-started', detail: 'No sources yet', blockedBy: undefined },
        { id: 'learning-objectives', status: 'not-started', detail: 'Not started', blockedBy: undefined },
        { id: 'questions', status: 'blocked', detail: 'Waiting for LOs', blockedBy: 'learning-objectives' },
        { id: 'review', status: 'blocked', detail: 'Waiting for questions', blockedBy: 'questions' },
        { id: 'student-preview', status: 'blocked', detail: 'Waiting for Approved questions', blockedBy: 'review' },
      ]);
    expect(result.setup.primaryAction).toMatchObject({
      id: 'choose-authoring-path',
      presentation: 'dialog',
    });
    expect(result.actions.map((action) => action.id)).toEqual(['choose-authoring-path']);
  });

  it('shows a processing source as in progress and keeps LOs blocked behind it', async () => {
    mockEmptyCourseContent();
    const processing = material('processing', []);
    jest.mocked(listMaterials).mockResolvedValue([processing] as never);
    jest.mocked(getCourseContentMap).mockResolvedValue({
      themes: [],
      unassignedMaterials: [contentMapMaterial('processing')],
    });

    const result = await summarize();

    expect(result.counts).toMatchObject({ materials: 1, processingMaterials: 1, readyMaterials: 0 });
    expect(result.setup.steps[0]).toMatchObject({ id: 'sources', status: 'in-progress', detail: '1 processing' });
    expect(result.setup.steps[1]).toMatchObject({
      id: 'learning-objectives',
      status: 'blocked',
      blockedBy: 'sources',
    });
    expect(result.setup.primaryAction).toMatchObject({ id: 'monitor-sources', presentation: 'dialog' });
  });

  it('surfaces a failed source as needing attention and makes repair primary', async () => {
    mockEmptyCourseContent();
    const runId = new ObjectId();
    jest.mocked(listMaterials).mockResolvedValue([material('failed', [])] as never);
    jest.mocked(getCourseContentMap).mockResolvedValue({
      themes: [],
      unassignedMaterials: [contentMapMaterial('failed', { runId, status: 'failed', stage: 'embedding' })],
    });

    const result = await summarize();

    expect(result.counts).toMatchObject({ failedMaterials: 1, contentIssues: 1 });
    expect(result.setup.steps[0]).toMatchObject({ id: 'sources', status: 'needs-attention', detail: '1 failed' });
    expect(result.setup.primaryAction).toMatchObject({ id: 'repair-content', presentation: 'workspace' });
  });

  it('moves a ready source with no LOs to the reviewed hierarchy step', async () => {
    mockEmptyCourseContent();
    jest.mocked(listMaterials).mockResolvedValue([material('ready', [])] as never);
    jest.mocked(getCourseContentMap).mockResolvedValue({
      themes: [],
      unassignedMaterials: [contentMapMaterial('ready')],
    });

    const result = await summarize();

    expect(result.counts).toMatchObject({ materials: 1, readyMaterials: 1 });
    expect(result.setup.steps[0]).toMatchObject({ id: 'sources', status: 'ready', detail: '1 ready' });
    expect(result.setup.steps[1]).toMatchObject({
      id: 'learning-objectives',
      status: 'needs-attention',
      detail: 'Ready to create',
    });
    expect(result.setup.primaryAction).toMatchObject({ id: 'build-structure', presentation: 'dialog' });
  });

  it('guides an LO-first course with no source to upload supporting material', async () => {
    jest.mocked(listMaterials).mockResolvedValue([]);
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

    const result = await summarize();

    expect(result.setup.steps[0]).toMatchObject({ status: 'not-started', detail: 'No sources yet' });
    expect(result.setup.steps[1]).toMatchObject({ status: 'ready', detail: '1 LO' });
    expect(result.setup.primaryAction).toMatchObject({ id: 'upload-sources', presentation: 'dialog' });
  });

  it('keeps active generation visible as the primary in-dialog task', async () => {
    const runId = new ObjectId();
    mockHealthyContent({
      approved: 0,
      gaps: ['no-approved-questions'],
      latestGenerationRun: { runId, status: 'running', stage: 'generating' },
    });
    jest.mocked(publishChecklist).mockResolvedValue(
      completeChecklist.map((item) => item.item.includes('Every LO') ? { ...item, ok: false } : item),
    );
    jest.mocked(browseBank).mockResolvedValue({ total: 0, questions: [] });

    const result = await summarize();

    expect(result.counts.activeGenerationRuns).toBe(1);
    expect(result.setup.steps[2]).toMatchObject({
      id: 'questions',
      status: 'in-progress',
      detail: '1 run active',
    });
    expect(result.setup.primaryAction).toMatchObject({ id: 'monitor-generation', presentation: 'dialog' });
  });

  it('makes a review backlog the next task and marks Review as needing attention', async () => {
    jest.mocked(reviewQueue).mockResolvedValue([{}, {}, {}] as never);
    jest.mocked(browseBank).mockResolvedValue({ total: 3, questions: [] });

    const result = await summarize();

    expect(result.counts).toMatchObject({ approvedQuestions: 3, reviewQueue: 3, totalQuestions: 6 });
    expect(result.setup.steps[3]).toMatchObject({
      id: 'review',
      status: 'needs-attention',
      detail: '3 waiting',
      count: 3,
    });
    expect(result.setup.primaryAction).toMatchObject({ id: 'review-questions', presentation: 'dialog' });
  });

  it('marks a recent Preview complete and makes Publish the primary launch action', async () => {
    jest.mocked(hasRecentPreviewAttempt).mockResolvedValue(true);

    const result = await summarize();

    expect(result.setup.steps[4]).toMatchObject({
      id: 'student-preview',
      status: 'complete',
      detail: 'Tested recently',
    });
    expect(result.setup.primaryAction).toMatchObject({ id: 'publish-course', presentation: 'workspace' });
  });

  it('reduces a healthy published course to one monitoring recommendation', async () => {
    mockCourse('published');

    const result = await summarize();

    expect(result.readiness.percent).toBe(100);
    expect(result.actions).toEqual([
      expect.objectContaining({ id: 'monitor-course', destination: 'analytics', priority: 'normal' }),
    ]);
    expect(result.setup.primaryAction).toMatchObject({ id: 'monitor-course', presentation: 'workspace' });
  });

  it('offers only restore and makes it primary for an archived course', async () => {
    mockCourse('archived');
    jest.mocked(publishChecklist).mockResolvedValue(completeChecklist.map((item) => ({ ...item, ok: false })));

    const result = await summarize();

    expect(result.actions).toEqual([
      expect.objectContaining({ id: 'restore-course', destination: 'dashboard', priority: 'normal' }),
    ]);
    expect(result.setup.primaryAction).toMatchObject({ id: 'restore-course', presentation: 'workspace' });
  });
});
