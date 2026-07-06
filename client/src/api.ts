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
  nameId: string;
  attributes: Record<string, unknown>;
}

export interface AuthState {
  authenticated: boolean;
  user: AuthUser | null;
  /** Server-derived roles (from eduPersonAffiliation), e.g. ['faculty']. */
  roles: string[];
}

export function getAuthState(): Promise<AuthState> {
  return request<AuthState>('/api/auth/me');
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
  nameId: string;
  attributes: Record<string, unknown>;
  serverTime: string;
}

export function getMembersOverview(): Promise<MembersOverview> {
  return request<MembersOverview>('/api/members/overview');
}

// --- Academic record (Academic API lookup, auth-gated) -----------------------

export interface AcademicCourse {
  courseSectionId: string;
  subject: string;
  courseNumber: string;
  sectionNumber: string;
  title: string;
  period: string;
  status: string;
  instructors: string[];
}

export interface AcademicProfile {
  found: boolean;
  note?: string;
  puid: string;
  displayName: string;
  identifiers: { type: string; value: string }[];
  emails: { type: string; address: string }[];
  teaching: AcademicCourse[];
  enrolled: AcademicCourse[];
  serverTime: string;
}

export function getAcademicProfile(): Promise<AcademicProfile> {
  return request<AcademicProfile>('/api/academic/me');
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
