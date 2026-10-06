import { ObjectId, type WithId } from 'mongodb';
import { discussionPostsCol, previewDiscussionPostsCol, themesCol, losCol } from '../components/mongodb/collections';
import type { User } from '../types/domain';
import type { LearningActor, DiscussionPost, DiscussionReply, DiscussionCategory } from '../types/student-learning';
import { assertLearningCourse, learningError, releasedLearningPool } from './student-learning.service';
import { isThemeReleased } from './theme-release';
import { drawCollisionFreeParams, substituteParams } from './params.service';

const collection = (actor: LearningActor) => actor.previewSessionId ? previewDiscussionPostsCol() : discussionPostsCol();
const scope = (actor: LearningActor, courseId: ObjectId) => ({ courseId, ...(actor.previewSessionId ? { previewOwner: actor.puid, previewSessionId: actor.previewSessionId } : {}) });
export function isDiscussionStaff(user: User, courseId: ObjectId, preview = false) { return !preview && (user.isAdmin || user.courseRoles.some(r => r.courseId.equals(courseId) && (r.role === 'instructor' || r.role === 'ta'))); }
export function canModerateDiscussion(user: User, courseId: ObjectId, preview = false) { return !preview && (user.isAdmin || user.courseRoles.some(r => r.courseId.equals(courseId) && r.role === 'instructor')); }
export function visibleDiscussionAuthor(author: { authorPuid: string; authorName: string; anonymous: boolean }, staff: boolean, owner: string) {
  return { name: author.anonymous && !staff ? 'Anonymous student' : author.authorName, anonymous: author.anonymous, ...(staff ? { puid: author.authorPuid } : {}), mine: owner === author.authorPuid };
}
export async function discussionQuestions(actor: LearningActor, courseId: ObjectId, allowDraft = false) {
  await assertLearningCourse(courseId, !!actor.previewSessionId || allowDraft);
  const pool = await releasedLearningPool(courseId);
  return pool.map(p => ({ id: p.question._id.toString(), title: p.version.stem, themeId: p.theme._id.toString(), themeName: p.theme.name, loId: p.lo._id.toString(), loName: p.lo.name }));
}
export async function discussionQuestionPreview(actor: LearningActor, courseId: ObjectId, id: string, allowDraft = false) {
  await assertLearningCourse(courseId, !!actor.previewSessionId || allowDraft);
  const q = (await releasedLearningPool(courseId)).find(p => p.question._id.toString() === id);
  if (!q) learningError('Question not available.', 404);
  const { paramValues } = await drawCollisionFreeParams(q.version);
  const sub = (text: string) => paramValues ? substituteParams(text, paramValues) : text;
  // Deliberately project only stem/options. Never return correctness, roles or explanations.
  return { id, stem: sub(q.version.stem), options: q.version.options.map(o => ({ key: o.key, text: sub(o.text) })), themeId: q.theme._id.toString(), loId: q.lo._id.toString() };
}
export function discussionProjection(post: WithId<DiscussionPost>, staff: boolean, owner: string, moderator: boolean) {
  return { id: post._id.toString(), revision: post.revision, title: post.title, text: post.text, category: post.category, audience: post.audience, questionId: post.questionId, themeId: post.themeId, loId: post.loId, pinned: post.pinned, resolved: post.resolved, closed: post.closed, deleted: !!post.deletedAt, createdAt: post.createdAt, updatedAt: post.updatedAt, author: visibleDiscussionAuthor(post, staff, owner), votes: post.voters.length, voted: post.voters.includes(owner), following: post.followers.includes(owner), staff, moderator,
    replies: post.replies.map(r => ({ id: r.id, kind: r.kind, text: r.text, endorsed: r.endorsed, staff: r.staff, createdAt: r.createdAt, author: visibleDiscussionAuthor(r, staff, owner) })) };
}
async function memberPost(actor: LearningActor, user: User, courseId: ObjectId, id: string, includeDeleted = false) {
  const staff = isDiscussionStaff(user, courseId, !!actor.previewSessionId);
  const post = await collection(actor).findOne({ ...scope(actor, courseId), _id: new ObjectId(id), ...(!includeDeleted ? { deletedAt: { $exists: false } } : {}), ...(!staff ? { $or: [{ audience: 'course' as const }, { authorPuid: actor.puid }] } : {}) });
  if (!post) learningError('Post not found.', 404);
  return post;
}
export async function listDiscussion(actor: LearningActor, user: User, courseId: ObjectId, offset = 0) {
  await assertLearningCourse(courseId, !!actor.previewSessionId || isDiscussionStaff(user, courseId));
  const staff = isDiscussionStaff(user, courseId, !!actor.previewSessionId);
  const [posts, themes, los] = await Promise.all([
    collection(actor).find({ ...scope(actor, courseId), deletedAt: { $exists: false }, ...(!staff ? { $or: [{ audience: 'course' as const }, { authorPuid: actor.puid }] } : {}) }).sort({ pinned: -1, updatedAt: -1, _id: -1 }).skip(offset).limit(101).toArray(),
    themesCol().find({ courseId, archivedAt: { $exists: false } }).sort({ order: 1 }).toArray(),
    losCol().find({ courseId, archivedAt: { $exists: false } }).sort({ order: 1 }).toArray(),
  ]);
  const releasedThemes = new Set(themes.filter(t => isThemeReleased(t)).map(t => t._id.toString()));
  return { staff, moderator: canModerateDiscussion(user, courseId, !!actor.previewSessionId), hasMore: posts.length > 100, posts: posts.slice(0, 100).map(p => discussionProjection(p, staff, actor.puid, canModerateDiscussion(user, courseId, !!actor.previewSessionId))), themes: themes.filter(t => releasedThemes.has(t._id.toString())).map(t => ({ id: t._id.toString(), name: t.name })), los: los.filter(l => releasedThemes.has(l.themeId.toString())).map(l => ({ id: l._id.toString(), themeId: l.themeId.toString(), name: l.name })) };
}
export async function createDiscussion(actor: LearningActor, user: User, courseId: ObjectId, input: { title: string; text: string; category: DiscussionCategory; audience: 'course' | 'staff'; anonymous: boolean; questionId?: string; themeId?: string; loId?: string }) {
  await assertLearningCourse(courseId, !!actor.previewSessionId || isDiscussionStaff(user, courseId));
  const { questionId } = input;
  let { themeId, loId } = input;
  const pool = await releasedLearningPool(courseId);
  if (questionId) { const q = pool.find(p => p.question._id.toString() === questionId); if (!q) learningError('Question not available.', 404); themeId = q.theme._id.toString(); loId = q.lo._id.toString(); }
  else {
    if (loId) {
      const objective = await losCol().findOne({ _id: new ObjectId(loId), courseId, archivedAt: { $exists: false } });
      if (!objective || (themeId && objective.themeId.toString() !== themeId)) learningError('Objective does not match the topic.');
      themeId = objective.themeId.toString();
    }
    if (themeId) {
      const theme = await themesCol().findOne({ _id: new ObjectId(themeId), courseId, archivedAt: { $exists: false } });
      if (!theme || !isThemeReleased(theme)) learningError('Topic not available.');
    }
  }
  const now = new Date();
  const post: DiscussionPost = { ...scope(actor, courseId), authorPuid: actor.puid, authorName: actor.previewSessionId ? 'Preview student' : user.displayName, anonymous: input.anonymous, category: input.category, audience: input.audience, title: input.title, text: input.text, questionId, themeId, loId, pinned: false, resolved: false, closed: false, revision: 0, replies: [], voters: [], followers: [], createdAt: now, updatedAt: now, ...(actor.previewSessionId ? { expiresAt: new Date(Date.now() + 86_400_000) } : {}) };
  const result = await collection(actor).insertOne(post);
  return discussionProjection({ ...post, _id: result.insertedId }, isDiscussionStaff(user, courseId, !!actor.previewSessionId), actor.puid, canModerateDiscussion(user, courseId, !!actor.previewSessionId));
}
export async function changeDiscussion(actor: LearningActor, user: User, courseId: ObjectId, id: string, input: { revision: number; action: 'reply' | 'close' | 'reopen' | 'delete' | 'restore' | 'pin' | 'resolve' | 'endorse' | 'vote' | 'follow'; text?: string; kind?: DiscussionReply['kind']; anonymous?: boolean; replyId?: string; value?: boolean }) {
  await assertLearningCourse(courseId, !!actor.previewSessionId || isDiscussionStaff(user, courseId));
  const moderator = canModerateDiscussion(user, courseId, !!actor.previewSessionId); const staff = isDiscussionStaff(user, courseId, !!actor.previewSessionId);
  const post = await memberPost(actor, user, courseId, id, input.action === 'restore' && moderator);
  if (post.revision !== input.revision) learningError('This post changed. Refresh before trying again.', 409);
  if (['close', 'reopen', 'delete', 'restore', 'pin'].includes(input.action) && !moderator) learningError('Instructor access required.', 403);
  if (['resolve', 'endorse'].includes(input.action) && !staff) learningError('Teaching team access required.', 403);
  if (input.action === 'reply') {
    if (post.closed) learningError('This post is closed.', 409);
    if (!input.text?.trim() || !input.kind) learningError('Enter a reply.');
    if (input.kind === 'instructor' && !staff) learningError('Teaching team access required.', 403);
    if (post.category === 'note' && input.kind !== 'followup') learningError('Notes accept follow-ups only.');
    const reply: DiscussionReply = { id: new ObjectId().toString(), authorPuid: actor.puid, authorName: actor.previewSessionId ? 'Preview student' : user.displayName, staff, anonymous: input.kind === 'instructor' ? false : input.anonymous ?? false, kind: input.kind, text: input.text.trim(), endorsed: false, createdAt: new Date() };
    post.replies.push(reply);
  } else if (input.action === 'close') post.closed = true;
  else if (input.action === 'reopen') post.closed = false;
  else if (input.action === 'delete') { post.deletedAt = new Date(); post.deletedBy = actor.puid; }
  else if (input.action === 'restore') { if (!post.deletedAt || Date.now() - post.deletedAt.getTime() > 86_400_000) learningError('Undo window has expired.', 409); delete post.deletedAt; delete post.deletedBy; }
  else if (input.action === 'pin') post.pinned = input.value ?? !post.pinned;
  else if (input.action === 'resolve') post.resolved = input.value ?? !post.resolved;
  else if (input.action === 'endorse') { const reply = post.replies.find(r => r.id === input.replyId && r.kind === 'student'); if (!reply) learningError('Student answer not found.', 404); reply.endorsed = input.value ?? !reply.endorsed; }
  else { const key = input.action === 'vote' ? 'voters' : 'followers'; post[key] = post[key].includes(actor.puid) ? post[key].filter(p => p !== actor.puid) : [...post[key], actor.puid]; }
  const { _id, deletedAt, deletedBy, ...fields } = post;
  const result = await collection(actor).updateOne({ _id, ...scope(actor, courseId), revision: input.revision }, { $set: { ...fields, revision: input.revision + 1, updatedAt: new Date(), ...(deletedAt ? { deletedAt, deletedBy } : {}) }, ...(!deletedAt ? { $unset: { deletedAt: '', deletedBy: '' } } : {}) });
  if (!result.matchedCount) learningError('This post changed. Refresh before trying again.', 409);
  return discussionProjection({ ...post, revision: input.revision + 1 }, staff, actor.puid, moderator);
}
