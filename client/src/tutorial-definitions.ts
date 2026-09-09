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
        body: 'Paste the code from your instructor here. Your CWL or email must match the course roster; ask your instructor if enrollment is refused.',
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
        "title": "Match enrollment to your roster",
        "body": "Students need a matching CWL or email and registration code. Preview CSV imports before replacing the roster; student numbers cannot match CWL login."
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
    "label": "Instructor grants",
    "path": "accounts",
    "steps": [
      {
        "selector": "[data-tutorial=\"admin-grants-form\"]",
        "title": "Grant platform Instructor access",
        "body": "Grant by PUID, including before first login. This permits course creation; it is separate from Admin status and course roles."
      },
      {
        "selector": "[data-tutorial=\"admin-grants-list\"]",
        "title": "Check current and pending grants",
        "body": "Review the account list before changing access. Revoking a platform grant does not remove existing course roles."
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
        "body": "Deactivation retains records. Review course ownership before removing access; the system protects against orphaning courses."
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
  }
] as TutorialDefinition[],
];

export type StudentTutorialId = 'student-welcome' | 'student-course-home' | 'student-practice' | 'student-review-book' | 'student-exam-prep' | 'student-topics' | 'student-feedback' | 'student-session-summary' | 'student-exam-results';
