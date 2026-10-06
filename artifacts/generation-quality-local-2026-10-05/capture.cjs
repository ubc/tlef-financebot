/* Real local app screenshots and source-integrity/scroll checks, with no model mocks. */
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { chromium } = require('@playwright/test');
const { ObjectId } = require('mongodb');
const root = process.cwd(), out = path.join(root, 'artifacts/generation-quality-local-2026-10-05');
const mongo = require(path.join(root, 'server/dist/components/mongodb'));
const cols = require(path.join(root, 'server/dist/components/mongodb/collections'));
const q = require(path.join(root, 'server/dist/services/questions.service'));
const embed = require(path.join(root, 'server/dist/components/genai/embeddings'));
const vectors = require(path.join(root, 'server/dist/components/qdrant'));
const mat = require(path.join(root, 'server/dist/services/materials.service'));
let browser;
(async()=>{
const report = JSON.parse(await fs.readFile(path.join(out,'evidence.json'),'utf8'));
report.screenshots = report.screenshots.filter(s => !s.url.endsWith('/admin/users'));
const save = () => fs.writeFile(path.join(out,'evidence.json'),JSON.stringify(report,null,2));
browser = await chromium.launch({headless:true});
const ctx = await browser.newContext({ baseURL:'http://localhost:6118',storageState:path.join(root,'tests/e2e/.auth/quality-local.json'),viewport:{width:1680,height:1050},reducedMotion:'reduce' });
const page = await ctx.newPage();
const shot = async(name,caption) => { await page.screenshot({path:path.join(out,'images',name+'.png')});report.screenshots.push({name,caption,url:page.url(),viewport:page.viewportSize()});await save();console.log('SCREENSHOT',name); };
const go = async(hash) => {await page.goto('/#'+hash);await page.waitForTimeout(1300);};
const courseId = new ObjectId(report.courseId);
await go(`/instructor/course/${report.courseId}/preseeding`);
await page.getByRole('checkbox',{name:'Sources and question memory pilot'}).waitFor();
await shot('02-generation-baseline','Real Generate questions form: pilot is off by default');
await page.getByRole('checkbox',{name:'Sources and question memory pilot'}).check();
await shot('03-generation-pilot','Real Generate questions form: pilot enabled by the author');
// Inspect the actual failed live run; do not fabricate a successful generation.
const btn = page.locator(`[data-gw-focus="steps-${report.runs[0].runId}"]`);
if (!await btn.isVisible()) { const activity = page.getByRole('button',{name:/Activity|Generation activity|View activity/i}); if(await activity.count()) await activity.first().click(); }
if (await btn.isVisible()) { await btn.click(); await page.waitForTimeout(800); await shot('04-baseline-checks','Live provider failure and unavailable token usage'); await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click(); }
await mongo.connectMongo();
const material=await cols.materialsCol().findOne({courseId});
const vector=await embed.embedOne(report.sourceText);
const collection=mat.courseCollection(courseId);
await vectors.deletePointsByFilter(collection,{must:[{key:'materialId',match:{value:material._id.toHexString()}}]});
await vectors.upsertPoints(collection,[{id:randomUUID(),vector,payload:{materialId:material._id.toHexString(),chunkIndex:0,chunk:'Stale vector content intentionally differs from original Mongo source.'}}]);
const start=await ctx.request.post(`/api/courses/${report.courseId}/generate`,{data:{loId:report.loId,count:1,type:'mcq',difficulty:'easy',kind:'conceptual',qualityPolicy:'grounded-memory-v1',prompt:'Stay within lecture scope.'}});
const initiated=await start.json();
if(!start.ok()) throw new Error('Pilot start HTTP '+start.status());
let snap;
for(let i=0;i<30;i++){const r=await ctx.request.get(`/api/courses/${report.courseId}/content-runs/${initiated.runId}`);snap=await r.json();if(['completed','partial','failed'].includes(snap.status))break;await page.waitForTimeout(1000);}
const usage=await(await ctx.request.get(`/api/courses/${report.courseId}/content-runs/${initiated.runId}/usage`)).json();
report.runs.push({name:'Source integrity challenge',runId:initiated.runId,snapshot:snap,usage});
report.checks.push({name:'Stale vector text rejected before paid generation',status:snap.error?.code==='generation-evidence-stale-retrieval'&&usage.summary?.observedCalls===0?'pass':'fail',error:snap.error,observedCalls:usage.summary?.observedCalls});
await vectors.deletePointsByFilter(collection,{must:[{key:'materialId',match:{value:material._id.toHexString()}}]});
await vectors.upsertPoints(collection,[{id:randomUUID(),vector,payload:{materialId:material._id.toHexString(),chunkIndex:0,chunk:report.sourceText}}]);
report.sourceIndexRestored=true;
await save();
await go(`/instructor/course/${report.courseId}/preseeding`);
const next=page.locator(`[data-gw-focus="steps-${initiated.runId}"]`);
if(!await next.isVisible()){const activity=page.getByRole('button',{name:/Activity|View activity/i});if(await activity.count())await activity.first().click();}
if(await next.isVisible()){await next.click();await page.waitForTimeout(800);await shot('05-source-integrity','Original-source gate rejects intentionally stale retrieval before a model call');await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();}
// A manual long question isolates the original scrolling regression from LLM availability.
const explanation=Array.from({length:14},(_,i)=>`Reasoning section ${i+1}: beta_i measures systematic market risk. Total volatility also contains diversifiable firm-specific risk. Compare the exposure priced by CAPM rather than the length of the explanation.`).join('\n\n')+'\n\nSCROLL CHECK END: final answer explanation is reachable.';
const lo=await cols.losCol().findOne({_id:new ObjectId(report.loId)});
const created=await q.createQuestion({courseId,loIds:[lo._id],themeIds:[lo.themeId],type:'mcq',difficulty:'easy',numericKind:'conceptual',createdBy:report.actor,stem:'Scroll regression fixture: Two assets have the same beta_i but different total volatility. What does CAPM imply about their required returns?',options:[{key:'A',text:'Equal CAPM required returns',role:'correct',explanation},{key:'B',text:'Higher total volatility always means a higher CAPM return',role:'common-misconception',explanation:'Total volatility is not beta_i.'},{key:'C',text:'Only diversifiable risk is priced',role:'partially-correct',explanation:'CAPM prices systematic risk.'},{key:'D',text:'CAPM cannot compare assets',role:'clearly-wrong',explanation:'CAPM gives the comparison when beta_i is known.'}],sourceRefs:[{materialId:material._id,chunk:report.sourceText}],optionsAlreadyShuffled:true});
report.scrollQuestionId=created.questionId.toHexString();
await go(`/ta/course/${report.courseId}/review`);
const row=page.getByRole('button',{name:/Scroll regression fixture/}).first();
await row.waitFor();await row.click();await page.waitForTimeout(700);
await shot('06-ta-scroll-top','Real TA Review Queue: long manual fixture before scrolling');
const reader=page.locator('.ta-embedded');
const before=await reader.evaluate(el=>({scrollTop:el.scrollTop,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight}));
const box=await reader.boundingBox();await page.mouse.move(box.x+Math.min(180,box.width/2),box.y+box.height/2);await page.mouse.wheel(0,2200);await page.waitForTimeout(450);
const afterWheel=await reader.evaluate(el=>el.scrollTop);
await reader.evaluate(el=>el.scrollTop=el.scrollHeight);await page.waitForTimeout(400);
const reachable=await page.getByText('SCROLL CHECK END:',{exact:false}).first().evaluate(el=>{const r=el.getBoundingClientRect(),p=el.closest('.ta-embedded').getBoundingClientRect();return r.top<p.bottom&&r.bottom>p.top;}).catch(()=>false);
await shot('07-ta-scroll-bottom','Real TA Review Queue: final explanation reached with the action footer visible');
report.checks.push({name:'TA desktop reader accepts wheel input and reaches final content',status:afterWheel>before.scrollTop&&reachable?'pass':'fail',before,afterWheel,endMarkerVisible:reachable});
await page.setViewportSize({width:390,height:844});await go(`/ta/course/${report.courseId}/review`);await page.getByRole('button',{name:/Scroll regression fixture/}).first().click();await page.waitForTimeout(500);
await page.getByText('SCROLL CHECK END:',{exact:false}).first().scrollIntoViewIfNeeded();await shot('08-ta-mobile','Real narrow TA view: final explanation reachable by page scrolling');
await page.setViewportSize({width:1680,height:1050});
await go(`/admin/operations?tab=usage&courseId=${report.courseId}`);await shot('09-admin-usage','Model usage for the failed real provider invocation');
const call=page.locator('.ac-table-scroll tbody button').first();if(await call.count()){await call.click();await page.waitForTimeout(500);await shot('10-admin-call-detail','Per-call diagnostics in Admin Operations');}
await go(`/admin/operations?tab=workflows&courseId=${report.courseId}`);await shot('11-admin-workflow','Actual recorded course actions and runs; temporal grouping is labelled');
const windowRow=page.getByRole('button',{name:/Activity window/}).first();if(await windowRow.count()){await windowRow.click();await page.waitForTimeout(500);await shot('12-admin-workflow-detail','Actual timeline event details');}
report.adminUsage=await(await ctx.request.get(`/api/admin/model-usage?courseId=${report.courseId}`)).json();
report.workflow=await(await ctx.request.get(`/api/admin/workflows?courseId=${report.courseId}`)).json();
report.finishedAt=new Date().toISOString();await save();console.log('DONE');
})().catch(e=>{console.error('CAPTURE_FAILED',e.message);process.exitCode=1;}).finally(async()=>{await mongo.closeMongo();await browser?.close();});
