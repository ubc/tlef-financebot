import { tutorialProgressCol } from '../components/mongodb/collections';
import type {
  TutorialProgress,
  TutorialProgressStatus,
  TutorialRole,
} from '../types/domain';

export interface TutorialDefinition {
  id: string;
  role: TutorialRole;
  version: number;
  title: string;
  description: string;
  estimatedSeconds: number;
}

/** Student tutorials are intentionally separate, contextual micro-tours. They
 * stay below roughly 20 seconds and unlock on first use of each feature. */
export const TUTORIAL_CATALOG: readonly TutorialDefinition[] = [
  {
    id: 'student-welcome',
    role: 'student',
    version: 1,
    title: 'Getting started',
    description: 'Join a course and find your learning projects.',
    estimatedSeconds: 20,
  },
  {
    id: 'student-course-home',
    role: 'student',
    version: 1,
    title: 'Course Home',
    description: 'Choose a Topic and follow your learning progress.',
    estimatedSeconds: 20,
  },
  {
    id: 'student-practice',
    role: 'student',
    version: 1,
    title: 'Practice',
    description: 'Answer, submit, and use feedback to improve.',
    estimatedSeconds: 20,
  },
  {
    id: 'student-review-book',
    role: 'student',
    version: 1,
    title: 'Review Book',
    description: 'Revisit missed or bookmarked questions.',
    estimatedSeconds: 20,
  },
  {
    id: 'student-exam-prep',
    role: 'student',
    version: 1,
    title: 'Exam Prep',
    description: 'Start an available practice sitting and review your history.',
    estimatedSeconds: 20,
  },
{"id": "student-topics", "role": "student", "version": 1, "title": "Topics and Learning Objectives", "description": "Each Learning Objective links to practice. Available question counts help you choose where to begin.", "estimatedSeconds": 20},
{"id": "student-feedback", "role": "student", "version": 1, "title": "Learning from feedback", "description": "Review the explanation shown for your answer. Your course strategy determines which answers are revealed and whether a similar retry appears.", "estimatedSeconds": 20},
{"id": "student-session-summary", "role": "student", "version": 1, "title": "Session Summary", "description": "Review questions answered, correct answers and objectives covered. These describe this session, not an exam grade.", "estimatedSeconds": 20},
{"id": "student-exam-results", "role": "student", "version": 1, "title": "Exam results and history", "description": "Results appear only after submission. Topic and objective breakdowns help you locate weak areas.", "estimatedSeconds": 20},
{"id": "instructor-welcome", "role": "instructor", "version": 1, "title": "Your course projects", "description": "Find your courses here. Each project has its own sources, learning objectives, question review and student activity.", "estimatedSeconds": 20},
{"id": "instructor-course-setup", "role": "instructor", "version": 1, "title": "Prepare a course", "description": "Use Sources, Learning Objectives, Questions, Review and Student Preview to prepare your course. The guide resumes from the actual course state.", "estimatedSeconds": 20},
{"id": "instructor-materials", "role": "instructor", "version": 2, "title": "Sources and knowledge", "description": "Upload course sources, follow durable processing, and review the evidence mapped to each learning objective.", "estimatedSeconds": 20},
{"id": "instructor-generation", "role": "instructor", "version": 2, "title": "Generate draft questions", "description": "Choose objectives, ready sources and generation controls, then follow the run into Review Queue.", "estimatedSeconds": 20},
{"id": "instructor-review", "role": "instructor", "version": 2, "title": "Review and approval", "description": "Review a complete question, edit when needed, then approve or reject it from a stable action bar.", "estimatedSeconds": 20},
{"id": "instructor-question-editor", "role": "instructor", "version": 2, "title": "Question editing", "description": "Review the saved version, parameters and evidence before creating another version for approval.", "estimatedSeconds": 20},
{"id": "instructor-analytics", "role": "instructor", "version": 1, "title": "Student Analytics", "description": "Read the course scope, filters and attempt counts before interpreting trends. Analytics describes recorded activity, not a diagnosis.", "estimatedSeconds": 20},
{"id": "instructor-course-settings", "role": "instructor", "version": 1, "title": "Course access and settings", "description": "Course dates and publication affect student access. Save changes explicitly; archived courses remain available for instructor review.", "estimatedSeconds": 20},
{"id": "instructor-exams", "role": "instructor", "version": 1, "title": "Exam Prep templates", "description": "Choose Topics, question counts and timing for each template. Supply warnings help you check Approved-question coverage.", "estimatedSeconds": 20},
{"id": "instructor-structure", "role": "instructor", "version": 1, "title": "Course Structure", "description": "Draft Topics and Learning Objectives from evidence, then review and save a teachable course outline.", "estimatedSeconds": 20},
{"id": "instructor-bank", "role": "instructor", "version": 1, "title": "Question Bank and releases", "description": "Inspect approved questions, understand availability, and release content by Topic.", "estimatedSeconds": 20},
{"id": "instructor-coverage", "role": "instructor", "version": 1, "title": "Coverage Map", "description": "Find objectives that need a ready source, more approved questions, or review work.", "estimatedSeconds": 20},
{"id": "instructor-sharing", "role": "instructor", "version": 1, "title": "Share with co-instructors", "description": "Invite trusted course authors and copy a restricted link without changing access rules.", "estimatedSeconds": 20},
{"id": "instructor-collaboration", "role": "instructor", "version": 1, "title": "Edit a question together", "description": "Work in one shared draft, see collaborator presence, and save a reviewed version to the queue.", "estimatedSeconds": 20},
{"id": "instructor-parameters", "role": "instructor", "version": 1, "title": "Parameterized questions", "description": "Define variable ranges and formulas, re-roll samples, and verify numerical variants before saving.", "estimatedSeconds": 20},
{"id": "instructor-import", "role": "instructor", "version": 1, "title": "Import questions", "description": "Choose a supported file or script path, preview validation, and import selected questions as Drafts.", "estimatedSeconds": 20},
{"id": "instructor-tas", "role": "instructor", "version": 1, "title": "Teaching Assistants", "description": "Invite the course team and assign review, analytics and flag-triage capabilities.", "estimatedSeconds": 20},
{"id": "instructor-flags", "role": "instructor", "version": 1, "title": "Student flags", "description": "Review reported question versions, TA escalations and resolution history with the right evidence.", "estimatedSeconds": 20},
{"id": "ta-courses", "role": "ta", "version": 1, "title": "Choose a TA workspace", "description": "Select an assigned course and confirm its identity before starting course-scoped work.", "estimatedSeconds": 20},
{"id": "ta-review", "role": "ta", "version": 1, "title": "Your review queue", "description": "Check the course name and switch courses in navigation when needed. Your capabilities determine which controls are available.", "estimatedSeconds": 20},
{"id": "ta-question-review", "role": "ta", "version": 1, "title": "Question review", "description": "Check the stem, options and explanations. Suggest changes and mark reviewed only where your course capabilities allow.", "estimatedSeconds": 20},
{"id": "ta-flags", "role": "ta", "version": 1, "title": "Flag triage", "description": "Review student flags in the selected course. Available triage actions depend on your course capabilities.", "estimatedSeconds": 20},
{"id": "admin-accounts", "role": "admin", "version": 2, "title": "Manage user access", "description": "Use the unified directory to grant Instructor, TA or Student access while keeping Ban user separate.", "estimatedSeconds": 20},
{"id": "admin-users", "role": "admin", "version": 2, "title": "User directory", "description": "Find the correct account, review retained roles, and manage course-scoped access without orphaning a course.", "estimatedSeconds": 20},
{"id": "admin-capabilities", "role": "admin", "version": 1, "title": "Capability settings", "description": "Platform defaults, course-role settings and per-user overrides resolve in layers. Check which scope you are editing.", "estimatedSeconds": 20},
{"id": "admin-platform-settings", "role": "admin", "version": 1, "title": "Platform settings", "description": "Review model selections and supported options for the generation pipeline. Changing these controls does not run generation.", "estimatedSeconds": 20},
{"id": "admin-operations", "role": "admin", "version": 1, "title": "Operations and issues", "description": "Trace requests, background work and change history while preserving the link between cause and outcome.", "estimatedSeconds": 20},
{"id": "admin-questions", "role": "admin", "version": 1, "title": "All Questions diagnostics", "description": "Inspect retained versions and attempts, then reproduce a seeded or recorded variant without changing live data.", "estimatedSeconds": 20},
] as const;

export interface TutorialState extends TutorialDefinition {
  status: TutorialProgressStatus | 'not-viewed';
  updatedAt?: Date;
}

function definitionsForRole(role: TutorialRole): TutorialDefinition[] {
  return TUTORIAL_CATALOG.filter((definition) => definition.role === role);
}

function definitionFor(role: TutorialRole, tutorialId: string): TutorialDefinition {
  const definition = TUTORIAL_CATALOG.find(
    (candidate) => candidate.role === role && candidate.id === tutorialId,
  );
  if (!definition) throw new Error('tutorial-not-found');
  return definition;
}

export async function listTutorials(puid: string, role: TutorialRole): Promise<TutorialState[]> {
  const definitions = definitionsForRole(role);
  const progress = await tutorialProgressCol()
    .find({ puid, role, tutorialId: { $in: definitions.map((definition) => definition.id) } })
    .toArray();
  const progressById = new Map(progress.map((item) => [item.tutorialId, item]));

  return definitions.map((definition) => {
    const item = progressById.get(definition.id);
    if (!item || item.version < definition.version) {
      return { ...definition, status: 'not-viewed' };
    }
    return { ...definition, status: item.status, updatedAt: item.updatedAt };
  });
}

export async function saveTutorialProgress(
  puid: string,
  role: TutorialRole,
  tutorialId: string,
  status: TutorialProgressStatus,
): Promise<TutorialProgress> {
  const definition = definitionFor(role, tutorialId);
  const updatedAt = new Date();
  const progress: TutorialProgress = {
    puid,
    role,
    tutorialId,
    version: definition.version,
    status,
    updatedAt,
  };
  await tutorialProgressCol().updateOne(
    { puid, role, tutorialId },
    { $set: progress },
    { upsert: true },
  );
  return progress;
}

export async function resetTutorialProgress(puid: string, role: TutorialRole): Promise<number> {
  const result = await tutorialProgressCol().deleteMany({ puid, role });
  return result.deletedCount;
}
