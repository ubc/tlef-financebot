import type { ObjectId, WithId } from 'mongodb';
import { coursesCol, flagsCol, losCol, themesCol } from '../components/mongodb/collections';
import type { Course, LearningObjective, PublicationState, QuestionVersion, Theme } from '../types/domain';
import { browseBank, reviewQueue, type BankItem } from './bank.service';
import { courseLifecycle } from './courses.service';
import { isServable } from './numeric-gate.service';
import { isThemeReleased, releasedForServing } from './theme-release';

// -----------------------------------------------------------------------------
// Instructor Questions workspace (spec 2026-11-09-instructor-questions-workspace).
// One read that powers the merged Review / Approved / Student flags / Paused /
// Archived page: tab counts, the per-Topic release summary, and the rows of the
// requested tab. Student visibility is decided HERE, with theme-release.ts, so
// the client never re-derives it and cannot drift from serving.
//
// `buildQuestionWorkspace` is pure (unit-tested without Mongo);
// `loadQuestionWorkspace` gathers its input.
// -----------------------------------------------------------------------------

export const WORKSPACE_TABS = ['review', 'approved', 'flags', 'paused', 'archived'] as const;
export type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

const REVIEW_STATES: ReadonlySet<PublicationState> = new Set<PublicationState>(['draft', 'pending-review', 'reviewed']);

/** Why an item is not visible to students, in the order a reader should fix it. */
export type HiddenReason = 'not-approved' | 'course-unpublished' | 'topic-unreleased' | 'topic-scheduled' | 'content-not-ready';

/** Same rule `toBankItem` reports as `contentReady`. */
export function isContentReady(current: QuestionVersion): boolean {
  return Array.isArray(current.options) && typeof current.stem === 'string' && isServable(current);
}

export interface WorkspaceInput {
  course: Pick<Course, 'published' | 'lifecycle' | 'archivedAt'>;
  /** Active (non-archived) Themes of the course. */
  themes: Array<Pick<WithId<Theme>, '_id' | 'name' | 'order' | 'availableFrom' | 'revision'>>;
  /** Active LOs, for Approved ordering. */
  los: Array<Pick<WithId<LearningObjective>, '_id' | 'order'>>;
  /** Every question of the course, archived included, joined to its current version. */
  questions: BankItem[];
  /** Open or escalated flags of the course. */
  openFlags: Array<{ questionId: ObjectId; createdAt: Date }>;
  /** bank.service reviewQueue() order and priorities; only needed for the review tab. */
  reviewPriority?: Array<{ id: string; priority: number }>;
  contentReady?: (item: BankItem) => boolean;
  now?: Date;
}

export interface WorkspaceRowCore {
  item: BankItem;
  agentVerdict?: 'pass' | 'flag' | 'reject';
  openFlagCount: number;
  priority?: number;
  studentVisible: boolean;
  hiddenReason?: HiddenReason;
}

export interface WorkspaceCounts {
  review: number;
  approved: number;
  approvedVisible: number;
  approvedWaiting: number;
  flags: number;
  paused: number;
  archived: number;
}

export interface WorkspaceRelease {
  coursePublished: boolean;
  themes: Array<{
    themeId: string;
    name: string;
    order: number;
    revision: number;
    availableFrom: string | null;
    released: boolean;
    approvedCount: number;
  }>;
  hiddenApprovedCount: number;
}

export interface QuestionWorkspaceCore {
  counts: WorkspaceCounts;
  release: WorkspaceRelease;
  rows: WorkspaceRowCore[];
}

function inTab(row: WorkspaceRowCore, tab: WorkspaceTab): boolean {
  const state = row.item.state;
  switch (tab) {
    case 'review': return REVIEW_STATES.has(state);
    case 'approved': return state === 'approved';
    case 'flags': return row.openFlagCount > 0;
    case 'paused': return state === 'paused';
    case 'archived': return state === 'archived';
  }
}

/** Mirrors getQuestionDetail(): an edited version must not show the
 * generation-time assessment as its own. */
function agentVerdictOf(item: BankItem): WorkspaceRowCore['agentVerdict'] {
  if (item.current.provenance?.kind === 'edited') return undefined;
  return item.agentDecision?.decision;
}

function time(value: Date | undefined): number {
  return value instanceof Date ? value.getTime() : 0;
}

export function buildQuestionWorkspace(input: WorkspaceInput, tab: WorkspaceTab): QuestionWorkspaceCore {
  const now = input.now ?? new Date();
  const contentReady = input.contentReady ?? ((item: BankItem) => isContentReady(item.current));
  const coursePublished = courseLifecycle(input.course) === 'published';

  const themeById = new Map(input.themes.map((theme) => [theme._id.toHexString(), theme]));
  const unreleased = new Set(input.themes.filter((theme) => !isThemeReleased(theme, now)).map((theme) => theme._id.toHexString()));

  const flagCount = new Map<string, number>();
  const latestFlag = new Map<string, number>();
  for (const flag of input.openFlags) {
    const id = flag.questionId.toHexString();
    flagCount.set(id, (flagCount.get(id) ?? 0) + 1);
    latestFlag.set(id, Math.max(latestFlag.get(id) ?? 0, time(flag.createdAt)));
  }
  const priorityById = new Map((input.reviewPriority ?? []).map((entry, index) => [entry.id, { priority: entry.priority, index }]));

  const rows: WorkspaceRowCore[] = input.questions.map((item) => {
    const id = item._id.toHexString();
    let hiddenReason: HiddenReason | undefined;
    if (item.state !== 'approved') hiddenReason = 'not-approved';
    else if (!coursePublished) hiddenReason = 'course-unpublished';
    else if (!releasedForServing(item, unreleased)) {
      // Any blocking Topic with no date at all needs an action; only when
      // every blocking Topic has a future date is the question "scheduled".
      const blocking = item.themeIds.filter((themeId) => unreleased.has(themeId.toHexString()));
      const undated = blocking.some((themeId) => themeById.get(themeId.toHexString())?.availableFrom === undefined);
      hiddenReason = undated ? 'topic-unreleased' : 'topic-scheduled';
    } else if (!contentReady(item)) hiddenReason = 'content-not-ready';
    const priority = priorityById.get(id)?.priority;
    const verdict = agentVerdictOf(item);
    return {
      item,
      ...(verdict ? { agentVerdict: verdict } : {}),
      openFlagCount: flagCount.get(id) ?? 0,
      ...(priority !== undefined && REVIEW_STATES.has(item.state) ? { priority } : {}),
      studentVisible: hiddenReason === undefined,
      ...(hiddenReason ? { hiddenReason } : {}),
    };
  });

  const approved = rows.filter((row) => row.item.state === 'approved');
  const approvedVisible = approved.filter((row) => row.studentVisible).length;
  const counts: WorkspaceCounts = {
    review: rows.filter((row) => inTab(row, 'review')).length,
    approved: approved.length,
    approvedVisible,
    approvedWaiting: approved.length - approvedVisible,
    flags: rows.filter((row) => inTab(row, 'flags')).length,
    paused: rows.filter((row) => inTab(row, 'paused')).length,
    archived: rows.filter((row) => inTab(row, 'archived')).length,
  };

  const release: WorkspaceRelease = {
    coursePublished,
    themes: [...input.themes]
      .sort((a, b) => a.order - b.order)
      .map((theme) => ({
        themeId: theme._id.toHexString(),
        name: theme.name,
        order: theme.order,
        revision: theme.revision ?? 0,
        availableFrom: theme.availableFrom ? theme.availableFrom.toISOString() : null,
        released: isThemeReleased(theme, now),
        approvedCount: approved.filter((row) => row.item.themeIds.some((id) => id.equals(theme._id))).length,
      })),
    hiddenApprovedCount: approved.length - approvedVisible,
  };

  const themeOrder = (row: WorkspaceRowCore): number => {
    const orders = row.item.themeIds.map((id) => themeById.get(id.toHexString())?.order).filter((o): o is number => o !== undefined);
    return orders.length ? Math.min(...orders) : Number.POSITIVE_INFINITY;
  };
  const loOrderById = new Map(input.los.map((lo) => [lo._id.toHexString(), lo.order]));
  const loOrder = (row: WorkspaceRowCore): number => {
    const first = row.item.loIds[0];
    return first ? (loOrderById.get(first.toHexString()) ?? Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;
  };
  const compareNumbers = (a: number, b: number): number => (a === b ? 0 : a < b ? -1 : 1);
  const newestFirst = (a: WorkspaceRowCore, b: WorkspaceRowCore): number => time(b.item.updatedAt) - time(a.item.updatedAt);

  const tabRows = rows.filter((row) => inTab(row, tab));
  switch (tab) {
    case 'review':
      tabRows.sort((a, b) => compareNumbers(
        priorityById.get(a.item._id.toHexString())?.index ?? Number.POSITIVE_INFINITY,
        priorityById.get(b.item._id.toHexString())?.index ?? Number.POSITIVE_INFINITY,
      ) || newestFirst(a, b));
      break;
    case 'approved':
      tabRows.sort((a, b) => compareNumbers(themeOrder(a), themeOrder(b))
        || compareNumbers(loOrder(a), loOrder(b))
        || time(a.item.createdAt) - time(b.item.createdAt));
      break;
    case 'flags':
      tabRows.sort((a, b) => b.openFlagCount - a.openFlagCount
        || (latestFlag.get(b.item._id.toHexString()) ?? 0) - (latestFlag.get(a.item._id.toHexString()) ?? 0));
      break;
    default:
      tabRows.sort(newestFirst);
  }

  return { counts, release, rows: tabRows };
}

/** Gathers the course's workspace input and builds the requested tab. */
export async function loadQuestionWorkspace(courseId: ObjectId, tab: WorkspaceTab, now: Date = new Date()): Promise<QuestionWorkspaceCore> {
  const course = await coursesCol().findOne({ _id: courseId }, { projection: { published: 1, lifecycle: 1, archivedAt: 1 } });
  if (!course) throw new Error('course-not-found');
  const [themes, los, bank, openFlags, queue] = await Promise.all([
    themesCol().find({ courseId, archivedAt: { $exists: false } }).toArray(),
    losCol().find({ courseId, archivedAt: { $exists: false } }, { projection: { order: 1 } }).toArray(),
    browseBank(courseId, { includeArchived: true }),
    flagsCol().find({ courseId, state: { $in: ['open', 'escalated'] } }, { projection: { questionId: 1, createdAt: 1 } }).toArray(),
    tab === 'review' ? reviewQueue(courseId) : Promise.resolve([]),
  ]);
  return buildQuestionWorkspace({
    course,
    themes,
    los,
    questions: bank.questions,
    openFlags,
    reviewPriority: queue.map((item) => ({ id: item._id.toHexString(), priority: item.priority })),
    now,
  }, tab);
}
