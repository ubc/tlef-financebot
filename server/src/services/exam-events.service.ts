import type { ObjectId } from 'mongodb';

// Private exam channel, deliberately separate from public bank content runs.
const listeners = new Map<string, Set<() => void>>();
const key = (courseId: ObjectId, examId: ObjectId) => `${courseId}:${examId}`;
export function notifyExamChanged(courseId: ObjectId, examId: ObjectId): void {
  for (const listener of listeners.get(key(courseId, examId)) ?? []) listener();
}
export function subscribeExamChanges(courseId: ObjectId, examId: ObjectId, listener: () => void): () => void {
  const scope = key(courseId, examId);
  const set = listeners.get(scope) ?? new Set(); set.add(listener); listeners.set(scope, set);
  return () => { set.delete(listener); if (!set.size) listeners.delete(scope); };
}
