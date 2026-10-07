import { ObjectId } from 'mongodb';
import type { Collection, Document } from 'mongodb';

jest.mock('../../server/src/components/mongodb/collections', () => {
  const names = ['coursesCol','themesCol','losCol','questionsCol','questionVersionsCol','materialsCol','learningSettingsCol','learningSessionsCol','previewLearningSessionsCol','reviewMetadataCol','previewReviewMetadataCol','attemptsCol','previewAttemptsCol','masteryCol','reviewBookCol','previewStudentSessionsCol','discussionPostsCol','previewDiscussionPostsCol'];
  return Object.fromEntries(names.map(n => [n, jest.fn()]));
});
jest.mock('../../server/src/services/params.service', () => ({ drawCollisionFreeParams: jest.fn().mockResolvedValue({}), substituteParams: (s: string) => s }));
jest.mock('../../server/src/services/attempts.service', () => ({ gradeAnswer: (options: Array<{ key: string; role: string }>, key: string) => { const selectedOption = options.find(o => o.key === key)!; return { correct: selectedOption.role === 'correct', selectedOption, fullReveal: options.map(o => ({ ...o, correct: o.role === 'correct' })) }; } }));
import * as collections from '../../server/src/components/mongodb/collections';
import { startLearningSession, changeLearningSession, getLearningSession, learningLibrary, orderLearningItems, saveLearningSettings, getLearningSettings } from '../../server/src/services/student-learning.service';
import { createDiscussion, changeDiscussion, listDiscussion, discussionQuestionPreview } from '../../server/src/services/discussion.service';
import type { User } from '../../server/src/types/domain';

// A small Mongo substitute implements field matching/CAS, not product state transitions.
const path = (doc: Document, key: string): unknown => key.split('.').reduce((v: unknown, k) => (v as Document | undefined)?.[k], doc);
const equal = (a: unknown, b: unknown) => a instanceof ObjectId && b instanceof ObjectId ? a.equals(b) : a === b;
function match(doc: Document, query: Document): boolean {
  return Object.entries(query).every(([key, value]) => {
    if (key === '$or') return (value as Document[]).some(q => match(doc, q));
    const actual = path(doc, key);
    if (value && typeof value === 'object' && !(value instanceof ObjectId) && !(value instanceof Date)) {
      if ('$exists' in value) return (actual !== undefined) === value.$exists;
      if ('$lte' in value) return Number(actual) <= Number(value.$lte);
      if ('$in' in value) return value.$in.some((v: unknown) => equal(actual, v));
    }
    return equal(actual, value);
  });
}
const clone = <T>(value: T): T => {
  if (value instanceof ObjectId) return new ObjectId(value) as T;
  if (value instanceof Date) return new Date(value) as T;
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,clone(v)])) as T;
  return value;
};
function memory(initial: Document[] = []) {
  const rows = clone(initial);
  const setPath = (doc: Document, key: string, value: unknown) => { const keys = key.split('.'); const last = keys.pop()!; let target = doc; for (const k of keys) target = target[k] ??= {}; target[last] = clone(value); };
  const col = {
    rows,
    findOne: jest.fn(async (query: Document) => clone(rows.find(d => match(d, query)) ?? null)),
    find: jest.fn((query: Document) => { let list = rows.filter(d => match(d, query)); return { sort: function (spec: Document) { list.sort((a,b) => { for (const [key, direction] of Object.entries(spec)) { const x = path(a,key), y = path(b,key); if (x !== y) return ((x as number) > (y as number) ? 1 : -1) * Number(direction); } return 0; }); return this; }, skip: function (n: number) { list = list.slice(n); return this; }, limit: function (n: number) { list = list.slice(0,n); return this; }, toArray: async () => clone(list) }; }),
    insertOne: jest.fn(async (doc: Document) => { doc = clone(doc); doc._id ??= new ObjectId(); rows.push(doc); return { insertedId: doc._id }; }),
    updateOne: jest.fn(async (query: Document, update: Document, options?: { upsert?: boolean }) => {
      let doc = rows.find(d => match(d, query)); let added = false;
      if (!doc && options?.upsert) { doc = clone(query); doc._id ??= new ObjectId(); rows.push(doc); added = true; }
      if (!doc) return { matchedCount: 0, upsertedCount: 0 };
      if (added) Object.assign(doc, clone(update.$setOnInsert ?? {}));
      for (const [key,value] of Object.entries(update.$set ?? {})) setPath(doc,key,value);
      for (const [key,value] of Object.entries(update.$max ?? {})) { if (doc[key] === undefined || Number(doc[key]) < Number(value)) doc[key] = clone(value); }
      for (const [key,value] of Object.entries(update.$inc ?? {})) doc[key] = (doc[key] ?? 0) + Number(value);
      for (const key of Object.keys(update.$unset ?? {})) delete doc[key];
      for (const [key,value] of Object.entries(update.$addToSet ?? {})) { doc[key] ??= []; if (!doc[key].some((v: unknown) => equal(v,value))) doc[key].push(clone(value)); }
      return { matchedCount: added ? 0 : 1, upsertedCount: added ? 1 : 0 };
    }),
  };
  return col;
}
const courseId = new ObjectId(), themeId = new ObjectId(), loId = new ObjectId(), q1 = new ObjectId(), q2 = new ObjectId(), v1 = new ObjectId(), v2 = new ObjectId();
const student: User = { puid: 'student', uid: 'student', displayName: 'Student One', email: 'student@example.test', createdAt: new Date(), affiliations: ['student'], isAdmin: false, courseRoles: [{ courseId, role: 'student' }], lastLoginAt: new Date() };
const teacher: User = { ...student, puid: 'teacher', displayName: 'Professor', courseRoles: [{ courseId, role: 'instructor' }] };
const opts = [{ key:'A', text:'Balanced forces', role:'correct', explanation:'Answer secret' }, { key:'B', text:'Unbalanced forces', role:'common-misconception', explanation:'Feedback secret' }];
let stores: Record<string, ReturnType<typeof memory>>;
beforeEach(() => {
  stores = {};
  for (const [name, accessor] of Object.entries(collections)) { if (!jest.isMockFunction(accessor)) continue; const store = memory(); stores[name] = store; (accessor as jest.Mock).mockReturnValue(store as unknown as Collection); }
  stores.coursesCol.rows.push({ _id:courseId, published:true, feedbackStrategy:'adaptive' });
  stores.themesCol.rows.push({ _id:themeId, courseId, name:'Forces', order:1, availableFrom:new Date(0) });
  stores.losCol.rows.push({ _id:loId, themeId, courseId, name:'Identify forces', order:1 });
  stores.questionsCol.rows.push(...[q1,q2].map((id,i) => ({ _id:id, courseId, currentVersionId:[v1,v2][i], state:'approved', themeIds:[themeId], loIds:[loId], createdAt:new Date(i) })));
  stores.questionVersionsCol.rows.push(...[v1,v2].map((id,i) => ({ _id:id, questionId:[q1,q2][i], version:1, type:'mcq', stem:`Question ${i+1}`, options:opts, difficulty:'easy', sourceRefs:[], createdBy:'teacher', createdAt:new Date() })));
  stores.learningSettingsCol.rows.push({ courseId, revision:1, mode:'linear', order:'instructor', questionOrder:[q2.toString(),q1.toString()], notes:[] });
});

test('finite teacher order has no duplicates; personalized evidence keeps within-LO teacher order', () => {
  const items = [{questionId:'a',loId:'x'},{questionId:'b',loId:'y'},{questionId:'c',loId:'x'}];
  expect(orderLearningItems(items,['c','a','b']).map(q => q.questionId)).toEqual(['c','a','b']);
  expect(orderLearningItems(items,['c','a','b'],new Map([['y',0.1],['x',0.8]])).map(q => q.questionId)).toEqual(['b','c','a']);
});
test('new courses default to the complete finite lesson without a settings write', async () => {
  stores.learningSettingsCol.rows.length = 0;
  expect((await getLearningSettings(courseId)).mode).toBe('linear');
  const library = await learningLibrary({puid:'student'},courseId);
  expect(library.settings.mode).toBe('linear'); expect(library.questions).toHaveLength(2);
  const lesson = await startLearningSession({puid:'student'},courseId,{kind:'lesson',themeId:themeId.toString()});
  expect(lesson.items.map(item => item.questionId)).toEqual(library.questions.map(q => q.questionId));
  expect(stores.learningSettingsCol.updateOne).not.toHaveBeenCalled();
});
test('existing legacy settings adopt linear on rollout without losing notes, order, revision or attempts', async () => {
  const stored = stores.learningSettingsCol.rows[0]; stored.mode = 'topic-practice';
  stored.notes = [{questionId:q1.toString(),visibility:'after-submit',text:'Instructor explanation'}];
  const settings = await getLearningSettings(courseId);
  expect(settings).toMatchObject({mode:'linear',revision:1,questionOrder:[q2.toString(),q1.toString()],notes:stored.notes});
  expect(stored.mode).toBe('topic-practice'); expect(stores.learningSettingsCol.updateOne).not.toHaveBeenCalled();
  const lesson = await startLearningSession({puid:'student'},courseId,{kind:'lesson',themeId:themeId.toString()});
  expect(lesson.items).toHaveLength(2); expect(stores.attemptsCol.rows).toHaveLength(0);
});
test('an instructor can explicitly opt back into legacy practice after rollout using revision CAS', async () => {
  const settings = await getLearningSettings(courseId);
  const saved = await saveLearningSettings(courseId,{...settings,mode:'topic-practice'});
  expect(saved).toMatchObject({mode:'topic-practice',teachingModeVersion:2,revision:2});
  await expect(startLearningSession({puid:'student'},courseId,{kind:'lesson'})).rejects.toMatchObject({status:409});
  await expect(saveLearningSettings(courseId,{...settings,mode:'linear'})).rejects.toMatchObject({status:409});
});
test('skip, return and submit persists the first answer exactly once, with no retry and a distinct next question', async () => {
  const actor = { puid:'student' }; let session = await startLearningSession(actor,courseId,{kind:'lesson',themeId:themeId.toString()});
  expect(session.current!.questionId).toBe(q2.toString()); expect(JSON.stringify(session)).not.toMatch(/Answer secret|Feedback secret|"role"|"correct"/);
  session = await changeLearningSession(actor,courseId,session.id,{revision:session.revision,action:'move',cursor:1}); expect(session.items[0].status).toBe('skipped');
  session = await changeLearningSession(actor,courseId,session.id,{revision:session.revision,action:'move',cursor:0});
  session = await changeLearningSession(actor,courseId,session.id,{revision:session.revision,action:'draft',key:'B'});
  expect((await getLearningSession(actor,courseId,session.id)).current!.selectedKey).toBe('B');
  session = await changeLearningSession(actor,courseId,session.id,{revision:session.revision,action:'submit'});
  expect(session.current!.answer?.correct).toBe(false); expect(session.current!.revealed).toHaveLength(2); expect(session).not.toHaveProperty('retry');
  session = await changeLearningSession(actor,courseId,session.id,{revision:session.revision,action:'submit',key:'A'});
  expect(session.current!.answer?.key).toBe('B'); expect(stores.attemptsCol.rows).toHaveLength(1);
  session = await changeLearningSession(actor,courseId,session.id,{revision:session.revision,action:'move',cursor:1}); expect(session.current!.questionId).toBe(q1.toString());
  session = await changeLearningSession(actor,courseId,session.id,{revision:session.revision,action:'move',cursor:2}); expect(session.current).toBeNull();
  session = await changeLearningSession(actor,courseId,session.id,{revision:session.revision,action:'move',cursor:1}); expect(session.current).not.toBeNull();
});
test('stale tabs cannot overwrite drafts or answers; another student cannot read the session', async () => {
  const actor = {puid:'student'}; const s = await startLearningSession(actor,courseId,{kind:'lesson'});
  await changeLearningSession(actor,courseId,s.id,{revision:0,action:'draft',key:'A'});
  await expect(changeLearningSession(actor,courseId,s.id,{revision:0,action:'submit',key:'B'})).rejects.toMatchObject({status:409});
  await expect(getLearningSession({puid:'other'},courseId,s.id)).rejects.toMatchObject({status:404});
});
test('Preview records never enter live learning, mastery, review or discussion collections', async () => {
  stores.coursesCol.rows[0].published = false;
  const actor = {puid:'teacher',previewSessionId:'11111111-1111-4111-8111-111111111111'};
  let s = await startLearningSession(actor,courseId,{kind:'lesson'});
  s = await changeLearningSession(actor,courseId,s.id,{revision:0,action:'submit',key:'B'});
  expect(stores.previewAttemptsCol.rows).toHaveLength(1); expect(stores.previewReviewMetadataCol.rows).toHaveLength(1);
  await createDiscussion(actor,teacher,courseId,{title:'Preview only',text:'Question',category:'general',audience:'course',anonymous:true});
  expect(stores.previewDiscussionPostsCol.rows).toHaveLength(1);
  for (const name of ['attemptsCol','masteryCol','reviewBookCol','reviewMetadataCol','learningSessionsCol','discussionPostsCol']) expect(stores[name].rows).toHaveLength(0);
  await expect(getLearningSession({...actor,previewSessionId:'other'},courseId,s.id)).rejects.toMatchObject({status:404});
});
test('unreleased, withdrawn and unverified numerical questions cannot be served; after-submit notes do not leak', async () => {
  stores.learningSettingsCol.rows[0].notes = [{questionId:q2.toString(),visibility:'after-submit',text:'Support secret'}];
  const actor = {puid:'student'}; let s = await startLearningSession(actor,courseId,{kind:'lesson'});
  expect(JSON.stringify(s)).not.toContain('Support secret');
  await expect(changeLearningSession(actor,courseId,s.id,{revision:0,action:'reveal'})).rejects.toMatchObject({status:409});
  s = await changeLearningSession(actor,courseId,s.id,{revision:0,action:'submit',key:'A'}); expect(s.current!.note?.text).toBe('Support secret');
  stores.questionsCol.rows[1].state = 'paused'; expect((await getLearningSession(actor,courseId,s.id)).current).toBeNull();
  stores.questionVersionsCol.rows[0].numericKind = 'numeric'; expect((await learningLibrary(actor,courseId)).questions).toHaveLength(0);
  stores.questionVersionsCol.rows[0].numericKind = 'conceptual'; stores.themesCol.rows[0].availableFrom = new Date(Date.now()+100000); expect((await learningLibrary(actor,courseId)).questions).toHaveLength(0);
});
test('flashcard reveal/rating writes only review metadata and no graded attempts', async () => {
  const actor = {puid:'student'}; let s = await startLearningSession(actor,courseId,{kind:'cards',roundId:'round'});
  s = await changeLearningSession(actor,courseId,s.id,{revision:0,action:'reveal'}); expect(s.current!.revealed).toHaveLength(2);
  await changeLearningSession(actor,courseId,s.id,{revision:s.revision,action:'rate',rating:'learning'});
  expect(stores.reviewMetadataCol.rows[0].confusing).toBe(true); expect(stores.attemptsCol.rows).toHaveLength(0); expect(stores.masteryCol.rows).toHaveLength(0);
});
test('self-test creates separate review evidence and preserves lesson/mastery; repeat submit is idempotent', async () => {
  const actor = {puid:'student'}; let lesson = await startLearningSession(actor,courseId,{kind:'lesson'});
  lesson = await changeLearningSession(actor,courseId,lesson.id,{revision:0,action:'submit',key:'A'});
  const mastery = clone(stores.masteryCol.rows);
  let review = await startLearningSession(actor,courseId,{kind:'test',questionIds:[q2.toString()],roundId:'review'});
  review = await changeLearningSession(actor,courseId,review.id,{revision:0,action:'submit',key:'B'});
  await changeLearningSession(actor,courseId,review.id,{revision:review.revision,action:'submit',key:'A'});
  expect(stores.attemptsCol.rows.map(r => r.mode)).toEqual(['topic-practice','review-book']);
  expect(stores.masteryCol.rows).toEqual(mastery); expect((await getLearningSession(actor,courseId,lesson.id)).current!.answer?.key).toBe('A');
});
test('settings reject foreign questions and invalid page ranges', async () => {
  const base = {revision:1,mode:'linear' as const,order:'instructor' as const,questionOrder:[],notes:[]};
  await expect(saveLearningSettings(courseId,{...base,questionOrder:[new ObjectId().toString()]})).rejects.toThrow('does not belong');
  await expect(saveLearningSettings(courseId,{...base,notes:[{questionId:q1.toString(),visibility:'always',text:'Note',pageStart:5,pageEnd:2}]})).rejects.toThrow('page range');
});
async function post(audience: 'course' | 'staff' = 'course') { return createDiscussion({puid:student.puid},student,courseId,{title:'Why?',text:'Help with forces',category:'concept',audience,anonymous:true,questionId:q1.toString(),themeId:new ObjectId().toString()}); }
test('question linkage is server-derived; question preview never exposes the answer', async () => {
  const p = await post(); expect(p.themeId).toBe(themeId.toString()); expect(p.loId).toBe(loId.toString());
  const preview = await discussionQuestionPreview({puid:'student'},courseId,q1.toString()); expect(JSON.stringify(preview)).not.toMatch(/secret|role|correct/);
  const general = await createDiscussion({puid:'student'},student,courseId,{title:'Schedule',text:'When?',category:'logistics',audience:'course',anonymous:false}); expect(general.themeId).toBeUndefined(); expect(general.loId).toBeUndefined();
});
test('anonymous authors and replies are redacted for classmates but visible to teachers; private posts stay private', async () => {
  const p = await post(); expect(p.author.name).toBe('Anonymous student'); expect(p.author).not.toHaveProperty('puid');
  await changeDiscussion({puid:'student'},student,courseId,p.id,{revision:p.revision,action:'reply',kind:'student',text:'An answer',anonymous:true});
  const peer = {...student,puid:'peer'};
  const viewed = await listDiscussion({puid:'peer'},peer,courseId); expect(viewed.posts[0].replies[0].author.name).toBe('Anonymous student'); expect(viewed.posts[0].replies[0].author).not.toHaveProperty('puid');
  const staff = await listDiscussion({puid:'teacher'},teacher,courseId); expect(staff.posts[0].author.puid).toBe('student'); expect(staff.posts[0].replies[0].author.name).toBe('Student One');
  await post('staff'); expect((await listDiscussion({puid:'peer'},peer,courseId)).posts).toHaveLength(1); expect((await listDiscussion({puid:'teacher'},teacher,courseId)).posts).toHaveLength(2);
});
test('instructor close rejects new answers/followups; only instructors delete/undo; close is independent of resolved', async () => {
  let p = await post(); await expect(changeDiscussion({puid:'student'},student,courseId,p.id,{revision:0,action:'close'})).rejects.toMatchObject({status:403});
  p = await changeDiscussion({puid:'teacher'},teacher,courseId,p.id,{revision:0,action:'close'}); expect(p.closed).toBe(true); expect(p.resolved).toBe(false);
  await expect(changeDiscussion({puid:'student'},student,courseId,p.id,{revision:p.revision,action:'reply',kind:'followup',text:'Follow-up',anonymous:true})).rejects.toMatchObject({status:409});
  p = await changeDiscussion({puid:'teacher'},teacher,courseId,p.id,{revision:p.revision,action:'delete'}); expect((await listDiscussion({puid:'student'},student,courseId)).posts).toHaveLength(0);
  p = await changeDiscussion({puid:'teacher'},teacher,courseId,p.id,{revision:p.revision,action:'restore'}); expect(p.deleted).toBe(false); expect((await listDiscussion({puid:'student'},student,courseId)).posts).toHaveLength(1);
});
test('students cannot impersonate official answers, endorse, pin, restore or moderate another course', async () => {
  const p = await post();
  for (const action of ['pin','delete','restore','resolve','endorse'] as const) await expect(changeDiscussion({puid:'student'},student,courseId,p.id,{revision:0,action})).rejects.toMatchObject({status:403});
  await expect(changeDiscussion({puid:'student'},student,courseId,p.id,{revision:0,action:'reply',kind:'instructor',text:'Pretend official'})).rejects.toMatchObject({status:403});
  const wrongTeacher = {...teacher,courseRoles:[{courseId:new ObjectId(),role:'instructor' as const}]};
  await expect(changeDiscussion({puid:'teacher'},wrongTeacher,courseId,p.id,{revision:0,action:'close'})).rejects.toMatchObject({status:403});
});

test('reopening a lesson appends newly released questions once without reordering submitted questions', async () => {
  const actor = {puid:'student'};
  let s = await startLearningSession(actor,courseId,{kind:'lesson',themeId:themeId.toString()});
  s = await changeLearningSession(actor,courseId,s.id,{revision:0,action:'submit',key:'A'});
  const q = new ObjectId(), v = new ObjectId();
  stores.questionsCol.rows.push({...clone(stores.questionsCol.rows[0]),_id:q,currentVersionId:v});
  stores.questionVersionsCol.rows.push({...clone(stores.questionVersionsCol.rows[0]),_id:v,questionId:q,stem:'New question'});
  const reopened = await startLearningSession(actor,courseId,{kind:'lesson',themeId:themeId.toString()});
  expect(reopened.id).toBe(s.id); expect(reopened.items).toHaveLength(3); expect(reopened.items[0].status).toBe('correct'); expect(reopened.items[2].questionId).toBe(q.toString());
  expect((await startLearningSession(actor,courseId,{kind:'lesson',themeId:themeId.toString()})).items).toHaveLength(3); expect(stores.attemptsCol.rows).toHaveLength(1);
});
