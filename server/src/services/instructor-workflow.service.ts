import type { ObjectId } from 'mongodb';
import { lowEngagement } from './analytics.service';
import { browseBank, reviewQueue } from './bank.service';
import { getCourseContentMap } from './content-map.service';
import { getCourseTree, publishChecklist } from './courses.service';
import { listFlags } from './flags.service';
import { listMaterials } from './materials.service';
import { hasRecentPreviewAttempt } from './preview.service';

export type InstructorWorkflowPriority = 'blocking' | 'high' | 'normal';
export type InstructorWorkflowStageStatus =
  | 'not-started'
  | 'blocked'
  | 'in-progress'
  | 'needs-attention'
  | 'ready'
  | 'complete';

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
    | 'configure-registration'
    | 'choose-authoring-path'
    | 'build-structure'
    | 'upload-sources'
    | 'monitor-sources'
    | 'assign-materials'
    | 'repair-content'
    | 'seed-thin-los'
    | 'monitor-generation'
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

export interface InstructorWorkflowStage {
  id: 'sources' | 'learning-objectives' | 'questions' | 'review' | 'student-preview';
  number: 1 | 2 | 3 | 4 | 5;
  label: string;
  status: InstructorWorkflowStageStatus;
  detail: string;
  destination: InstructorWorkflowDestination;
  count?: number;
  blockedBy?: InstructorWorkflowStage['id'];
}

export interface InstructorWorkflowPrimaryAction extends InstructorWorkflowAction {
  presentation: 'dialog' | 'workspace' | 'preview';
}

export interface InstructorWorkflowSummary {
  course: {
    id: string;
    name: string;
    courseCode: string;
    section?: string;
    term: string;
    termStart?: Date;
    termEnd?: Date;
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
    materials: number;
    readyMaterials: number;
    processingMaterials: number;
    failedMaterials: number;
    materialsNeedingReview: number;
    totalQuestions: number;
    activeGenerationRuns: number;
    unassignedMaterials: number;
    contentIssues: number;
    lowEngagementStudents: number;
  };
  setup: {
    steps: InstructorWorkflowStage[];
    primaryAction: InstructorWorkflowPrimaryAction;
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
export async function instructorWorkflowSummary(
  courseId: ObjectId,
  instructorPuid = '',
): Promise<InstructorWorkflowSummary> {
  const [tree, checklist, contentMap, courseMaterials, queue, approvedBank, activeFlagGroups, inactiveStudents, previewTested] = await Promise.all([
    getCourseTree(courseId),
    publishChecklist(courseId),
    getCourseContentMap(courseId),
    listMaterials(courseId),
    reviewQueue(courseId),
    browseBank(courseId, { state: 'approved' }),
    Promise.all([listFlags(courseId, 'open'), listFlags(courseId, 'escalated')]),
    lowEngagement(courseId, 7),
    instructorPuid ? hasRecentPreviewAttempt(courseId, instructorPuid) : false,
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
  const readyMaterials = courseMaterials.filter((material) => material.status === 'ready').length;
  const processingMaterials = courseMaterials.filter((material) => material.status === 'processing').length;
  const failedMaterials = courseMaterials.filter((material) => material.status === 'failed').length;
  const materialsNeedingReview = courseMaterials.filter((material) =>
    material.status === 'ready'
      && material.assignments.length === 0
      && Boolean(material.classificationSuggestion || material.classificationSuggestions?.length),
  ).length;
  const generationRuns = los
    .map((lo) => lo.latestGenerationRun)
    .filter((run): run is NonNullable<typeof run> => run !== undefined);
  const activeGenerationRuns = generationRuns.filter((run) =>
    run.status === 'queued' || run.status === 'running',
  ).length;
  const totalQuestions = approvedBank.total + queue.length;

  const actions: InstructorWorkflowAction[] = [];
  const needsDates = !checklistOk(checklist, 'term dates');
  const needsRegistration = !checklistOk(checklist, 'registration code');
  if (needsDates) {
    actions.push({
      id: 'configure-course',
      priority: 'blocking',
      destination: 'settings',
      title: 'Complete course settings',
      detail: 'Confirm the suggested start and end dates for this course section.',
    });
  }
  if (!needsDates && needsRegistration) {
    actions.push({
      id: 'configure-registration',
      priority: 'blocking',
      destination: 'settings',
      title: 'Generate a registration code',
      detail: 'Open Course Settings to create the code students need to join.',
    });
  }
  if (los.length === 0 && courseMaterials.length === 0) {
    actions.push({
      id: 'choose-authoring-path',
      priority: 'blocking',
      destination: 'structure',
      title: 'Start building course knowledge',
      detail: 'Choose whether to enter existing Learning Objectives or create them from course materials.',
    });
  } else if (processingMaterials > 0) {
    actions.push({
      id: 'monitor-sources',
      priority: 'high',
      destination: 'materials',
      title: 'Keep building your knowledge base',
      detail: `${processingMaterials} source${processingMaterials === 1 ? ' is' : 's are'} still being processed. You can safely leave this dialog open or return later.`,
      count: processingMaterials,
    });
  } else if (los.length === 0 && readyMaterials > 0) {
    actions.push({
      id: 'build-structure',
      priority: 'blocking',
      destination: 'structure',
      title: 'Create Learning Objectives from sources',
      detail: 'Review an AI-proposed Topic and Learning Objective structure before applying it.',
    });
  } else if (los.length > 0 && courseMaterials.length === 0) {
    actions.push({
      id: 'upload-sources',
      priority: 'blocking',
      destination: 'materials',
      title: 'Add supporting course materials',
      detail: 'Upload at least one source so generated questions stay grounded in your course content.',
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
  if (activeGenerationRuns > 0) {
    actions.push({
      id: 'monitor-generation',
      priority: 'high',
      destination: 'preseeding',
      title: 'Question generation is in progress',
      detail: `${activeGenerationRuns} generation run${activeGenerationRuns === 1 ? ' is' : 's are'} still working.`,
      count: activeGenerationRuns,
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
    if (approvedBank.total > 0) {
      actions.push({
        id: 'preview-course',
        priority: 'normal',
        destination: 'student-preview',
        title: 'Preview the student experience',
        detail: 'Walk through the Approved-only course before making it available to students.',
      });
    }
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

  const sourceStep: InstructorWorkflowStage = failedMaterials > 0 || materialsNeedingReview > 0
    ? {
        id: 'sources', number: 1, label: 'Sources', status: 'needs-attention', destination: 'materials',
        detail: failedMaterials > 0
          ? `${failedMaterials} failed`
          : `${materialsNeedingReview} mapping${materialsNeedingReview === 1 ? '' : 's'} to review`,
        count: courseMaterials.length,
      }
    : processingMaterials > 0
      ? {
          id: 'sources', number: 1, label: 'Sources', status: 'in-progress', destination: 'materials',
          detail: `${processingMaterials} processing`, count: courseMaterials.length,
        }
      : readyMaterials > 0
        ? {
            id: 'sources', number: 1, label: 'Sources', status: 'ready', destination: 'materials',
            detail: `${readyMaterials} ready`, count: readyMaterials,
          }
        : {
            id: 'sources', number: 1, label: 'Sources', status: 'not-started', destination: 'materials',
            detail: 'No sources yet', count: 0,
          };

  const objectiveStep: InstructorWorkflowStage = los.length > 0
    ? {
        id: 'learning-objectives', number: 2, label: 'Learning objectives',
        status: contentMap.unassignedMaterials.length > 0 ? 'needs-attention' : 'ready',
        destination: 'structure', detail: `${los.length} LO${los.length === 1 ? '' : 's'}`, count: los.length,
      }
    : processingMaterials > 0
      ? {
          id: 'learning-objectives', number: 2, label: 'Learning objectives', status: 'blocked',
          destination: 'structure', detail: 'Waiting for sources', count: 0, blockedBy: 'sources',
        }
      : readyMaterials > 0
        ? {
            id: 'learning-objectives', number: 2, label: 'Learning objectives', status: 'needs-attention',
            destination: 'structure', detail: 'Ready to create', count: 0,
          }
        : {
            id: 'learning-objectives', number: 2, label: 'Learning objectives', status: 'not-started',
            destination: 'structure', detail: 'Not started', count: 0,
          };

  const questionStep: InstructorWorkflowStage = los.length === 0
    ? {
        id: 'questions', number: 3, label: 'Questions', status: 'blocked', destination: 'preseeding',
        detail: 'Waiting for LOs', count: totalQuestions, blockedBy: 'learning-objectives',
      }
    : activeGenerationRuns > 0
      ? {
          id: 'questions', number: 3, label: 'Questions', status: 'in-progress', destination: 'preseeding',
          detail: `${activeGenerationRuns} run${activeGenerationRuns === 1 ? '' : 's'} active`, count: totalQuestions,
        }
      : generationRuns.some((run) => run.status === 'failed' || run.status === 'partial')
        ? {
            id: 'questions', number: 3, label: 'Questions', status: 'needs-attention', destination: 'preseeding',
            detail: 'Generation needs attention', count: totalQuestions,
          }
        : totalQuestions === 0
          ? {
              id: 'questions', number: 3, label: 'Questions', status: 'not-started', destination: 'preseeding',
              detail: 'Ready to generate', count: 0,
            }
          : thinLos.length > 0
            ? {
                id: 'questions', number: 3, label: 'Questions', status: 'needs-attention', destination: 'preseeding',
                detail: `${approvedBank.total} approved · ${thinLos.length} thin`, count: totalQuestions,
              }
            : {
                id: 'questions', number: 3, label: 'Questions', status: 'ready', destination: 'preseeding',
                detail: `${approvedBank.total} approved`, count: totalQuestions,
              };

  const reviewStep: InstructorWorkflowStage = totalQuestions === 0
    ? {
        id: 'review', number: 4, label: 'Review', status: 'blocked', destination: 'review-queue',
        detail: 'Waiting for questions', count: 0, blockedBy: 'questions',
      }
    : queue.length > 0
      ? {
          id: 'review', number: 4, label: 'Review', status: 'needs-attention', destination: 'review-queue',
          detail: `${queue.length} waiting`, count: queue.length,
        }
      : {
          id: 'review', number: 4, label: 'Review', status: 'ready', destination: 'review-queue',
          detail: 'All caught up', count: 0,
        };

  const previewStep: InstructorWorkflowStage = approvedBank.total === 0
    ? {
        id: 'student-preview', number: 5, label: 'Student preview', status: 'blocked', destination: 'student-preview',
        detail: 'Waiting for Approved questions', blockedBy: 'review',
      }
    : previewTested
      ? {
          id: 'student-preview', number: 5, label: 'Student preview', status: 'complete', destination: 'student-preview',
          detail: 'Tested recently',
        }
      : {
          id: 'student-preview', number: 5, label: 'Student preview', status: 'ready', destination: 'student-preview',
          detail: 'Ready to test',
        };

  const setupSteps = [sourceStep, objectiveStep, questionStep, reviewStep, previewStep];
  const primaryOrder: InstructorWorkflowAction['id'][] = lifecycle === 'archived'
    ? ['restore-course']
    : lifecycle === 'published'
      ? ['repair-content', 'assign-materials', 'monitor-generation', 'review-questions', 'seed-thin-los', 'resolve-flags', 'follow-up-students', 'monitor-course']
      : [
          'configure-course',
          'configure-registration',
          'choose-authoring-path',
          'monitor-sources',
          'repair-content',
          'build-structure',
          'upload-sources',
          'assign-materials',
          'monitor-generation',
          'review-questions',
          'seed-thin-los',
          ...(previewTested ? [] : ['preview-course' as const]),
          'publish-course',
          'resolve-flags',
          'follow-up-students',
        ];
  const primary = primaryOrder
    .map((id) => actions.find((action) => action.id === id))
    .find((action): action is InstructorWorkflowAction => action !== undefined) ?? {
    id: 'monitor-course' as const,
    priority: 'normal' as const,
    destination: 'analytics' as const,
    title: 'Monitor course performance',
    detail: 'The course is healthy. Review learning and engagement trends.',
  };
  const primaryAction: InstructorWorkflowPrimaryAction = {
    ...primary,
    presentation: ['configure-course', 'choose-authoring-path', 'build-structure', 'upload-sources', 'monitor-sources', 'seed-thin-los', 'monitor-generation', 'review-questions'].includes(primary.id)
      ? 'dialog'
      : primary.id === 'preview-course'
        ? 'preview'
        : 'workspace',
  };

  return {
    course: {
      id: tree._id.toHexString(),
      name: tree.name,
      courseCode: tree.courseCode,
      ...(tree.section ? { section: tree.section } : {}),
      term: tree.term,
      ...(tree.termStart ? { termStart: tree.termStart } : {}),
      ...(tree.termEnd ? { termEnd: tree.termEnd } : {}),
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
      materials: courseMaterials.length,
      readyMaterials,
      processingMaterials,
      failedMaterials,
      materialsNeedingReview,
      totalQuestions,
      activeGenerationRuns,
      unassignedMaterials: contentMap.unassignedMaterials.length,
      contentIssues,
      lowEngagementStudents: inactiveStudents.length,
    },
    setup: { steps: setupSteps, primaryAction },
    actions,
  };
}
