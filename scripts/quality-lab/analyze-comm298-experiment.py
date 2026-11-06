"""Describe this finite run; no model winner or human accuracy is inferred."""
from pathlib import Path
import json,statistics
ROOT=Path(__file__).resolve().parents[2]
p=ROOT/'audit-results/comm298-model-quality-2026-10-20/continuation-r2'
d=json.loads((p/'results.json').read_text())
examples=json.loads((p/'rendered-examples.json').read_text())['examples'] if (p/'rendered-examples.json').exists() else {}
def initial(c):
 k=c.get('checks')
 return bool(k and not k['numerics'].get('failure') and not k['structure'] and k['content']['decision'] in ['pass','flag'] and k['quality']['status']=='eligible' and not examples.get(c['id'],{}).get('extraAdmissionIssues',[]))
def repair(c):
 k=c.get('repair') or {}
 return bool(k.get('quality',{}).get('status')=='eligible' and not k.get('numerics',{}).get('failure') and k.get('review',{}).get('decision') in ['pass','flag'] and not examples.get(c['id'],{}).get('repairedExtraAdmissionIssues',[]))
rows=[]
for arm in d['arms']:
 cells=[c for c in d['cells'] if c['arm']['id']==arm['id']]
 calls=[c for c in d['calls'] if c['cell'] in [r['id'] for r in cells]]
 generation=[c for c in calls if c['layer']=='generation' and c.get('usage')]
 numeric=[c for c in cells if c.get('normalizedCandidate',{} ) and c['normalizedCandidate']['numericKind']=='numeric']
 rows.append({'arm':arm['id'],'requested':12,'rawCandidates':sum(bool(c.get('rawCandidate')) for c in cells),'schemaValid':sum(bool(c.get('normalizedCandidate')) for c in cells),'numericCandidates':len(numeric),'numericExampleAvailable':sum(examples.get(c['id'],{}).get('original',{}).get('status')=='available' for c in numeric),'initialChecksCompleted':sum(bool(c.get('checks')) for c in cells),'initialUnflagged':sum(bool(c.get('checks',{} ) and c['checks']['labEligible']) for c in cells),'initialComponentEligibleIncludingFlags':sum(initial(c) for c in cells),'repairComponentEligibleIncludingFlags':sum(repair(c) for c in cells),'initialOrRepairComponentEligible':sum(initial(c) or repair(c) for c in cells),'generationInputTokens':sum(c['usage']['prompt_tokens'] for c in generation),'generationOutputTokens':sum(c['usage']['completion_tokens'] for c in generation),'generationReasoningSubset':sum(c['usage'].get('completion_tokens_details',{}).get('reasoning_tokens',0) for c in generation),'medianGenerationSeconds':round(statistics.median(c['elapsedMs'] for c in generation)/1000,3) if generation else None,'medianStemWhitespaceTokensByRequestedDifficulty':{level:statistics.median(len(c['normalizedCandidate']['stem'].split()) for c in cells if c.get('normalizedCandidate') and c['task']['difficulty']==level) if any(c.get('normalizedCandidate') and c['task']['difficulty']==level for c in cells) else None for level in ['easy','medium','hard']},'hardTaskDemandLabels':[(c['id'],c['checks']['quality'].get('taskDemand',{}).get('verdict'),c['checks']['quality'].get('taskDemand',{}).get('achieved',{}).get('difficulty'))for c in cells if c['task']['difficulty']=='hard' and c.get('checks')],'allAssignedLayerInputTokens':sum(c['usage']['prompt_tokens'] for c in calls if c.get('usage')),'allAssignedLayerOutputTokens':sum(c['usage']['completion_tokens'] for c in calls if c.get('usage')),'allAssignedCalls':len(calls),'teacherAccepted':None})
def review_outcome(q):
 if not q: return 'no-result'
 if q.get('reviewRepair',{}).get('status')=='drift': return 'decision-drift'
 if q.get('exclusionReview',{}).get('review') is None or any('schema-invalid' in i.get('code','') for i in q.get('taskDemand',{}).get('issues',[])): return 'schema-failure'
 return 'guarded-'+q['status']
conflicts=[]
for r in d['crossReviews']:
 reviews=[v for v in r['reviews'] if v.get('quality')]
 labels={v['arm']['id']:{'status':v['quality']['status'],'outcomeCategory':review_outcome(v['quality']),'sourceSupport':v['quality']['sourceSupport'],'notation':v['quality']['notation'],'novelty':v['quality']['novelty'],'answerability':v['quality'].get('answerability',{}).get('status'),'demand':v['quality'].get('taskDemand',{}).get('verdict')}for v in reviews}
 sent={v['arm']['id']:sum(c['cell']=='cross-'+r['cellId']+'--'+v['arm']['id'] for c in d['calls'])for v in reviews}
 conflicts.append({'task':r['task'],'cellId':r.get('cellId'),'labels':labels,'actualCalls':sent,'disagreement':len({json.dumps(v,sort_keys=True)for v in labels.values()})>1,'manualCorrectVerdict':None})
reviewer_summary=[]
for arm in d['arms']:
 rs=[v for r in d['crossReviews'] for v in r['reviews'] if v['arm']['id']==arm['id'] and v.get('quality')]
 cats=[review_outcome(v['quality']) for v in rs]
 cs=[c for c in d['calls'] if c['cell'].startswith('cross-') and c['requestedModel']==arm['model'] and c['effort']==arm['reasoningEffort']]
 reviewer_summary.append({'arm':arm['id'],'planned':12,'completed':len(rs),'guardedEligible':cats.count('guarded-eligible'),'guardedWithheld':cats.count('guarded-withheld'),'schemaFailure':cats.count('schema-failure'),'decisionDrift':cats.count('decision-drift'),'sdkCalls':len(cs),'inputTokens':sum(c['usage']['prompt_tokens'] for c in cs if c.get('usage')),'outputTokens':sum(c['usage']['completion_tokens'] for c in cs if c.get('usage')),'teacherAccuracy':None})
a={'status':d['status'],'source':'Supplied Class 15 lecture only','arms':rows,'cumulativeUsage':d['usage'],'observedSdkAttempts':len(d['calls']),'reportedCompletedCalls':sum(bool(c.get('usage')) for c in d['calls']),'unknownOrInflightCalls':sum(not c.get('usage')for c in d['calls']),'reviewerSummary':reviewer_summary,'crossReview':conflicts,'saved':0,'adopted':0,'teacherAcceptance':None,'limitations':d['limitations'],'note':'Component gate counts include content FLAG and supplementary local checks. Original strict unflagged counts remain separate and unchanged. Parent-prefix usage is included once; do not sum parent and continuation totals.'}
(p/'analysis.json').write_text(json.dumps(a,indent=2,ensure_ascii=False))
print(json.dumps({'status':a['status'],'arms':rows,'callCount':a['observedSdkAttempts'],'crossReviewed':len(conflicts)},ensure_ascii=False))
