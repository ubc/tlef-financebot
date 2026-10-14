import { assessmentRequest, previewAssessmentRequest, closeAssessmentWindow, closePreviewAssessmentWindow } from './api.js';
import { getAnonymousPreviewSession } from './preview-session.js';
import { getSession } from './auth.js';

/** Shares the real assessment UI while keeping Preview requests and routes isolated. */
export interface AssessmentExperience {
  readonly preview: boolean;
  readonly restricted: boolean;
  request<T>(courseId: string, path: string, method?: 'GET' | 'POST' | 'PUT', body?: Record<string, unknown>): Promise<T>;
  closeWindow(courseId: string, attemptId: string, windowId: string): void;
  windowScope(courseId: string): string;
  routes: {
    course(courseId: string): string;
    list(courseId: string): string;
    attempt(courseId: string, attemptId: string): string;
  };
}

export const LIVE_ASSESSMENT_EXPERIENCE: AssessmentExperience = {
  preview: false,
  restricted: false,
  request: assessmentRequest,
  closeWindow: closeAssessmentWindow,
  windowScope: courseId => `live:${getSession().user?.puid ?? ''}:${courseId}`,
  routes: {
    course: courseId => `#/course/${encodeURIComponent(courseId)}`,
    list: courseId => `#/course/${encodeURIComponent(courseId)}/assessments`,
    attempt: (courseId, attemptId) => `#/course/${encodeURIComponent(courseId)}/assessment/${encodeURIComponent(attemptId)}`,
  },
};

export function createPreviewAssessmentExperience(restricted = false): AssessmentExperience {
  const base = (courseId: string): string => `#/preview/${restricted ? 'restricted/' : ''}course/${encodeURIComponent(courseId)}`;
  const sessions = new Map<string, string>();
  const session = (courseId: string): string => {
    const existing = sessions.get(courseId); if (existing) return existing;
    const value = getAnonymousPreviewSession(courseId); sessions.set(courseId, value); return value;
  };
  return {
    preview: true,
    restricted,
    request: (courseId, path, method = 'GET', body) => previewAssessmentRequest(courseId, session(courseId), restricted, path, method, body),
    closeWindow: (courseId, attemptId, windowId) => closePreviewAssessmentWindow(courseId, session(courseId), restricted, attemptId, windowId),
    windowScope: courseId => `preview:${restricted ? 'restricted' : 'unrestricted'}:${getSession().user?.puid ?? ''}:${courseId}:${session(courseId)}`,
    routes: {
      course: base,
      list: courseId => `${base(courseId)}/assessments`,
      attempt: (courseId, attemptId) => `${base(courseId)}/assessment/${encodeURIComponent(attemptId)}`,
    },
  };
}
