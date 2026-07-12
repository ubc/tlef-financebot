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
