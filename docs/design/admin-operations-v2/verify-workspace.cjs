'use strict';
const {chromium}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const base='http://127.0.0.1:6133/admin-operations-v2/';
const output=path.join(__dirname,'screenshots');
const report={date:new Date().toISOString(),checks:[],layouts:[],accessibility:[],errors:[],badResponses:[]};
(async()=>{
 await fs.mkdir(output,{recursive:true});
 const browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
 const page=await context.newPage();page.setDefaultTimeout(6000);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('response',r=>{if(r.status()>=400)report.badResponses.push({url:r.url(),status:r.status()});});
 async function check(name,fn){try{await fn();report.checks.push({name,passed:true});console.log('PASS '+name);}catch(e){report.checks.push({name,passed:false,error:e.message});console.log('FAIL '+name+': '+e.message);}}
 async function open(name){await page.goto(base+'workspace.html?page='+name);await page.locator('h1').waitFor();}
 for(const width of [1440,1280,580,390]){
  await page.setViewportSize({width,height:900});
  for(const name of ['questions','users','grants','capabilities','settings','help']){
   await check(`${name} layout ${width}`,async()=>{
    await open(name);assert.equal(await page.locator('h1').count(),1);
    const metrics=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,mainWidth:document.querySelector('main').getBoundingClientRect().width,firstRow:document.querySelector('tbody tr')?.getBoundingClientRect().top??null}));report.layouts.push({page:name,...metrics});assert.ok(metrics.scrollWidth<=width+1,'Document overflow');assert.ok(metrics.mainWidth>width/2,'Collapsed main content');
    if(width!==1280)await page.screenshot({path:path.join(output,`admin-${name}-${width}.png`)});
    if(width===1440||width===390){const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();report.accessibility.push({page:name,width,violations:axe.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))});assert.equal(axe.violations.length,0,axe.violations.map(v=>v.id+':'+v.nodes.length).join(','));}
   });
  }
 }
 await page.setViewportSize({width:1440,height:900});
 await check('Operations links into six new pages',async()=>{
  await page.goto(base);for(const name of ['questions','users','grants','capabilities','settings','help'])assert.equal(await page.locator(`.sidebar a[href="workspace.html?page=${name}"]`).count(),1);
  await page.getByRole('link',{name:'All questions',exact:true}).click();await page.waitForURL('**/workspace.html?page=questions');await page.locator('.ws-content').waitFor();assert.ok(page.url().includes('workspace.html?page=questions'));assert.ok(await page.getByRole('heading',{name:'All questions',exact:true}).isVisible());
 });
 await check('Shared sidebar navigation across six pages',async()=>{
  for(const name of ['users','grants','capabilities','settings','help','questions']){await page.locator(`.sidebar a[href="workspace.html?page=${name}"]`).click();await page.waitForURL('**/workspace.html?page='+name);await page.locator(`.sidebar [aria-current="page"][href="workspace.html?page=${name}"]`).waitFor();assert.equal(new URL(page.url()).searchParams.get('page'),name);assert.equal(await page.locator('.sidebar [aria-current="page"]').count(),1);}
 });
 await check('Help search natural typing, no results and reset',async()=>{
  await open('help');await page.getByRole('searchbox',{name:'Search tutorials'}).pressSequentially('zzzzz');assert.equal(await page.getByRole('searchbox').inputValue(),'zzzzz');assert.ok(await page.getByRole('heading',{name:'No matching guides'}).isVisible());await page.getByRole('button',{name:'Show all guides'}).click();assert.equal(await page.locator('.learn-card').count(),6);
 });
 await check('Help completion persisted, replay and reset confirmation',async()=>{
  await page.locator('[data-action="help-start"][data-id="users"]').click();await page.getByRole('button',{name:'Next step',exact:true}).click();await page.getByRole('button',{name:'Next step',exact:true}).click();await page.getByRole('button',{name:'Complete guide',exact:true}).click();await page.reload();assert.equal(await page.getByRole('button',{name:'Replay guide',exact:true}).count(),1);
  await page.getByRole('button',{name:'Reset progress',exact:true}).click();assert.ok(await page.getByRole('dialog').isVisible());await page.getByRole('button',{name:'Keep progress'}).click();assert.equal(await page.getByRole('button',{name:'Replay guide',exact:true}).count(),1);
  await page.getByRole('button',{name:'Reset progress',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Reset progress',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Replay guide',exact:true}).count(),0);
 });
 await check('Help FAQ and guide detail accessibility',async()=>{
  await page.getByRole('tab',{name:'Common questions'}).click();await page.getByText('Does a global Instructor grant give access to every course?',{exact:true}).click();assert.ok(await page.locator('details[open]').isVisible());await page.getByRole('tab',{name:'Admin guides',exact:true}).click();await page.locator('[data-action="help-start"][data-id="operations"]').click();const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.equal(axe.violations.length,0,axe.violations.map(v=>v.id).join(','));await page.screenshot({path:path.join(output,'admin-help-guide.png')});await page.keyboard.press('Escape');assert.equal(await page.locator('.ws-panel').count(),0);
 });
 await check('Narrow navigation menu keeps every page reachable',async()=>{
  await page.setViewportSize({width:390,height:844});await open('users');await page.getByRole('button',{name:'Toggle navigation',exact:true}).click();assert.equal(await page.getByRole('dialog').getByRole('link').count(),7);assert.ok((await page.getByRole('dialog').innerText()).includes('All questions'),'Visible navigation labels');await page.getByRole('dialog').getByRole('link',{name:'All questions',exact:true}).click();assert.ok(page.url().includes('page=questions'));
  await page.goto(base);await page.getByRole('button',{name:'Toggle navigation width',exact:true}).click();await page.getByRole('dialog').getByRole('link',{name:'Help & tutorials',exact:true}).click();assert.ok(page.url().includes('page=help'));
 });
 await check('No script errors or failed resources',async()=>{assert.deepEqual(report.errors,[]);assert.deepEqual(report.badResponses,[]);});
 report.passed=report.checks.filter(c=>c.passed).length;report.failed=report.checks.filter(c=>!c.passed).length;
 await fs.writeFile(path.join(output,'workspace-verification.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({passed:report.passed,failed:report.failed}));if(report.failed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
