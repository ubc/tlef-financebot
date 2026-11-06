"""Summarize terminal pilot evidence without provider calls or invented labels."""
from pathlib import Path
from statistics import median
import argparse
import json


def measured_sum(events, key):
    values = [event.get('usage', {}).get(key) for event in events]
    return sum(values) if values and all(isinstance(value, int) and value >= 0 for value in values) else None


def measurements(events):
    return {
        'observedSends': len(events),
        'inputTokens': measured_sum(events, 'inputTokens'),
        'outputTokens': measured_sum(events, 'outputTokens'),
        'reasoningTokensSubsetOfOutput': measured_sum(events, 'reasoningTokens'),
        'summedProviderMs': sum(event.get('durationMs', 0) for event in events),
        'medianProviderMs': median(event.get('durationMs', 0) for event in events) if events else None,
        'actualModels': sorted(set(event.get('actualModel', 'unknown') for event in events)),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--matrix', required=True, type=Path)
    parser.add_argument('--admission', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    matrix = json.loads(args.matrix.read_text())
    admission = json.loads(args.admission.read_text())
    if matrix['status'] not in ('completed', 'stopped'):
        raise ValueError('Matrix must be terminal before deriving findings.')
    if matrix['fixtureSha256'] != admission['fixtureSha256']:
        raise ValueError('Admission fixture identity differs.')
    cells = matrix['cells']
    seen = set()
    events = []
    for cell in cells:
        for capture in cell.get('captures', []):
            for attempt in capture['transcript']['attempts']:
                for event in attempt['events']:
                    if event['type'] == 'finished' and event['callId'] not in seen:
                        seen.add(event['callId'])
                        events.append((cell, capture['transcript']['stage'], event))
    arms = []
    for arm in dict.fromkeys(cell['schedule']['arm']['id'] for cell in cells):
        subset = [cell for cell in cells if cell['schedule']['arm']['id'] == arm]
        rows = [row for row in admission['rows'] if row['arm'] == arm]
        arms.append({
            'arm': arm, 'requested': len(subset),
            'parsedCandidates': sum(cell.get('normalizedCandidate') is not None for cell in subset),
            'modelAssessedEligible': sum(cell.get('eligibleBeforeRepair') is True for cell in subset),
            'checkedAdmissionEligible': sum(row.get('combinedCheckedEligibility') is True for row in rows),
            'checkedEligibleAtRequestedDifficulty': sum(row.get('combinedCheckedEligibility') is True and row.get('assessedAchievedDifficulty') == row.get('requestedDifficulty') for row in rows),
            'generator': measurements([event for cell, stage, event in events if cell in subset and stage == 'model-comparison-generator']),
            'fixedAssessment': measurements([event for cell, stage, event in events if cell in subset and stage != 'model-comparison-generator']),
            'teacherAccepted': None, 'saved': 0,
        })
    comparisons = []
    for case_id in dict.fromkeys(cell['schedule']['caseId'] for cell in cells):
        subset = [cell for cell in cells if cell['schedule']['caseId'] == case_id]
        hashes = sorted(set(cell['generatorPromptSha256'] for cell in subset))
        if len(hashes) != 1:
            raise ValueError('Generator prompts differ between model arms.')
        comparisons.append({'caseId': case_id, 'sameGeneratorPrompt': True, 'generatorPromptSha256': hashes[0],
                            'outcomes': [{
                                'cellId': cell['schedule']['id'], 'model': cell['schedule']['arm'],
                                'modelEligibility': cell.get('eligibleBeforeRepair'),
                                'assessment': {key: (cell.get('qualityBeforeRepair') or {}).get(key) for key in ['sourceSupport', 'notation', 'novelty', 'achievedDifficulty', 'difficultyMismatch', 'missingPremises', 'findings', 'reasons']},
                                'checkedAdmission': next((row for row in admission['rows'] if row['cellId'] == cell['schedule']['id']), None),
                                'stemWordCount': len((cell.get('normalizedCandidate') or {}).get('stem', '').split()),
                            } for cell in subset]})
    requested = matrix['requestedSlots']
    model_eligible = sum(cell.get('eligibleBeforeRepair') is True for cell in cells)
    checked_eligible = admission['summary']['combinedCheckedEligible']
    findings = [
        f'{requested} requested slots used four tuning cases and five model/effort arms, with one draw per case/arm. Every case retained the same generator prompt across its five arms.',
        f'{model_eligible}/{requested} candidates passed the lab source/notation/novelty assessment; {checked_eligible}/{requested} also passed the recorded additional deterministic admission checks. These are separate outcomes; no Draft was saved by this pilot.',
        'The per-case records show the exact reported defects, achieved difficulty and withheld reasons. A longer stem, an eligible model judgment or an easier achieved label is not evidence that the requested hard question was delivered.',
        'Costs below separate generator sends from the fixed Sol medium assessment. Model choice should be tested on repeated held-out cases before changing product defaults; the four-case tuning pilot cannot establish a general winner.',
    ]
    result = {'version': 1, 'providerCallsByThisAnalysis': 0, 'matrixStatus': matrix['status'], 'fixtureSha256': matrix['fixtureSha256'],
              'requested': requested, 'findings': findings, 'arms': arms, 'cases': comparisons,
              'totalObserved': measurements([event for _, _, event in events]),
              'teacherAcceptance': None, 'reviewMinutes': None, 'saved': 0, 'generalRankingEstablished': False,
              'limitations': ['The assessment model shares a family with Sol generators.',
                              'Generic option-role validator, content reviewer, persistence and live source/Bank rechecks were not invoked in the generator comparison.',
                              'All cases are tuning data, with one repetition; human quality and useful-question cost remain unknown.',
                              'Reported provider usage excludes local embeddings, parsing, infrastructure and SDK-hidden physical retries.']}
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=True) + '\n')
    print(json.dumps({'output': str(args.output), 'requested': requested, 'modelEligible': model_eligible, 'checkedEligible': checked_eligible, 'providerCalls': 0}))


if __name__ == '__main__':
    main()
