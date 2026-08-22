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
export type CourseLifecycle = 'draft' | 'published' | 'archived';

/** The strategy actually applied on a single attempt (pinned on AttemptRecord). */
export type AppliedStrategy = 'a' | 'b';

export type Difficulty = 'easy' | 'medium' | 'hard';

export type CourseRole = 'student' | 'instructor' | 'ta';

export type Capability =
  | 'question.review'
  | 'question.suggest-edit'
  | 'question.mark-reviewed'
  | 'question.create-draft'
  | 'question.approve'
  | 'flag.triage'
  | 'flag.resolve'
  | 'analytics.view'
  | 'analytics.individual'
  | 'exam.configure'
  | 'course.manage-tas'
  | 'materials.upload'
  | 'hierarchy.edit';

export type CapabilityRole = CourseRole | 'admin';

export type ContentRunKind = 'material-ingest' | 'question-generation';
export type MaterialKind =
  | 'lecture'
  | 'reading'
  | 'assignment'
  | 'assessment'
  | 'solution'
  | 'reference'
  | 'other';
export type ContentRunStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed';
export type MaterialIngestStage = 'queued' | 'parsing' | 'chunking' | 'embedding' | 'indexing' | 'classifying';
export type QuestionGenerationStage =
  | 'queued'
  | 'retrieving'
  | 'generating'
  | 'validating'
  | 'reviewing'
  | 'persisting';

// --- Documents ---------------------------------------------------------------

/** Keyed by CWL PUID (unique index). No PII beyond CWL login attributes. */
export interface User {
  puid: string;
  uid: string; // CWL username, used as the watermark (PRD §4.1)
  displayName: string;
  email: string;
  affiliations: string[]; // raw eduPersonAffiliation values, lower-cased
  isAdmin: boolean; // from ADMIN_CWL_ALLOWLIST or the staging bootstrap PUID at login
  platformInstructor?: boolean; // explicit global grant; never derived from SAML affiliation
  courseRoles: Array<{ courseId: ObjectId; role: CourseRole }>;
  onboardingAcknowledgedAt?: Date; // mandatory service-use + copyright ack (§4.1)
  researchExportConsent?: boolean; // optional, declinable (§4.1)
  createdAt: Date;
  lastLoginAt: Date;
  deactivatedAt?: Date;
}

/** Admin-managed global Instructor grant keyed by the canonical SAML PUID. */
export interface PlatformInstructorGrant {
  puid: string;
  grantedByPuid: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CapabilitySettings {
  scope: 'platform' | 'course';
  courseId?: ObjectId;
  assignments: Partial<Record<Capability, Partial<Record<CapabilityRole, boolean>>>>;
  userOverrides?: Record<string, Partial<Record<Capability, boolean>>>;
  updatedBy: string;
  updatedAt: Date;
}

/**
 * The request SHAPE a model accepts. Declared here because an admin picks one
 * and it is persisted; the authoritative table of which model has which profile,
 * and what each profile means on the wire, is measured ground truth in
 * `components/genai/llm/model-capabilities` and stays there.
 */
export type CapabilityProfile = 'classic' | 'reasoning-tunable' | 'reasoning-fixed';

/** How hard a reasoning-capable model thinks before answering. */
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';

/** The pipeline steps an admin can point at a model independently (PRD §2 / AD-07). */
export const PIPELINE_STEPS = ['generator', 'validator', 'reviewer', 'masteryEvaluator', 'utility'] as const;
export type PipelineStep = (typeof PIPELINE_STEPS)[number];

/**
 * One step's model and the parameters that model accepts. Which parameters are
 * legal depends on the model — see `components/genai/llm/model-capabilities`.
 * Both are optional because most steps want the model's own defaults.
 */
export interface StepModelConfig {
  model: string;
  /** Only legal while the effective reasoning effort is `none`. */
  temperature?: number;
  /** Reasoning-capable models only. Omitted means "let the model decide". */
  reasoningEffort?: ReasoningEffort;
}

export interface PlatformSettings {
  _id: 'platform';
  /**
   * Persisted as `StepModelConfig`, but **a legacy document may hold a bare
   * `string` per step** — the shape shipped before per-step parameters existed.
   * `getPlatformSettings` normalizes on read rather than migrating, so an
   * un-upgraded database keeps working. Never read this field raw.
   */
  models: Record<PipelineStep, StepModelConfig>;
  /**
   * Models an admin added that are not in the shipped catalogue, each assigned
   * an existing capability profile. There is no way to declare a NEW profile:
   * a profile is behaviour, and behaviour is code.
   */
  customModels?: Array<{ id: string; profile: CapabilityProfile }>;
  costControls: { maxGenerationsPerDay: number };
  featureFlags: { reviewerAgent: boolean; layer2Evaluator: boolean; retryOnReject: boolean };
  updatedBy: string;
  updatedAt: Date;
}

export interface TaInvite {
  courseId: ObjectId;
  email: string;
  status: 'pending' | 'active' | 'expired';
  permissions?: Partial<Record<Capability, boolean>>;
  invitedAt: Date;
  updatedAt: Date;
  activatedPuid?: string;
}

export interface Course {
  name: string;
  courseCode: string; // e.g. "COMM 298"
  section?: string; // e.g. "101"; separate from the catalog course code
  term: string; // e.g. "2026W1"
  /** Internal normalized courseCode/section/term key; omitted from API responses. */
  identityKey?: string;
  ownerPuid: string;
  registrationCode: string; // unique; regenerable (IN-S03)
  termStart?: Date;
  termEnd?: Date; // reaching it auto-revokes student access (IN-S02)
  published: boolean; // sandbox until published (IN-L06)
  /** Explicit authoring lifecycle. Legacy rows normalize from published/archivedAt. */
  lifecycle?: CourseLifecycle;
  archivedAt?: Date;
  feedbackStrategy: FeedbackStrategy; // default 'adaptive' (IN-S10)
  autoPause: { minAttempts: number; flagPercent: number; flagCount: number }; // §4.3 defaults 5/30/15
  redirectFailureThreshold: number; // ST-P07, default 3
  reviewBacklogThreshold: number; // §9.1, default 10 -- pending-review count that triggers a 'review-backlog' notification
  lastBacklogNotifiedAt?: Date; // §9.1 -- written by notifications.service's checkReviewBacklog, at most once per 24h
  createdAt: Date;
  updatedAt?: Date;
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
  description?: string; // instructor-facing label, e.g. "Investment amount"
  min?: number;
  max?: number;
  step?: number;
  values?: number[]; // allowed value set alternative to min/max/step
}

/** A value COMPUTED from slots, not drawn. The correct answer and every
 *  distractor of a numerical question are derived values. */
export interface DerivedValue {
  name: string; // referenced as {{name}} in stem/option text/explanations
  formula: string; // e.g. "CF1/(1+RATE)^1 + CF2/(1+RATE)^2"
  errorModel?: string; // distractors only: the mistake this option represents
}

/** R4: a machine-checked proof that a numerical question's values are sound
 * across sampled draws. Absent means the question never serves. Cleared on
 * any edit to stem/options/paramSlots/derivedValues. */
export interface NumericVerification {
  evaluatorVersion: number;
  sampleSeeds: number[];
  verifiedAt: Date;
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
  numericKind?: 'numeric' | 'conceptual'; // declaration; conceptual does not bypass detection
  derivedValues?: DerivedValue[];
  verification?: NumericVerification; // absent => a numerical version never serves
  sourceRefs: Array<{ materialId: ObjectId; chunk?: string }>; // question reference view (§10)
  provenance?:
    | { kind: 'manual' }
    | { kind: 'generated'; runId: ObjectId; blueprintId?: ObjectId; item: number }
    | { kind: 'imported'; format: 'csv' | 'json' | 'qti'; sourceName?: string; item: number }
    | { kind: 'script-migration'; sourceName?: string }
    | { kind: 'edited'; parentVersionId: ObjectId };
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
  /** Additive lineage grouping; new standalone questions use their own id. */
  templateFamilyId?: ObjectId;
  labels: QuestionLabel[];
  agentDecision?: { decision: 'pass' | 'flag' | 'reject'; reasoning: string; roleAssessment: string };
  generationPrompt?: string; // recorded custom prompt (IN-Q11)
  regenerations?: Array<{ prompt: string; at: Date }>; // variant previews requested; content is not auto-saved (IN-Q12)
  internalNotes: Array<{ puid: string; text: string; at: Date }>; // teaching-team-only (§6.2)
  suggestions?: Array<{
    id: ObjectId;
    puid: string;
    patch: Record<string, unknown>;
    status: 'pending' | 'accepted' | 'discarded';
    at: Date;
    resolvedAt?: Date;
    resolvedBy?: string;
  }>;
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

/**
 * Instructor-only student-preview submission. Kept in its own collection so
 * no live-attempt consumer can accidentally count it as student activity.
 * `versionSnapshot` pins exactly what was graded even if a future migration
 * changes how immutable QuestionVersions are stored.
 */
export interface PreviewAttemptRecord {
  instructorPuid: string;
  previewSessionId: string;
  preview: true;
  courseId: ObjectId;
  questionId: ObjectId;
  questionVersionId: ObjectId;
  loId: ObjectId;
  themeId: ObjectId;
  mode: PracticeMode;
  strategy: AppliedStrategy;
  selectedKey: string;
  correct: boolean;
  selectedRole: OptionRole;
  difficulty: Difficulty;
  paramValues?: Record<string, number>;
  isRetry: boolean;
  versionSnapshot: {
    version: number;
    type: QuestionType;
    stem: string;
    options: QuestionOption[];
    difficulty: Difficulty;
  };
  createdAt: Date;
}

export interface PreviewReviewBookEntry {
  _id: ObjectId;
  questionId: ObjectId;
  sources: Array<'auto' | 'bookmark'>;
  triggeringAttemptId: ObjectId;
  loId: ObjectId;
  themeId: ObjectId;
  addedAt: Date;
  updatedAt: Date;
}

export interface PreviewFlagEntry {
  questionId: ObjectId;
  reason?: string;
  createdAt: Date;
}

/**
 * Mutable, short-lived state for one fresh anonymous-student Preview. It is
 * structurally isolated from all live student collections and expires
 * automatically. Attempt snapshots remain in `previewAttemptRecords`.
 */
export interface PreviewStudentSession {
  previewSessionId: string;
  instructorPuid: string;
  courseId: ObjectId;
  reviewBookEntries: PreviewReviewBookEntry[];
  flags: PreviewFlagEntry[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Material {
  courseId: ObjectId;
  name: string;
  format: 'pdf' | 'docx' | 'pptx' | 'txt' | 'md' | 'url';
  kind?: MaterialKind;
  status: 'processing' | 'ready' | 'failed';
  error?: string;
  sourceUrl?: string; // format === 'url'
  storagePath?: string; // uploaded file location on disk
  assignments: Array<{ themeId: ObjectId; loId?: ObjectId }>; // many-to-many (IN-S05)
  classificationSuggestion?: { themeId: ObjectId; loId?: ObjectId; confidence: number }; // IN-S06
  /** Ranked AI mappings. High-confidence mappings may already be present in
   * `assignments`; medium-confidence mappings stay here for instructor review. */
  classificationSuggestions?: Array<{
    themeId: ObjectId;
    loId?: ObjectId;
    confidence: number;
    rationale?: string;
  }>;
  automation?: {
    kind?: {
      value: MaterialKind;
      confidence: number;
      source: 'ai' | 'filename' | 'manual';
    };
    assignment?: {
      status: 'auto-applied' | 'needs-review' | 'unmatched';
      confidence: number;
      updatedAt: Date;
    };
  };
  knowledgeConcepts?: Array<{
    name: string;
    description?: string;
    confidence: number;
    evidence?: string;
    relationships?: Array<{ targetName: string; type: string }>;
  }>;
  // First ~2000 chars of the ingested text, persisted at ingest time so IN-S06
  // classification (classifyMaterial) and hierarchy suggestion (suggestHierarchy)
  // never re-parse files or re-fetch URL materials. Absent until a material is
  // ingested with non-empty text.
  excerpt?: string; // IN-S06
  /** Newest durable ingest attempt. Older attempts remain in contentRuns. */
  activeRunId?: ObjectId;
  /** Soft deletion keeps provenance and downstream questions intact. Search
   * vectors are removed while a material is in Trash and rebuilt on restore. */
  deletedAt?: Date;
  deletedBy?: string;
  uploadedAt: Date;
}

/** Persisted, inspectable source chunks. Embeddings remain in Qdrant; Mongo
 * keeps the text/evidence needed by Preview and the knowledge graph. */
export interface MaterialChunk {
  courseId: ObjectId;
  materialId: ObjectId;
  index: number;
  text: string;
  characterCount: number;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface ContentRunError {
  code: string;
  message: string;
  atStage: string;
  retryable: boolean;
}

export interface ContentRunWarning {
  code: string;
  message: string;
  atStage: string;
  at: Date;
}

export interface ContentRunEvent {
  revision: number;
  at: Date;
  type: 'status' | 'stage' | 'progress' | 'warning';
  status: ContentRunStatus;
  stage: string;
  completedUnits: number;
  totalUnits?: number;
  message?: string;
}

interface ContentRunBase {
  courseId: ObjectId;
  requestedBy: string;
  status: ContentRunStatus;
  completedUnits: number;
  totalUnits?: number;
  revision: number;
  events: ContentRunEvent[];
  warnings: ContentRunWarning[];
  error?: ContentRunError;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface MaterialIngestResult {
  characterCount: number;
  chunkCount: number;
  vectorCount: number;
  indexedCount: number;
  classification: 'suggested' | 'no-match' | 'skipped' | 'warning';
}

export interface MaterialIngestRun extends ContentRunBase {
  kind: 'material-ingest';
  stage: MaterialIngestStage;
  input: {
    materialId: ObjectId;
    sourceName: string;
    sourceFormat: Material['format'];
    trigger: 'upload' | 'retry' | 'restore';
    previousRunId?: ObjectId;
  };
  result?: MaterialIngestResult;
}

export interface QuestionGenerationFailure {
  item: number;
  stage: 'generating' | 'validating' | 'reviewing' | 'persisting';
  code: string;
  message: string;
}

export interface QuestionGenerationResult {
  createdQuestionIds: ObjectId[];
  failures: QuestionGenerationFailure[];
}

export interface QuestionGenerationRun extends ContentRunBase {
  kind: 'question-generation';
  stage: QuestionGenerationStage;
  input: {
    loId: ObjectId;
    count: number;
    type: QuestionType;
    difficulty?: Difficulty;
    /** Instructor-chosen hardness move (HARDNESS_MOVE_MENU id). Persisted
     * because the async job rebuilds GenerationInput from this record —
     * an unpersisted choice would silently drop on the queue boundary. */
    hardnessMove?: string;
    prompt?: string;
    blueprintId?: ObjectId;
    retryOfRunId?: ObjectId;
    models: {
      embedding: string;
      generator: string;
      validator: string;
      reviewer: string;
    };
  };
  grounding?: {
    allowedMaterialIds: ObjectId[];
    retrievedChunkCount: number;
  };
  result?: QuestionGenerationResult;
}

export type ContentRun = MaterialIngestRun | QuestionGenerationRun;

export interface GenerationBlueprint {
  courseId: ObjectId;
  name: string;
  loId: ObjectId;
  count: number;
  type: QuestionType;
  difficulty?: Difficulty;
  prompt?: string;
  materialIds?: ObjectId[];
  models: QuestionGenerationRun['input']['models'];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  lastRunId?: ObjectId;
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
  /** Template settings pinned when the attempt starts; later edits affect only new attempts. */
  templateKind: 'midterm' | 'final';
  timeLimitMinutes?: number;
  loBreakdown: boolean;
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
  open?: boolean; // true only while the single sitting is answerable (partial unique index)
  startedAt: Date;
  submittedAt?: Date;
  score?: number;
  maxScore: number;
  masteryPassQueuedAt?: Date;
  masteryPassCompletedAt?: Date;
}

export interface Flag {
  courseId: ObjectId;
  questionId: ObjectId;
  questionVersionId: ObjectId; // flags attach to the specific version (§6.2)
  puid: string; // flagging student
  source?: 'student' | 'instructor-preview-test' | 'ta';
  raisedBy?: 'student' | 'ta';
  reason?: string;
  state: FlagState;
  taRecommendation?: { recommendation: 'correct' | 'archive' | 'clear'; note?: string; puid: string; at: Date };
  // `correctnessAffecting` (Task 6 review fix): persists whether this
  // resolution was marked correctness-affecting, so the remediation panel's
  // "was this checklist relevant?" bit survives a reload — flags are
  // terminal, so this can never be re-derived after the fact. Absent (not
  // `false`) when unset, matching this file's other optional-field
  // convention (see `reason` above).
  // `notifiedAt`/`notifiedCount` (Task 6 re-review, Finding B): written by
  // flags.service.ts's `notifyRemediation` after a successful "Notify
  // affected students" call, onto every flag in the group whose resolution
  // is correctness-affecting (not just the one flag id the notify request
  // named). Persists the "already notified" marker across a reload the same
  // way `correctnessAffecting` above persists the checklist's relevance, so
  // the notify button can't be re-armed by a reload into re-sending the same
  // correction notice to the same students.
  resolution?: {
    action: 'correct' | 'archive' | 'clear';
    puid: string;
    at: Date;
    comment?: string;
    correctnessAffecting?: boolean;
    notifiedAt?: Date;
    notifiedCount?: number;
  };
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
  /** Set when the recipient dismisses the notification from the bell (click
   * or "Clear all"). Dismissed documents are retained for audit but never
   * returned by listNotifications() — the flag queue, not the bell, is the
   * durable record of outstanding work. */
  dismissedAt?: Date;
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

/** Stores the most recent end-of-session summary a student deferred to their
 * next session (ST-P10/ST-P11), keyed (puid, courseId) — one row per
 * student-course pair, overwritten on every new deferral. `summary` mirrors
 * review-book.service's `SessionEndSummary` return shape; duplicated here
 * (rather than imported) because domain document shapes are the persistence
 * contract and shouldn't depend on a service module's exported type. */
export interface SessionSummaryRecord {
  puid: string;
  courseId: ObjectId;
  summary: {
    losCovered: string[];
    questionsAttempted: number;
    accuracyByLo: Array<{ loId: string; attempted: number; correct: number; accuracy: number }>;
    reviewBookAdditions: Array<{ entryId: string; questionId: string; loId: string; themeId: string }>;
    missedQuestions: string[];
  };
  since: Date; // the client-provided session-start timestamp this summary was computed from
  updatedAt: Date;
}

// --- Publication state machine -----------------------------------------------

/** Allowed transitions (PRD §6.2). 'archived' is reachable from every state;
 * restore from 'archived' returns to 'draft' (re-approval required, IN-Q07). */
export const PUBLICATION_TRANSITIONS: Record<PublicationState, PublicationState[]> = {
  draft: ['pending-review', 'approved', 'archived'],
  'pending-review': ['reviewed', 'approved', 'draft', 'archived'],
  reviewed: ['approved', 'draft', 'archived'],
  approved: ['paused', 'archived'],
  paused: ['approved', 'archived'],
  archived: ['draft'],
};

export function canTransition(from: PublicationState, to: PublicationState): boolean {
  return PUBLICATION_TRANSITIONS[from]?.includes(to) ?? false;
}
