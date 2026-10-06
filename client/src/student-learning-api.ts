import { apiRequest } from './api.js';
import { getAnonymousPreviewSession } from './preview-session.js';

export interface QuestionNote { questionId: string; visibility: 'always' | 'after-submit'; text?: string; materialId?: string; pageStart?: number; pageEnd?: number }
export interface LearningSettings { revision: number; mode: 'topic-practice' | 'linear'; order: 'instructor' | 'personalized'; questionOrder: string[]; notes: QuestionNote[] }
export interface LibraryQuestion { questionId: string; versionId: string; loId: string; loName: string; themeId: string; themeName: string; stem: string; difficulty: string; saved: boolean; mistake: boolean; answered: boolean; confusing: boolean; tags: string[]; addedAt?: string; lastReviewedAt?: string; lastIncorrectAt?: string }
export interface LearningLibrary { settings: Pick<LearningSettings, 'mode' | 'order'>; questions: LibraryQuestion[] }
export interface LearningView {
  id: string; kind: 'lesson' | 'test' | 'cards' | 'browse'; revision: number; cursor: number;
  items: Array<{ questionId: string; loId: string; loName: string; themeName: string; title: string; status: string }>;
  current: null | { questionId: string; loId: string; loName: string; themeName: string; stem: string; difficulty: string; options: Array<{ key: string; text: string }>; selectedKey?: string; answer?: { key: string; correct: boolean }; rating?: string; revealed?: Array<{ key: string; text: string; explanation: string; correct: boolean }>; note?: Omit<QuestionNote, 'questionId' | 'visibility'> };
}
export type DiscussionCategory = 'general' | 'concept' | 'method' | 'explanation' | 'material' | 'logistics' | 'note';
export const DISCUSSION_CATEGORIES: Record<DiscussionCategory, string> = { general: 'General question', concept: 'Concept clarification', method: 'Problem-solving method', explanation: 'Answer / explanation', material: 'Course material', logistics: 'Course logistics', note: 'Note / discussion' };
interface DiscussionAuthor { name: string; anonymous: boolean; mine: boolean; puid?: string }
export interface DiscussionPost {
  id: string; revision: number; title: string; text: string; category: DiscussionCategory; audience: 'course' | 'staff'; questionId?: string; themeId?: string; loId?: string; pinned: boolean; resolved: boolean; closed: boolean; deleted: boolean; staff: boolean; moderator: boolean; author: DiscussionAuthor; votes: number; voted: boolean; following: boolean; createdAt: string; updatedAt: string;
  replies: Array<{ id: string; kind: 'student' | 'instructor' | 'followup'; text: string; endorsed: boolean; staff: boolean; createdAt: string; author: DiscussionAuthor }>;
}
export interface DiscussionData { hasMore?: boolean; staff: boolean; moderator: boolean; posts: DiscussionPost[]; themes: Array<{ id: string; name: string }>; los: Array<{ id: string; name: string; themeId: string }> }
export interface DiscussionQuestion { id: string; title: string; themeId: string; themeName: string; loId: string; loName: string }
export interface PostInput { title: string; text: string; category: DiscussionCategory; audience: 'course' | 'staff'; anonymous: boolean; questionId?: string; themeId?: string; loId?: string }
export interface PostChange { revision: number; action: 'reply' | 'close' | 'reopen' | 'delete' | 'restore' | 'pin' | 'resolve' | 'endorse' | 'vote' | 'follow'; text?: string; kind?: 'student' | 'instructor' | 'followup'; anonymous?: boolean; replyId?: string; value?: boolean }
export function learningApi(courseId: string, preview = false) {
  const prefix = `/api/courses/${encodeURIComponent(courseId)}/${preview ? 'preview/' : ''}`;
  const query = preview ? `?previewSessionId=${encodeURIComponent(getAnonymousPreviewSession(courseId))}` : '';
  const get = <T>(path: string) => apiRequest<T>(`${prefix}${path}${query}`);
  const send = <T>(path: string, method: string, body: unknown) => apiRequest<T>(`${prefix}${path}${query}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    library: () => get<LearningLibrary>('learning/library'),
    start: (input: { kind: LearningView['kind']; themeId?: string; questionIds?: string[]; random?: boolean; roundId?: string }) => send<LearningView>('learning/sessions', 'POST', input),
    session: (id: string) => get<LearningView>(`learning/sessions/${id}`),
    change: (id: string, input: { revision: number; action: 'draft' | 'move' | 'submit' | 'reveal' | 'rate'; key?: string; cursor?: number; rating?: 'remembered' | 'learning' }) => send<LearningView>(`learning/sessions/${id}`, 'PUT', input),
    metadata: (id: string, input: { saved?: boolean; tags?: string[]; confusing?: boolean }) => send<unknown>(`learning/questions/${id}/metadata`, 'PUT', input),
    materialHref: (id: string, page?: number) => `${prefix}learning/sessions/${id}/material${query}${page ? `#page=${page}` : ''}`,
    discussion: (offset = 0) => apiRequest<DiscussionData>(`${prefix}discussion${query}${query ? '&' : '?'}offset=${offset}`),
    post: (input: PostInput) => send<DiscussionPost>('discussion', 'POST', input),
    postChange: (id: string, input: PostChange) => send<DiscussionPost>(`discussion/${id}`, 'PUT', input),
    questions: () => get<DiscussionQuestion[]>('discussion/questions'),
    questionPreview: (id: string) => get<{ stem: string; options: Array<{ key: string; text: string }> }>(`discussion/questions/${id}`),
  };
}
export const getTeachingSettings = (id: string) => apiRequest<LearningSettings>(`/api/courses/${encodeURIComponent(id)}/learning-settings`);
export const saveTeachingSettings = (id: string, input: LearningSettings) => apiRequest<LearningSettings>(`/api/courses/${encodeURIComponent(id)}/learning-settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
