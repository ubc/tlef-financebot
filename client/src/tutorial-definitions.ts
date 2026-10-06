import type { TutorialRole } from './api.js';

export interface TutorialStep { selector: string; title: string; body: string }
export interface TutorialDefinition { id: string; role: TutorialRole; label: string; path: string; steps: TutorialStep[] }

const studentDefinitions = {
  'student-welcome': {
    id: 'student-welcome',
    label: 'Getting started',
    steps: [
      {
        selector: '[data-tutorial="student-dashboard-intro"]',
        title: 'Your learning dashboard',
        body: 'Each course is a learning project. Open one to continue from your current progress.',
      },
      {
        selector: '[data-tutorial="registration-code"]',
        title: 'Join with a registration code',
        body: 'Gradebook imports add most students automatically. If your course is missing, ask your instructor for an unused one-time code and enter it after signing in with CWL.',
      },
    ],
  },
  'student-course-home': {
    id: 'student-course-home',
    label: 'Course Home',
    steps: [
      {
        selector: '[data-tutorial="course-progress"]',
        title: 'See where you are',
        body: 'Coverage counts Learning Objectives marked covered. Mastery comes from your practice evidence; simply viewing a question does not demonstrate mastery.',
      },
      {
        selector: '[data-tutorial="learning-flow"]',
        title: 'Follow the learning loop',
        body: 'Choose a Topic, practice with feedback, then revisit weak areas in your Review Book.',
      },
      {
        selector: '[data-tutorial="topic-list"]',
        title: 'Start with a Topic',
        body: 'Pick any available Topic. Your progress is saved, so you can return later.',
      },
    ],
  },
  'student-practice': {
    id: 'student-practice',
    label: 'Practice',
    steps: [
      {
        selector: '[data-tutorial="practice-question"]',
        title: 'Practice one question at a time',
        body: 'Choose the answer you think is best. Practice is low-stakes and resumable.',
      },
      {
        selector: '[data-tutorial="practice-actions"]',
        title: 'Submit, then learn from feedback',
        body: 'After submitting, review the explanation and bookmark anything you want to revisit.',
      },
    ],
  },
  'student-review-book': {
    id: 'student-review-book',
    label: 'Review Book',
    steps: [
      {
        selector: '[data-tutorial="review-book-intro"]',
        title: 'Your personal review queue',
        body: 'Missed questions collect here automatically; you can also bookmark a question after answering.',
      },
      {
        selector: '[data-tutorial="review-book-groups"]',
        title: 'Practice weak areas again',
        body: 'Expand a Learning Objective, review saved questions, or start another practice round.',
      },
    ],
  },
  'student-exam-prep': {
    id: 'student-exam-prep',
    label: 'Exam Prep',
    steps: [
      {
        selector: '[data-tutorial="exam-prep-intro"]',
        title: 'Choose a practice sitting',
        body: 'Available midterm and final templates appear here with their time and question limits.',
      },
      {
        selector: '[data-tutorial="exam-prep-options"]',
        title: 'Start when you are ready',
        body: 'A sitting is resumable. Feedback is shown after you submit, and history remains available here.',
      },
    ],
  },
};


export const TUTORIAL_DEFINITIONS: readonly TutorialDefinition[] = [
  ...Object.values(studentDefinitions).map((definition) => ({ ...definition, role: 'student' as const, path: {"student-welcome": "", "student-course-home": "", "student-practice": "practice/:loId", "student-review-book": "review-book", "student-exam-prep": "exams"}[definition.id] ?? '' })),
  ...[
  {
    "id": "student-topics",
    "role": "student",
    "label": "Topics and Learning Objectives",
    "path": "theme/:themeId",
    "steps": [
      {
        "selector": "[data-tutorial=\"topic-selection\"]",
        "title": "Choose your next objective",
        "body": "Each Learning Objective links to practice. Available question counts help you choose where to begin."
      },
      {
        "selector": "[data-tutorial=\"topic-progress\"]",
        "title": "Understand your progress",
        "body": "Covered objectives and practice evidence help you plan review. Coverage is not a score for the whole course."
      }
    ]
  },
  {
    "id": "student-feedback",
    "role": "student",
    "label": "Learning from feedback",
    "path": "practice/:loId",
    "steps": [
      {
        "selector": "[data-tutorial=\"practice-feedback\"]",
        "title": "Read the feedback",
        "body": "Review the explanation shown for your answer. Your course strategy determines which answers are revealed and whether a similar retry appears."
      },
      {
        "selector": "[data-tutorial=\"practice-actions\"]",
        "title": "Choose your next step",
        "body": "Use the available bookmark, flag, retry or continue controls. Bookmark saves a question for review; flag asks the teaching team to check a problem."
      }
    ]
  },
  {
    "id": "student-session-summary",
    "role": "student",
    "label": "Session Summary",
    "path": "summary",
    "steps": [
      {
        "selector": "[data-tutorial=\"summary-outcomes\"]",
        "title": "Reflect on this session",
        "body": "Review questions answered, correct answers and objectives covered. These describe this session, not an exam grade."
      },
      {
        "selector": "[data-tutorial=\"summary-actions\"]",
        "title": "Keep the learning loop going",
        "body": "Continue practice, revisit missed questions in Review Book, or return to Course Home. Your next steps use your recorded progress."
      }
    ]
  },
  {
    "id": "student-exam-results",
    "role": "student",
    "label": "Exam results and history",
    "path": "exam-history",
    "steps": [
      {
        "selector": "[data-tutorial=\"exam-results-score\"]",
        "title": "Review your submitted sitting",
        "body": "Results appear only after submission. Topic and objective breakdowns help you locate weak areas."
      },
      {
        "selector": "[data-tutorial=\"exam-results-review\"]",
        "title": "Learn from each answer",
        "body": "Read the recorded questions and explanations. Misses go to Review Book; use Exam history to revisit submitted sittings."
      }
    ]
  },
  {
    "id": "instructor-welcome",
    "role": "instructor",
    "label": "Your course projects",
    "path": "courses",
    "steps": [
      {
        "selector": "[data-tutorial=\"instructor-projects\"]",
        "title": "Open a course project",
        "body": "Find your courses here. Each project has its own sources, learning objectives, question review and student activity."
      },
      {
        "selector": "[data-tutorial=\"instructor-project-actions\"]",
        "title": "Create or continue",
        "body": "Create a course when you are ready, or open an existing project to continue preparation."
      }
    ]
  },
  {
    "id": "instructor-course-setup",
    "role": "instructor",
    "label": "Prepare a course",
    "path": "",
    "steps": [
      {
        "selector": "[data-tutorial=\"course-setup-path\"]",
        "title": "Follow course preparation",
        "body": "Use Sources, Learning Objectives, Questions, Review and Student Preview to prepare your course. The guide resumes from the actual course state."
      },
      {
        "selector": "[data-tutorial=\"course-setup-checklist\"]",
        "title": "Check before publication",
        "body": "Review the publish checklist and try Student Preview. Preview is isolated from live student records; approval and publication are explicit actions."
      }
    ]
  },
  {
    "id": "instructor-materials",
    "role": "instructor",
    "label": "Sources and knowledge",
    "path": "materials",
    "steps": [
      {
        "selector": "[data-tutorial=\"materials-files\"]",
        "title": "Check source readiness",
        "body": "Upload course sources and follow processing status. Only ready, available sources can ground new generation; Trash is reversible."
      },
      {
        "selector": "[data-tutorial=\"materials-inspector\"]",
        "title": "Map evidence to learning objectives",
        "body": "Inspect source content and correct Topic/LO assignments. Review suggested mappings before using them for questions."
      }
    ]
  },
  {
    "id": "instructor-generation",
    "role": "instructor",
    "label": "Generate draft questions",
    "path": "preseeding",
    "steps": [
      {
        "selector": "[data-tutorial=\"generation-scope\"]",
        "title": "Choose the learning objective",
        "body": "Select the objective and ready source material. Check the scope and question settings before requesting generation."
      },
      {
        "selector": "[data-tutorial=\"generation-actions\"]",
        "title": "Generate deliberately",
        "body": "Generation starts only when you explicitly request it. Track the run, then review the resulting Draft questions before approval."
      }
    ]
  },
  {
    "id": "instructor-review",
    "role": "instructor",
    "label": "Review and approval",
    "path": "queue",
    "steps": [
      {
        "selector": "[data-tutorial=\"review-filters\"]",
        "title": "Focus your review queue",
        "body": "Filter the queue to work through Draft questions. Check wording, answer correctness and learning-objective alignment."
      },
      {
        "selector": "[data-tutorial=\"review-actions\"]",
        "title": "Approval controls student access",
        "body": "Instructors approve questions deliberately. Student Preview and released practice use Approved questions; TA review does not approve them."
      }
    ]
  },
  {
    "id": "instructor-question-editor",
    "role": "instructor",
    "label": "Question editing",
    "path": "bank",
    "steps": [
      {
        "selector": "[data-tutorial=\"question-editor-content\"]",
        "title": "Review the question version",
        "body": "Read the stem, options and explanations together. Check formulas and parameterized values where present."
      },
      {
        "selector": "[data-tutorial=\"question-editor-actions\"]",
        "title": "Save and review changes",
        "body": "Edits and approval are explicit actions. Check the resulting version and publication state before students practice it."
      }
    ]
  },
  {
    "id": "instructor-analytics",
    "role": "instructor",
    "label": "Student Analytics",
    "path": "analytics",
    "steps": [
      {
        "selector": "[data-tutorial=\"analytics-overview\"]",
        "title": "Choose the evidence",
        "body": "Read the course scope, filters and attempt counts before interpreting trends. Analytics describes recorded activity, not a diagnosis."
      },
      {
        "selector": "[data-tutorial=\"analytics-outcomes\"]",
        "title": "Keep practice and exams separate",
        "body": "Topic Practice and Exam Prep have different conditions. Fewer than five attempts means insufficient data, not zero failures."
      },
      {
        "selector": "[data-tutorial=\"analytics-question-patterns\"]",
        "title": "Inspect recorded question versions",
        "body": "Open a question pattern to review that version and its answer distribution. Do not combine option letters from different versions."
      },
      {
        "selector": "[data-tutorial=\"analytics-follow-up\"]",
        "title": "Choose a concrete follow-up",
        "body": "Review content, plan instruction or open an individual profile."
      }
    ]
  },
  {
    "id": "instructor-course-settings",
    "role": "instructor",
    "label": "Course access and settings",
    "path": "settings",
    "steps": [
      {
        "selector": "[data-tutorial=\"course-settings-dates\"]",
        "title": "Set term access deliberately",
        "body": "Course dates and publication affect student access. Save changes explicitly; archived courses remain available for instructor review."
      },
      {
        "selector": "[data-tutorial=\"course-settings-roster\"]",
        "title": "Import your class, then add missing students",
        "body": "Open People to upload the Canvas Gradebook, invite individual people, or generate one-time codes and check who used them. Students need a published course within its term dates."
      }
    ]
  },
  {
    "id": "instructor-exams",
    "role": "instructor",
    "label": "Exam Prep templates",
    "path": "exam-templates",
    "steps": [
      {
        "selector": "[data-tutorial=\"exam-templates\"]",
        "title": "Configure a practice sitting",
        "body": "Choose Topics, question counts and timing for each template. Supply warnings help you check Approved-question coverage."
      },
      {
        "selector": "[data-tutorial=\"exam-template-save\"]",
        "title": "Save and activate explicitly",
        "body": "Check the template before saving and activating. Students get a server-timed sitting; results and explanations appear only after submission."
      }
    ]
  },
  {
    "id": "instructor-structure",
    "role": "instructor",
    "label": "Course Structure",
    "path": "structure",
    "steps": [
      {
        "selector": "[data-tutorial=\"structure-views\"]",
        "title": "Build from evidence or edit manually",
        "body": "Use AI draft to generate a reviewable Topic and Learning Objective outline from ready sources. Nothing enters the course until you select and add it."
      },
      {
        "selector": "[data-tutorial=\"structure-outline\"]",
        "title": "Keep the saved outline teachable",
        "body": "Review objective wording, assigned materials and question kind. Topic release controls when its approved questions can reach students."
      }
    ]
  },
  {
    "id": "instructor-bank",
    "role": "instructor",
    "label": "Question Bank and releases",
    "path": "bank",
    "steps": [
      {
        "selector": "[data-tutorial=\"bank-status\"]",
        "title": "Separate approval from availability",
        "body": "Approved questions can still be held by course publication, topic release or content checks. Use these views to see the exact state."
      },
      {
        "selector": "[data-tutorial=\"bank-releases\"]",
        "title": "Release by Topic",
        "body": "Manage each Topic’s release explicitly. Releasing a Topic does not publish a draft course, and archiving preserves question history."
      }
    ]
  },
  {
    "id": "instructor-coverage",
    "role": "instructor",
    "label": "Coverage Map",
    "path": "content-map",
    "steps": [
      {
        "selector": "[data-tutorial=\"coverage-summary\"]",
        "title": "Read the coverage target",
        "body": "Coverage combines a ready supporting source with approved-question supply. It helps prioritize authoring but does not itself grant student access."
      },
      {
        "selector": "[data-tutorial=\"coverage-controls\"]",
        "title": "Find the next gap",
        "body": "Filter gaps or review backlog, search objectives, and switch to the evidence graph when you need to inspect relationships."
      }
    ]
  },
  {
    "id": "instructor-sharing",
    "role": "instructor",
    "label": "Invite students and the teaching team",
    "path": "people",
    "steps": [
      {
        "selector": "[data-tutorial=\"people-list\"]",
        "title": "Share authoring access",
        "body": "Owners and Admins can add a CWL login name or UBC email. CWL must match an existing account; email can remain pending until the matching first sign-in."
      },
      {
        "selector": "[data-tutorial=\"people-invite\"]",
        "title": "Choose a role before inviting",
        "body": "Invite one Student, TA or Instructor using UBC email or an existing CWL. Share provides the same form and a restricted course link. No email is sent."
      }
    ]
  },
  {
    "id": "instructor-collaboration",
    "role": "instructor",
    "label": "Edit a question together",
    "path": "bank",
    "steps": [
      {
        "selector": "[data-tutorial=\"collaboration-presence\"]",
        "title": "See who is editing",
        "body": "Presence and connection status show the active shared draft. Concurrent field edits merge into this draft without changing the saved question."
      },
      {
        "selector": "[data-tutorial=\"collaboration-editor\"]",
        "title": "Work in the shared draft",
        "body": "Edit the stem, answers and explanations together. If the saved question changes elsewhere, compare versions before continuing."
      },
      {
        "selector": "[data-tutorial=\"collaboration-save\"]",
        "title": "Save one reviewed version",
        "body": "Saving validates the shared draft and creates a new question version in Review Queue. Download a copy before leaving if updates cannot be confirmed."
      }
    ]
  },
  {
    "id": "instructor-parameters",
    "role": "instructor",
    "label": "Parameterized questions",
    "path": "bank",
    "steps": [
      {
        "selector": "[data-tutorial=\"parameter-definitions\"]",
        "title": "Define every student-facing value",
        "body": "Drawn variables set allowed inputs. Computed values derive the correct answer and distractors; formulas should preserve units and the intended misconception."
      },
      {
        "selector": "[data-tutorial=\"parameter-verification\"]",
        "title": "Verify before saving",
        "body": "Re-roll examples and read verification results. Saving parameterization does not approve the question, and numerical uniqueness does not replace instructor review."
      }
    ]
  },
  {
    "id": "instructor-import",
    "role": "instructor",
    "label": "Import questions",
    "path": "import",
    "steps": [
      {
        "selector": "[data-tutorial=\"import-method\"]",
        "title": "Choose a supported import path",
        "body": "Use Question file for CSV, JSON or QTI. Script migration is an advanced sandbox for reviewing a parameterized generator before conversion."
      },
      {
        "selector": "[data-tutorial=\"import-preview\"]",
        "title": "Preview before writing",
        "body": "Inspect detected questions, assignments and rejected rows. Imported items enter Review Queue as Drafts and remain hidden from students."
      }
    ]
  },
  {
    "id": "instructor-tas",
    "role": "instructor",
    "label": "People and TA permissions",
    "path": "people",
    "steps": [
      {
        "selector": "[data-tutorial=\"people-list\"]",
        "title": "Invite the course team",
        "body": "Invite a UBC email or existing CWL and choose the course role. Pending email access activates on the matching sign-in. Only the Owner/Admin can manage people."
      },
      {
        "selector": "[data-tutorial=\"people-invite\"]",
        "title": "Delegate with clear boundaries",
        "body": "Choose review, suggested-edit, analytics and flag-triage capabilities. Final question approval and flag resolution remain Instructor-only."
      }
    ]
  },
  {
    "id": "instructor-flags",
    "role": "instructor",
    "label": "Student flags",
    "path": "flags",
    "steps": [
      {
        "selector": "[data-tutorial=\"flags-views\"]",
        "title": "Separate active work from history",
        "body": "Use status views and search to find reported questions. Preview TEST flags stay labelled and do not represent live student activity."
      },
      {
        "selector": "[data-tutorial=\"flags-guidance\"]",
        "title": "Resolve with evidence",
        "body": "Inspect the recorded question version, student reason and TA escalation. Correctness-changing edits keep the remediation workflow explicit."
      }
    ]
  },
  {
    "id": "ta-courses",
    "role": "ta",
    "label": "Choose a TA workspace",
    "path": "courses",
    "steps": [
      {
        "selector": "[data-tutorial=\"ta-course-heading\"]",
        "title": "Choose the course you are helping",
        "body": "Your TA workspace is course-scoped. Check the course identity before reviewing questions or student feedback."
      },
      {
        "selector": "[data-tutorial=\"ta-course-list\"]",
        "title": "Open the assigned workspace",
        "body": "Each card opens that course’s Review Queue. Available actions still follow the permissions set by its Instructor."
      }
    ]
  },
  {
    "id": "ta-review",
    "role": "ta",
    "label": "Your review queue",
    "path": "review",
    "steps": [
      {
        "selector": "[data-tutorial=\"ta-review-context\"]",
        "title": "Work in the selected course",
        "body": "Check the course name and switch courses in navigation when needed. Your capabilities determine which controls are available."
      },
      {
        "selector": "[data-tutorial=\"ta-review-items\"]",
        "title": "Review for your instructor",
        "body": "Open a question to inspect it, suggest edits or mark it reviewed where permitted. Final approval stays with the Instructor."
      }
    ]
  },
  {
    "id": "ta-question-review",
    "role": "ta",
    "label": "Question review",
    "path": "review",
    "steps": [
      {
        "selector": "[data-tutorial=\"ta-question-content\"]",
        "title": "Inspect the question",
        "body": "Check the stem, options and explanations. Suggest changes and mark reviewed only where your course capabilities allow."
      },
      {
        "selector": "[data-tutorial=\"ta-question-actions\"]",
        "title": "Record your review",
        "body": "Use available internal notes or suggested edits to explain your reasoning. Instructor approval is separate from TA review."
      }
    ]
  },
  {
    "id": "ta-flags",
    "role": "ta",
    "label": "Flag triage",
    "path": "flags",
    "steps": [
      {
        "selector": "[data-tutorial=\"ta-flags-context\"]",
        "title": "Understand the report",
        "body": "Review student flags in the selected course. Available triage actions depend on your course capabilities."
      },
      {
        "selector": "[data-tutorial=\"ta-flags-items\"]",
        "title": "Escalate for final action",
        "body": "Add internal notes or escalate a flag when those controls are available. Only an Instructor can resolve a flag."
      }
    ]
  },
  {
    "id": "admin-accounts",
    "role": "admin",
    "label": "Manage user access",
    "path": "accounts",
    "steps": [
      {
        "selector": "[data-tutorial=\"admin-users-search\"]",
        "title": "Grant platform Instructor access",
        "body": "Find the user, open Grant in their row, then choose Instructor to allow course creation. TA and Student ask you to choose a course. Ban user remains a separate action."
      },
      {
        "selector": "[data-tutorial=\"admin-users-list\"]",
        "title": "Check current and pending grants",
        "body": "Current and pending grants appear in this directory. Ban user blocks all platform access while retaining roles and records; Unban user restores access."
      }
    ]
  },
  {
    "id": "admin-users",
    "role": "admin",
    "label": "User directory",
    "path": "users",
    "steps": [
      {
        "selector": "[data-tutorial=\"admin-users-search\"]",
        "title": "Find the correct account",
        "body": "Search the directory and verify the identity before changing course roles. Course roles apply to a specific course."
      },
      {
        "selector": "[data-tutorial=\"admin-users-list\"]",
        "title": "Manage access with retained records",
        "body": "Banning retains records. Review course ownership before removing course roles; the system protects against orphaning courses."
      }
    ]
  },
  {
    "id": "admin-capabilities",
    "role": "admin",
    "label": "Capability settings",
    "path": "capabilities",
    "steps": [
      {
        "selector": "[data-tutorial=\"admin-capabilities-scope\"]",
        "title": "Choose the settings scope",
        "body": "Platform defaults, course-role settings and per-user overrides resolve in layers. Check which scope you are editing."
      },
      {
        "selector": "[data-tutorial=\"admin-capabilities-matrix\"]",
        "title": "Save explicit permission changes",
        "body": "Review and save changes deliberately. TA question approval and flag resolution remain denied regardless of configured values."
      }
    ]
  },
  {
    "id": "admin-platform-settings",
    "role": "admin",
    "label": "Platform settings",
    "path": "platform-settings",
    "steps": [
      {
        "selector": "[data-tutorial=\"admin-platform-models\"]",
        "title": "Choose models for each step",
        "body": "Review model selections and supported options for the generation pipeline. Changing these controls does not run generation."
      },
      {
        "selector": "[data-tutorial=\"admin-platform-quality\"]",
        "title": "Review limits and quality",
        "body": "Set daily generation limits and quality checks deliberately. Disabling review affects quality reporting; changes require an explicit save."
      }
    ]
  },
  {
    "id": "admin-operations",
    "role": "admin",
    "label": "Operations and issues",
    "path": "operations",
    "steps": [
      {
        "selector": "[data-tutorial=\"admin-operations-filters\"]",
        "title": "Trace the right activity",
        "body": "Switch between user operations, background tasks and change history. Filter by user, course, outcome or time before drawing a conclusion."
      },
      {
        "selector": "[data-tutorial=\"admin-operations-results\"]",
        "title": "Inspect retained evidence",
        "body": "Open a row to review request context and linked background work. An accepted request is not proof that its task later completed."
      }
    ]
  },
  {
    "id": "admin-questions",
    "role": "admin",
    "label": "All Questions diagnostics",
    "path": "questions",
    "steps": [
      {
        "selector": "[data-tutorial=\"admin-question-filters\"]",
        "title": "Find a retained question",
        "body": "Search across courses and publication states. Filters affect diagnosis only and never change the question served to students."
      },
      {
        "selector": "[data-tutorial=\"admin-question-results\"]",
        "title": "Reproduce with recorded evidence",
        "body": "Inspect versions, flags and saved attempts, then reproduce a seeded or recorded variant. Reproduction is read-only and preserves the original evidence."
      }
    ]
  }
] as TutorialDefinition[],
];

export type StudentTutorialId = 'student-welcome' | 'student-course-home' | 'student-practice' | 'student-review-book' | 'student-exam-prep' | 'student-topics' | 'student-feedback' | 'student-session-summary' | 'student-exam-results';
