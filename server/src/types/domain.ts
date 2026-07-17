import type { ObjectId } from 'mongodb';

// -----------------------------------------------------------------------------
// Shared domain types (PRD §2 Data Model). Server-side single source of truth;
// client views consume the JSON shapes these produce over /api.
// -----------------------------------------------------------------------------

/** The four option roles (PRD §9.1). Only two carry behaviour anywhere:
 * common-misconception (Strategy A retry gate) and clearly-wrong (struggle
 * signal). A True/False incorrect option is always common-misconception. */
export type OptionRole = 'correct' | 'common-misconception' | 'partially-correct' | 'clearly-wrong';

export type QuestionType = 'mcq' | 'true-false';

/** Per-LO mastery label shown to students (PRD §9.2). Never a numeric score. */
export type MasteryStatus = 'not-attempted' | 'in-progress' | 'covered' | 'struggling';

/** Publication states (PRD §6.2). Only 'approved' is ever served to students. */
export type PublicationState = 'draft' | 'pending-review' | 'reviewed' | 'approved' | 'paused' | 'archived';

/** Review decisions — the events that move a question between states. */
export type ReviewDecision =
  | 'agent-pass'
  | 'agent-flag'
  | 'agent-reject'
  | 'marked-reviewed'
  | 'instructor-approved'
  | 'instructor-rejected';

/** Overlay labels — metadata; never gate serving on their own (PRD §6.2). */
export type QuestionLabel =
  | 'source-changed'
  | 'student-flagged'
  | 'convertible-to-parameterized'
  | 'auto-converted'
  | 'manually-edited';

/** Flag case states — decoupled from the question's publication state. */
export type FlagState = 'open' | 'escalated' | 'resolved-corrected' | 'resolved-archived' | 'resolved-cleared';

export type PracticeMode = 'topic-practice' | 'review-book' | 'exam-prep';

/** Course-level feedback configuration (IN-S10). */
export type FeedbackStrategy = 'adaptive' | 'strategy-a' | 'strategy-b';

/** The strategy actually applied on a single attempt (pinned on AttemptRecord). */
export type AppliedStrategy = 'a' | 'b';

export type Difficulty = 'easy' | 'medium' | 'hard';

export type CourseRole = 'student' | 'instructor' | 'ta';

// --- Documents ---------------------------------------------------------------

/** Keyed by CWL PUID (unique index). No PII beyond CWL login attributes. */
export interface User {
  puid: string;
  uid: string; // CWL username, used as the watermark (PRD §4.1)
  displayName: string;
  email: string;
  affiliations: string[]; // raw eduPersonAffiliation values, lower-cased
  isAdmin: boolean; // from ADMIN_CWL_ALLOWLIST at login time
  courseRoles: Array<{ courseId: ObjectId; role: CourseRole }>;
  onboardingAcknowledgedAt?: Date; // mandatory service-use + copyright ack (§4.1)
  researchExportConsent?: boolean; // optional, declinable (§4.1)
  createdAt: Date;
  lastLoginAt: Date;
}

export interface Course {
  name: string;
  courseCode: string; // e.g. "COMM 298"
  term: string; // e.g. "2026W1"
  ownerPuid: string;
  registrationCode: string; // unique; regenerable (IN-S03)
  termStart?: Date;
  termEnd?: Date; // reaching it auto-revokes student access (IN-S02)
  published: boolean; // sandbox until published (IN-L06)
  feedbackStrategy: FeedbackStrategy; // default 'adaptive' (IN-S10)
  autoPause: { minAttempts: number; flagPercent: number; flagCount: number }; // §4.3 defaults 5/30/15
  redirectFailureThreshold: number; // ST-P07, default 3
  createdAt: Date;
}

export interface Theme {
  courseId: ObjectId;
  name: string;
  order: number;
  availableFrom?: Date; // progressive release (ST-P01)
  archivedAt?: Date;
}

export interface LearningObjective {
  courseId: ObjectId;
  themeId: ObjectId;
  name: string;
  order: number;
  archivedAt?: Date;
}

export interface QuestionOption {
  key: string; // 'A'..'D' for MCQ; 'T'/'F' for true-false
  text: string;
  role: OptionRole;
  explanation: string; // per-option explanation (PRD §10)
}

/** One variable slot in a parameterized question (IN-Q09). */
export interface ParamSlot {
  name: string; // matches {{name}} placeholders in the stem
  min?: number;
  max?: number;
  step?: number;
  values?: number[]; // allowed value set alternative to min/max/step
}

/** Immutable snapshot: every edit creates a new version (PRD §2). */
export interface QuestionVersion {
  questionId: ObjectId;
  version: number; // 1-based, unique per question
  type: QuestionType;
  stem: string; // markdown + KaTeX; {{slot}} placeholders when parameterized
  options: QuestionOption[];
  difficulty: Difficulty; // pinned at version level so recalibration never rewrites history (§9.2)
  paramSlots?: ParamSlot[];
  generateScript?: string; // instructor-authored generate() source (PrairieLearn convention)
  sourceRefs: Array<{ materialId: ObjectId; chunk?: string }>; // question reference view (§10)
  // Content keys patched in THIS edit only (per-edit, not cumulative) —
  // IN-Q03. The set of fields that diverge from the generated original across
  // the whole version chain is the union of editedFields over every version
  // from v2 up to this one.
  editedFields?: string[];
  createdBy: string; // puid or 'pipeline'
  createdAt: Date;
}

/** Mutable head record; content lives in QuestionVersions. */
export interface Question {
  courseId: ObjectId;
  currentVersionId: ObjectId;
  currentVersion: number;
  state: PublicationState;
  loIds: ObjectId[]; // many-to-many (IN-Q13)
  themeIds: ObjectId[];
  labels: QuestionLabel[];
  agentDecision?: { decision: 'pass' | 'flag' | 'reject'; reasoning: string; roleAssessment: string };
  generationPrompt?: string; // recorded custom prompt (IN-Q11)
  internalNotes: Array<{ puid: string; text: string; at: Date }>; // teaching-team-only (§6.2)
  createdAt: Date;
  updatedAt: Date;
}

/** The hub of the data model (PRD §2): one per submitted answer. */
export interface AttemptRecord {
  puid: string;
  courseId: ObjectId;
  questionId: ObjectId;
  questionVersionId: ObjectId; // pinned exact version served
  loId: ObjectId; // the LO context actually served under (§5.1 multi-LO rule)
  themeId: ObjectId;
  mode: PracticeMode;
  strategy: AppliedStrategy; // feedback strategy active at that moment
  selectedKey: string;
  correct: boolean;
  selectedRole: OptionRole;
  difficulty: Difficulty; // tier at serve time
  paramValues?: Record<string, number>; // randomized values shown (if parameterized)
  isRetry: boolean; // Strategy A retry attempts are independent, full-weight attempts
  examAttemptId?: ObjectId; // set when mode === 'exam-prep'
  createdAt: Date;
}

export interface Material {
  courseId: ObjectId;
  name: string;
  format: 'pdf' | 'docx' | 'pptx' | 'txt' | 'md' | 'url';
  status: 'processing' | 'ready' | 'failed';
  error?: string;
  sourceUrl?: string; // format === 'url'
  storagePath?: string; // uploaded file location on disk
  assignments: Array<{ themeId: ObjectId; loId?: ObjectId }>; // many-to-many (IN-S05)
  classificationSuggestion?: { themeId: ObjectId; loId?: ObjectId; confidence: number }; // IN-S06
  uploadedAt: Date;
}

/** (User, LO) rollup computed from AttemptRecords — never raw judgments. */
export interface MasteryProfile {
  puid: string;
  courseId: ObjectId;
  loId: ObjectId;
  status: MasteryStatus;
  attemptCount: number;
  windowAccuracy: number; // over the rolling 10-attempt window (§9.2 Layer 1)
  windowRoles: Partial<Record<OptionRole, number>>; // selected-role distribution in window
  currentTier: Difficulty; // progression tier for question selection
  skipped?: 'after-attempting' | 'without-attempting'; // ST-P06
  examVerified?: boolean; // exam-prep qualifier (§9.2)
  rationale?: string; // Layer-2 one-liner for the instructor dashboard
  attemptsSinceEvaluation: number; // Layer-2 cadence bookkeeping
  updatedAt: Date;
}

export interface ReviewBookEntry {
  puid: string;
  courseId: ObjectId;
  questionId: ObjectId;
  sources: Array<'auto' | 'bookmark'>; // both may apply; entry appears once (ST-R02)
  triggeringAttemptId: ObjectId; // latest miss context (ST-R01)
  loId: ObjectId;
  themeId: ObjectId;
  lastRepracticeCorrect?: boolean; // reflected, never silently deleted (ST-R01)
  addedAt: Date;
  updatedAt: Date;
}

export interface ExamTemplate {
  courseId: ObjectId;
  kind: 'midterm' | 'final';
  themes: Array<{ themeId: ObjectId; mcqCount: number; tfCount: number; pointsPerQuestion: number }>;
  timeLimitMinutes?: number;
  availabilityStart: Date;
  availabilityEnd: Date;
  loBreakdown: boolean; // show per-LO results (ST-X03)
  updatedAt: Date;
}

export interface ExamAttempt {
  puid: string;
  courseId: ObjectId;
  templateId: ObjectId;
  questions: Array<{
    questionId: ObjectId;
    questionVersionId: ObjectId;
    loId: ObjectId;
    themeId: ObjectId;
    points: number;
    paramValues?: Record<string, number>;
    selectedKey?: string; // answer-in-progress; changeable until submit (ST-X02)
  }>;
  shortfalls: Array<{ themeId: ObjectId; requested: number; assembled: number }>; // ST-X01
  startedAt: Date;
  submittedAt?: Date;
  score?: number;
  maxScore: number;
}

export interface Flag {
  courseId: ObjectId;
  questionId: ObjectId;
  questionVersionId: ObjectId; // flags attach to the specific version (§6.2)
  puid: string; // flagging student
  reason?: string;
  state: FlagState;
  taRecommendation?: { action: 'correct' | 'archive' | 'clear'; note?: string; puid: string; at: Date };
  resolution?: { action: 'correct' | 'archive' | 'clear'; puid: string; at: Date };
  createdAt: Date;
}

export interface Notification {
  recipientPuid: string;
  courseId?: ObjectId;
  kind: 'flag' | 'auto-pause' | 'daily-summary' | 'flag-resolved' | 'correction' | 'review-backlog' | 'redirect';
  priority: 'standard' | 'elevated'; // §4.3 tiering
  body: string;
  refType?: string;
  refId?: ObjectId;
  readAt?: Date;
  createdAt: Date;
}

export interface AuditLog {
  actorPuid: string;
  action: string; // e.g. 'question.approve', 'flag.resolve', 'role.assign'
  targetType: string;
  targetId: ObjectId;
  courseId?: ObjectId;
  detail?: Record<string, unknown>;
  createdAt: Date;
}

/** Instructor-maintained roster; code + roster match required to enroll (ST-E02). */
export interface RosterEntry {
  courseId: ObjectId;
  identifier: string; // CWL username or student email, lower-cased
  extendedUntil?: Date; // per-student access extension (IN-S02)
  addedAt: Date;
}

// --- Publication state machine -----------------------------------------------

/** Allowed transitions (PRD §6.2). 'archived' is reachable from every state;
 * restore from 'archived' returns to 'draft' (re-approval required, IN-Q07). */
export const PUBLICATION_TRANSITIONS: Record<PublicationState, PublicationState[]> = {
  draft: ['pending-review', 'archived'],
  'pending-review': ['reviewed', 'approved', 'draft', 'archived'],
  reviewed: ['approved', 'draft', 'archived'],
  approved: ['paused', 'archived'],
  paused: ['approved', 'archived'],
  archived: ['draft'],
};

export function canTransition(from: PublicationState, to: PublicationState): boolean {
  return PUBLICATION_TRANSITIONS[from]?.includes(to) ?? false;
}
