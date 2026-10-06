import { randomInt, randomUUID } from 'node:crypto';
import {
  DatasetSchema, QuestionSchema, ReviewFileSchema, hashValue, issueDimensions,
  type BlindReviewBundle, type EvaluationDataset, type EvaluationQuestion,
  type EvaluationRun, type EvaluationSlot, type ReviewCard, type ReviewFile, type ReviewKey,
} from './schema';

type CardContent = Omit<ReviewCard, 'reviewId' | 'reviewHash'>;
export const REVIEW_LIMITS = Object.freeze({ cards: 500, serializedCardBytes: 25 * 1024 * 1024 });
const countLimitMessage = 'Blinded review exceeds 500 cards. Split the dataset into smaller review sets.';
const sizeLimitMessage = 'Blinded review exceeds 25 MiB of projected card data. Split the dataset into smaller review sets with smaller source contexts.';

function addCardBytes(previous: number, card: ReviewCard): number {
  const bytes = previous + Buffer.byteLength(JSON.stringify(card), 'utf8');
  if (bytes > REVIEW_LIMITS.serializedCardBytes) throw new Error(sizeLimitMessage);
  return bytes;
}

/** Presentation order and random identifiers are outside the content binding. */
export function reviewCardHash(card: CardContent | ReviewCard): string {
  return hashValue({ context: card.context, earlierCandidates: card.earlierCandidates,
    candidate: card.candidate, reviewable: card.reviewable, limitations: card.limitations });
}

const questionCopy = (question: EvaluationQuestion): EvaluationQuestion => QuestionSchema.parse(question);

/** Deterministic projection: never copy run/slot diagnostics into a blind card. */
export function buildReviewCard(dataset: EvaluationDataset, run: EvaluationRun, slot: EvaluationSlot): Omit<ReviewCard, 'reviewId'> {
  const original = dataset.cases.find(row => row.caseId === run.caseId)?.context;
  if (!original) throw new Error('Review run has no matching frozen context.');
  const notes: string[] = [];
  if (!original.coverage.sourcesComplete) notes.push('The source snapshot is incomplete.');
  if (!original.coverage.bankComplete) notes.push('The question-bank snapshot is incomplete.');
  const context = {
    objective: original.objective,
    request: { type: original.request.type, difficulty: original.request.difficulty,
      count: original.request.count, instruction: original.request.instruction },
    sources: original.sources.map((source, index) => ({ id: `S${index + 1}`, role: source.role, text: source.text })),
    bank: original.bank.map((row, index) => ({ id: `Q${index + 1}`, content: questionCopy(row.content) })),
    coverage: { sourcesComplete: original.coverage.sourcesComplete, bankComplete: original.coverage.bankComplete, notes },
  };
  const earlier = run.slots.filter(row => row.item < slot.item).sort((a, b) => a.item - b.item);
  const missingEarlier = earlier.filter(row => !row.candidate).length;
  const truncatedEarlier = earlier.filter(row => row.candidate?.truncated).length;
  const earlierCandidates = earlier.flatMap(row => row.candidate && !row.candidate.truncated
    ? [{ id: `B${row.item + 1}`, content: questionCopy(row.candidate.content) }] : []);
  const limitations = [...notes];
  if (missingEarlier || truncatedEarlier) limitations.push(`Earlier batch context is incomplete: ${missingEarlier} missing candidate snapshots; ${truncatedEarlier} truncated snapshots. These snapshots are excluded from comparison.`);
  if (!slot.candidate) limitations.push('This requested slot has no candidate snapshot. Record triage, notes and active review time only.');
  if (slot.candidate?.truncated) limitations.push('This candidate snapshot is truncated. Record triage, notes and active review time only.');
  const contextMatches = run.contextHash === hashValue(original);
  if (!contextMatches) limitations.push('The frozen context cannot be verified against this candidate. Record triage, notes and active review time only.');
  const projected: CardContent = { context, earlierCandidates,
    candidate: slot.candidate ? questionCopy(slot.candidate.content) : null,
    reviewable: !!slot.candidate && !slot.candidate.truncated && contextMatches, limitations };
  return { ...projected, reviewHash: reviewCardHash(projected) };
}

export function createBlindReview(input: EvaluationDataset): { bundle: BlindReviewBundle; key: ReviewKey; reviews: ReviewFile } {
  const dataset = DatasetSchema.parse(input);
  if (dataset.runs.reduce((sum, run) => sum + run.slots.length, 0) > REVIEW_LIMITS.cards) throw new Error(countLimitMessage);
  const reviewSetId = randomUUID();
  const cards: ReviewCard[] = [];
  const entries: ReviewKey['entries'] = [];
  let serializedBytes = 0;
  for (const run of dataset.runs) for (const slot of run.slots) {
    const card = { ...buildReviewCard(dataset, run, slot), reviewId: randomUUID() };
    serializedBytes = addCardBytes(serializedBytes, card);
    cards.push(card);
    entries.push({ reviewId: card.reviewId, reviewHash: card.reviewHash, runId: run.runId, item: slot.item });
  }
  for (let index = cards.length - 1; index > 0; index--) {
    const other = randomInt(index + 1);
    [cards[index], cards[other]] = [cards[other], cards[index]];
  }
  return {
    bundle: { schemaVersion: 'financebot-blind-review-v1', reviewSetId, rubricVersion: dataset.rubricVersion, origin: dataset.origin, cards },
    key: { schemaVersion: 'financebot-review-key-v1', reviewSetId, datasetHash: hashValue(dataset), entries },
    reviews: { schemaVersion: 'financebot-quality-reviews-v1', reviewSetId, rubricVersion: dataset.rubricVersion, reviewerId: 'unassigned', labels: [] },
  };
}

function checkedReviews(bundle: BlindReviewBundle, input: ReviewFile): ReviewFile {
  const reviews = ReviewFileSchema.parse(input);
  if (reviews.reviewSetId !== bundle.reviewSetId || reviews.rubricVersion !== bundle.rubricVersion) throw new Error('Reviews belong to a different review set or rubric.');
  for (const label of reviews.labels) {
    const card = bundle.cards.find(row => row.reviewId === label.reviewId);
    if (!card || card.reviewHash !== label.reviewHash) throw new Error('Review identity or content hash is stale.');
    const hasDecision = issueDimensions.some(field => label[field] !== null) || label.disposition !== null || label.reviewMinutes !== null || label.notes.length > 0 || label.evidenceRefs.length > 0;
    if (hasDecision && reviews.reviewerId === 'unassigned') throw new Error('Assign an anonymized reviewer identifier before saving completed reviews.');
    if (!card.reviewable && (issueDimensions.some(field => label[field] !== null) || label.disposition && !['unresolved', 'source-shortfall'].includes(label.disposition))) throw new Error('An incomplete card permits triage, notes and time only.');
    const references = new Set([...card.context.sources, ...card.context.bank, ...card.earlierCandidates].map(row => row.id));
    if (label.evidenceRefs.some(reference => !references.has(reference))) throw new Error('Review evidence reference is absent from the blind card.');
  }
  return reviews;
}

/** JSON is data inside a script element; escape closing tags and JS separators. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export function renderReviewHtml(bundle: BlindReviewBundle, initialReviews: ReviewFile): string {
  if (bundle.cards.length > REVIEW_LIMITS.cards) throw new Error(countLimitMessage);
  bundle.cards.reduce(addCardBytes, 0);
  const reviews = checkedReviews(bundle, initialReviews);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>FinanceBot blinded question review</title><style>
:root{color-scheme:light;font:16px/1.55 system-ui,sans-serif;color:#17202b;background:#f3f5f7}*{box-sizing:border-box}body{margin:0}main{max-width:1020px;margin:auto;padding:26px 20px 60px}h1{font-size:27px;line-height:1.2}h2{font-size:21px}h3{font-size:17px}p{margin:10px 0}.muted{color:#4c596b;font-size:14px}.toolbar,.navigation{display:flex;flex-wrap:wrap;align-items:center;gap:14px;padding:16px;border:1px solid #c5ccd6;background:#fff;border-radius:8px;margin:18px 0}button,select,input,textarea{font:inherit}button,select,input[type=text],input[type=number],textarea{border:1px solid #8a96a6;border-radius:5px;padding:9px;background:#fff;color:#17202b}button{cursor:pointer;min-height:42px}button.primary{background:#235c37;color:#fff;border-color:#235c37}button:disabled{cursor:default;opacity:.65}label{display:block;font-weight:600}label span{font-weight:400;font-size:13px;display:block;color:#4c596b}input[type=text],input[type=number],select,textarea{width:100%;margin:5px 0 14px}textarea{min-height:110px;resize:vertical}.toolbar input[type=text]{width:220px;margin:5px 0 0}.toolbar label{flex:1}.toolbar input[type=file]{display:block;max-width:100%;font-size:14px;margin-top:7px}.card{background:#fff;border:1px solid #c5ccd6;border-radius:9px;padding:23px;min-width:0}.section{border-top:1px solid #d8dee6;margin-top:22px;padding-top:17px}.fields{display:grid;grid-template-columns:1fr 1fr;gap:0 20px}fieldset{border:0;padding:0;margin:0;min-width:0}legend{font-size:20px;font-weight:700;margin:15px 0}.warning{border-left:4px solid #9b5100;background:#fff2d9;padding:12px 16px}.question,.passage{border:1px solid #d8dee6;border-radius:6px;padding:13px;margin:12px 0}.question pre,.passage pre,pre.raw{white-space:pre-wrap;overflow-wrap:anywhere;font:15px/1.6 system-ui,sans-serif;margin:6px 0}.question ol{padding-left:23px}.question li{margin:13px 0}.question small{display:block;color:#4c596b;font-size:13px}details{margin:12px 0}summary{font-weight:600;cursor:pointer;color:#235c37}#status{min-height:25px;overflow-wrap:anywhere}#status.error{color:#9e201b}.navigation p{flex:1;margin:0}.review-note{padding:12px 15px;background:#eef5ef;border-radius:5px}a,button,input,textarea,select,summary{outline-offset:3px}:focus-visible{outline:3px solid #245cba}.card p,.card h2,.card h3{overflow-wrap:anywhere}[hidden]{display:none!important}@media(max-width:620px){main{padding:16px 12px 35px}.card{padding:16px}.fields{grid-template-columns:1fr}.toolbar{align-items:stretch;gap:16px}.toolbar>*{flex-basis:100%}.toolbar input[type=text]{width:100%}.navigation{gap:10px}.navigation p{flex-basis:100%}h1{font-size:24px}}
</style></head><body><main>
<h1>Blinded question review</h1>
<p>Review each candidate against its frozen teaching context. Model identities and automatic judgments are excluded from these cards.</p>
<p class="muted" id="origin"></p>
<p class="review-note">Enter your own judgments. Blank fields mean unreviewed. Record active review minutes manually, including source checks, edits and triage. Formula text is shown literally; no formula or question code is executed.</p>
<section class="toolbar" aria-label="Review file controls">
<label for="reviewer">Reviewer ID<input id="reviewer" type="text" maxlength="160" autocomplete="off"></label>
<label for="resume">Resume previous reviews<input id="resume" type="file" accept=".json,application/json"><span>Matching records merge; conflicting records require separate adjudication.</span></label>
<button type="button" class="primary" id="download">Download review JSON</button>
</section>
<p id="status" role="status" aria-live="polite"></p>
<nav class="navigation" aria-label="Review card navigation"><p id="position"></p><button id="previous" type="button">Previous card</button><button id="next" type="button">Next card</button></nav>
<article class="card" id="card" aria-label="Blinded review card"></article>
</main><script>const reviewData = ${scriptJson({ bundle, initialReviews: reviews })};
${REVIEW_APP_SCRIPT}
</script></body></html>`;
}

// Plain, dependency-free browser code. Keeping this as a literal avoids build
// tools injecting Node-only helper references into a function's toString().
const REVIEW_APP_SCRIPT = String.raw`(() => {
'use strict';
const { bundle, initialReviews } = reviewData;
const dimensions = ['sourceScope','notation','duplication','difficulty','answerQuality'];
const descriptions = {
 sourceScope: ['Source scope issue','Check necessary premises and correct solution steps within the allowed sources. False distractors or false T/F statements need a grounded correction.'],
 notation: ['Notation issue','Check symbols, units, timing, signs and source conventions.'],
 duplication: ['Duplicate learning task issue','Compare required inference, solution path and misconception against bank and earlier batch candidates. New numbers alone can be an intentional variant.'],
 difficulty: ['Difficulty issue','Compare conceptual work with the requested difficulty. Extra words alone do not add conceptual difficulty.'],
 answerQuality: ['Answer quality issue','Check correctness, ambiguity, proposed answer and explanations.']
};
const dispositions = [['accepted','Accepted without substantive edits'],['edited','Accepted after substantive edits'],['discarded','Discarded'],['intentional-variant','Intentional variant'],['unresolved','Unresolved'],['source-shortfall','Source shortfall']];
const byId = new Map(bundle.cards.map(card => [card.reviewId,card]));
let records = new Map(initialReviews.labels.map(label => [label.reviewId,label]));
let index = 0;
const reviewer = document.getElementById('reviewer');
reviewer.value = initialReviews.reviewerId;
document.getElementById('origin').textContent = bundle.origin === 'synthetic' ? 'Synthetic data. These reviews do not establish quality on live course materials.' : 'Recorded candidates. Scope and completeness limitations are shown for each card.';
const node = (tag,text,className) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; };
const say = (text,error=false) => { const status=document.getElementById('status'); status.textContent=text; status.className=error?'error':''; };
const blank = card => ({ reviewId:card.reviewId,reviewHash:card.reviewHash,sourceScope:null,notation:null,duplication:null,difficulty:null,answerQuality:null,disposition:null,reviewMinutes:null,evidenceRefs:[],notes:'' });
const setValue = (card,field,value) => { const label = {...(records.get(card.reviewId)||blank(card)),[field]:value}; records.set(card.reviewId,label);document.getElementById('position').textContent='Card '+(index+1)+' of '+bundle.cards.length+' · '+records.size+' records entered';say('Changes are held in this page. Download the JSON file to save them.'); };
const showQuestion = (content,title) => {
 const box=node('section',undefined,'question'); box.append(node('h3',title),node('pre',content.stem));
 const choices=node('ol');
 for (const option of content.options) { const row=node('li'); row.append(node('pre',option.key+': '+option.text)); row.append(node('small',option.role==='correct'?'Proposed correct answer':'Proposed distractor')); if(option.explanation)row.append(node('pre',option.explanation)); choices.append(row); }
 box.append(choices);
 if(content.paramSlots?.length||content.derivedValues?.length){ const definitions=node('details');definitions.append(node('summary','Parameter and formula definitions (raw text)'),node('pre',JSON.stringify({paramSlots:content.paramSlots||[],derivedValues:content.derivedValues||[]},null,2),'raw'));box.append(definitions); }
 return box;
};
const section = (title) => { const part=node('section',undefined,'section');part.append(node('h2',title));return part; };
function draw() {
 const card=bundle.cards[index]; const values=records.get(card.reviewId)||blank(card); const root=document.getElementById('card'); root.replaceChildren();
 document.getElementById('position').textContent='Card '+(index+1)+' of '+bundle.cards.length+' · '+records.size+' records entered';
 document.getElementById('previous').disabled=index===0; document.getElementById('next').disabled=index===bundle.cards.length-1;
 const title=node('h2','Teaching context');title.tabIndex=-1;title.id='card-title';root.append(title,node('p',card.context.objective));
 root.append(node('p','Requested: '+card.context.request.type+' · '+card.context.request.difficulty+' · '+card.context.request.count+' slots'));
 if(card.context.request.instruction)root.append(node('pre',card.context.request.instruction,'raw'));
 root.append(node('p','Source snapshot: '+(card.context.coverage.sourcesComplete?'complete':'incomplete')+'. Question-bank snapshot: '+(card.context.coverage.bankComplete?'complete':'incomplete')+'.','muted'));
 if(card.limitations.length){const list=node('ul',undefined,'warning');for(const item of card.limitations)list.append(node('li',item));root.append(list);}
 const sources=node('details');sources.append(node('summary','Inspect sources ('+card.context.sources.length+')'));
 for(const source of card.context.sources){const passage=node('section',undefined,'passage');passage.append(node('h3',source.id+' · '+source.role),node('pre',source.text));sources.append(passage);}if(!card.context.sources.length)sources.append(node('p','No source passages are available in this card.'));root.append(sources);
 const bank=node('details');bank.append(node('summary','Inspect question bank ('+card.context.bank.length+')'));for(const question of card.context.bank)bank.append(showQuestion(question.content,question.id));if(!card.context.bank.length)bank.append(node('p','No bank questions are included in this snapshot.'));root.append(bank);
 const earlier=node('details');earlier.append(node('summary','Inspect earlier batch candidates ('+card.earlierCandidates.length+')'));for(const question of card.earlierCandidates)earlier.append(showQuestion(question.content,question.id));if(!card.earlierCandidates.length)earlier.append(node('p','No complete earlier candidates are included. Check the coverage limitations above.'));root.append(earlier);
 root.append(card.candidate?showQuestion(card.candidate,'Candidate to review'):node('p','Candidate snapshot unavailable.','warning'));
 const form=section('Your review');root.append(form);
 if(!card.reviewable)form.append(node('p','Quality and positive disposition fields are disabled for this incomplete card. Enter triage, notes and time only.','warning'));
 const issueSet=node('fieldset');issueSet.disabled=!card.reviewable;issueSet.append(node('legend','Issue judgments'));const fields=node('div',undefined,'fields');issueSet.append(fields);
 for(const field of dimensions){const label=node('label',descriptions[field][0]);const select=node('select');select.id='label-'+field;label.htmlFor=select.id;label.append(node('span',descriptions[field][1]));for(const [value,text] of [['','Not reviewed'],['present','Issue present'],['absent','Issue absent'],['uncertain','Uncertain']]){const option=node('option',text);option.value=value;select.append(option);}select.value=values[field]||'';select.addEventListener('change',()=>setValue(card,field,select.value||null));label.append(select);fields.append(label);}form.append(issueSet);
 const dispositionLabel=node('label','Disposition');const disposition=node('select');disposition.id='disposition';dispositionLabel.htmlFor=disposition.id;const unselected=node('option','Not reviewed');unselected.value='';disposition.append(unselected);for(const [value,text] of dispositions){if(!card.reviewable&&!['unresolved','source-shortfall'].includes(value))continue;const option=node('option',text);option.value=value;disposition.append(option);}disposition.value=values.disposition||'';disposition.addEventListener('change',()=>setValue(card,'disposition',disposition.value||null));form.append(dispositionLabel,disposition);
 const minutesLabel=node('label','Active review minutes');minutesLabel.append(node('span','Manual entry. Include source checks, edits and triage; exclude breaks.'));const minutes=node('input');minutes.type='number';minutes.min='0';minutes.max='1440';minutes.step='any';minutes.id='minutes';minutesLabel.htmlFor=minutes.id;minutes.value=values.reviewMinutes===null?'':String(values.reviewMinutes);minutes.addEventListener('input',()=>{if(minutes.validity.valid)setValue(card,'reviewMinutes',minutes.value===''?null:Number(minutes.value));});minutesLabel.append(minutes);form.append(minutesLabel);
 const refsLabel=node('label','Evidence references');refsLabel.append(node('span','Use displayed S, Q or B identifiers, separated by commas.'));const refs=node('input');refs.type='text';refs.id='refs';refsLabel.htmlFor=refs.id;refs.value=values.evidenceRefs.join(', ');refs.addEventListener('input',()=>setValue(card,'evidenceRefs',refs.value.split(',').map(value=>value.trim()).filter(Boolean)));refsLabel.append(refs);form.append(refsLabel);
 const notesLabel=node('label','Notes');const notes=node('textarea');notes.id='notes';notes.maxLength=4000;notesLabel.htmlFor=notes.id;notes.value=values.notes;notes.addEventListener('input',()=>setValue(card,'notes',notes.value));notesLabel.append(notes);form.append(notesLabel);
}
const hasKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.prototype.hasOwnProperty.call(value,key));
function validate(file){
 if(!hasKeys(file,['schemaVersion','reviewSetId','rubricVersion','reviewerId','labels'])||file.schemaVersion!=='financebot-quality-reviews-v1'||file.reviewSetId!==bundle.reviewSetId||file.rubricVersion!==bundle.rubricVersion||typeof file.reviewerId!=='string'||file.reviewerId.trim().length>160||!Array.isArray(file.labels)||file.labels.length>10000)throw Error('Invalid review file, review set or rubric.');
 file.reviewerId=file.reviewerId.trim();if(!file.reviewerId)throw Error('Reviewer identifier cannot be blank.');
 const seen=new Set();
 for(const label of file.labels){
  if(!hasKeys(label,['reviewId','reviewHash',...dimensions,'disposition','reviewMinutes','evidenceRefs','notes'])||seen.has(label.reviewId))throw Error('Duplicate or malformed review records require adjudication.');seen.add(label.reviewId);
  const card=byId.get(label.reviewId);if(!card||card.reviewHash!==label.reviewHash)throw Error('A review ID or content hash is stale.');
  const hasDecision=dimensions.some(field=>label[field]!==null)||label.disposition!==null||label.reviewMinutes!==null||label.notes?.length>0||label.evidenceRefs?.length>0;if(hasDecision&&file.reviewerId.trim()==='unassigned')throw Error('Assign an anonymized reviewer identifier before saving completed reviews.');
  if(dimensions.some(field=>label[field]!==null&&!['present','absent','uncertain'].includes(label[field])))throw Error('Invalid issue judgment.');
  if(label.disposition!==null&&!dispositions.some(([value])=>value===label.disposition))throw Error('Invalid disposition.');
  if(!card.reviewable&&(dimensions.some(field=>label[field]!==null)||label.disposition!==null&&!['unresolved','source-shortfall'].includes(label.disposition)))throw Error('Incomplete cards permit triage, notes and time only.');
  if(label.reviewMinutes!==null&&(typeof label.reviewMinutes!=='number'||!Number.isFinite(label.reviewMinutes)||label.reviewMinutes<0||label.reviewMinutes>1440))throw Error('Review minutes must be blank or a finite number from 0 to 1440.');
  const references=new Set([...card.context.sources,...card.context.bank,...card.earlierCandidates].map(row=>row.id));
  if(!Array.isArray(label.evidenceRefs)||label.evidenceRefs.length>30||label.evidenceRefs.some(ref=>typeof ref!=='string'||!references.has(ref)))throw Error('Evidence references must identify sources or questions shown in the card.');
  if(typeof label.notes!=='string'||label.notes.length>4000)throw Error('Notes must be at most 4000 characters.');
 }
 return file;
}
const fileData=()=>({schemaVersion:'financebot-quality-reviews-v1',reviewSetId:bundle.reviewSetId,rubricVersion:bundle.rubricVersion,reviewerId:reviewer.value.trim(),labels:bundle.cards.flatMap(card=>records.has(card.reviewId)?[records.get(card.reviewId)]:[])});
const validInputs=()=>{const invalid=document.querySelector('#card input:invalid');if(invalid){say('Correct the active review minutes before continuing.',true);invalid.focus();return false;}return true;};
document.getElementById('previous').addEventListener('click',()=>{if(index&&validInputs()){index--;draw();document.getElementById('card-title').focus();}});
document.getElementById('next').addEventListener('click',()=>{if(index<bundle.cards.length-1&&validInputs()){index++;draw();document.getElementById('card-title').focus();}});
document.getElementById('download').addEventListener('click',()=>{
 try{if(!validInputs())return;const file=validate(fileData());const blob=new Blob([JSON.stringify(file,null,2)+'\n'],{type:'application/json'});const url=URL.createObjectURL(blob);const anchor=node('a');anchor.href=url;anchor.download='financebot-quality-reviews.json';document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);say('Review JSON downloaded. Only manually entered records are included.');}catch(error){say(error.message,true);}
});
document.getElementById('resume').addEventListener('change',async event=>{
 const input=event.currentTarget;const file=input.files?.[0];if(!file)return;
 try{
  if(file.size>50000000)throw Error('Review file is too large.');const incoming=validate(JSON.parse(await file.text()));
  const currentReviewer=reviewer.value.trim();if(currentReviewer&&currentReviewer!=='unassigned'&&currentReviewer!==incoming.reviewerId)throw Error('Different reviewers require separate adjudication files.');
  for(const label of incoming.labels){const existing=records.get(label.reviewId);const fields=['reviewId','reviewHash',...dimensions,'disposition','reviewMinutes','evidenceRefs','notes'];if(existing&&fields.some(field=>JSON.stringify(existing[field])!==JSON.stringify(label[field])))throw Error('Conflicting reviews require separate adjudication; current entries were preserved.');}
  const merged=new Map(records);for(const label of incoming.labels)merged.set(label.reviewId,label);records=merged;reviewer.value=incoming.reviewerId;draw();say('Previous reviews merged. Download the JSON file to save the current set.');
 }catch(error){say(error.message,true);}finally{input.value='';}
});
draw();
})();`;
