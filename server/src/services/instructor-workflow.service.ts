import type { ObjectId } from 'mongodb';
import { lowEngagement } from './analytics.service';
import { browseBank, reviewQueue } from './bank.service';
import { getCourseContentMap } from './content-map.service';
import { getCourseTree, publishChecklist } from './courses.service';
import { listFlags } from './flags.service';

export type InstructorWorkflowPriority = 'blocking' | 'high' | 'normal';

export type InstructorWorkflowDestination =
  | 'settings'
  | 'structure'
  | 'materials'
  | 'content-map'
  | 'preseeding'
  | 'review-queue'
  | 'bank'
  | 'flags'
  | 'analytics'
  | 'student-preview'
  | 'dashboard';

export interface InstructorWorkflowAction {
  id:
    | 'configure-course'
    | 'build-structure'
    | 'assign-materials'
    | 'repair-content'
    | 'seed-thin-los'
    | 'review-questions'
    | 'resolve-flags'
    | 'follow-up-students'
    | 'preview-course'
    | 'publish-course'
    | 'restore-course'
    | 'monitor-course';
  priority: InstructorWorkflowPriority;
  destination: InstructorWorkflowDestination;
  title: string;
  detail: string;
  count?: number;
}

export interface InstructorWorkflowSummary {
  course: {
    id: string;
    name: string;
    courseCode: string;
    section?: string;
    term: string;
    lifecycle: 'draft' | 'published' | 'archived';
  };
  readiness: {
    completed: number;
    total: number;
    percent: number;
    checklist: Array<{ item: string; ok: boolean }>;
  };
  counts: {
    topics: number;
    learningObjectives: number;
    approvedQuestions: number;
    reviewQueue: number;
    openFlags: number;
    thinLos: number;
    unassignedMaterials: number;
    contentIssues: number;
    lowEngagementStudents: number;
  };
  actions: InstructorWorkflowAction[];
}

const PRIORITY_ORDER: Record<InstructorWorkflowPriority, number> = {
  blocking: 0,
  high: 1,
  normal: 2,
};

function checklistOk(checklist: Array<{ item: string; ok: boolean }>, fragment: string): boolean {
  return checklist.find((item) => item.item.toLocaleLowerCase().includes(fragment))?.ok ?? false;
}

/**
 * One read model for the Instructor Course Launch Cockpit. It deliberately
 * stores nothing: every count/action is derived from the existing domain
 * services so the dashboard cannot drift from the authoring, review, flag, or
 * analytics screens it links to.
 */
export async function instructorWorkflowSummary(courseId: ObjectId): Promise<InstructorWorkflowSummary> {
  const [tree, checklist, contentMap, queue, approvedBank, activeFlagGroups, inactiveStudents] = await Promise.all([
    getCourseTree(courseId),
    publishChecklist(courseId),
    getCourseContentMap(courseId),
    reviewQueue(courseId),
    browseBank(courseId, { state: 'approved' }),
    Promise.all([listFlags(courseId, 'open'), listFlags(courseId, 'escalated')]),
    lowEngagement(courseId, 7),
  ]);

  const los = contentMap.themes.flatMap((theme) => theme.los);
  const thinLos = los.filter((lo) =>
    lo.gaps.includes('no-approved-questions') || lo.gaps.includes('thin-approved-set'),
  );
  const materials = new Map<string, (typeof contentMap.unassignedMaterials)[number]>();
  for (const material of contentMap.unassignedMaterials) materials.set(material.materialId.toHexString(), material);
  for (const lo of los) {
    for (const material of lo.materials) materials.set(material.materialId.toHexString(), material);
  }

  const failedRunIds = new Set<string>();
  for (const material of materials.values()) {
    if (material.latestRun && ['failed', 'partial'].includes(material.latestRun.status)) {
      failedRunIds.add(material.latestRun.runId.toHexString());
    }
  }
  for (const lo of los) {
    if (lo.latestGenerationRun && ['failed', 'partial'].includes(lo.latestGenerationRun.status)) {
      failedRunIds.add(lo.latestGenerationRun.runId.toHexString());
    }
  }
  const failedMaterialsWithoutFailedRun = [...materials.values()].filter((material) =>
    material.status === 'failed'
      && (!material.latestRun || !['failed', 'partial'].includes(material.latestRun.status)),
  ).length;
  const contentIssues = failedMaterialsWithoutFailedRun + failedRunIds.size;
  const activeFlags = activeFlagGroups.flat();
  const lifecycle = tree.lifecycle ?? (tree.archivedAt ? 'archived' : tree.published ? 'published' : 'draft');

  const actions: InstructorWorkflowAction[] = [];
  const needsSettings = !checklistOk(checklist, 'term dates') || !checklistOk(checklist, 'registration code');
  if (needsSettings) {
    actions.push({
      id: 'configure-course',
      priority: 'blocking',
      destination: 'settings',
      title: 'Complete course settings',
      detail: 'Set term dates and generate the registration code required for launch.',
    });
  }
  if (!checklistOk(checklist, 'at least one theme') || !checklistOk(checklist, 'learning objective')) {
    actions.push({
      id: 'build-structure',
      priority: 'blocking',
      destination: 'structure',
      title: 'Build the course structure',
      detail: 'Add at least one Topic and Learning Objective before preparing content.',
    });
  }
  if (contentMap.unassignedMaterials.length > 0) {
    actions.push({
      id: 'assign-materials',
      priority: 'high',
      destination: 'materials',
      title: 'Assign course materials',
      detail: `${contentMap.unassignedMaterials.length} material${contentMap.unassignedMaterials.length === 1 ? '' : 's'} still need a Topic or LO assignment.`,
      count: contentMap.unassignedMaterials.length,
    });
  }
  if (contentIssues > 0) {
    actions.push({
      id: 'repair-content',
      priority: 'high',
      destination: 'content-map',
      title: 'Repair content processing issues',
      detail: `${contentIssues} failed or partial material/generation result${contentIssues === 1 ? '' : 's'} need attention.`,
      count: contentIssues,
    });
  }
  if (thinLos.length > 0) {
    actions.push({
      id: 'seed-thin-los',
      priority: 'high',
      destination: 'preseeding',
      title: 'Fill thin Learning Objectives',
      detail: `${thinLos.length} LO${thinLos.length === 1 ? '' : 's'} have fewer than 3 Approved questions.`,
      count: thinLos.length,
    });
  }
  if (queue.length > 0) {
    actions.push({
      id: 'review-questions',
      priority: 'high',
      destination: 'review-queue',
      title: 'Review pending questions',
      detail: `${queue.length} question${queue.length === 1 ? '' : 's'} are waiting for teaching-team review.`,
      count: queue.length,
    });
  }
  if (activeFlags.length > 0) {
    actions.push({
      id: 'resolve-flags',
      priority: 'high',
      destination: 'flags',
      title: 'Resolve student flags',
      detail: `${activeFlags.length} open or escalated flag${activeFlags.length === 1 ? '' : 's'} need a decision.`,
      count: activeFlags.length,
    });
  }
  if (inactiveStudents.length > 0) {
    actions.push({
      id: 'follow-up-students',
      priority: 'normal',
      destination: 'analytics',
      title: 'Review low engagement',
      detail: `${inactiveStudents.length} student${inactiveStudents.length === 1 ? '' : 's'} have been inactive for at least 7 days.`,
      count: inactiveStudents.length,
    });
  }

  const completed = checklist.filter((item) => item.ok).length;
  const hasBlocker = actions.some((action) => action.priority === 'blocking');
  if (lifecycle === 'archived') {
    actions.splice(0, actions.length, {
      id: 'restore-course',
      priority: 'normal',
      destination: 'dashboard',
      title: 'Restore this archived course',
      detail: 'Restore it as a Draft before continuing setup, authoring, or publication.',
    });
  } else if (!hasBlocker && lifecycle === 'draft') {
    actions.push({
      id: 'preview-course',
      priority: 'normal',
      destination: 'student-preview',
      title: 'Preview the student experience',
      detail: 'Walk through the Approved-only course before making it available to students.',
    });
    if (completed === checklist.length) {
      actions.push({
        id: 'publish-course',
        priority: 'normal',
        destination: 'dashboard',
        title: 'Publish the course',
        detail: 'Every launch-readiness check is complete.',
      });
    }
  }
  if (actions.length === 0 && lifecycle === 'published') {
    actions.push({
      id: 'monitor-course',
      priority: 'normal',
      destination: 'analytics',
      title: 'Monitor course performance',
      detail: 'The course is healthy. Review learning and engagement trends.',
    });
  }

  actions.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

  return {
    course: {
      id: tree._id.toHexString(),
      name: tree.name,
      courseCode: tree.courseCode,
      ...(tree.section ? { section: tree.section } : {}),
      term: tree.term,
      lifecycle,
    },
    readiness: {
      completed,
      total: checklist.length,
      percent: checklist.length ? Math.round((completed / checklist.length) * 100) : 100,
      checklist,
    },
    counts: {
      topics: contentMap.themes.length,
      learningObjectives: los.length,
      approvedQuestions: approvedBank.total,
      reviewQueue: queue.length,
      openFlags: activeFlags.length,
      thinLos: thinLos.length,
      unassignedMaterials: contentMap.unassignedMaterials.length,
      contentIssues,
      lowEngagementStudents: inactiveStudents.length,
    },
    actions,
  };
}
