import { ObjectId } from 'mongodb';
import type { WithId } from 'mongodb';

jest.mock('../../server/src/components/mongodb/collections', () => ({
  coursesCol: jest.fn(),
  themesCol: jest.fn(),
  losCol: jest.fn(),
  flagsCol: jest.fn(),
  questionsCol: jest.fn(),
  questionVersionsCol: jest.fn(),
}));

import { buildQuestionWorkspace, type WorkspaceInput } from '../../server/src/services/question-workspace.service';
import type { BankItem } from '../../server/src/services/bank.service';
import type { PublicationState, Question, QuestionVersion } from '../../server/src/types/domain';

const now = new Date('2026-11-09T12:00:00Z');
const past = new Date('2026-11-01T00:00:00Z');
const future = new Date('2026-12-01T00:00:00Z');
const courseId = new ObjectId();
const t1 = new ObjectId();
const t2 = new ObjectId();
const lo1 = new ObjectId();
const lo2 = new ObjectId();

function item(state: PublicationState, overrides: Partial<WithId<Question>> = {}, version: Partial<QuestionVersion> = {}): BankItem {
  const _id = new ObjectId();
  const currentVersionId = new ObjectId();
  return {
    _id,
    courseId,
    currentVersionId,
    currentVersion: 1,
    state,
    loIds: [lo1],
    themeIds: [t1],
    labels: [],
    internalNotes: [],
    createdAt: new Date('2026-10-01'),
    updatedAt: new Date('2026-10-01'),
    ...overrides,
    current: {
      _id: currentVersionId,
      questionId: _id,
      version: 1,
      type: 'mcq',
      stem: 'Stem',
      options: [],
      difficulty: 'easy',
      sourceRefs: [],
      createdBy: 'pipeline',
      createdAt: new Date('2026-10-01'),
      ...version,
    },
  } as BankItem;
}

function input(overrides: Partial<WorkspaceInput> = {}): WorkspaceInput {
  return {
    course: { published: true, lifecycle: 'published' },
    themes: [
      { _id: t1, name: 'Topic 1', order: 0, availableFrom: past, revision: 3 },
      { _id: t2, name: 'Topic 2', order: 1 },
    ],
    los: [{ _id: lo1, order: 0 }, { _id: lo2, order: 1 }],
    questions: [],
    openFlags: [],
    contentReady: () => true,
    now,
    ...overrides,
  };
}

describe('buildQuestionWorkspace counts', () => {
  it('counts each tab and splits approved into visible and waiting', () => {
    const questions = [
      item('draft'), item('pending-review'), item('reviewed'),
      item('approved'), item('approved', { themeIds: [t2] }),
      item('paused'), item('archived'), item('archived'),
    ];
    const ws = buildQuestionWorkspace(input({ questions }), 'review');
    expect(ws.counts).toEqual({ review: 3, approved: 2, approvedVisible: 1, approvedWaiting: 1, flags: 0, paused: 1, archived: 2 });
    expect(ws.rows).toHaveLength(3);
  });

  it('includes flagged questions of any state in the flags tab', () => {
    const archived = item('archived');
    const approved = item('approved');
    const ws = buildQuestionWorkspace(input({
      questions: [archived, approved, item('draft')],
      openFlags: [{ questionId: archived._id, createdAt: past }, { questionId: approved._id, createdAt: past }, { questionId: approved._id, createdAt: now }],
    }), 'flags');
    expect(ws.counts.flags).toBe(2);
    expect(ws.rows.map((row) => row.item._id)).toEqual([approved._id, archived._id]);
    expect(ws.rows[0].openFlagCount).toBe(2);
  });
});

describe('buildQuestionWorkspace student visibility', () => {
  it('hides a question whose Topic was never released', () => {
    const q = item('approved', { themeIds: [t2] });
    const ws = buildQuestionWorkspace(input({ questions: [q] }), 'approved');
    expect(ws.rows[0]).toMatchObject({ studentVisible: false, hiddenReason: 'topic-unreleased' });
    expect(ws.release.hiddenApprovedCount).toBe(1);
  });

  it('reports a future release date as scheduled', () => {
    const themes = [{ _id: t1, name: 'Topic 1', order: 0, availableFrom: future }];
    const ws = buildQuestionWorkspace(input({ themes, questions: [item('approved')] }), 'approved');
    expect(ws.rows[0]).toMatchObject({ studentVisible: false, hiddenReason: 'topic-scheduled' });
    expect(ws.release.themes[0]).toMatchObject({ released: false, availableFrom: future.toISOString(), revision: 0 });
  });

  it('hides content that is not servable', () => {
    const ws = buildQuestionWorkspace(input({ questions: [item('approved')], contentReady: () => false }), 'approved');
    expect(ws.rows[0]).toMatchObject({ studentVisible: false, hiddenReason: 'content-not-ready' });
    expect(ws.release.hiddenApprovedCount).toBe(1);
  });

  it('hides a multi-Topic question when any one of its Topics is unreleased', () => {
    const ws = buildQuestionWorkspace(input({ questions: [item('approved', { themeIds: [t1, t2] })] }), 'approved');
    expect(ws.rows[0].studentVisible).toBe(false);
    expect(ws.release.themes.map((theme) => theme.approvedCount)).toEqual([1, 1]);
  });

  it('hides everything while the course is unpublished', () => {
    const ws = buildQuestionWorkspace(input({ course: { published: false }, questions: [item('approved')] }), 'approved');
    expect(ws.release.coursePublished).toBe(false);
    expect(ws.rows[0]).toMatchObject({ studentVisible: false, hiddenReason: 'course-unpublished' });
    expect(ws.counts.approvedVisible).toBe(0);
  });

  it('treats an explicit published lifecycle as authoritative', () => {
    const ws = buildQuestionWorkspace(input({ course: { published: true, lifecycle: 'draft' }, questions: [item('approved')] }), 'approved');
    expect(ws.release.coursePublished).toBe(false);
  });

  it('shows a released, ready, approved question as visible', () => {
    const ws = buildQuestionWorkspace(input({ questions: [item('approved')] }), 'approved');
    expect(ws.rows[0]).toMatchObject({ studentVisible: true });
    expect(ws.rows[0].hiddenReason).toBeUndefined();
    expect(ws.release.themes[0]).toMatchObject({ themeId: t1.toHexString(), released: true, revision: 3, approvedCount: 1 });
  });
});

describe('buildQuestionWorkspace rows', () => {
  it('maps the agent verdict, but not onto an edited version', () => {
    const checked = item('draft', { agentDecision: { decision: 'flag', reasoning: 'r', roleAssessment: 'a' } });
    const edited = item('draft', { agentDecision: { decision: 'pass', reasoning: 'r', roleAssessment: 'a' } }, { provenance: { kind: 'edited' } } as Partial<QuestionVersion>);
    const ws = buildQuestionWorkspace(input({ questions: [checked, edited] }), 'review');
    const byId = new Map(ws.rows.map((row) => [row.item._id.toHexString(), row]));
    expect(byId.get(checked._id.toHexString())?.agentVerdict).toBe('flag');
    expect(byId.get(edited._id.toHexString())?.agentVerdict).toBeUndefined();
  });

  it('orders To review by the review-queue priority order', () => {
    const a = item('draft');
    const b = item('reviewed');
    const c = item('pending-review');
    const ws = buildQuestionWorkspace(input({
      questions: [a, b, c],
      reviewPriority: [{ id: b._id.toHexString(), priority: 2 }, { id: c._id.toHexString(), priority: 3 }, { id: a._id.toHexString(), priority: 3 }],
    }), 'review');
    expect(ws.rows.map((row) => row.item._id)).toEqual([b._id, c._id, a._id]);
    expect(ws.rows.map((row) => row.priority)).toEqual([2, 3, 3]);
  });

  it('orders Approved by Topic then LO order', () => {
    const t2lo1 = item('approved', { themeIds: [t2], loIds: [lo1] });
    const t1lo2 = item('approved', { themeIds: [t1], loIds: [lo2] });
    const t1lo1 = item('approved', { themeIds: [t1], loIds: [lo1] });
    const ws = buildQuestionWorkspace(input({ questions: [t2lo1, t1lo2, t1lo1] }), 'approved');
    expect(ws.rows.map((row) => row.item._id)).toEqual([t1lo1._id, t1lo2._id, t2lo1._id]);
  });

  it('orders Paused and Archived newest first', () => {
    const older = item('paused', { updatedAt: new Date('2026-10-01') });
    const newer = item('paused', { updatedAt: new Date('2026-11-01') });
    const ws = buildQuestionWorkspace(input({ questions: [older, newer] }), 'paused');
    expect(ws.rows.map((row) => row.item._id)).toEqual([newer._id, older._id]);
  });
});
