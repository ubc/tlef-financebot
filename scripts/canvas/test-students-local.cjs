const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs'); const path = require('node:path');
const base='http://localhost:6118', output=path.resolve('audit-results/canvas-integration');
const {courseId:id}=JSON.parse(fs.readFileSync(path.join(output,'course.json')));
const evidence=JSON.parse(fs.readFileSync(path.join(output,'evidence.json')));
async function snap(page,name,title,detail){if(name==='11-existing-linked'||name==='13-all-matched')await page.getByRole('heading',{name:/Combined roster/}).evaluate(e=>e.scrollIntoView({block:'start'}));if(name==='14-mobile')await page.locator('.canvas-choices').evaluate(e=>e.scrollIntoView({block:'center'}));await page.screenshot({path:path.join(output,`${name}.png`),fullPage:true,animations:'disabled'});evidence.push({name,title,detail,screenshot:`${name}.png`,at:new Date().toISOString()});fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));console.log('PASS',name,title)}
async function json(p,endpoint,method='GET',data){return p.evaluate(async({endpoint,method,data})=>{const r=await fetch(endpoint,{method,headers:{'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});return{status:r.status,body:r.status===204?null:await r.json()};},{endpoint,method,data})}
async function login(p,u){await p.goto(`${base}/auth/ubcshib`);await p.locator('[name=username]').fill(u);await p.locator('[name=password]').fill(u);await p.getByRole('button',{name:/login/i}).click();await p.waitForURL(`${base}/**`);return(await p.request.get(`${base}/api/auth/me`)).json()}
(async()=>{const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:1440,height:1050},storageState:path.join(output,'instructor-auth.json')});const p=await ctx.newPage();try{
 await p.goto(`${base}/#/instructor/course/${id}/canvas`);await p.getByRole('heading',{name:'Combined roster · 20 students'}).waitFor();
 const files=await json(p,`/api/courses/${id}/canvas/files`);const f=files.body[0];
 const before=await json(p,`/api/courses/${id}/materials`);
 const imp=await json(p,`/api/courses/${id}/canvas/import`,'POST',{sourceId:f.sourceId,fileId:f.id});expect(imp.status).toBe(201);
 const after=await json(p,`/api/courses/${id}/materials`);expect(after.body.length).toBe(before.body.length);
 const processed=after.body.find(m=>m.name==='Finance foundations.txt'); console.log('MATERIAL STATUS',processed.status,processed.error||'');
 await p.goto(`${base}/#/instructor/course/${id}/materials`);await p.getByRole('heading',{name:'Course Knowledge Workspace'}).waitFor();await snap(p,'09-material-workspace','Canvas 材料进入现有 Knowledge Workspace',`真实文件处理状态：${processed.status}。重复导入相同 Canvas 文件版本未产生额外副本。`);
 const draftCtx=await b.newContext();const dp=await draftCtx.newPage();const draftMe=await login(dp,'canvas_student_01');expect(draftMe.user.courseRoles.some(r=>r.courseId===id)).toBe(false);await draftCtx.close();console.log('PASS draft denies auto enrollment');
 const created=await json(p,'/api/courses','POST',{name:'Existing course · Canvas link demonstration',courseCode:`EXIST${Date.now()}`,section:'201',term:'2026W1'});expect(created.status).toBe(201);const existing=created.body._id;
 await p.goto(`${base}/#/instructor/course/${existing}/settings`);await p.getByRole('link',{name:'Link Canvas courses & sections'}).waitFor();await snap(p,'10-existing-settings','给已有 FinanceBot 课程补关联','先使用现有创建课程 API 创建普通课程，再从其 Course Settings 进入 Canvas 关联；不重建课程。');
 await p.getByRole('link',{name:'Link Canvas courses & sections'}).click();await p.getByRole('checkbox',{name:/FINANCEBOT-DEMO-201/}).check();await p.getByRole('button',{name:'Save course links'}).click();await p.getByRole('heading',{name:'Combined roster · 5 students'}).waitFor();await snap(p,'11-existing-linked','已有课程关联成功','Canvas 201 关联到原 FinanceBot courseId；该课程仍保持 draft。');
 expect((await json(p,`/api/courses/${id}/publish`,'POST',{})).status).toBe(200);
 const results=[];
 for(let i=1;i<=20;i++){
  const sc=await b.newContext({viewport:{width:1440,height:1050}}),sp=await sc.newPage();const loginName=`canvas_student_${String(i).padStart(2,'0')}`;const me=await login(sp,loginName);
  const roles=me.user.courseRoles.filter(r=>r.courseId===id&&r.role==='student');expect(roles).toHaveLength(1);
  const enroll=await(await sp.request.get(`${base}/api/enrollments`)).json();expect(enroll.some(e=>e.courseId===id&&e.active)).toBe(true);
  const repeated=await(await sp.request.get(`${base}/api/auth/me`)).json();expect(repeated.user.courseRoles.filter(r=>r.courseId===id&&r.role==='student')).toHaveLength(1);
  expect(me.user.courseRoles.some(r=>r.courseId===existing)).toBe(false);
  results.push({student:loginName,name:me.user.displayName,autoEnrolled:true,duplicateRoles:0});
  if(i<=2){await sp.goto(`${base}/#/courses`);await sp.getByText('Canvas linked Finance · 101 + 102',{exact:true}).first().waitFor();await snap(sp,`12-student-${i}`,`同名学生 ${i}：CWL 登录后自动入课`,`${me.user.displayName} 独立 CWL 身份成功匹配；无需注册码或学生 Canvas 授权。`)}
  if(i===20)await sc.storageState({path:path.join(output,'student-auth.json')});
  await sc.close();console.log('PASS student',i);
 }
 fs.writeFileSync(path.join(output,'students.json'),JSON.stringify(results,null,2));
 const non=await b.newContext(),np=await non.newPage();const outsider=await login(np,'student');expect(outsider.user.courseRoles.some(r=>r.courseId===id)).toBe(false);
 const denied=await np.request.get(`${base}/api/courses/${id}/canvas`);expect(denied.status()).toBe(403);console.log('PASS nonmember denied roster');await non.close();
 await p.goto(`${base}/#/instructor/course/${id}/canvas`);await p.getByRole('heading',{name:'Combined roster · 20 students'}).waitFor();await snap(p,'13-all-matched','20 / 20 学生通过真实 CWL 自动入课','全部20名学生逐一登录成功；重复读取无重复角色；非成员无法访问教师花名册；未发布的已有课程未自动授权。');
 await p.setViewportSize({width:390,height:844});await snap(p,'14-mobile','移动端多选关联页面','复用现有移动端应用外壳，课程选择与花名册在窄屏可用。');
 fs.writeFileSync(path.join(output,'course.json'),JSON.stringify({courseId:id,existingCourseId:existing}));
 await ctx.storageState({path:path.join(output,'instructor-auth.json')});
}catch(e){await p.screenshot({path:path.join(output,'failure-students.png'),fullPage:true,animations:'disabled'});console.error('FAIL',e.message);console.error((await p.locator('body').innerText()).slice(-2500));process.exitCode=1}finally{await b.close()}})();
