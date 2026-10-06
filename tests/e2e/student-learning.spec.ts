import type { LearningView, LearningSettings, DiscussionPost } from '../../client/src/student-learning-api.js';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const course = '660000000000000000000001';
const theme = '660000000000000000000002';
const lo = '660000000000000000000003';
const ids = ['660000000000000000000004','660000000000000000000005'];
const questions = ids.map((id,i) => ({questionId:id,versionId:id,loId:lo,loName:'Identify forces on an object',themeId:theme,themeName:'Forces and Vectors',stem:i ? 'Which forces act on a pulled crate?' : 'A book rests on a table. Which forces act on the book?',difficulty:'easy',saved:false,mistake:false,answered:false,confusing:false,tags:[]}));
type MockSession = Omit<LearningView, 'current'> & { answers: Record<number, { key: string; correct: boolean }>; drafts: Record<number, string>; revealed?: boolean };
async function setup(page: Page, staff = false) {
  await page.route('**/learning-fixture', r => r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><title>FinanceBot learning</title><link rel="stylesheet" href="/styles/main.css"><link rel="stylesheet" href="/styles/student-learning.css"><script src="/vendor/katex.min.js"></script><script src="/vendor/katex-auto-render.min.js"></script><script src="/vendor/marked.min.js"></script><script src="/vendor/purify.min.js"></script></head><body><main id="fixture" style="padding:20px"></main></body></html>'}));
  const rows = structuredClone(questions); let session!: MockSession;
  const posts: DiscussionPost[] = [];
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname; const input = route.request().method() === 'GET' ? {} : route.request().postDataJSON();
    const respond = (json: unknown) => route.fulfill({json});
    if (path.endsWith('/learning/library')) return respond({settings:{mode:'linear',order:'instructor'},questions:rows});
    if (path.endsWith('/metadata')) { Object.assign(rows.find(q => path.includes(q.questionId))!,input); return respond({}); }
    if (path.endsWith('/learning/sessions') && route.request().method() === 'POST') {
      const chosen = input.questionIds ? rows.filter(q => input.questionIds.includes(q.questionId)) : rows;
      session = {id:'660000000000000000000010',kind:input.kind,revision:0,cursor:0,items:chosen.map(q => ({questionId:q.questionId,loId:lo,loName:q.loName,themeName:q.themeName,title:q.stem,status:'unanswered'})),answers:{},drafts:{}};
    } else if (path.includes('/learning/sessions/')) {
      if (input.action === 'move') { if (session.items[session.cursor] && !session.answers[session.cursor]) session.items[session.cursor].status = 'skipped'; session.cursor = input.cursor; }
      if (input.action === 'draft') session.drafts[session.cursor] = input.key;
      if (input.action === 'submit') { const key = input.key ?? session.drafts[session.cursor]; session.answers[session.cursor] = {key,correct:key === 'A'}; session.items[session.cursor].status = key === 'A' ? 'correct' : 'incorrect'; }
      if (input.action === 'reveal') session.revealed = true;
      if (input.action === 'rate') session.items[session.cursor].status = input.rating;
      if (input.action) session.revision++;
    }
    if (path.includes('/learning/sessions')) {
      const item = session.items[session.cursor], q = item && rows.find(q => q.questionId === item.questionId);
      const answer = session.answers[session.cursor];
      return respond({...session,current:q ? {questionId:q.questionId,loId:lo,loName:q.loName,themeName:q.themeName,stem:q.stem,difficulty:'easy',options:[{key:'A',text:'Gravity downward and a normal force upward.'},{key:'B',text:'Only gravity.'}],selectedKey:session.drafts[session.cursor],answer,...(answer || session.revealed ? {revealed:[{key:'A',text:'Gravity downward and a normal force upward.',correct:true,explanation:'These two forces balance.'},{key:'B',text:'Only gravity.',correct:false,explanation:'The table also exerts a normal force.'}]} : {})} : null});
    }
    if (path.endsWith('/discussion/questions')) return respond(rows.map(q => ({id:q.questionId,title:q.stem,themeId:theme,themeName:q.themeName,loId:lo,loName:q.loName})));
    if (path.includes('/discussion/questions/')) return respond({stem:rows.find(q => path.endsWith(q.questionId))?.stem,options:[{key:'A',text:'Gravity downward and a normal force upward.'},{key:'B',text:'Only gravity.'}]});
    if (path.endsWith('/discussion')) {
      if (route.request().method() === 'POST') posts.unshift({...input,id:'660000000000000000000020',revision:0,themeId:input.questionId ? theme : input.themeId,loId:input.questionId ? lo : input.loId,pinned:false,resolved:false,closed:false,deleted:false,staff,moderator:staff,author:{name:input.anonymous?'Anonymous student':'Student',anonymous:input.anonymous,mine:true},votes:0,voted:false,following:false,replies:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
      if (route.request().method() === 'POST') return respond(posts[0]);
      return respond({staff,moderator:staff,posts:posts.filter(p => !p.deleted),themes:[{id:theme,name:'Forces and Vectors'}],los:[{id:lo,name:'Identify forces on an object',themeId:theme}]});
    }
    if (path.includes('/discussion/')) {
      const post = posts.find(p => path.endsWith(p.id))!;
      if (input.action === 'reply') post.replies.push({id:'660000000000000000000030',kind:input.kind,text:input.text,staff:false,author:{name:input.anonymous?'Anonymous student':'Student',anonymous:input.anonymous,mine:true},endorsed:false,createdAt:new Date().toISOString()});
      if (input.action === 'close') post.closed = true;
      if (input.action === 'reopen') post.closed = false;
      if (input.action === 'delete') post.deleted = true;
      if (input.action === 'restore') post.deleted = false;
      post.revision++; return respond(post);
    }
    return route.fulfill({status:404,json:{error:'Unconfigured test API'}});
  });
  await page.goto('/learning-fixture');
}
async function lesson(page: Page) {
  await page.evaluate(async ({course,theme}) => {
    const {renderLinearLesson} = await import('/js/views/student/learning-workspace.js'); const {LIVE_STUDENT_EXPERIENCE} = await import('/js/views/student/experience.js'); await renderLinearLesson(document.getElementById('fixture')!,course,theme,LIVE_STUDENT_EXPERIENCE);
  },{course,theme});
}
async function discussion(page: Page) { await page.evaluate(async course => { const {renderDiscussion} = await import('/js/views/student/discussion.js'); await renderDiscussion(document.getElementById('fixture')!,{id:course}); },course); }
async function composePost(page: Page) { await page.getByRole('button',{name:'New post',exact:true}).first().click(); await page.getByRole('textbox',{name:'Post title'}).fill('Why does the book stay still?'); await page.getByRole('textbox',{name:'Post details'}).fill('I need help identifying the forces.'); await page.getByRole('button',{name:'Publish post'}).click(); }

test('lesson skip/return, fixed controls, board, submission and finite summary', async ({page}) => {
  await setup(page); await lesson(page);
  await page.screenshot({path:'test-results/student-learning-reader.png',fullPage:true});
  await expect(page.getByRole('button',{name:'Submit',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Personal tags'})).toHaveCount(0); await expect(page.getByRole('link',{name:'Ask the class'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Save to Review Book'})).toBeVisible(); await expect(page.getByRole('button',{name:'Report a problem'})).toBeVisible();
  await page.getByRole('button',{name:'Next question →',exact:true}).click(); await page.getByRole('button',{name:'← Previous question',exact:true}).click();
  await expect(page.getByText('You skipped this question. You can answer it now.')).toBeVisible();
  await page.getByRole('button',{name:'B Only gravity.',exact:true}).click(); await page.getByRole('button',{name:'Submit',exact:true}).click();
  await expect(page.getByText('Review the explanation, then continue to the next question.')).toBeVisible(); await expect(page.getByRole('button',{name:'Submit',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Next question →',exact:true}).click(); await page.getByRole('button',{name:'Next question →',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Lesson summary'})).toBeVisible(); await page.getByRole('button',{name:'Return to unanswered questions'}).click();
  await expect(page.getByText('Which forces act on a pulled crate?',{exact:true}).last()).toBeVisible();
  await page.getByRole('button',{name:'▦ Question board · 2'}).click(); await expect(page.getByRole('dialog',{name:'Question board'})).toBeVisible(); await page.getByRole('combobox',{name:'Question status'}).selectOption('skipped'); await expect(page.getByRole('dialog').getByRole('button',{name:'2 · skipped'})).toBeVisible();
});
test('review browse controls remain fixed after reveal; self-test omits tags/class actions', async ({page}) => {
  await setup(page);
  await page.evaluate(async course => { const {renderReviewLibrary} = await import('/js/views/student/learning-workspace.js'); const {LIVE_STUDENT_EXPERIENCE} = await import('/js/views/student/experience.js'); await renderReviewLibrary(document.getElementById('fixture')!,course,LIVE_STUDENT_EXPERIENCE); },course);
  await page.getByRole('button',{name:'Show answer & explanation'}).click(); await expect(page.getByRole('button',{name:'Test this question'})).toBeVisible();
  await page.getByRole('button',{name:'Next question →',exact:true}).click(); await expect(page.getByText('Which forces act on a pulled crate?',{exact:true}).last()).toBeVisible();
  await page.getByRole('button',{name:'Personal tags'}).click(); await page.getByRole('textbox',{name:'Personal tags',exact:true}).fill('Keep forgetting'); await page.getByRole('button',{name:'Save tags'}).click();
  await page.getByRole('button',{name:'Random self-test'}).click(); await expect(page.getByRole('button',{name:'Personal tags'})).toHaveCount(0); await expect(page.getByRole('link',{name:'Ask the class'})).toHaveCount(0); await expect(page.getByRole('button',{name:'Submit',exact:true})).toBeVisible();
});
test('question-first composer previews choices, locks linkage, optional clearing and anonymous answers/followups', async ({page}) => {
  await setup(page); await discussion(page); await page.getByRole('button',{name:'New post',exact:true}).first().click();
  await expect(page.getByText('Course tags',{exact:true})).toHaveCount(0);
  await page.getByRole('combobox',{name:'Related question',exact:true}).selectOption(ids[0]); await expect(page.getByText('Gravity downward and a normal force upward.',{exact:true})).toBeVisible();
  await expect(page.getByRole('combobox',{name:'Topic (optional)',exact:true})).toBeDisabled(); await expect(page.getByRole('combobox',{name:'Learning objective (optional)',exact:true})).toHaveValue(lo);
  await page.getByRole('combobox',{name:'Related question',exact:true}).selectOption(''); await expect(page.getByRole('combobox',{name:'Topic (optional)',exact:true})).toBeEnabled(); await expect(page.getByRole('combobox',{name:'Learning objective (optional)',exact:true})).toHaveValue('');
  await expect(page.getByRole('combobox',{name:'Post type',exact:true}).locator('option')).toHaveCount(7);
  await page.getByRole('textbox',{name:'Post title'}).fill('Why does the book stay still?'); await page.getByRole('textbox',{name:'Post details'}).fill('I need help identifying the forces.'); await page.getByRole('checkbox',{name:'Anonymous to classmates'}).check(); await page.getByRole('button',{name:'Publish post'}).click();
  const answers = page.locator('.discussion-answer-section--student'); await answers.getByRole('textbox',{name:'Your answer'}).fill('The forces balance.'); await answers.getByRole('checkbox',{name:'Anonymous to classmates'}).check(); await answers.getByRole('button',{name:'Post answer'}).click(); await expect(answers.getByText('Anonymous student',{exact:true})).toBeVisible();
  const followup = page.locator('.discussion-answer-section--followup'); await followup.getByRole('textbox',{name:'Follow-up'}).fill('Thanks!'); await followup.getByRole('checkbox',{name:'Anonymous to classmates'}).check(); await followup.getByRole('button',{name:'Post follow-up'}).click(); await expect(followup.getByText('Anonymous student',{exact:true})).toBeVisible();
});
test('instructor closes/reopens and deletes/undoes without losing answers', async ({page}) => {
  await setup(page,true); await discussion(page); await composePost(page);
  await page.screenshot({path:'test-results/student-learning-discussion.png',fullPage:true});
  await page.getByRole('button',{name:'Close post',exact:true}).click(); await expect(page.getByText('This post is closed. Existing answers remain available.')).toBeVisible(); await expect(page.getByRole('textbox',{name:'Your answer'})).toHaveCount(0);
  await page.getByRole('button',{name:'Reopen post',exact:true}).click(); await expect(page.getByRole('textbox',{name:'Your answer'}).first()).toBeVisible();
  await page.getByRole('button',{name:'Delete',exact:true}).click(); await page.getByRole('dialog').getByRole('button',{name:'Delete post'}).click(); await expect(page.getByText('Post deleted.')).toBeVisible(); await page.getByRole('button',{name:'Undo',exact:true}).click(); await expect(page.getByRole('heading',{name:'Why does the book stay still?'})).toBeVisible();
});
test('desktop/mobile readers and composer have no overflow or WCAG A/AA violations', async ({page}) => {
  await setup(page); await lesson(page);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()).violations).toEqual([]);
  await page.setViewportSize({width:390,height:844}); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => document.getElementById('fixture')!.replaceChildren()); await discussion(page); await page.getByRole('button',{name:'New post',exact:true}).first().click();
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()).violations).toEqual([]);
});

test('teacher configures linear mode, order and per-question notes without changing another question', async ({page}) => {
  await setup(page,true);
  let saved: LearningSettings | undefined;
  await page.route('**/api/courses/*/learning-settings', route => {
    if (route.request().method() === 'PUT') saved = route.request().postDataJSON();
    return route.fulfill({json: saved ?? {revision:0,mode:'topic-practice',order:'instructor',questionOrder:[],notes:[]}});
  });
  await page.route('**/api/courses/*/questions**', route => route.fulfill({json:{total:2,questions:questions.map(q => ({id:q.questionId,state:'approved',loIds:[lo],themeIds:[theme],current:{stem:q.stem,type:'mcq',difficulty:'easy',options:[]}}))}}));
  await page.route('**/api/courses/*/materials', route => route.fulfill({json:[]}));
  await page.evaluate(async course => { const {teachingSettingsPanel} = await import('/js/views/instructor/teaching-settings.js'); document.getElementById('fixture')!.append(teachingSettingsPanel(course)); },course);
  await page.getByRole('combobox',{name:'Teaching mode',exact:true}).selectOption('linear');
  await page.getByRole('combobox',{name:'Question sequence',exact:true}).selectOption('personalized');
  await page.getByRole('checkbox',{name:'Show instructor notes for this question'}).check();
  await page.getByRole('textbox',{name:'Instructor notes text'}).fill('Read the force diagram.');
  await page.getByRole('combobox',{name:'Notes visibility'}).selectOption('after-submit');
  await page.getByRole('combobox',{name:'Question for instructor notes'}).selectOption(ids[1]);
  await expect(page.getByRole('textbox',{name:'Instructor notes text'})).toHaveValue('');
  await page.getByRole('button',{name:'Save teaching settings'}).click();
  await expect(page.getByText('Teaching settings saved.')).toBeVisible();
  expect(saved?.mode).toBe('linear'); expect(saved?.order).toBe('personalized'); expect(saved?.notes).toEqual([{questionId:ids[0],visibility:'after-submit',text:'Read the force diagram.'}]);
});
