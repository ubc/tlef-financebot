import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import mongo from '../server/dist/components/mongodb/index.js';
import c from '../server/dist/components/mongodb/collections.js';
import learning from '../server/dist/services/student-learning.service.js';
import discussion from '../server/dist/services/discussion.service.js';

// Run after npm run build:server with MONGODB_DB_NAME=financebot_student_learning_smoke_<unique suffix>.
// The prefix check prevents this verifier from ever dropping an application database.
(async () => {
  const db = await mongo.connectMongo();
  assert.match(db.databaseName, /^financebot_student_learning_smoke_[a-zA-Z0-9_]+$/);
  try {
    await c.ensureIndexes();
    const courseId = new ObjectId(), themeId = new ObjectId(), loId = new ObjectId();
    const ids = [new ObjectId(),new ObjectId()], versions = [new ObjectId(),new ObjectId()];
    await c.coursesCol().insertOne({_id:courseId,name:'Temporary learning verification',published:true,feedbackStrategy:'adaptive',createdAt:new Date()});
    await c.themesCol().insertOne({_id:themeId,courseId,name:'Forces',order:1,availableFrom:new Date(0)});
    await c.losCol().insertOne({_id:loId,themeId,courseId,name:'Identify forces',order:1});
    for (let i=0;i<ids.length;i++) {
      await c.questionsCol().insertOne({_id:ids[i],courseId,currentVersionId:versions[i],state:'approved',themeIds:[themeId],loIds:[loId],createdAt:new Date(i),updatedAt:new Date()});
      await c.questionVersionsCol().insertOne({_id:versions[i],questionId:ids[i],version:1,type:'mcq',stem:`A book rests on a table (${i+1}). Which forces act on it?`,difficulty:'easy',options:[{key:'A',text:'Weight and normal force',role:'correct',explanation:'These forces balance.'},{key:'B',text:'Only gravity',role:'common-misconception',explanation:'The table also acts on the book.'}],sourceRefs:[],createdAt:new Date(),createdBy:'qa'});
    }
    await learning.saveLearningSettings(courseId,{revision:0,mode:'linear',order:'instructor',questionOrder:ids.map(String),notes:[{questionId:String(ids[0]),visibility:'after-submit',text:'Instructor support'}]});
    const actor={puid:'qa-student'};
    const starts=await Promise.all([learning.startLearningSession(actor,courseId,{kind:'lesson',themeId:String(themeId)}),learning.startLearningSession(actor,courseId,{kind:'lesson',themeId:String(themeId)})]);
    assert.equal(starts[0].id,starts[1].id); assert.equal(await c.learningSessionsCol().countDocuments(),1);
    const session=starts[0]; assert.equal(session.current.note,undefined);
    const concurrent=await Promise.allSettled(['A','B'].map(key=>learning.changeLearningSession(actor,courseId,session.id,{revision:0,action:'submit',key})));
    assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1); assert.equal(concurrent.filter(r=>r.status==='rejected'&&r.reason.status===409).length,1);
    let state=await learning.getLearningSession(actor,courseId,session.id); assert.equal(await c.attemptsCol().countDocuments(),1); assert.equal(state.current.note.text,'Instructor support');
    state=await learning.changeLearningSession(actor,courseId,session.id,{revision:state.revision,action:'submit',key:'B'}); assert.equal(await c.attemptsCol().countDocuments(),1);
    const library=await learning.learningLibrary(actor,courseId); assert.equal(library.questions.length,2);
    await learning.updateReviewMetadata(actor,courseId,String(ids[1]),{saved:true,tags:['keep forgetting'],confusing:true});
    assert.equal((await learning.learningLibrary(actor,courseId)).questions[1].saved,true);
    const card=await learning.startLearningSession(actor,courseId,{kind:'cards',questionIds:[String(ids[1])],roundId:'11111111-1111-4111-8111-111111111111'});
    const cards=await learning.changeLearningSession(actor,courseId,card.id,{revision:0,action:'reveal'}); await learning.changeLearningSession(actor,courseId,card.id,{revision:cards.revision,action:'rate',rating:'learning'}); assert.equal(await c.attemptsCol().countDocuments(),1);
    const student={puid:'qa-student',uid:'qa-student',displayName:'QA Student',isAdmin:false,courseRoles:[{courseId,role:'student'}]};
    const teacher={...student,puid:'qa-teacher',displayName:'QA Teacher',courseRoles:[{courseId,role:'instructor'}]};
    let post=await discussion.createDiscussion(actor,student,courseId,{title:'Why?',text:'Question',category:'general',audience:'course',anonymous:true,questionId:String(ids[0])}); assert.equal(post.author.puid,undefined);
    post=await discussion.changeDiscussion(actor,student,courseId,post.id,{revision:0,action:'reply',kind:'student',text:'Because the forces balance.',anonymous:true});
    assert.equal((await discussion.listDiscussion({puid:teacher.puid},teacher,courseId)).posts[0].replies[0].author.puid,actor.puid);
    post=await discussion.changeDiscussion({puid:teacher.puid},teacher,courseId,post.id,{revision:post.revision,action:'close'});
    await assert.rejects(()=>discussion.changeDiscussion(actor,student,courseId,post.id,{revision:post.revision,action:'reply',kind:'followup',text:'More'}),e=>e.status===409);
    post=await discussion.changeDiscussion({puid:teacher.puid},teacher,courseId,post.id,{revision:post.revision,action:'delete'});
    assert.equal((await discussion.listDiscussion(actor,student,courseId)).posts.length,0);
    await discussion.changeDiscussion({puid:teacher.puid},teacher,courseId,post.id,{revision:post.revision,action:'restore'});
    assert.equal((await discussion.listDiscussion(actor,student,courseId)).posts.length,1);
    const preview={puid:'qa-teacher',previewSessionId:'11111111-1111-4111-8111-111111111111'};
    const ps=await learning.startLearningSession(preview,courseId,{kind:'lesson',themeId:String(themeId)});
    await learning.changeLearningSession(preview,courseId,ps.id,{revision:0,action:'submit',key:'B'});
    assert.equal(await c.previewAttemptsCol().countDocuments(),1); assert.equal(await c.attemptsCol().countDocuments(),1);
    console.log('Real MongoDB checks passed: indexes, start race, submit CAS, exactly-once attempts, notes, bookmarks/tags, flashcards, anonymous privacy, close/delete/undo, Preview isolation.');
  } finally { await db.dropDatabase(); await mongo.closeMongo(); console.log('Temporary verification database removed.'); }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
