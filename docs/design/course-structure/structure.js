/* global document, setTimeout */
const seed = [
 ['Forces and Vectors',['Define force as a vector interaction','Combine forces to find net force','Identify common forces']],
 ['Newton’s First Law',['Explain inertia and inertial frames','Relate zero net force to constant velocity','Distinguish equilibrium from rest']],
 ['Newton’s Second Law',['Apply the relationship Fnet = ma','Resolve force equations into components','Predict acceleration from a force model']],
 ['Weight and Gravitational Force',['Calculate weight using W = mg','Distinguish mass from weight','Determine the direction of weight near Earth']],
 ['Force Analysis Applications',['Construct force models for physical situations','Analyze forces on an inclined plane','Use SI units for force and mass']]
];
let topics, active=0, query='', opened='', all=false;
const screen=document.querySelector('#screen'), dialog=document.querySelector('#dialog');
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function notify(text){document.querySelector('#toast').textContent=text;setTimeout(()=>document.querySelector('#toast').textContent='',2600)}
function reset(){topics=seed.map(([name,los])=>({name,los:los.map((name,i)=>({name,sources:i===2?0:1}))}));active=0;query='';opened='';all=false;draw()}
function modal(title,body,save){dialog.innerHTML='<h2>'+title+'</h2>'+body+'<div class="dialog-actions"><button id="cancel">Cancel</button><button class="primary" id="save">Save</button></div>';dialog.querySelector('#cancel').onclick=()=>dialog.close();dialog.querySelector('#save').onclick=save;dialog.showModal()}
function addTopic(){modal('Add topic','<label for="topic-name">Topic name</label><input id="topic-name" placeholder="e.g. Energy and work" required>',()=>{const name=dialog.querySelector('input').value.trim();if(!name){dialog.querySelector('input').reportValidity();return}topics.push({name,los:[]});active=topics.length-1;all=false;query='';dialog.close();draw();notify('Topic added · demo')})}
function addLO(){if(!topics.length){addTopic();return}modal('Add learning objectives','<p>'+escape(topics[active].name)+'</p><label for="new-los">One objective per line</label><textarea id="new-los" placeholder="Explain…&#10;Calculate…&#10;Compare…" required></textarea>',()=>{const input=dialog.querySelector('textarea');const names=input.value.split('\n').map(x=>x.trim()).filter(Boolean);if(!names.length){input.reportValidity();return}topics[active].los.push(...names.map(name=>({name,sources:0})));query='';dialog.close();draw();notify(names.length+' objectives added · demo')})}
function rename(){modal('Rename topic','<label for="rename">Topic name</label><input id="rename" required value="'+escape(topics[active].name)+'">',()=>{const input=dialog.querySelector('input');if(!input.value.trim()){input.reportValidity();return}topics[active].name=input.value.trim();dialog.close();draw()})}
function draw(){
const total=topics.reduce((n,t)=>n+t.los.length,0);
screen.innerHTML='<div class="intro"><div><h1>Course Structure</h1><p>Shape what students learn. Keep each objective focused and connected.</p></div><div class="intro-actions"><button id="overview">'+(all?'Topic view':'All objectives')+'</button><button class="primary" id="add-topic">+ Add topic</button></div></div>'+
'<div class="structure"><aside class="topics" aria-label="Topics"><div class="topic-head"><span>TOPICS · '+topics.length+'</span><button id="quick-add" aria-label="Add topic">+</button></div><div class="topic-list">'+topics.map((t,i)=>'<button class="topic '+(i===active&&!all?'active':'')+'" data-topic="'+i+'" aria-pressed="'+(i===active&&!all)+'"><span class="number">'+String(i+1).padStart(2,'0')+'</span><span><strong>'+escape(t.name)+'</strong><small>'+t.los.length+' objectives</small></span></button>').join('')+'</div><div class="topic-foot">'+total+' objectives across '+topics.length+' topics</div></aside><section class="content">'+
(topics.length?'<header class="content-head"><div class="eyebrow">'+(all?'COURSE OUTLINE':'TOPIC '+String(active+1).padStart(2,'0'))+'</div><div class="title-line"><h2>'+escape(all?'The complete learning journey':topics[active].name)+'</h2>'+(!all?'<button class="quiet" id="rename">Rename</button>':'')+'</div><p class="description">'+(all?'Scan the course in teaching order. Open any objective to refine it.':'What should students be able to do after this topic?')+'</p></header><div class="tools"><input type="search" id="search" aria-label="Search objectives" placeholder="Search all objectives…" value="'+escape(query)+'"><button id="add-lo">+ Add objectives</button></div><div class="objectives" id="objectives"></div><footer class="content-foot"><span>Click an objective to edit or inspect its sources.</span><button id="preview">Student view ↗</button></footer>':'<div class="empty"><h2>Start with your first topic</h2><p>Group related learning objectives into a topic.<br>You can add objectives together in one step.</p><button class="primary" id="first-topic">+ Add topic</button></div>')+'</section></div>';
screen.querySelector('#add-topic').onclick=addTopic;screen.querySelector('#quick-add').onclick=addTopic;
screen.querySelector('#overview').onclick=()=>{all=!all;opened='';draw()};
screen.querySelectorAll('[data-topic]').forEach(b=>b.onclick=()=>{active=+b.dataset.topic;all=false;query='';opened='';draw()});
if(!topics.length){screen.querySelector('#first-topic').onclick=addTopic;return}
screen.querySelector('#add-lo').onclick=addLO;
if(screen.querySelector('#rename'))screen.querySelector('#rename').onclick=rename;
screen.querySelector('#search').oninput=e=>{query=e.target.value;renderRows()};
screen.querySelector('#preview').onclick=()=>{modal('Student outline','<p>Preview of the learning objectives for this topic. Actual availability depends on course and topic release.</p><ul>'+topics[active].los.map(l=>'<li style="margin:12px 0;font-size:13px">'+escape(l.name)+'</li>').join('')+'</ul>',()=>dialog.close());dialog.querySelector('#save').textContent='Done'};
renderRows();
}
function renderRows(){
const target=screen.querySelector('#objectives');let matches=0;
target.innerHTML=topics.map((t,ti)=>{
if(!query&&!all&&ti!==active)return '';
const rows=t.los.map((l,li)=>{if(query&&!l.name.toLowerCase().includes(query.toLowerCase())&&!t.name.toLowerCase().includes(query.toLowerCase()))return '';matches++;const id=ti+'-'+li;return '<div class="lo '+(opened===id?'open':'')+'"><button class="lo-row" data-open="'+id+'" aria-expanded="'+(opened===id)+'"><span class="lo-code">'+(ti+1)+'.'+(li+1)+'</span><span class="lo-name">'+escape(l.name)+'</span><span class="lo-meta">'+(l.sources?'1 linked source':'No source linked')+'</span><span class="chevron">'+(opened===id?'−':'+')+'</span></button>'+(opened===id?'<div class="lo-details"><label for="edit-lo">Learning objective</label><textarea id="edit-lo">'+escape(l.name)+'</textarea><p style="margin-top:12px">'+(l.sources?'↳ week3-lecture-notes.pdf · supporting material':'No supporting material linked. Link evidence from Course Materials before generating questions.')+'</p><div class="row-actions"><button class="primary" data-save="'+id+'">Save changes</button><button data-close>Cancel</button><button class="move" data-up="'+id+'" '+(li===0?'disabled':'')+'>Move up ↑</button></div></div>':'')+'</div>'}).join('');
return rows?'<section class="topic-section">'+(all||query?'<h3>'+escape(t.name)+'</h3>':'')+'<div class="columns"><span>LEARNING OBJECTIVE</span><span>SUPPORTING MATERIAL</span></div>'+rows+'</section>':''}).join('');
if(!matches)target.innerHTML='<div class="empty"><h2>'+(query?'No matching objectives':'Give this topic a purpose')+'</h2><p>'+(query?'Try another phrase or clear your search.':'Add what students should know or be able to do.')+'</p><button id="empty-action">'+(query?'Clear search':'+ Add objectives')+'</button></div>';
if(target.querySelector('#empty-action'))target.querySelector('#empty-action').onclick=()=>{if(query){query='';screen.querySelector('#search').value='';renderRows()}else addLO()};
target.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{opened=opened===b.dataset.open?'':b.dataset.open;renderRows()});
target.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>{opened='';renderRows()});
target.querySelectorAll('[data-save]').forEach(b=>b.onclick=()=>{const [ti,li]=b.dataset.save.split('-').map(Number),value=target.querySelector('textarea').value.trim();if(!value)return;topics[ti].los[li].name=value;opened='';renderRows();notify('Objective saved · demo')});
target.querySelectorAll('[data-up]').forEach(b=>b.onclick=()=>{const [ti,li]=b.dataset.up.split('-').map(Number);[topics[ti].los[li-1],topics[ti].los[li]]=[topics[ti].los[li],topics[ti].los[li-1]];opened=ti+'-'+(li-1);renderRows()});
}
document.querySelector('#theme').onclick=e=>{document.body.classList.toggle('dark');e.target.textContent=document.body.classList.contains('dark')?'Light mode':'Dark mode'};
document.querySelector('#empty').onclick=()=>{topics=[];draw()};
document.querySelector('#reset').onclick=reset;
reset();
