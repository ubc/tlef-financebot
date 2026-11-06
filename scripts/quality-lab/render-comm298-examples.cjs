/** File-only numerical examples using the production verifier and renderer. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');require('tsx/cjs');
const root=path.resolve(__dirname,'../..'),base=path.join(root,'audit-results/comm298-model-quality-2026-10-20/continuation-r2');
const p=require.resolve('../../server/src/components/qdrant');require.cache[p]={id:p,filename:p,loaded:true,exports:new Proxy({},{get(){return()=>{throw Error('file-render-vector-forbidden');};}})};
const m=require('mongodb');m.MongoClient.prototype.connect=async()=>{throw Error('file-render-database-forbidden');};
const G=require('../../server/src/services/generation.service');
const {loadPrivateAdmissionGates,structuralAdmissionIssues}=require('./production-admission');const {gates}=loadPrivateAdmissionGates(fs.readFileSync(path.join(root,'server/src/services/generation.service.ts'),'utf8'));
function issues(c,q){return [...structuralAdmissionIssues(gates,{type:'mcq',kind:c.task.kind,difficulty:c.task.difficulty},q),G.studentEvidenceIdLeak(q,c.packet.passages.map(p=>p.id)),G.requestedNumericalVariationFailure(c.task.instructions,q)].filter(Boolean);}
const {generationNumericReview}=require('../../server/src/services/generation-numeric-review.service');
const d=JSON.parse(fs.readFileSync(path.join(base,'results.json')));const examples={providerCalls:0,databaseCalls:0,examples:{}};
for(const c of d.cells.filter(c=>c.normalizedCandidate)){const q={...c.normalizedCandidate,type:'mcq'};examples.examples[c.id]={candidateSha256:crypto.createHash('sha256').update(JSON.stringify(q)).digest('hex'),original:generationNumericReview(q,'server-rendered-numeric-review-v1'),extraAdmissionIssues:issues(c,q),...(c.repair?.generated?{repaired:generationNumericReview({...c.repair.generated,type:'mcq'},'server-rendered-numeric-review-v1'),repairedExtraAdmissionIssues:issues(c,c.repair.generated)}:{})};}
fs.writeFileSync(path.join(base,'rendered-examples.json'),JSON.stringify(examples,null,2));console.log(JSON.stringify({examples:Object.keys(examples.examples).length,available:Object.values(examples.examples).filter(x=>x.original.status==='available').length,providerCalls:0}));
