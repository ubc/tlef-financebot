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
    };
  };
  mastery: { loStatus: MasteryStatus; recommendation?: 'advance-lo' | 'advance-theme' };
  reviewBook: { added: boolean };
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
