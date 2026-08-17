// Typed client for the backend API. One function per endpoint, so the UI code
// (views/*) never builds URLs or parses responses by hand. Keep the response
// types in sync with the server (see server/src/routes and services).

/** Error thrown for a non-2xx response. `status` carries the HTTP code. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// A single place to react to a 401 from a gated endpoint (e.g. the session
// expired mid-use): the app registers a handler that drops back to the landing
// screen. See main.ts.
let onUnauthorized: (() => void) | undefined;
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const data = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
  return data?.error ?? fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const message = await errorMessage(response, `Request to ${path} failed (${response.status}).`);
    if (response.status === 401) onUnauthorized?.();
    throw new ApiError(message, response.status);
  }
  // 204 No Content (e.g. the skip/bookmark-delete endpoints) has no body to
  // parse; callers of those endpoints declare Promise<void> and never read it.
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// --- Health (public) ---------------------------------------------------------

export interface HealthResponse {
  status: string;
  timestamp: string;
  services: Record<string, 'up' | 'down'>;
  genai: {
    llmProvider: string;
    llmModel: string;
    embeddingsProvider: string;
    embeddingsModel: string;
  };
}

export function checkHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/api/health');
}

// --- Authentication (public) -------------------------------------------------

export interface AuthUser {
  puid: string;
  uid: string;
  displayName: string;
  isAdmin: boolean;
  platformInstructor?: boolean;
  affiliations: string[];
  courseRoles: Array<{ courseId: string; role: string }>;
}

export interface AuthState {
  authenticated: boolean;
  user: AuthUser | null;
  /** Roles derived client-side from the user's affiliations, e.g. ['faculty']. */
  roles: string[];
}

/** GET /api/auth/me returns { authenticated, user? }; roles are derived here. */
export async function getAuthState(): Promise<AuthState> {
  const res = await request<{ authenticated: boolean; user?: AuthUser }>('/api/auth/me');
  const user = res.user ?? null;
  return { authenticated: res.authenticated, user, roles: user?.affiliations ?? [] };
}

// --- Admin: platform-Instructor accounts -----------------------------------

export interface AdminAccount {
  puid: string;
  status: 'active' | 'pending' | 'deactivated';
  uid: string;
  displayName: string;
  email: string;
  affiliations: string[];
  isAdmin: boolean;
  platformInstructor: boolean;
  lastLoginAt?: string;
  createdAt?: string;
  grantedAt?: string;
  updatedAt?: string;
}

export type CourseRole = 'student' | 'instructor' | 'ta';

export interface AdminDirectoryUser {
  _id: string;
  puid: string;
  uid: string;
  displayName: string;
  email: string;
  affiliations: string[];
  isAdmin: boolean;
  courseRoles: Array<{ courseId: string; role: CourseRole }>;
  deactivatedAt?: string;
  lastLoginAt: string;
}

export function listAdminUsers(filters: { q?: string; role?: CourseRole; courseId?: string } = {}): Promise<AdminDirectoryUser[]> {
  const query = new URLSearchParams();
  if (filters.q) query.set('q', filters.q);
  if (filters.role) query.set('role', filters.role);
  if (filters.courseId) query.set('courseId', filters.courseId);
  return request<AdminDirectoryUser[]>(`/api/admin/directory${query.size ? `?${query}` : ''}`);
}

export function assignAdminCourseRole(puid: string, courseId: string, role: CourseRole): Promise<void> {
  return request<void>(`/api/admin/users/${encodeURIComponent(puid)}/courses/${encodeURIComponent(courseId)}/roles/${role}`, { method: 'PUT' });
}

export function removeAdminCourseRole(
  puid: string,
  courseId: string,
  role: CourseRole,
  confirm = false,
): Promise<{ removed: boolean; warning?: 'orphans-course'; courseId?: string }> {
  return request<{ removed: boolean; warning?: 'orphans-course'; courseId?: string }>(
    `/api/admin/users/${encodeURIComponent(puid)}/courses/${encodeURIComponent(courseId)}/roles/${role}?confirm=${confirm}`,
    { method: 'DELETE' },
  );
}

export function setAdminUserActive(puid: string, active: boolean): Promise<void> {
  return request<void>(`/api/admin/users/${encodeURIComponent(puid)}/${active ? 'reactivate' : 'deactivate'}`, { method: 'POST' });
}

export type CapabilityRole = 'student' | 'instructor' | 'ta' | 'admin';

export interface CapabilityMatrix {
  scope: 'platform' | 'course';
  courseId?: string;
  assignments: Partial<Record<Capability, Partial<Record<CapabilityRole, boolean>>>>;
  matrix: Array<{
    capability: Capability;
    roles: Record<CapabilityRole, { value: boolean; source: 'default' | 'course' | 'admin-override' | 'user-override' }>;
  }>;
}

export function getAdminCapabilities(courseId?: string): Promise<CapabilityMatrix> {
  return request<CapabilityMatrix>(`/api/admin/capabilities${courseId ? `?courseId=${encodeURIComponent(courseId)}` : ''}`);
}

export function saveAdminCapabilities(
  assignments: CapabilityMatrix['assignments'],
  courseId?: string,
): Promise<void> {
  return request<void>('/api/admin/capabilities', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignments, courseId }),
  });
}

export const PIPELINE_STEPS = ['generator', 'validator', 'reviewer', 'masteryEvaluator', 'utility'] as const;
export type PipelineStep = (typeof PIPELINE_STEPS)[number];
export type CapabilityProfile = 'classic' | 'reasoning-tunable' | 'reasoning-fixed';
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';

export interface StepModelConfig {
  model: string;
  temperature?: number;
  reasoningEffort?: ReasoningEffort;
}

/**
 * What a profile accepts. The server sends this with the settings so the console
 * renders controls from measured capabilities rather than from a copy of the
 * table that would drift the first time a model is added.
 */
export interface ModelCapabilities {
  profile: CapabilityProfile;
  temperature: { min: number; max: number; default: number } | null;
  reasoningEffort: ReasoningEffort[] | null;
  defaultEffort: ReasoningEffort;
  tokenLimitParam: string;
}

export interface ModelCatalogue {
  models: Array<{ id: string; profile: CapabilityProfile; custom: boolean }>;
  profiles: Record<CapabilityProfile, ModelCapabilities>;
  /**
   * What a step uses when the admin sets no temperature (the generator runs
   * warm for batch diversity). Shown, never pre-filled: a saved value spreads
   * OVER the step default, so persisting it would switch that behaviour off.
   */
  stepTemperatureDefaults: Partial<Record<PipelineStep, number>>;
}

export interface PlatformSettings {
  models: Record<PipelineStep, StepModelConfig>;
  customModels?: Array<{ id: string; profile: CapabilityProfile }>;
  costControls: { maxGenerationsPerDay: number };
  featureFlags: { reviewerAgent: boolean; layer2Evaluator: boolean; retryOnReject: boolean };
  updatedBy: string;
  updatedAt: string;
}

/** GET returns the settings plus the capability catalogue in one round trip. */
export function getAdminPlatformSettings(): Promise<PlatformSettings & { catalogue: ModelCatalogue }> {
  return request<PlatformSettings & { catalogue: ModelCatalogue }>('/api/admin/platform-settings');
}

/**
 * Mirrors the server rule, so the UI can grey out a control before a save is
 * attempted: a temperature is legal only while the effective effort is `none`.
 */
export function temperatureAllowed(caps: ModelCapabilities, effort?: ReasoningEffort): boolean {
  if (!caps.temperature) return false;
  if (!caps.reasoningEffort) return true;
  return (effort ?? caps.defaultEffort) === 'none';
}

export function saveAdminPlatformSettings(
  settings: Pick<PlatformSettings, 'models' | 'costControls' | 'featureFlags' | 'customModels'>,
  confirmQualityImpact = false,
): Promise<PlatformSettings> {
  return request<PlatformSettings>('/api/admin/platform-settings', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...settings, confirmQualityImpact }),
  });
}

/** GET /api/admin/users?query= -> persisted users plus pending PUID grants. */
export function listAdminAccounts(query = ''): Promise<AdminAccount[]> {
  const search = query.trim() ? `?query=${encodeURIComponent(query.trim())}` : '';
  return request<AdminAccount[]>(`/api/admin/users${search}`);
}

/** PUT /api/admin/platform-instructors/:puid -> active or pending grant. */
export function grantPlatformInstructor(puid: string): Promise<AdminAccount> {
  return request<AdminAccount>(
    `/api/admin/platform-instructors/${encodeURIComponent(puid.trim())}`,
    { method: 'PUT' },
  );
}

/** DELETE /api/admin/platform-instructors/:puid -> idempotent revocation. */
export function revokePlatformInstructor(
  puid: string,
): Promise<{ puid: string; granted: false; revoked: boolean }> {
  return request<{ puid: string; granted: false; revoked: boolean }>(
    `/api/admin/platform-instructors/${encodeURIComponent(puid.trim())}`,
    { method: 'DELETE' },
  );
}

// --- Role areas (role-gated). See server/src/routes/roles.routes.ts. ---------

export interface RoleArea {
  role: string;
  title: string;
  blurb: string;
  capabilities: string[];
  yourRoles: string[];
  serverTime: string;
}

/** Load a role area. Throws ApiError with status 403 if it isn't your role. */
export function getRoleArea(role: string): Promise<RoleArea> {
  return request<RoleArea>(`/api/roles/${role}`);
}

// --- Members area (auth-gated) ----------------------------------------------

export interface MembersOverview {
  message: string;
  displayName: string;
  puid: string;
  affiliations: string[];
  serverTime: string;
}

export function getMembersOverview(): Promise<MembersOverview> {
  return request<MembersOverview>('/api/members/overview');
}

// --- EXAMPLE: notes (mongodb demo, auth-gated). Safe to remove. --------------

export interface Note {
  _id: string;
  text: string;
  createdAt: string;
}

export function fetchNotes(): Promise<Note[]> {
  return request<Note[]>('/api/notes');
}

export function addNote(text: string): Promise<Note> {
  return request<Note>('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

// --- EXAMPLE: RAG (genai + qdrant demo, auth-gated). Safe to remove. ---------

export interface IngestResult {
  sourceId: string;
  chunks: number;
}

export interface RagSource {
  sourceId: string;
  chunkNumber?: number;
  score: number;
  text: string;
}

export interface RagAnswer {
  answer: string;
  sources: RagSource[];
}

export function ingestRagText(text: string, sourceId?: string): Promise<IngestResult> {
  return request<IngestResult>('/api/rag/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, sourceId }),
  });
}

export function ingestRagFile(file: File): Promise<IngestResult> {
  const form = new FormData();
  form.append('file', file);
  return request<IngestResult>('/api/rag/ingest-file', { method: 'POST', body: form });
}

export function queryRag(question: string): Promise<RagAnswer> {
  return request<RagAnswer>('/api/rag/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  });
}

// EXAMPLE (Academic API demo): the Classes feature. Mirrors the server's
// classes.service return shapes. Safe to delete with the classes view.

export interface ClassSummary {
  sectionId: string;
  courseCode: string;
  title: string;
  sectionStatus: string;
  schedule: string;
  registrationStatus?: string;
}

export interface PeriodGroup {
  periodId: string;
  periodName: string;
  classes: ClassSummary[];
}

export interface MyClasses {
  personFound: boolean;
  teaching: PeriodGroup[];
  enrolled: PeriodGroup[];
}

export interface RosterStudent {
  studentId: string;
  name: string;
  email: string;
  registrationStatus: string;
  /** The raw Academic API records, passed through for the expandable view. */
  person: Record<string, unknown> | null;
  registration: Record<string, unknown>;
}

export interface ClassList {
  sectionId: string;
  courseCode: string;
  title: string;
  periodName: string;
  students: RosterStudent[];
}

export function fetchMyClasses(): Promise<MyClasses> {
  return request<MyClasses>('/api/classes');
}

export function fetchClassList(sectionId: string): Promise<ClassList> {
  return request<ClassList>(`/api/classes/${encodeURIComponent(sectionId)}/students`);
}

// --- Enrollment (student, ST-E02/E03) ----------------------------------------

export interface EnrollmentResult {
  courseId: string;
  name: string;
  courseCode: string;
}

export interface Enrollment {
  courseId: string;
  name: string;
  courseCode: string;
  term: string;
  active: boolean;
}

/** POST /api/enrollments { code } -> 201 { courseId, name, courseCode }. */
export function enrollInCourse(code: string): Promise<EnrollmentResult> {
  return request<EnrollmentResult>('/api/enrollments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
}

/** GET /api/enrollments -> the student's enrolled courses. */
export function listEnrollments(): Promise<Enrollment[]> {
  return request<Enrollment[]>('/api/enrollments');
}

// --- Practice / course home (student, ST-P01..P11) ---------------------------

export type MasteryStatus = 'not-attempted' | 'in-progress' | 'covered' | 'struggling';

export interface CourseHomeLo {
  lo: { _id: string; name: string; order: number; themeId: string };
  status: MasteryStatus;
  approvedCount: number;
}

export interface CourseHomeTheme {
  theme: { _id: string; name: string; order: number };
  available: boolean;
  los: CourseHomeLo[];
}

/** GET /api/courses/:courseId/home -> themes visible to the student (ST-P01/P02). */
export function getCourseHome(courseId: string): Promise<CourseHomeTheme[]> {
  return request<CourseHomeTheme[]>(`/api/courses/${encodeURIComponent(courseId)}/home`);
}

export interface PracticeQuestionOption {
  key: string;
  text: string;
}

export interface PracticeQuestion {
  questionId: string;
  questionVersionId: string;
  type: 'mcq' | 'true-false';
  stem: string;
  difficulty: 'easy' | 'medium' | 'hard';
  degraded: 'none' | 'repeat' | 'adjacent' | 'any';
  options: PracticeQuestionOption[];
  watermark: string;
  /** Present only for a parameterized question — the values drawn for THIS
   * serve, already substituted into `stem`/`options`. Absent for a
   * conceptual (non-parameterized) question. */
  paramValues?: Record<string, number>;
  seed?: number;
}

/** POST /api/courses/:courseId/practice/next { loId, sessionServedIds } ->
 * a sanitized question (never role/explanation/correctness). 404 (ApiError)
 * when the LO has no Approved question. */
export function getNextPracticeQuestion(
  courseId: string,
  input: { loId: string; sessionServedIds: string[] },
): Promise<PracticeQuestion> {
  return request<PracticeQuestion>(`/api/courses/${encodeURIComponent(courseId)}/practice/next`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

/** POST /api/questions/:questionId/flag { reason? } -> { flagged: true, duplicate }.
 * Student-only and idempotent for the signed-in student/current version while
 * that student's flag on it is still open. `duplicate: true` means no new flag
 * was recorded because one is already pending — the caller should say so rather
 * than report a fresh flag (see the note in server/src/routes/flags.routes.ts). */
export function flagPracticeQuestion(
  questionId: string,
  reason?: string,
): Promise<{ flagged: true; duplicate: boolean }> {
  const normalizedReason = reason?.trim();
  return request<{ flagged: true; duplicate: boolean }>(
    `/api/questions/${encodeURIComponent(questionId)}/flag`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalizedReason ? { reason: normalizedReason } : {}),
    },
  );
}

export type PracticeMode = 'topic-practice' | 'review-book' | 'exam-prep';
export type OptionRole = 'correct' | 'common-misconception' | 'partially-correct' | 'clearly-wrong';

export interface RevealedOption {
  key: string;
  text: string;
  role: OptionRole;
  explanation: string;
  correct: boolean;
}

export interface AttemptResult {
  correct: boolean;
  feedback: {
    strategy: 'a' | 'b';
    revealed: RevealedOption[];
    retry?: {
      questionId: string;
      questionVersionId: string;
      type: 'mcq' | 'true-false';
      stem: string;
      options: PracticeQuestionOption[];
      paramValues?: Record<string, number>;
      seed?: number;
    };
  };
  mastery: { loStatus: MasteryStatus; recommendation?: 'advance-lo' | 'advance-theme' };
  reviewBook: { added: boolean };
  redirect?: {
    materials: Array<{ name: string; materialId: string }>;
    message: string;
  };
}

export interface SubmitAttemptInput {
  questionVersionId: string;
  loId: string;
  selectedKey: string;
  mode: PracticeMode;
  sessionServedIds: string[];
  isRetry?: boolean;
  paramValues?: Record<string, number>;
}

/** POST /api/attempts -> AttemptResult (ST-P04). */
export function submitAttempt(input: SubmitAttemptInput): Promise<AttemptResult> {
  return request<AttemptResult>('/api/attempts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

/** Instructor-only hierarchy for one isolated anonymous-student preview. */
export function getPreviewCourseHome(
  courseId: string,
  previewSessionId: string,
): Promise<CourseHomeTheme[]> {
  return request<CourseHomeTheme[]>(
    `/api/courses/${encodeURIComponent(courseId)}/preview/home?previewSessionId=${encodeURIComponent(previewSessionId)}`,
  );
}

/** Instructor-only approved-question serving; never requires student enrollment. */
export function getNextPreviewQuestion(
  courseId: string,
  previewSessionId: string,
  input: { loId: string; sessionServedIds: string[] },
): Promise<PracticeQuestion> {
  return request<PracticeQuestion>(
    `/api/courses/${encodeURIComponent(courseId)}/preview/practice/next`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, previewSessionId }),
    },
  );
}

/**
 * Instructor preview submission. The server derives preview context from the
 * route/session; this helper intentionally sends no client-controlled
 * `preview` boolean and omits the live-only practice mode.
 */
export function submitPreviewAttempt(
  courseId: string,
  previewSessionId: string,
  input: SubmitAttemptInput,
): Promise<AttemptResult> {
  const {
    questionVersionId,
    loId,
    selectedKey,
    sessionServedIds,
    isRetry,
    paramValues,
  } = input;
  return request<AttemptResult>(
    `/api/courses/${encodeURIComponent(courseId)}/preview/attempts`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        previewSessionId,
        questionVersionId,
        loId,
        mode: input.mode,
        selectedKey,
        sessionServedIds,
        ...(isRetry !== undefined ? { isRetry } : {}),
        ...(paramValues !== undefined ? { paramValues } : {}),
      }),
    },
  );
}

export function flagPreviewQuestion(
  courseId: string,
  previewSessionId: string,
  questionId: string,
  reason?: string,
  sendToInstructorQueue = false,
): Promise<{ flagged: true; testQueued: boolean }> {
  const normalizedReason = reason?.trim();
  return request<{ flagged: true; testQueued: boolean }>(
    `/api/courses/${encodeURIComponent(courseId)}/preview/questions/${encodeURIComponent(questionId)}/flag`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        previewSessionId,
        ...(normalizedReason ? { reason: normalizedReason } : {}),
        ...(sendToInstructorQueue ? { sendToInstructorQueue: true } : {}),
      }),
    },
  );
}

export function getPreviewReviewBook(
  courseId: string,
  previewSessionId: string,
  sort: ReviewBookSort = 'theme',
): Promise<ReviewBookGroup[]> {
  const query = new URLSearchParams({ previewSessionId, sort });
  return request<ReviewBookGroup[]>(
    `/api/courses/${encodeURIComponent(courseId)}/preview/review-book?${query.toString()}`,
  );
}

export function bookmarkPreviewQuestion(
  courseId: string,
  previewSessionId: string,
  questionId: string,
): Promise<{ bookmarked: boolean }> {
  return request<{ bookmarked: boolean }>(
    `/api/courses/${encodeURIComponent(courseId)}/preview/questions/${encodeURIComponent(questionId)}/bookmark`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ previewSessionId }),
    },
  );
}

export function unbookmarkPreviewQuestion(
  courseId: string,
  previewSessionId: string,
  questionId: string,
): Promise<{ bookmarked: boolean }> {
  return request<{ bookmarked: boolean }>(
    `/api/courses/${encodeURIComponent(courseId)}/preview/questions/${encodeURIComponent(questionId)}/bookmark?previewSessionId=${encodeURIComponent(previewSessionId)}`,
    { method: 'DELETE' },
  );
}

export async function removePreviewReviewBookEntry(
  courseId: string,
  previewSessionId: string,
  entryId: string,
): Promise<void> {
  await request<void>(
    `/api/courses/${encodeURIComponent(courseId)}/preview/review-book/${encodeURIComponent(entryId)}?previewSessionId=${encodeURIComponent(previewSessionId)}`,
    { method: 'DELETE' },
  );
}

export async function skipPreviewLo(
  courseId: string,
  previewSessionId: string,
  loId: string,
  attempted: boolean,
): Promise<void> {
  await request<void>(
    `/api/courses/${encodeURIComponent(courseId)}/preview/los/${encodeURIComponent(loId)}/skip`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ previewSessionId, attempted }),
    },
  );
}

export function getPreviewSessionSummary(
  courseId: string,
  previewSessionId: string,
): Promise<SessionSummaryForStart> {
  return request<SessionSummaryForStart>(
    `/api/courses/${encodeURIComponent(courseId)}/preview/session-summary?previewSessionId=${encodeURIComponent(previewSessionId)}`,
  );
}

export function endPreviewSessionSummary(
  courseId: string,
  previewSessionId: string,
  since: Date,
): Promise<SessionEndSummary> {
  const query = new URLSearchParams({
    previewSessionId,
    since: since.toISOString(),
  });
  return request<SessionEndSummary>(
    `/api/courses/${encodeURIComponent(courseId)}/preview/session-summary?${query.toString()}`,
  );
}

/** POST /api/courses/:courseId/los/:loId/skip { attempted } -> 204 (ST-P06). */
export async function skipLo(courseId: string, loId: string, attempted: boolean): Promise<void> {
  await request<void>(`/api/courses/${encodeURIComponent(courseId)}/los/${encodeURIComponent(loId)}/skip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attempted }),
  });
}

// --- Session summary (student, ST-P10/P11) -----------------------------------

export interface SessionEndSummary {
  losCovered: string[];
  questionsAttempted: number;
  accuracyByLo: Array<{ loId: string; attempted: number; correct: number; accuracy: number }>;
  reviewBookAdditions: Array<{ entryId: string; questionId: string; loId: string; themeId: string }>;
  missedQuestions: string[];
}

export interface SessionSummaryForStart {
  deferred?: SessionEndSummary;
  welcome: boolean;
}

/** GET /api/courses/:courseId/session-summary -> start-of-session payload (ST-P11). */
export function getSessionSummary(courseId: string): Promise<SessionSummaryForStart> {
  return request<SessionSummaryForStart>(`/api/courses/${encodeURIComponent(courseId)}/session-summary`);
}

/** PUT /api/courses/:courseId/deferred-summary { since } -> SessionEndSummary (ST-P10). */
export function deferSessionSummary(courseId: string, since: Date): Promise<SessionEndSummary> {
  return request<SessionEndSummary>(`/api/courses/${encodeURIComponent(courseId)}/deferred-summary`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ since: since.toISOString() }),
  });
}

// --- Review Book (student, ST-R02..R07) --------------------------------------

export type ReviewBookSort = 'theme' | 'date';

export interface ReviewBookEntry {
  _id: string;
  puid: string;
  courseId: string;
  questionId: string;
  sources: Array<'auto' | 'bookmark'>;
  triggeringAttemptId: string;
  loId: string;
  themeId: string;
  addedAt: string;
  updatedAt: string;
  question: { stem: string; type: string; difficulty: string };
}

export interface ReviewBookGroup {
  theme: { _id: string; name: string; order: number };
  entries: ReviewBookEntry[];
}

/** GET /api/courses/:courseId/review-book?sort= -> theme-grouped entries (ST-R05). */
export function getReviewBook(courseId: string, sort: ReviewBookSort = 'theme'): Promise<ReviewBookGroup[]> {
  return request<ReviewBookGroup[]>(
    `/api/courses/${encodeURIComponent(courseId)}/review-book?sort=${encodeURIComponent(sort)}`,
  );
}

/** POST /api/questions/:questionId/bookmark -> { bookmarked } (ST-R02). */
export function bookmarkQuestion(questionId: string): Promise<{ bookmarked: boolean }> {
  return request<{ bookmarked: boolean }>(`/api/questions/${encodeURIComponent(questionId)}/bookmark`, {
    method: 'POST',
  });
}

/** DELETE /api/questions/:questionId/bookmark -> { bookmarked } (ST-R02). */
export function unbookmarkQuestion(questionId: string): Promise<{ bookmarked: boolean }> {
  return request<{ bookmarked: boolean }>(`/api/questions/${encodeURIComponent(questionId)}/bookmark`, {
    method: 'DELETE',
  });
}

/** DELETE /api/review-book/:entryId -> 204 (ST-R03). */
export async function removeReviewBookEntry(entryId: string): Promise<void> {
  await request<void>(`/api/review-book/${encodeURIComponent(entryId)}`, { method: 'DELETE' });
}

// --- Instructor: courses & hierarchy (IN-S01/S02/S03, IN-L06) ---------------
//
// Corrections vs the Task-15 plan's Task A interface block, verified against
// docs/api-contract.md + server/src/routes/courses.routes.ts (see
// .superpowers/sdd/task-15/task-a-report.md for the full rationale):
//  - Course identity is `_id` on the wire (raw Mongo doc), not `courseId` —
//    matches the plan's own CourseTreeTheme/CourseTreeLo (`_id`) convention;
//    the plan's `InstructorCourse.courseId` looks like the one outlier/typo.
//  - `GET /api/courses/:courseId` returns the Course fields and `themes`
//    FLATTENED at the top level (`{ ...course, themes }`), not nested under a
//    `course` key. `getCourseTree` below re-nests it into `{ course, themes }`
//    at the client boundary so callers get the plan's documented shape.
//  - `updateCourse`'s `autoPause` patch field is an object
//    (`{ minAttempts, flagPercent, flagCount }`), not a boolean — the plan's
//    signature had the wrong type for it.
//  - `getRoster` does not return `addedAt` (the route strips it before
//    responding; contract agrees) — dropped from the return type.
//  - `CourseTreeTheme.los` is optional: `addTheme`/`updateTheme` return a bare
//    Theme (no `los`); only a Theme nested inside `getCourseTree`'s response
//    carries one.
//  - `GET /api/courses` lists the signed-in user's live Instructor courses in
//    one request. The service resolves session `courseRoles` server-side and
//    silently omits historical role entries whose course has been deleted.
//    Admin-only access without an explicit course role is intentionally not a
//    list-all capability.
//  - No `GET /api/courses/:courseId/publish-checklist` (or any other
//    side-effect-free) endpoint exists — the checklist is only returned
//    bundled with the side-effecting `POST .../publish` / `.../unpublish`.
//    Calling either to merely preview the checklist would incorrectly
//    publish/unpublish the course, so `getPublishChecklist` is NOT wired to a
//    request call; it throws until a trivial read-only route is added
//    server-side (out of scope for this task — no server changes allowed).
//    Flagged prominently in the report.

export interface AutoPauseConfig {
  minAttempts: number;
  flagPercent: number;
  flagCount: number;
}

export interface InstructorCourse {
  _id: string;
  ownerPuid: string;
  name: string;
  courseCode: string;
  section?: string;
  term: string;
  published: boolean;
  lifecycle?: 'draft' | 'published' | 'archived';
  archivedAt?: string;
  termStart?: string;
  termEnd?: string;
  registrationCode?: string;
  // Always present on the wire (server/src/services/courses.service.ts sets
  // defaults on create) — added here (Task C) so Settings (I4) can read/patch
  // them without an unsafe cast; the Task A interface omitted them.
  feedbackStrategy: 'adaptive' | 'strategy-a' | 'strategy-b';
  autoPause: AutoPauseConfig;
}

export interface CourseTreeLo {
  _id: string;
  name: string;
  order: number;
  themeId: string;
}

export interface CourseTreeTheme {
  _id: string;
  name: string;
  order: number;
  availableFrom?: string;
  /** Present when this Theme came back nested inside a `CourseTree`; absent
   * from a bare Theme response (`addTheme`/`updateTheme`). */
  los?: CourseTreeLo[];
}

export interface CourseTree {
  course: InstructorCourse;
  themes: CourseTreeTheme[];
}

export interface ChecklistItem {
  item: string;
  ok: boolean;
}

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
  id: string;
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
    termStart?: string;
    termEnd?: string;
    lifecycle: 'draft' | 'published' | 'archived';
  };
  readiness: {
    completed: number;
    total: number;
    percent: number;
    checklist: ChecklistItem[];
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

/** GET /api/courses -> the signed-in user's live Instructor courses. */
export function listInstructorCourses(): Promise<InstructorCourse[]> {
  return request<InstructorCourse[]>('/api/courses');
}

/** POST /api/courses { name, courseCode, term } -> 201 Course. */
export function createCourse(input: {
  name: string;
  courseCode: string;
  section?: string;
  term: string;
}): Promise<InstructorCourse> {
  return request<InstructorCourse>('/api/courses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

/** GET /api/courses/:courseId -> Course + themes: [Theme & { los }] (flat on
 * the wire; re-nested here into { course, themes }). */
export async function getCourseTree(courseId: string): Promise<CourseTree> {
  const flat = await request<InstructorCourse & { themes: CourseTreeTheme[] }>(
    `/api/courses/${encodeURIComponent(courseId)}`,
  );
  const { themes, ...course } = flat;
  return { course, themes };
}

export interface CourseOutlineLo {
  _id: string;
  name: string;
  order: number;
}

export interface CourseOutlineTheme {
  _id: string;
  name: string;
  order: number;
  los: CourseOutlineLo[];
}

export interface CourseOutline {
  course: {
    name: string;
    courseCode: string;
    section?: string;
    term: string;
  };
  themes: CourseOutlineTheme[];
}

/** GET /api/courses/:courseId/outline -> safe course identity + theme/LO names.
 * The TA-accessible subset of `getCourseTree` (which is instructor-only). */
export function getCourseOutline(courseId: string): Promise<CourseOutline> {
  return request<CourseOutline>(`/api/courses/${encodeURIComponent(courseId)}/outline`);
}

/** PATCH /api/courses/:courseId { termStart?, termEnd?, feedbackStrategy?, autoPause?, published? } -> Course. */
export function updateCourse(
  courseId: string,
  patch: {
    termStart?: string;
    termEnd?: string;
    name?: string;
    courseCode?: string;
    section?: string | null;
    term?: string;
    feedbackStrategy?: 'adaptive' | 'strategy-a' | 'strategy-b';
    autoPause?: AutoPauseConfig;
    published?: boolean;
  },
): Promise<InstructorCourse> {
  return request<InstructorCourse>(`/api/courses/${encodeURIComponent(courseId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

/** POST /api/courses/:courseId/registration-code -> { registrationCode } (regenerates). */
export function regenerateRegistrationCode(courseId: string): Promise<{ registrationCode: string }> {
  return request<{ registrationCode: string }>(`/api/courses/${encodeURIComponent(courseId)}/registration-code`, {
    method: 'POST',
  });
}

/** Side-effect-free authoritative publish checklist. */
export function getPublishChecklist(courseId: string): Promise<ChecklistItem[]> {
  return request<ChecklistItem[]>(
    `/api/courses/${encodeURIComponent(courseId)}/publish-checklist`,
  );
}

export function getInstructorWorkflow(courseId: string): Promise<InstructorWorkflowSummary> {
  return request<InstructorWorkflowSummary>(
    `/api/courses/${encodeURIComponent(courseId)}/instructor-workflow`,
  );
}

export function archiveCourse(courseId: string): Promise<InstructorCourse> {
  return request<InstructorCourse>(`/api/courses/${encodeURIComponent(courseId)}/archive`, {
    method: 'POST',
  });
}

export function restoreCourse(courseId: string): Promise<InstructorCourse> {
  return request<InstructorCourse>(`/api/courses/${encodeURIComponent(courseId)}/restore`, {
    method: 'POST',
  });
}

export interface PermanentCourseDeletionResult {
  deleted: true;
  courseId: string;
  deletedFiles: number;
  missingFiles: number;
  deletedVectorCollection: boolean;
  cancelledJobs: number;
  deletedDocuments: Record<string, number>;
}

/** Irreversibly remove a complete course project and its stored data. */
export function permanentlyDeleteCourse(
  courseId: string,
  confirmation: string,
): Promise<PermanentCourseDeletionResult> {
  return request<PermanentCourseDeletionResult>(`/api/courses/${encodeURIComponent(courseId)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmation }),
  });
}

// --- Exam Prep templates (Phase 3 WS-10 / IN-S07) --------------------------

export type ExamTemplateKind = 'midterm' | 'final';

export interface ExamTemplateThemeConfig {
  themeId: string;
  mcqCount: number;
  tfCount: number;
  pointsPerQuestion: number;
}

export interface ExamTemplate {
  _id: string;
  courseId: string;
  kind: ExamTemplateKind;
  themes: ExamTemplateThemeConfig[];
  timeLimitMinutes?: number;
  availabilityStart: string;
  availabilityEnd: string;
  loBreakdown: boolean;
  updatedAt: string;
}

export interface ExamTemplateSupplyWarning {
  themeId: string;
  themeName: string;
  requested: number;
  available: number;
}

export function listExamTemplates(courseId: string): Promise<ExamTemplate[]> {
  return request<ExamTemplate[]>(
    `/api/courses/${encodeURIComponent(courseId)}/exam-templates`,
  );
}

export function saveExamTemplate(
  courseId: string,
  kind: ExamTemplateKind,
  input: Omit<ExamTemplate, '_id' | 'courseId' | 'kind' | 'updatedAt'>,
): Promise<{ template: ExamTemplate; warnings: ExamTemplateSupplyWarning[] }> {
  return request<{ template: ExamTemplate; warnings: ExamTemplateSupplyWarning[] }>(
    `/api/courses/${encodeURIComponent(courseId)}/exam-templates/${kind}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}

// --- Exam Prep student sitting/results (Phase 3 WS-10 / ST-X01..X04) -------

export interface ExamAttemptSummary {
  _id: string;
  courseId: string;
  templateId: string;
  templateKind: ExamTemplateKind;
  startedAt: string;
  submittedAt?: string;
  score?: number;
  maxScore: number;
}

export interface ExamStateQuestion {
  index: number;
  type: 'mcq' | 'true-false';
  stem: string;
  options: Array<{ key: string; text: string }>;
  points: number;
  answered: boolean;
}

export interface ExamAttemptState {
  attemptId: string;
  templateId: string;
  kind: ExamTemplateKind;
  questions: ExamStateQuestion[];
  answers: Array<string | null>;
  shortfalls: Array<{ themeId: string; requested: number; assembled: number }>;
  startedAt: string;
  submitted: boolean;
  submittedAt?: string;
  remainingSeconds?: number;
}

export interface ExamBreakdown {
  earned: number;
  possible: number;
  practiceLink?: { courseId: string; themeId?: string; loId?: string };
}

export interface ExamResultQuestion {
  index: number;
  questionId: string;
  questionVersionId: string;
  themeId: string;
  loId: string;
  type: 'mcq' | 'true-false';
  stem: string;
  options: Array<{
    key: string;
    text: string;
    role: 'correct' | 'common-misconception' | 'partially-correct' | 'clearly-wrong';
    explanation: string;
    correct: boolean;
  }>;
  selectedKey: string | null;
  correct: boolean;
  points: number;
}

export interface ExamResults {
  attemptId: string;
  kind: ExamTemplateKind;
  submittedAt: string;
  score: number;
  maxScore: number;
  byTheme: Array<ExamBreakdown & { themeId: string; name: string }>;
  byLo?: Array<ExamBreakdown & { loId: string; themeId: string; name: string }>;
  questions: ExamResultQuestion[];
}

export interface ExamHistoryItem {
  attemptId: string;
  kind: ExamTemplateKind;
  date: string;
  score: number;
  maxScore: number;
}

export function listActiveExams(courseId: string): Promise<ExamTemplate[]> {
  return request<ExamTemplate[]>(`/api/courses/${encodeURIComponent(courseId)}/exams`);
}

export function startExamAttempt(
  courseId: string,
  templateId: string,
): Promise<ExamAttemptSummary> {
  return request<ExamAttemptSummary>(
    `/api/courses/${encodeURIComponent(courseId)}/exams/${encodeURIComponent(templateId)}/start`,
    { method: 'POST' },
  );
}

export function getExamAttempt(attemptId: string): Promise<ExamAttemptState> {
  return request<ExamAttemptState>(`/api/exam-attempts/${encodeURIComponent(attemptId)}`);
}

export function saveExamAnswer(
  attemptId: string,
  index: number,
  selectedKey: string,
): Promise<void> {
  return request<void>(
    `/api/exam-attempts/${encodeURIComponent(attemptId)}/answers/${index}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedKey }),
    },
  );
}

export function submitExamAttempt(
  attemptId: string,
): Promise<{ score: number; maxScore: number }> {
  return request<{ score: number; maxScore: number }>(
    `/api/exam-attempts/${encodeURIComponent(attemptId)}/submit`,
    { method: 'POST' },
  );
}

export function getExamResults(attemptId: string): Promise<ExamResults> {
  return request<ExamResults>(
    `/api/exam-attempts/${encodeURIComponent(attemptId)}/results`,
  );
}

export function getExamHistory(courseId: string): Promise<ExamHistoryItem[]> {
  return request<ExamHistoryItem[]>(
    `/api/courses/${encodeURIComponent(courseId)}/exam-history`,
  );
}

/** POST /api/courses/:courseId/themes { name } -> 201 Theme. */
export function addTheme(courseId: string, name: string): Promise<CourseTreeTheme> {
  return request<CourseTreeTheme>(`/api/courses/${encodeURIComponent(courseId)}/themes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

/** PATCH /api/themes/:themeId { name?, availableFrom?, order? } -> Theme. */
export function updateTheme(
  themeId: string,
  patch: { name?: string; availableFrom?: string; order?: number },
): Promise<CourseTreeTheme> {
  return request<CourseTreeTheme>(`/api/themes/${encodeURIComponent(themeId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

/** POST /api/themes/:themeId/archive -> Theme. */
export async function archiveTheme(themeId: string): Promise<void> {
  await request<void>(`/api/themes/${encodeURIComponent(themeId)}/archive`, { method: 'POST' });
}

/** POST /api/themes/:themeId/los { name } -> 201 LearningObjective. */
export function addLo(themeId: string, name: string): Promise<CourseTreeLo> {
  return request<CourseTreeLo>(`/api/themes/${encodeURIComponent(themeId)}/los`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export interface CourseOutlineUpsertResult {
  themesCreated: number;
  losCreated: number;
  themes: Array<{
    _id: string;
    name: string;
    created: boolean;
    los: Array<{ _id: string; name: string; created: boolean }>;
  }>;
}

/** Retry-safe batch Topic/LO creation. Existing active names are reused. */
export function upsertCourseOutline(
  courseId: string,
  themes: Array<{ name: string; los: string[] }>,
): Promise<CourseOutlineUpsertResult> {
  return request<CourseOutlineUpsertResult>(
    `/api/courses/${encodeURIComponent(courseId)}/outline`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ themes }),
    },
  );
}

/** PATCH /api/los/:loId { name?, order? } -> LearningObjective. */
export function updateLo(loId: string, patch: { name?: string; order?: number }): Promise<CourseTreeLo> {
  return request<CourseTreeLo>(`/api/los/${encodeURIComponent(loId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

/** POST /api/los/:loId/archive -> LearningObjective. */
export async function archiveLo(loId: string): Promise<void> {
  await request<void>(`/api/los/${encodeURIComponent(loId)}/archive`, { method: 'POST' });
}

/** GET /api/courses/:courseId/roster -> [{ identifier, extendedUntil? }] (no `addedAt` on the wire). */
export function getRoster(courseId: string): Promise<Array<{ identifier: string; extendedUntil?: string }>> {
  return request<Array<{ identifier: string; extendedUntil?: string }>>(
    `/api/courses/${encodeURIComponent(courseId)}/roster`,
  );
}

export type RosterRejectReason = 'student-number' | 'malformed-email' | 'invalid-characters' | 'duplicate';

export interface RosterReject {
  line: number;
  value: string;
  reason: RosterRejectReason;
}

export interface RosterParseResult {
  columns: string[];
  selectedColumn: string | null;
  identifiers: string[];
  rejects: RosterReject[];
  totalRows: number;
}

/** PUT /api/courses/:courseId/roster { identifiers } -> { count, rejected }.
 *  `rejected` lists entries dropped because they can never match a login —
 *  most often student numbers. */
export function putRoster(
  courseId: string,
  identifiers: string[],
): Promise<{ count: number; rejected: RosterReject[] }> {
  return request<{ count: number; rejected: RosterReject[] }>(
    `/api/courses/${encodeURIComponent(courseId)}/roster`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers }),
    },
  );
}

/** POST /api/courses/:courseId/roster/preview (multipart, field `file`) ->
 *  RosterParseResult. Parse-only — nothing is written until putRoster. */
export function previewRosterFile(courseId: string, file: File, column?: string): Promise<RosterParseResult> {
  const form = new FormData();
  form.append('file', file);
  if (column) form.append('column', column);
  return request<RosterParseResult>(`/api/courses/${encodeURIComponent(courseId)}/roster/preview`, {
    method: 'POST',
    body: form,
  });
}

// --- Instructor: materials (IN-S04/S05/S06) ----------------------------------
//
// Added in Task C (consumed by the Course Dashboard's pre-publish checklist —
// "Course materials uploaded and assigned" — via `listMaterials`, per the
// plan's Task D signature). Task D reuses `listMaterials` for the full
// upload/assign/classify view rather than re-adding it; it also adds the
// remaining materials-slice functions (`uploadMaterials`, `addUrlMaterial`,
// `retryMaterial`, `assignMaterial`, `resolveClassification`,
// `getSuggestedHierarchy`) that Task C has no need for.

export interface MaterialAssignment {
  themeId: string;
  loId?: string;
}

export interface Material {
  _id: string;
  courseId: string;
  name: string;
  format: 'pdf' | 'docx' | 'pptx' | 'txt' | 'md' | 'url';
  kind?: MaterialKind;
  status: 'processing' | 'ready' | 'failed';
  error?: string;
  sourceUrl?: string;
  storagePath?: string;
  assignments: MaterialAssignment[];
  classificationSuggestion?: { themeId: string; loId?: string; confidence: number };
  classificationSuggestions?: Array<{ themeId: string; loId?: string; confidence: number; rationale?: string }>;
  automation?: {
    kind?: { value: MaterialKind; confidence: number; source: 'ai' | 'filename' | 'manual' };
    assignment?: {
      status: 'auto-applied' | 'needs-review' | 'unmatched';
      confidence: number;
      updatedAt: string;
    };
  };
  knowledgeConcepts?: Array<{
    name: string;
    description?: string;
    confidence: number;
    evidence?: string;
    relationships?: Array<{ targetName: string; type: string }>;
  }>;
  excerpt?: string;
  activeRunId?: string;
  deletedAt?: string;
  deletedBy?: string;
  uploadedAt: string;
}

export type MaterialKind =
  | 'lecture'
  | 'reading'
  | 'assignment'
  | 'assessment'
  | 'solution'
  | 'reference'
  | 'other';

// --- Instructor: durable content runs (Phase 2 P2-0) ------------------------

export type ContentRunKind = 'material-ingest' | 'question-generation';
export type ContentRunStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed';

export interface ContentRunError {
  code: string;
  message: string;
  atStage: string;
  retryable: boolean;
}

interface ContentRunBase {
  _id: string;
  courseId: string;
  kind: ContentRunKind;
  requestedBy: string;
  status: ContentRunStatus;
  stage: string;
  completedUnits: number;
  totalUnits?: number;
  revision: number;
  warnings: Array<{ code: string; message: string; atStage: string; at: string }>;
  error?: ContentRunError;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface MaterialIngestRun extends ContentRunBase {
  kind: 'material-ingest';
  input: {
    materialId: string;
    sourceName: string;
    sourceFormat: Material['format'];
    trigger: 'upload' | 'retry' | 'restore';
    previousRunId?: string;
  };
  result?: {
    characterCount: number;
    chunkCount: number;
    vectorCount: number;
    indexedCount: number;
    classification: 'suggested' | 'no-match' | 'skipped' | 'warning';
  };
}

export interface QuestionGenerationRun extends ContentRunBase {
  kind: 'question-generation';
  input: {
    loId: string;
    count: number;
    type: GenerationQuestionType;
    difficulty?: GenerationDifficulty;
    prompt?: string;
    blueprintId?: string;
    retryOfRunId?: string;
    models: { embedding: string; generator: string; validator: string; reviewer: string };
  };
  grounding?: { allowedMaterialIds: string[]; retrievedChunkCount: number };
  result?: {
    createdQuestionIds: string[];
    failures: Array<{ item: number; stage: string; code: string; message: string }>;
  };
}

export type ContentRunSummary = MaterialIngestRun | QuestionGenerationRun;

export interface ContentRunEvent {
  revision: number;
  at: string;
  type: 'status' | 'stage' | 'progress' | 'warning';
  status: ContentRunStatus;
  stage: string;
  completedUnits: number;
  totalUnits?: number;
  message?: string;
}

export type ContentRunSnapshot = ContentRunSummary & { events: ContentRunEvent[] };

/** GET /api/courses/:courseId/content-runs -> recent compact history. */
export function listContentRuns(
  courseId: string,
  filters: { kind?: ContentRunKind; status?: ContentRunStatus; limit?: number } = {},
): Promise<ContentRunSummary[]> {
  const query = new URLSearchParams();
  if (filters.kind) query.set('kind', filters.kind);
  if (filters.status) query.set('status', filters.status);
  if (filters.limit !== undefined) query.set('limit', String(filters.limit));
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return request<ContentRunSummary[]>(`/api/courses/${encodeURIComponent(courseId)}/content-runs${suffix}`);
}

/** GET one full durable snapshot, including its bounded event history. */
export function getContentRun(courseId: string, runId: string): Promise<ContentRunSnapshot> {
  return request<ContentRunSnapshot>(
    `/api/courses/${encodeURIComponent(courseId)}/content-runs/${encodeURIComponent(runId)}`,
  );
}

export function retryContentRun(courseId: string, runId: string): Promise<{ runId: string }> {
  return request<{ runId: string }>(
    `/api/courses/${encodeURIComponent(courseId)}/content-runs/${encodeURIComponent(runId)}/retry`,
    { method: 'POST' },
  );
}

export interface GenerationBlueprint {
  _id: string;
  courseId: string;
  name: string;
  loId: string;
  count: number;
  type: GenerationQuestionType;
  difficulty?: GenerationDifficulty;
  prompt?: string;
  materialIds?: string[];
  models: { embedding: string; generator: string; validator: string; reviewer: string };
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lastRunId?: string;
}

export interface GenerationBlueprintInput {
  name: string;
  loId: string;
  count: number;
  type: GenerationQuestionType;
  difficulty?: GenerationDifficulty;
  prompt?: string;
  materialIds?: string[];
}

export function listGenerationBlueprints(courseId: string): Promise<GenerationBlueprint[]> {
  return request<GenerationBlueprint[]>(
    `/api/courses/${encodeURIComponent(courseId)}/generation-blueprints`,
  );
}

export function createGenerationBlueprint(
  courseId: string,
  input: GenerationBlueprintInput,
): Promise<GenerationBlueprint> {
  return request<GenerationBlueprint>(
    `/api/courses/${encodeURIComponent(courseId)}/generation-blueprints`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}

export function runGenerationBlueprint(
  courseId: string,
  blueprintId: string,
): Promise<{ runId: string }> {
  return request<{ runId: string }>(
    `/api/courses/${encodeURIComponent(courseId)}/generation-blueprints/${encodeURIComponent(blueprintId)}/run`,
    { method: 'POST' },
  );
}

/** One EventSource per course. Every reconnect receives recent persisted runs. */
export function subscribeContentRuns(
  courseId: string,
  handlers: {
    onSnapshot: (runs: ContentRunSummary[]) => void;
    onRun: (run: ContentRunSummary) => void;
    onError?: () => void;
  },
): () => void {
  const source = new EventSource(`/api/courses/${encodeURIComponent(courseId)}/content-runs/events`);
  source.addEventListener('snapshot', (event) => {
    const data = JSON.parse((event as MessageEvent<string>).data) as { runs: ContentRunSummary[] };
    handlers.onSnapshot(data.runs);
  });
  source.addEventListener('run', (event) => {
    handlers.onRun(JSON.parse((event as MessageEvent<string>).data) as ContentRunSummary);
  });
  if (handlers.onError) source.addEventListener('error', handlers.onError);
  return () => source.close();
}

/** GET /api/courses/:courseId/materials -> [Material]. */
export function listMaterials(courseId: string): Promise<Material[]> {
  return request<Material[]>(`/api/courses/${encodeURIComponent(courseId)}/materials`);
}

export interface MaterialChunk {
  index: number;
  text: string;
  characterCount: number;
}

export interface MaterialWorkspaceDetail {
  material: Material;
  chunks: MaterialChunk[];
}

export function getMaterialWorkspaceDetail(courseId: string, materialId: string): Promise<MaterialWorkspaceDetail> {
  return request<MaterialWorkspaceDetail>(
    `/api/courses/${encodeURIComponent(courseId)}/materials/${encodeURIComponent(materialId)}/workspace`,
  );
}

export function materialSourceUrl(courseId: string, materialId: string): string {
  return `/api/courses/${encodeURIComponent(courseId)}/materials/${encodeURIComponent(materialId)}/source`;
}

export function listTrashedMaterials(courseId: string): Promise<Material[]> {
  return request<Material[]>(`/api/courses/${encodeURIComponent(courseId)}/materials-trash`);
}

export function trashMaterial(courseId: string, materialId: string): Promise<Material> {
  return request<Material>(
    `/api/courses/${encodeURIComponent(courseId)}/materials/${encodeURIComponent(materialId)}`,
    { method: 'DELETE' },
  );
}

export function restoreMaterial(courseId: string, materialId: string): Promise<Material> {
  return request<Material>(
    `/api/courses/${encodeURIComponent(courseId)}/materials/${encodeURIComponent(materialId)}/restore`,
    { method: 'POST' },
  );
}

/** POST /api/courses/:courseId/materials (multipart, field `files`) -> 201
 * [Material] (one per uploaded file, status 'processing'). */
export function uploadMaterials(courseId: string, files: File[]): Promise<Material[]> {
  const form = new FormData();
  for (const file of files) form.append('files', file);
  return request<Material[]>(`/api/courses/${encodeURIComponent(courseId)}/materials`, {
    method: 'POST',
    body: form,
  });
}

/** POST /api/courses/:courseId/materials { url } -> 201 [Material] (a single-
 * element array, status 'processing'). */
export function addUrlMaterial(courseId: string, url: string): Promise<Material[]> {
  return request<Material[]>(`/api/courses/${encodeURIComponent(courseId)}/materials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
}

/** POST /api/materials/:materialId/retry -> Material. */
export function retryMaterial(materialId: string): Promise<Material> {
  return request<Material>(`/api/materials/${encodeURIComponent(materialId)}/retry`, { method: 'POST' });
}

/** PUT /api/materials/:materialId/assignments { assignments } -> Material
 * (IN-S05; replaces the full assignments list). */
export function assignMaterial(materialId: string, assignments: MaterialAssignment[]): Promise<Material> {
  return request<Material>(`/api/materials/${encodeURIComponent(materialId)}/assignments`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignments }),
  });
}

export function updateMaterialKind(
  courseId: string,
  materialId: string,
  kind: MaterialKind,
): Promise<Material> {
  return request<Material>(
    `/api/courses/${encodeURIComponent(courseId)}/materials/${encodeURIComponent(materialId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind }),
    },
  );
}

export interface ContentMapMaterial {
  materialId: string;
  name: string;
  kind: MaterialKind;
  status: Material['status'];
  assessmentLike: boolean;
  latestRun?: { runId: string; status: ContentRunStatus; stage: string };
}

export interface ContentMapLo {
  loId: string;
  name: string;
  order: number;
  materials: ContentMapMaterial[];
  materialCounts: Partial<Record<MaterialKind, number>>;
  questionCounts: Record<PublicationState, number>;
  latestGenerationRun?: { runId: string; status: ContentRunStatus; stage: string };
  gaps: Array<'no-material' | 'no-approved-questions' | 'thin-approved-set'>;
}

export interface CourseContentMap {
  themes: Array<{ themeId: string; name: string; order: number; los: ContentMapLo[] }>;
  unassignedMaterials: ContentMapMaterial[];
}

export function getCourseContentMap(courseId: string): Promise<CourseContentMap> {
  return request<CourseContentMap>(`/api/courses/${encodeURIComponent(courseId)}/content-map`);
}

export type KnowledgeNodeType = 'material' | 'evidence' | 'concept' | 'topic' | 'lo' | 'question';

export interface KnowledgeGraphNode {
  id: string;
  type: KnowledgeNodeType;
  label: string;
  subtitle?: string;
  materialId?: string;
  confidence?: number;
  trashed?: boolean;
}

export interface KnowledgeGraphEdge {
  id: string;
  source: string;
  target: string;
  type: 'contains' | 'supports' | 'covers' | 'defines' | 'assesses' | 'sourced-from' | 'related-to';
  label?: string;
}

export interface CourseKnowledgeGraph {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  truncated: boolean;
}

export function getCourseKnowledgeGraph(courseId: string): Promise<CourseKnowledgeGraph> {
  return request<CourseKnowledgeGraph>(`/api/courses/${encodeURIComponent(courseId)}/knowledge-graph`);
}

/** POST /api/materials/:materialId/classification { action } -> Material
 * (IN-S06; 'accept' merges the suggestion into assignments and clears it,
 * 'reject' clears it). */
export function resolveClassification(materialId: string, action: 'accept' | 'reject'): Promise<Material> {
  return request<Material>(`/api/materials/${encodeURIComponent(materialId)}/classification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
}

export interface SuggestedHierarchy {
  themes: Array<{ name: string; los: string[] }>;
  assignments: Array<{
    themeIndex: number;
    loIndex: number;
    materialIds: string[];
  }>;
}

/** GET /api/courses/:courseId/suggest-hierarchy returns a read-only
 * AI-suggested Topic/LO outline plus source-material mappings. */
export function getSuggestedHierarchy(courseId: string): Promise<SuggestedHierarchy> {
  return request<SuggestedHierarchy>(`/api/courses/${encodeURIComponent(courseId)}/suggest-hierarchy`);
}

export interface SuggestedHierarchyApplyInput {
  themes: Array<{
    name: string;
    los: Array<{ name: string; materialIds: string[] }>;
  }>;
}

export interface SuggestedHierarchyApplyResult {
  themesCreated: number;
  losCreated: number;
  materialsAssigned: number;
  assignmentsCreated: number;
}

/** Apply a reviewed AI hierarchy and automatically assign its source materials
 * to the newly created LOs while preserving existing assignments. */
export function applySuggestedHierarchy(
  courseId: string,
  input: SuggestedHierarchyApplyInput,
): Promise<SuggestedHierarchyApplyResult> {
  return request<SuggestedHierarchyApplyResult>(
    `/api/courses/${encodeURIComponent(courseId)}/apply-suggested-hierarchy`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}

// --- Instructor: pre-seeding coverage (IN-Q10) --------------------------------
//
// Added in Task C (consumed by the Course Dashboard's pre-publish checklist —
// "Minimum 3 approved questions per LO" — and the Structure editor's LO detail
// "Approved" stat, per the plan's Task G signature). Task G reuses
// `getPreseeding` for the full coverage view + generation rather than
// re-adding it.

export interface PreseedingLo {
  loId: string;
  loName: string;
  approved: number;
  reviewed: number;
  /** Draft + Pending review + Reviewed + Paused question heads. Archived and
   * Approved questions are intentionally excluded. */
  unapproved: number;
  target: number;
}

/** GET /api/courses/:courseId/preseeding -> per-LO approved-question coverage. */
export function getPreseeding(courseId: string): Promise<PreseedingLo[]> {
  return request<PreseedingLo[]>(`/api/courses/${encodeURIComponent(courseId)}/preseeding`);
}

// --- Instructor: question generation (IN-Q10) ---------------------------------
//
// Added in Task G. Verified against server/src/routes/generation.routes.ts's
// `generateBody` zod schema: `count` is an optional int 1-20 (server defaults
// to 3 when omitted), `type`/`difficulty` are optional enums, `prompt` is an
// optional string up to 2000 chars (plain text — @mentions of materials are
// just characters in this field, there is no separate material-reference
// param). The route responds 202 with a unique durable `runId`; progress is
// delivered through the course content-run stream and results land as Drafts.

export type GenerationQuestionType = 'mcq' | 'true-false';
export type GenerationDifficulty = 'easy' | 'medium' | 'hard';

export interface GenerateQuestionsInput {
  loId: string;
  count?: number;
  type?: GenerationQuestionType;
  difficulty?: GenerationDifficulty;
  prompt?: string;
}

export interface GenerationPreset {
  label: string;
  text: string;
}

/** GET /api/generation/presets -> four editable instructor prompt starters. */
export function getGenerationPresets(): Promise<GenerationPreset[]> {
  return request<GenerationPreset[]>('/api/generation/presets');
}

/** POST /api/courses/:courseId/generate { loId, count?, type?, difficulty?,
 * prompt? } -> 202 { runId }. Enqueues the async three-agent generation
 * pipeline for one LO. */
export function generateQuestions(courseId: string, input: GenerateQuestionsInput): Promise<{ runId: string }> {
  return request<{ runId: string }>(`/api/courses/${encodeURIComponent(courseId)}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export interface RegenerationVariant {
  stem: string;
  options: QuestionOption[];
  difficulty: Difficulty;
  numericKind?: 'numeric' | 'conceptual';
  paramSlots?: ParamSlotInput[];
  derivedValues?: DerivedValueInput[];
  verification?: { evaluatorVersion: number; sampleSeeds: number[]; verifiedAt: string };
  sourceRefs: Array<{ materialId: string; chunk?: string }>;
  agentDecision: {
    decision: 'pass' | 'flag' | 'reject';
    reasoning: string;
    roleAssessment: string;
  };
}

/** Generate a transient alternative. It is not saved until editQuestion is
 * explicitly called with the returned content. */
export function regenerateQuestion(
  courseId: string,
  questionId: string,
  prompt: string,
): Promise<{ variant: RegenerationVariant }> {
  return request<{ variant: RegenerationVariant }>(
    `/api/courses/${encodeURIComponent(courseId)}/questions/${encodeURIComponent(questionId)}/regenerate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    },
  );
}

// --- Instructor: question import (IN-Q01) -----------------------------------

export type ImportFormat = 'csv' | 'json' | 'qti';

export interface ImportCandidate {
  type: QuestionType | 'other';
  stem: string;
  options: Array<{
    key: string;
    text: string;
    role?: OptionRole;
    explanation?: string;
  }>;
  correctKey: string;
  difficulty?: Difficulty;
  parameterizable: boolean;
}

export interface ImportPreview {
  format: ImportFormat;
  candidates: ImportCandidate[];
  failures: Array<{ line: number | string; reason: string }>;
}

/** Multipart upload -> parsed preview. No questions are written. */
export function previewQuestionImport(courseId: string, file: File): Promise<ImportPreview> {
  const form = new FormData();
  form.append('file', file);
  return request<ImportPreview>(
    `/api/courses/${encodeURIComponent(courseId)}/import/preview`,
    { method: 'POST', body: form },
  );
}

/** Confirm a preview -> Draft questions. The server revalidates every row. */
export function commitQuestionImport(
  courseId: string,
  input: {
    candidates: ImportCandidate[];
    format?: ImportFormat;
    sourceName?: string;
    themeId?: string;
    loId?: string;
  },
): Promise<{ imported: number; autoConverted: number }> {
  return request<{ imported: number; autoConverted: number }>(
    `/api/courses/${encodeURIComponent(courseId)}/import/commit`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}

export interface ScriptMigrationInput {
  type: QuestionType;
  stem: string;
  options: Array<{
    key: string;
    text: string;
    explanation?: string;
  }>;
  correctKey: string;
  difficulty?: Difficulty;
  script: string;
  sourceName?: string;
}

export interface ScriptMigrationResult {
  questionId?: string;
  sampleValues: Record<string, number>;
  sampleStem: string;
  sampleOptions: Array<{
    key: string;
    text: string;
    explanation: string;
  }>;
  mismatches: string[];
}

/** Runs one deterministic sandbox sample. Nothing is written. */
export function previewScriptMigration(
  courseId: string,
  input: ScriptMigrationInput,
): Promise<ScriptMigrationResult> {
  return request<ScriptMigrationResult>(
    `/api/courses/${encodeURIComponent(courseId)}/import/script/preview`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}

/** Revalidates the reviewed script and creates one parameterized Draft. */
export function commitScriptMigration(
  courseId: string,
  input: ScriptMigrationInput & { themeId?: string; loId?: string },
): Promise<ScriptMigrationResult> {
  return request<ScriptMigrationResult>(
    `/api/courses/${encodeURIComponent(courseId)}/import/script/commit`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}

// --- Instructor: question bank (IN-Q02/Q03/Q04/Q05/Q07/Q08) ------------------
//
// Added in Task E. Verified against server/src/routes/questions.routes.ts +
// services/bank.service.ts + services/questions.service.ts + types/domain.ts
// (docs/api-contract.md's "Question bank" section matches these routes
// exactly — no drift to correct here, unlike Task A's course-hierarchy slice).
//
// CRITICAL serialization rule (Task-15 Task E brief): Question HEADS
// serialize with `id` — questions.routes.ts's toBankItem()/toQuestionResponse()
// both strip the Mongo `_id` and add `id`. The embedded `current`
// QuestionVersion — and the bare QuestionVersion the PATCH endpoint returns —
// serialize RAW, keeping their own `_id`. These are two different ids (a
// question id vs. its current version's id); do not conflate them or assume
// both come back as `id`.
//
// `includeArchived` is deliberately NOT a query param on the wire
// (questions.routes.ts's browseQuery omits it to match the contract exactly)
// — pass `state: 'archived'` to reach archived questions instead; browseBank's
// server-side `includeArchived` filter field is not reachable from here.

export type QuestionType = 'mcq' | 'true-false';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type PublicationState = 'draft' | 'pending-review' | 'reviewed' | 'approved' | 'paused' | 'archived';
export type QuestionLabel =
  | 'source-changed'
  | 'student-flagged'
  | 'convertible-to-parameterized'
  | 'auto-converted'
  | 'manually-edited';

export interface QuestionOption {
  key: string;
  text: string;
  role: OptionRole;
  explanation: string;
}

/** A QuestionVersion exactly as it comes over the wire — raw `_id`, never `id`. */
export interface QuestionVersion {
  _id: string;
  questionId: string;
  version: number;
  type: QuestionType;
  stem: string;
  options: QuestionOption[];
  difficulty: Difficulty;
  paramSlots?: Array<{ name: string; description?: string; min?: number; max?: number; step?: number; values?: number[] }>;
  generateScript?: string;
  /** Values COMPUTED from the slots — the correct answer and every distractor
   * of a numerical question. */
  derivedValues?: Array<{ name: string; formula: string; errorModel?: string }>;
  /** The generator's declaration. It does not bypass independent detection. */
  numericKind?: 'numeric' | 'conceptual';
  /** Machine-checked proof that the computed values are sound across sampled
   * draws. ABSENT on a numerical question means it never serves to a student
   * (see the numeric gate). */
  verification?: { evaluatorVersion: number; sampleSeeds: number[]; verifiedAt: string };
  sourceRefs: Array<{ materialId: string; chunk?: string }>;
  provenance?:
    | { kind: 'manual' }
    | { kind: 'generated'; runId: string; blueprintId?: string; item: number }
    | { kind: 'imported'; format: ImportFormat; sourceName?: string; item: number }
    | { kind: 'script-migration'; sourceName?: string }
    | { kind: 'edited'; parentVersionId: string };
  /** Content keys patched in the edit that created this version (per-edit, not
   * cumulative) — absent on v1. */
  editedFields?: string[];
  createdBy: string;
  createdAt: string;
}

/** A question head exactly as it comes over the wire — `id`, never `_id`. */
export interface QuestionHead {
  id: string;
  courseId: string;
  currentVersionId: string;
  currentVersion: number;
  state: PublicationState;
  loIds: string[];
  themeIds: string[];
  templateFamilyId?: string;
  labels: QuestionLabel[];
  agentDecision?: { decision: 'pass' | 'flag' | 'reject'; reasoning: string; roleAssessment: string };
  generationPrompt?: string;
  regenerations?: Array<{ prompt: string; at: string }>;
  internalNotes: Array<{ puid: string; text: string; at: string }>;
  suggestions?: QuestionSuggestion[];
  createdAt: string;
  updatedAt: string;
}

/** A bank-list row: the contract's trimmed head shape (`id`, `state`,
 * `labels`, `loIds`, `themeIds`) plus its joined `current` version — NOT the
 * full `QuestionHead` (no `agentDecision`/`internalNotes`; those are reserved
 * for the single-question `getQuestion`). */
export interface BankQuestion {
  id: string;
  state: PublicationState;
  labels: QuestionLabel[];
  loIds: string[];
  themeIds: string[];
  current: QuestionVersion;
}

/** GET /api/questions/:questionId's full shape: the head plus its `current`
 * version and lightweight version-history metadata. */
export interface QuestionDetail extends QuestionHead {
  current: QuestionVersion;
  versions: Array<{
    version: number;
    createdBy: string;
    createdAt: string;
    editedFields?: string[];
    provenance?: QuestionVersion['provenance'];
  }>;
}

export interface BankFilters {
  state?: PublicationState;
  loId?: string;
  themeId?: string;
  type?: QuestionType;
  difficulty?: Difficulty;
  label?: QuestionLabel;
}

/** Pure filter -> querystring builder (`?state=&loId=&themeId=&type=&difficulty=&label=`),
 * matching `GET /api/courses/:courseId/questions`'s exact query surface.
 * `includeArchived` is intentionally not a key here (see the module note
 * above) — pass `state: 'archived'` instead. Omits any filter that's absent;
 * returns `''` (no leading `?`) when every filter is absent. */
export function bankFiltersToQuery(filters: BankFilters): string {
  const params = new URLSearchParams();
  if (filters.state) params.set('state', filters.state);
  if (filters.loId) params.set('loId', filters.loId);
  if (filters.themeId) params.set('themeId', filters.themeId);
  if (filters.type) params.set('type', filters.type);
  if (filters.difficulty) params.set('difficulty', filters.difficulty);
  if (filters.label) params.set('label', filters.label);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** GET /api/courses/:courseId/questions?state=&loId=&themeId=&type=&difficulty=&label=
 * -> { total, questions }. Instructor-only. (IN-Q08) */
export function browseBank(
  courseId: string,
  filters: BankFilters = {},
): Promise<{ total: number; questions: BankQuestion[] }> {
  return request<{ total: number; questions: BankQuestion[] }>(
    `/api/courses/${encodeURIComponent(courseId)}/questions${bankFiltersToQuery(filters)}`,
  );
}

/** GET /api/questions/:questionId -> full head + current version + agentDecision
 * + internalNotes + versions. Instructor-only. */
export function getQuestion(questionId: string): Promise<QuestionDetail> {
  return request<QuestionDetail>(`/api/questions/${encodeURIComponent(questionId)}`);
}

/** PATCH /api/questions/:questionId { stem?, options?, difficulty?, loIds?, themeIds? }
 * -> the new current QuestionVersion (IN-Q03). A patch with no content key
 * (stem/options/difficulty) — e.g. a loIds/themeIds-only retag — does not
 * version; the server returns the unchanged current QuestionVersion in that
 * case (see questions.service.ts's editQuestion doc comment). */
export function editQuestion(
  questionId: string,
  patch: {
    stem?: string;
    options?: QuestionOption[];
    difficulty?: Difficulty;
    paramSlots?: ParamSlotInput[];
    derivedValues?: DerivedValueInput[];
    numericKind?: 'numeric' | 'conceptual';
    loIds?: string[];
    themeIds?: string[];
  },
): Promise<QuestionVersion> {
  return request<QuestionVersion>(`/api/questions/${encodeURIComponent(questionId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export function addQuestionInternalNote(
  questionId: string,
  text: string,
): Promise<{ puid: string; text: string; at: string }> {
  return request<{ puid: string; text: string; at: string }>(
    `/api/questions/${encodeURIComponent(questionId)}/internal-notes`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    },
  );
}

/** POST /api/questions/:questionId/transition { to, expectedVersionId? } -> the
 * updated question head (validated against PUBLICATION_TRANSITIONS; 409 on an
 * invalid move or a stale expected version). Omitting expectedVersionId keeps
 * the existing state-only transition behavior. Instructor-only. (IN-Q04/Q07) */
export function transitionQuestion(
  questionId: string,
  to: PublicationState,
  expectedVersionId?: string,
): Promise<QuestionHead> {
  return request<QuestionHead>(`/api/questions/${encodeURIComponent(questionId)}/transition`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to,
      ...(expectedVersionId !== undefined ? { expectedVersionId } : {}),
    }),
  });
}

/** POST /api/questions/bulk-transition { questionIds, to } -> { updated }.
 * Instructor-only, scoped to the single course the batch resolves to. Added
 * here for Task E's Archive action; Task F's Review Queue bulk-approve reuses
 * this same function. */
export function bulkTransition(questionIds: string[], to: PublicationState): Promise<{ updated: number }> {
  return request<{ updated: number }>('/api/questions/bulk-transition', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questionIds, to }),
  });
}

// --- Instructor: parameterization config (Task 5, IN-Q09) ------------------

export interface ParamSlotInput {
  name: string;
  /** Instructor-facing label shown in the Description column. */
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  values?: number[];
}

/** A value COMPUTED from the slots — the correct answer and every distractor
 * of a numerical question. `errorModel` names the specific mistake a
 * distractor represents. */
export interface DerivedValueInput {
  name: string;
  formula: string;
  errorModel?: string;
}

/** The saved version, plus the outcome of the verification the server runs on
 * every save. `verificationError` present means the question is NOT servable —
 * the numeric gate refuses a numerical question with no proof. */
export type ParamsSaveResult = QuestionVersion & {
  verification?: { evaluatorVersion: number; sampleSeeds: number[]; verifiedAt: string };
  verificationError?: string;
};

/** PATCH /api/questions/:questionId/params
 * { paramSlots?, derivedValues?, numericKind?, generateScript? }
 * -> the new/unchanged current QuestionVersion (same versioning rules as
 * `editQuestion` — saves independently of approval state, IN-Q09), plus
 * `verification` on success or `verificationError` on failure.
 * Instructor-only. */
export function patchQuestionParams(
  questionId: string,
  patch: {
    paramSlots?: ParamSlotInput[];
    derivedValues?: DerivedValueInput[];
    numericKind?: 'numeric' | 'conceptual';
    generateScript?: string;
  },
): Promise<ParamsSaveResult> {
  return request<ParamsSaveResult>(`/api/questions/${encodeURIComponent(questionId)}/params`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

/** One sample rendering of a saved parameterized question — what a student
 * would actually see, as opposed to the raw {{placeholder}} template the
 * instructor edits. */
export interface QuestionSample {
  seed: number;
  stem: string;
  options: Array<{ key: string; text: string }>;
  /** False when the question has no slots or derived values, so the sample is
   * just the stored text and showing an example adds nothing. */
  parameterized: boolean;
}

/** GET /api/questions/:questionId/sample -> one sample draw of the SAVED
 * version. Read-only; persists nothing. Substitution happens server-side so
 * the example can never drift from the real serve path. */
export function getQuestionSample(questionId: string): Promise<QuestionSample> {
  return request<QuestionSample>(`/api/questions/${encodeURIComponent(questionId)}/sample`);
}

export interface ParamPreviewDraw {
  seed: number;
  values: Record<string, number>;
  /** Present only when the request body included `stem`. */
  stem?: string;
}

export interface ParamPreviewResult {
  draws: ParamPreviewDraw[];
  /** Defined paramSlots with no matching {{placeholder}} in the stem. */
  warnings: string[];
}

/** POST /api/questions/:questionId/params/preview { paramSlots?, generateScript?, stem? }
 * -> 5 independently-drawn sample resolutions of an EDIT-IN-PROGRESS
 * candidate (never the currently-saved version) — never persists anything.
 * Instructor-only. */
export function previewQuestionParams(
  questionId: string,
  candidate: { paramSlots?: ParamSlotInput[]; generateScript?: string; stem?: string },
): Promise<ParamPreviewResult> {
  return request<ParamPreviewResult>(`/api/questions/${encodeURIComponent(questionId)}/params/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(candidate),
  });
}

// --- Instructor: review queue (IN-Q02) — Task F -----------------------------
//
// Verified against server/src/routes/questions.routes.ts:242-251 +
// services/bank.service.ts's reviewQueue(). The route does
// `queue.map((item) => ({ ...toBankItem(item), priority: item.priority }))`
// — i.e. exactly the `BankQuestion` shape (see the Task E note above:
// `toBankItem` deliberately omits `agentDecision`/`internalNotes`, reserving
// them for the single-question `getQuestion`) plus one extra field,
// `priority` (1 = student-flagged, 2 = `state === 'reviewed'`, 3 = the rest,
// ranked by LO under-coverage — see reviewQueue()'s doc comment). This type
// intentionally does NOT carry `agentDecision`: the review-queue endpoint
// never returns it, and review-queue.ts's per-row Agent Decision badge / tab
// filters fetch it for real via `getQuestion` rather than fabricate it.

export interface ReviewQueueItem extends BankQuestion {
  priority: number;
}

/** GET /api/courses/:courseId/review-queue -> prioritized list (IN-Q02).
 * Instructor-only. */
export function getReviewQueue(courseId: string): Promise<ReviewQueueItem[]> {
  return request<ReviewQueueItem[]>(`/api/courses/${encodeURIComponent(courseId)}/review-queue`);
}

// --- Phase 3: Teaching Assistants ------------------------------------------

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

export interface TaInvite {
  _id: string;
  courseId: string;
  email: string;
  status: 'pending' | 'active' | 'expired';
  invitedAt: string;
  updatedAt: string;
  activatedPuid?: string;
  displayName?: string;
  permissions?: Partial<Record<Capability, boolean>>;
}

export interface QuestionSuggestion {
  id: string;
  puid: string;
  patch: Partial<Pick<QuestionDetail, 'loIds' | 'themeIds'>> & {
    stem?: string;
    options?: QuestionOption[];
    difficulty?: Difficulty;
  };
  status: 'pending' | 'accepted' | 'discarded';
  at: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

export interface TaReviewQueueItem extends ReviewQueueItem {
  suggestions: QuestionSuggestion[];
  internalNotes: Array<{ puid: string; text: string; at: string }>;
}

export function listTas(courseId: string): Promise<TaInvite[]> {
  return request<TaInvite[]>(`/api/courses/${encodeURIComponent(courseId)}/tas`);
}

export function inviteTa(courseId: string, email: string): Promise<TaInvite> {
  return request<TaInvite>(`/api/courses/${encodeURIComponent(courseId)}/tas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

export function updateTaPermissions(
  courseId: string,
  puid: string,
  permissions: Partial<Record<Capability, boolean>>,
): Promise<void> {
  return request<void>(
    `/api/courses/${encodeURIComponent(courseId)}/tas/${encodeURIComponent(puid)}/permissions`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions }),
    },
  );
}

export function reinviteTa(courseId: string, puid: string): Promise<TaInvite> {
  return request<TaInvite>(
    `/api/courses/${encodeURIComponent(courseId)}/tas/${encodeURIComponent(puid)}/reinvite`,
    { method: 'POST' },
  );
}

export function getTaReviewQueue(courseId: string): Promise<TaReviewQueueItem[]> {
  return request<TaReviewQueueItem[]>(
    `/api/courses/${encodeURIComponent(courseId)}/ta/review-queue`,
  );
}

export function markTaQuestionReviewed(questionId: string): Promise<QuestionHead> {
  return request<QuestionHead>(`/api/questions/${encodeURIComponent(questionId)}/mark-reviewed`, {
    method: 'POST',
  });
}

export function suggestTaQuestionEdit(
  questionId: string,
  patch: QuestionSuggestion['patch'],
): Promise<QuestionSuggestion> {
  return request<QuestionSuggestion>(`/api/questions/${encodeURIComponent(questionId)}/suggestions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export function resolveTaQuestionSuggestion(
  questionId: string,
  suggestionId: string,
  action: 'accept' | 'discard',
): Promise<void> {
  return request<void>(
    `/api/questions/${encodeURIComponent(questionId)}/suggestions/${encodeURIComponent(suggestionId)}/${action}`,
    { method: 'POST' },
  );
}

export function addTaQuestionNote(
  questionId: string,
  text: string,
): Promise<{ puid: string; text: string; at: string }> {
  return request<{ puid: string; text: string; at: string }>(
    `/api/questions/${encodeURIComponent(questionId)}/notes`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    },
  );
}

export function listTaFlags(courseId: string): Promise<Flag[]> {
  return request<Flag[]>(`/api/courses/${encodeURIComponent(courseId)}/ta/flags`);
}

export function escalateTaFlag(
  flagId: string,
  recommendation: 'correct' | 'archive' | 'clear',
  note?: string,
): Promise<Flag> {
  return request<Flag>(`/api/flags/${encodeURIComponent(flagId)}/escalate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recommendation, note }),
  });
}

// `proactivelyEscalateTaQuestion` (POST /api/questions/:id/escalate) was
// removed: a TA escalates a FLAG from flag triage, not a bare question. The
// server route still exists (see docs/api-contract.md) but nothing calls it.

// --- Phase 3: Instructor analytics -----------------------------------------

export interface AnalyticsRate {
  attempts: number;
  insufficient: boolean;
  failureRate?: number;
}

export interface ThemeFailureRate extends AnalyticsRate {
  themeId: string;
  name: string;
  los: Array<AnalyticsRate & { loId: string; name: string }>;
}

export interface AnswerDistribution {
  attempts: number;
  insufficient: boolean;
  options: Array<{ key: string; role: string; count: number; pct?: number }>;
  misconceptionHighlight: boolean;
}

export interface EngagementAnalytics {
  totals: {
    questionsAttempted: number;
    avgSessionMinutes: number;
    sessionsPerStudent: number;
    loCoverageRate: number;
    reviewBookActivityRate: number;
  };
  weeks: Array<{
    week: string;
    questionsAttempted: number;
    sessions: number;
    activeStudents: number;
    avgSessionMinutes: number;
    loCoverageRate: number;
    reviewBookActivityRate: number;
  }>;
}

export interface AnalyticsStudent {
  puid: string;
  uid: string;
  displayName: string;
  email: string;
  lastAttemptAt?: string;
  inactiveDays?: number;
}

export interface StudentAnalyticsProfile {
  student: AnalyticsStudent;
  history: Array<{ _id: string; mode: string; correct: boolean; createdAt: string; loId: string; themeId: string }>;
  mastery: Array<{ loId: string; status: string; attemptCount: number; windowAccuracy: number; examVerified?: boolean; rationale?: string }>;
  reviewBook: Array<{ _id: string; questionId: string; updatedAt: string }>;
  flags: Array<{ _id: string; questionId: string; state: string; reason?: string; createdAt: string }>;
  engagement: { attempts: number; sessions: number; lastAttemptAt?: string; examPrepAttempts: number; topicPracticeAttempts: number };
}

export function getFailureRates(courseId: string, mode: 'topic-practice' | 'exam-prep'): Promise<ThemeFailureRate[]> {
  return request<ThemeFailureRate[]>(
    `/api/courses/${encodeURIComponent(courseId)}/analytics/failure-rates?mode=${encodeURIComponent(mode)}`,
  );
}

export function getAnswerDistribution(courseId: string, questionId: string): Promise<AnswerDistribution> {
  return request<AnswerDistribution>(
    `/api/courses/${encodeURIComponent(courseId)}/analytics/questions/${encodeURIComponent(questionId)}/distribution`,
  );
}

export function getEngagementAnalytics(courseId: string): Promise<EngagementAnalytics> {
  return request<EngagementAnalytics>(`/api/courses/${encodeURIComponent(courseId)}/analytics/engagement`);
}

export function getLowEngagement(courseId: string, inactiveDays = 7): Promise<AnalyticsStudent[]> {
  return request<AnalyticsStudent[]>(
    `/api/courses/${encodeURIComponent(courseId)}/analytics/low-engagement?inactiveDays=${inactiveDays}`,
  );
}

export function searchAnalyticsStudents(courseId: string, query: string): Promise<AnalyticsStudent[]> {
  return request<AnalyticsStudent[]>(
    `/api/courses/${encodeURIComponent(courseId)}/students?q=${encodeURIComponent(query)}`,
  );
}

export function getStudentAnalytics(courseId: string, puid: string): Promise<StudentAnalyticsProfile> {
  return request<StudentAnalyticsProfile>(
    `/api/courses/${encodeURIComponent(courseId)}/students/${encodeURIComponent(puid)}/analytics`,
  );
}

// --- Instructor: flag-resolution queue (ST-P09, §6.2) — Task 2 --------------
//
// Verified against server/src/routes/flags.routes.ts + services/flags.service.ts
// (Task 1, this branch). `toFlagResponse` remaps the top-level flag's `_id` ->
// `id` (same convention as `toQuestionResponse`), but `listFlags`'s joined
// `question`/`currentVersion` are passed straight through as raw Mongo
// documents — NOT re-mapped, so they keep `_id` (see `QuestionVersion` above,
// which does the same for the same reason). Both join shapes are trimmed here
// to the fields flags.ts actually renders (stem/type/options via
// `currentVersion`, state/loIds/themeIds via `question`) — same trimming
// convention as `BankQuestion` vs. the full `QuestionHead`.

export type FlagState = 'open' | 'escalated' | 'resolved-corrected' | 'resolved-archived' | 'resolved-cleared';

export interface FlagQuestionJoin {
  _id: string;
  courseId: string;
  currentVersionId: string;
  state: PublicationState;
  loIds: string[];
  themeIds: string[];
  labels: QuestionLabel[];
}

export interface FlagVersionJoin {
  _id: string;
  questionId: string;
  version: number;
  type: QuestionType;
  stem: string;
  options: QuestionOption[];
  difficulty: Difficulty;
}

/** §6.2 step 1 remediation report (Task 6) — the "blast radius" of a
 * correctness-affecting flag resolution. Matches
 * server/src/services/remediation.service.ts's `RemediationReport` exactly:
 * four fields, no mastery count (that step is manual-checklist text only —
 * see flags.ts's rendering of it). */
export interface RemediationReport {
  affectedAttempts: number;
  affectedStudents: string[];
  reviewBookEntries: number;
  examAttempts: number;
}

export interface TaRecommendation {
  recommendation: 'correct' | 'archive' | 'clear';
  note?: string;
  puid: string;
  at: string;
}

export interface Flag {
  id: string;
  courseId: string;
  questionId: string;
  questionVersionId: string; // the version this flag was raised against (§6.2) — may differ from question.currentVersionId after a later edit
  puid: string;
  source?: 'student' | 'instructor-preview-test' | 'ta';
  raisedBy?: 'student' | 'ta';
  /** Set by `POST /api/flags/:flagId/escalate` (tas.service.ts's
   * `escalateFlag`). Present on every `listFlags`/`listTaFlags` row for an
   * escalated flag — the server has always sent it; this type omitted it,
   * which is why the instructor queue never showed it. */
  taRecommendation?: TaRecommendation;
  reason?: string;
  state: FlagState;
  // `correctnessAffecting` (Task 6 review fix): persisted on the resolution
  // sub-document so the remediation panel can tell whether THIS flag's
  // resolution should still show the checklist after a reload — see
  // server/src/types/domain.ts's `Flag.resolution` and flags.ts's
  // `groupHasCorrectnessAffectingResolution`.
  // `notifiedAt`/`notifiedCount` (Task 6 re-review, Finding B): persisted the
  // same way, so the "Notify affected students" button's already-notified
  // state survives a reload too — see flags.service.ts's `notifyRemediation`.
  resolution?: {
    action: 'correct' | 'archive' | 'clear';
    puid: string;
    at: string;
    comment?: string;
    correctnessAffecting?: boolean;
    notifiedAt?: string;
    notifiedCount?: number;
  };
  createdAt: string;
  question: FlagQuestionJoin | null;
  currentVersion: FlagVersionJoin | null;
  // Present only on the response to a correctness-affecting resolve (Task 6,
  // resolved ambiguity #3) — never on listCourseFlags' rows.
  remediation?: RemediationReport;
}

/** GET /api/courses/:courseId/flags?state= -> flags joined with question +
 * current version (`listFlags`). Instructor-only. `state` omitted fetches
 * every flag state for the course — flags.ts always calls it this way and
 * groups/filters open-vs-resolved client-side (see its module note). */
export function listCourseFlags(courseId: string, state?: FlagState): Promise<Flag[]> {
  const qs = state ? `?state=${encodeURIComponent(state)}` : '';
  return request<Flag[]>(`/api/courses/${encodeURIComponent(courseId)}/flags${qs}`);
}

/** POST /api/flags/:flagId/resolve { action, correctnessAffecting? } -> the
 * resolved Flag. Instructor-only; the server resolves courseId from the flag
 * itself, so no courseId is needed here. */
export function resolveFlag(
  flagId: string,
  action: 'correct' | 'archive' | 'clear',
  correctnessAffecting?: boolean,
  comment?: string,
): Promise<Flag> {
  const normalizedComment = comment?.trim();
  return request<Flag>(`/api/flags/${encodeURIComponent(flagId)}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action,
      ...(correctnessAffecting !== undefined ? { correctnessAffecting } : {}),
      ...(normalizedComment ? { comment: normalizedComment } : {}),
    }),
  });
}

/** POST /api/flags/:flagId/remediation/notify -> { notified: number }.
 * Instructor-only; explicit "Notify affected students" action from the §6.2
 * remediation checklist (Task 6). No body. */
export function notifyRemediation(flagId: string): Promise<{ notified: number }> {
  return request<{ notified: number }>(`/api/flags/${encodeURIComponent(flagId)}/remediation/notify`, {
    method: 'POST',
  });
}

/** GET /api/flags/:flagId/remediation -> RemediationReport. Instructor-only;
 * Task 6 review fix (Finding 3) — regenerates the report from the flag's
 * questionVersionId so the checklist panel's blast-radius numbers survive a
 * reload (flags are terminal, so the resolve response's one-shot
 * `remediation` field can't be refetched any other way). */
export function getRemediationReport(flagId: string): Promise<RemediationReport> {
  return request<RemediationReport>(`/api/flags/${encodeURIComponent(flagId)}/remediation`);
}

// --- Notifications (§4.3, §9.1) — Task 3 -------------------------------------
// Verified against server/src/routes/notifications.routes.ts +
// services/notifications.service.ts (this branch). Every route is scoped to
// the signed-in user's own notifications; there is no courseId parameter.

export type NotificationKind =
  | 'flag'
  | 'auto-pause'
  | 'daily-summary'
  | 'flag-resolved'
  | 'correction'
  | 'review-backlog'
  | 'redirect';

export interface AppNotification {
  id: string;
  recipientPuid: string;
  courseId?: string;
  kind: NotificationKind;
  priority: 'standard' | 'elevated';
  body: string;
  refType?: string;
  refId?: string;
  readAt?: string;
  /** Set once the recipient dismisses this notification (click or "Clear all").
   * Returned by the dismiss endpoints; never present on the bell's poll list,
   * which filters dismissed documents out server-side. */
  dismissedAt?: string;
  createdAt: string;
}

/** GET /api/notifications?unreadOnly= -> newest-first, limit 50. Bell poll target. */
export function listNotifications(unreadOnly?: boolean): Promise<AppNotification[]> {
  const qs = unreadOnly ? '?unreadOnly=true' : '';
  return request<AppNotification[]>(`/api/notifications${qs}`);
}

/** POST /api/notifications/:id/read -> the updated notification. */
export function markNotificationRead(id: string): Promise<AppNotification> {
  return request<AppNotification>(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
}

/** POST /api/notifications/read-all -> { count }. */
export function markAllNotificationsRead(): Promise<{ count: number }> {
  return request<{ count: number }>('/api/notifications/read-all', { method: 'POST' });
}

/** POST /api/notifications/:id/dismiss -> the updated notification. Clicking
 * a notification in the bell dismisses it for good. */
export function dismissNotification(id: string): Promise<AppNotification> {
  return request<AppNotification>(`/api/notifications/${encodeURIComponent(id)}/dismiss`, { method: 'POST' });
}

/** POST /api/notifications/dismiss-all -> { count }. "Clear all". */
export function dismissAllNotifications(): Promise<{ count: number }> {
  return request<{ count: number }>('/api/notifications/dismiss-all', { method: 'POST' });
}
