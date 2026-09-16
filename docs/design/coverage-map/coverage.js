/* global document */
const groups=[
['Forces and Vectors',['Define force as a vector interaction','Combine forces to find net force','Identify common forces']],
['Newton’s First Law',['Explain inertia and inertial frames','Relate zero net force to constant velocity','Distinguish equilibrium from rest']],
['Newton’s Second Law',['Apply the relationship Fnet = ma','Resolve force equations into components','Predict acceleration from a force model']],
['Weight and Gravitational Force',['Calculate weight using W = mg','Distinguish mass from weight','Determine the direction of weight near Earth']],
['Force Analysis Applications',['Construct force models for physical situations','Analyze forces on an inclined plane','Use SI units for force and mass']]
];
let rows=[],selected=0,filter='all',search='',view='coverage',zoom=1;
const screen=document.querySelector('#screen'),dialog=document.querySelector('#dialog');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function reset(){rows=groups.flatMap(([topic,names],ti)=>names.map((name,li)=>{const id=ti*3+li;return{id,topic,name,code:(ti+1)+'.'+(li+1),sources:[1,1,0,1,1,1,1,0,1,1,1,1,1,1,1][id],approved:[3,1,0,3,0,2,3,0,1,3,3,3,0,3,1][id],pending:[0,3,0,0,0,2,0,0,0,0,0,0,0,0,3][id],released:ti===0||ti===1,running:id===12}}));selected=1;filter='all';search='';view='coverage';draw()}
function ready(r){return r.sources>0&&r.approved>=3}
function issue(r){if(!r.sources)return['Source needed','Link supporting material','This objective has no linked source. Add evidence before asking AI to generate questions.','Course Materials'];
if(ready(r))return['Coverage target met','View approved questions','This objective has a linked source and at least 3 approved questions. This is a coverage check, not a guarantee of question quality.','Question Bank'];
if(r.pending)return['Review before generating','Review '+r.pending+' questions','There are already questions waiting for a decision. Review them first to avoid creating an unnecessary batch.','Review Queue'];
if(r.running)return['Generation in progress','View generation','Questions are already being generated for this objective. Follow the current task before starting another.','Generate Questions'];
return['More questions needed','Generate questions','This objective has '+r.approved+' approved questions against a coverage target of 3. Start a focused batch for this objective.','Generate Questions']}
function modal(title,text){dialog.innerHTML='<h2>'+esc(title)+'</h2><p>'+esc(text)+'</p><button id="close">Got it</button>';dialog.querySelector('button').onclick=()=>dialog.close();dialog.showModal()}
function draw(){const covered=rows.filter(ready).length;
screen.innerHTML='<div class="intro"><div><h1>Coverage Map</h1><p>Find gaps in your course. Know what to work on next.</p></div><div class="view-actions"><div class="view-switch" aria-label="Map view"><button id="coverage-view" aria-pressed="'+(view==='coverage')+'">▤ Coverage</button><button id="graph-view" aria-pressed="'+(view==='graph')+'">◇ Graph</button></div><button id="help">How to use this</button></div></div>'+
'<div class="summary"><div><strong>'+covered+' of '+rows.length+' objectives meet the coverage target</strong><p>Linked material + at least 3 approved questions per objective.</p></div><div class="summary-bar" aria-hidden="true">'+rows.map(r=>'<span class="'+(ready(r)?'ready':'attention')+'"></span>').join('')+'</div></div>'+
'<div class="tools"><button data-filter="all" class="'+(filter==='all'?'active':'')+'">All objectives</button><button data-filter="gaps" class="'+(filter==='gaps'?'active':'')+'">Coverage gaps · '+(rows.length-covered)+'</button><button data-filter="review" class="'+(filter==='review'?'active':'')+'">Ready to review · '+rows.filter(r=>r.pending>0).length+'</button><input id="search" type="search" aria-label="Search objectives" placeholder="Search objectives…" value="'+esc(search)+'"></div><div id="map"></div><div class="legend"><span>Coverage is measured per objective. A question can support more than one objective.</span><span>Topic release is managed in Question Bank.</span></div>';
screen.querySelector('#coverage-view').onclick=()=>{view='coverage';draw()};
screen.querySelector('#graph-view').onclick=()=>{view='graph';draw()};
screen.querySelector('#help').onclick=()=>modal('Use this when planning course content','Course Structure defines what students learn. Coverage Map shows where those objectives need supporting material or questions. Start with Coverage gaps, select an objective, then use the suggested action. Release status is shown separately: approved questions are not automatically student-visible.');
screen.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;draw()});
screen.querySelector('#search').oninput=e=>{search=e.target.value;drawMap()};
drawMap()}
function drawMap(){const shown=rows.filter(r=>(filter!=='gaps'||!ready(r))&&(filter!=='review'||r.pending>0)&&(r.name+' '+r.topic).toLowerCase().includes(search.toLowerCase()));
const map=screen.querySelector('#map');
if(!shown.length){map.innerHTML='<div class="empty"><h2>'+(rows.length?'No objectives in this view':'Give your course a starting point')+'</h2><p>'+(rows.length?'Try another filter or clear your search.':'Add topics and learning objectives in Course Structure.<br>Their coverage will appear here.')+'</p><button id="empty-action">'+(rows.length?'Reset filters':'Open Course Structure')+'</button></div>';map.querySelector('button').onclick=()=>{if(rows.length){filter='all';search='';draw()}else modal('Course Structure','In the app, this opens Course Structure to add topics and objectives. This prototype uses sample data.')};return}
if(!shown.some(r=>r.id===selected))selected=shown[0].id;
if(view==='graph'){drawGraph(map,shown);return}
let last='';
map.innerHTML='<div class="map-layout"><div class="table-wrap"><table aria-label="Learning objective coverage"><thead><tr><th>Learning objective</th><th>Materials</th><th>Questions</th><th>Topic</th></tr></thead><tbody>'+shown.map(r=>{let heading='';if(last!==r.topic){last=r.topic;heading='<tr class="topic-row"><td colspan="4">'+esc(r.topic)+'</td></tr>'}return heading+'<tr class="'+(selected===r.id?'selected-row':'')+'"><td><button class="row-button" data-id="'+r.id+'" aria-pressed="'+(selected===r.id)+'"><span class="code">'+r.code+'</span>'+esc(r.name)+'</button></td><td><span class="status '+(r.sources?'good':'warn')+'">'+(r.sources?'✓ Linked':'○ Missing')+'</span></td><td class="count">'+r.approved+' / 3 approved<small>'+(r.pending?r.pending+' to review':r.running?'Generating…':ready(r)?'Target met':'Below target')+'</small></td><td><span class="status">'+(r.released?'Released':'Not released')+'</span></td></tr>'}).join('')+'</tbody></table></div><aside class="inspector" id="inspector" aria-label="Objective details"></aside></div>';
map.querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>{selected=+b.dataset.id;drawMap();map.querySelector('[data-id="'+selected+'"]').focus()});
const r=rows.find(r=>r.id===selected),[title,action,reason,destination]=issue(r);
map.querySelector('#inspector').innerHTML='<div class="eyebrow">OBJECTIVE '+r.code+'</div><h2>'+esc(r.name)+'</h2><div class="finding '+(ready(r)?'ready':'')+'"><strong>'+title+'</strong><p>'+reason+'</p></div><dl class="facts"><div><dt>Linked materials</dt><dd>'+r.sources+'</dd></div><div><dt>Approved questions</dt><dd>'+r.approved+' of 3 target</dd></div><div><dt>Waiting for review</dt><dd>'+r.pending+'</dd></div><div><dt>Topic release</dt><dd>'+(r.released?'Released':'Not released')+'</dd></div></dl><button class="primary" id="next">'+action+' →</button><p class="footnote">Opens '+destination+' for this objective.</p><p class="footnote">'+(!r.released?'This topic is not released. Meeting the coverage target does not release it to students.':'Student access also depends on course publication and content checks.')+'</p>';
map.querySelector('#next').onclick=()=>modal(destination+' · filtered to this objective','In the app, this opens '+destination+' for “'+r.name+'”. '+(destination==='Generate Questions'?'Generation will only start after you review the request and click Generate. ':'')+'This prototype demonstrates navigation only; no course data is changed.') }

function drawGraph(map,shown){
const current=rows.find(r=>r.id===selected);
const topicRows=shown.filter(r=>r.topic===current.topic);
const nodes=[],edges=[];
const add=(id,label,kind,x,y,paths,detail)=>{nodes.push({id,label,kind,x,y,paths,detail});return id};
const edge=(from,to,paths)=>edges.push({from,to,paths});
const grounded=topicRows.filter(r=>r.sources);
if(grounded.length)add('material','week3-lecture-notes.pdf','Material',24,65,grounded.map(r=>r.id),'Sample lecture notes supporting the selected topic.');
topicRows.forEach((r,i)=>{
 const y=65+i*155, paths=[r.id];
 if(r.sources){
 add('e'+r.id,'Evidence '+(i+1),'Evidence',249,y,paths,'Sample passage: forces combine through vector addition. In production, this panel shows the actual source excerpt and page.');
 add('c'+r.id,r.topic==='Forces and Vectors'?'Force and vector models':r.topic,'Concept',474,y,paths,'Sample extracted concept. Connections in this prototype are illustrative.');
 edge('material','e'+r.id,paths);edge('e'+r.id,'c'+r.id,paths);
 }
 add('lo'+r.id,r.name,'Learning objective',699,y,paths,'Objective '+r.code+' · '+r.topic);
 if(r.sources)edge('c'+r.id,'lo'+r.id,paths);
 if(r.approved+r.pending){
 add('q'+r.id,r.approved+' approved · '+r.pending+' to review','Question group',924,y,paths,'Question summary for this objective. Production can expand this group into individual questions.');
 edge('lo'+r.id,'q'+r.id,paths);
 }else{
 add('q'+r.id,r.running?'Generation in progress':'No questions yet','Gap',924,y,paths,r.running?'A generation task is already active.':'This objective currently has no question coverage.');
 edge('lo'+r.id,'q'+r.id,paths);
 }
});
const h=Math.max(500,topicRows.length*155+70);
map.innerHTML='<div class="graph-toolbar"><div><strong>Explore relationships</strong><span>One topic at a time · click a node to trace its connections</span></div><select id="graph-topic" aria-label="Graph topic">'+[...new Set(shown.map(r=>r.topic))].map(t=>'<option '+(t===current.topic?'selected':'')+'>'+esc(t)+'</option>').join('')+'</select><label>Zoom <input id="graph-zoom" type="range" min="50" max="125" value="'+zoom*100+'" aria-label="Graph zoom"></label><button id="fit">Reset zoom</button></div><div class="graph-layout"><div class="graph-viewport"><div class="graph-canvas" style="width:1148px;height:'+h+'px;zoom:'+zoom+'">'+
['Materials','Evidence','Concepts','Learning objectives','Questions'].map((name,i)=>'<div class="graph-column" style="left:'+(24+i*225)+'px">'+name+'</div>').join('')+
'<svg class="graph-edges" width="1148" height="'+h+'" aria-hidden="true">'+edges.map(e=>{const a=nodes.find(n=>n.id===e.from),b=nodes.find(n=>n.id===e.to);return '<path data-paths="'+e.paths.join(',')+'" d="M '+(a.x+190)+' '+(a.y+38)+' C '+(a.x+215)+' '+(a.y+38)+', '+(b.x-25)+' '+(b.y+38)+', '+b.x+' '+(b.y+38)+'"/>'}).join('')+'</svg>'+
nodes.map(n=>'<button class="graph-node '+(n.kind==='Gap'?'gap':'')+'" data-node="'+n.id+'" data-paths="'+n.paths.join(',')+'" style="left:'+n.x+'px;top:'+n.y+'px"><small>'+n.kind+'</small><strong>'+esc(n.label)+'</strong></button>').join('')+'</div></div><aside class="inspector" id="graph-detail"><div class="eyebrow">RELATIONSHIP GRAPH</div><h2>'+esc(current.topic)+'</h2><p class="footnote">Select a node to see its role and highlight its connected path.</p><div class="finding"><strong>Illustrative relationships</strong><p>Sample sources, evidence and concepts demonstrate the graph. These are not live course relationships.</p></div><p class="footnote">Missing material connections stay missing. Question groups show approved and pending counts separately.</p></aside></div>';
map.querySelector('#graph-topic').onchange=e=>{selected=shown.find(r=>r.topic===e.target.value).id;drawMap()};
map.querySelector('#graph-zoom').oninput=e=>{zoom=+e.target.value/100;map.querySelector('.graph-canvas').style.zoom=zoom};
map.querySelector('#fit').onclick=()=>{zoom=1;map.querySelector('.graph-canvas').style.zoom=1;map.querySelector('#graph-zoom').value=100;map.querySelector('.graph-viewport').scrollLeft=0};
map.querySelectorAll('[data-node]').forEach(b=>b.onclick=()=>{
 const n=nodes.find(n=>n.id===b.dataset.node);selected=n.paths.includes(selected)?selected:n.paths[0];
 map.querySelectorAll('[data-paths]').forEach(item=>{const connected=item.dataset.paths.split(',').map(Number).some(id=>n.paths.includes(id));item.classList.toggle('dimmed',!connected);item.classList.toggle('traced',connected)});
 map.querySelectorAll('[data-node]').forEach(item=>item.setAttribute('aria-pressed',String(item===b)));
 const r=rows.find(r=>r.id===selected);
 map.querySelector('#graph-detail').innerHTML='<div class="eyebrow">'+n.kind.toUpperCase()+'</div><h2>'+esc(n.label)+'</h2><p class="footnote">'+esc(n.detail)+'</p><dl class="facts"><div><dt>Connected objectives</dt><dd>'+n.paths.length+'</dd></div><div><dt>Selected objective</dt><dd>'+r.code+'</dd></div></dl><button class="primary" id="see-coverage">View objective coverage →</button><p class="footnote">Highlighted lines show the connected path. All relationships here use sample data.</p>';
 map.querySelector('#see-coverage').onclick=()=>{view='coverage';draw();screen.querySelector('[data-id="'+selected+'"]')?.scrollIntoView({block:'nearest'})};
});
}
document.querySelector('#theme').onclick=e=>{document.body.classList.toggle('dark');e.target.textContent=document.body.classList.contains('dark')?'Light mode':'Dark mode'};
document.querySelector('#empty').onclick=()=>{rows=[];draw()};
document.querySelector('#reset').onclick=reset;reset();
