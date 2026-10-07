import { ObjectId, type WithId } from 'mongodb';
import {
  coursesCol, themesCol, losCol, questionsCol, questionVersionsCol, materialsCol,
  learningSettingsCol, learningSessionsCol, previewLearningSessionsCol,
  reviewMetadataCol, previewReviewMetadataCol, attemptsCol, previewAttemptsCol,
  masteryCol, reviewBookCol, previewStudentSessionsCol,
} from '../components/mongodb/collections';
import type { Question, QuestionVersion, AttemptRecord, PreviewAttemptRecord } from '../types/domain';
import type { LearningActor, LearningSettings, LearningSession, LearningItem, InstructorQuestionNote } from '../types/student-learning';
import { isThemeReleased, releasedForServing } from './theme-release';
import { isServable } from './numeric-gate.service';
import { drawCollisionFreeParams, substituteParams } from './params.service';
import { gradeAnswer } from './attempts.service';
import { getRedirectMaterialSource } from './progression.service';
import { computeProfile } from './mastery.service';

export function learningError(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }
export const actorFilter = (actor: LearningActor, courseId: ObjectId) => ({ courseId, owner: actor.puid, ...(actor.previewSessionId ? { previewSessionId: actor.previewSessionId } : {}) });
const sessions = (a: LearningActor) => a.previewSessionId ? previewLearningSessionsCol() : learningSessionsCol();
const metadata = (a: LearningActor) => a.previewSessionId ? previewReviewMetadataCol() : reviewMetadataCol();
const expiry = (a: LearningActor) => a.previewSessionId ? { expiresAt: new Date(Date.now() + 86_400_000) } : {};

export async function assertLearningCourse(courseId: ObjectId, preview = false): Promise<void> {
  const course = await coursesCol().findOne({ _id: courseId });
  if (!course || course.lifecycle === 'archived' || course.archivedAt || (!preview && (!course.published || (course.termEnd && course.termEnd < new Date())))) learningError('Course is not available.', 404);
}
export async function getLearningSettings(courseId: ObjectId): Promise<LearningSettings> {
  const stored = await learningSettingsCol().findOne({ courseId });
  // Apply the rollout on reads so existing courses need no manual production
  // migration. Retain notes/order/revision; a new explicit save can opt into legacy.
  return stored ? { ...stored, mode: stored.teachingModeVersion === 2 ? stored.mode : 'linear' }
    : { courseId, revision: 0, mode: 'linear', teachingModeVersion: 2, order: 'instructor', questionOrder: [], notes: [], updatedAt: new Date(0) };
}
export async function saveLearningSettings(courseId: ObjectId, input: Pick<LearningSettings, 'revision' | 'mode' | 'order' | 'questionOrder' | 'notes'>) {
  const course = await coursesCol().findOne({ _id: courseId });
  if (!course || course.lifecycle === 'archived') learningError('Course is not editable.', 409);
  const questions = await questionsCol().find({ courseId, _id: { $in: [...new Set([...input.questionOrder, ...input.notes.map(n => n.questionId)])].map(id => new ObjectId(id)) } }).toArray();
  const ids = new Set(questions.map(q => q._id.toString()));
  if (input.questionOrder.some(id => !ids.has(id)) || input.notes.some(n => !ids.has(n.questionId))) learningError('A question does not belong to this course.');
  if (new Set(input.questionOrder).size !== input.questionOrder.length || new Set(input.notes.map(n => n.questionId)).size !== input.notes.length) learningError('Questions cannot appear twice.');
  for (const note of input.notes) {
    if (note.pageEnd && (!note.pageStart || note.pageEnd < note.pageStart)) learningError('Invalid page range.');
    if (note.materialId) {
      const q = questions.find(q => q._id.toString() === note.questionId)!;
      const material = await materialsCol().findOne({ _id: new ObjectId(note.materialId), courseId, status: 'ready', deletedAt: { $exists: false } });
      if (!material || !material.assignments.some(a => a.loId && q.loIds.some(id => id.equals(a.loId!)))) learningError('Choose a ready material assigned to this question’s objective.');
    }
  }
  try {
    const result = await learningSettingsCol().updateOne({ courseId, revision: input.revision }, { $set: { ...input, courseId, teachingModeVersion: 2, revision: input.revision + 1, updatedAt: new Date() } }, { upsert: input.revision === 0 });
    if (!result.matchedCount && !result.upsertedCount) learningError('Settings changed in another window. Reload before saving.', 409);
  } catch (error) { if ((error as { code?: number }).code === 11000) learningError('Settings changed in another window. Reload before saving.', 409); throw error; }
  return getLearningSettings(courseId);
}
export async function releasedLearningPool(courseId: ObjectId) {
  const [themes, los, questions] = await Promise.all([
    themesCol().find({ courseId, archivedAt: { $exists: false } }).sort({ order: 1, _id: 1 }).toArray(),
    losCol().find({ courseId, archivedAt: { $exists: false } }).sort({ order: 1, _id: 1 }).toArray(),
    questionsCol().find({ courseId, state: 'approved' }).sort({ createdAt: 1, _id: 1 }).toArray(),
  ]);
  const open = new Set(themes.filter(t => isThemeReleased(t)).map(t => t._id.toString()));
  const blocked = new Set(themes.filter(t => !isThemeReleased(t)).map(t => t._id.toString()));
  const versions = await questionVersionsCol().find({ _id: { $in: questions.map(q => q.currentVersionId) } }).toArray();
  const byVersion = new Map(versions.map(v => [v._id.toString(), v]));
  const activeThemes = new Set(themes.map(t => t._id.toString()));
  los.sort((a,b) => (themes.findIndex(t => t._id.equals(a.themeId)) - themes.findIndex(t => t._id.equals(b.themeId))) || a.order - b.order);
  const result: Array<{ question: WithId<Question>; version: WithId<QuestionVersion>; lo: typeof los[number]; theme: typeof themes[number] }> = [];
  for (const question of questions) {
    const version = byVersion.get(question.currentVersionId.toString());
    const lo = los.find(l => question.loIds.some(id => id.equals(l._id)) && open.has(l.themeId.toString()));
    const theme = lo && themes.find(t => t._id.equals(lo.themeId));
    if (!version || !lo || !theme || !isServable(version) || !releasedForServing(question, blocked) || question.themeIds.some(id => !activeThemes.has(id.toString()))) continue;
    result.push({ question, version, lo, theme });
  }
  return result;
}
/** Stable finite order; lack of evidence preserves the teacher's order. */
export function orderLearningItems<T extends { questionId: string; loId: string }>(items: T[], questionOrder: string[], scores?: Map<string, number>): T[] {
  const order = new Map(questionOrder.map((id, i) => [id, i]));
  const instructor = items.map((item, i) => ({ item, i })).sort((a, b) => (order.get(a.item.questionId) ?? questionOrder.length + a.i) - (order.get(b.item.questionId) ?? questionOrder.length + b.i));
  if (scores?.size) instructor.sort((a, b) => (scores.get(a.item.loId) ?? 0.5) - (scores.get(b.item.loId) ?? 0.5));
  return instructor.map(v => v.item);
}
export async function learningLibrary(actor: LearningActor, courseId: ObjectId) {
  await assertLearningCourse(courseId, !!actor.previewSessionId);
  const [pool, settings, meta, saved, attempts, lessonSessions] = await Promise.all([
    releasedLearningPool(courseId), getLearningSettings(courseId), metadata(actor).find(actorFilter(actor, courseId)).toArray(),
    actor.previewSessionId ? previewStudentSessionsCol().findOne({ courseId, instructorPuid: actor.puid, previewSessionId: actor.previewSessionId }).then(s => s?.reviewBookEntries ?? []) : reviewBookCol().find({ puid: actor.puid, courseId }).toArray(),
    actor.previewSessionId ? previewAttemptsCol().find({ courseId, instructorPuid: actor.puid, previewSessionId: actor.previewSessionId }).sort({ createdAt: 1 }).toArray() : attemptsCol().find({ courseId, puid: actor.puid }).sort({ createdAt: 1 }).toArray(),
    sessions(actor).find({ ...actorFilter(actor, courseId), kind: 'lesson' }).toArray(),
  ]);
  const rows = pool.map(p => {
    const id = p.question._id.toString(); const m = meta.find(m => m.questionId === id); const old = saved.find(s => s.questionId.toString() === id);
    const history = attempts.filter(a => a.questionId.toString() === id); const first = history.find(a => a.mode === 'topic-practice'); const lastMiss = history.filter(a => !a.correct).slice(-1)[0];
    return { questionId: id, versionId: p.version._id.toString(), loId: p.lo._id.toString(), loName: p.lo.name, themeId: p.theme._id.toString(), themeName: p.theme.name, stem: p.version.stem, difficulty: p.version.difficulty,
      saved: m?.saved ?? old?.sources.includes('bookmark') ?? false, mistake: !!lastMiss, answered: !!first || lessonSessions.some(s => s.items.some(i => i.questionId === id && i.answer)), confusing: m?.confusing ?? false, tags: m?.tags ?? [], addedAt: m?.addedAt ?? old?.addedAt, lastReviewedAt: m?.lastReviewedAt, lastIncorrectAt: m?.lastIncorrectAt ?? lastMiss?.createdAt };
  });
  return { settings: { mode: settings.mode, order: settings.order }, questions: orderLearningItems(rows, settings.questionOrder) };
}
export async function updateReviewMetadata(actor: LearningActor, courseId: ObjectId, questionId: string, patch: { saved?: boolean; confusing?: boolean; tags?: string[] }) {
  await assertLearningCourse(courseId, !!actor.previewSessionId);
  if (!(await releasedLearningPool(courseId)).some(p => p.question._id.toString() === questionId)) learningError('Question is not available.', 404);
  const filter = { ...actorFilter(actor, courseId), questionId };
  const previous = await metadata(actor).findOne(filter);
  const now = new Date();
  await metadata(actor).updateOne(filter, { $set: { ...patch, updatedAt: now, ...expiry(actor), ...(patch.saved && !previous?.addedAt ? { addedAt: now } : {}) }, $setOnInsert: { ...filter, ...(!('saved' in patch) ? { saved: false } : {}), ...(!('tags' in patch) ? { tags: [] } : {}), ...(!('confusing' in patch) ? { confusing: false } : {}) } }, { upsert: true });
  return metadata(actor).findOne(filter);
}
export async function startLearningSession(actor: LearningActor, courseId: ObjectId, input: { kind: LearningSession['kind']; themeId?: string; questionIds?: string[]; random?: boolean; roundId?: string }) {
  await assertLearningCourse(courseId, !!actor.previewSessionId);
  const settings = await getLearningSettings(courseId);
  if (input.kind === 'lesson' && settings.mode !== 'linear') learningError('Linear learning is not enabled.', 409);
  const scope = input.kind === 'lesson' ? input.themeId ?? 'course' : input.kind === 'browse' ? input.questionIds?.[0] ?? 'empty' : input.roundId ?? learningError('A review round id is required.');
  const filter = { ...actorFilter(actor, courseId), kind: input.kind, scope };
  const existing = await sessions(actor).findOne(filter);
  const pool = (await releasedLearningPool(courseId)).filter(p => (!input.themeId || p.theme._id.toString() === input.themeId) && (!input.questionIds || input.questionIds.includes(p.question._id.toString())));
  if (input.questionIds?.some(id => !pool.some(p => p.question._id.toString() === id))) learningError('A selected question is no longer available.', 409);
  if (existing) {
    if (input.kind === 'lesson') {
      const additions: LearningItem[] = [];
      for (const p of pool.filter(p => !existing.items.some(i => i.questionId === p.question._id.toString()))) {
        const { paramValues } = await drawCollisionFreeParams(p.version);
        additions.push({ questionId: p.question._id.toString(), versionId: p.version._id.toString(), loId: p.lo._id.toString(), themeId: p.theme._id.toString(), loName: p.lo.name, themeName: p.theme.name, version: p.version, ...(paramValues ? { paramValues } : {}), skipped: false });
      }
      if (additions.length) {
        await sessions(actor).updateOne({ _id: existing._id, ...actorFilter(actor, courseId), revision: existing.revision }, { $set: { items: [...existing.items, ...orderLearningItems(additions, settings.questionOrder)], updatedAt: new Date(), ...expiry(actor) }, $inc: { revision: 1 } });
        return learningSessionView(actor, (await sessions(actor).findOne(filter))!);
      }
    }
    return learningSessionView(actor, existing);
  }
  const items: LearningItem[] = [];
  for (const p of pool) {
    const { paramValues } = await drawCollisionFreeParams(p.version);
    items.push({ questionId: p.question._id.toString(), versionId: p.version._id.toString(), loId: p.lo._id.toString(), themeId: p.theme._id.toString(), loName: p.lo.name, themeName: p.theme.name, version: p.version, ...(paramValues ? { paramValues } : {}), skipped: false });
  }
  let scores: Map<string, number> | undefined;
  if (input.kind === 'lesson' && settings.order === 'personalized') {
    const records = actor.previewSessionId ? await previewAttemptsCol().find({ courseId, instructorPuid: actor.puid, previewSessionId: actor.previewSessionId }).toArray() : await attemptsCol().find({ courseId, puid: actor.puid }).toArray();
    scores = new Map();
    for (const id of new Set(items.map(i => i.loId))) { const evidence = records.filter(a => a.loId.toString() === id).slice(-10); if (evidence.length) scores.set(id, evidence.filter(a => a.correct).length / evidence.length); }
  }
  const ordered = orderLearningItems(items, settings.questionOrder, scores);
  if (input.random) for (let i = ordered.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ordered[i], ordered[j]] = [ordered[j], ordered[i]]; }
  const now = new Date();
  const session: LearningSession = { ...filter, revision: 0, cursor: 0, items: ordered, createdAt: now, updatedAt: now, ...expiry(actor) };
  try { await sessions(actor).insertOne(session); } catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
  return learningSessionView(actor, (await sessions(actor).findOne(filter))!);
}
async function allowedItems(courseId: ObjectId) { return new Set((await releasedLearningPool(courseId)).map(p => p.question._id.toString())); }
export async function ownedLearningSession(actor: LearningActor, courseId: ObjectId, id: string) {
  await assertLearningCourse(courseId, !!actor.previewSessionId);
  const session = await sessions(actor).findOne({ ...actorFilter(actor, courseId), _id: new ObjectId(id) });
  if (!session) learningError('Session not found.', 404);
  return session;
}
async function learningSessionView(actor: LearningActor, session: WithId<LearningSession>) {
  const allowed = await allowedItems(session.courseId);
  const item = session.items[session.cursor];
  for (let i = 0; i < session.items.length; i++) if (session.items[i].answer && !session.items[i].projected) { await projectLearningAnswer(actor, session, i); session.items[i].projected = true; }
  const note = item && (await getLearningSettings(session.courseId)).notes.find(n => n.questionId === item.questionId);
  const visibleNote = note && (note.visibility === 'always' || !!item?.answer || (session.kind === 'cards' && !!item?.rating));
  const options = item && allowed.has(item.questionId) ? item.version.options.map(o => ({ key: o.key, text: item.paramValues ? substituteParams(o.text, item.paramValues) : o.text })) : [];
  return { id: session._id.toString(), kind: session.kind, revision: session.revision, cursor: session.cursor, items: session.items.map(i => ({ questionId: i.questionId, loId: i.loId, loName: i.loName, themeName: i.themeName, title: i.version.stem, status: !allowed.has(i.questionId) ? 'unavailable' : i.answer ? i.answer.correct ? 'correct' : 'incorrect' : i.rating ?? (i.skipped ? 'skipped' : 'unanswered') })),
    current: item && allowed.has(item.questionId) && isServable(item.version) ? { questionId: item.questionId, loId: item.loId, loName: item.loName, themeName: item.themeName, stem: item.paramValues ? substituteParams(item.version.stem, item.paramValues) : item.version.stem, options, difficulty: item.version.difficulty, selectedKey: item.selectedKey, answer: item.answer && { key: item.answer.key, correct: item.answer.correct }, rating: item.rating,
      ...(item.answer ? { revealed: gradeAnswer(item.version.options, item.answer.key, 'strategy-b', item.paramValues).fullReveal } : {}),
      ...(visibleNote ? { note: await visibleLearningNote(session.courseId, note) } : {}) } : null };
}
async function visibleLearningNote(courseId: ObjectId, note: InstructorQuestionNote) {
  if (note.materialId && !await materialsCol().findOne({ _id: new ObjectId(note.materialId), courseId, status: 'ready', deletedAt: { $exists: false } })) return note.text ? { text: note.text } : undefined;
  return { text: note.text, materialId: note.materialId, pageStart: note.pageStart, pageEnd: note.pageEnd };
}
export async function getLearningSession(actor: LearningActor, courseId: ObjectId, id: string) { return learningSessionView(actor, await ownedLearningSession(actor, courseId, id)); }
export async function changeLearningSession(actor: LearningActor, courseId: ObjectId, id: string, input: { revision: number; action: 'draft' | 'move' | 'submit' | 'reveal' | 'rate'; key?: string; cursor?: number; rating?: 'remembered' | 'learning' }) {
  const session = await ownedLearningSession(actor, courseId, id);
  if (session.revision !== input.revision) learningError('Progress changed in another window. Reloading is required.', 409);
  const current = session.items[session.cursor];
  if (!current && input.action === 'move') {
    if (input.cursor === undefined || input.cursor < 0 || input.cursor >= session.items.length) learningError('Invalid question position.');
    const result = await sessions(actor).updateOne({ _id: session._id, ...actorFilter(actor, courseId), revision: input.revision }, { $set: { cursor: input.cursor, updatedAt: new Date(), ...expiry(actor) }, $inc: { revision: 1 } });
    if (!result.matchedCount) learningError('Progress changed in another window. Reloading is required.', 409);
    session.cursor = input.cursor; session.revision++; return learningSessionView(actor, session);
  }
  if (!current) learningError('No question is selected.');
  const available = (await allowedItems(courseId)).has(current.questionId) && isServable(current.version);
  if (input.action !== 'move' && !available) learningError('Question is no longer available.', 409);
  if (input.action === 'draft') {
    if (current.answer) learningError('The first answer is already submitted.', 409);
    if (input.key && !current.version.options.some(o => o.key === input.key)) learningError('Invalid answer.');
    current.selectedKey = input.key;
  } else if (input.action === 'move') {
    if (input.cursor === undefined || input.cursor < 0 || input.cursor > session.items.length) learningError('Invalid question position.');
    if (!current.answer && !current.rating && input.cursor !== session.cursor) current.skipped = true;
    session.cursor = input.cursor;
  } else if (input.action === 'submit') {
    if (session.kind === 'cards' || session.kind === 'browse') learningError('Start a self-test to submit an answer.');
    if (!current.answer) {
      const key = input.key ?? current.selectedKey;
      if (!key || !current.version.options.some(o => o.key === key)) learningError('Choose an answer.');
      const grade = gradeAnswer(current.version.options, key, 'strategy-b', current.paramValues);
      current.selectedKey = key; current.skipped = false; current.answer = { key, correct: grade.correct, attemptId: new ObjectId(), at: new Date() };
    }
  } else if (input.action === 'rate') {
    if (session.kind !== 'cards' || !input.rating) learningError('Invalid flashcard rating.');
    current.rating = input.rating;
  } else if (input.action === 'reveal') {
    if (session.kind !== 'browse' && session.kind !== 'cards') learningError('Answers stay hidden until submission.', 409);
  }
  const update = await sessions(actor).updateOne({ _id: session._id, ...actorFilter(actor, courseId), revision: input.revision }, { $set: { items: session.items, cursor: session.cursor, updatedAt: new Date(), ...expiry(actor) }, $inc: { revision: 1 } });
  if (!update.matchedCount) learningError('Progress changed in another window. Reloading is required.', 409);
  session.revision += 1;
  if (input.action === 'reveal' || input.action === 'rate') await metadata(actor).updateOne({ ...actorFilter(actor, courseId), questionId: current.questionId }, { $set: { lastReviewedAt: new Date(), updatedAt: new Date(), ...expiry(actor), ...(input.rating ? { confusing: input.rating === 'learning' } : {}) }, $setOnInsert: { ...actorFilter(actor, courseId), questionId: current.questionId, saved: false, tags: [], ...(!input.rating ? { confusing: false } : {}) } }, { upsert: true });
  const view = await learningSessionView(actor, session);
  if (input.action === 'reveal' && view.current) Object.assign(view.current, { revealed: gradeAnswer(current.version.options, current.version.options.find(o => o.role === 'correct')!.key, 'strategy-b', current.paramValues).fullReveal });
  return view;
}
/** The session answer is the durable outbox. Replaying never inserts a second attempt. */
async function projectLearningAnswer(actor: LearningActor, session: WithId<LearningSession>, index: number) {
  const item = session.items[index]; const answer = item.answer!;
  const grade = gradeAnswer(item.version.options, answer.key, 'strategy-b', item.paramValues);
  const record: AttemptRecord & { _id: ObjectId } = { _id: answer.attemptId, puid: actor.puid, courseId: session.courseId, questionId: new ObjectId(item.questionId), questionVersionId: new ObjectId(item.versionId), loId: new ObjectId(item.loId), themeId: new ObjectId(item.themeId), mode: session.kind === 'lesson' ? 'topic-practice' : 'review-book', strategy: 'b', selectedKey: answer.key, correct: answer.correct, selectedRole: grade.selectedOption.role, difficulty: item.version.difficulty, paramValues: item.paramValues, isRetry: false, createdAt: answer.at };
  if (actor.previewSessionId) {
    const rest = { ...record };
    Reflect.deleteProperty(rest, 'puid');
    const preview: PreviewAttemptRecord & { _id: ObjectId } = { ...rest, instructorPuid: actor.puid, previewSessionId: actor.previewSessionId, preview: true, versionSnapshot: { version: item.version.version, type: item.version.type, stem: item.version.stem, options: item.version.options, difficulty: item.version.difficulty } };
    await previewAttemptsCol().updateOne({ _id: answer.attemptId }, { $setOnInsert: preview }, { upsert: true });
  } else {
    await attemptsCol().updateOne({ _id: answer.attemptId }, { $setOnInsert: record }, { upsert: true });
    if (session.kind === 'lesson') {
      const filter = { puid: actor.puid, courseId: session.courseId, loId: record.loId };
      const recent = await attemptsCol().find({ ...filter, mode: 'topic-practice' }).sort({ createdAt: 1, _id: 1 }).toArray();
      const previous = await masteryCol().findOne(filter);
      let profile = null;
      for (let i = 0; i < recent.length; i++) profile = computeProfile(recent.slice(Math.max(0, i - 9), i + 1), profile);
      if (profile && previous) { profile.examVerified = previous.examVerified; profile.rationale = previous.rationale; }
      if (profile) {
        // A slower projection must not overwrite a profile computed from newer evidence.
        if (!previous) {
          try { await masteryCol().updateOne(filter, { $setOnInsert: { ...profile, learningEvidenceCount: recent.length } }, { upsert: true }); }
          catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
        }
        await masteryCol().updateOne({ ...filter, $or: [{ learningEvidenceCount: { $exists: false } }, { learningEvidenceCount: { $lte: recent.length } }] }, { $set: { ...profile, learningEvidenceCount: recent.length }, $unset: { skipped: '' } });
      }
    }
    if (!answer.correct) await reviewBookCol().updateOne({ puid: actor.puid, courseId: session.courseId, questionId: record.questionId }, { $set: { triggeringAttemptId: answer.attemptId, loId: record.loId, themeId: record.themeId, updatedAt: answer.at }, $setOnInsert: { puid: actor.puid, courseId: session.courseId, questionId: record.questionId, addedAt: answer.at }, $addToSet: { sources: 'auto' } }, { upsert: true });
  }
  await metadata(actor).updateOne({ ...actorFilter(actor, session.courseId), questionId: item.questionId }, { $max: { lastReviewedAt: answer.at, ...(!answer.correct ? { lastIncorrectAt: answer.at } : {}) }, $set: { updatedAt: new Date(), ...expiry(actor) }, $setOnInsert: { ...actorFilter(actor, session.courseId), questionId: item.questionId, saved: false, tags: [], confusing: false } }, { upsert: true });
  await sessions(actor).updateOne({ _id: session._id, [`items.${index}.answer.attemptId`]: answer.attemptId }, { $set: { [`items.${index}.projected`]: true } });
}

/** Supports any of a multi-objective question's explicitly assigned materials. */
export async function learningMaterialSource(actor: LearningActor, courseId: ObjectId, id: string) {
  const view = await getLearningSession(actor, courseId, id);
  const materialId = view.current?.note?.materialId;
  if (!view.current || !materialId) learningError('Material is not available.', 404);
  const candidate = (await releasedLearningPool(courseId)).find(p => p.question._id.toString() === view.current!.questionId);
  for (const loId of candidate?.question.loIds ?? []) {
    const source = await getRedirectMaterialSource(courseId, loId, new ObjectId(materialId));
    if (source) return source;
  }
  return learningError('Material is not available.', 404);
}
