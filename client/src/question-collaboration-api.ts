import { apiRequest, type QuestionType } from './api.js';

export interface DraftSnapshot {
  state: string;
  revision: number;
  baseVersionId: string;
  questionType: QuestionType;
  optionKeys: string[];
  currentVersionId: string;
  conflict: boolean;
  committing: boolean;
  updatedAt: string;
  collaborators: Array<{ clientId: string; name: string; field: string }>;
}
export const draftPath = (courseId: string, questionId: string): string =>
  `/api/courses/${encodeURIComponent(courseId)}/questions/${encodeURIComponent(questionId)}/draft`;
export const getDraft = (path: string): Promise<DraftSnapshot> => apiRequest(path);
export const sendDraftUpdate = (path: string, update: string, signal?: AbortSignal): Promise<DraftSnapshot> => apiRequest(`${path}/updates`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ update }), signal,
});
export const commitDraft = (path: string, expectedRevision: number, requestId: string): Promise<{ versionId: string }> =>
  apiRequest(`${path}/commit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision, requestId }) });
export const rebaseDraft = (path: string, expectedRevision: number, expectedVersionId: string): Promise<DraftSnapshot> =>
  apiRequest(`${path}/rebase`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision, expectedVersionId }) });
export const setDraftPresence = (path: string, clientId: string, field: string): Promise<void> => apiRequest(`${path}/presence`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId, field }),
});
export const leaveDraft = (path: string, clientId: string): Promise<void> => apiRequest(`${path}/presence/${clientId}`, { method: 'DELETE', keepalive: true });
