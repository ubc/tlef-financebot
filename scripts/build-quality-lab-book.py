"""Build a local English evidence book; raw public-source I/O stays ignored."""
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
import json
import hashlib
import shutil

ROOT = Path(__file__).resolve().parents[1]
AUDIT = ROOT / 'audit-results/quality-lab-2026-10-16'
PHASE_TWO = ROOT / 'audit-results/quality-lab-2026-10-16-phase-two'
OUTLINE_V2 = ROOT / 'audit-results/quality-lab-2026-10-16-outline-v2-acceptance'
HELDOUT = ROOT / 'audit-results/quality-lab-2026-10-16-heldout-phase-three'
CONTINUATION = ROOT / 'audit-results/quality-lab-outline-continuation-2026-10-17'
BOOK = ROOT / 'artifacts/quality-lab-book-2026-10-16'


def load(path):
    return json.loads(path.read_text()) if path.exists() else None


def pinned_receipt(path):
    """Pin each local observation independently; no runtime or network imports."""
    if not path.exists():
        return None
    raw = path.read_bytes()
    return {'path': str(path.relative_to(ROOT)),
            'sha256': hashlib.sha256(raw).hexdigest(),
            'receipt': json.loads(raw)}


def later_phase_receipts():
    """Per-shard receipts can be newer than a still-running aggregate snapshot."""
    return {
        'outlineV2': {
            'declaration': pinned_receipt(OUTLINE_V2 / 'declaration.json'),
            'ledger': pinned_receipt(OUTLINE_V2 / 'live/ledger-after.json'),
            'result': pinned_receipt(OUTLINE_V2 / 'live/results.json'),
            'cacheObservation': pinned_receipt(OUTLINE_V2 / 'cache-observation-readonly.json'),
            'negativeCoverageReplay': pinned_receipt(OUTLINE_V2 / 'negative-coverage-replay.json'),
        },
        'heldout': {
            'declaration': pinned_receipt(HELDOUT / 'declaration.json'),
            'ledger': pinned_receipt(HELDOUT / 'ledger.json'),
            'aggregate': pinned_receipt(HELDOUT / 'live/results.json'),
            'depreciationAudit': pinned_receipt(HELDOUT / 'depreciation-independent-grid-audit.json'),
            'notationChartAudit': pinned_receipt(HELDOUT / 'notation-chart-independent-source-audit.json'),
            'analyses': [pinned_receipt(path) for path in sorted(HELDOUT.glob('*analysis*.json'))],
            'shards': [pinned_receipt(path) for path in sorted(
                (HELDOUT / 'live').glob('shard-*/results.json'),
                key=lambda path: int(path.parent.name.split('-')[-1]))],
        },
        'snapshotPolicy': 'Each file is pinned independently at book build time. These are not atomic cross-file runtime snapshots. Missing or unrecorded work is unknown, not zero dispatch.',
    }


def public_http_receipts():
    """Read owned public-pipeline observations; startup guards are separate trials."""
    declarations = [pinned_receipt(path) for path in sorted(
        (ROOT / 'audit-results').glob('quality-lab-public-http-2026-10-16-*/declaration.json'))]
    declarations_by_hash = {pin['sha256']: pin for pin in declarations if pin}
    attempts = []
    for path in sorted((ROOT / 'audit-results').glob('quality-lab-public-http-2026-10-16-*/results.json')):
        result = pinned_receipt(path)
        attempts.append({
            'name': path.parent.name,
            'result': result,
            'ledger': pinned_receipt(path.parent / 'ledger.json'),
            'declaration': declarations_by_hash.get(result['receipt'].get('declarationSha256')),
            'operatorStop': pinned_receipt(path.parent / 'operator-stop-result.json'),
            'captures': [pinned_receipt(capture) for capture in sorted((path.parent / 'private-transcripts').glob('*.json'))],
        })
    return {
        'diagnostics': pinned_receipt(ROOT / 'audit-results/quality-lab-public-http-2026-10-16-isolation-diagnostics.json'),
        'attempts': attempts,
        'policy': 'Each result, ledger and transcript is an independently pinned local snapshot. Native Mongo receipt counts determine observed sends. Facade entries and phase reservations alone do not prove dispatch. Unknown or interrupted usage is not zero.',
    }


def phase_two_outline_runs():
    """Read captured runs only; preflights and upload receipts are separate."""
    runs = []
    for result_path in sorted(PHASE_TWO.glob('*/results.json')):
        if result_path.parent.name == 'outline-review-v2-probe':
            continue  # A separate review-only receipt must not also count as an outline run.
        result = load(result_path)
        if not isinstance(result, dict) or not {'captures', 'result', 'usage'}.issubset(result):
            continue
        runs.append({'name': result_path.parent.name,
                     'path': str(result_path.relative_to(ROOT)),
                     'sha256': hashlib.sha256(result_path.read_bytes()).hexdigest(),
                     'controls': load(result_path.parent / 'controls.json'),
                     'receipt': result})
    return runs


def retained_yield_probe_receipts():
    """Keep this bounded review-only experiment separate from saved batch supply."""
    base = ROOT / 'audit-results/quality-lab-retained-yield-repair-2026-10-17-preflight'
    live = ROOT / 'audit-results/quality-lab-retained-yield-repair-2026-10-17-live'
    return {'declaration': pinned_receipt(base / 'declaration.json'),
            'controls': pinned_receipt(base / 'controls.json'),
            'claim': pinned_receipt(base / 'execution-claim.json'),
            'result': pinned_receipt(live / 'results.json'),
            'ledger': pinned_receipt(live / 'ledger.json'),
            'captures': [pinned_receipt(path) for path in sorted((live / 'private-transcripts').glob('*.json'))]}


def outline_continuation_receipts():
    """Keep the fixed-proposal continuation and its original failed start distinct."""
    live = CONTINUATION / 'live-after-fixture-reconciliation'
    return {
        'preparation': pinned_receipt(CONTINUATION / 'prepare-receipt.json'),
        'projection': pinned_receipt(CONTINUATION / 'projection-independent-audit.json'),
        'body': pinned_receipt(CONTINUATION / 'checkpoint-body.json'),
        'verification': pinned_receipt(CONTINUATION / 'continuation-focused-tests.json'),
        'wordingRepairVerification': pinned_receipt(CONTINUATION / 'wording-repair-offline-tests-final-v2.json'),
        'wordingRepairAudit': pinned_receipt(ROOT / 'audit-results/quality-lab-outline-repair-independent-audit-2026-10-17.json'),
        'finalSourceAudit': pinned_receipt(CONTINUATION / 'final-source-quality-independent-audit.json'),
        'declaration': pinned_receipt(CONTINUATION / 'controls/declaration.json'),
        'firstStart': pinned_receipt(CONTINUATION / 'live/results.json'),
        'startReconciliation': pinned_receipt(CONTINUATION / 'zero-dispatch-start-reconciliation.json'),
        'fixtureReconciliation': pinned_receipt(CONTINUATION / 'partial-fixture-reconciliation.json'),
        'fixtureMetadataCorrection': pinned_receipt(CONTINUATION / 'fixture-metadata-correction.json'),
        'result': pinned_receipt(live / 'results.json'),
        'parentBefore': pinned_receipt(live / 'parent-before.json'),
        'ledgerBefore': pinned_receipt(live / 'ledger-before.json'),
        'ledgerAfter': pinned_receipt(live / 'ledger-after.json'),
        'cumulativeLedger': pinned_receipt(OUTLINE_V2 / 'ledger.json'),
        'events': pinned_receipt(live / 'events.json'),
        'captures': [pinned_receipt(path) for path in sorted((live / 'private-transcripts').glob('*.json'))],
        'policy': 'Independent file snapshots, not an atomic runtime view. While running, raw captures can be newer than the aggregate result. Unrecorded dispatch or usage stays unknown. This continues one fixed proposal; it does not generate, apply or adopt questions.',
    }


def heldout_recovery_receipts():
    """Load a separately acquired overlay; never rewrite the original cohort."""
    preflight = ROOT / 'audit-results/quality-lab-heldout-transport-recovery-2026-10-17-preflight'
    live = ROOT / 'audit-results/quality-lab-heldout-transport-recovery-2026-10-17-live'
    return {
        'analysis': pinned_receipt(live / 'analysis.json'),
        'result': pinned_receipt(live / 'results.json'),
        'terminal': pinned_receipt(live / 'terminal-receipt.json'),
        'ledger': pinned_receipt(live / 'ledger.json'),
        'declaration': pinned_receipt(preflight / 'declaration.json'),
        'controls': pinned_receipt(preflight / 'controls.json'),
        'verification': pinned_receipt(ROOT / 'audit-results/quality-lab-heldout-transport-recovery-tests-2026-10-17.json'),
        'analyzerVerification': pinned_receipt(ROOT / 'audit-results/quality-lab-heldout-recovery-analysis-final-tests-2026-10-17.json'),
        'independentAudit': pinned_receipt(live / 'independent-candidate-source-audit.json'),
        'independentInput': pinned_receipt(live / 'independent-candidate-input.json'),
        'independentBinding': pinned_receipt(live / 'independent-candidate-binding.json'),
        'independentReconciliation': pinned_receipt(live / 'independent-audit-reconciliation.json'),
        'codeSnapshot': pinned_receipt(live / 'code-snapshot/manifest-final.json'),
        'captures': [pinned_receipt(path) for path in sorted((live / 'transcripts').glob('*.json'))],
        'policy': 'A later transport-recovery acquisition cohort. Original successful generations, invalid candidates, completed negative judgments, failed-call receipts and unknown usage remain immutable. An analytical merge is not a replacement execution receipt or a causal model ranking.',
    }


def current_public_http_receipts():
    """Keep the new stopped acceptance distinct from historical public attempts."""
    live = ROOT / 'audit-results/quality-lab-public-http-2026-10-17-live'
    return {
        'result': pinned_receipt(live / 'results.json'),
        'terminal': pinned_receipt(live / 'terminal-receipt.json'),
        'ledger': pinned_receipt(live / 'ledger.json'),
        'declaration': pinned_receipt(ROOT / 'audit-results/quality-lab-public-http-2026-10-17-preflight/declaration.json'),
        'savedAudit': pinned_receipt(live / 'independent-saved-source-audit.json'),
        'savedInput': pinned_receipt(live / 'independent-saved-input.json'),
        'savedBinding': pinned_receipt(live / 'independent-saved-binding.json'),
        'failureAudit': pinned_receipt(live / 'local-fixture-failure-audit.json'),
        'codeSnapshot': pinned_receipt(live / 'code-snapshot/manifest-final.json'),
        'captures': [pinned_receipt(path) for path in sorted((live / 'private-transcripts').glob('*.json'))],
    }


def source_interpretation_receipts():
    """A prepared review-only phase is not an executed model experiment."""
    original = ROOT / 'audit-results/quality-lab-source-interpretation-2026-10-17-preflight'
    successor = ROOT / 'audit-results/quality-lab-source-interpretation-2026-10-17-preflight-r3'
    lineage = load(successor / 'supersession.json')
    preflight = original
    if lineage and lineage.get('state') == 'prepared-unexecuted-pending-explicit-approval':
        assert hashlib.sha256((successor / 'declaration.json').read_bytes()).hexdigest() == lineage['current']['sha256']
        assert hashlib.sha256((original / 'declaration.json').read_bytes()).hexdigest() == lineage['original']['sha256']
        preflight = successor
    public = ROOT / 'audit-results/quality-lab-public-http-2026-10-17-live'
    return {
        'declaration': pinned_receipt(preflight / 'declaration.json'),
        'controls': pinned_receipt(preflight / 'controls.json'),
        'promptShapes': pinned_receipt(preflight / 'prompt-shapes.json'),
        'approvalRejection': pinned_receipt(original / 'automatic-approval-rejection.json'),
        'originalDeclaration': pinned_receipt(original / 'declaration.json'),
        'supersession': pinned_receipt(successor / 'supersession.json'),
        'fileOnlyPreparation': pinned_receipt(successor / 'file-only-process.json'),
        'input': pinned_receipt(public / 'retained-review-controls.json'),
        'initialSizeFailure': pinned_receipt(public / 'source-interpretation-prompt-size-failure.json'),
        'compactChecks': pinned_receipt(public / 'source-interpretation-compact-checks.json'),
        'sizeCapture': pinned_receipt(public / 'source-interpretation-size-capture.json'),
        'productionTests': pinned_receipt(public / 'source-interpretation-compact-tests-final.json'),
        'probeTests': pinned_receipt(ROOT / 'audit-results/quality-lab-source-interpretation-probe-offline-tests-2026-10-17.json'),
        'audit': pinned_receipt(ROOT / 'audit-results/quality-lab-source-interpretation-probe-readonly-audit-final-2026-10-17.json'),
        'approvalStatus': pinned_receipt(BOOK / 'source-interpretation-approval-status.json'),
    }


def source_coverage_ui_receipts():
    """UI evidence uses sanitized records; it is not a new model experiment."""
    audit = ROOT / 'audit-results/structure-source-coverage-2026-10-17'
    return {
        'verification': pinned_receipt(audit / 'verification.json'),
        'initialFailures': pinned_receipt(audit / 'initial-browser/receipt.json'),
        'scope': 'Compiled production UI with intercepted APIs and content-sanitized recorded-scale data. No model, database, Apply or adoption execution.',
    }


def source_and_adoption_followup_receipts():
    """Separate structural input repair and local guard checks from model quality."""
    return {
        'passages': pinned_receipt(ROOT / 'audit-results/source-passage-line-boundaries-2026-10-17-final/results.json'),
        'provenance': pinned_receipt(ROOT / 'audit-results/pdf-page-provenance-2026-10-17/book-summary.json'),
        'provenanceChecks': pinned_receipt(ROOT / 'audit-results/pdf-page-provenance-2026-10-17/checks.json'),
        'guards': pinned_receipt(ROOT / 'audit-results/authoring-zero-call-guards-2026-10-17/verification.json'),
        'http': pinned_receipt(ROOT / 'audit-results/authoring-zero-call-guards-2026-10-17/live/results.json'),
    }


def production_pdf_provenance_receipts():
    """Page provenance acceptance is separate from model/teacher quality evidence."""
    audit = ROOT / 'audit-results/pdf-provenance-production-2026-10-17'
    fixture = load(PHASE_TWO / 'upload-index/corpus-fixture.json') or {}
    source = next((item for item in fixture.get('sources', []) if item['chapter'] == 10), None)
    return {
        'verification': pinned_receipt(audit / 'verification.json'),
        'nativeAudit': pinned_receipt(ROOT / 'audit-results/native-pdf-provenance-2026-10-17/results.json'),
        'ui': pinned_receipt(ROOT / 'audit-results/pdf-provenance-ui-2026-10-17/verification.json'),
        'lineage': pinned_receipt(audit / 'experiment-lineage.json'),
        'localExample': pinned_receipt(ROOT / 'audit-results/pdf-provenance-ingest-2026-10-17-live-a1/chapter-10.json'),
        'localHttpResult': pinned_receipt(ROOT / 'audit-results/pdf-provenance-ingest-2026-10-17-live-a1/results.json'),
        'originalExamplePdf': {'file': str(Path(source['publicPdf']).relative_to(ROOT)), 'sha256': source['pdfSha256']} if source else None,
        'scope': 'Actual PDF parsing and page provenance, with separately labelled local database/HTTP and intercepted-browser boundaries. No new provider quality result.',
    }


def answerability_source_conditions_receipts():
    """Bound this additive chapter; do not duplicate full source packets/transcripts."""
    base = ROOT / 'audit-results/answerability-source-conditions-2026-10-17'

    def bounded_pin(path, project=lambda value: value):
        if not path.exists():
            return None
        raw = path.read_bytes()
        pin = {'path': str(path.relative_to(ROOT)), 'sha256': hashlib.sha256(raw).hexdigest()}
        if len(raw) > 2 * 1024 * 1024:
            return {**pin, 'receipt': None, 'unavailableReason': 'Receipt exceeds this chapter\'s two-MiB admission bound; inspect the original file.'}
        return {**pin, 'receipt': project(json.loads(raw))}

    assessment_fields = ['status', 'sourceSupport', 'notation', 'novelty', 'reasons', 'citations',
                         'findings', 'changes', 'requestedDifficulty', 'achievedDifficulty', 'difficultyMismatch']

    def diagnosis_projection(value):
        cases = []
        for row in value.get('cases', []):
            if row.get('id') not in ('P01', 'P04'):
                continue
            cases.append({**{key: row.get(key) for key in [
                'id', 'candidate', 'requirements', 'historicalRawSourceReview', 'historicalRawSourceReviewPin',
                'independentSourceAudit', 'newContractBehavior', 'sameInputPreserved', 'noNewSemanticOutput']},
                'historicalAssessment': {key: row.get('historicalAssessment', {}).get(key) for key in assessment_fields}})
        return {**{key: value.get(key) for key in ['version', 'scope', 'inputPins', 'knownOpenRequirements',
                                                 'newProviderCalls', 'newSavedDrafts', 'teacherAcceptance']}, 'cases': cases,
                'projection': 'Only P01/P04 candidates, selected assessment fields and bounded diagnostic evidence. Complete originals remain linked.'}

    def controls_projection(value):
        return {'version': value.get('version'), 'cases': [
            {'id': row.get('id'), 'type': row.get('type'), 'difficulty': row.get('difficulty'),
             'historicalStatus': row.get('previousAssessment', {}).get('status'),
             'taggedCorrectKeys': [option.get('key') for option in row.get('candidate', {}).get('options', []) if option.get('role') == 'correct'],
             'sourceReviewTranscriptFile': row.get('sourceReviewTranscriptFile')}
            for row in value.get('cases', [])],
            'projection': 'Six case identities only; no source packet, memory snapshot or raw transcript duplicated in this chapter.'}

    def contract_projection(value):
        selected = []
        for case_id in ('P01', 'P04', 'TF'):
            row = next((item for item in value.get('shapes', []) if item.get('caseId') == case_id and item.get('stage') == 'quality-review'), None)
            if row:
                prompt = row.get('prompt', '')
                prompt_file = None
                if not prompt and row.get('promptFile'):
                    source = (ROOT / row['promptFile']).resolve()
                    if not source.is_relative_to(ROOT):
                        raise ValueError('Book prompt pointer is outside the repository.')
                    raw = source.read_bytes()
                    if len(raw) > 256 * 1024 or hashlib.sha256(raw).hexdigest() != row.get('sha256'):
                        raise ValueError('Book prompt differs from its bounded final shape pin: ' + str(source))
                    prompt = raw.decode('utf8')
                    prompt_file = str(source.relative_to(ROOT))
                marker = '\n\nAUTHORING POLICY:'
                selected.append({'caseId': case_id, 'stage': row.get('stage'), 'utf8InputEstimate': row.get('utf8InputEstimate'),
                                 'exactContractPrefix': prompt.split(marker, 1)[0] if marker in prompt else None,
                                 'fullPromptFile': prompt_file, 'fullPromptSha256': row.get('sha256'),
                                 'prefixScope': 'Exact prefix before AUTHORING POLICY; this is not the complete prompt. Complete inputs remain in the linked original file or verified prompt manifest.'})
        return {'scope': value.get('scope'), 'selectedContracts': selected}

    def headroom_projection(value):
        return {**{key: value.get(key) for key in ['version', 'scope', 'inputs', 'code', 'limits', 'rawRefusals',
                                                  'boundaryAttempts', 'socketAttempts', 'fetchAttempts', 'providerCalls',
                                                  'semanticObservations', 'estimatorNotes']},
                'rows': [{key: row.get(key) for key in ['caseId', 'scenario', 'initial', 'correction',
                                                       'correctionAddedUnits', 'semanticObservation']}
                         for row in value.get('rows', [])]}

    def repair_projection(value):
        cases = {}
        for case_id in ('P01', 'P04'):
            row = value.get('cases', {}).get(case_id)
            if not row:
                continue
            projected = {key: row.get(key) for key in ['syntheticVerdict', 'inputFile', 'pairedInputHash',
                                                      'inputUnchangedAfterBothPlanners', 'verdictFile',
                                                      'originalControlPins', 'serverOnlyPreparations']}
            for arm in ('before', 'after'):
                original = row.get(arm, {})
                result = {key: original.get(key) for key in ['planExists', 'planFile', 'strategy',
                                                            'critiqueCharacters', 'requirementsUnchanged', 'critique']}
                reference = original.get('critique')
                if reference:
                    path = (ROOT / reference['path']).resolve()
                    if not path.is_relative_to(ROOT):
                        raise ValueError('Book critique pointer is outside the repository.')
                    raw = path.read_bytes()
                    if len(raw) > 64 * 1024 or hashlib.sha256(raw).hexdigest() != reference.get('sha256'):
                        raise ValueError('Book critique differs from its paired planner pin: ' + str(path))
                    text = raw.decode('utf8')
                    result.update({'critiqueExcerpt': text[:4500], 'excerptComplete': len(text) <= 4500,
                                   'excerptLimit': 4500})
                projected[arm] = result
            cases[case_id] = projected
        return {**{key: value.get(key) for key in ['version', 'status', 'scope', 'providerCalls', 'databaseCalls',
                                                  'networkCalls', 'boundaryAttempts', 'archive', 'controls',
                                                  'code', 'limitations']}, 'cases': cases,
                'projection': 'No full source packet, paired input or synthetic verdict duplicated. Exact critique text is capped at 4,500 characters per arm; full files stay linked.'}

    def verified_pin(reference, project=lambda value: value):
        if not isinstance(reference, dict) or not isinstance(reference.get('path'), str):
            return None
        path = (ROOT / reference['path']).resolve()
        if not path.is_relative_to(ROOT):
            raise ValueError('Book receipt pointer is outside the repository.')
        pin = bounded_pin(path, project)
        if pin and pin['sha256'] != reference.get('sha256'):
            raise ValueError('Book receipt differs from final verification pin: ' + str(path))
        return pin

    verification = bounded_pin(base / 'verification.json')
    final = (verification or {}).get('receipt') or {}
    ui = verified_pin(final.get('ui')) or bounded_pin(ROOT / 'audit-results/answerability-ui-2026-10-17/verification.json')
    images = []
    names = {
        'desktop-light-answerability.png': 'answerability-desktop-light.png',
        'mobile-dark-answerability.png': 'answerability-mobile-dark.png',
        'desktop-generation-check-details.png': 'answerability-generation-existing-checks.png',
        'desktop-regeneration-answerability.png': 'answerability-regeneration-existing-checks.png',
    }
    for image in ((ui or {}).get('receipt') or {}).get('screenshots', []):
        source = ROOT / image['path']
        name = names.get(source.name)
        if not name or not source.exists():
            continue
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        if digest != image['sha256']:
            raise ValueError('Answerability screenshot no longer matches its verification receipt: ' + str(source))
        shutil.copyfile(source, BOOK / name)
        images.append({**image, 'bookFile': name})
    correction = final.get('correctionHeadroom') or {}
    result = {
        'diagnosis': bounded_pin(base / 'diagnosis.json', diagnosis_projection),
        'verification': verification,
        'promptComparison': verified_pin(final.get('promptComparison')),
        'contracts': verified_pin(final.get('promptShapes'), contract_projection),
        'initialPromptComparison': bounded_pin(base / 'prompt-comparison.json'),
        'initialContracts': bounded_pin(base / 'prompt-shapes-after.json', lambda value: {
            'scope': value.get('scope'), 'projection': 'Historical full inputs are linked, not duplicated in this chapter.'}),
        'repairBrief': verified_pin(final.get('repairBrief'), repair_projection),
        'correctionHeadroom': {
            'initial': verified_pin(correction.get('initial'), headroom_projection)
                       or bounded_pin(base / 'correction-headroom/run-r1/results.json', headroom_projection),
            'firstCompact': verified_pin(correction.get('firstCompact'), headroom_projection),
            'final': verified_pin(correction.get('final'), headroom_projection),
            'scenarioCount': correction.get('scenarioCount'),
            'simulatedInitialAdmissions': correction.get('simulatedInitialAdmissions'),
            'simulatedCorrectionAdmissions': correction.get('simulatedCorrectionAdmissions'),
            'allFinalCorrectionsFit': correction.get('allFinalCorrectionsFit'),
            'largestFinalRawEstimate': correction.get('largestFinalRawEstimate'),
            'unchangedCap': correction.get('unchangedCap'), 'estimatorScope': correction.get('estimatorScope'),
        },
        'retainedControls': bounded_pin(ROOT / 'audit-results/answerability-retained-probe-2026-10-17/retained-controls.json', controls_projection),
        'conditionReplay': verified_pin(final.get('sourceConditionReplay')) or bounded_pin(ROOT / 'audit-results/source-condition-context-2026-10-17/offline-input-replay/results.json'),
        'ui': ui, 'screenshots': images,
        'scope': 'Offline input and mocked UI evidence only. No new provider judgment, generated outline, saved-yield result or teacher acceptance.',
    }
    if len(json.dumps(result, ensure_ascii=True).encode()) > 512 * 1024:
        raise ValueError('Answerability chapter projection exceeds its 512-KiB bound.')
    return result


def visual_source_obligation_receipts():
    """Local visual signals and historical task demand are not semantic outcomes."""
    base = ROOT / 'audit-results/pdf-visual-obligations-2026-10-17'

    def bounded_pin(path, project=lambda value: value):
        if not path.exists():
            return None
        raw = path.read_bytes()
        pin = {'path': str(path.relative_to(ROOT)), 'sha256': hashlib.sha256(raw).hexdigest()}
        if len(raw) > 16 * 1024 * 1024:
            return {**pin, 'receipt': None, 'unavailableReason': 'Receipt exceeds the bounded book input; inspect the linked original.'}
        return {**pin, 'receipt': project(json.loads(raw))}

    def verified_pin(reference, project=lambda value: value):
        if not isinstance(reference, dict) or not isinstance(reference.get('path'), str):
            return None
        path = (ROOT / reference['path']).resolve()
        if not path.is_relative_to(ROOT):
            raise ValueError('Visual book receipt pointer is outside the repository.')
        pin = bounded_pin(path, project)
        if pin and pin['sha256'] != reference.get('sha256'):
            raise ValueError('Visual book receipt differs from final verification: ' + str(path))
        return pin

    def inventory_projection(value):
        return {key: value.get(key) for key in ['version', 'status', 'scope', 'method', 'policy', 'budgets',
                                               'totals', 'timing', 'storage', 'files', 'priorityQueue',
                                               'measurement', 'boundaries', 'integrity', 'failures',
                                               'providerCalls', 'databaseCalls', 'networkCalls', 'limitations']}

    def page_projection(value):
        rows = value.get('pages', value.get('examples', []))
        examples = []
        for index, row in enumerate(rows[:12]):
            item = dict(row)
            render = row.get('render')
            if isinstance(render, dict) and render.get('path'):
                source = (ROOT / render['path']).resolve()
                if not source.is_relative_to(ROOT):
                    raise ValueError('Visual page render is outside the repository.')
                raw = source.read_bytes()
                digest = hashlib.sha256(raw).hexdigest()
                if source.suffix.lower() != '.png' or len(raw) > 8 * 1024 * 1024 or digest != render.get('sha256'):
                    raise ValueError('Visual page render differs from its bounded PNG pin: ' + str(source))
                name = 'visual-obligation-' + str(index + 1) + '-' + digest[:12] + '.png'
                shutil.copyfile(source, BOOK / name)
                item['bookFile'] = name
            examples.append(item)
        return {**{key: value.get(key) for key in ['version', 'scope', 'selection', 'renders', 'fixture', 'summary',
                                                 'newProviderCalls', 'newSavedDrafts', 'newAppliedOutlines',
                                                 'teacherAcceptance', 'limitations']},
                'pages': examples, 'originalExampleCount': len(rows),
                'projection': 'At most twelve pinned original-page examples. Full page/check records remain linked.'}

    def demand_projection(value):
        p04 = value.get('P04', {})
        control = p04.get('control', {})
        old = control.get('value', {})
        assessment = old.get('previousAssessment', {})
        public = p04.get('publicObservation', {})
        observed = public.get('value', {})
        cohort = value.get('cohort', {})
        representatives = []
        for row in cohort.get('representatives', [])[:8]:
            cell = row.get('cell', {})
            data = cell.get('value', {})
            generator = next((capture for capture in row.get('captures', []) if capture.get('stage') == 'model-comparison-generator'), None)
            representatives.append({'cell': {key: cell.get(key) for key in ['file', 'pointer']},
                                    'observed': {key: data.get(key) for key in ['cellId', 'caseId', 'arm', 'difficulty',
                                                'requestedKind', 'candidateNumericKind', 'qualityState', 'combinedLabEligible',
                                                'requestedKindFulfilled', 'judgeReasons', 'candidateSha256', 'acquisition']},
                                    'captures': row.get('captures'), 'labelAuthority': row.get('labelAuthority'),
                                    'recordedGenerator': verified_pin(generator.get('file'), lambda capture: {
                                        'stage': capture.get('stage'), 'status': capture.get('status'), 'parsed': capture.get('parsed')}) if generator else None})
        return {**{key: value.get(key) for key in ['version', 'status', 'scope', 'providerCalls', 'databaseCalls',
                                                  'networkCalls', 'productionEdits', 'r5', 'limitations']},
                'P04': {**{key: p04.get(key) for key in ['trace', 'traceCallsRetained', 'teacherRequirementsUnchangedInFinalControl',
                                                      'actualCondition', 'savedCount', 'newSemanticLabel']},
                        'control': {key: control.get(key) for key in ['file', 'pointer', 'fieldSha256']},
                        'request': {key: old.get(key) for key in ['type', 'difficulty', 'prompt']},
                        'candidate': old.get('candidate'),
                        'assessment': {key: assessment.get(key) for key in ['status', 'requestedDifficulty', 'achievedDifficulty',
                                                                           'difficultyMismatch', 'sourceSupport']},
                        'publicObservation': {key: public.get(key) for key in ['file', 'pointer', 'fieldSha256']},
                        'publicInput': observed.get('input'), 'publicSupply': observed.get('supply'),
                        'traceReceipt': verified_pin(p04.get('trace'))},
                'cohort': {**{key: cohort.get(key) for key in ['source', 'cells', 'positive', 'safetyNegative', 'summary',
                                                            'byArm', 'strictFulfillmentDefinition', 'originalCostsImmutable',
                                                            'teacherAcceptance', 'modelRankingClaim']},
                           'representatives': representatives},
                'currentCodeEvidence': [{key: row.get(key) for key in ['file', 'startLine', 'endLine']}
                                        for row in value.get('currentCodeEvidence', [])],
                'projection': 'Selected request/candidate/verdict fields and seven bounded trace outputs. Original packets, full prompts and source code stay linked, not duplicated.'}

    def headroom_projection(value):
        aggregate = value.get('aggregateWorstMeasured', {})
        simulations = {key: {'snapshot': aggregate.get(key, {}).get('snapshot')}
                       for key in ['qualityOnly12SendSimulation', 'full16SendSimulation']}
        return {**{key: value.get(key) for key in ['version', 'scope', 'inputs', 'codeManifest', 'harness',
                                                  'controlsCopy', 'controlAdditions', 'limits', 'step',
                                                  'initialCount', 'correctionCount', 'summary', 'refusals',
                                                  'legacyAbsentSelectorBytesIdentical',
                                                  'originalPayloadFieldsDeepEqualExceptThreeMetadataKeys',
                                                  'boundaries', 'providerCalls', 'semanticObservations',
                                                  'saved', 'adopted', 'limitations']},
                'aggregateWorstMeasured': {**{key: aggregate.get(key) for key in ['scope', 'hypotheticalSends',
                                                                                 'conservativeInputPlusOutputUnits',
                                                                                 'exceeds320k']}, **simulations},
                'projection': 'Exact six-case summaries and simulated budget snapshots only. Full per-response rows and captured prompts remain in the pinned original.'}

    verification = bounded_pin(base / 'verification.json')
    final = (verification or {}).get('receipt') or {}
    implementation = verified_pin(final.get('taskDemandImplementation'))
    current = (implementation or {}).get('receipt') or {}
    result = {'verification': verification,
              'inventory': verified_pin(final.get('inventory'), inventory_projection),
              'localVerification': verified_pin(final.get('localVerification')),
              'priorityQueue': verified_pin(final.get('priorityQueue')),
              'originalPageChecks': verified_pin(final.get('originalPageChecks'), page_projection),
              'originalLedgerReconciliation': verified_pin(final.get('originalLedgerReconciliation')),
              'rootIntegrityCheck': verified_pin(final.get('rootIntegrityCheck')),
              'taskDemandAudit': verified_pin(final.get('taskDemandAudit'), demand_projection),
              'taskDemandImplementation': implementation,
              'demandPipelineControls': verified_pin(current.get('pipelineControls')),
              'demandCoreVerification': verified_pin(current.get('coreVerification')),
              'demandHeadroomHistory': verified_pin(current.get('headroom')),
              'demandCurrentHeadroom': verified_pin(current.get('currentHeadroom'), headroom_projection),
              'currentPaidProbe': verified_pin(final.get('currentPaidProbe')),
              'scope': 'Offline observations and independently inspected original-page examples. Native text, raster/vector signals, unresolved interpretation and requested-task fulfillment are separate.'}
    if len(json.dumps(result, ensure_ascii=True).encode()) > 512 * 1024:
        raise ValueError('Visual-obligation chapter projection exceeds its 512-KiB bound.')
    return result


def page_text_obligation_receipts():
    """Keep actual native replay, synthetic UI and local OCR denominators separate."""
    base = ROOT / 'audit-results/pdf-page-obligations-2026-10-17'

    def verified(reference, project=lambda value: value):
        if not isinstance(reference, dict) or not isinstance(reference.get('path'), str):
            return None
        path = (ROOT / reference['path']).resolve()
        if not path.is_relative_to(ROOT):
            raise ValueError('Page-text evidence is outside the repository.')
        raw = path.read_bytes()
        if len(raw) > 2 * 1024 * 1024 or hashlib.sha256(raw).hexdigest() != reference.get('sha256'):
            raise ValueError('Page-text evidence differs from its bounded final pin: ' + str(path))
        return {**reference, 'receipt': project(json.loads(raw))}

    def replay_projection(value):
        return {**{key: value.get(key) for key in ['state', 'scope', 'oldNativeIngest', 'inputPins', 'totals',
                                                  'rasterTableControl', 'elapsedMs', 'deniedBoundaries', 'providerCalls',
                                                  'newSavedDrafts', 'newAppliedOutlines', 'limitations']},
                'files': [{**{key: row.get(key) for key in ['chapter', 'materialId', 'provenanceId', 'rawObservations']},
                           'observation': {key: row.get('observation', {}).get(key) for key in [
                               'version', 'status', 'interpretation', 'teachingCoverage', 'pdfSha256', 'rawTextSha256',
                               'pageMapSha256', 'observationsSha256', 'sparseThreshold', 'counts']}}
                          for row in value.get('files', [])[:10]],
                'projection': 'Ten compact source summaries only. Exact source/native pins, all page rows and lossless ranges remain in the linked original receipt.'}

    verification = pinned_receipt(base / 'verification.json')
    final = (verification or {}).get('receipt') or {}
    ui = final.get('ui', {})
    shots = []
    for index, pin in enumerate(ui.get('screenshots', [])[:2]):
        path = (ROOT / pin['path']).resolve()
        if not path.is_relative_to(ROOT):
            raise ValueError('Page-text UI image is outside the repository.')
        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if path.suffix.lower() != '.png' or len(raw) > 8 * 1024 * 1024 or digest != pin.get('sha256'):
            raise ValueError('Page-text UI image differs from its bounded final pin.')
        name = 'native-page-text-ui-' + str(index + 1) + '-' + digest[:12] + '.png'
        shutil.copyfile(path, BOOK / name)
        shots.append({**pin, 'bookFile': name, 'fixture': 'Synthetic: 10 blank, 10 sparse, 579 present; not observed corpus states.'})
    ocr = final.get('localOCR', {})
    result = {'verification': verification,
              'replay': verified(final.get('tenFileReplay', {}).get('receipt'), replay_projection),
              'ocr': verified(ocr.get('receipt')), 'cells': verified(ocr.get('cellResults')),
              'manualControls': verified(ocr.get('manualControls'), lambda value: {
                  key: value.get(key) for key in ['scope', 'inputImage', 'labelTiming', 'notes']}),
              'priorDeclaration': verified(final.get('priorDeclaration', {}).get('receipt')),
              'nextDuplicateGap': verified(final.get('nextDuplicateGap')),
              'browserLaunchFailure': pinned_receipt(base / 'browser-r1-launch-failure.json'),
              'screenshots': shots,
              'scope': 'Actual native page-volume output is separate from synthetic UI checks and a one-image local OCR diagnostic. Original text, historical results and semantic coverage remain unchanged.'}
    if len(json.dumps(result, ensure_ascii=True).encode()) > 512 * 1024:
        raise ValueError('Page-text chapter projection exceeds its 512-KiB bound.')
    return result


def exact_bank_repair_receipts():
    """Project exact-match mechanics; never load the full unit report or Bank into the book."""
    base = ROOT / 'audit-results/bank-memory-exact-repair-2026-10-17'

    def verified(reference, project=lambda value: value, text_only=False):
        if not isinstance(reference, dict) or not isinstance(reference.get('path'), str):
            return None
        path = (ROOT / reference['path']).resolve()
        if not path.is_relative_to(ROOT):
            raise ValueError('Exact-Bank book evidence is outside the repository.')
        raw = path.read_bytes()
        if len(raw) > 2 * 1024 * 1024 or hashlib.sha256(raw).hexdigest() != reference.get('sha256'):
            raise ValueError('Exact-Bank evidence differs from its bounded final pin: ' + str(path))
        return {**reference, 'receipt': {'format': 'Markdown; complete content remains linked'} if text_only else project(json.loads(raw))}

    verification = pinned_receipt(base / 'verification.json')
    final = (verification or {}).get('receipt') or {}
    replay = verified(final.get('sameInputReplay'))
    replay_data = (replay or {}).get('receipt') or {}
    original_input = replay_data.get('input', {})
    input_reference = {**original_input, 'path': str((base / original_input['path']).relative_to(ROOT))} if original_input.get('path') else None
    screenshots = []
    for index, pin in enumerate(final.get('ui', {}).get('screenshots', [])[:2]):
        path = (ROOT / pin['path']).resolve()
        if not path.is_relative_to(ROOT):
            raise ValueError('Exact-Bank UI image is outside the repository.')
        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if path.suffix.lower() != '.png' or len(raw) > 8 * 1024 * 1024 or digest != pin.get('sha256'):
            raise ValueError('Exact-Bank UI image differs from its bounded final pin.')
        name = 'exact-bank-ui-' + str(index + 1) + '-' + digest[:12] + '.png'
        shutil.copyfile(path, BOOK / name)
        screenshots.append({**pin, 'bookFile': name, 'scope': 'Synthetic UI receipt: 121 current versions checked and zero matches; not the real Mongo 202/two-match control.'})
    result = {'verification': verification, 'replay': replay,
              'input': verified(input_reference, lambda value: {key: value.get(key) for key in [
                  'fixtureScope', 'retainedPrimaryPath', 'retainedFixtureDeclarationSha256', 'candidate']}),
              'mongo': verified(final.get('localMongo', {}).get('receipt')),
              'mongoVerification': verified(final.get('localMongo', {}).get('verification'), lambda value: {
                  key: value.get(key) for key in ['scope', 'terminalResult', 'terminalResultSha256', 'terminalGroups',
                                                'realReplicaSetControl', 'allExternalAttempts', 'ownedDatabaseDropped',
                                                'productionPinsUnchanged', 'runnerMatchesExecutedSnapshot']}),
              'ui': verified(final.get('ui', {}).get('receipt')),
              'priorFailedTests': verified(final.get('priorFailedTests')),
              'docs': verified(final.get('docs'), text_only=True), 'screenshots': screenshots,
              'scope': 'Same-input in-memory replay, actual owned local Mongo controls, scripted regression and synthetic UI remain distinct scopes. No model quality, saved-yield or semantic novelty claim.'}
    if len(json.dumps(result, ensure_ascii=True).encode()) > 512 * 1024:
        raise ValueError('Exact-Bank chapter projection exceeds its 512-KiB bound.')
    return result


def task_retrieval_repair_receipts():
    """Bound current-course nomination evidence; never project a full Bank or vector."""
    base = ROOT / 'audit-results/bank-task-retrieval-repair-2026-10-17'

    def verified(reference, project=lambda value: value, text_only=False):
        if not isinstance(reference, dict) or not isinstance(reference.get('path'), str):
            return None
        path = (ROOT / reference['path']).resolve()
        if not path.is_relative_to(ROOT):
            raise ValueError('Task-retrieval book evidence is outside the repository.')
        raw = path.read_bytes()
        if len(raw) > 2 * 1024 * 1024 or hashlib.sha256(raw).hexdigest() != reference.get('sha256'):
            raise ValueError('Task-retrieval evidence differs from its bounded final pin: ' + str(path))
        return {**reference, 'receipt': {'format': 'Markdown; complete content remains linked'} if text_only else project(json.loads(raw))}

    def retrieval_projection(value):
        return {key: value.get(key) for key in ['protocol', 'rankerVersion', 'queryHash', 'bindingsDigest', 'status',
            'incompleteReason', 'headsScanned', 'versionsChecked', 'missingVersions', 'invalidVersions', 'invalidHeads',
            'missingDescriptors', 'ignoredProfiles', 'unscannedHeadsLowerBound', 'requiredComparisonIds']}

    def replay_projection(value):
        rows = []
        for row in value.get('cases', [])[:12]:
            item = {key: row.get(key) for key in ['id', 'targetQuestionId', 'exactCandidateHash', 'absentSelectorPromptBytesIdentical']}
            for arm in ['before', 'after']:
                source = row.get(arm, {})
                item[arm] = {key: source.get(key) for key in ['loadedEntries', 'targetExposed', 'targetRequired',
                    'requiredComparisonIds', 'textChars', 'utf8Bytes', 'contentTruncated', 'omittedCount', 'semanticVerdict']}
                item[arm]['selectedIds'] = source.get('selectedIds', [])[:12]
                if source.get('receipt'):
                    item[arm]['receipt'] = retrieval_projection(source['receipt'])
            rows.append(item)
        controls = value.get('controls', {})
        return {**{key: value.get(key) for key in ['status', 'scope', 'input', 'script', 'sources', 'execution', 'limitations']},
                'cases': rows, 'controls': {**{key: controls.get(key) for key in [
                    'unchangedReplayDigestEqual', 'currentProfileChange', 'storedEntryTamperRefused',
                    'emptyOrDifferentInferenceNotAnAutomaticDuplicate']},
                    'boundedScan': retrieval_projection(controls.get('boundedScan', {}))},
                'projection': 'Only compact case relationships and hash-bound diagnostics. Full original Bank/input/rendered-memory bytes remain in linked files.'}

    verification = pinned_receipt(base / 'verification.json')
    final = (verification or {}).get('receipt') or {}
    replay = verified(final.get('replay'), replay_projection)
    replay_data = (replay or {}).get('receipt') or {}
    input_pin = replay_data.get('input', {})
    input_reference = {**input_pin, 'path': str((Path(final['replay']['path']).parent / input_pin['path']))} if input_pin.get('path') else None

    def input_projection(value):
        targets = {row.get('id'): row.get('targetQuestionId') for row in replay_data.get('cases', [])}
        examples = []
        for scenario in value.get('scenarios', [])[:12]:
            target = targets.get(scenario.get('id'))
            data = scenario.get('data', {})
            versions = data.get('versions', [])
            head = next((row for row in data.get('heads', []) if row.get('_id') == target), None)
            original = next((row for row in versions if row.get('questionId') == target and head and row.get('_id') == head.get('currentVersionId')), None)
            examples.append({'id': scenario.get('id'), 'targetQuestionId': target,
                             'target': {key: original.get(key) for key in ['_id', 'questionId', 'type', 'numericKind', 'stem', 'options', 'paramSlots', 'derivedValues']} if original else None})
        return {**{key: value.get(key) for key in ['scope', 'syntheticTeachingContext', 'candidate']}, 'examples': examples,
                'projection': 'Candidate and exact declared target versions only; complete synthetic Bank fixtures remain linked.'}

    screenshots = []
    for index, pin in enumerate(final.get('ui', {}).get('screenshots', [])[:2]):
        path = (ROOT / pin['path']).resolve()
        if not path.is_relative_to(ROOT):
            raise ValueError('Task-retrieval UI image is outside the repository.')
        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if path.suffix.lower() != '.png' or len(raw) > 8 * 1024 * 1024 or digest != pin.get('sha256'):
            raise ValueError('Task-retrieval UI image differs from its bounded final pin.')
        name = 'task-retrieval-ui-' + str(index + 1) + '-' + digest[:12] + '.png'
        shutil.copyfile(path, BOOK / name)
        screenshots.append({**pin, 'bookFile': name, 'scope': 'Synthetic UI: 202 current versions, two nominations and two required comparisons. No live Bank scan or semantic verdict.'})
    result = {'verification': verification, 'replay': replay, 'input': verified(input_reference, input_projection),
              'headroom': verified(final.get('headroom', {}).get('final')),
              'headroomInitial': verified(final.get('headroom', {}).get('initial')),
              'mongo': verified(final.get('localMongo', {}).get('receipt'), lambda value: {
                  **{key: value.get(key) for key in ['status', 'scope', 'elapsedMs', 'topology', 'cleanup', 'counters',
                      'semanticAssessment', 'limitations', 'sourcePinsUnchanged', 'providerCalls', 'embeddingCalls',
                      'savedDrafts', 'adoptions', 'savedDraftsScope', 'applicationDatabaseUsed']},
                  'groups': [{key: field for key, field in row.items() if key not in ['cap', 'missing', 'before', 'after']}
                             for row in value.get('groups', [])[:12]]}),
              'sourceArchive': verified(final.get('sourceFiles'), lambda value: {
                  'version': value.get('version'), 'scope': value.get('scope'),
                  'fileCount': len(value.get('files', [])), 'totalBytes': value.get('totalBytes')}),
              'priorFailedTests': verified(final.get('priorFailedTests')),
              'ui': verified(final.get('ui', {}).get('receipt')), 'docs': verified(final.get('docs'), text_only=True),
              'bookReaderHistory': pinned_receipt(base / 'book-visible-topology-repair.json'),
              'screenshots': screenshots,
              'scope': 'Current-course traversal and mandatory-comparison mechanics, not semantic recall or teacher acceptance. No raw vectors, entire Banks or unit-report logs are projected.'}
    if len(json.dumps(result, ensure_ascii=True).encode()) > 512 * 1024:
        raise ValueError('Task-retrieval chapter projection exceeds its 512-KiB bound.')
    return result


def supported_coverage_repair_receipts():
    """Small original/derived example; complete checkpoints stay linked, never duplicated."""
    base = ROOT / 'audit-results/outline-supported-coverage-repair-2026-10-17'
    replay = base / ('replay-r2' if (base / 'replay-r2/results.json').exists() else 'replay')

    def project_pin(path, projection=lambda value: value):
        pin = pinned_receipt(path)
        return {**pin, 'receipt': projection(pin['receipt'])} if pin else None

    def tests(value):
        return {key: value.get(key) for key in ['success', 'numPassedTestSuites', 'numPassedTests', 'numFailedTestSuites',
                                               'numFailedTests', 'numTotalTests', 'wasInterrupted']}

    result = pinned_receipt(replay / 'results.json')
    if not result:
        return {'state': 'no-replay-recorded', 'verification': pinned_receipt(base / 'verification.json')}
    record = result['receipt']
    raw_io = []
    for name, label in [
        ('proposal-request.txt', 'Exact coverage proposal input'),
        ('proposal-response.synthetic.json', 'Scripted proposal response — no model call'),
        ('review-request-0.txt', 'Exact independent-review input'),
        ('review-response-0.synthetic.json', 'Injected malformed review response'),
        ('review-request-1.txt', 'Exact bounded correction input'),
        ('review-response-1.synthetic.json', 'Scripted correction response — no model call'),
    ]:
        path = replay / name
        raw = path.read_bytes()
        if len(raw) > 64 * 1024:
            raise ValueError('Supported coverage I/O exceeds its bounded display size.')
        pin = next((row for row in record.get('artifacts', []) if row.get('path') == name), None)
        if not pin:
            pin = next((row[key] for row in record.get('simulatedReviewAttempts', []) for key in ['input', 'output']
                        if row[key].get('path') == name), None)
        if not pin or hashlib.sha256(raw).hexdigest() != pin.get('sha256'):
            raise ValueError('Supported coverage I/O differs from its replay pin: ' + name)
        raw_io.append({'label': label, 'path': str(path.relative_to(ROOT)), 'sha256': pin['sha256'],
                       'text': raw.decode(), 'scope': 'Input or explicitly scripted output; no provider dispatch.'})
    inputs = pinned_receipt(replay / 'exact-inputs.json')
    if not inputs or not any(row.get('path') == 'exact-inputs.json' and row.get('sha256') == inputs['sha256']
                             for row in record.get('artifacts', [])):
        raise ValueError('Supported coverage example differs from its replay input pin.')
    payload = {
        'state': 'offline-contract-verified-semantic-recovery-unmeasured',
        'replay': result, 'input': inputs,
        'firstIllustration': project_pin(base / 'replay/results.json', lambda value: {
            key: value.get(key) for key in ['version', 'scope', 'before', 'after', 'execution', 'limitations']}),
        'wordingAudit': pinned_receipt(base / 'replay-r2/root-wording-audit.json'),
        'diagnosis': project_pin(ROOT / 'audit-results/outline-coverage-next-gap-2026-10-17/results.json', lambda value: {
            key: value.get(key) for key in ['status', 'scope', 'terminalFacts', 'primaryObservation', 'contrasts', 'codeReferences', 'limits', 'execution']}),
        'pins': pinned_receipt(replay / 'pins.json'),
        'pureTests': project_pin(BOOK / 'supported-coverage-focused-tests.json', tests),
        'serviceTests': project_pin(BOOK / 'supported-coverage-service-tests.json', tests),
        'serviceVerification': pinned_receipt(ROOT / 'audit-results/supported-lo-coverage-repair-2026-10-17/service-verification.json'),
        'initialTests': project_pin(BOOK / 'supported-coverage-initial-tests.json', tests),
        'verification': pinned_receipt(base / 'verification.json') or pinned_receipt(ROOT / 'audit-results/authoring-planning-repair-2026-10-17/verification-final.json'),
        'rawIO': raw_io,
        'docs': {'path': 'docs/design/question-generation-quality/SUPPORTED-LO-COVERAGE-REPAIR-IMPLEMENTATION-2026-10-17.md'},
        'rawReplay': {'path': str((replay / 'results.json').relative_to(ROOT))},
        'scope': 'Actual old E13/L4 source/label/finding plus a clearly synthetic after demonstration. This stage does not revise the 119/142 real result, save a question or apply a hierarchy.',
    }
    if len(json.dumps(payload, ensure_ascii=True).encode()) > 192 * 1024:
        raise ValueError('Supported coverage chapter projection exceeds its 192-KiB bound.')
    return payload


def authoring_flow_headroom_receipts():
    """Project full-flow input admission, preserving every historical refusal."""
    base = ROOT / 'audit-results/authoring-flow-headroom-2026-10-17'

    def project_run(name):
        path = base / name / 'results.json'
        pin = pinned_receipt(path)
        if not pin:
            return None
        value = pin['receipt']
        rows = []
        for row in value.get('rows', []):
            captures = []
            for capture in row.get('captures', []):
                actual = capture.get('actualAdmission')
                captures.append({**{key: capture.get(key) for key in ['stage', 'jsonAttempt', 'file']},
                                 'actualAdmission': {key: actual.get(key) for key in ['file', 'sha256', 'inputEstimate']}
                                 if actual else None})
            rows.append({'caseId': row.get('caseId'), 'scenario': row.get('scenario'), 'outcome': row.get('outcome'),
                         'captures': captures, 'failure': row.get('failure'), 'progressFailures': row.get('progressFailures', [])})
        summary = {**{key: value.get(key) for key in ['version', 'status', 'scope', 'sourcePinsUnchanged', 'refusals',
                      'effectiveNumericConfig', 'counters', 'boundaryFailures', 'observedProviderInputTokens',
                      'observedProviderOutputTokens', 'actualProviderSends', 'savedDrafts']}, 'rows': rows}
        manifest = pinned_receipt(base / name / 'manifest.json')
        if manifest:
            original = manifest['receipt']
            manifest = {**manifest, 'receipt': {**{key: original.get(key) for key in ['version', 'scope', 'controls', 'runnerSha256',
                         'nodeVersion', 'typescriptVersion', 'productionBodyPolicy', 'retrievalScope', 'providerScope']},
                         'sourceFiles': len(original.get('sourcePins', [])),
                         'projection': 'Complete source hashes and copies remain in the linked original manifest.'}}
        return {'label': name, 'result': {**pin, 'receipt': summary}, 'manifest': manifest,
                'verification': pinned_receipt(base / ('verification-' + name.removeprefix('run-') + '.json'))}

    later_runs = sorted((path.name for path in base.glob('run-r*')
                         if path.is_dir() and path.name.removeprefix('run-r').isdigit()
                         and 8 <= int(path.name.removeprefix('run-r')) <= 11),
                        key=lambda name: int(name.removeprefix('run-r')))
    final = pinned_receipt(base / 'verification-final.json') or pinned_receipt(base / 'verification-r11.json')
    versions = [row for name in ['run-r4', 'run-r6', 'run-r7', *later_runs] if (row := project_run(name))]
    source_changes, runner_trace = [], None
    if versions:
        before_name, after_name = versions[0]['label'], versions[-1]['label']
        before = load(base / before_name / 'manifest.json') or {}
        after = load(base / after_name / 'manifest.json') or {}
        runner_trace = {'before': {'path': str((base / before_name / 'code/audit.cjs').relative_to(ROOT)),
                                   'sha256': before.get('runnerSha256')},
                        'after': {'path': str((base / after_name / 'code/audit.cjs').relative_to(ROOT)),
                                  'sha256': after.get('runnerSha256')},
                        'scope': 'Archived executable fixture/SDK-response inputs, not a provider output transcript. The latest revision adds one nested quality-correction JSON fault scenario.'}
        old = {row['path']: row for row in before.get('sourcePins', [])}
        for row in after.get('sourcePins', []):
            previous = old.get(row['path'])
            if not previous or previous['sha256'] != row['sha256']:
                source_changes.append({'path': row['path'], 'beforeSha256': previous['sha256'] if previous else None, 'afterSha256': row['sha256'],
                                       'before': {'path': str((base / before_name / 'code' / row['path']).relative_to(ROOT))} if previous else None,
                                       'after': {'path': str((base / after_name / 'code' / row['path']).relative_to(ROOT))}})
    protected = pinned_receipt(base / 'protected-run-r10-run-r11.json')
    if protected:
        protected = {**protected, 'receipt': {key: value for key, value in protected['receipt'].items()
                                            if key not in ['inputFiles', 'rows']}}
    combined = pinned_receipt(ROOT / 'audit-results/authoring-planning-repair-2026-10-17/combined-r2.json')
    if combined:
        combined = {**combined, 'receipt': {key: combined['receipt'].get(key) for key in ['success', 'numPassedTestSuites',
                      'numPassedTests', 'numFailedTestSuites', 'numFailedTests', 'numTotalTests', 'wasInterrupted']}}
    payload = {'state': 'awaiting-final-verification' if not final else 'file-only-full-flow-admission-recorded',
               'versions': versions, 'sourceChanges': source_changes, 'runnerTrace': runner_trace,
               'protectedComparison': protected, 'combinedTests': combined,
               'verification': final,
               'engineeringVerification': pinned_receipt(ROOT / 'audit-results/authoring-planning-repair-2026-10-17/verification-final.json'),
               'docs': {'path': 'docs/design/question-generation-quality/AUTHORING-PIPELINE-HEADROOM-2026-10-17.md'},
               'comparisonFailure': pinned_receipt(base / 'verification-r7-first-attempt.json'),
               'focusedHistory': pinned_receipt(ROOT / 'audit-results/authoring-planning-repair-2026-10-17/checkpoints.json'),
               'scope': 'Actual production prompt/JSON/admission flow with injected SDK responses and in-memory adapters. No provider quality, billed tokens or saved-yield result; legacy failures stay explicit.'}
    if len(json.dumps(payload, ensure_ascii=True).encode()) > 512 * 1024:
        raise ValueError('Full-flow headroom chapter exceeds its 512-KiB bound.')
    return payload


def numeric_finite_domain_receipts():
    """Bounded local arithmetic proof; no inferred model or teaching outcome."""
    base = ROOT / 'audit-results/numeric-finite-domain-2026-10-17'
    before, input_pin = pinned_receipt(base / 'before-counterexample.json'), pinned_receipt(base / 'input.json')
    if not before or not input_pin:
        return {'state': 'no-counterexample-recorded'}
    if before['receipt'].get('input') != input_pin['receipt']:
        raise ValueError('Numerical counterexample input differs from its retained input file.')

    def test_pin(name):
        pin = pinned_receipt(base / name)
        if pin:
            pin = {**pin, 'receipt': {key: pin['receipt'].get(key) for key in ['success', 'numPassedTestSuites',
                       'numPassedTests', 'numFailedTestSuites', 'numFailedTests', 'numTotalTests', 'wasInterrupted']}}
        return pin

    manifest = pinned_receipt(base / 'before-manifest.json')
    archived = {row['path']: row['sha256'] for row in (manifest or {}).get('receipt', {}).get('files', [])}
    differences = [{'path': row['path'], 'recordedCaptureHash': row['sha256'], 'archivedBeforeHash': archived.get(row['path'])}
                   for row in before['receipt'].get('sourcePins', []) if archived.get(row['path']) != row['sha256']]
    verification = pinned_receipt(base / 'verification-final.json') or pinned_receipt(base / 'verification.json')
    after = pinned_receipt(base / 'after.json')
    if after and (after['receipt'].get('input') != input_pin['receipt'] or after['receipt'].get('unchangedInput') is not True):
        raise ValueError('Numerical after observation does not bind the exact retained input.')
    ui = pinned_receipt(base / 'ui/verification-final.json')
    flow = pinned_receipt(base / 'flow-recheck/verification.json')
    if flow:
        flow = {**flow, 'receipt': {key: value for key, value in flow['receipt'].items() if key != 'sourceChecks'}}
    flow_result = pinned_receipt(base / 'flow-recheck/run-r1/results.json')
    if flow_result:
        flow_result = {key: value for key, value in flow_result.items() if key != 'receipt'}
    screenshots = []
    if ui:
        for row in ui['receipt'].get('screenshots', []):
            if not row['path'].endswith(('desktop-light-finite-grid-banner.png', 'mobile-dark-finite-grid-banner.png', 'rejected-grid-tuple-banner.png')):
                continue
            original = ROOT / row['path']
            if hashlib.sha256(original.read_bytes()).hexdigest() != row['sha256']:
                raise ValueError('Finite numerical UI image differs from its pinned receipt.')
            name = 'numeric-finite-ui-' + Path(row['path']).stem + '-' + row['sha256'][:12] + '.png'
            shutil.copyfile(original, BOOK / name)
            screenshots.append({**row, 'bookFile': name})
    payload = {'state': 'offline-after-recorded' if after and verification else 'awaiting-final-after-and-verification',
               'before': before, 'input': input_pin, 'beforeManifest': manifest, 'recordedSourcePinDifferences': differences,
               'regressionBefore': test_pin('regression-before.json'), 'focusedTests': test_pin('focused-r1.json'),
               'integrationTests': test_pin('integration-r1.json'),
               'after': after, 'verification': verification,
               'beforeReconstruction': pinned_receipt(base / 'before-reconstruction/results.json'),
               'servingBoundary': pinned_receipt(base / 'serving-boundary.json'),
               'flowRecheck': flow, 'flowResult': flow_result,
               'uiVerification': ui, 'screenshots': screenshots,
               'docs': {'path': 'docs/design/question-generation-quality/FINITE-NUMERICAL-DOMAIN-2026-10-17.md'},
               'scope': 'Synthetic closed-formula collision fixture and local arithmetic validation only. No generated finance candidate, semantic judgment, teacher acceptance or new saved yield.',
               'sourceReconciliation': [pinned_receipt(path) for path in sorted(base.glob('*reconcil*.json'))]}
    if len(json.dumps(payload, ensure_ascii=True).encode()) > 192 * 1024:
        raise ValueError('Finite numerical proof chapter exceeds its 192-KiB display bound.')
    return payload


def outline_repair_workspace_receipts():
    """Product workflow evidence; scripted findings never become quality labels."""
    base = ROOT / 'audit-results/outline-repair-workspace-2026-10-17'

    def bounded_pin(path, projection=None):
        pin = pinned_receipt(path)
        if pin and projection:
            pin = {**pin, 'receipt': projection(pin['receipt'])}
        if pin and len(json.dumps(pin, ensure_ascii=True).encode()) > 384 * 1024:
            pin = {**pin, 'receipt': None, 'projection': 'Full receipt linked; exceeds the chapter display bound.'}
        return pin

    def tests(value):
        return {key: value.get(key) for key in ['success', 'numPassedTestSuites', 'numPassedTests',
                    'numFailedTestSuites', 'numFailedTests', 'numTotalTests', 'wasInterrupted']}

    def verified_reference(reference, projection=None):
        if not reference:
            return None
        if not isinstance(reference, dict) or not reference.get('path') or not reference.get('sha256'):
            raise ValueError('Root workspace authority requires an exact path and hash.')
        path = ROOT / reference['path']
        if hashlib.sha256(path.read_bytes()).hexdigest() != reference['sha256']:
            raise ValueError('Workspace evidence differs from final root verification: ' + str(path))
        return bounded_pin(path, projection)

    final = bounded_pin(base / 'verification-final.json')
    final_value = (final or {}).get('receipt') or {}
    ui = verified_reference(final_value.get('client', {}).get('verification')) or bounded_pin(base / 'client-tests/verification-final.json')
    mongo = verified_reference(final_value.get('localMongo', {}).get('result'))
    source_manifest = verified_reference(final_value.get('sourceArchive')) or bounded_pin(base / 'code-at-final-verification/manifest.json')
    if source_manifest:
        for row in source_manifest['receipt']['files']:
            if hashlib.sha256((ROOT / row['archive']).read_bytes()).hexdigest() != row['sha256']:
                raise ValueError('Workspace archived source copy differs from its final manifest.')
    mongo_attempts = [bounded_pin(path, lambda value: {key: value.get(key) for key in
                      ['version', 'scope', 'status', 'groups', 'counters', 'cleanup', 'http',
                       'semanticQuality', 'reportedProviderInputTokens', 'reportedProviderOutputTokens',
                       'failure', 'mongoClientClosed', 'elapsedMs']})
                      for path in sorted((base / 'local-mongo').glob('run-r*/results.json'),
                                         key=lambda path: int(path.parent.name.removeprefix('run-r')))]
    screenshots, case_rows = [], []
    same_input, example = None, None
    if ui:
        view = ui['receipt']
        for case in view.get('cases', []):
            case_path = ROOT / case['receipt']
            if hashlib.sha256(case_path.read_bytes()).hexdigest() != case['receiptSha256']:
                raise ValueError('Outline workspace UI case differs from its verified receipt.')
            case_rows.append({'number': case['number'], 'title': case['title'], 'status': case['status'],
                              'receipt': {'path': case['receipt'], 'sha256': case['receiptSha256']}})
            if case['number'] == 3:
                example = bounded_pin(case_path, lambda value: {
                    'scope': value['scope'],
                    'initialParent': value['initialParent'],
                    'syntheticFinalServerView': value['syntheticFinalServerView'],
                    'requests': value['requests'],
                    'syntheticApplies': value['syntheticApplies'],
                    'external': value['external'], 'pageErrors': value['pageErrors'],
                })
            for row in case.get('screenshots', []):
                original = ROOT / row['path']
                if hashlib.sha256(original.read_bytes()).hexdigest() != row['sha256']:
                    raise ValueError('Outline workspace screenshot differs from its verified UI receipt.')
                name = 'outline-workspace-ui-' + original.stem + '-' + row['sha256'][:12] + '.png'
                shutil.copyfile(original, BOOK / name)
                captions = {
                    '01-desktop-light-repair-choices': 'Desktop: choose a wording-repair goal and inspect exact source-linked points.',
                    '02-mobile-dark-repair-choices': 'Mobile dark: exact quotes remain inspectable. Literal HTML in this synthetic quote is an escaped-text safety control, not real teaching material.',
                    '03-completed-repair-retains-original-until-review': 'A completed synthetic child remains separate; the original draft stays selected until explicit review.',
                    '03-explicitly-reviewed-repaired-draft': 'The Instructor explicitly selects the reviewed synthetic proposal; adding it to the course is still a separate action.',
                    '03-selected-original-and-requested-point': 'The confirmation identifies original wording and the exact requested source point before the one-cycle attempt.',
                    '04-failed-child-retained-parent': 'A failed synthetic child exposes its shortfall while retaining the original editable draft.',
                    '12-before-same-failed-child-and-reload': 'Before — actual retained earlier workbench: the identical failed-child/reload fixture leaves no validated parent draft or objective editor.',
                    '13-after-same-failed-child-and-reload': 'After — current compiled workbench: the same failed-child/reload fixture retains the teacher label and unchecked second objective, and blocks the failed repair.',
                }
                screenshots.append({**row, 'bookFile': name, 'case': case['number'],
                                    'label': captions.get(original.stem, case['title'])})
        reference = view.get('sameInputComparison')
        if reference:
            path = ROOT / reference['path']
            if hashlib.sha256(path.read_bytes()).hexdigest() != reference['sha256']:
                raise ValueError('Outline workspace same-input comparison differs from its UI pin.')
            same_input = bounded_pin(path)
    payload = {
        'state': 'engineering-verification-recorded' if final else 'awaiting-final-engineering-verification',
        'verification': final,
        'sourceManifest': source_manifest,
        'combinedRegression': verified_reference(final_value.get('combinedRegression', {}).get('result'), tests),
        'backendVerification': verified_reference(final_value.get('backend', {}).get('verification')),
        'persistenceReconciliation': {key: verified_reference(final_value.get('persistenceReconciliation', {}).get(key))
                                    for key in ['retainedBefore', 'beforeRefusal', 'finalAdoption']},
        'before': {
            'client': bounded_pin(base / 'client-before/manifest.json'),
            'backend': bounded_pin(base / 'backend-before/manifest.json'),
            'root': bounded_pin(base / 'root-before/manifest.json'),
            'build': bounded_pin(base / 'client-tests/baseline-build/baseline-build-receipt.json'),
        },
        'firstRegression': bounded_pin(base / 'regression-r1/jest.json', tests),
        'initialUi': bounded_pin(base / 'client-tests/2026-10-17T12-57-38-902Z/results.json',
                                lambda value: {'stats': value.get('stats'), 'errors': value.get('errors')}),
        'rootAdoptionTests': bounded_pin(base / 'root-tests-r1/jest.json', tests),
        'ui': ui,
        'mongo': mongo,
        'mongoAttempts': mongo_attempts,
        'screenshots': screenshots,
        'uiCases': case_rows,
        'sameInputComparison': same_input,
        'scriptedCoverageExample': example,
        'docs': {'path': 'docs/design/question-generation-quality/OUTLINE-REPAIR-WORKSPACE-IMPLEMENTATION-2026-10-17.md'},
        'plan': {'path': 'docs/design/question-generation-quality/OUTLINE-REPAIR-WORKSPACE-PLAN-2026-10-17.md'},
        'scope': 'Compiled intercepted UI, scripted service findings and isolated owned local Mongo mechanics. No paid model, embedding, actual application database, teacher acceptance or semantic recovery.',
        'unchangedRealOutline': {'files': 10, 'pages': 599, 'chunks': 671, 'supportedObjectives': 119,
                                 'withheldObjectives': 23, 'uncreditedModelDerivedPoints': 379},
    }
    if len(json.dumps(payload, ensure_ascii=True).encode()) > 1024 * 1024:
        raise ValueError('Outline repair workspace chapter exceeds its one-MiB display bound.')
    return payload


def retain_pre_workspace_payload(payload):
    """This additive phase preserves every prior chapter's exact data values."""
    baseline = BOOK / 'private/outline-workspace-before-2026-10-17/private/data.js'
    if not baseline.exists():
        raise ValueError('The immutable pre-workspace book payload is required.')
    text = baseline.read_text()
    prefix = 'window.QUALITY_BOOK = '
    if not text.startswith(prefix) or not text.endswith(';\n'):
        raise ValueError('Unexpected historical book payload wrapper.')
    previous = json.loads(text[len(prefix):-2])
    for key, value in previous.items():
        if key not in {'builtAt', 'outlineRepairWorkspace'}:
            payload[key] = value
    return payload


def source_recovery_diagnostic_receipts():
    """Keep local OCR literals, source readings and proposed cleanup distinct."""
    base = ROOT / 'audit-results/visual-source-recovery-2026-10-17/diagnostics'
    diversity = ROOT / 'audit-results/outline-diversity-2026-10-17'
    baseline = ROOT / 'audit-results/source-recovery-book-2026-10-17/before/manifest.json'
    images = []
    for name, label in [
        ('embedded-original.png', 'Exact embedded source raster: the original regional Dividends / Buybacks table.'),
        ('embedded-up2.png', 'Direct two-times nearest-neighbor raster; the failed OCR arm retains its table lines.'),
        ('embedded-up2-line-masked.png', 'Deterministic long-grid-line mask before local OCR; no text or values were supplied to the transform.'),
        ('grid-candidate-overlay.png', 'Geometry-only cell candidates; references did not choose or move OCR words.'),
        ('expanded-mismatch-01-original.png', 'Original-pixel Small Asia cell: the source reads 53.11%; the initial root reference wrote 53.10%.'),
        ('expanded-mismatch-01-nearest6x.png', 'Nearest-neighbor display enlargement of the same pixels; this image was not sent to OCR.'),
    ]:
        path = base / name
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        book_file = 'source-recovery-' + path.stem + '-' + digest[:12] + '.png'
        shutil.copyfile(path, BOOK / book_file)
        images.append({'path': str(path.relative_to(ROOT)), 'sha256': digest,
                       'bookFile': book_file, 'label': label})
    raw = []
    for name in ['poppler-layout.out', 'embedded-up2-psm6.out',
                 'line-masked-psm6.out', 'line-masked-psm3.out',
                 'implementation-recommendation.md']:
        path = base / name
        raw.append({'path': str(path.relative_to(ROOT)),
                    'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                    'text': path.read_text()})
    payload = {
        'state': 'local-diagnostic-only', 'baseline': pinned_receipt(baseline),
        'results': pinned_receipt(base / 'results.json'),
        'selectedComparison': pinned_receipt(base / 'comparison-selected21.json'),
        'expandedComparison': pinned_receipt(base / 'expanded-reference-comparison.json'),
        'originalReference': pinned_receipt(base / 'root-expanded-table-reference.json'),
        'adjudicatedReference': pinned_receipt(base / 'root-expanded-table-reference-adjudicated.json'),
        'adjudication': pinned_receipt(base / 'root-reference-adjudication.json'),
        'sourceBinding': pinned_receipt(base / 'source-page-binding.json'),
        'grid': pinned_receipt(base / 'grid-candidates.json'),
        'preExpandedFreeze': pinned_receipt(base / 'pre-expanded-reference-receipt.json'),
        'verification': pinned_receipt(base / 'verification-final.json'),
        'diversity': pinned_receipt(diversity / 'diagnosis.json'),
        'diversityProposal': pinned_receipt(diversity / 'proposal.json'),
        'diversityVerification': pinned_receipt(diversity / 'verification.json'),
        'images': images, 'raw': raw,
        'scope': 'One previously studied source table, three local Tesseract calls and pure retained-outline analysis. No provider, embedding, application database, production OCR admission, new outline, saved Draft or teacher acceptance.',
    }
    if len(json.dumps(payload, ensure_ascii=True).encode()) > 1024 * 1024:
        raise ValueError('Source recovery diagnostic chapter exceeds its one-MiB display bound.')
    return payload


def retain_pre_source_recovery_payload(payload):
    """Freeze all forty-six prior data values, including chapter eleven."""
    path = ROOT / 'audit-results/source-recovery-book-2026-10-17/before/artifacts/quality-lab-book-2026-10-16/private/data.js'
    text = path.read_text()
    prefix = 'window.QUALITY_BOOK = '
    if not text.startswith(prefix) or not text.endswith(';\n'):
        raise ValueError('Unexpected pre-source-recovery book payload wrapper.')
    previous = json.loads(text[len(prefix):-2])
    for key, value in previous.items():
        if key not in {'builtAt', 'sourceRecoveryDiagnostic'}:
            payload[key] = value
    return payload


def outline_capability_implementation_receipts():
    """Mechanical duplicate-task safeguards and their actual packing costs."""
    base = ROOT / 'audit-results/outline-capability-implementation-2026-10-17'
    historical = ROOT / 'audit-results/outline-distinctness-peer-eligibility-2026-10-17/book-before/artifacts/quality-lab-book-2026-10-16/private/data.js'
    if historical.exists():
        # The visible dated follow-up owns current verification. This checkpoint
        # retains its exact old payload rather than relabelling old code as new.
        raw = historical.read_text()
        return json.loads(raw[len('window.QUALITY_BOOK = '):-2])['outlineCapabilityImplementation']

    def packing(name):
        path = base / name / 'results.json'
        pin = pinned_receipt(path)
        if not pin:
            return None
        value = pin['receipt']
        projected = {key: value.get(key) for key in ['version', 'scope', 'status', 'startedAt', 'finishedAt',
            'checkpoint', 'inputLimit', 'outputCapUnchanged', 'inputEstimator', 'modelUsage', 'sourcesUnchanged',
            'nativeEnvelopeSourcesUnchanged', 'catalogProjectionChecks', 'catalogLosslessChecks',
            'minimumCompleteReviewAdmission', 'nativeEnvelopeAnalysis', 'costComparison', 'auditedPairs', 'limitations']}
        projected['firstFailure'] = ({key: value['firstFailure'].get(key) for key in
            ['message', 'elapsedMs', 'inputEstimate', 'promptBytes', 'lastRenderedPrompt']}
            if value.get('firstFailure') else None)
        projected['stages'] = {key: {name: item for name, item in stage.items() if name != 'rows'}
                               for key, stage in value.get('stages', {}).items()}
        projected['actualSendRows'] = (value.get('stages', {}).get('newComplete') or {}).get('rows', [])
        return {**pin, 'receipt': projected, 'projection': 'Bounded display; full exact result, packets and prompts remain linked.'}

    trials = [packing(name) for name in ['retained-packing', 'retained-packing-r2', 'retained-packing-r3', 'retained-packing-r4', 'retained-packing-r5']]
    latest = next((pin for pin in reversed(trials) if pin), None)
    largest = None
    if latest and latest['receipt']['actualSendRows']:
        row = max(latest['receipt']['actualSendRows'], key=lambda item: item['inputEstimate'])
        path = ROOT / row['prompt']['path']
        if hashlib.sha256(path.read_bytes()).hexdigest() != row['prompt']['sha256']:
            raise ValueError('Capability actual-send prompt differs from its frozen result.')
        largest = {**row['prompt'], 'text': path.read_text(), 'objectiveIds': row['objectiveIds'],
                   'inputEstimate': row['inputEstimate'], 'nativeEnvelopeEstimate': row['nativeEnvelopeEstimate']}
    payload = {'state': 'experimental-engineering-with-explicit-budget-shortfall',
               'baseline': pinned_receipt(base / 'book-before/manifest.json'),
               'trials': trials, 'latestPacking': latest,
               'largestActualPrompt': largest,
               'demonstrations': pinned_receipt(base / 'demo-r2/demo-controls.json'),
               'demonstrationVerification': pinned_receipt(base / 'demo-r2/verification.json'),
               'historicalDemonstrationVerification': pinned_receipt(base / 'demo/verification.json'),
               'packingIndependentVerification': pinned_receipt(base / 'retained-packing-r5/independent-data-check.json'),
               'readerPresentationCorrection': pinned_receipt(base / 'book-pre-link-spacing/manifest.json'),
               'firstReaderVerification': pinned_receipt(base / 'book-verification-run-r1.json'),
               'finalVerification': pinned_receipt(base / 'verification-final.json'),
               'implementation': {'path': 'docs/design/question-generation-quality/OUTLINE-CAPABILITY-DISTINCTNESS-IMPLEMENTATION-2026-10-17.md'},
               'scope': 'Pure actual 142-objective packing and controlled mechanical source/peer-review fixtures. No new real-model semantic verdict, corrected outline, hierarchy Apply, saved-question yield or teacher acceptance.'}
    if payload['finalVerification']:
        for row in payload['finalVerification']['receipt']['sourceFiles']:
            if hashlib.sha256((ROOT / row['path']).read_bytes()).hexdigest() != row['sha256']:
                raise ValueError('Capability final source differs from root verification: ' + row['path'])
        current = {row['path']: row['sha256'] for row in payload['finalVerification']['receipt']['sourceFiles']}
        for row in payload['demonstrationVerification']['receipt']['sourcePins']:
            if row['path'] in current and current[row['path']] != row['sha256']:
                raise ValueError('Capability demonstration uses a different final source pin.')
    if len(json.dumps(payload, ensure_ascii=True).encode()) > 1024 * 1024:
        raise ValueError('Capability implementation chapter exceeds its one-MiB display bound.')
    return payload


def retain_pre_capability_payload(payload):
    """Preserve all prior chapters, including the source-reference mistake."""
    path = ROOT / 'audit-results/outline-capability-implementation-2026-10-17/book-before/artifacts/quality-lab-book-2026-10-16/private/data.js'
    text = path.read_text()
    prefix = 'window.QUALITY_BOOK = '
    if not text.startswith(prefix) or not text.endswith(';\n'):
        raise ValueError('Unexpected pre-capability book payload wrapper.')
    for key, value in json.loads(text[len(prefix):-2]).items():
        if key not in {'builtAt', 'outlineCapabilityImplementation'}:
            payload[key] = value
    return payload


_OVERLAP_INTEGRATION_BEFORE = None


def overlap_integration_before():
    """Read the immutable fifty-value checkpoint once during this build."""
    global _OVERLAP_INTEGRATION_BEFORE
    if _OVERLAP_INTEGRATION_BEFORE is None:
        path = ROOT / 'audit-results/outline-source-overlap-integration-2026-10-17/book-before/artifacts/quality-lab-book-2026-10-16/private/data.js'
        if not path.exists():
            return None
        raw = path.read_text()
        if not raw.startswith('window.QUALITY_BOOK = ') or not raw.endswith(';\n'):
            raise ValueError('Unexpected pre-integration payload wrapper.')
        _OVERLAP_INTEGRATION_BEFORE = json.loads(raw[len('window.QUALITY_BOOK = '):-2])
    return _OVERLAP_INTEGRATION_BEFORE


def outline_capability_peer_eligibility_receipts():
    """A visible current-status correction; older chapter data stays immutable."""
    historical = overlap_integration_before()
    if historical:
        return historical['outlineCapabilityPeerEligibility']
    base = ROOT / 'audit-results/outline-distinctness-peer-eligibility-2026-10-17'
    implementation = ROOT / 'audit-results/outline-capability-implementation-2026-10-17'
    before = pinned_receipt(base / 'run-r1/results.json')
    after = pinned_receipt(base / 'run-r2/results.json')
    final = pinned_receipt(base / 'verification-r2.json')

    def case_link(run, case_id):
        path = base / run / (case_id + '.json')
        if not path.exists():
            return None
        return {'path': str(path.relative_to(ROOT)),
                'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}

    payload = {'state': 'awaiting-final-peer-eligibility-verification',
               'baseline': pinned_receipt(base / 'book-before/manifest.json'),
               'before': before, 'after': after,
               'comparison': pinned_receipt(base / 'before-after-r2.json'),
               'helperCloseout': pinned_receipt(base / 'implementation-closeout-r2.json'),
               'applyBsonVerification': pinned_receipt(base / 'apply-bson-r1/verification.json'),
               'currentDemonstrations': pinned_receipt(implementation / 'demo-r3/demo-controls.json'),
               'currentDemonstrationVerification': pinned_receipt(implementation / 'demo-r3/verification.json'),
               'policyAnalysis': pinned_receipt(base / 'policy-analysis.json'),
               'finalVerification': final,
               'packing': pinned_receipt(implementation / 'retained-packing-r6/results.json'),
               'packingIndependentVerification': pinned_receipt(implementation / 'retained-packing-r6/independent-data-check.json'),
               'priorBookCheckpoint': pinned_receipt(implementation / 'book-delivery-checkpoint-r2.json'),
               'exactCaseLinks': [{'id': row['id'], 'before': case_link('run-r1', row['id']),
                                   'after': case_link('run-r2', row['id'])}
                                  for row in (after or {}).get('receipt', {}).get('cases', [])],
               'exampleBefore': pinned_receipt(base / 'run-r1/supported-vs-unsupported-partial.json'),
               'exampleAfter': pinned_receipt(base / 'run-r2/supported-vs-unsupported-partial.json'),
               'scope': 'Scripted peer-source eligibility rule and current engineering checks. No new real-model semantic judgment, empirical false-positive rate, saved yield or teacher acceptance.'}
    if final:
        for row in final['receipt']['sourceFiles']:
            if hashlib.sha256((ROOT / row['path']).read_bytes()).hexdigest() != row['sha256']:
                raise ValueError('Peer-eligibility current source differs from final root verification: ' + row['path'])
        current = {row['path']: row['sha256'] for row in final['receipt']['sourceFiles']}
        for receipt in [after, payload['packing']]:
            if not receipt:
                raise ValueError('Peer-eligibility final requires exact control and packing receipts.')
            pins = receipt['receipt'].get('sourcePins', receipt['receipt'].get('sourcePinsBefore', []))
            for row in pins + receipt['receipt'].get('nativeEnvelopePins', []):
                if hashlib.sha256((ROOT / row['path']).read_bytes()).hexdigest() != row['sha256']:
                    raise ValueError('Peer-eligibility evidence no longer matches its exact source: ' + row['path'])
                if row['path'] in current and current[row['path']] != row['sha256']:
                    raise ValueError('Peer-eligibility evidence uses a different final source pin: ' + row['path'])
        payload['state'] = 'mechanical-rule-corrected-budget-shortfall-remains'
    if len(json.dumps(payload, ensure_ascii=True).encode()) > 1024 * 1024:
        raise ValueError('Peer-eligibility follow-up exceeds its one-MiB display bound.')
    return payload


def retain_pre_peer_eligibility_payload(payload):
    """Retain every one of the forty-eight preceding chapter data values."""
    path = ROOT / 'audit-results/outline-distinctness-peer-eligibility-2026-10-17/book-before/artifacts/quality-lab-book-2026-10-16/private/data.js'
    raw = path.read_text()
    for key, value in json.loads(raw[len('window.QUALITY_BOOK = '):-2]).items():
        if key not in {'builtAt', 'outlineCapabilityPeerEligibility'}:
            payload[key] = value
    return payload


def outline_source_overlap_packing_receipts():
    """Experimental file-only regrouping; no production admission is changed."""
    historical = overlap_integration_before()
    if historical:
        return historical['outlineSourceOverlapPacking']
    base = ROOT / 'audit-results/outline-source-overlap-packing-2026-10-17'
    peer = ROOT / 'audit-results/outline-distinctness-peer-eligibility-2026-10-17'
    result = pinned_receipt(base / 'run-r4/results.json')
    if not result:
        return None
    raw = result['receipt']
    if result['sha256'] != '7110aa7251f48ffec2fa9e780678b9bdf406e3744dae5cfc3090d26596ea0f7d':
        raise ValueError('Unexpected source-overlap experiment result identity.')
    for row in raw['sourcePins'] + raw['nativeEnvelopePins']:
        if hashlib.sha256((ROOT / row['path']).read_bytes()).hexdigest() != row['sha256']:
            raise ValueError('Source-overlap experiment no longer matches frozen source: ' + row['path'])
    plans = [raw['baseline'], *raw['alternatives']]
    projected = {key: value for key, value in raw.items() if key not in {'baseline', 'alternatives'}}
    projected['plans'] = [{key: value for key, value in plan.items() if key != 'records'} for plan in plans]
    best = next(plan for plan in plans if plan['name'] == raw['comparison']['best'])
    largest = max(best['records'], key=lambda row: row['nativeInput'])
    payload = {'state': 'file-only-packing-experiment-not-production',
               'baseline': pinned_receipt(peer / 'book-before-r2/manifest.json'),
               'priorReaderDelivery': pinned_receipt(peer / 'book-delivery-r1.json'),
               'result': {**result, 'receipt': projected,
                          'projection': 'Plan summaries only; all exact groups, full originals and actual prompts remain in the linked immutable result.'},
               'largestActualBestGroup': largest,
               'verification': pinned_receipt(base / 'run-r4/independent-verification.json'),
               'rootVerification': pinned_receipt(base / 'root-independent-r1/verification.json'),
               'closeout': pinned_receipt(base / 'experiment-closeout.json'),
               'scope': 'Local grouping computation only; no production algorithm change, provider latency, reported token/billing saving, semantic result or new outline.'}
    if len(json.dumps(payload, ensure_ascii=True).encode()) > 256 * 1024:
        raise ValueError('Source-overlap experiment chapter exceeds its256KiB display bound.')
    return payload


def retain_pre_source_overlap_payload(payload):
    """Preserve all forty-nine pre-experiment chapter values, including r1."""
    path = ROOT / 'audit-results/outline-distinctness-peer-eligibility-2026-10-17/book-before-r2/artifacts/quality-lab-book-2026-10-16/private/data.js'
    raw = path.read_text()
    for key, value in json.loads(raw[len('window.QUALITY_BOOK = '):-2]).items():
        if key not in {'builtAt', 'outlineSourceOverlapPacking'}:
            payload[key] = value
    return payload


def outline_source_overlap_integration_receipts():
    """Current integration is distinct from its retained local experiment."""
    # The consolidation phase changes adoption authority. Keep this complete
    # 680-test checkpoint as historical, without treating its old pins as live.
    return consolidation_book_before()['outlineSourceOverlapIntegration']


def _historical_outline_source_overlap_integration_receipts():
    """Retained builder logic from the preceding independently pinned phase."""
    base = ROOT / 'audit-results/outline-source-overlap-integration-2026-10-17'
    production = ROOT / 'audit-results/outline-overlap-packing-integration-2026-10-17'
    reuse = ROOT / 'audit-results/outline-source-review-reuse-2026-10-17'
    gaps = ROOT / 'audit-results/outline-packing-integration-gaps-2026-10-17'

    def pointer(path):
        if not path.exists():
            return None
        raw = path.read_bytes()
        return {'path': str(path.relative_to(ROOT)), 'bytes': len(raw),
                'sha256': hashlib.sha256(raw).hexdigest()}

    replay = pinned_receipt(production / 'measurement-r2/results.json')
    examples = []
    proof = load(reuse / 'run-r6/proof-manifest.json')
    if proof:
        for current in [False, True]:
            row = next(item for item in proof['sourceProofs']
                       if item['sourceInstructionsMatchCurrent'] is current)
            examples.append({'proof': row, 'rawHistory': pointer(ROOT / row['fullRawHistory'][-1]['fullHistoryFile'])})
    payload = {'state': 'awaiting-final-production-packing-regression',
               'baseline': pinned_receipt(base / 'book-before/manifest.json'),
               'priorReaderDelivery': pinned_receipt(ROOT / 'audit-results/outline-distinctness-peer-eligibility-2026-10-17/book-delivery-r2.json'),
               'finalVerification': pinned_receipt(base / 'verification-final.json'),
               'independentInspection': pinned_receipt(base / 'independent-final/audit.json'),
               'implementation': pinned_receipt(production / 'implementation-closeout.json'),
               'sameInputReplay': replay,
               'independentReplayVerification': pinned_receipt(production / 'measurement-r2/independent-byte-verification.json'),
               'gapVerification': pinned_receipt(gaps / 'verification.json'),
               'reviewReuseStudy': pinned_receipt(reuse / 'verification.json'),
               'reviewReuseProposal': pointer(reuse / 'SOURCE-REVIEW-REUSE-PROPOSAL.md'),
               'reviewReuseProofManifest': pointer(reuse / 'run-r6/proof-manifest.json'),
               'reviewReuseExamples': examples,
               'retainedPlanningCacheAttempts': [pointer(base / name / 'jest.json')
                                                for name in ['plan-cache-r1', 'plan-cache-r2', 'plan-cache-r3']],
               'scope': 'Opt-in production packing mechanics and pure CPU cache only; no real-model semantic quality, reported token/money saving, new saved outline or teacher acceptance.'}
    if payload['finalVerification']:
        final = payload['finalVerification']
        if final['sha256'] != '3785559bfaac2f51e47bebfa2cd8f907423130599b3539abf53dc6670102b6bb':
            raise ValueError('Unexpected final production integration receipt identity.')
        for row in final['receipt']['sourceFiles'] + final['receipt']['verifiedReplayPins']:
            if hashlib.sha256((ROOT / row['path']).read_bytes()).hexdigest() != row['sha256']:
                raise ValueError('Final integration source/replay pin changed: ' + row['path'])
        payload['state'] = 'implemented-opt-in-packing-budget-still-refused'
    if replay:
        row = max(replay['receipt']['current']['records'], key=lambda item: item['nativeInput'])
        payload['largestActualPrompt'] = {**row['prompt'], 'objectiveIds': row['objectiveIds']}
    if len(json.dumps(payload, ensure_ascii=True).encode()) > 1024 * 1024:
        raise ValueError('Production overlap integration exceeds its one-MiB display bound.')
    return payload


def retain_pre_overlap_integration_payload(payload):
    """Keep all fifty preceding JSON values exactly, including both cost arms."""
    before = overlap_integration_before()
    if not before:
        raise ValueError('The immutable pre-integration book checkpoint is required.')
    for key, value in before.items():
        if key not in {'builtAt', 'outlineSourceOverlapIntegration'}:
            payload[key] = value
    return payload


def outline_terminal_budget_cohort_receipts():
    """Keep historical measurement and terminal ledger cohorts distinct."""
    base = ROOT / 'audit-results/outline-source-overlap-integration-2026-10-17'
    note = pinned_receipt(base / 'budget-cohort-clarification.json')
    if not note or note['sha256'] != 'e2dc3063cda1b5e68373e0e7571fd4f9ae07360bf382682ffcf9e67f054d677f':
        raise ValueError('The exact terminal-budget cohort note is required.')
    for cohort in note['receipt']['cohorts']:
        pin = cohort['evidence']
        if hashlib.sha256((ROOT / pin['path']).read_bytes()).hexdigest() != pin['sha256']:
            raise ValueError('Budget-cohort evidence changed: ' + pin['path'])
        if cohort['maximumUnits'] - cohort['admissionUnits'] != cohort['remainingUnits']:
            raise ValueError('Budget-cohort arithmetic differs from its receipt.')
    return {'state': 'recorded-ledger-cohorts-not-spending-authority',
            'baseline': pinned_receipt(base / 'book-before-terminal-budget/manifest.json'),
            'note': note,
            'priorDelivery': pinned_receipt(base / 'book-delivery-r1.json'),
            'scope': 'A file-only interpretation correction. No new dispatch, ledger reset, budget increase or authenticated child allowance.'}


def retain_pre_terminal_budget_payload(payload):
    """Preserve all fifty-one earlier data values, including the r3 key."""
    path = ROOT / 'audit-results/outline-source-overlap-integration-2026-10-17/book-before-terminal-budget/artifacts/quality-lab-book-2026-10-16/private/data.js'
    raw = path.read_text()
    for key, value in json.loads(raw[len('window.QUALITY_BOOK = '):-2]).items():
        if key not in {'builtAt', 'outlineTerminalBudgetCohort'}:
            payload[key] = value
    return payload


_CONSOLIDATION_BOOK_BEFORE = None


def consolidation_book_before():
    """Immutable 52-value predecessor; no historical observation is upgraded."""
    global _CONSOLIDATION_BOOK_BEFORE
    if _CONSOLIDATION_BOOK_BEFORE is None:
        path = ROOT / 'audit-results/outline-consolidation-core-2026-10-17/book-before/artifacts/quality-lab-book-2026-10-16/private/data.js'
        raw = path.read_text()
        _CONSOLIDATION_BOOK_BEFORE = json.loads(raw[len('window.QUALITY_BOOK = '):-2])
        if len([key for key in _CONSOLIDATION_BOOK_BEFORE if key != 'builtAt']) != 52:
            raise ValueError('The complete 52-value pre-consolidation book is required.')
    return _CONSOLIDATION_BOOK_BEFORE


def retain_pre_consolidation_payload(payload):
    """Preserve every prior value, including the historical 680-test receipt."""
    for key, value in consolidation_book_before().items():
        if key != 'builtAt':
            payload[key] = value
    return payload


def outline_consolidation_core_receipts():
    """File-only foundation evidence; no child execution or semantic verdict."""
    return source_interpretation_book_before()['outlineConsolidationCore']


def _historical_outline_consolidation_core_receipts():
    """Retained construction of the exact pre-R8 foundation checkpoint."""
    base = ROOT / 'audit-results/outline-consolidation-core-2026-10-17'
    prep = ROOT / 'audit-results/outline-consolidation-obligations-2026-10-17'

    def pointer(path):
        raw = path.read_bytes()
        return {'path': str(path.relative_to(ROOT)), 'bytes': len(raw),
                'sha256': hashlib.sha256(raw).hexdigest()}

    final = pinned_receipt(base / 'verification-final.json')
    if not final or final['sha256'] != '472e769216471c677e3e2facf21687d4b6fff3c21c64bbcfb9e926773dd37539':
        raise ValueError('Exact frozen consolidation foundation verification required.')
    for row in final['receipt']['sourceAndTestPins'] + final['receipt']['documentation'] + final['receipt']['evidence']:
        if hashlib.sha256((ROOT / row['path']).read_bytes()).hexdigest() != row['sha256']:
            raise ValueError('Consolidation source/evidence changed: ' + row['path'])
    controls = []
    for name in ['financing-explicit-3-to-2', 'missing-calculation-credit-control',
                 'source-negative-selection-control', 'explicit-pair-2-to-2-narrowing',
                 'condition-and-open-activity-control']:
        path = base / 'actual-r2' / (name + '.json')
        row = load(path)
        plan, draft = row.get('plan'), row.get('draft')
        controls.append({'id': name, 'exactInputProposalOutput': pointer(path),
                         'selectedIds': row['selectedIds'], 'status': row['status'], 'error': row['error'],
                         'proposal': row.get('proposal'),
                         'originalMembers': [member['objective'] for member in plan['members']] if plan else [],
                         'originalSectionCount': len(plan['originals']) if plan else None,
                         'oldCreditObligations': plan['oldCreditObligations'] if plan else [],
                         'draftSummary': {'survivorIds': draft['survivorIds'], 'retiredIds': draft['retiredIds'],
                                          'childObjectives': len(draft['childContext']['objectives']),
                                          'freshSourceTargetIds': draft['freshSourceTargetIds'],
                                          'sourceReviewScope': draft['sourceReviewScope'],
                                          'requiredFreshComparisons': len(draft['comparisonClosure']['requiredFreshComparisons']),
                                          'affectedUnchangedCandidateIds': draft['comparisonClosure']['affectedUnchangedCandidateIds'],
                                          'reviewAuthority': draft['reviewAuthority']} if draft else None})
    code = base / 'combined-r1/code-before'
    return {'state': 'engineering-foundation-not-integrated-or-semantically-accepted',
            'baseline': pinned_receipt(base / 'book-before/manifest.json'),
            'priorReaderDelivery': pointer(ROOT / 'audit-results/outline-source-overlap-integration-2026-10-17/book-delivery-r2.json'),
            'finalVerification': final, 'pureCoreCloseout': pinned_receipt(base / 'closeout.json'),
            'actualReplay': pinned_receipt(base / 'actual-r2/results.json'), 'controls': controls,
            'parentReviewBefore': pinned_receipt(base / 'independent-parent/r1/audit.json'),
            'parentReviewAfter': pinned_receipt(base / 'independent-parent/r2/audit.json'),
            'diagnosticRed': pointer(base / 'root-diagnostic-red-r1/jest.json'),
            'diagnosticGreen': pointer(base / 'root-diagnostic-green-r1/jest.json'),
            'combinedTests': pointer(base / 'combined-r1/jest.json'),
            'implementationDoc': pointer(ROOT / 'docs/design/question-generation-quality/OUTLINE-CONSOLIDATION-IMPLEMENTATION-2026-10-17.md'),
            'runtimeMap': pointer(base / 'runtime-next-r1/next-runtime-map.json'),
            'budgetLowerBound': pinned_receipt(base / 'runtime-next-r1/full-review-lower-bound.json'),
            'preparationFailures': [pinned_receipt(prep / 'root-inspection-r1-failure.json'),
                                    pinned_receipt(prep / 'root-v2-verifier-r1/failure.json')],
            'correctedInputVerification': pinned_receipt(prep / 'verification-v2.json'),
            'correctedRawInput': pointer(prep / 'actual-data-fixture-v2.json'),
            'exactInputContext': pointer(base / 'actual-r2/input/context.json'),
            'exactInputFindings': pointer(base / 'actual-r2/input/findings.json'),
            'sourceCode': [pointer(code / path) for path in [
                'server/src/types/structure-consolidation.ts',
                'server/src/services/structure-outline-consolidation.ts',
                'server/src/services/structure-consolidation-parent.service.ts',
                'server/src/services/structure-capability-adoption.service.ts',
                'tests/unit/structure-outline-consolidation.test.ts',
                'tests/unit/structure-capability-adoption.service.test.ts']],
            'scope': 'Local pure core and authenticated parent mechanics only. No durable child/runtime/API/Apply/UI or new model/teacher acceptance. Prior 680-test source checkpoint is historical.'}


_SOURCE_INTERPRETATION_BOOK_BEFORE = None


def source_interpretation_book_before():
    """Retain the complete 53-value foundation before terminal API evidence."""
    global _SOURCE_INTERPRETATION_BOOK_BEFORE
    if _SOURCE_INTERPRETATION_BOOK_BEFORE is None:
        path = ROOT / 'audit-results/quality-lab-source-interpretation-2026-10-17-preflight-r8/book-before/artifacts/quality-lab-book-2026-10-16/private/data.js'
        raw = path.read_text()
        _SOURCE_INTERPRETATION_BOOK_BEFORE = json.loads(raw[len('window.QUALITY_BOOK = '):-2])
        if len([key for key in _SOURCE_INTERPRETATION_BOOK_BEFORE if key != 'builtAt']) != 53:
            raise ValueError('Complete 53-value pre-R8 book checkpoint required.')
    return _SOURCE_INTERPRETATION_BOOK_BEFORE


def retain_pre_source_interpretation_live_payload(payload):
    for key, value in source_interpretation_book_before().items():
        if key != 'builtAt':
            payload[key] = value
    return payload


def source_interpretation_live_receipts():
    """Approved selected review-only API observations, kept apart from yield."""
    return numeric_semantic_book_before()['sourceInterpretationLive']


def _historical_source_interpretation_live_receipts():
    """Retained terminal R8 construction, not a new current-source audit."""
    base = ROOT / 'audit-results/quality-lab-source-interpretation-2026-10-17-preflight-r8'
    live = ROOT / 'audit-results/quality-lab-source-interpretation-2026-10-17-live-r8'
    independent = ROOT / 'audit-results/quality-lab-source-interpretation-independent-2026-10-17'

    def pointer(path, expected=None):
        raw = path.read_bytes()
        pin = {'path': str(path.relative_to(ROOT)), 'bytes': len(raw),
               'sha256': hashlib.sha256(raw).hexdigest()}
        if expected and pin['sha256'] != expected:
            raise ValueError('R8 evidence changed: ' + pin['path'])
        return pin

    def exact(path, expected):
        pin = pointer(path, expected)
        return {**pin, 'receipt': load(path)}

    delivery = exact(base / 'delivery.json', 'ca03247c80171097187e4b18863faaea0ae7314d764dc75ee3f524fb4f089d1e')
    analysis = exact(base / 'terminal-analysis.json', 'b607ee1ced48732b445db77a502a6d1b4eb787773cf41024c404da16aa7c7231')
    terminal = exact(base / 'terminal-verification.json', 'd37804856ee59d4439f763a539e0f91c889215f203e301dad1952d87d8eb9801')
    results = exact(live / 'results.json', 'a986e568fd4faca2f14fec77a53fc2ac1e0259d2736a29a778d9c63823e2fbda')
    for row in terminal['receipt']['files'] + delivery['receipt']['files']:
        pointer(Path(row['file']), row['sha256'])
    controls = load(base / 'controls.json')
    input_pin = pointer(Path(controls['input']['file']), controls['input']['sha256'])
    original = load(ROOT / input_pin['path'])
    captures = []
    for call in analysis['receipt']['calls']:
        pin = pointer(Path(call['transcript']['file']), call['transcript']['sha256'])
        captures.append({'call': call, 'exactTranscript': pin, 'capture': load(ROOT / pin['path'])})
    followups = load(base / 'book-live-followups.json') or {}

    def followup(name):
        row = followups.get(name)
        return exact(ROOT / row['path'], row['sha256']) if row else None

    return {'state': 'authorized-r8-terminal-selected-review-not-quality-completion',
            'baseline': pinned_receipt(base / 'book-before/manifest.json'),
            'delivery': delivery, 'analysis': analysis, 'terminalVerification': terminal,
            'results': {key: value for key, value in results.items() if key != 'receipt'},
            'ledger': pointer(live / 'ledger.json'),
            'authorization': pointer(base / 'authorization.json', analysis['receipt']['approval']['sha256']),
            'sourcePayloadFreeze': exact(base / 'source-payload-verification.json', analysis['receipt']['sourcePayloadFreeze']['sha256']),
            'archivedCode': pointer(live / 'code-snapshot/manifest.json'),
            'originalInput': input_pin, 'originalCases': original['cases'],
            'outcomes': results['receipt']['outcomes'], 'captures': captures,
            'blindExpectations': exact(independent / 'blind-r1/expectations.json', '29c6d51af8db51974c4ead62a627bae9df2c355490a0dd6753e2c1f863302cfe'),
            'independentComparison': followup('independentComparison'),
            'independentVerification': followup('independentVerification'),
            'independentCloseout': followup('independentCloseout'),
            'independentReview': pointer(independent / 'comparison-r1/REVIEW.md', '6b0a3692f96f70688896a7c508d1e91ab549bab75748f150fcd229104e462d05'),
            'rootArchiveVerification': followup('rootArchiveVerification'),
            'retainedRootVerifierFailure': pointer(base / 'root-verification-r1-failure.json'),
            'tfOffline': followup('tfOffline'),
            'tfIndependentReview': exact(ROOT / 'audit-results/source-interpretation-tf-enum-2026-10-17/independent-r1/audit.json', 'f5a66fe265dad490b7def1ce1e3871b2567fec3ae71bc8852ef9031d51c2bae6'),
            'implementationDoc': pointer(ROOT / 'docs/design/question-generation-quality/SOURCE-INTERPRETATION-PAID-RESULTS-2026-10-17.md'),
            'foundationDocumentationArchive': pointer(ROOT / 'audit-results/outline-consolidation-core-2026-10-17/documentation-before-probe-status/manifest.json'),
            'rootGoalStatus': pointer(ROOT / 'audit-results/outline-consolidation-core-2026-10-17/goal-progress-audit-r2.json', '348500648415b0bb2d04d7b22e92367a538eb0883b33db79f5a9aa6541b62ed8'),
            'scope': 'Six selected retained-context reviews only, with all original prompt/input/output bytes pinned. Not new generation, repair, live Bank traversal, saved yield, model ranking or teacher acceptance.'}


_NUMERIC_SEMANTIC_BOOK_BEFORE = None


def numeric_semantic_book_before():
    """The entire 54-value paid/foundation checkpoint is immutable."""
    global _NUMERIC_SEMANTIC_BOOK_BEFORE
    if _NUMERIC_SEMANTIC_BOOK_BEFORE is None:
        path = ROOT / 'audit-results/numeric-semantic-review-2026-10-17/book-before/artifacts/quality-lab-book-2026-10-16/private/data.js'
        raw = path.read_text()
        _NUMERIC_SEMANTIC_BOOK_BEFORE = json.loads(raw[len('window.QUALITY_BOOK = '):-2])
        if len([key for key in _NUMERIC_SEMANTIC_BOOK_BEFORE if key != 'builtAt']) != 54:
            raise ValueError('Complete 54-value numeric-review predecessor required.')
    return _NUMERIC_SEMANTIC_BOOK_BEFORE


def retain_pre_numeric_semantic_payload(payload):
    for key, value in numeric_semantic_book_before().items():
        if key != 'builtAt':
            payload[key] = value
    return payload


def numeric_semantic_review_receipts():
    """Additive offline representation evidence; final freeze is mandatory."""
    base = ROOT / 'audit-results/numeric-semantic-review-2026-10-17'
    configuration = load(base / 'book-final-inputs.json')
    if not configuration or configuration.get('status') != 'final-root-freeze-ready':
        raise ValueError('Numeric semantic-review book build waits for final root receipts.')

    def pointer(row):
        path = ROOT / row['path']
        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if digest != row['sha256']:
            raise ValueError('Numeric review evidence changed: ' + row['path'])
        return {'path': row['path'], 'bytes': len(raw), 'sha256': digest}

    def exact(row):
        return {**pointer(row), 'receipt': load(ROOT / row['path'])}

    evidence = {key: exact(row) for key, row in configuration['receipts'].items()}
    files = {key: pointer(row) for key, row in configuration.get('files', {}).items()}
    prompts = {key: {**pointer(row), 'text': (ROOT / row['path']).read_text()}
               for key, row in configuration.get('exactText', {}).items()}
    return {'state': 'offline-numeric-review-representation-not-model-recovery',
            'baseline': pinned_receipt(base / 'book-before/manifest.json'),
            'finalVerification': exact(configuration['finalVerification']),
            'implementationDoc': {'path': 'docs/design/question-generation-quality/NUMERIC-SEMANTIC-REVIEW-IMPLEMENTATION-2026-10-17.md',
                                  'sha256': hashlib.sha256((ROOT / 'docs/design/question-generation-quality/NUMERIC-SEMANTIC-REVIEW-IMPLEMENTATION-2026-10-17.md').read_bytes()).hexdigest()},
            'evidence': evidence, 'files': files, 'exactText': prompts,
            'display': configuration.get('display', {}),
            'scope': 'Current-candidate server-computed representation, offline mechanics and measured local admission only. R8 raw inputs/outputs unchanged; no new model acceptance, saved yield or teacher result.'}


def _historical_pre_exclusion_build():
    BOOK.mkdir(parents=True, exist_ok=True)
    (BOOK / 'private').mkdir(exist_ok=True)
    payload = {
        'builtAt': datetime.now(ZoneInfo('America/Vancouver')).isoformat(),
        'plan': load(ROOT / 'scripts/prompt-ab/quality-lab-plan-2026-10-16.json'),
        'access': load(ROOT / 'audit-results/quality-lab-model-access-2026-10-16.json'),
        'model': load(AUDIT / 'model-pilot/results.json'),
        'fixture': load(AUDIT / 'frozen-model-cases.json'),
        'corpus': load(AUDIT / 'corpus-fixture.json'),
        'ledger': load(AUDIT / 'phase-one-ledger.json'),
        'outline': load(AUDIT / 'outline-subset-live/results.json'),
        'outlineControls': load(AUDIT / 'outline-subset-live/controls.json'),
        'outlineTenPreflight': load(AUDIT / 'outline-ten-preflight/controls.json'),
        'matchedAudit': load(AUDIT / 'outline-matched-audit.json'),
        'matchedControls': load(AUDIT / 'outline-matched/controls.json'),
        'validation': load(AUDIT / 'validation-controls-live/results.json'),
        'warmOutline': load(AUDIT / 'outline-warm-live/results.json'),
        'recordedRepairStopped': load(AUDIT / 'recorded-repair-live/results.json'),
        'recordedRepair': load(AUDIT / 'recorded-repair-retest/results.json'),
        'repairPromptPreflight': load(AUDIT / 'repair-prompt-dedup-preflight.json'),
        'policyPromptPreflight': load(AUDIT / 'recorded-positive-policy-preflight-final.json'),
        'numericGridAudit': load(AUDIT / 'numeric-grid-audit.json'),
        'admission': load(AUDIT / 'production-admission-audit.json'),
        'analysis': load(AUDIT / 'model-pilot-analysis.json'),
        'matchedOutline': load(AUDIT / 'outline-matched/results.json'),
        'verification': load(AUDIT / 'verification.json'),
        'phaseTwo': {
            'declaration': load(PHASE_TWO / 'declaration.json'),
            'ledger': load(PHASE_TWO / 'ledger.json'),
            'uploadControls': load(PHASE_TWO / 'upload-index/controls.json'),
            'upload': load(PHASE_TWO / 'upload-index/results.json'),
            'corpus': load(PHASE_TWO / 'upload-index/corpus-fixture.json'),
            'parserAudit': load(PHASE_TWO / 'pdf-parser-audit/results.json'),
            'parserPolicyAcceptance': load(PHASE_TWO / 'pdf-text-first-policy-acceptance/results.json'),
            'reviewFailureAudit': load(PHASE_TWO / 'outline-recovery-failure-audit.json'),
            'extractionAudit': load(PHASE_TWO / 'extraction-structural-audit-terminal.json'),
            'continuityAudit': load(PHASE_TWO / 'source-continuity-audit.json'),
            'focusedVerification': load(PHASE_TWO / 'transport-recovery-focused-verification.json'),
            'outlineV2Verification': load(PHASE_TWO / 'outline-v2-verification.json'),
            'outlineV2Browser': load(Path('/tmp/outline-review-ui-v2-playwright-final.json')),
            'outlineReviewProbe': load(PHASE_TWO / 'outline-review-v2-probe/results.json'),
            'outlineReviewProbeControls': load(PHASE_TWO / 'outline-review-v2-probe-controls/controls.json'),
            'outlineReviewProbeSourceAudit': load(PHASE_TWO / 'outline-review-v2-probe/agent-source-audit.json'),
            'outlineRuns': phase_two_outline_runs(),
            'verification': load(PHASE_TWO / 'verification.json'),
        },
        'phaseOneIntegrity': {
            'ledgerSha256': hashlib.sha256((AUDIT / 'phase-one-ledger.json').read_bytes()).hexdigest(),
            'policy': 'Phase 1 observations are loaded from their original files. Phase 2 does not reset or replace their usage or ledger.',
        },
        'laterPhases': later_phase_receipts(),
        'publicHttp': public_http_receipts(),
        'transportDeadlineHistoricalVerification': pinned_receipt(ROOT / 'audit-results/quality-lab-transport-deadline-tests-2026-10-17.json'),
        'transportDeadlineVerification': pinned_receipt(ROOT / 'audit-results/quality-lab-transport-deadline-tests-final-2026-10-17.json'),
        'semanticRepairVerification': pinned_receipt(ROOT / 'audit-results/quality-lab-semantic-repair-tests-2026-10-17.json'),
        'retainedYieldProbe': retained_yield_probe_receipts(),
        'outlineContinuation': outline_continuation_receipts(),
        'heldoutRecovery': heldout_recovery_receipts(),
        'currentPublicHttp': current_public_http_receipts(),
        'sourceInterpretation': source_interpretation_receipts(),
        'sourceCoverageUi': source_coverage_ui_receipts(),
        'sourceAndAdoptionFollowup': source_and_adoption_followup_receipts(),
        'productionPdfProvenance': production_pdf_provenance_receipts(),
        'answerabilitySourceConditions': answerability_source_conditions_receipts(),
        'visualSourceObligations': visual_source_obligation_receipts(),
        'pageTextObligations': page_text_obligation_receipts(),
        'exactBankRepair': exact_bank_repair_receipts(),
        'taskRetrievalRepair': task_retrieval_repair_receipts(),
        'supportedCoverageRepair': supported_coverage_repair_receipts(),
        'authoringFlowHeadroom': authoring_flow_headroom_receipts(),
        'numericFiniteDomain': numeric_finite_domain_receipts(),
        'outlineRepairWorkspace': outline_repair_workspace_receipts(),
        'sourceRecoveryDiagnostic': source_recovery_diagnostic_receipts(),
        'outlineCapabilityImplementation': outline_capability_implementation_receipts(),
        'outlineCapabilityPeerEligibility': outline_capability_peer_eligibility_receipts(),
        'outlineSourceOverlapPacking': outline_source_overlap_packing_receipts(),
        'outlineSourceOverlapIntegration': outline_source_overlap_integration_receipts(),
        'outlineTerminalBudgetCohort': outline_terminal_budget_cohort_receipts(),
        'outlineConsolidationCore': outline_consolidation_core_receipts(),
        'sourceInterpretationLive': source_interpretation_live_receipts(),
        'numericSemanticReview': numeric_semantic_review_receipts(),
    }
    payload = retain_pre_workspace_payload(payload)
    payload = retain_pre_source_recovery_payload(payload)
    payload = retain_pre_capability_payload(payload)
    payload = retain_pre_peer_eligibility_payload(payload)
    payload = retain_pre_source_overlap_payload(payload)
    payload = retain_pre_overlap_integration_payload(payload)
    payload = retain_pre_terminal_budget_payload(payload)
    payload = retain_pre_consolidation_payload(payload)
    payload = retain_pre_source_interpretation_live_payload(payload)
    payload = retain_pre_numeric_semantic_payload(payload)
    data = json.dumps(payload, ensure_ascii=True).replace('<', '\\u003c')
    (BOOK / 'private/data.js').write_text('window.QUALITY_BOOK = ' + data + ';\n')
    (BOOK / 'index.html').write_text(PAGE)
    summary = {'builtAt': payload['builtAt'], 'language': 'English',
               'modelRunStatus': (payload['model'] or {}).get('status', 'not-run'),
               'requestedSlots': (payload['model'] or {}).get('requestedSlots'),
               'outlineStatus': (payload['outline'] or {}).get('status', 'not-run'),
               'repairStatus': (payload['recordedRepair'] or payload['recordedRepairStopped'] or {}).get('status', 'not-run'),
               'phaseTwoUploadStatus': (payload['phaseTwo']['upload'] or {}).get('status', 'not-run'),
               'phaseTwoOutlineRuns': [{'name': run['name'], 'status': run['receipt'].get('status')} for run in payload['phaseTwo']['outlineRuns']],
               'outlineV2VerificationAt': (payload['phaseTwo']['outlineV2Verification'] or {}).get('checkedAt'),
               'outlineReviewProbeStatus': (payload['phaseTwo']['outlineReviewProbe'] or {}).get('status', 'not-run'),
               'heldoutExecutionStatus': ((payload['laterPhases']['heldout']['aggregate'] or {}).get('receipt') or {}).get('status', 'not-run'),
               'heldoutScheduledCells': ((payload['laterPhases']['heldout']['aggregate'] or {}).get('receipt') or {}).get('requestedSlots'),
               'heldoutNormalizedCandidates': ((payload['laterPhases']['heldout']['aggregate'] or {}).get('receipt') or {}).get('generatedCandidates'),
               'heldoutLabEligibleCandidates': ((payload['laterPhases']['heldout']['aggregate'] or {}).get('receipt') or {}).get('labEligibleCandidates'),
               'publicHttpAttempts': [{'name': row['name'], 'runtimeStatus': row['result']['receipt'].get('status'),
                                       'operatorStop': (row['operatorStop'] or {}).get('receipt', {}).get('status'),
                                       'observedSupply': [{'id': item['id'], 'supply': item.get('supply')} for item in row['result']['receipt'].get('observations', [])]}
                                      for row in payload['publicHttp']['attempts']],
               'transportDeadlineOfflineTestsPassed': ((payload['transportDeadlineVerification'] or {}).get('receipt') or {}).get('numPassedTests'),
               'semanticRepairOfflineTestsPassed': ((payload['semanticRepairVerification'] or {}).get('receipt') or {}).get('numPassedTests'),
               'retainedYieldReviewStatus': ((payload['retainedYieldProbe']['result'] or {}).get('receipt') or {}).get('status', 'not-run'),
               'retainedYieldReviewDecisions': [{'case': row['id'], 'status': row['assessment']['status']}
                                              for row in (((payload['retainedYieldProbe']['result'] or {}).get('receipt') or {}).get('outcomes') or [])],
               'outlineContinuationStatus': ((payload['outlineContinuation']['result'] or {}).get('receipt') or {}).get('status', 'not-run'),
               'outlineContinuationStartingProjection': ((payload['outlineContinuation']['projection'] or {}).get('receipt') or {}).get('summary'),
               'outlineContinuationFocusedTestsPassed': ((payload['outlineContinuation']['verification'] or {}).get('receipt') or {}).get('numPassedTests'),
               'outlineContinuationFinalCoverage': {key: value for key, value in
                    (((payload['outlineContinuation']['result'] or {}).get('receipt') or {}).get('child') or {}).get('structureResult', {}).get('coverage', {}).get('outlineGrounding', {}).items()
                    if key != 'findings'},
               'outlineContinuationPhaseUsage': ((payload['outlineContinuation']['result'] or {}).get('receipt') or {}).get('phaseUsage'),
               'heldoutRecoveryStatus': ((payload['heldoutRecovery']['result'] or {}).get('receipt') or {}).get('status', 'not-run'),
               'heldoutRecoveryAnalysisStatus': ((payload['heldoutRecovery']['analysis'] or {}).get('receipt') or {}).get('recoveryStatus', 'not-analyzed'),
               'heldoutRecoveryPositiveSupply': ((payload['heldoutRecovery']['analysis'] or {}).get('receipt') or {}).get('requestedSupply'),
               'currentPublicHttpStatus': ((payload['currentPublicHttp']['result'] or {}).get('receipt') or {}).get('status', 'not-run'),
               'currentPublicSavedDrafts': sum((row.get('supply') or {}).get('saved', 0) for row in
                    (((payload['currentPublicHttp']['result'] or {}).get('receipt') or {}).get('observations') or [])),
               'currentPublicSavedQualityAudit': ((payload['currentPublicHttp']['savedAudit'] or {}).get('receipt') or {}).get('version'),
               'sourceInterpretationStatus': ((payload['sourceInterpretation']['approvalStatus'] or {}).get('receipt') or {}).get('status', 'not-declared'),
               'sourceInterpretationMaximumInitialInput': max((row['inputEstimate'] for row in
                    (((payload['sourceInterpretation']['sizeCapture'] or {}).get('receipt') or {}).get('cases') or [])), default=None),
               'sourceCoverageUiState': ((payload['sourceCoverageUi']['verification'] or {}).get('receipt') or {}).get('state', 'not-verified'),
               'sourceAndAdoptionFollowupState': ((payload['sourceAndAdoptionFollowup']['guards'] or {}).get('receipt') or {}).get('state', 'not-verified'),
               'productionPdfProvenanceState': ((payload['productionPdfProvenance']['verification'] or {}).get('receipt') or {}).get('state', 'in-progress'),
               'answerabilitySourceConditionsState': 'offline-verification-recorded' if (payload['answerabilitySourceConditions']['verification'] or {}).get('receipt') else 'pending-final-verification',
               'answerabilitySourceConditionsPayloadBytes': len(json.dumps(payload['answerabilitySourceConditions'], ensure_ascii=True).encode()),
               'visualSourceObligationsState': ((payload['visualSourceObligations']['verification'] or {}).get('receipt') or {}).get('state', 'pending-final-verification'),
               'pageTextObligationsState': ((payload['pageTextObligations']['verification'] or {}).get('receipt') or {}).get('state', 'pending-final-verification'),
               'pageTextObligationsPayloadBytes': len(json.dumps(payload['pageTextObligations'], ensure_ascii=True).encode()),
               'exactBankRepairState': ((payload['exactBankRepair']['verification'] or {}).get('receipt') or {}).get('state', 'pending-final-verification'),
               'exactBankRepairPayloadBytes': len(json.dumps(payload['exactBankRepair'], ensure_ascii=True).encode()),
               'taskRetrievalRepairState': ((payload['taskRetrievalRepair']['verification'] or {}).get('receipt') or {}).get('state', 'pending-final-verification'),
               'taskRetrievalRepairPayloadBytes': len(json.dumps(payload['taskRetrievalRepair'], ensure_ascii=True).encode()),
               'supportedCoverageRepairState': payload['supportedCoverageRepair']['state'],
               'supportedCoverageRepairPayloadBytes': len(json.dumps(payload['supportedCoverageRepair'], ensure_ascii=True).encode()),
               'authoringFlowHeadroomState': payload['authoringFlowHeadroom']['state'],
               'authoringFlowHeadroomPayloadBytes': len(json.dumps(payload['authoringFlowHeadroom'], ensure_ascii=True).encode()),
               'numericFiniteDomainState': payload['numericFiniteDomain']['state'],
               'numericFiniteDomainPayloadBytes': len(json.dumps(payload['numericFiniteDomain'], ensure_ascii=True).encode()),
               'outlineRepairWorkspaceState': payload['outlineRepairWorkspace']['state'],
               'outlineRepairWorkspacePayloadBytes': len(json.dumps(payload['outlineRepairWorkspace'], ensure_ascii=True).encode()),
               'sourceRecoveryDiagnosticState': payload['sourceRecoveryDiagnostic']['state'],
               'sourceRecoveryDiagnosticPayloadBytes': len(json.dumps(payload['sourceRecoveryDiagnostic'], ensure_ascii=True).encode()),
               'outlineCapabilityImplementationState': payload['outlineCapabilityImplementation']['state'],
               'outlineCapabilityImplementationPayloadBytes': len(json.dumps(payload['outlineCapabilityImplementation'], ensure_ascii=True).encode()),
               'outlineCapabilityPeerEligibilityState': payload['outlineCapabilityPeerEligibility']['state'],
               'outlineCapabilityPeerEligibilityPayloadBytes': len(json.dumps(payload['outlineCapabilityPeerEligibility'], ensure_ascii=True).encode()),
        'outlineSourceOverlapPackingState': payload['outlineSourceOverlapPacking']['state'],
        'outlineSourceOverlapPackingPayloadBytes': len(json.dumps(payload['outlineSourceOverlapPacking'], ensure_ascii=True).encode()),
        'outlineSourceOverlapIntegrationState': payload['outlineSourceOverlapIntegration']['state'],
        'outlineTerminalBudgetCohortState': payload['outlineTerminalBudgetCohort']['state'],
        'outlineConsolidationCoreState': payload['outlineConsolidationCore']['state'],
        'sourceInterpretationLiveState': payload['sourceInterpretationLive']['state'],
        'numericSemanticReviewState': payload['numericSemanticReview']['state'],
               'phaseOneLedgerSha256': payload['phaseOneIntegrity']['ledgerSha256'],
               'teacherAcceptance': None, 'goalComplete': False,
               'privateEvidence': 'private/data.js is ignored; exact prompts and raw visible output are not public telemetry.'}
    (BOOK / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps({'book': str(BOOK / 'index.html'), **summary}))




def _historical_chapter18_build():
    """Append chapter18 to the exact historical56-value predecessor; no replay."""
    base = ROOT / 'audit-results/outline-runtime-continuation-2026-10-17'
    before = base / 'book-before/artifacts/quality-lab-book-2026-10-16/private/data.js'
    payload = json.loads(before.read_text()[len('window.QUALITY_BOOK = '):-2])
    if len([key for key in payload if key != 'builtAt']) != 56:
        raise ValueError('Exact complete56-value predecessor required.')
    configuration = load(base / 'book-final-inputs.json')
    if configuration.get('status') != 'final-root-freeze-ready':
        raise ValueError('Chapter18 waits for the final root source freeze.')
    for row in configuration['allPins']:
        if hashlib.sha256((ROOT / row['path']).read_bytes()).hexdigest() != row['sha256']:
            raise ValueError('Chapter18 evidence pin changed: ' + row['path'])
    payload['builtAt'] = datetime.now(ZoneInfo('America/Vancouver')).isoformat()
    payload['outlineRuntimeContinuation'] = configuration['payload']
    data = json.dumps(payload, ensure_ascii=True).replace('<', '\\u003c')
    (BOOK / 'private/data.js').write_text('window.QUALITY_BOOK = ' + data + ';\n')
    (BOOK / 'index.html').write_text(PAGE)
    summary = load(base / 'book-before/artifacts/quality-lab-book-2026-10-16/summary.json')
    summary['builtAt'] = payload['builtAt']
    summary['outlineRuntimeContinuationState'] = payload['outlineRuntimeContinuation']['state']
    (BOOK / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps({'book': str(BOOK / 'index.html'), 'nonTimePayloads':57, 'newKey':'outlineRuntimeContinuation', 'oldPayloadsPreserved':56, 'scope':'Local preparation, no durable consolidation activation or model-quality result.'}))


def build_chapter19():
    """Append chapter19 without recomputing any historical evidence payload."""
    base = ROOT / 'audit-results/review-repair-and-outline-fixes-2026-10-17'
    before = base / 'book-before/artifacts/quality-lab-book-2026-10-16'
    payload = json.loads((before / 'private/data.js').read_text()[len('window.QUALITY_BOOK = '):-2])
    if len([key for key in payload if key != 'builtAt']) != 57:
        raise ValueError('Exact complete57-value predecessor required.')
    configuration = load(base / 'book-final-inputs.json')
    if not configuration or configuration.get('status') != 'final-root-freeze-ready':
        raise ValueError('Chapter19 waits for final root source, test and document verification.')
    for row in configuration['allPins']:
        raw = (ROOT / row['path']).read_bytes()
        if hashlib.sha256(raw).hexdigest() != row['sha256'] or len(raw) != row['bytes']:
            raise ValueError('Chapter19 evidence pin changed: ' + row['path'])
    payload['builtAt'] = datetime.now(ZoneInfo('America/Vancouver')).isoformat()
    payload['reviewDecisionIntegrity'] = configuration['payload']
    data = json.dumps(payload, ensure_ascii=True).replace('<', '\\u003c')
    (BOOK / 'private/data.js').write_text('window.QUALITY_BOOK = ' + data + ';\n')
    (BOOK / 'index.html').write_text(PAGE)
    summary = load(before / 'summary.json')
    summary['builtAt'] = payload['builtAt']
    summary['reviewDecisionIntegrityState'] = payload['reviewDecisionIntegrity']['state']
    (BOOK / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps({'book': str(BOOK / 'index.html'), 'nonTimePayloads': 58,
                     'newKey': 'reviewDecisionIntegrity', 'oldPayloadsPreserved': 57,
                     'scope': 'Offline review-integrity and outline guard fixes; closed R9 raw-output replay, not new model quality or useful yield.'}))

def build():
    """Append chapter20 to the exact chapter19 record; never replay old work."""
    base = ROOT / 'audit-results/model-review-calibration-2026-10-17'
    before = base / 'book-before'
    payload = json.loads((before / 'private/data.js').read_text()[len('window.QUALITY_BOOK = '):-2])
    if len([key for key in payload if key != 'builtAt']) != 58:
        raise ValueError('Exact complete58-value predecessor required.')
    configuration = load(base / 'book-final-inputs.json')
    if not configuration or configuration.get('status') != 'final-root-freeze-ready':
        raise ValueError('Chapter20 waits for reviewed local evidence and a current source freeze.')
    for row in configuration['allPins']:
        raw = (ROOT / row['path']).read_bytes()
        if hashlib.sha256(raw).hexdigest() != row['sha256'] or len(raw) != row['bytes']:
            raise ValueError('Chapter20 evidence pin changed: ' + row['path'])
    payload['builtAt'] = datetime.now(ZoneInfo('America/Vancouver')).isoformat()
    payload['reviewCalibrationPreparation'] = configuration['payload']
    data = json.dumps(payload, ensure_ascii=True).replace('<', '\\u003c')
    (BOOK / 'private/data.js').write_text('window.QUALITY_BOOK = ' + data + ';\n')
    (BOOK / 'index.html').write_text(PAGE)
    summary = load(before / 'summary.json')
    summary['builtAt'] = payload['builtAt']
    summary['reviewCalibrationPreparationState'] = payload['reviewCalibrationPreparation']['state']
    (BOOK / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps({'book': str(BOOK / 'index.html'), 'nonTimePayloads': 59,
                     'newKey': 'reviewCalibrationPreparation', 'oldPayloadsPreserved': 58,
                     'scope': 'Local engineering and unapproved fixed-candidate reviewer preparation; no new paid quality result.'}))


PAGE = r'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FinanceBot · Quality engineering book</title>
<style>
:root{color-scheme:light dark;--bg:#f3f5fa;--paper:#fff;--ink:#192230;--muted:#59697c;--line:#d9e1eb;--green:#245f3a;--soft:#edf4ef;--warning:#775000;--warn-bg:#fff4de}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font:14px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--ink)}a{color:var(--green);text-underline-offset:3px}button,select{font:inherit;color:inherit}button{cursor:pointer}button:active{transform:scale(.98)}a:focus-visible,button:focus-visible,select:focus-visible,summary:focus-visible,[tabindex]:focus-visible{outline:3px solid #55785e;outline-offset:3px}.skip{position:absolute;left:-9999px}.skip:focus{left:12px;top:12px;background:var(--paper);padding:10px;z-index:10}.layout{display:grid;grid-template-columns:238px minmax(0,1fr);min-height:100dvh}.sidebar{position:sticky;top:0;height:100dvh;padding:26px 20px;background:#245f3a;color:white;overflow:auto}.brand{font-size:19px;font-weight:700}.edition{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#d8e7dc;margin:5px 0 28px}.sidebar nav{display:grid;gap:5px}.sidebar a{color:#e5eee8;text-decoration:none;font-size:13px;padding:9px 10px;border-radius:5px}.sidebar a:hover,.sidebar a[aria-current]{background:#1c4c2e;color:white}.sidebar .scope{font-size:12px;color:#d8e7dc;border-top:1px solid #ffffff35;margin-top:25px;padding-top:18px}.sidebar details>summary{display:none}main{min-width:0;max-width:1420px;padding:32px clamp(18px,3vw,48px) 70px}.eyebrow{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}h1{font-size:32px;line-height:1.2;letter-spacing:-.035em;margin:7px 0 12px}h2{font-size:23px;line-height:1.3;letter-spacing:-.025em;margin:0 0 15px}h3{font-size:16px;margin:20px 0 8px}p{max-width:86ch}.intro{font-size:15px;color:var(--muted);max-width:80ch}.stamp,.caption{color:var(--muted);font-size:12px;overflow-wrap:anywhere}.notice{padding:14px 18px;border-left:3px solid var(--warning);background:var(--warn-bg);color:var(--warning);margin:20px 0}.chapter{background:var(--paper);border:1px solid var(--line);border-radius:9px;padding:24px;margin:24px 0;scroll-margin-top:18px}.chapter-number{font:700 11px ui-monospace,monospace;color:var(--green);letter-spacing:.08em;margin-bottom:6px}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin:22px 0}.metric{padding:16px 12px 16px 0}.metric+.metric{padding-left:16px;border-left:1px solid var(--line)}.metric strong{display:block;font-size:26px;line-height:1.4;letter-spacing:-.025em}.metric span{display:block;color:var(--muted);font-size:12px}.table-region{overflow:auto;margin:15px 0}table{border-collapse:collapse;width:100%;font-size:12px;text-align:left}th,td{padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}th{background:var(--bg);white-space:nowrap;color:var(--muted);font-size:11px}td:first-child{font-weight:600}tbody tr:last-child td{border-bottom:0}ul,ol{padding-left:22px}li{margin:6px 0}code,pre{font:12px/1.6 ui-monospace,SFMono-Regular,monospace}code{overflow-wrap:anywhere;background:var(--bg);padding:2px 4px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--bg);border:1px solid var(--line);padding:14px;border-radius:5px;max-height:520px;overflow:auto;margin:10px 0}details{border-top:1px solid var(--line);margin:15px 0;padding-top:12px}summary{cursor:pointer;font-weight:600;font-size:13px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:18px}.pair>div{min-width:0}.question{border-left:3px solid var(--green);padding:3px 0 3px 16px;margin:18px 0;white-space:pre-wrap}.option{padding:9px 12px;border:1px solid var(--line);border-radius:5px;margin:8px 0}.option small{display:block;color:var(--muted);margin-top:4px}.pill{font-size:10px;letter-spacing:.03em;border-radius:3px;background:var(--soft);padding:3px 6px;white-space:nowrap}.controls{display:flex;gap:14px;align-items:end;flex-wrap:wrap;margin:18px 0}label{font-size:12px;font-weight:600;display:grid;gap:5px}select{background:var(--paper);border:1px solid var(--line);border-radius:5px;padding:8px 10px;max-width:100%;min-width:180px}.text-button{border:0;background:none;color:var(--green);padding:0;text-align:left;text-decoration:underline;text-underline-offset:3px}.empty{color:var(--muted);padding:15px;background:var(--bg);border-radius:5px}.checks{border-left:3px solid var(--green);padding-left:15px}figure{margin:18px 0}figure img{width:100%;max-height:460px;object-fit:contain;object-position:top;border:1px solid var(--line);background:var(--bg)}figcaption{font-size:12px;color:var(--muted);margin-top:7px}footer{font-size:12px;color:var(--muted);padding-top:20px}.progress{display:grid;grid-template-columns:90px 1fr;gap:10px;border-bottom:1px solid var(--line);padding:11px 0}.progress b{font-size:12px}.progress span{font-size:13px}.model-good{color:var(--green);font-weight:700}.model-unknown{color:var(--warning);font-weight:700}
.probe-table table{min-width:960px;table-layout:fixed}.probe-table th:nth-child(1){width:190px}.probe-table th:nth-child(2){width:100px}.probe-table th:nth-child(3){width:140px}.probe-table th:nth-child(4){width:165px}
@media(max-width:800px){.layout{grid-template-columns:1fr}.sidebar{position:static;height:auto;padding:16px 18px}.edition{margin:0 0 10px}.sidebar details>summary{display:block}.sidebar nav{margin-top:12px;grid-template-columns:1fr 1fr}.sidebar .scope{margin:10px 0 0;padding-top:10px}.chapter{padding:18px}main{padding:22px 14px 45px}h1{font-size:28px}.metrics{grid-template-columns:1fr 1fr}.metric:nth-child(3){border-left:0;padding-left:0}.metric:nth-child(n+3){border-top:1px solid var(--line)}.pair{grid-template-columns:1fr}th,td{padding:9px}.controls>label{width:100%}select{width:100%}}
@media(prefers-color-scheme:dark){:root{--bg:#181e1b;--paper:#222b25;--ink:#edf2ee;--muted:#b6c5ba;--line:#3b4b40;--green:#a1d3ad;--soft:#304839;--warning:#edcd88;--warn-bg:#3a3020}.sidebar{background:#183d26}.sidebar a:hover,.sidebar a[aria-current]{background:#2b5a3a}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}button:active{transform:none}}
</style></head><body><a class="skip" href="#main">Skip to book</a><div class="layout"><aside class="sidebar"><div class="brand">FinanceBot</div><div class="edition">Quality engineering book · 16 Oct 2026</div><details open><summary>Chapters</summary><nav aria-label="Book chapters"><a href="#overview">00 · Evidence and status</a><a href="#sources">01 · Multiple chapters</a><a href="#validation">02 · Detect and correct</a><a href="#models">03 · Model comparison</a><a href="#io">04 · Exact input / output</a><a href="#cost">05 · Tokens and time</a><a href="#verification">06 · Verification</a><a href="#canvas">07 · Exams and Canvas</a><a href="#supported-lo-coverage-repair">08 · Recover a missing capability</a><a href="#authoring-flow-headroom">09 · Full-flow prompt admission</a><a href="#numeric-finite-domain">10 · Bounded numerical proof</a><a href="#outline-repair-workspace">11 · Instructor outline repair</a><a href="#source-recovery-diagnostic">12 · Table recovery and LO overlap</a><a href="#outline-capability-implementation">13 · Capability checks and cost</a></nav></details><p class="scope">Real source documents. Explicit model settings. Original failures retained. Human acceptance stays unknown until measured.</p></aside><main id="main"><header><div class="eyebrow">An inspectable record of changes and experiments</div><h1>Improving useful question supply</h1><p class="intro">Follow the source material, the generated question, the validator’s finding and the corrected output. The same-input model pilot and the production workflow are reported as separate evidence.</p><p class="stamp" id="stamp">Local evidence has not loaded.</p></header>
<section class="chapter" id="overview"><div class="chapter-number">00 / EVIDENCE AND STATUS</div><h2>What is established now</h2><div class="notice"><strong>This work remains active.</strong> No overall “quality solved” or teacher-acceptance claim is made from a tuning pilot. Baseline remains the product default; v2 remains opt-in.</div><div class="metrics"><div class="metric"><strong id="metric-slots">—</strong><span>Phase 1 generator slots</span></div><div class="metric"><strong id="metric-reviewed">—</strong><span>Phase 1 model-assessed eligibility</span></div><div class="metric"><strong id="metric-sends">—</strong><span>Observed Phase 1 pilot sends</span></div><div class="metric"><strong>Unknown</strong><span>Teacher acceptance / review minutes</span></div></div><div class="progress"><b>Starting point</b><span>The latest earlier full paid run saved 1/6 Drafts. Two later review-only positives recovered eligibility; they added no saved questions. Negative semantic checks were not established.</span></div><div class="progress"><b>New engineering</b><span>Bounded source-backed repair, reasoning-aware output budgets, multi-passage extraction accounting, and exact-model/raw-I/O comparison records.</span></div><div class="progress"><b>Observed repair</b><span>One actual retained numerical failure was corrected and independently checked in four API sends. Its original domain had 12/27 colliding combinations; the corrected domain had 0/27. This probe saved no questions.</span></div><div class="progress" id="phase-two-overview"><b>Ten-chapter proof</b><span>Phase 2 receipts are being loaded; completed upload/indexing is separate from final outline and question quality.</span></div><div class="progress"><b>Required proof</b><span>Original-source inspection, meaningful negative controls, complete pipeline results and held-out repetitions. A generated or judge-eligible question is not a saved or accepted one.</span></div><p><a href="../quality-authoring-retest-2026-10-14/index.html">Previous repair report</a> · <a href="../../scripts/prompt-ab/quality-lab-plan-2026-10-16.json">Full active plan</a></p></section>
<section class="chapter" id="sources"><div class="chapter-number">01 / MULTIPLE CHAPTERS</div><h2>Every selected chapter needs an explanation</h2><p>Preparation receipts list intended uploads. Readiness checks indexed originals before paid work. The new extraction protocol assigns each parsed passage to supported objectives or an explicit disposition with a reason. Final organization cannot silently omit an instructional source.</p><div class="checks"><p><strong>Final wording is checked against original sections.</strong> For the large, organized outline path, a separate bounded model review reads the full original sections behind each merged LO and its assigned learning points. Unchanged evidence IDs or earlier draft summaries cannot supply a missing formula condition, actor relationship or untaught capability. Unsupported and uncertain objectives are withheld, and partial reviews remain diagnostics. This additional review is specific to the large organized path; small direct synthesis is not covered by this new final-review stage. These checks remain model judgments that require calibration.</p></div><div id="corpus-status" class="empty">The new physical corpus preparation has not completed yet.</div><div id="phase-two-upload"></div><div id="phase-two-outline"></div><h3>Retained Phase 1 source experiments</h3><div id="matched-status"></div><div id="warm-status"></div><div id="outline-status" class="empty">New full outline model observations are not available yet.</div><p>Formula, numerical-relationship and visual cues form an inspection inventory. A cue or valid citation does not prove conceptual coverage. Non-instructional, context, visual-review and unreviewed passages remain distinguishable. Charts and flattened actor relationships require original-page inspection.</p><details><summary>What changed in extraction and reuse</summary><ul><li>Multiple separately verified original quote groups can support one learning objective.</li><li>Unaccounted passages fail the strict extraction contract instead of disappearing.</li><li>New cache identities include passage-accounting schema, actual model/effort and output cap.</li><li>Potential repeated evidence across LOs is reported for inspection, not automatically described as duplication.</li></ul></details><p class="caption">The retained Phase 1 corpus fixture was physically indexed with advisory classification skipped. The separate Phase 2 receipt above exercises real HTTP multipart admission and actual parsing, chunking and indexing; it still does not exercise SAML or Agenda automation.</p></section>
<section class="chapter" id="validation"><div class="chapter-number">02 / DETECT AND CORRECT</div><h2>A validation finding must be actionable and source-bound</h2><ol><li>Find the defect: source scope, actor relationship, notation, task duplication, answer meaning, instructions or unnecessary length.</li><li>Bind the corrective instruction to current source passages or pinned Bank comparisons. A suggestion without valid support cannot authorize a repair.</li><li>Attempt one correction or independent-task replacement within the existing shared repair allowance.</li><li>Run numerical, source, notation and novelty checks again; option-role assessment feeds the content Reviewer decision. Preserve the original and corrected candidate in guarded diagnostics.</li></ol><p>Ambiguous diagrams, damaged evidence, unknown IDs, unchanged output and unresolved defects stay withheld. A format correction and a content correction share bounded allowances; failures do not open an unlimited retry loop.</p><div id="validation-status" class="empty">Real retained-negative repair observations have not completed yet. Offline synthetic repair tests are engineering evidence only.</div><p class="caption">Reasoning consumes the completion budget too. Medium/high v2 generation now has an 8k cap, and its validation/review checks have a 6k cap. Admission still applies; a larger cap is not a promise to spend that many tokens.</p></section>
<section class="chapter" id="models"><div class="chapter-number">03 / MODEL COMPARISON</div><h2>Same source, same request, five model configurations</h2><p>Four tuning cases compare Luna 6 at low, medium and high with Sol 6.1 at medium and high. Each case has a byte-identical generator prompt across arms; sources, Bank memory and requirements are frozen. A fixed Sol 6.1 / medium judge is used after deterministic checks.</p><div class="table-region" role="region" tabindex="0" aria-label="Model pilot results"><table><thead><tr><th scope="col">Arm</th><th scope="col">Requested</th><th scope="col">Parsed candidates</th><th scope="col">Model eligible</th><th scope="col">Checked admission</th><th scope="col">At requested difficulty</th><th scope="col">Generator input / output</th><th scope="col">Median generator time</th></tr></thead><tbody id="model-rows"><tr><td colspan="8">No paid observations loaded.</td></tr></tbody></table></div><p class="caption">All cells use one draw on four tuning cases. Requested-difficulty counts also require the fixed judge to assess the requested difficulty. Generator cost/time excludes the separate fixed assessment; complete totals remain in Chapter 05. Lab eligibility includes numerical/variation/source-ID checks and the model assessment. Production servability, task-plan admission, generic validation and content review are separate gates; their absence cannot imply production readiness. Single-trial tuning results do not establish a general model ranking. The Sol judge shares a model family with Sol generation arms; this is not an independent human rating. Full public batch saved yield is not measured by this isolated generator pilot.</p><div id="model-analysis"></div><details><summary>Model contract and methodology</summary><div id="access-status"></div><p>Sol 6.1 does not support effort none; its new reasoning-required profile uses a compatible default and rejects an explicitly unsupported effort before dispatch. No model or effort fallback is permitted in the experiment.</p><p><a href="https://developers.openai.com/api/docs/guides/deployment-checklist#set-up-reasoningeffort">Official OpenAI reasoning-effort guidance</a> · <a href="../../scripts/quality-lab/README.md">Recorder protocol and commands</a></p></details></section>
<section class="chapter" id="io"><div class="chapter-number">04 / EXACT INPUT AND OUTPUT</div><h2>Inspect a question and every model attempt</h2><p>These are local public-source test records. Visible output is captured before parsing, including failed JSON. Private model reasoning is neither requested nor displayed. Provider credentials and authentication headers are excluded.</p><div class="controls"><label>Case<select id="case-select" aria-label="Case"><option value="">No cases loaded</option></select></label><label>Model configuration<select id="cell-select" aria-label="Model configuration"><option value="">No outputs loaded</option></select></label></div><div id="cell-status" class="empty">No model cell selected.</div><div id="candidate"></div><div id="cell-assessment"></div><div id="transcripts"></div></section>
<section class="chapter" id="cost"><div class="chapter-number">05 / TOKENS AND TIME</div><h2>Count failed work and keep estimates separate</h2><div id="cost-status" class="empty">The shared phase ledger has not admitted a send yet.</div><div id="phase-two-cost"></div><p>The first phase is limited to 100 reserved sends and 2,000,000 conservative input-plus-output reservation units across model, outline and repair work. The disk ledger survives restarts and does not reset between scripts. Questions stay under a 24k conservative input ceiling; full-document extraction has a separate 200k per-call ceiling.</p><p>Reported input/output/reasoning/cache tokens are shown when supplied, with missing counts left unknown. Reasoning tokens are a subset of output. Provider duration and run wall time are different measures. No accepted-question cost or review-time benefit is inferred without acceptance labels.</p><p class="caption">Embeddings, parsing, infrastructure, money pricing and SDK-hidden physical retries are excluded from LLM totals. Exact raw I/O stays in local ignored evidence, outside metadata-only product usage receipts.</p></section>
<section class="chapter" id="verification"><div class="chapter-number">06 / VERIFICATION</div><h2>Tests, screenshots and limits</h2><div id="verification-status" class="empty">Historical verification is being loaded.</div><div id="phase-two-verification" class="empty">Current-source verification after the Phase 2 grounding changes is pending. The retained 2,552-test Phase 1 pass does not cover those later changes.</div><div class="pair"><figure><a href="../quality-authoring-2026-10-13/generation-v2-desktop-light.png"><img src="../quality-authoring-2026-10-13/generation-v2-desktop-light.png" alt="Existing instructor v2 generation controls" loading="lazy"></a><figcaption>Controlled API fixture, rerun 16 Oct: production v2 generation controls. UI behavior only; live-model quality is separate.</figcaption></figure><figure><a href="../quality-authoring-2026-10-13/regeneration-desktop-light.png"><img src="../quality-authoring-2026-10-13/regeneration-desktop-light.png" alt="Existing regeneration intent and comparison interface" loading="lazy"></a><figcaption>Controlled API fixture, rerun 16 Oct: explicit regeneration intent and comparison. Live model input/output is inspected in Chapter 04.</figcaption></figure></div><div class="pair"><figure><a href="structure-ai-desktop-api-fixture.png"><img src="structure-ai-desktop-api-fixture.png" alt="Production Course Structure editor with grouped original evidence in a desktop API fixture" loading="lazy"></a><figcaption>Controlled API fixture: grouped source evidence and visible coverage gaps in the compiled editor. The live two-chapter output is separate evidence in Chapter 01.</figcaption></figure><figure><a href="admin-sol-reasoning-required-api-fixture.png"><img src="admin-sol-reasoning-required-api-fixture.png" alt="Admin Sol model profile showing supported reasoning settings" loading="lazy"></a><figcaption>Controlled API fixture: Sol reasoning choices and intercepted save payload. No real Admin setting was changed.</figcaption></figure></div><p><a href="../../docs/design/question-generation-quality/OUTLINE-SOURCE-INVENTORY-2026-10-16.md">Outline implementation</a> · <a href="../../audit-results/quality-lab-2026-10-16/baseline-code.json">Recovered pre-change code identities</a> · <a href="summary.json">Book summary</a> · <a href="visual-verification.json">Reader layout / accessibility checks</a></p><p class="caption">A report screenshot proves readability, not model accuracy. Product screenshots are labelled with their controlled-fixture scope. No goal completion, deployment or default-policy change is implied.</p></section>
<section class="chapter" id="canvas"><div class="chapter-number">07 / REAL EXAMS AND CANVAS · STRETCH GOAL</div><h2>Export an exact paper after review</h2><p>The current Exam Builder can compose approved bank questions by topic and freeze verified numerical variants. A Canvas design should export the reviewed immutable paper, with the exact displayed values, answer keys, points and release policy. It must not redraw parameters or send unpublished answer keys to students.</p><p>Direct Canvas publishing remains a design/stretch item. A safe route needs an offline export preview, explicit target course, instructor OAuth authorization and a reviewed final import step. No Canvas quiz or production exam has been created by these experiments.</p><p><a href="../../docs/design/question-generation-quality/CANVAS-EXAM-EXPORT-DESIGN-2026-10-16.md">Reviewed export architecture and acceptance plan</a></p><p class="caption">Official Canvas Content Migrations and New Quizzes / Items APIs were checked. Current requested OAuth scopes are read-only. The installed toolkit also needs a reviewed New Quizzes namespace/PATCH extension. Published state appears in responses but unpublished creation is not yet an established contract; a sandbox and exact read-back must prove it. Stable option UUIDs, zero-credit distractors, feedback policies and unknown remote outcomes are specified in the design. No direct export is implemented.</p></section><footer>English collaboration artifact · Public PDFs retained locally · Active scope includes held-out tests and full-pipeline verification · Local-only evidence book.</footer></main></div>
<script src="private/data.js"></script><script>
'use strict';
const D=window.QUALITY_BOOK||{};
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);if(cls)e.className=cls;if(tag==='pre')e.tabIndex=0;return e};
const put=(id,text)=>document.getElementById(id).textContent=text;
const pretty=x=>JSON.stringify(x,null,2);
const fmt=x=>typeof x==='number'?x.toLocaleString('en-US'):'unknown';
const details=(title,text)=>{const d=el('details');d.append(el('summary',title),el('pre',text));return d};
function eventsFor(cell){const seen=new Set();return (cell.captures||[]).flatMap(c=>(c.transcript?.attempts||[]).flatMap(a=>a.events||[])).filter(e=>e.type==='finished'&&!seen.has(e.callId)&&seen.add(e.callId))}
function usage(cells){const ev=cells.flatMap(eventsFor),sum=key=>{const counts=ev.map(e=>e.usage?.[key]);return counts.length&&counts.every(v=>Number.isSafeInteger(v))?counts.reduce((a,b)=>a+b,0):null};return {calls:ev.length,input:sum('inputTokens'),output:sum('outputTokens'),ms:ev.reduce((s,e)=>s+(e.durationMs||0),0)}}
put('stamp','Evidence book built '+(D.builtAt||'unknown')+' · refresh only after rebuilding from new evidence.');
const cells=D.model?.cells||[];
put('metric-slots',D.model?.requestedSlots??'Not run');put('metric-reviewed',cells.length?cells.filter(c=>c.eligibleBeforeRepair===true).length+' / '+cells.length:'Not measured');const pending=cells.filter(c=>c.eligibleBeforeRepair===null).length;if(pending)document.getElementById('metric-reviewed').parentElement.append(el('span',pending+' still awaiting assessment')); put('metric-sends',D.model?.budget?.observedSends??'Not run');
if(D.corpus)put('corpus-status',D.corpus.sources.length+' complete PDFs · '+D.corpus.sources.reduce((n,s)=>n+s.pages,0)+' pages · '+D.corpus.sources.reduce((n,s)=>n+s.chunks.length,0)+' indexed chunks. Test-owned original manifests and local embeddings; zero preparation LLM calls.');
if(D.matchedOutline){const box=document.getElementById('matched-status');box.replaceChildren(el('h3','Matched original-page extraction'),el('p','Same PDF page, Luna medium and 8k cap. Both calls produced the same three substantive learning objectives. The observed improvement is complete original-evidence grouping: source-reference counts 1/1/1 became 2/3/2, with the page number explicitly excluded. This is a one-page regression probe, not proof of ten-chapter semantic coverage.'));const pair=el('div',undefined,'pair');for(const row of D.matchedOutline.outcomes||[]){const panel=el('div');panel.append(el('h3',row.arm));for(const section of row.raw?.sections||[])for(const objective of section.objectives||[]){panel.append(el('p',objective.name),el('p',[objective.passageId,...(objective.supportingPassageIds||[])].join(' + '),'caption'))}pair.append(panel)}box.append(pair,details('Original page text and matched controls',pretty(D.matchedControls)),details('Exact visible inputs, outputs and usage',pretty(D.matchedOutline)),details('Retrospective protocol audit',pretty(D.matchedAudit)));} 
if(D.outline){const box=document.getElementById('outline-status');box.classList.remove('empty');box.replaceChildren(el('h3','Two complete chapters through the production outline pipeline'),el('p','Status: '+D.outline.status+'. Selected Chapters 3 and 6 contain 64 pages. Eight other complete sources are explicitly excluded from this bounded run; all ten remain the full acceptance target.'));for(const topic of D.outline.result?.themes||[]){box.append(el('h3',topic.name));const list=el('ol');for(const objective of topic.los){const li=el('li',objective.name);li.append(el('small',' · '+objective.evidenceIds.length+' original evidence links'));list.append(li)}box.append(list)}box.append(details('Original source selection and complete exclusions',pretty(D.outlineControls?.sourceReceipt)),details('Coverage, gaps, cache and synthesis receipt',pretty(D.outline.result?.coverage||null)),details('Exact outline inputs and raw outputs',pretty(D.outline)),details('Ten-file cold preflight, not a completed ten-file run',pretty(D.outlineTenPreflight?.plan?.summary)));} 
if(D.warmOutline){const w=D.warmOutline;document.getElementById('warm-status').replaceChildren(el('h3','Warm extraction replay: reusable analysis, uncached final draft'),el('p','All 71 extraction sections were reused from five cache entries, with 0 provider sends. The run stopped at final synthesis after '+w.elapsedMs+' ms because that result is not cached. This measures time to a cache miss, not completed warm-outline latency.'),details('Zero-provider warm replay receipt',pretty(w)));}
function questionPanel(title,q){const panel=el('div');panel.append(el('h3',title));if(!q){panel.append(el('p','No corrected candidate was produced.','empty'));return panel}panel.append(el('div',q.stem,'question'));for(const option of q.options||[]){const row=el('div',option.key+' · '+option.text,'option');row.append(el('small',option.role+' · '+option.explanation));panel.append(row)}panel.append(details('Parameters, formulas and task descriptor',pretty(q)));return panel}
function appendCaptures(box,captures){for(const cap of captures||[]){const t=cap.transcript;if(!t)continue;const group=el('details');group.append(el('summary',t.stage+' · '+t.status));for(const a of t.attempts||[]){group.append(el('p','Attempt '+(a.number+1)+' · '+a.dispatch),el('p','Exact request options'),el('pre',pretty(a.input.options)),el('p','Exact visible input'),el('pre',a.input.prompt),el('p','Raw visible output before parsing'),el('pre',a.rawVisibleText||'(empty visible output)'),details('Provider usage / identity events',pretty(a.events)))}box.append(group)}}
function evidenceTable(label,headers,rows){const region=el('div',undefined,'table-region'),table=el('table'),head=el('thead'),tr=el('tr'),body=el('tbody');region.tabIndex=0;region.setAttribute('role','region');region.setAttribute('aria-label',label);for(const text of headers){const th=el('th',text);th.scope='col';tr.append(th)}head.append(tr);table.append(head);for(const cells of rows){const row=el('tr');for(const value of cells){const td=el('td');if(value instanceof Node)td.append(value);else td.textContent=String(value??'unknown');row.append(td)}body.append(row)}table.append(body);region.append(table);return region}
function seconds(ms){return typeof ms==='number'?(ms/1000).toFixed(1)+' s':'Not recorded'}
const P2=D.phaseTwo||{};
if(P2.upload){const overview=document.querySelector('#phase-two-overview span'),u=P2.upload;overview.textContent='Actual HTTP multipart + physical indexing: '+u.status+'; '+(u.observations?.indexedSources||[]).length+' / '+(P2.uploadControls?.sources||[]).length+' complete PDFs indexed. Captured outline runs: '+((P2.outlineRuns||[]).map(run=>run.name+' '+run.receipt.status).join('; ')||'not available')+'. Coverage and final wording require their separate receipts.';}
if(P2.upload){const r=P2.upload,c=P2.uploadControls||{},o=r.observations||{},indexed=o.indexedSources||[],sources=c.sources||[],box=document.getElementById('phase-two-upload'),latest=[...(r.http||[])].reverse().find(row=>/source-readiness$/.test(row.path||''))?.response;box.append(el('h3','Phase 2 — ten original PDFs through actual HTTP upload'),el('p','Recorded status: '+r.status+' · '+indexed.length+' / '+sources.length+' files physically indexed · '+fmt(c.totalPages)+' original pages · '+fmt(c.totalPdfBytes)+' PDF bytes · elapsed '+seconds(r.elapsedMs)+'. All-source readiness in the latest retained HTTP response: '+String(latest?.ready??'unknown')+'.'),el('p','This test uses the actual multipart endpoint, Multer, Mongo batch/material receipts, original PDF parser, chunker, cached local FastEmbed and an owned-course Qdrant collection. Its request identity is synthetic inside an ephemeral test app; real course authorization guards stay active. Agenda dispatch is recorded, while ingestion is executed explicitly. SAML and automatic worker execution are not exercised.'));
const httpRows=(r.http||[]).filter(row=>!row.label.startsWith('real index ')).map(row=>{const response=row.response||{},counts=response.counts||{};return [row.label,row.method+' '+row.path,row.status,response.error||response.admissionError||response.admission||(Object.hasOwn(response,'ready')?'ready: '+response.ready:'recorded'),counts.requested!==undefined?counts.received+' / '+counts.requested+' received; '+counts.rejected+' rejected':(response.requested?response.included.length+' / '+response.requested.length+' indexed':'—')]});box.append(evidenceTable('Actual multipart HTTP boundary observations',['Check','Actual request','HTTP','Observed response','Receipt counts'],httpRows));
const rows=sources.map(source=>{const ix=indexed.find(item=>item.chapter===source.chapter),a=el('a',source.name);if(source.publicPdf?.includes('/tlef-financebot/'))a.href='../../'+source.publicPdf.split('/tlef-financebot/')[1];return [a,source.pages,fmt(source.size),ix?fmt(ix.manifest?.chunkCount)+' / '+fmt(ix.qdrantIndexedCount):'Pending',ix?fmt(ix.parsedCharacterCount):'Pending',ix?seconds(ix.elapsedMs):'Pending',ix?String(ix.readiness?.ready):'Pending']});box.append(evidenceTable('Complete original PDFs and physical indexing results',['Original file','Pages','PDF bytes','Chunks / Qdrant points','Parsed characters','Index time','Original ready'],rows));
const before=o.partial?.before?.counts,after=o.partial?.after?.counts;if(before&&after)box.append(el('p','Injected partial-write control: '+before.received+' / '+before.requested+' materials were committed before the labelled third-insert failure. Retrying the same batch recovered '+after.received+' / '+after.requested+' materials, reusing '+(o.partial.after.items||[]).filter(item=>item.disposition==='reused').length+' existing originals. This is a deliberate diagnostic fault, not an unlabelled production failure.'));
box.append(el('p','Advisory classification was explicitly blocked for '+(r.advisoryClassification||[]).length+' indexed files and retained as a warning; it was not silently declared successful. Observed LLM provider calls: '+r.providerCalls+'. Saved/adopted questions: '+r.savedQuestions+' / '+r.adoptedQuestions+'. Parsing every file and admitting every byte do not establish complete instructional coverage or good questions.'),details('Every exact HTTP request descriptor and response',pretty(r.http)),details('Upload controls, exact file hashes and code identities',pretty(c)),details('Full physical-index receipt, limitations and any terminal error',pretty(r)));if(r.error)box.append(el('p','Recorded error: '+r.error.message,'notice'));}
const outlineRuns=P2.outlineRuns||[];
if(P2.parserAudit){const a=P2.parserAudit,t=a.totals||{},box=document.getElementById('phase-two-upload');box.append(el('h3','Historical parsing bottleneck — before the native-first change'),el('p',fmt(t.files)+' exact PDFs / '+fmt(t.pages)+' pages: the local native parsing pass took '+seconds(t.nativeParseMs)+' and reproduced all '+fmt(t.chunks)+' stored chunks byte for byte, including their manifest hashes. This is one filesystem-warm parse pass; it excludes upload, embeddings, indexing and model generation.'));
box.append(evidenceTable('Same-file parsing-path comparisons',['Chapter','Historical toolkit-first parse','Native-only parse','Exact raw text match','Exact stored chunks match'],(a.currentPolicyComparisons||[]).map(r=>[r.chapter,seconds(r.currentPolicyParseMs),seconds(r.nativeOnlyParseMs),String(r.exactRawTextEqualsNative),String(r.exactChunksEqualStored)])),el('p','Both historical-policy comparison files recorded an actual 15-second primary parser timeout before fallback. The original ten-file ingestion took 223.1 seconds across parsing, embeddings and persistence; it is not comparable with native parsing time alone. Historical controlled outline attempts retained the original parsing order. The new native-first production text-PDF policy was wired only after they became terminal; its separate acceptance is shown below.'),details('Exact parser controls, timings, source hashes and limitations',pretty(a)));}
if(P2.parserPolicyAcceptance){const a=P2.parserPolicyAcceptance,t=a.totals||{},box=document.getElementById('phase-two-upload');box.append(el('h3','Implemented PDF text policy — actual public-facade acceptance'),el('p','PDF text/default requests now use native-first parsing with bounded toolkit fallback. Markdown and non-PDF behavior remain on their existing paths. All '+fmt(t.completedFiles)+' complete PDFs / '+fmt(t.pages)+' pages returned the exact retained baseline raw text and '+fmt(t.observedChunks)+' unchanged chunks/manifest hashes, with '+fmt(t.nativeParses)+' native calls and '+fmt(t.toolkitParses)+' toolkit parses.'),evidenceTable('Actual native-first parser-only acceptance',['Measurement','Observed result'],[['PDF parsing only',(t.parserOnlyMs/1000).toFixed(5)+' s'],['Chunking only',t.chunkMs.toFixed(2)+' ms'],['Expected / reproduced chunks',fmt(t.expectedChunks)+' / '+fmt(t.observedChunks)],['Provider / database calls',fmt(a.isolation?.providerCalls)+' / '+fmt(a.isolation?.databaseCalls)]]),el('p','These serial parser-only timings use warm local filesystem caches. This acceptance performed no new upload, embedding, indexing or readiness change. The earlier 225.4-second multipart/index test includes different stages; it is not a 225.4-to-2.3-second speedup measurement. Diagrams, OCR and pedagogical coverage remain unmeasured.','notice'),details('Exact post-wiring source, output and timing receipt',pretty(a)));}
if(P2.reviewFailureAudit){const a=P2.reviewFailureAudit,box=document.getElementById('phase-two-outline'),group=el('details');group.append(el('summary','Why the cache-assisted outline stopped, and what changed'),el('p','All 671 original sections and five organization packs completed. The merge proposed '+fmt(a.totalObjectives)+' LOs; only '+fmt(a.reviewedObjectives)+' finished review ('+fmt(a.supportedObjectives)+' supported / '+fmt(a.withheldObjectives)+' withheld) before repeated foreign source aliases stopped the run. There is no applicable final outline from this attempt.'),el('p','L38 was allowed S139–S145, but the first reply cited foreign S133/S136 and the whole-batch correction still cited S136. New code retains valid siblings and retries only the invalid objective with exact allowed IDs. Separately, L14 was source-supported in its reason but rejected for placement; protocol v2 separates source admission from advisory grouping. Historical findings remain unchanged. The separate three-case live v2 probe below tests the repair; a complete new outline still needs verification.','notice'),details('Exact terminal evidence, source-alias audits and usage',pretty(a)));box.append(group);}
if(!outlineRuns.length)document.getElementById('phase-two-outline').append(el('h3','Phase 2 — full ten-chapter outline'),el('p','No captured ten-chapter outline result is available in this build. Upload/index readiness cannot substitute for this result. The large-outline merge now has a separate original-source review of final LO wording; a valid evidence ID alone is not proof of support.','empty'));
if(P2.extractionAudit){const a=P2.extractionAudit.audit,box=document.getElementById('phase-two-outline');box.append(el('h3','Observed extraction correction — structure and references'),evidenceTable('Exact frozen extraction revalidation',['Observation','Count'],[['Completed logical outputs',fmt(a.completedLogicalOutputs)],['Calls without a completed output',fmt(a.withoutCompletedOutput)],['Unique original sections validated',fmt(a.uniqueValidatedSections)],['Unique sections with an invalid observation',fmt(a.uniqueSectionsWithAnInvalidObservation)],['Unique sections recovered by correction',fmt(a.uniqueStructurallyRecoveredSections)],['Still unvalidated after an invalid observation',fmt(a.stillUnvalidatedAfterAnInvalidObservation.length)]]),el('p','The file-only audit uses the captured original prompts and the frozen production validator. Wrong passage IDs, conflicting dispositions and overlong fields caused 39 invalid row observations, including repeated failures. The 33 recovered sections passed source-local schema and passage accounting; this does not establish semantic correctness or final LO quality. Two calls had no completed output because of provider failures. Their unknown usage remains reserved.'));const calls=a.calls||[],cold=outlineRuns.find(run=>run.name==='outline-ten-cold')?.receipt;let example;for(let i=0;i<calls.length&&!example;i++)for(const row of calls[i].rows||[]){if(row.valid)continue;const after=calls.slice(i+1).find(call=>(call.rows||[]).some(next=>next.key===row.key&&next.valid));if(after){example={before:calls[i],after,row};break;}}if(example&&cold){const ex=el('details');ex.append(el('summary','One actual corrected section — exact before/after input and output'),el('p',example.row.materialName+' · '+example.row.sectionId+' · Initial validation error: '+example.row.error));const sections=cold.liveCorpus?.sections||[],source=sections.find(section=>section.materialId===example.row.materialId&&section.localId===example.row.sectionId);if(source)ex.append(details('Complete original section',pretty(source)));for(const [label,call] of [['Before correction',example.before],['After correction',example.after]]){const event=(cold.events||[]).find(event=>event.phase==='prepared'&&event.callId===call.callId),capture=(cold.captures||[]).find(capture=>capture.transcript?.request?.prompt===event?.prompt);ex.append(el('h3',label));const parsed=(cold.events||[]).find(event=>event.phase==='output'&&event.callId===call.callId)?.output?.sections?.find(row=>row.sectionId===example.row.sectionId);if(parsed){const list=el('ol');for(const point of parsed.objectives||[]){const li=el('li',point.name);li.append(el('small',' · '+[point.passageId,...(point.supportingPassageIds||[])].join(' + ')));list.append(li)}ex.append(list);}if(capture)appendCaptures(ex,[capture]);else ex.append(el('p','Exact capture not resolved for this example; inspect the complete run below.'));}box.append(ex);}box.append(details('Exact structural audit, run hash and limitations',pretty(P2.extractionAudit)));}
if(P2.continuityAudit){const a=P2.continuityAudit,box=document.getElementById('phase-two-outline'),group=el('details');group.append(el('summary','Original-page inspection: a diagram split across source chunks'),el('p','This actual correction passed source-local schema, but a neighboring point retained only the continuation of a diagram relationship. The complete subject and conditions span two chunks of the same original page. The retained later L4 review binding does include both adjacent original sections (S11 and S12). This intermediate continuation example therefore does not establish a final missing-context defect, false refusal or coverage loss.'),el('p','This is why 33 structural recoveries are not 33 established semantic improvements. No teacher acceptance or final quality claim is made from this example.','notice'));const figure=el('figure'),aLink=el('a'),img=el('img');aLink.href='source-ch02-page05-continuity.png';img.src=aLink.href;img.alt='Original finance Chapter 2 page 5: investment, financing and dividend decisions; the parsed lower boxes span source chunks C6 and C7.';img.loading='lazy';aLink.append(img);figure.append(aLink,el('figcaption','Original public PDF page5, rendered without altering the source. The image is a manual inspection aid. The retained L4 binding includes both source chunks; this is not evidence that the automated text pipeline understood the diagram layout.'));group.append(figure,details('Pinned original sections, actual before/after rows and inspection limits',pretty(a)));box.append(group);}
for(const run of outlineRuns){const r=run.receipt,c=run.controls||{},box=document.getElementById('phase-two-outline'),group=el('details'),themes=r.result?.themes||[],diagnostics=r.diagnosticRun?.structureDiagnostics||r.error?.structureDiagnostics||{},grounding=r.result?.coverage?.outlineGrounding||diagnostics.outlineGrounding;group.append(el('summary',run.name+' · '+r.status+' · '+themes.length+' returned Topics / '+themes.reduce((n,t)=>n+(t.los||[]).length,0)+' returned LOs'));group.append(el('p','Elapsed '+seconds(r.elapsedMs)+' · observed calls '+fmt(r.usage?.observedCalls)+' · reported input '+fmt(r.usage?.inputTokens)+' / output '+fmt(r.usage?.outputTokens)+' tokens. Source selection and the exact recorded model options are retained below. No Topic/LO Apply, saved question or teacher-acceptance claim follows from an outline observation.'));const preflight=c.plan?.summary;if(preflight)group.append(el('p','Frozen cold preflight: '+fmt(preflight.initialExtractionSends)+' initial extraction sends and '+fmt(preflight.initialExtractionConservativeTokens)+' conservative input-plus-output reservation units before corrections, organization, synthesis and final-LO source review. This is an admission estimate, not reported provider usage or a completed-quality result.'));for(const topic of themes){group.append(el('h3',topic.name));const list=el('ol');for(const lo of topic.los||[]){const li=el('li',lo.name);li.append(el('small',' · original evidence: '+(lo.evidenceIds||[]).join(', ')));list.append(li)}group.append(list)}if(!themes.length)group.append(el('p','No final Topic/LO draft was returned. Intermediate extracted points and partial reviews remain diagnostics rather than an applicable outline.','empty'));
if(grounding){group.append(el('h3','Original-source review of final LO wording'),el('p','Review receipt: '+(grounding.complete===undefined?'inspect receipt':String(grounding.complete))+' complete · '+fmt(grounding.reviewedObjectives)+' / '+fmt(grounding.totalObjectives)+' objectives reviewed · '+fmt(grounding.supportedObjectives)+' supported · '+fmt(grounding.withheldObjectives)+' withheld. These are model judgments against original sections, not professor-confirmed semantic truth.'));group.append(evidenceTable('Final objective source-review findings',['Final Topic / LO','Verdict','Concrete source-bound finding','Covered evidence / cited original sections'],(grounding.findings||[]).map(row=>[row.topic+' / '+row.name,row.status,row.reason,(row.coveredEvidenceIds||[]).join(', ')+' / '+(row.citedSourceIds||[]).join(', ')])),details('Complete or partial original-source review receipt',pretty(grounding)));}else group.append(el('p','No final-LO original-source review receipt was reached or recorded. Do not infer supported final wording from extraction or organization alone.','notice'));
if(r.error)group.append(el('p','Recorded stop/failure: '+r.error.message,'notice'));group.append(details('Coverage, exclusions, mapping gaps and synthesis receipt',pretty(r.result?.coverage||null)),details('Durable partial diagnostics, source accounting and native budget',pretty(diagnostics)),details('Frozen controls, source scope and unchanged budget policy',pretty(c)));const io=el('details');io.append(el('summary','Every exact visible model input and raw output'));appendCaptures(io,r.captures);group.append(io,details('Full terminal or in-progress outline record',pretty(r)));box.append(group);}
const validationBox=document.getElementById('validation-status');if(D.validation||D.recordedRepair)validationBox.classList.remove('empty');
if(D.validation){validationBox.replaceChildren(el('h3','Retained negative controls'),el('p','Six observed calls. The actor repair still depends on an uncertain table relationship and remains withheld. The repeated CAPM task was detected; its repair stopped before dispatch at the input cap. Neither result was saved.'));for(const row of D.validation.outcomes||[]){const result=row.repair?.result,audit=row.repair?.assessmentWithRepairAudit?.semanticRepair,group=el('details');group.append(el('summary',row.name+' · '+(audit?.outcome||row.qualityBeforeRepair?.status||'recorded')+(audit?.stopCode?' · '+audit.stopCode:'')));const pair=el('div',undefined,'pair');pair.append(questionPanel('Original retained candidate',row.originalCandidate),questionPanel('Corrective attempt',result?.generated));group.append(pair,el('p',(result?.quality?.reasons||row.qualityBeforeRepair?.reasons||[]).join(' ')),details('Actual before / after assessments',pretty({before:row.qualityBeforeRepair,after:row.repair})));validationBox.append(group)}const transcriptGroup=el('details');transcriptGroup.append(el('summary','Exact inputs / raw outputs for the negative-control probe'));appendCaptures(transcriptGroup,D.validation.transcripts);validationBox.append(transcriptGroup,details('Complete terminal receipt, including the admission failure',pretty(D.validation)));}
if(D.recordedRepairStopped){const group=el('details');group.append(el('summary','Actual matrix candidate: first corrective request stopped before dispatch'),el('p','The exact original CAPM candidate and recorded finding were reused. Its request exceeded the unchanged 24k conservative input cap; no provider call occurred and no candidate was saved.'));appendCaptures(group,D.recordedRepairStopped.transcripts);group.append(details('Unchanged original failure receipt',pretty(D.recordedRepairStopped)));validationBox.append(group);}
if(D.recordedRepair){const r=D.recordedRepair,o=r.outcome,a=o?.assessmentWithRepairAudit?.semanticRepair;validationBox.append(el('h3','Recorded CAPM candidate: one bounded correction'),el('p','Status: '+r.status+' · observed sends: '+r.budget.observedSends+' · eligible under frozen controls: '+String(o.frozenControlCandidateEligible)+' · saved/adopted: false. Live persistence and teacher acceptance are not tested. The frozen source packet is truncated and memory contains one shown Bank comparator; this does not establish whole-course novelty.'));const pair=el('div',undefined,'pair');pair.append(questionPanel('Same actual failed candidate',a?.before),questionPanel('Corrected candidate',o.repair?.generated));validationBox.append(pair,details('Fresh numerical verification and post-repair assessment',pretty({numerics:o.freshNumericVerification,quality:o.repair?.quality,budget:r.budget,error:r.error})));const ts=el('details');ts.append(el('summary','Every exact repair input and raw visible output'));appendCaptures(ts,r.transcripts);validationBox.append(ts,details('Full repair receipt and code lineage',pretty(r)));}
if(D.policyPromptPreflight)validationBox.append(el('p','Repeated policy prose was shortened while preserving source, Bank, candidate and requirements. The exact recorded repair request fell from '+fmt(D.policyPromptPreflight.previousInputEnvelopeUnits)+' to '+fmt(D.policyPromptPreflight.currentInputEnvelopeUnits)+' conservative input units under the same '+fmt(D.policyPromptPreflight.inputCap)+' cap. This zero-provider replay establishes admission only.'),details('Exact same-control policy compaction preflight',pretty(D.policyPromptPreflight)));
if(D.numericGridAudit){const n=D.numericGridAudit,c=n.comparison;validationBox.append(el('h3','The same failed candidate, checked across every small-grid combination'),el('p','Original domain: '+c.originalCollidingCombinations+' / '+c.originalCombinations+' combinations produce colliding displayed options. Corrected domain: '+c.repairedCollidingCombinations+' / '+c.repairedCombinations+'. The source, authoring request and original candidate were retained; the corrective attempt changed the permitted parameter domain. This additional exhaustive offline audit is not the production verifier, which still samples 100 seeds.'),el('p','Concrete original failure: RF=3, Beta=1.2, Risk Premium=6. Correct: 3 + 1.2 × 6 = 10.20%; distractor: 3 + 1.2 + 6 = 10.20%. The backend rejects the duplicate displayed answers.'),el('p','Serving safeguard: after eight unsuccessful redraws the helper now refuses to return a known unsafe draw. Small-grid exhaustive verification in the production gate remains future work.'),details('All actual original and repaired draws, formula results and source hashes',pretty(n)));}
if(D.repairPromptPreflight)validationBox.append(details('Offline request deduplication check: admission only, not model quality',pretty(D.repairPromptPreflight)));
if(D.access)put('access-status',D.access.requested.map(r=>r.model+': '+(r.listed?'listed by configured provider':'not listed')).join(' · ')+'. A list entry does not establish generation quality.');
if(cells.length){const tbody=document.getElementById('model-rows');tbody.replaceChildren();const arms=[...new Set(cells.map(c=>c.schedule.arm.id))];for(const arm of arms){const subset=cells.filter(c=>c.schedule.arm.id===arm),a=D.analysis?.arms.find(v=>v.arm===arm),g=a?.generator,tr=el('tr');[arm,subset.length,subset.filter(c=>c.normalizedCandidate).length,subset.filter(c=>c.eligibleBeforeRepair===true).length+' / '+subset.length,D.admission?D.admission.rows.filter(r=>r.arm===arm&&r.combinedCheckedEligibility).length+' / '+subset.length:'Pending audit',a?a.checkedEligibleAtRequestedDifficulty+' / '+subset.length:'Unknown',g?fmt(g.inputTokens)+' / '+fmt(g.outputTokens):'Unknown',g?(g.medianProviderMs/1000).toFixed(1)+' s':'Unknown'].forEach(v=>tr.append(el('td',v)));tbody.append(tr)}}
if(D.analysis)document.getElementById('model-analysis').replaceChildren(...(D.analysis.findings||[]).map(f=>el('p',f)),details('Per-case observations and separate generation / assessment costs',pretty(D.analysis)));
if(D.admission)document.getElementById('model-analysis').append(details('Offline production-admission reconciliation — still no saved Drafts',pretty(D.admission)));
if(D.ledger){const box=document.getElementById('cost-status');box.classList.remove('empty');const stages=[['Model pilot',D.model],['Matched page extraction',D.matchedOutline],['Two complete chapters',D.outline],['Retained negatives',D.validation],['Recorded CAPM repair',D.recordedRepair]].filter(([,r])=>r),known=stages.every(([,r])=>r.usage?.status==='complete'&&Number.isSafeInteger(r.usage.inputTokens)&&Number.isSafeInteger(r.usage.outputTokens));box.replaceChildren(el('h3','Phase 1 — immutable observations'),el('p',D.ledger.reservedSends+' / '+D.ledger.limits.maxSends+' reserved sends · '+fmt(D.ledger.conservativeTokens)+' / '+fmt(D.ledger.limits.maxConservativeTokens)+' conservative reservation units.'));if(known)box.append(el('p','All recorded Phase 1 probes reported '+fmt(stages.reduce((n,[,r])=>n+r.usage.inputTokens,0))+' input + '+fmt(stages.reduce((n,[,r])=>n+r.usage.outputTokens,0))+' output tokens. This is reported usage for observed SDK sends, separate from conservative reservations; hidden physical retries remain unknown.'));const region=el('div',undefined,'table-region'),table=el('table'),head=el('thead'),hr=el('tr');for(const title of ['Experiment','Observed sends','Input tokens','Output tokens','Wall time']){const th=el('th',title);th.scope='col';hr.append(th)}head.append(hr);table.append(head);region.tabIndex=0;region.setAttribute('role','region');region.setAttribute('aria-label','Reported usage by experiment');const body=el('tbody');for(const [name,r] of stages){const tr=el('tr');[name,fmt(r.usage?.observedCalls),fmt(r.usage?.inputTokens),fmt(r.usage?.outputTokens),typeof r.elapsedMs==='number'?(r.elapsedMs/1000).toFixed(1)+' s':'Not recorded'].forEach(value=>tr.append(el('td',value)));body.append(tr)}table.append(body);region.append(table);box.append(region,el('p','The cache-only warm probe and admission-stopped first repair sent zero model requests. They are not additional paid rows.'));}
if(P2.ledger){
const l=P2.ledger,d=P2.declaration||{},box=document.getElementById('phase-two-cost'),runs=outlineRuns.map(run=>[run.name,run.receipt]),phase1=[D.model,D.matchedOutline,D.outline,D.validation,D.recordedRepair].filter(Boolean);
if(P2.outlineReviewProbe?.usage)runs.push(['Review-only v2 probe',P2.outlineReviewProbe]);
const receipts=runs.map(([,r])=>r),sum=(rows,key)=>rows.reduce((n,r)=>n+(Number.isSafeInteger(r.usage?.[key])?r.usage[key]:0),0),hasCounts=receipts.some(r=>Number.isSafeInteger(r.usage?.inputTokens)&&Number.isSafeInteger(r.usage?.outputTokens)),complete=receipts.length?receipts.every(r=>r.usage?.status==='complete'&&Number.isSafeInteger(r.usage?.inputTokens)&&Number.isSafeInteger(r.usage?.outputTokens)):l.reservedSends===0,in2=sum(receipts,'inputTokens'),out2=sum(receipts,'outputTokens'),unknown=receipts.reduce((n,r)=>n+(Number.isSafeInteger(r.usage?.unknownCalls)?r.usage.unknownCalls:0),0),unclassified=receipts.filter(r=>!r.usage||!Number.isSafeInteger(r.usage.inputTokens)||!Number.isSafeInteger(r.usage.outputTokens)).length;
box.append(el('h3','Phase 2 — separately declared ten-chapter acceptance'),el('p',l.reservedSends+' / '+l.limits.maxSends+' reserved sends · '+fmt(l.conservativeTokens)+' / '+fmt(l.limits.maxConservativeTokens)+' conservative reservation units. This new prospective phase leaves Phase 1 at '+fmt(D.ledger?.reservedSends)+' sends and '+fmt(D.ledger?.conservativeTokens)+' reservation units. Neither phase is reset to make a run fit.'),el('p','Configured source extraction cap: '+fmt(d.extractionOutputCap)+' output tokens; synthesis cap: '+fmt(d.synthesisOutputCap)+'. Native production run bounds still apply in addition to the experiment ledger. A stopped cold run is not reclassified as a completed cold result.'));
const rows=runs.map(([name,r])=>[name,r.status,fmt(r.usage?.observedCalls),fmt(r.usage?.inputTokens),fmt(r.usage?.outputTokens),r.usage?.status||'unavailable',fmt(r.usage?.unknownCalls),seconds(r.elapsedMs)]);
if(P2.upload)rows.unshift(['Real HTTP admission + physical index',P2.upload.status,fmt(P2.upload.providerCalls),'0','0','No model calls','0',seconds(P2.upload.elapsedMs)]);
box.append(evidenceTable('Phase 2 reported provider usage',['Experiment','Recorded status','Observed calls','Reported input tokens','Reported output tokens','Usage completeness','Unknown-usage calls','Wall time'],rows));
const outlineOnly=outlineRuns.map(run=>run.receipt);if(outlineOnly.length)box.append(el('p','Cold + cache-assisted outline subtotal: '+fmt(sum(outlineOnly,'inputTokens'))+' reported input + '+fmt(sum(outlineOnly,'outputTokens'))+' reported output tokens; '+fmt(outlineOnly.reduce((n,r)=>n+(r.usage?.unknownCalls||0),0))+' observed calls have unknown usage. Separate review-only probes are listed separately and are not folded into this outline subtotal.'));
if(hasCounts){box.append(el('p',(complete?'Complete reported subtotal':'Known reported subtotal')+' from the listed Phase 2 receipts: '+fmt(in2)+' input + '+fmt(out2)+' output tokens. '+fmt(unknown)+' observed calls have unknown usage'+(unclassified?'; '+fmt(unclassified)+' receipts lack numeric subtotals':'')+'. This is a build-time snapshot; running work may not yet have a complete receipt. Missing usage is not counted as zero.',complete?undefined:'notice'));
const p1Known=phase1.every(r=>r.usage?.status==='complete'&&Number.isSafeInteger(r.usage.inputTokens)&&Number.isSafeInteger(r.usage.outputTokens));if(p1Known)box.append(el('p','Known reported subtotal across both phases: '+fmt(sum(phase1,'inputTokens')+in2)+' input + '+fmt(sum(phase1,'outputTokens')+out2)+' output tokens. This is a sum of reported subtotals, not complete billed usage, hidden physical retries, money spent or cost per teacher-accepted question.'));}
else box.append(el('p','No numeric Phase 2 provider subtotal is available. Conservative reservations cannot replace missing provider counts.','notice'));
box.append(el('p','Input/output tokens above are provider-reported observations. Conservative units are separate admission reservations and remain charged for unknown work. Neither measure establishes a monetary cost or teacher-accepted yield.'),details('Immutable Phase 1 lineage, Phase 2 declaration and current append-only ledger',pretty({phaseOneIntegrity:D.phaseOneIntegrity,declaration:d,ledger:l})));}
if(D.verification){const v=D.verification,j=v.fullJest,b=v.finalCommands?.results.find(r=>r.command.join(' ')==='npm run build');document.getElementById('verification-status').replaceChildren(el('p','Historical Phase 1 full Jest: '+fmt(j.passedTests??j.tests?.passed)+' / '+fmt(j.totalTests??j.tests?.total)+' tests, '+fmt(j.passedSuites??j.suites?.passed)+' suites. Focused checks and intercepted UI cases have separate receipts; their counts are not added to the full-suite denominator. These tests establish engineering behavior, not professor acceptance or complete live saved yield.'),el('p','Historical Phase 1 integrated build: '+(b?(b.exitCode===0?'passed':'failed'):(v.build?.status||'pending'))+'. These receipts predate the final-LO original-source review changes; current-source verification is shown separately.'),details('Verification receipt, timestamps and evidence limitations',pretty(v)));}
if(P2.verification){const box=document.getElementById('phase-two-verification'),v=P2.verification,j=v.fullJest;box.classList.remove('empty');box.replaceChildren(el('h3',P2.outlineV2Verification?'Historical Phase 2 checkpoint — before review v2':'Phase 2 engineering verification checkpoint'));if(j)box.append(el('p','Full Jest: '+fmt(j.passedTests??j.tests?.passed)+' / '+fmt(j.totalTests??j.tests?.total)+' tests · '+fmt(j.passedSuites??j.suites?.passed)+' suites. This earlier checkpoint is retained for lineage; the v2 checkpoint below supersedes its source scope. The receipt identifies source state and timestamps. Passing engineering tests does not establish semantic quality or professor acceptance.'));const commands=v.commands||[];if(commands.length)box.append(el('p','Build / typecheck / lint: '+commands.map(row=>row.command+' exit '+row.exitCode).join(' · ')+'.'));if(v.browser){const b=v.browser;box.append(el('p','Controlled production-UI executions: '+fmt(b.executions)+'. '+fmt(b.screenshotCheck?.executions)+' of those cases were re-executed to capture screenshots; this is not '+fmt((b.executions||0)+(b.screenshotCheck?.executions||0))+' unique cases. These cases use intercepted APIs and establish display/guard behavior, not live-model accuracy.'));const gallery=el('details');gallery.append(el('summary','Three source-review outcomes — desktop and mobile'));for(const [key,title,meaning] of [['all-withheld','All candidate LOs withheld','No applicable outline is presented when all final objectives lack verified support.'],['incomplete','Source review incomplete','A partial source-review receipt remains diagnostic and cannot authorize applying the draft.'],['partial-supply','Partial supported supply','Supported objectives remain selectable; withheld objectives and their concrete reasons stay visible.']]){gallery.append(el('h3',title),el('p',meaning));const pair=el('div',undefined,'pair');for(const size of ['desktop','mobile']){const filename='outline-grounding-'+key+'-'+size+'-api-fixture.png',record=(b.screenshots||[]).find(row=>row.path.endsWith('/'+filename));if(!record)continue;const figure=el('figure'),a=el('a'),img=el('img');a.href=filename;img.src=filename;img.alt='Controlled production UI: '+title.toLowerCase()+' on '+size;img.loading='lazy';a.append(img);figure.append(a,el('figcaption',size[0].toUpperCase()+size.slice(1)+' controlled API fixture. '+meaning+' Screenshot evidence is separate from the live ten-chapter run.'));pair.append(figure)}gallery.append(pair)}box.append(gallery);}box.append(details('Historical checkpoint receipt and limits',pretty(v)));}
if(P2.focusedVerification){const v=P2.focusedVerification,j=v.focusedJest,box=document.getElementById('phase-two-verification');box.classList.remove('empty');box.append(el('h3','Historical focused checks — before PDF wiring and review v2'),el('p',fmt(j.passedTests)+' / '+fmt(j.totalTests)+' tests across '+fmt(j.passedSuites)+' suites. This earlier checkpoint checked the extraction audit, transport-recovery admission and then-unwired PDF helper. Later parser wiring and review v2 have their own checkpoint below. These tests overlap the full-suite tests; their counts are not added.'),details('Focused verification scope and command',pretty(v)));}
if(P2.outlineV2Verification){const v=P2.outlineV2Verification,j=v.fullJest,b=v.browser,box=document.getElementById('phase-two-verification');box.classList.remove('empty');box.append(el('h3','Recorded integrated checkpoint — before negative-coverage normalization'),el('p','Full Jest: '+fmt(j?.passedTests)+' / '+fmt(j?.totalTests)+' tests across '+fmt(j?.passedSuites)+' suites. The focused 130 tests in five suites overlap this full result; they are not 130 additional tests. This checkpoint covers source/grouping separation, valid-sibling retention, invalid-row repair and native-first parsing. It predates the later negative-coverage normalization and streaming deadline; no new full-suite result is claimed for those repairs.'),el('p','Build / typecheck / scoped lint: '+(v.commands||[]).map(row=>row.command+' exit '+row.exitCode).join(' · ')+'. Recorded at '+v.checkedAt+'.'),el('p','Controlled production-UI browser cases: '+fmt(b?.passed)+' passed, using intercepted API fixtures. Legacy v1 statuses are preserved; source-supported v2 objectives remain selectable with a separate placement advisory; unsupported or incomplete review cannot be rescued by topic fit. This establishes display and guard behavior, not live model judgment accuracy.'),el('p','New probe and acceptance runner tests added after this full-suite discovery require separate focused verification. No complete live 111-LO review, increased saved-question yield, reduced professor review time or teacher acceptance follows from green engineering checks.','notice'));
const gallery=el('details');gallery.append(el('summary','Review v2 placement advisory — desktop and mobile API fixtures'));const pair=el('div',undefined,'pair');for(const size of ['desktop','mobile']){const filename='outline-grounding-v2-placement-'+size+'-api-fixture.png',figure=el('figure'),a=el('a'),img=el('img');a.href=filename;img.src=filename;img.alt='Controlled production UI: a source-supported LO remains selectable with a separate topic placement advisory on '+size;img.loading='lazy';a.append(img);figure.append(a,el('figcaption',size[0].toUpperCase()+size.slice(1)+' controlled API fixture. The advisory affects placement, while source support controls admission. This screenshot is not a live generated outline.'));pair.append(figure)}gallery.append(pair);box.append(gallery,details('Latest integrated verification receipt and explicit limits',pretty(v)),details('Exact controlled browser test report',pretty(P2.outlineV2Browser)));}
if(P2.outlineReviewProbe){
const r=P2.outlineReviewProbe,c=P2.outlineReviewProbeControls||{},box=document.getElementById('phase-two-outline'),outcomes=r.outcomes||[],group=el('div');group.id='outline-review-v2-probe';
group.append(el('h3','Actual review-only v2 probe: separate source and placement findings'),el('p','Recorded status: '+r.status+' · '+fmt(r.usage?.observedCalls)+' observed sends · '+seconds(r.elapsedMs)+' elapsed · '+fmt(r.usage?.inputTokens)+' input / '+fmt(r.usage?.outputTokens)+' output tokens. Database calls: '+fmt(r.databaseCalls)+'; saved/adopted: '+String(r.saved)+' / '+String(r.adopted)+'.'),el('p','L14 now receives a source-supported verdict; L38 cites only its permitted source aliases but remains unsupported by its own bound packet; a separate source audit identifies relevant chapter material assigned elsewhere; the labelled Black-Scholes negative remains unsupported. A valid citation protocol can produce a legitimate refusal. This probe does not establish a completed full outline or a higher saved-question yield.','notice'));
const probeTable=evidenceTable('Actual three-case review-only v2 outcomes',['Retained / labelled case','Source verdict','Placement advisory','Original aliases cited','Concrete source finding'],outcomes.map(o=>[o.id,o.sourceStatus||o.status,o.topicFit||'not recorded',(o.citedSourceIds||[]).join(', ')||'None',o.sourceReason||'No completed finding']));probeTable.classList.add('probe-table');group.append(probeTable);
group.append(el('p','The retained LO wording and its own original sections are reused. The v2 schema, prompt and single-objective request differ from the historical multi-objective review. This is an engineering regression probe with coupled changes, not a randomized same-request causal A/B. Synthetic negatives and expected engineering labels are not professor acceptance.'));
if(P2.outlineReviewProbeSourceAudit){const audit=P2.outlineReviewProbeSourceAudit,case38=(audit.cases||[]).find(row=>row.id==='L38-foreign-source-alias'),gap=case38?.assignmentGap,trace=el('div');trace.id='outline-assignment-audit';trace.append(el('h3','Independent source audit: an assignment gap, not whole-chapter absence'),el('p','The seven originals bound to L38 do not establish its full management-quality/future-performance distinction. But Chapter 4 does contain relevant teaching questions in S136, extracted as E205. The retained historical organization assigned E205/S136 to L36 while placing that capability in L38 wording. “Unsupported by this LO packet” must not be read as “absent from this chapter.”','notice'),el('p','The S136 questions have no marked answers. Rebinding that original would repair an assignment omission, not establish a teacher-approved answer or automatically make L38 eligible. The three-case probe repaired citation validity only; this evidence-assignment gap remains unrepaired.'),evidenceTable('Actual source-to-LO assignment trace',['Stage','Observed trace'],[['Original section','S136 / Chapter 4 chunk 42 / C43.S1 asks whether historical positive alpha indicates management quality or a good future investment; answers are unmarked.'],['Extraction','Item 134 extracts the distinction; the global inventory binds E205 to S136.'],['Historical L36','Receives E205/S136, but its wording omits management/future interpretation. Its historical review excludes E205 from covered points.'],['Historical L38','Includes management/future interpretation in its wording, but receives S139–S145 and not E205/S136.'],['V2 probe','Uses only valid own aliases and remains unsupported; no rebind or semantic repair was performed.']]),el('p','The new placement reason is also overly literal: sibling L39 teaches operating leverage under the same broad topic, using S146–S153 among its originals. L38 need not teach every component of its parent heading. This is advisory grouping calibration, separate from the content/evidence assignment problem.'),el('p','This is an agent-derived reading of complete retained originals and exact assignments, not teacher or human gold. The audit made zero provider, database and network calls. All nine source entries (eight distinct originals) and 20 quote groups matched their retained originals.'));
const link=el('a','Read the independent source audit and proposed next repair');link.href='../../docs/design/question-generation-quality/OUTLINE-REVIEW-PROBE-2026-10-16.md';trace.append(link,details('Exact source audit, original S136, E205/L36/L38/L39 bindings and limits',pretty(audit)));if(gap)trace.append(details('Actual unresolved assignment trace',pretty(gap)));group.append(trace);}

for(const outcome of outcomes){const control=(c.cases||[]).find(row=>row.id===outcome.id),comparison=el('details');comparison.append(el('summary',outcome.id+' — exact retained before / after'),el('p',outcome.finding?.name||control?.batch?.objectives?.[0]?.name||'Inspect the pinned objective in the receipt.'));const pair=el('div',undefined,'pair'),before=el('div'),after=el('div');before.append(el('h3','Historical observation'));
if(control?.historicalRows?.length){for(const row of control.historicalRows){before.append(el('pre',pretty(row.rawRow)),el('p','Foreign source IDs in that historical row: '+((row.foreignSourceIds||[]).join(', ')||'None')+'.','caption'));const captures=outlineRuns.flatMap(run=>run.receipt.captures||[]).filter(cap=>cap.file===row.transcript);if(captures.length){const io=el('details');io.append(el('summary','Exact historical model input and raw output'));appendCaptures(io,captures);before.append(io);}}}else before.append(el('p','Labelled synthetic negative: no historical model observation is claimed. Its changed objective wording tests whether unchanged source material is incorrectly accepted.','empty'));
after.append(el('h3','Actual v2 observation'),el('pre',pretty(outcome.rawParsed||outcome)),el('p','Schema valid: '+String(outcome.schemaValid)+' · engineering expected-source check: '+(outcome.expectedSourceCheck===null?'No forced label':String(outcome.expectedSourceCheck))+'.','caption'));const io=el('details');io.append(el('summary','Exact v2 request and raw visible output'));appendCaptures(io,(r.captures||[]).filter(cap=>cap.file?.includes('-'+outcome.id+'--')));after.append(io);pair.append(before,after);comparison.append(pair,details('Pinned original sections, control binding and comparison limits',pretty(control)));group.append(comparison);}
group.append(details('All exact review-only inputs and raw outputs',pretty(r.captures)),details('Complete immutable probe controls',pretty(c)),details('Exact terminal probe receipt and usage',pretty(r)));box.append(group);}
const later=D.laterPhases||{},outlinePhase=later.outlineV2||{},heldoutPhase=later.heldout||{},outlineLive=outlinePhase.result?.receipt,heldoutAggregate=heldoutPhase.aggregate?.receipt,heldoutShards=(heldoutPhase.shards||[]).filter(Boolean),heldoutCells=new Map();
for(const row of heldoutAggregate?.cells||[])heldoutCells.set(row.schedule.id,row);
for(const shard of heldoutShards)for(const row of shard.receipt.cells||[])heldoutCells.set(row.schedule.id,row);
const phaseCellRows=[...heldoutCells.values()],recordedCells=phaseCellRows.filter(row=>row.status!=='not-recorded'),heldoutUsageRows=heldoutShards.map(row=>row.receipt.usage).filter(Boolean);
function heldoutOutcome(cell){const captures=(cell.captures||[]).map(row=>row.transcript).filter(Boolean),reviews=captures.filter(row=>row.stage==='quality-review');if(cell.status==='generation-failed')return 'generation-transport-failed';if(cell.status==='invalid-candidate')return 'invalid-candidate';if(reviews.some(row=>row.status==='failed')&&!reviews.some(row=>row.status==='succeeded'))return 'review-unavailable';if(cell.eligibleBeforeRepair===true)return 'lab-eligible';if(reviews.some(row=>row.status==='succeeded')&&cell.eligibleBeforeRepair===false)return 'reviewed-not-eligible';return cell.status==='not-recorded'?'not-recorded':'unavailable';}
function heldoutLabel(cell){const state=heldoutOutcome(cell);return state==='review-unavailable'?'Assessment unavailable: review transport failed; stored false is not a semantic refusal':state==='generation-transport-failed'?'No candidate: generation connection failed':state==='invalid-candidate'?'Invalid candidate/role contract; not a semantic refusal':state==='lab-eligible'?'Lab eligible; requested-task fulfillment remains separate':state==='reviewed-not-eligible'?'Reviewed but not lab-eligible; inspect deterministic and model findings':'Not yet available';}

if(outlineLive||heldoutShards.length){const row=el('div',undefined,'progress');row.id='new-phase-overview';row.append(el('b','New experiment phases'),el('span','Cache-assisted full v2 outline: '+(outlineLive?.status||'no receipt')+'. Held-out comparison: '+heldoutShards.length+' shard receipts loaded; transport failures and unknown usage remain explicit. Public HTTP/Agenda partial outcomes have their own section and ledger.'));document.getElementById('overview').append(row);}
if(outlineLive){
const cache=outlinePhase.cacheObservation?.receipt?.run?.structureDiagnostics||{},orgEvents=(outlineLive.events||[]).filter(row=>row.stage==='outline-organization'&&row.phase==='output'&&row.output?.themes),org=orgEvents.at(-1)?.output?.themes||[],returned=outlineLive.result?.themes||[],terminal=!String(outlineLive.status).startsWith('running'),grounding=outlineLive.diagnosticRun?.structureDiagnostics?.outlineGrounding||outlineLive.result?.coverage?.outlineGrounding,box=el('div');box.id='outline-v2-progress';
box.append(el('h3','Full v2 outline phase — '+outlineLive.status+' snapshot'),el('p','This separately declared cache-assisted run reuses '+fmt(cache.cache?.reusedSections)+' validated extraction sections / '+fmt(cache.cache?.extractedSections)+' fresh sections, plus '+fmt(cache.synthesisInput?.reusedPacks)+' organization packs / '+fmt(cache.synthesisInput?.newPacks)+' fresh packs. Fresh final organization and original-source review consume their own paid calls.'),el('p','Latest retained organization output proposes '+fmt(org.length)+' Topics / '+fmt(org.reduce((n,topic)=>n+(topic.los||[]).length,0))+' LOs. '+(terminal&&outlineLive.error?'This attempt stopped; the proposal is not a completed or applicable outline.':terminal?'Inspect the terminal result and review receipt below before treating any proposal as applicable.':'The full original-source review is still running. These proposed labels are not a completed or applicable outline.'),'notice'),el('p','Returned final Topics: '+fmt(returned.length)+'. Recorded run '+outlineLive.runId+'; elapsed '+seconds(outlineLive.elapsedMs)+'. Observed sends: '+fmt(outlineLive.usage?.observedCalls)+'; reported input/output: '+fmt(outlineLive.usage?.inputTokens)+' / '+fmt(outlineLive.usage?.outputTokens)+' tokens ('+(outlineLive.usage?.status||'unknown')+' usage). Pending/rejected native sends: '+fmt(outlineLive.budget?.pendingSends)+' / '+fmt(outlineLive.budget?.rejectedSends)+'. Saved/adopted: '+String(outlineLive.saved)+' / '+String(outlineLive.adopted)+'. This is a warm/cache-assisted phase, not a successful repeat of the earlier failed cold run.'));
if(grounding)box.append(el('p','Durable final-wording reviews retained: '+fmt(grounding.reviewedObjectives)+' / '+fmt(grounding.totalObjectives)+'; '+fmt(grounding.supportedObjectives)+' source-supported and '+fmt(grounding.withheldObjectives)+' withheld. Complete: '+String(grounding.complete)+'. These are model judgments and partial diagnostics, not professor-approved or applied LOs.'),details('Exact terminal or partial final-wording review receipt',pretty(grounding)));
if(outlineLive.error?.message==='structure-grounding-review-coverage')box.append(el('h3','Why L96 stopped this whole attempt'),el('p','The initial positive review credited E603 without citing its required original S361. That positive coverage failure must remain rejected. The bounded correction changed L96 to unsupported but still listed E603 without S361; the old validator rejected irrelevant coverage bookkeeping on an already negative row and stopped the remaining outline. The recorded source verdict itself is not endorsed as teacher truth.','notice'),el('p','The later minimal repair keeps every positive source, identity and point-to-original requirement strict. Fresh v2 negative/uncertain findings receive zero canonical covered points; known raw model claims may remain in a server-computed, non-authoritative diagnostic. Invalid positive coverage still receives the exact E603 → S361 correction instruction. No source expansion or forced positive decision is authorized.'));
if(outlineLive.error?.message==='structure-grounding-review-coverage'){
const comparison=el('details');comparison.append(el('summary','Exact L96 responses before the terminal stop'));const pair=el('div',undefined,'pair');for(const [status,label] of [['supported','Initial positive response — required source omitted'],['unsupported','Bounded correction — negative verdict, stale coverage claims']]){const panel=el('div');panel.append(el('h3',label));const captures=(outlineLive.captures||[]).filter(cap=>(cap.transcript?.parsed?.reviews||[]).some(row=>row.id==='L96'&&row.sourceStatus===status));for(const cap of captures){const row=cap.transcript.parsed.reviews.find(row=>row.id==='L96');panel.append(el('pre',pretty(row)));const raw=el('details');raw.append(el('summary','Exact actual model input, raw output and provider events'));appendCaptures(raw,[cap]);panel.append(raw);}pair.append(panel)}comparison.append(pair,el('p','These are the actual terminal-run responses. The positive coverage defect remains invalid under the new validator. Retaining a corrected negative row cannot itself admit L96 or credit E603.','caption'));box.append(comparison);
const note=el('p'),link=el('a','Read the minimal negative-coverage repair and remaining verification scope');link.href='../../docs/design/question-generation-quality/NEGATIVE-OUTLINE-COVERAGE-2026-10-16.md';note.append(link);box.append(note);
}
box.append(details('Pinned read-only cache progress checkpoint',pretty(outlinePhase.cacheObservation)));const io=el('details');io.append(el('summary','Every currently captured v2 outline input and raw output'));appendCaptures(io,outlineLive.captures);box.append(io,details('Full current v2 outline snapshot, declaration and file hashes',pretty(outlinePhase)),el('p',later.snapshotPolicy,'caption'));document.getElementById('phase-two-outline').append(box);}
if(outlinePhase.negativeCoverageReplay){
const pin=outlinePhase.negativeCoverageReplay,replay=pin.receipt,before=replay.beforeFrozenValidator||{},after=replay.afterCurrentValidator||{},negative=after.correction?.findings?.find(row=>row.id==='L96'),combined=after.combinedBatch||{},box=el('div');box.id='negative-coverage-replay';box.append(el('h3','Offline negative-coverage repair — the whole run remains stopped'),el('p','The exact retained L96 rows were replayed against the frozen and repaired validators. The initial positive claim still fails because E603 requires S361. The corrected unsupported row is now retained as negative, with '+fmt(negative?.coveredEvidenceIds?.length)+' canonical covered points and '+fmt(negative?.ignoredModelCoverage?.evidenceIds?.length)+' raw model IDs in a server-computed, non-authoritative diagnostic. Seven historical sibling findings remain unchanged.','notice'),evidenceTable('Exact offline validator before/after',['Retained response / control','Frozen validator','Repaired validator','Meaning'],[['Initial positive response',fmt(before.initial?.failures?.length)+' failure',fmt(after.initial?.failures?.length)+' failure; E603 → S361','Missing positive point-to-original proof remains rejected.'],['Actual corrected unsupported response',fmt(before.correction?.failures?.length)+' failure',fmt(after.correction?.failures?.length)+' failures; negative retained','Negative coverage claims receive no canonical coverage credit.'],['Combined exact batch','Historical terminal run unchanged',fmt(combined.supportedObjectives)+' supported / '+fmt(combined.withheldObjectives)+' withheld in the offline batch','Seven siblings unchanged: '+String(combined.allSevenHistoricalSiblingsUnchanged)+'. This is not a new durable whole-run result.'],['File-only positive citation control','Original positive still invalid','Adding only S361 passes reference validation','This changes citation accounting, not the model verdict or a fresh semantic review.']]),el('p','Provider/API calls: '+fmt(replay.actions?.providerCalls)+' / '+fmt(replay.actions?.apiCalls)+'. Database reads/writes: '+fmt(replay.actions?.databaseReads)+' / '+fmt(replay.actions?.databaseWrites)+'. Historical result, declaration and ledger were not rewritten. The original 102/142 durable review receipt, 20 paid calls and stopped result remain intact. No LO was applied and no question was saved or adopted.'));
const pair=el('div',undefined,'pair'),old=el('div'),current=el('div');old.append(el('h3','Frozen negative-row failure'),el('pre',pretty(before.correction)));current.append(el('h3','Repaired negative row — zero credited coverage'),el('pre',pretty(after.correction)));pair.append(old,current);const raw=el('details');raw.append(el('summary','Exact frozen/repaired row findings and positive counterexample'),pair,details('Initial positive failure and precise source requirement',pretty(after.initial)),details('File-only positive citation counterexample — not semantic acceptance',pretty(after.positiveGateCounterexample)));box.append(raw,details('Pinned original E603/S361 relationship and exact raw model responses',pretty(replay.retainedInputs)),details('Full immutable offline replay, code hashes, tests and limitations',pretty(pin)));document.getElementById('phase-two-outline').append(box);
const verification=el('div'),v=replay.verification||{};verification.append(el('h3','Focused checkpoint — negative-coverage normalization'),el('p','Grounding unit tests: '+fmt(v.groundingUnitTests?.passed)+' / '+fmt(v.groundingUnitTests?.total)+'. Structure-generation service integration tests: '+fmt(v.structureGenerationServiceIntegrationTests?.passed)+' / '+fmt(v.structureGenerationServiceIntegrationTests?.total)+'. Scoped ESLint: '+v.scopedEslint+'; strict TypeScript: '+v.strictTypeScript+'. These focused suites overlap the earlier full-suite checkpoint; counts are not added. The full 2,727-test receipt predates this normalization.'),el('p','This offline replay verifies reference accounting, strict positive rejection and negative withholding. It does not repeat model judgment or prove that all 142 objectives finish review, that remaining LOs are correct, or that public saved-question yield improves. A new prospectively frozen paid whole run is required.','notice'),details('Exact focused verification and original replay scope',pretty({verification:v,scope:replay.scope,actions:replay.actions,limitations:replay.limitations})));document.getElementById('phase-two-verification').append(verification);}
if(heldoutAggregate||heldoutShards.length){const box=el('div');box.id='heldout-progress';const decl=heldoutPhase.declaration?.receipt||{},expected=heldoutAggregate?.requestedSlots||decl.shardCount*decl.shardSize,generated=recordedCells.filter(row=>row.normalizedCandidate).length,reviewed=recordedCells.filter(row=>['lab-eligible','reviewed-not-eligible'].includes(heldoutOutcome(row))).length,unrecorded=phaseCellRows.filter(row=>row.status==='not-recorded').length,terminalShards=heldoutShards.filter(row=>row.receipt.status!=='running').length,count=state=>phaseCellRows.filter(row=>heldoutOutcome(row)===state).length;box.append(el('h3','Held-out 60-cell execution — transport-limited comparison'),el('p','Declared '+fmt(expected)+' cells across six source-disjoint cases, five generator configurations and two repetitions. '+fmt(terminalShards)+' / '+fmt(decl.shardCount)+' shards are terminal. '+fmt(generated)+' normalized candidates were retained; '+fmt(reviewed)+' cells received a completed assessment and '+fmt(count('lab-eligible'))+' have recorded lab eligibility. These counts are not saved-question or professor-acceptance rates.'),el('p',fmt(count('generation-transport-failed'))+' cells failed during generation connections; '+fmt(count('review-unavailable'))+' generated candidates lost review to transport failures. These 30 transport failures are not semantic refusals. Stored eligibleBeforeRepair=false on a failed review is displayed as unavailable here, while the original raw record remains intact.','notice'),evidenceTable('All scheduled held-out outcomes',['Outcome','Scheduled-cell count','Interpretation'],[['Recorded lab eligibility',count('lab-eligible'),'Source/task fulfillment still needs the independent checks below.'],['Reviewed but not lab-eligible',count('reviewed-not-eligible'),'Inspect actual deterministic/schema/model findings; not a single semantic-failure category.'],['Review unavailable',count('review-unavailable'),'Generated candidate; review connection failed.'],['Generation transport failure',count('generation-transport-failed'),'No candidate from the failed connection.'],['Invalid candidate/roles',count('invalid-candidate'),'The chart fallback parsed as JSON but failed its option-role contract.'],['Not recorded',unrecorded,'Missing records are unknown, never zero dispatch.']]),el('p','Execution is terminal, but a transport outage confounds the second repetition. Thirty missing generation/review observations prevent a complete quality comparison. Known usage is a subtotal; failed-call usage and hidden physical retries remain unknown. No general model ranking follows from this run.','notice'),evidenceTable('Terminal held-out shard observations',['Shard','Status','Normalized candidates','Completed assessments','Observed SDK calls','Usage completeness'],heldoutShards.map(row=>[row.path.split('/').at(-2),row.receipt.status,(row.receipt.cells||[]).filter(cell=>cell.normalizedCandidate).length,(row.receipt.cells||[]).filter(cell=>['lab-eligible','reviewed-not-eligible'].includes(heldoutOutcome(cell))).length,fmt(row.receipt.usage?.observedCalls),row.receipt.usage?.status||'unknown'])),evidenceTable('Per-arm coverage without a model ranking',['Configuration','Scheduled cells','Normalized candidates','Completed assessments','Lab eligible','Transport-unavailable cells'],['luna-low','luna-medium','luna-high','sol-medium','sol-high'].map(arm=>{const rows=phaseCellRows.filter(row=>row.schedule.arm.id===arm);return[arm,rows.length,rows.filter(row=>row.normalizedCandidate).length,rows.filter(row=>['lab-eligible','reviewed-not-eligible'].includes(heldoutOutcome(row))).length,rows.filter(row=>heldoutOutcome(row)==='lab-eligible').length,rows.filter(row=>['generation-transport-failed','review-unavailable'].includes(heldoutOutcome(row))).length]})),el('p','The fixed reviewer is Sol 6.1 medium, which introduces judge-family bias. The held-out chapters were not used in question tuning, but were available to source/outline experiments. These are not pretraining-held-out sources or professor-labelled gold. Saved/adopted questions remain separate from lab eligibility.'));
if(heldoutPhase.depreciationAudit){const pinned=heldoutPhase.depreciationAudit,a=pinned.receipt,n=a.summary||{};box.append(el('h3','Independent numerical audit — first case, first repetition only'),el('p',fmt(n.candidates)+' retained depreciation candidates across the five arms passed '+fmt(n.arithmeticAndDisplayPassingDraws)+' / '+fmt(n.exhaustiveDraws)+' exhaustive parameter combinations: '+fmt(n.computedAnswerMismatchDraws)+' computed-answer mismatches, '+fmt(n.collisionDraws)+' displayed collisions and '+fmt(n.displayedInputFailureDraws)+' visible-input failures. The independent reference uses exact decimal rational arithmetic; formula execution uses the closed evaluator, not model-authored JavaScript.'),el('p','Numerical correctness is conditional on the depreciation being tax deductible. The low/high Luna stems omit that explicit phrase, and the three Luna stems do not explicitly request nearest-cent rounding. These are agent-derived clarity/premise review questions; context may supply assumptions. They are not proven teacher false positives or blanket model failures. High Luna also has a recorded uniform-option-format failure and a separate model reviewer finding. One case cannot establish a model ranking.','notice'),details('Exact immutable five-arm candidate/grid audit, source coordinates and scope limits',pretty(pinned)));}
if(heldoutPhase.notationChartAudit){const pin=heldoutPhase.notationChartAudit,a=pin.receipt,n=a.summary||{},chart=n.chartNegative||{},valuation=n.valuation||{},audit=el('div');audit.id='notation-chart-audit';audit.append(el('h3','Independent r1 source audit — safe fallback is not numerical supply'),el('p','Charts: '+fmt(chart.honestLimitationCandidates)+' / '+fmt(chart.cells)+' candidates honestly acknowledge missing point values, '+fmt(chart.fabricated1989PointCandidates)+' fabricate a 1989 amount, and '+fmt(chart.requestedNumericalTasksFulfilled)+' / '+fmt(chart.cells)+' fulfill the requested numerical task. Four conceptual alternatives are judge-eligible; one has an invalid option-role contract.','notice'),el('p','No fabricated chart answer was produced in this slice. Therefore this result does not demonstrate that the reviewer would detect fabricated chart numbers. A safe conceptual fallback, requested numerical fulfillment, schema validity and judge eligibility are separate outcomes.'),el('p','Valuation: '+fmt(valuation.notationAndOwnershipSupported)+' / '+fmt(valuation.cells)+' retain the source ownership and notation rules: equity cash flows after debt payments use ke; firm cash flows before debt payments use WACC. All five are judge-eligible. Luna low and high achieve easy despite the medium request, and their scenario novelty remains borderline under independent reading. This is not professor calibration or a general ranking.'),evidenceTable('Exact ten-cell r1 notation/chart audit',['Configuration / task','Role contract','Native judge','Requested / achieved','Independent reading'],(a.cells||[]).map(row=>[row.arm.id+' / '+(row.caseId.includes('chart')?'Chart':'Valuation'),row.schema.optionRoleContractValid?'Valid':'Invalid',row.productionJudge.eligibleBeforeRepair===true?'Eligible':row.productionJudge.eligibleBeforeRepair===false?'Not eligible':'Not reviewed',row.requestedVsAchieved.requestedDifficulty+' / '+(row.requestedVsAchieved.judgeAchievedDifficulty||'unavailable'),row.independentRubric.sourceJudgment||row.independentRubric.generatorBehavior])),el('p','Only terminal shard 3, two tasks and repetition 1 are audited here. No product quota logic or source-gap workflow was changed by the audit; professor acceptance and live saved yield remain unknown.'));
const link=el('a','Read the independent source/notation rubric and product implications');link.href='../../docs/design/question-generation-quality/HELDOUT-SOURCE-RUBRIC-AUDIT-2026-10-16.md';audit.append(link,details('Exact source bindings, candidate outputs, native judgments and independent rubric',pretty(pin)));box.append(audit);}
if((heldoutPhase.analyses||[]).length){const pin=heldoutPhase.analyses.at(-1),report=pin.receipt,n=report.summary||{},calls=n.allObservedSdkCalls||{};box.append(el('h3','Independent terminal analyzer — keep the denominators separate'),evidenceTable('Terminal analyzer dimensions across all 60 scheduled cells',['Dimension','Observed result','Unavailable / separate scope'],[['Generator JSON parsed',fmt(n.generationParsed?.true)+' / '+fmt(n.declaredCells),fmt(n.generationParsed?.false)+' failed connections'],['Schema-retained candidates',fmt(n.schemaRetained?.true)+' / '+fmt(n.declaredCells),fmt(n.schemaRetained?.false)+' invalid role contract; '+fmt(n.schemaRetained?.unknown)+' unavailable'],['Completed semantic assessments',fmt(n.qualityStates?.assessed)+' / '+fmt(n.declaredCells),fmt(n.qualityStates?.['transport-unavailable'])+' review transport failures; other unavailable candidates are not semantic rejections'],['Recorded lab eligibility',fmt(n.combinedLabEligible?.true)+' / '+fmt(n.declaredCells),'Lab eligibility is not professor acceptance, saved yield or requested-kind fulfillment.'],['Requested kind fulfilled',fmt(n.requestedKindFulfilled?.true)+' true / '+fmt(n.requestedKindFulfilled?.false)+' false',fmt(n.requestedKindFulfilled?.unknown)+' unknown; the five chart fallbacks do not fulfill numerical requests'],['Requested difficulty matched',fmt(n.requestedDifficultyMatched?.true)+' matched / '+fmt(n.requestedDifficultyMatched?.false)+' mismatched',fmt(n.requestedDifficultyMatched?.unknown)+' unavailable; model-assessed, not professor calibrated']]),el('p','Observed SDK sends: '+fmt(calls.actualObservedSends)+'; '+fmt(calls.knownUsageCalls)+' report known usage and '+fmt(calls.unknownUsageCalls)+' have unknown usage. Known subtotal: '+fmt(calls.inputTokensKnownSum)+' input + '+fmt(calls.outputTokensKnownSum)+' output tokens. Null failed-call usage is not zero cost. Call-duration sums are not parallel user-facing wall time.','notice'),details('Exact terminal analyzer, per-arm/cell evidence, paired comparability and immutable controls',pretty(pin)));}

const examples=el('details');examples.append(el('summary','Per-cell source controls, candidates, assessments and exact visible I/O'));for(const cell of recordedCells){const row=el('details');row.append(el('summary',cell.schedule.id+' · '+cell.status),el('p',heldoutLabel(cell)+' · teacher acceptance: unknown · saved/adopted: false.'),details('Exact candidate and available assessments',pretty(cell)));appendCaptures(row,cell.captures);examples.append(row)}box.append(examples,details('Aggregate snapshot, fresher shard receipts, declaration and hashes',pretty(heldoutPhase)),el('p',later.snapshotPolicy,'caption'));document.getElementById('models').append(box);}
if(outlineLive||heldoutShards.length){const box=el('div');box.id='later-phase-cost';box.append(el('h3','New phases — separate prospective ledgers and partial usage'),el('p','These budgets do not reset, replace or combine the finalized Phase 2 ledger. Every receipt is a build-time observation; reservations and provider usage are different measures. Missing receipts or usage stay unknown.'));
for(const [name,phase,receipts] of [['Full cache-assisted v2 outline',outlinePhase,outlineLive?.usage?[outlineLive.usage]:[]],['Held-out five-configuration comparison',heldoutPhase,heldoutUsageRows]]){const ledger=phase.ledger?.receipt;if(!ledger)continue;const sum=key=>receipts.reduce((n,row)=>n+(Number.isSafeInteger(row[key])?row[key]:0),0),hasCounts=receipts.some(row=>Number.isSafeInteger(row.inputTokens)&&Number.isSafeInteger(row.outputTokens)),missing=receipts.filter(row=>!Number.isSafeInteger(row.inputTokens)||!Number.isSafeInteger(row.outputTokens)).length;box.append(el('h3',name),el('p',fmt(ledger.reservedSends)+' / '+fmt(ledger.limits?.maxSends)+' reserved sends · '+fmt(ledger.conservativeTokens)+' / '+fmt(ledger.limits?.maxConservativeTokens)+' conservative reservation units. Scope: '+ledger.scope+'.'),el('p',hasCounts?'Known reported subtotal: '+fmt(sum('inputTokens'))+' input + '+fmt(sum('outputTokens'))+' output tokens across '+fmt(sum('observedCalls'))+' recorded SDK invocations; '+fmt(sum('unknownCalls'))+' calls have unknown usage and '+fmt(missing)+' receipts lack numeric subtotals. These listed receipts may still be incomplete; their subtotals are not billed totals.':'No numeric provider subtotal is present. Missing usage or unrecorded dispatch is not zero.'),details('This phase declaration, ledger and per-file hashes',pretty({declaration:phase.declaration,ledger:phase.ledger})));}box.append(el('p','Do not sum conservative reservations into input/output tokens or infer a complete experiment from budget headroom. Hidden retries, money spent, professor acceptance and public saved-question yield remain separate.','notice'));document.getElementById('cost').append(box);}
const publicData=D.publicHttp||{},publicAttempts=publicData.attempts||[];
if(publicData.diagnostics||publicAttempts.length){const box=el('div');box.id='public-http-acceptance';box.append(el('h3','Actual public HTTP + Agenda acceptance — partial outcomes'),el('p','This uses actual public authoring routes, course guards, owned Mongo courses and the local Agenda worker. Its test request identity is synthetic; it does not prove SAML behavior. Saved Drafts, candidate eligibility, unknown outcomes and startup guards have separate denominators.'));
if(publicData.diagnostics){const d=publicData.diagnostics.receipt,rows=(d.attempts||[]).map(row=>[row.directory.split('/').at(-1),row.terminalStatus,row.error?.message||'Inspect receipt',fmt(row.attemptReservations),'No completed question-quality outcome']);if(d.bootstrapFailure)rows.push(['direct-live bootstrap','stopped',d.bootstrapFailure.cause,'0','No owned course or question-quality outcome']);box.append(el('h3','Three preserved startup stops — no model experiment completed'),evidenceTable('Public-pipeline startup guards',['Owned attempt','State','Recorded cause','Model reservations','Interpretation'],rows),el('p','These stops occurred at the old owned-database active-work guard, the replica-discovery port fence, and fixture bootstrap order. Their ledgers and original results remain retained. A corrected test bootstrap is not evidence that generation quality improved.'),details('Exact isolation diagnostics and scoped bootstrap explanation',pretty(publicData.diagnostics)));}
for(const attempt of publicAttempts){const r=attempt.result.receipt,stop=attempt.operatorStop?.receipt,decl=attempt.declaration?.receipt||{},ledger=attempt.ledger?.receipt,observations=r.observations||[],sub=el('div');if(!observations.length&&!stop)continue;sub.id='public-attempt-'+attempt.name;sub.append(el('h3',attempt.name+' — '+(stop?.status||r.status)),el('p','Last runtime receipt: '+r.status+'; authoritative stop receipt: '+(stop?.status||'not present')+'. These are separate records. The original runtime result is not rewritten to manufacture a terminal provider response.'));
if(stop)sub.append(el('p','The owned process exited '+stop.process?.terminalExitCode+' and its absence was verified. Its durable run changed '+stop.runBefore?.status+' → '+stop.runAfter?.status+'; only '+fmt(stop.disabledCount)+' owned Agenda job was disabled. '+stop.providerUsage+'. Final provider outcome: '+stop.finalProviderOutcome+'. Reconciliation made '+fmt(stop.newProviderCalls)+' new provider calls.','notice'));
const publicRows=(decl.publicCases||[]).map(trial=>{const o=observations.find(row=>row.id===trial.id);return[trial.id,trial.count,o?.status==='terminal'?'Completed first-case observation':o?'Interrupted / unresolved':'Unobserved',o?.supply?fmt(o.supply.saved)+' / '+fmt(o.supply.requested):'Unknown',o?.supply?fmt(o.supply.missing)+' documented missing slots':'No completed result; not zero supply']});const regenRows=(decl.regenerationCases||[]).map(trial=>{const o=observations.find(row=>row.id==='regeneration-'+trial.intent);return[trial.intent,o?.status||'Unobserved',o&&typeof o.adopted==='number'?fmt(o.adopted):'Unknown']});sub.append(evidenceTable('Declared public-generation case denominators',['Declared case','Requested questions','Observed state','Saved Drafts / requested','Shortfall / uncertainty'],publicRows),evidenceTable('Declared regeneration intents',['Intent','Observed state','Adopted versions'],regenRows));
if(stop)sub.append(el('p','Observed saved Drafts: '+fmt(stop.observedSavedDrafts)+' across '+fmt(stop.requestedQuestionSlots)+' scheduled public question slots. Only the first case completed with 1 / 3 saved and 2 missing. The CAPM case was interrupted, the final public case was unstarted, and all three regeneration intents remain unobserved. This is not a completed 1/6 batch yield and is not evidence of improvement over the historical full 1/6 run.','notice'));
for(const o of observations){const detail=el('details');detail.append(el('summary',o.id+' — exact user input, durable outcome and retained candidate'));detail.append(el('h3','Exact public authoring request'),el('pre',pretty(o.input)));for(const v of o.versions||[])detail.append(questionPanel('Actual saved Draft — '+v._id,v));detail.append(details('Complete HTTP/Agenda, export, usage and source-memory observation',pretty(o)));sub.append(detail);}
const captures=el('details');captures.append(el('summary','Every retained public model input, visible output and incomplete response'));for(const pin of attempt.captures||[]){const c=pin.receipt,item=el('details');item.append(el('summary',c.caseId+' · '+c.state+' · '+c.id),el('p','Exact actual facade arguments and model options'),el('pre',pretty(c.actualArguments)),el('p','Raw visible response / incomplete stream'),el('pre',c.rawResponse?pretty(c.rawResponse):c.cumulativeVisibleText?'Partial visible stream only: '+c.cumulativeVisibleText:'No completed provider response captured. Final output and usage are unknown.'),details('Immutable capture, admission, transport and raw response metadata',pretty(pin)));captures.append(item)}sub.append(captures,details('Original runtime result, native receipt links, operator-stop reconciliation and hashes',pretty(attempt)),el('p',r.comparison||'No causal old/new comparison is established.','caption'));box.append(sub);
const cost=el('div'),u=r.phaseUsage||{};cost.id='public-http-cost';cost.append(el('h3','Public HTTP/Agenda phase — separate ledger and partial native usage'),el('p',fmt(ledger?.attemptReservations)+' / '+fmt(ledger?.limits?.maxSends)+' phase reservations · '+fmt(ledger?.conservativeUnits)+' / '+fmt(ledger?.limits?.maxConservativeTokens)+' conservative units. Native receipts record '+fmt(u.actualObservedSends)+' observed sends and '+fmt(u.recordedFinishedCalls)+' finished calls. Facade reservations and captures alone are not dispatch proof.'),el('p','Known reported subtotal: '+fmt(u.reportedInputTokens)+' input + '+fmt(u.reportedOutputTokens)+' output tokens from '+fmt(u.inputKnownCalls)+' input-known / '+fmt(u.outputKnownCalls)+' output-known calls. Interrupted or unlinked call usage remains unknown; this is not complete billed cost.','notice'),details('Public declaration, unchanged ledger and native-count completeness',pretty({declaration:attempt.declaration,ledger:attempt.ledger,phaseUsage:u,receiptBindings:r.receiptBindings,stop:attempt.operatorStop})));document.getElementById('cost').append(cost);
}
box.append(el('p','Paid acceptance after the streaming-timeout change is not established by these interrupted historical receipts.'),el('p',publicData.policy,'caption'));document.getElementById('validation').append(box);}
if(D.transportDeadlineVerification){const pin=D.transportDeadlineVerification,v=pin.receipt,box=el('div');box.id='transport-deadline-verification';box.append(el('h3','Offline stability repair — one deadline includes the stream body'),el('p','The installed SDK timeout can finish when headers arrive while its SSE iterator still waits for a later chunk. The new completion deadline shares one AbortController across headers and iterator steps; chunks do not renew the deadline. The default is 180,000 ms and no extra retry is introduced.'),el('p','Recorded offline tests: '+fmt(v.numPassedTests)+' / '+fmt(v.numTotalTests)+' across '+fmt(v.numPassedTestSuites)+' suites. Fault cases include no headers, stalled streams, late responses, stuck cleanup, unknown usage, retained reservations and no JSON-correction retry on transport timeout. The final checkpoint adds two delayed-timer edge cases: the deadline is checked on settlement even if the event-loop timer callback has not run. An installed-SDK test uses an intercepted synthetic fetch stream; no paid provider request is made.','checks'),el('p','This proves bounded waiting under tested faults, not a recovered provider service, better generated content, a completed public batch or reduced professor review time. The prior interrupted call retains unknown usage and an unobserved provider outcome. The old 2,727-test checkpoint and initial 83-test deadline receipt remain historical; these focused counts are not added together.','notice'));
const link=el('a','Read the transport deadline implementation, scope and remaining acceptance');link.href='../../docs/design/question-generation-quality/TRANSPORT-DEADLINE-2026-10-17.md';box.append(link,details('Final five-suite offline verification receipt and file hash',pretty(pin)),details('Historical 83-test deadline receipt before delayed-timer edge cases',pretty(D.transportDeadlineHistoricalVerification)));document.getElementById('phase-two-verification').append(box);}
if(D.semanticRepairVerification){const pin=D.semanticRepairVerification,v=pin.receipt,box=el('div');box.id='semantic-repair-verification';box.append(el('h3','Offline semantic safeguards — teacher requirements remain binding'),el('p','Recorded semantic-repair checks: '+fmt(v.numPassedTests)+' / '+fmt(v.numTotalTests)+' across '+fmt(v.numPassedTestSuites)+' suites. A duplicate-task replacement may retire only the exact first server-marked planned-inference row; teacher instructions and preserved invariants remain active. An ordinary correction of the same task retains the planned inference.'),el('p','A contradictory duplicate/variant verdict receives explicit instructions to reconcile novelty with the actual inference and solution-path comparisons. Code does not flip the verdict to independent, erase a genuine match or waive uncertain source support. A repaired candidate must pass its source, notation, intent, role, numerical and content checks afresh.','checks'),el('p','These engineering checks overlap earlier suites. They establish the tested guard behavior, not semantic calibration, professor acceptance, a completed public generation batch or general saved-question yield.','notice'),details('Exact six-suite semantic-repair test receipt and hash',pretty(pin)));document.getElementById('phase-two-verification').append(box);}
const yieldProbe=D.retainedYieldProbe||{},yieldResult=yieldProbe.result?.receipt,yieldControls=yieldProbe.controls?.receipt;
if(yieldResult&&yieldControls){
  const box=el('div');box.id='retained-yield-probe';
  box.append(el('h3','Retained-candidate review probe — one inconsistency resolved, no Drafts saved'),el('p','Status: '+yieldResult.status+'. Root confirmed the owned process exited 0. This prospectively bounded experiment reused two exact historical candidates, the original source packet and the same frozen seed-only Bank. Three historical prompts and two source PDF hashes were verified before any paid review; there was no new generation, adoption or database write.'),el('p','The model and native request contract stayed gpt-6-luna / effort none, temperature 0 and a 2,000-token quality-output cap. The phase allowed at most four observed native sends, 24k conservative input per send, a 6k output ceiling and 120k conservative total; the existing three-minute transport deadline remained active.'));
  const rows=(yieldControls.cases||[]).map(c=>{const o=(yieldResult.outcomes||[]).find(row=>row.id===c.id),a=o?.assessment;return[c.id,c.id.startsWith('A-')?'Withheld: variant verdict contradicted false/false Bank comparison':'Withheld: replacement still required obsolete server-planned inference',a?.status||'Unobserved',a?a.sourceSupport+' / '+a.notation+' / '+a.novelty:'Unknown',a?.reasons?.join(' ')||'No completed assessment'];});
  box.append(evidenceTable('Same retained candidates, explicit before and after review findings',['Case','Historical finding','Fresh review status','Source / notation / novelty','Fresh recorded reason'],rows),el('p','A: the first historical raw response was replayed without a provider send; only the new explicit contradiction correction was sent. The source remained supported and notation consistent, and the fresh response classified the necessary task as independent. B: the obsolete automatic task row was removed while the complete teacher instruction stayed active. Its fresh response remained withheld: the judge marked the Bank comparison true/true, novelty variant and the teacher novelty requirement unfulfilled. No result was forced into acceptance.','notice'));
  for(const c of yieldControls.cases||[]){const o=(yieldResult.outcomes||[]).find(row=>row.id===c.id),detail=el('details');detail.append(el('summary',c.id+' — exact unchanged candidate, requirements and review I/O'),questionPanel('Retained candidate — no new question generated',c.candidate),details('Exact retained source packet, frozen Bank and active teacher requirements',pretty({packet:c.packet,memory:c.memory,requirements:c.requirements})),details('Historical raw first review and recorded input',pretty(c.retained)),details('Fresh result for the same candidate',pretty(o||null)));for(const pin of yieldProbe.captures||[]){const capture=pin.receipt;if(capture.caseId!==c.id)continue;detail.append(el('h3','Exact new paid input and native options'),el('pre',pretty(capture.actualArguments)),el('h3','Raw new visible response'),el('pre',capture.rawResponse?pretty(capture.rawResponse):'No completed response; output remains unknown.'),details('Pinned complete native capture',pretty(pin)));}box.append(detail);}
  box.append(el('p','Saved Drafts: 0. Adopted versions: 0. Teacher acceptance: unknown. Two individually eligible reviews would not establish two mutually independent saved slots: A and B may duplicate each other, and this frozen Bank excludes later batch candidates. Current Bank/batch novelty must be checked before any adoption. The actual result here is one eligible and one withheld review, not a new full-pipeline saved yield.','notice'),details('File-only replay of every historical raw response, replacement plan, declaration, execution claim and hashes',pretty(yieldProbe)));
  document.getElementById('validation').append(box);
  const cost=el('div'),u=yieldResult.usage||{},b=yieldResult.budget||{},ledger=yieldProbe.ledger?.receipt;cost.id='retained-yield-cost';
  cost.append(el('h3','Retained review-only phase — two sends with reported usage'),el('p',fmt(u.observedSdkCalls)+' observed SDK sends; '+fmt(u.finishedCalls)+' finished. Reported input/output: '+fmt(u.knownInputSubtotal)+' / '+fmt(u.knownOutputSubtotal)+' tokens. Unknown-usage calls: '+fmt(u.unknownUsageCalls)+'; completeness: '+u.complete+'. Provider usage and conservative admission remain separate.'),el('p','Conservative reservations: '+fmt(b.admissionTokens)+' / '+fmt(b.limits?.maxEstimatedTokens)+' units; '+fmt(b.observedSends)+' / '+fmt(b.limits?.maxSends)+' sends. Recorded SDK execution time sum: '+fmt(b.executionMs)+' ms; this is not a full authoring workflow latency. No cost per saved question is available because no Draft was saved. SDK-hidden physical retries and billed money remain unknown.','notice'),details('Separate prospective ledger, native usage events, limits and immutable identities',pretty({declaration:yieldProbe.declaration,ledger,usage:u,budget:b,events:yieldResult.events,limitations:yieldResult.limitations})));document.getElementById('cost').append(cost);
}
const continuation=D.outlineContinuation||{},continuationResult=continuation.result?.receipt,continuationDeclaration=continuation.declaration?.receipt,continuationProof=continuation.projection?.receipt;
if(continuationProof&&continuationDeclaration){
  const p=continuationProof.summary,s=continuationResult,status=s?.status||'not-run',terminal=status!=='running'&&status!=='not-run',findings=s?.progress?.findings||[],completed=s?.child?.status==='completed'&&s.child.structureResult,coverage=completed?.coverage,grounding=coverage?.outlineGrounding,box=el('div');box.id='outline-continuation';
  box.append(el('h3','Exact outline continuation — retain reviewed work and finish only the gaps'),el('p','Starting proof: '+fmt(p.resolvedObjectives)+' / '+fmt(p.expectedObjectives)+' objectives resolved; '+fmt(p.canonicalNegativeFindings)+' remain withheld and '+fmt(p.pendingObjectives)+' await review (L104–L142). The fixed proposal has '+fmt(p.topics)+' topics, '+fmt(p.originalSections)+' original sections and '+fmt(p.extractedEvidencePoints)+' extracted learning points from the same ten PDFs. No new extraction or organization is bought by this continuation.'),el('p','All '+fmt(p.exactParentBindings)+' historical full bindings and original findings are retained. The '+fmt(p.positiveFindingsByteUnchanged)+' supported rows remain byte-identical. Historical negative coverage claims are kept as ignored diagnostics with zero authoritative coverage; retained corrected L96 remains unsupported with its two semantic attempts consumed. The compatibility projection made '+fmt(p.newSemanticJudgments)+' new semantic judgments.','checks'));
  box.append(el('p','Recorded continuation status: '+status+'. '+(completed?'The linked child completed its fixed-proposal review; the historical failed parent remains unchanged. This produces an inspectable outline result, not an applied course structure or saved questions.':terminal?'The child did not produce a completed outline. Retained valid findings and explicit unresolved rows remain diagnostic.':'Execution is still running. The aggregate result may lag later raw captures; unrecorded dispatch and usage are unknown. A partial capture count does not establish final completion, zero dispatch or semantic acceptance.'),'notice'));
  if(completed){const latest=el('div');latest.id='latest-outline-evidence';latest.append(el('h3','Latest completed source-outline result — 17 Oct'),el('p','The guarded continuation finished review of the same 142-objective proposal: 119 source-supported, 23 withheld and 3 separate topic-placement advisories. The returned draft has 30 topics and 119 LOs. All 671 original sections were retained; 620 / 999 extracted points map to admitted objectives and 379 remain explicit gaps. This is a completed review continuation, not a fresh cold pipeline, complete teaching coverage, an applied outline or a saved-question quality result.'),el('p','No Topics/LOs were applied and no questions were saved or adopted. Professor acceptance remains unknown.','notice'));const a=el('a','Inspect the fixed proposal, actual output, gaps and exact model I/O');a.href='#outline-continuation';latest.append(a);document.getElementById('overview').append(latest);}
  if(terminal){const positive=findings.filter(row=>row.status==='supported').length;box.append(evidenceTable('Terminal fixed-proposal review findings',['Measure','Recorded count','Meaning'],[['Returned topics / LOs',completed?completed.themes.length+' / '+completed.themes.reduce((n,t)=>n+t.los.length,0):'No completed result','Inspectable draft only; no course structure was applied.'],['All reviewed objectives',findings.length+' / '+p.expectedObjectives,'Includes the 103 retained starting findings; not 142 new reviews.'],['Supported wording',grounding?.supportedObjectives??positive,'Source-supported model/validator judgment; not teacher acceptance.'],['Withheld wording',grounding?.withheldObjectives??findings.filter(row=>row.status!=='supported').length,'Unsupported/uncertain rows receive no coverage.'],['Topic placement advisories',grounding?.groupingIssues??'Unknown','Separate organizational advice; no automatic source rejection.'],['Pending objectives',p.expectedObjectives-findings.length,'Unresolved identities are not silently accepted.'],['Saved / adopted questions',fmt(s.savedQuestions)+' / '+fmt(s.adoptedQuestions),'This phase reviews Topics/LOs only.']]));}
  if(completed){box.append(el('h3','Actual source coverage — explicit remaining teaching gaps'),el('p',fmt(coverage.analyzedSections)+' parsed sections and '+fmt(coverage.extractedObjectives)+' extracted points; '+fmt(coverage.mappedObjectives)+' points mapped to admitted objectives, with '+fmt(coverage.unmappedEvidenceIds?.length)+' unmapped point IDs. Traversing all parsed sections is not complete pedagogical coverage. Diagrams, damaged equations, unsupported wording and untaught capabilities still require inspection.','notice'),evidenceTable('Ten-source final mapping receipt',['Source PDF','Parsed sections','Mapped learning points'],(coverage.materials||[]).map(m=>[m.name,m.sections,m.mappedObjectives])),details('Complete final outline, source inventory, exclusions and all coverage warnings',pretty(completed)));}
  const links=el('p');for(const [label,href] of [['Continuation implementation and safeguards','../../docs/design/question-generation-quality/OUTLINE-REVIEW-CONTINUATION-IMPLEMENTATION-2026-10-17.md'],['Exact retained projection proof','../../audit-results/quality-lab-outline-continuation-2026-10-17/projection-independent-audit.json']]){if(links.childNodes.length)links.append(document.createTextNode(' · '));const a=el('a',label);a.href=href;links.append(a);}box.append(links,details('Immutable body, 103/39 proof, retained finding bytes and consumed semantic attempts',pretty({preparation:continuation.preparation,projection:continuation.projection,body:continuation.body})),details('Linked child, complete validation progress, receipt bindings and exact runtime result',pretty(continuation.result)));
  const raw=el('details');raw.append(el('summary','Every continuation input, native option and raw visible output'));for(const pin of continuation.captures||[]){const c=pin.receipt,d=el('details');d.append(el('summary',c.id+' · '+c.state),el('h3','Exact actual facade arguments'),el('pre',pretty(c.actualArguments)),el('h3','Raw provider-visible response'),el('pre',c.rawResponse?pretty(c.rawResponse):c.cumulativeVisibleText?'Incomplete visible stream: '+c.cumulativeVisibleText:'No completed response; final output and usage remain unknown.'),details('Pinned transport capture and admission',pretty(pin)));raw.append(d);}box.append(raw,details('Exact observer events, native Mongo receipts and source/cost boundaries',pretty({events:continuation.events,policy:continuation.policy,limitations:s?.limitations})));document.getElementById('sources').append(box);
  const start=el('div');start.id='outline-continuation-start';start.append(el('h3','Preserved zero-dispatch start and scoped fixture reconciliation'),el('p','The first guarded start stopped before creating a child or reserving a model send: ten old admission-only fixture runs were still queued. Its result and empty execution lock are retained. Root matched those ten exact archived fixture IDs, verified no Agenda execution and ended only those owned unstarted records; the original outline parent and source data were not changed. The cumulative ledger stayed byte-identical. The retry used the same immutable declaration and caps, with a new output directory.'),el('p','A separate metadata-correction receipt preserves the operator correction: the first reconciliation used stage failed / finishedAt, then the same ten records were corrected to stage queued / completedAt at revision 2. This is scoped test-fixture reconciliation, not a product cleanup operation or evidence of a successful model run.','caption'),details('Original stopped result, empty-lock archive and unchanged-ledger proof',pretty({firstStart:continuation.firstStart,startReconciliation:continuation.startReconciliation})),details('Exact ten-record fixture reconciliation and subsequent metadata correction',pretty({fixtureReconciliation:continuation.fixtureReconciliation,fixtureMetadataCorrection:continuation.fixtureMetadataCorrection})));const correctionLink=el('a','Read the retained operator metadata-correction receipt');correctionLink.href='../../audit-results/quality-lab-outline-continuation-2026-10-17/fixture-metadata-correction.json';start.append(correctionLink);document.getElementById('validation').append(start);
  const cost=el('div');cost.id='outline-continuation-cost';const u=s?.phaseUsage||{},before=continuation.ledgerBefore?.receipt||continuationDeclaration.ledgerBefore,after=continuation.ledgerAfter?.receipt||continuation.cumulativeLedger?.receipt,limits=continuationDeclaration.limits;cost.append(el('h3','Continuation costs — one unchanged cumulative ledger'),el('p','Immutable parent prefix: '+fmt(before?.reservedSends)+' reservations and '+fmt(before?.conservativeTokens)+' conservative units. The new phase allows at most '+fmt(limits.maxSends)+' sends / '+fmt(limits.maxConservativeTokens)+' additional units, '+fmt(limits.maxInputTokens)+' input estimate and '+fmt(limits.maxOutputTokens)+' output reservation per send. Parent plus maximum addition is 1,976,330 units, below the unchanged 2,000,000 cumulative ceiling. Ten measured first-pass batches leave at most eight additional JSON/semantic correction sends; completion is not guaranteed.'),el('p','Ledger observation at build: '+fmt(after?.reservedSends)+' / '+fmt(limits.cumulativeMaxSends)+' reservations; '+fmt(after?.conservativeTokens)+' / '+fmt(limits.cumulativeMaxConservativeTokens)+' conservative units. '+(terminal?'The terminal ledger is pinned with this result.':'This independently read ledger can be newer than the running aggregate result.'),'checks'));
  if(terminal)cost.append(el('p','Actual new continuation: '+fmt(u.attemptReservations)+' reservations, '+fmt((after?.conservativeTokens??0)-(before?.conservativeTokens??0))+' conservative units and '+fmt(s.elapsedMs)+'ms elapsed wall time. This resumes already extracted/organized work; it is not full cold-outline latency or a causal speedup comparison. The original prefix remains charged.','checks'));
  cost.append(el('p','Aggregate native-receipt snapshot: '+fmt(u.actualObservedSends)+' observed sends, '+fmt(u.recordedFinishedCalls)+' finished; reported input/output '+fmt(u.reportedInputTokens)+' / '+fmt(u.reportedOutputTokens)+' tokens from '+fmt(u.inputKnownCalls)+' input-known and '+fmt(u.outputKnownCalls)+' output-known calls. '+(terminal?'Inspect completeness and any unresolved dispatch below.':'These are stale runtime-snapshot counts while running, not final totals or proof of no later dispatch.')+' Reservations, facade captures, native receipts and provider usage remain separate.','notice'),el('p','The declared transport preserves historical streaming, gpt-6-luna medium and 6,000 output tokens, with a 180,000ms whole-completion deadline. Historical endpoint identity was not recorded; only the current provider is pinned prospectively. Unknown usage stays charged, and hidden SDK retries, billed money and teacher review time remain unknown.'),details('Exact prospective declaration, old/new ledger pins, usage and native links',pretty({declaration:continuation.declaration,ledgerBefore:continuation.ledgerBefore,ledgerAfter:continuation.ledgerAfter,cumulativeLedger:continuation.cumulativeLedger,phaseUsage:u,receiptBindings:s?.receiptBindings,nativeReceipts:s?.nativeReceipts})));document.getElementById('cost').append(cost);
  if(continuation.verification){const v=continuation.verification.receipt,tests=el('div');tests.id='outline-continuation-verification';tests.append(el('h3','Exact continuation — 201 focused regression checks'),el('p','Recorded focused continuation tests: '+fmt(v.numPassedTests)+' / '+fmt(v.numTotalTests)+' across '+fmt(v.numPassedTestSuites)+' suites. They cover source/binding/protocol drift, retained-row compatibility, cumulative/native budgets, JSON correction, unknown dispatch, CAS, cancellation/deletion, explicit-stream observation, duplicate workers and guarded runner preparation. These suites overlap other receipts and are not added to the 85 deadline checks, 188 semantic checks or historical 2,727-test full suite.'),el('p','Offline guard tests and the real-artifact 103/39 compatibility proof are separate evidence. Neither proves professor acceptance, a completed public question batch, improved saved-question yield or a causal speed comparison. This continuation does not apply its outline or create questions.','notice'),details('Exact nine-suite continuation test receipt and hash',pretty(continuation.verification)));document.getElementById('phase-two-verification').append(tests);}
}
if(continuation.wordingRepairVerification){const v=continuation.wordingRepairVerification.receipt,a=continuation.wordingRepairAudit?.receipt,box=el('div');box.id='outline-wording-repair-verification';box.append(el('h3','Bounded outline wording-repair pilot — offline verification only'),el('p','Focused pilot checks: '+fmt(v.numPassedTests)+' / '+fmt(v.numTotalTests)+' across '+fmt(v.numPassedTestSuites)+' suites. The separate independent audit passed '+fmt(a?.tests?.testsPassed)+' tests across '+fmt(a?.tests?.suitesPassed)+' suites at mocked boundaries. These counts overlap other engineering suites and are not combined as unique coverage.'),el('p','This verifies the reviewed code/fixture scope only. It is not a paid wording-repair acceptance, physical Mongo transaction proof, API execution, deployed UI proof, repaired current assignment gap or professor-quality judgment. The completed continuation above still contains its recorded withheld rows and explicit coverage gaps.','notice'),details('Exact 229-test focused pilot receipt',pretty(continuation.wordingRepairVerification)),details('Separate 19-test independent read-only audit, hashes and limits',pretty(continuation.wordingRepairAudit)));document.getElementById('phase-two-verification').append(box);}
const recovery=D.heldoutRecovery||{},recoveryResult=recovery.result?.receipt,recoveryAnalysis=recovery.analysis?.receipt;
if(recoveryAnalysis&&['completed','stopped'].includes(recoveryResult?.status)){
  const a=recoveryAnalysis,summary=a.summary,original=a.originalSummary,supply=a.requestedSupply,byArm=Object.entries(supply.byArm),all=a.cells||[],sum=key=>byArm.reduce((n,[,row])=>n+row[key],0),box=el('div');box.id='heldout-recovery';
  box.append(el('h3','Transport recovery — a separate acquisition cohort, same requested tasks'),el('p','Terminal recovery status: '+a.recoveryStatus+'. The analytical view retains all 60 scheduled cells and every historical receipt. Only the 30 declared transport gaps were eligible for new work: 10 reviews of unchanged candidates and 20 missing generations. Original successful output, the invalid candidate and completed negative judgments were retained, with no content repair or replacement draw to improve a score.'),evidenceTable('Original execution versus analytical recovered view',['Measure','Original terminal execution','Original plus observed recovery'],[['Parsed generation responses',original.generationParsed.true+' / 60',summary.generationParsed.true+' / 60'],['Schema-retained candidates',original.schemaRetained.true+' / 60',summary.schemaRetained.true+' / 60'],['Completed semantic assessments',fmt(original.qualityStates.assessed),fmt(summary.qualityStates.assessed)],['Recorded lab eligibility',fmt(original.combinedLabEligible.true),fmt(summary.combinedLabEligible.true)],['Assessment transport unavailable',fmt(original.qualityStates['transport-unavailable']??0),fmt(summary.qualityStates['transport-unavailable']??0)],['Saved / adopted questions','0 / 0','0 / 0']]),el('p','The added observations occur later under the same historical judge protocol, restored by the exact checked correction adapter. The bounded streaming deadline is a declared transport change. This completes only the observations actually recorded; it is not a causal before/after quality improvement, a uniform-time model comparison, a live saved-question yield or professor acceptance.','notice'));
  const latest=el('div');latest.id='latest-heldout-evidence';latest.append(el('h3','Latest held-out comparison — transport-recovery observations'),el('p','Recovery '+a.recoveryStatus+': '+fmt(sum('positiveStrictRequestedSupply'))+' / 50 positive requests meet the strict requested-task definition, compared with '+fmt(sum('positiveLabEligible'))+' recorded positive lab-eligible candidates. All 60 scheduled cells and original failures remain represented. Later acquisition, model judging and unknown old cost limit interpretation; no question was saved or adopted.'));const latestLink=el('a','Inspect requested supply, original/recovered cohorts and exact input/output');latestLink.href='#heldout-recovery';latest.append(latestLink);document.getElementById('overview').append(latest);
  box.append(el('h3','Positive requested-task supply — eligibility alone is insufficient'),el('p','Across 50 positive-supply requests, '+fmt(sum('positiveLabEligible'))+' have recorded lab eligibility, while '+fmt(sum('positiveStrictRequestedSupply'))+' meet the stricter requested-supply definition. '+supply.definition),evidenceTable('Positive supply by fixed generator configuration',['Generator arm','Positive lab-eligible /requested','Requested kind /requested','Judge difficulty matched /requested','Strict requested supply /requested'],byArm.map(([arm,row])=>[arm,row.positiveLabEligible+' / '+row.positiveRequested,row.positiveRequestedKindFulfilled+' / '+row.positiveRequested,row.positiveRequestedDifficultyMatched+' / '+row.positiveRequested,row.positiveStrictRequestedSupply+' / '+row.positiveRequested])),el('p','Requested kind, candidate-declared difficulty and judge-achieved difficulty remain separate. A source-safe answer can still miss the requested task or difficulty. These are small fixed cases judged by a model; they do not support a general model ranking.','notice'));
  box.append(el('h3','Chart safety-negative — safe fallback is not numerical fulfillment'),el('p',supply.safetyDefinition+' The earlier independent source audit establishes five honest conceptual fallbacks only for its exact r1 candidate hashes; those labels are not automatically transferred to recovered r2 candidates.'),evidenceTable('Deliberately missing numerical chart data',['Generator arm','Safety requests','Conceptual candidates','Numerical candidates','Lab-eligible numerical candidates'],byArm.map(([arm,row])=>[arm,row.safetyNegativeRequested,row.safetyConceptualFallbacks,row.safetyNumericCandidates,row.safetyEligibleNumericCandidates])),el('p','A numeric candidate count alone cannot prove fabricated chart numbers, and model eligibility alone cannot prove that a requested numerical question was fulfilled. Inspect the exact source packet and candidate before any such claim.','caption'));
  const cohorts=el('div');cohorts.id='heldout-recovery-cohorts';cohorts.append(el('h3','Keep generation and assessment acquisition labels'),evidenceTable('Successful generation and completed assessment cohorts',['Acquisition cohort','Parsed generation responses','Completed semantic assessments'],['original','transport-recovery'].map(cohort=>[cohort,all.filter(c=>c.generationParsed===true&&c.acquisition.generationCohort===cohort).length,all.filter(c=>c.qualityState==='assessed'&&c.acquisition.assessmentCohort===cohort).length])),el('p','The ten review-only recoveries retain their original generation cohort. The twenty generation gaps can acquire new content only in the recovery cohort. Cohort labels describe recorded acquisition, not deployment-weight identity or causal treatment.'),details('Every scheduled cell: requested kind, achieved difficulty, actual assessment and acquisition',pretty(all)),details('Exact paired-comparability diagnostics and explicit limits',pretty(a.pairedComparability)));box.append(cohorts);
  const inspect=el('details');inspect.append(el('summary','Exact retained/recovered candidates and every new model input/output'));
  for(const row of recoveryResult.recoveredCells||[]){const comparison=all.find(c=>c.cellId===row.id),d=el('details');d.append(el('summary',row.id+' · '+row.operation+' · '+row.status),el('p','Generation cohort: '+comparison?.acquisition.generationCohort+'; assessment cohort: '+comparison?.acquisition.assessmentCohort+'. Requested kind: '+comparison?.requestedKind+'; candidate kind: '+comparison?.candidateNumericKind+'; requested / judge-achieved difficulty: '+comparison?.difficulty.requested+' / '+comparison?.difficulty.judgeAchieved+'.'),row.normalizedCandidate?questionPanel('Unchanged retained candidate or sole new generation',row.normalizedCandidate):el('p','No normalized candidate; inspect its exact raw response and contract failure.'),details('Recorded deterministic checks, semantic findings and historical mapping adapter',pretty({deterministic:row.deterministic,quality:row.quality,eligible:row.eligible,mappings:row.mappings,error:row.error})));
    for(const cap of row.captures||[]){const t=cap.transcript,io=el('details'),pin=(recovery.captures||[]).find(p=>cap.file.endsWith('/'+p.path));io.append(el('summary',t.stage+' · '+t.status));for(const attempt of t.attempts||[])io.append(el('h3','Exact native input and options'),el('pre',pretty(attempt.input)),el('h3','Raw visible output before parsing'),el('pre',attempt.rawVisibleText||'No visible output recorded; final usage/outcome remain as documented.'),details('Native started/finished events, usage and model identity',pretty(attempt.events)));if(pin){const link=el('a','Open exact local transcript JSON');link.href='../../'+pin.path;io.append(link,details('Transcript file identity',pretty({path:pin.path,sha256:pin.sha256})));}d.append(io);}inspect.append(d);
  }
  box.append(inspect,details('Terminal independent analysis and all reconciled source identities',pretty(recovery.analysis)),details('Immutable declaration, frozen controls, confirmed process exit and overlay result',pretty({declaration:recovery.declaration,controls:recovery.controls,terminal:recovery.terminal,result:recovery.result})));const link=el('a','Recovery implementation, constraints and interpretation');link.href='../../docs/design/question-generation-quality/HELDOUT-TRANSPORT-RECOVERY-IMPLEMENTATION-2026-10-17.md';box.append(link);document.getElementById('models').append(box);
  const cost=el('div');cost.id='heldout-recovery-cost';const old=original.allObservedSdkCalls,combined=summary.allObservedSdkCalls,newUsage=a.recoveryUsage,b=a.budget,ledger=recovery.ledger?.receipt;cost.append(el('h3','Recovery costs — preserve original failures and charge new observations separately'),evidenceTable('Known provider usage with unresolved original cost',['Acquisition','Observed SDK sends','Known input subtotal','Known output subtotal','Reasoning subtotal (within output)','Unknown-usage calls'],[['Original terminal phase',old.actualObservedSends,fmt(old.inputTokensKnownSum),fmt(old.outputTokensKnownSum),fmt(old.reasoningTokensKnownSum),old.unknownUsageCalls],['New recovery phase',fmt(newUsage.observedCalls),fmt(newUsage.inputTokens),fmt(newUsage.outputTokens),fmt(newUsage.reasoningTokens),fmt(newUsage.unknownCalls)],['Analytical combined receipts',combined.actualObservedSends,fmt(combined.inputTokensKnownSum),fmt(combined.outputTokensKnownSum),fmt(combined.reasoningTokensKnownSum),combined.unknownUsageCalls]]),el('p','The original '+fmt(b.originalUnknownUsageCallsRetained)+' unknown-usage calls remain unknown after recovery. Known input/output counts are subtotals, not a complete provider invoice. Failed old calls are neither erased nor reassigned zero cost. Hidden SDK retries, embeddings, infrastructure and money pricing remain excluded.','notice'),el('p','Original ledger: '+fmt(b.originalSends)+' reservations /'+fmt(b.originalConservativeUnits)+' conservative units. New child: '+fmt(b.newSends)+' / '+fmt(b.newConservativeUnits)+'. Combined: '+fmt(b.originalSends+b.newSends)+' / 360 sends and '+fmt(b.originalConservativeUnits+b.newConservativeUnits)+' / 4,000,000 units. The new child stays within its separate '+fmt(ledger?.limits.maxSends)+'-send /'+fmt(ledger?.limits.maxConservativeTokens)+'-unit ceiling. Conservative admission units are not provider input/output tokens.'),el('p','Recovery wall time: '+fmt(recoveryResult.elapsedMs)+' ms. Analytical merged shards deliberately have no replacement wall-clock measurement; outage-tainted old time and later recovery time cannot establish a fair model-speed ranking.','caption'),details('Separate child ledger, original binding, native usage and analyzer budget checks',pretty({ledger:recovery.ledger,originalSummary:a.originalSummary,recoveryUsage:a.recoveryUsage,budget:a.budget,combined:summary.allObservedSdkCalls,policy:recovery.policy})));const thinking=el('div');thinking.id='heldout-recovery-thinking-cost';thinking.append(el('h3','Recorded reasoning/output diagnostics by arm and stage'),el('p','Reported reasoning tokens are already part of output tokens; never add them again. Generation and the fixed judge are separate stages. These are known subtotals over recorded invocations, including original failures; unknown usage remains outside them.'),evidenceTable('Known token and cap diagnostics; no causal speed ranking',['Generator arm','Stage','SDK calls','Known output','Reasoning subset','Output at declared cap'],Object.entries(a.byArm).flatMap(([arm,row])=>['generation','judge'].map(stage=>{const x=row.calls[stage];return[arm,stage,x.actualObservedSends,fmt(x.outputTokensKnownSum),fmt(x.reasoningTokensKnownSum),fmt(x.outputAtDeclaredCapCalls)];}))),el('p','An output count reaching its declared cap is only a diagnostic cue. The provider finish reason is not available here, so cap hits do not prove truncation, explain a quality failure or justify discarding a candidate. Later recovery acquisition and the provider outage also prevent fair timing/model rankings.','notice'));cost.append(thinking);document.getElementById('cost').append(cost);
  if(recovery.verification){const v=recovery.verification.receipt,tests=el('div');tests.id='heldout-recovery-verification';tests.append(el('h3','Recovery runner — frozen protocol and offline failure guards'),el('p',fmt(v.numPassedTests)+' / '+fmt(v.numTotalTests)+' targeted tests across '+fmt(v.numPassedTestSuites)+' suites. They cover exact transport-gap selection, retained positives/negatives, whole-module historical judge compatibility, exact conditional correction restoration, CLI/hash guards, cumulative ceilings and completion-error latching even when the production assessor returns withheld. These engineering counts are separate from content-quality measurements.'),details('Exact runner/planner test receipt and hash',pretty(recovery.verification)));if(recovery.analyzerVerification){const v=recovery.analyzerVerification.receipt;tests.append(el('p','Separate offline measurement checks: '+fmt(v.passed)+' / '+fmt(v.tests)+' tests, exit '+v.exitCode+'. They verify membership, original-row/candidate hashes, retained negative outcomes, required-correction faults and unknown-cost reconciliation. They are not extra semantic evaluations and are not combined with the 35 runner/planner count.'),details('Exact final analyzer tests, pinned Python/test files and limits',pretty(recovery.analyzerVerification)));}document.getElementById('phase-two-verification').append(tests);}
}
if(recovery.independentAudit){const audit=recovery.independentAudit.receipt,bindings=recovery.independentBinding?.receipt?.bindings||[],input=recovery.independentInput?.receipt,box=el('div');box.id='heldout-independent-audit';box.append(el('h3','Independent source review of the 20 new candidates — separate from automatic judging'),el('p','A source-only agent reviewed the exact 20 new generations from a neutral packet that omitted model/arm identities and automatic findings. This is an independent agent reading, not a blinded human trial, teacher acceptance or a new model-ranking score.'),evidenceTable('Independent concerns and the already recorded automatic outcome',['Neutral case','Independent source/answer finding','Automatic status on the same bound candidate'],['N07','N08','N11','N16'].map(id=>{const c=audit.cases.find(c=>c.id===id),binding=bindings.find(b=>b.id===id),row=recoveryResult.recoveredCells.find(r=>r.id===binding?.cellId);return[id,c?.answerValidity?.status+'; '+c?.pedagogicalDisposition,row?.quality?.status||'Unknown'];})),el('p','N07/N08 omit the source condition that excessive payout makes replacement equity necessary. N16 honestly declines unavailable chart numbers but has two semantically correct options. All three were already withheld automatically; these are confirmed guarded defects, not three false acceptances. N11 retains a wording/objective clarity qualification that automatic eligibility alone does not resolve.','notice'),el('p','The audit also observes cross-cell near-duplicate task groups. Those cells had separate frozen Bank snapshots, so cross-cell similarity is a supply/diversity risk, not proof that each violated its own Bank context. All five new chart candidates remain conceptual fallbacks and fail the requested calculation. Safe refusal does not establish a usable single-answer MCQ.','caption'));
for(const c of audit.cases||[]){const detail=el('details'),source=input?.cases.find(x=>x.id===c.id);detail.append(el('summary',c.id+' — source, answer, roles, novelty and request fulfillment'),source?.candidate?questionPanel('Exact independently reviewed candidate',source.candidate):el('p','Inspect the pinned neutral input for the complete candidate.'),details('Independent dimensions, exact supporting quotes and qualifications',pretty(c)),details('Neutral input and later identity binding',pretty({input:source,binding:bindings.find(b=>b.id===c.id)})));box.append(detail);}box.append(details('Independent methodology, file hash and complete findings',pretty(recovery.independentAudit)),details('Post-audit neutral identity reconciliation; no new provider/DB calls',pretty(recovery.independentReconciliation)));document.getElementById('models').append(box);}
const currentPublic=D.currentPublicHttp||{},currentResult=currentPublic.result?.receipt,currentTerminal=currentPublic.terminal?.receipt,savedAudit=currentPublic.savedAudit?.receipt;
if(currentResult&&currentTerminal&&savedAudit){const observations=currentResult.observations||[],generation=observations.filter(row=>row.supply),saved=generation.reduce((n,row)=>n+row.supply.saved,0),requested=generation.reduce((n,row)=>n+row.supply.requested,0),box=el('div');box.id='current-public-acceptance';box.append(el('h3','17 Oct public HTTP/Agenda acceptance — stopped, with saved-quality defects'),el('p','Root confirmed exit '+currentTerminal.exitCode+' and no remaining owned process. All three generation requests reached terminal results: '+fmt(saved)+' / '+fmt(requested)+' requested slots were saved as local Drafts. The overall acceptance run stopped at '+currentTerminal.currentCase+' with '+currentTerminal.error?.message+'. This is not a full passing suite and saved count is not validated usable yield.','notice'),evidenceTable('Actual three public generation requests',['Case','Requested','Saved Drafts','Missing slots'],generation.map(row=>[row.id,row.supply.requested,row.supply.saved,row.supply.missing])),evidenceTable('Actual regeneration and unreached checks',['Intent/check','Observed outcome'],[['Edit existing','One explicit adoption; UUID and adoption replay checks recorded.'],['Create variant','One explicit adoption; UUID and adoption replay checks recorded.'],['Create independent task','Not dispatched: the local fixture clone failed before its observation/model step.'],['Stale-version negative','Not reached before the local fixture stop.']]),el('p','The run used real local Express routes, owned Mongo courses and Agenda, with a synthetic request identity. It does not prove SAML login, production deployment or teacher acceptance. Source-semantic guard work is in progress and unpaid; no repaired saved-quality result is claimed here.','caption'));
  if(currentPublic.failureAudit){const f=currentPublic.failureAudit.receipt;box.append(el('p','Read-only stop reconciliation found '+fmt(f.activeOwnedContentRuns)+' active owned content runs. The partial independent-task fixture contains one completed first material and 29 chunks, but no questions/candidates. Second-source vectors were computed locally before material/seed persistence failed. Qdrant was healthy after the stop; the retained fetch error has no nested cause, so a specific timeout, ECONNRESET or service outage is not established.','caption'),details('Exact bounded local-fixture failure audit; old ledgers and completed work retained',pretty(currentPublic.failureAudit)));}
  const findings=savedAudit.findingsToInspectFirst||[];box.append(el('h3','Four saved Drafts independently inspected — 4 saved does not mean 4 good'),el('p','The source-only agent audit read four exact immutable Draft versions without automatic verdicts. A separate second reading checked the risk-table cases. This is not professor acceptance, a representative quality sample or a live database/current-version audit.'),evidenceTable('Independent source/answer findings on actually saved versions',['Draft case','Finding','Disposition'],findings.map(row=>{const c=savedAudit.cases.find(c=>row.caseIds.includes(c.id));return[row.caseIds.join(', '),row.finding,c?.pedagogicalDisposition||'Inspect exact audit'];})),el('p','P01 conflates mitigation with elimination: its marked-wrong option can agree with the source table while the marked-correct option states the no-elimination limit. P04 treats a table-listed strategy as exclusive under a broad can-mitigate stem; the source does not establish those exclusions. Their unique answer keys need clarification before student use. P02 is sound within its supplied packet. P03 passes its bounded 16-draw rational arithmetic check but does not fulfill the requested beta-versus-total-volatility distinction and has difficulty/presentation qualifications.','notice'));
  for(const c of savedAudit.cases||[]){const detail=el('details'),source=currentPublic.savedInput.receipt.cases.find(x=>x.id===c.id),binding=currentPublic.savedBinding.receipt.bindings.find(x=>x.id===c.id);detail.append(el('summary',c.id+' — exact saved Draft, source quotations and independent findings'),questionPanel('Actual saved Draft under independent review',source.question),details('Original source packets, request, frozen Bank and same-case saved peers',pretty(source)),details('Independent source/answer/role/request audit and immutable version binding',pretty({audit:c,binding})));box.append(detail);}box.append(details('Final independent audit, methodology, exact field pins and qualifications',pretty(currentPublic.savedAudit)),details('Terminal process proof, declared scope and exact HTTP/Agenda/adoption observations',pretty({terminal:currentPublic.terminal,declaration:currentPublic.declaration,result:currentPublic.result})));
  const io=el('details');io.append(el('summary','Every exact new public model request and raw visible response'));for(const pin of currentPublic.captures||[]){const c=pin.receipt,d=el('details');d.append(el('summary',c.caseId+' · '+c.state+' · '+c.id),el('pre',pretty(c.actualArguments)),el('pre',c.rawResponse?pretty(c.rawResponse):c.cumulativeVisibleText||'No completed response recorded.'),details('Pinned actual transport capture',pretty(pin)));io.append(d);}box.append(io);document.getElementById('validation').append(box);
  const latest=el('div');latest.id='latest-public-quality';latest.append(el('h3','Latest public result — saved Drafts still need source review'),el('p','The stopped 17 Oct local acceptance saved 4 / 6 Drafts across completed generation requests. Independent source review found serious answer-exclusion/ambiguity concerns in P01 and P04; P03 has correct bounded arithmetic but request-alignment qualifications. Therefore 4 / 6 is a saved-record count, not four verified good questions. Edit/variant adoption were observed; independent regeneration and stale-version checks were not reached.','notice'));const link=el('a','Inspect the actual saved questions and independent source findings');link.href='#current-public-acceptance';latest.append(link);document.getElementById('overview').append(latest);
  const cost=el('div'),u=currentResult.phaseUsage,l=currentPublic.ledger.receipt;cost.id='current-public-cost';cost.append(el('h3','17 Oct stopped public phase — complete observed usage, incomplete acceptance'),el('p',fmt(u.actualObservedSends)+' observed native calls / '+fmt(u.recordedFinishedCalls)+' finished; '+fmt(u.reportedInputTokens)+' input / '+fmt(u.reportedOutputTokens)+' output tokens. All '+fmt(u.inputKnownCalls)+' input and '+fmt(u.outputKnownCalls)+' output counts are reported for this phase. Ledger: '+fmt(l.attemptReservations)+' reservations, '+fmt(l.conservativeUnits)+' conservative units. This new phase is separate from all historical and recovery ledgers.'),el('p','Observed model calls finished successfully; the suite stopped in local fixture preparation for independent regeneration. No complete-valid-yield or cost-per-good-question estimate follows from the saved count. Embeddings, hidden SDK retries and billed money remain outside these LLM receipts.'),details('Pinned phase ledger, native links and declared caps',pretty({ledger:currentPublic.ledger,usage:u,bindings:currentResult.receiptBindings})));document.getElementById('cost').append(cost);
}
const interpretation=D.sourceInterpretation||{},interpretationDeclaration=interpretation.declaration?.receipt;
if(interpretationDeclaration&&interpretation.input&&interpretation.promptShapes){
  const controls=interpretation.controls.receipt,input=interpretation.input.receipt,shapes=interpretation.promptShapes.receipt.shapes,sizes=interpretation.sizeCapture.receipt.cases,initialSizes=interpretation.initialSizeFailure.receipt.initialSizes,productionTests=interpretation.productionTests.receipt,probeTests=interpretation.probeTests.receipt;
  const box=el('div');box.id='source-interpretation-pending';
  box.append(el('h3','Source interpretation guards — offline checks complete, model probe awaiting approval'),el('p','Not started. Automatic approval review blocked the proposed command before process creation. Root reports no new paid calls, execution claim or live output for this phase. The prepared prompts have no new model responses.','notice'),el('p','The review requested explicit user approval to export these six retained candidate/source/Bank/request payloads to OpenAI and to expand the earlier four-call authorization to at most 16 observed SDK attempts. This book records the pending state; it does not request, assume or grant that approval. The status below is an operator report, separate from a runtime receipt.','caption'));
  if(interpretation.supersession){const lineage=interpretation.supersession.receipt;box.append(el('p','Prospective code updated without buying another response. The original unexecuted declaration is superseded, with all '+fmt(lineage.verifiedOriginalCodeCopies)+' original code files preserved. The current preparation pins '+fmt(lineage.currentCodePins)+' code files; all ten rendered prompt shapes, six retained inputs, prior ledgers and limits remain byte-identical. A separate failed file-only preparation is retained. This successor still awaits the same explicit user approval.','checks'),details('Exact supersession, changed code identities, unchanged input proof and pre-import network fence',pretty({lineage:interpretation.supersession,preparation:interpretation.fileOnlyPreparation,originalDeclaration:interpretation.originalDeclaration})));}
  box.append(evidenceTable('Prospective interpretation guards and their limits',['Observed defect','Prospective instruction','Still required'],[['P01 / P04 answer ambiguity','Preserve modality and claim strength; mitigation is not elimination. A table-listed strategy is not automatically exclusive.','Original sources must establish a uniquely correct answer and the exclusions.'],['P02 task comparison','Compare the required inference and solution path, including the two taught diversification mechanisms.','Different wording alone cannot establish an independent task.'],['P03 / CAPM instructions','Inspect actual decimal domains and units; name the exact teacher clause that fails. Keep the server-planned inference distinct from teacher requirements.','Every teacher requirement remains binding; correct arithmetic does not prove request alignment.'],['CAPM distractors / T/F feedback','Evaluate the literal selected response separately from corrective feedback. Compare current and proposed option roles before alleging relabeling.','A wrong operation need not be endorsed by the notes, but its correction and required concepts need source support.']]));
  box.append(el('h3','Real retained-context size checks — the input cap stayed 24,000'),el('p','Initial synthetic size tests missed the complete retained source and intermediate Bank context. The first real six-case preflight found P02 and P03 oversized. Equivalent v2 instructions and the schema example were compacted, with exact teacher requirements rendered once. No source passage, memory entry, candidate field, requirement or invariant was removed or shortened.'),evidenceTable('Six actual initial quality-review prompt estimates',['Case','Before compaction','After compaction','Remaining under 24,000'],sizes.map(row=>[row.id,fmt(initialSizes[row.id]),fmt(row.inputEstimate),fmt(row.remainingInputUnits)])),el('p','All six initial source-review prompts are at most 22,500 conservative input units; the largest is P02 at 22,488. These are UTF-8 bytes plus 32, not provider token counts. Corrections and fresh validator findings can make later prompts larger: native admission still refuses over 24,000, and the phase may stop before every case finishes.','caption'));
  box.append(el('h3','Prepared scope — same retained inputs, new review prompts'),evidenceTable('Exact proposed phase and ceilings',['Control','Declared value'],[['Cases','P01, P02, P03, P04, CAPM and TF; six source assessments plus CAPM/TF validator and content-review pairs.'],['Initial prompt shapes',fmt(shapes.length)+' full inputs; content-review examples use historical validator text, while execution would use a fresh validator finding.'],['Model / effort / output','gpt-6-luna · none · temperature 0 · 2,000 output tokens per observed attempt.'],['Phase ceiling','16 observed SDK attempts / 320,000 new conservative units; each input at most 24,000.'],['Deadline','180,000 ms per production call, including retries/body reads. Hidden provider retries remain unknown.'],['Persistence','No generation, content rewrite/repair, live Bank refresh, upload, embedding, DB adoption or saved questions.'],['Previous evidence','All earlier paid outputs, negative judgments, ledgers and unknown usage remain unchanged.']]));
  box.append(el('p','The candidates, original source packets, frozen Bank/Queue snapshots and teacher requirements are retained exactly in the pinned controls. These six cases were selected after observed failures. This is a new prompt cohort for diagnosis, not held-out accuracy, a same-code model ranking, a full public-pipeline pass, improved saved yield or teacher acceptance. Source eligibility also remains separate from numerical, role and content findings.','checks'));
  const links=el('p');for(const [label,pin] of [['Proposed declaration',interpretation.declaration],['Pinned execution controls',interpretation.controls],['All ten full prompt shapes',interpretation.promptShapes],['Exact six retained inputs',interpretation.input],['Production checks',interpretation.compactChecks],['Probe tests',interpretation.probeTests],['Independent static audit',interpretation.audit],['Approval rejection / non-execution receipt',interpretation.approvalRejection]]){const a=el('a',label);a.href='../../'+pin.path;links.append(a,document.createTextNode(' · '));}const design=el('a','Read the complete proposed experiment and remaining work');design.href='../../docs/design/question-generation-quality/SOURCE-INTERPRETATION-REVIEW-PROBE-2026-10-17.md';box.append(links,design,el('p','Declaration SHA-256: '+interpretation.declaration.sha256,'caption'));
  const prompts=el('details');prompts.id='source-interpretation-inputs';prompts.append(el('summary','Inspect ten exact proposed inputs — output is not started'));
  for(const [index,shape] of shapes.entries()){const row=el('details');row.id='source-interpretation-prompt-'+index;row.append(el('summary',shape.caseId+' · '+shape.stage+' · '+fmt(shape.utf8InputEstimate)+' conservative input units'),el('h3','Exact proposed prompt'),el('pre',shape.prompt),el('h3','New model output'),el('p','Not started — no new response, eligibility result or provider usage exists for this proposed phase.','empty'));prompts.append(row);}box.append(prompts);
  const retained=el('details');retained.append(el('summary','Six unchanged candidates, complete source/Bank/request controls and historical bindings'));for(const c of input.cases){const row=el('details');row.append(el('summary',c.id+' — retained candidate and frozen context'),questionPanel('Unchanged retained candidate',c.candidate),details('Exact original evidence, Bank memory, teacher requirements and historical review binding',pretty(c)));retained.append(row);}box.append(retained,details('Automatic approval rejection / non-execution receipt and operator-reported pending status',pretty({rejection:interpretation.approvalRejection,status:interpretation.approvalStatus})),details('Declaration, exact controls and scope limits',pretty({declaration:interpretation.declaration,controls:interpretation.controls,inputIdentity:{path:interpretation.input.path,sha256:interpretation.input.sha256}})));
  document.getElementById('validation').prepend(box);
  const verification=el('div');verification.id='source-interpretation-verification';verification.append(el('h3','Offline source-interpretation checks — no new model test passed'),el('p','Historical production prompt/source/citation/requirements regressions: '+fmt(productionTests.numPassedTests)+' / '+fmt(productionTests.numTotalTests)+' tests across '+fmt(productionTests.numPassedTestSuites)+' suites. Scoped lint and repository typecheck passed in that compaction receipt. These mocked and deterministic checks establish routing, exact retained context, admission size and unchanged negative guards; they do not establish model interpretation correctness. Later source/currentness checks have their own receipt below.'),el('p','Separate probe harness: '+fmt(probeTests.tests)+' tests in '+fmt(probeTests.suites)+' suite cover fixed controls, conservative caps/options, CLI/declaration failures, actual assessor fallback, oversize propagation and Error/undefined/null failure latching. These overlapping historical counts are not added to the current regression total.'),el('p',interpretation.fileOnlyPreparation?'The successor preparation denied all fetch/socket activity before runtime imports. It recorded one refused Qdrant compatibility check, zero opened sockets and zero provider sends. This is file-only prompt construction, not a model result.':'The original preparation body was socket-fenced only after imports; its whole-process network activity is not asserted.','caption'),evidenceTable('Historical focused regression scopes — overlapping checkpoints',['Suite','Passed tests'],[['V2 efficiency',3],['Source interpretation',20],['Citation spans / ownership',35],['Semantic repair',13],['Generation quality',46],['Authoring task plans',13]]),details('Exact production compaction, original oversize failure, size capture and test evidence',pretty({checks:interpretation.compactChecks,initialSizeFailure:interpretation.initialSizeFailure,sizeCapture:interpretation.sizeCapture,tests:interpretation.productionTests})),details('Probe harness tests and final read-only static audit',pretty({tests:interpretation.probeTests,audit:interpretation.audit})));document.getElementById('phase-two-verification').append(verification);
  const latest=el('div');latest.id='latest-source-interpretation';latest.append(el('h3','Latest engineering status — bounded review probe awaits approval'),el('p','The v2 source-interpretation changes passed offline checks and fit the unchanged initial-input cap. Their proposed real-model review has not started: automatic approval review stopped the command before process creation. Earlier saved-quality defects and all paid results remain the current observed evidence.','notice'));const a=el('a','Review the exact proposed scope, six retained cases and ten inputs');a.href='#source-interpretation-pending';latest.append(a);document.getElementById('overview').append(latest);
}
const coverageUi=D.sourceCoverageUi||{},coverageUiProof=coverageUi.verification?.receipt;
if(coverageUiProof?.state==='passed'){
  const v=coverageUiProof,box=el('div');box.id='source-coverage-ui';
  box.append(el('h3','Ten-file source review — searchable gaps and explicit uncertainty'),
    el('p','Course Structure now provides a compact per-file receipt, search, file/category filters and 10/25/50-row pagination. Exact retained quotations open alongside original-file and source-context actions. Failed outline runs expose their retained processing diagnostics without presenting an applicable draft.'),
    el('p','These screenshots exercise compiled production UI with intercepted APIs. Text is explicitly synthetic; counts and record relationships preserve the recorded ten-file scale. This adds inspection and integrity guards, not a new generated outline, repaired learning point, saved question or model-quality result.','notice'),
    evidenceTable('Unchanged recorded-scale fixture — different units remain separate',['Files','Sections','Extracted points','Mapped points','Point gaps','Review records'],[[v.fixture.files,v.fixture.sections,v.fixture.extractedPoints,v.fixture.mappedPoints,v.fixture.pointGaps,v.fixture.reviewRecords]]),
    el('p','The 951 review records combine 379 learning-point gaps, 348 related original passages, 136 visual-review passages, 8 context decisions, 7 non-instructional decisions and 73 zero-objective sections. Point and passage records can describe the same content. Zero-objective sections are not automatically non-instructional.'),
    evidenceTable('Mechanical receipt defects reproduced and guarded',['Malformed input','Previously possible display','Verified behavior'],(v.integrityCases||[]).map(row=>[row.input,row.before,row.after])),
    el('p',fmt(v.browser.passed)+' / '+fmt(v.browser.total)+' mocked browser cases passed: '+fmt(v.browser.sourceCoverageCases)+' source-review cases and '+fmt(v.browser.existingEditorCases)+' existing editor flows. Source-review cases cover all-record pagination, search, original/context bindings, contradictory history, literal hostile text, local-edit isolation, failed runs, keyboard use and scoped desktop-light/mobile-dark WCAG checks. That suite rejects external requests and mutations. Existing editor cases simulate streaming, editing, Apply and deletion through intercepted APIs; they make no live writes.','checks'));
  const gallery=el('details');gallery.append(el('summary','Inspect the actual local UI screenshots — mocked inputs'));
  for(const shot of v.screenshots||[]){const figure=el('figure'),a=el('a'),img=el('img');a.href=shot.bookFile;img.src=shot.bookFile;img.alt=shot.alt;img.loading='lazy';a.append(img);figure.append(a,el('figcaption',shot.caption));gallery.append(figure);}box.append(gallery);
  const links=el('p');for(const [label,href] of [['Implementation and reproducible steps','../../docs/design/question-generation-quality/SOURCE-COVERAGE-REVIEW-UI-2026-10-17.md'],['Sanitized input fixture','../../tests/fixtures/structure-source-coverage-ten-files.json'],['Browser regression tests','../../tests/e2e/structure-source-coverage.spec.ts'],['Exact verification receipt','../../'+coverageUi.verification.path]]){if(links.childNodes.length)links.append(document.createTextNode(' · '));const a=el('a',label);a.href=href;links.append(a);}box.append(links,details('Pinned source, fixture, commands, screenshot hashes and limits',pretty(coverageUi.verification)),details('Preserved first failed UI run — corrected fixture and selector problems',pretty(coverageUi.initialFailures)));
  document.getElementById('sources').prepend(box);
  const latest=el('div');latest.id='latest-source-coverage-ui';latest.append(el('h3','Source inspection improved; semantic gaps remain'),el('p','The ten-file receipt is now searchable and paginated, with explicit unavailable states for incomplete or contradictory history. Local UI checks do not remove the 379 recorded point gaps or validate the content of all 119 admitted LOs. The model review probe remains pending approval.'));const link=el('a','See source-review behavior, malformed-input guards and screenshots');link.href='#source-coverage-ui';latest.append(link);document.getElementById('overview').append(latest);
}
const followup=D.sourceAndAdoptionFollowup||{},passageFix=followup.passages?.receipt,guardProof=followup.guards?.receipt,guardHttp=followup.http?.receipt,pageProof=followup.provenance?.receipt;
if(passageFix&&guardProof&&guardHttp&&pageProof){
  const shot=(name)=>{const s=guardProof.screenshots.find(s=>s.bookFile===name),figure=el('figure'),link=el('a'),img=el('img');link.href=name;img.src=name;img.alt=s.caption;img.loading='lazy';link.append(img);figure.append(link,el('figcaption',s.caption));return figure;};
  const sources=el('div');sources.id='source-passage-repair';
  sources.append(el('h3','A real source-input defect repaired — keep the table row intact'),el('p','The original PDF names one company, Newfoundland Light & Power. The old 500-character word cut ended one quote with Newfoundland and began the next with Light & Power. A retained extraction treated these as two companies. New outlines prefer complete native lines while keeping exact original substrings and the existing 500-character bound. This removes input damage; it does not prove a newly generated LO or question is now correct.','notice'),evidenceTable('Same 671 retained source sections — deterministic before / after',['Check','Before','After'],[['Within-line inter-passage cuts in this corpus',passageFix.boundaries.before.withinLine,passageFix.boundaries.after.withinLine],['Passages',passageFix.beforePassages,passageFix.afterPassages],['Changed sections','—',passageFix.changedSections],['Historical inventory targets','1,238 retained','All 1,238 byte-equivalent'],['New model / database calls','0','0']]));
  const comparison=el('div');comparison.className='pair';for(const [label,rows] of [['Before — split row',passageFix.counterexample.before],['After — complete row',passageFix.counterexample.after]]){const column=el('div');column.append(el('h3',label),el('pre',rows.map(r=>r.id+'\n'+r.text).join('\n\n')));comparison.append(column);}sources.append(comparison,shot('chapter-10-physical-page-32.png'),el('p','Historical checkpoints and cached aliases without a policy retain the old partition. Unknown explicit policies are refused. Same rendered prompts keep their identity; changed cuts change their prompt hash. The audit replays the original 1,238 inventory target identities and quotations without rewriting any historical record.','checks'),el('p','Cache cost is unresolved: '+fmt(passageFix.batchCache.changedBatchIdentities)+' / '+fmt(passageFix.batchCache.totalBatches)+' enclosing batch identities change, covering '+fmt(passageFix.batchCache.sectionsInChangedBatches)+' sections, including '+fmt(passageFix.batchCache.unchangedSectionsInChangedBatches)+' individually unchanged sections. No database cache lookup, warm-hit rate, provider-token saving or end-to-end speed improvement was measured. Long lines and pre-existing chunk boundaries remain separate limitations.','notice'),details('Exact original section, old/new spans, prompt/cache hashes and invariants',pretty(followup.passages)));
  const pages=el('div');pages.id='pdf-page-provenance';pages.append(el('h3','Physical page audit — location is different from teaching coverage'),evidenceTable('Offline audit of ten hash-matched PDFs',['Observation','Count'],[['Physical pages',pageProof.totals.manifestPages],['Unique exact chunk locations',pageProof.totals.mappedChunks+' / '+pageProof.totals.chunks],['Chunks spanning several physical pages',pageProof.totals.multiplePhysicalPageChunks],['Counterexamples to chunkIndex +1',pageProof.totals.chunkOrdinalCounterexamples],['Wrong start page under cumulative overlapping-chunk markers',pageProof.totals.cumulativeMarkerStartCounterexamples]]),el('p','These are counterexamples to naive page algorithms, not 653 existing incorrect product citations. The helper verifies exact original bytes and UTF-16 ranges; repeated/stale/unmatched inputs stay unavailable. Production page citations and visual extraction are not implemented by this audit. All 599 pages having some text can mean a footer; it does not establish chart, formula or instructional coverage.','notice'),shot('chapter-10-physical-page-9.png'),el('p','Chapter 10 physical page 9 is printed slide 155 and intersects chunks 20–30. Its plotted relationships need independent visual evidence. The next design preserves an exact parser/page receipt first, then renders only needed pages and separately budgets any optional visual interpretation. It does not send every chapter page to a model.'),details('Pinned page-locator summary, all ten original identities and limitations',pretty(followup.provenance)),details('Nineteen offline provenance tests and independent pdfinfo counts',pretty(followup.provenanceChecks)));
  const sourceLinks=el('p');for(const [label,href] of [['Line-cut implementation','SOURCE-PASSAGE-LINE-BOUNDARIES-2026-10-17.md'],['Page audit','PDF-PAGE-PROVENANCE-AUDIT-2026-10-17.md'],['Next page/visual design — not implemented','PDF-PAGE-AND-VISUAL-COVERAGE-DESIGN-2026-10-17.md']]){const a=el('a',label);a.href='../../docs/design/question-generation-quality/'+href;sourceLinks.append(a,document.createTextNode(' · '));}sources.append(pages,sourceLinks);document.getElementById('sources').prepend(sources);
  const guards=el('div');guards.id='authoring-currentness';guards.append(el('h3','Real local adoption guards — eight groups / eighteen HTTP responses'),el('p','The real Express routes, Mongo originals, Bank snapshots and authoring transactions ran in one fresh owned replica-set database. All 8 groups passed and root observed process exit 0 after cleanup. Model, embedding, vector and job boundaries throw if called; none were called. Synthetic authentication and directly seeded candidate eligibility are deliberate fixtures, not a model or professor quality verdict.','checks'),evidenceTable('Local production-guard observations',['Scenario','Observed result'],guardHttp.observations.map(row=>[row.label,row.status==='passed'?'Passed — inspect exact HTTP request/response below':row.status])),el('p','New-UUID stale-original requests stop before candidate creation. Exact same-UUID cached retrieval stays read-only, while adoption still rechecks the current original. Changed source revision and Bank neighbors block adoption; missing original comparison and tampered candidate hashes are rejected. An LO conflict rolls back earlier source-fence writes. A positive adoption plus replay creates exactly one immutable version.','caption'),el('h3','Recovery in the existing editor'),el('p','Known 409/422 prerequisite failures now explain the next step, retain both previews/checks and all editor text, and disable Replace for that unusable candidate. Only explicit Generate starts a fresh UUID. Unknown 500/network failures preserve same-candidate retries and recovery storage because completion may be ambiguous. No automatic model regeneration occurs.'),el('p',fmt(guardProof.browser.passed)+' / '+fmt(guardProof.browser.passed)+' intercepted-browser cases passed, including 7 new recovery cases. The source-error screenshot was recaptured in one already-counted case; it is not an additional unique test. '+fmt(guardProof.unitTests.passed)+' / '+fmt(guardProof.unitTests.total)+' unit checks passed across '+fmt(guardProof.unitTests.suites)+' suites. The earlier137,59 and60 counts overlap this total. Full server/client typecheck passed.','checks'));
  const gallery=el('div');gallery.className='pair';gallery.append(shot('stale-source-panel-desktop-mocked.png'),shot('stale-source-panel-mobile-dark-mocked.png'));guards.append(gallery,details('All18 exact local HTTP inputs/responses and eight group assertions',pretty(followup.http)),details('Root exit proof, source pins, test/screenshot receipts and limits',pretty(followup.guards)));const report=el('a','Implementation, failures and guarded reproduction steps');report.href='../../docs/design/question-generation-quality/AUTHORING-CURRENTNESS-AND-RECOVERY-2026-10-17.md';guards.append(report);document.getElementById('validation').prepend(guards);
  const latest=el('div');latest.id='latest-source-and-adoption';latest.append(el('h3','17 Oct follow-up — source cuts and adoption guards verified'),el('p','Fixed one observed table-row split and verified 8 local guard groups /18 HTTP responses, 226 unit checks and 31 intercepted-browser cases. Model calls: 0. This strengthens input fidelity and prevents stale adoption; it does not establish repaired semantic quality, complete chapter coverage or valid saved yield. The 379 recorded point gaps and ambiguous saved questions remain unresolved.','notice'));for(const [label,id] of [['Inspect exact source before / after','#source-passage-repair'],['Inspect adoption and retry evidence','#authoring-currentness'],['Review the still-unexecuted model scope','#source-interpretation-pending']]){const a=el('a',label);a.href=id;latest.append(a,document.createTextNode(' · '));}document.querySelector('#overview h2').after(latest);
}
const pdfProduction=D.productionPdfProvenance||{},pdfVerified=pdfProduction.verification?.receipt,pdfNative=pdfProduction.nativeAudit?.receipt;
if(pdfVerified&&pdfNative){
  const pdfShot=(name,caption)=>{const figure=el('figure'),link=el('a'),img=el('img');link.href=name;img.src=name;img.alt=caption;img.loading='lazy';link.append(img);figure.append(link,el('figcaption',caption));return figure;};
  const box=el('div');box.id='production-pdf-provenance';
  box.append(el('h3','PDF provenance in the existing authoring workflow'),el('p','The same ten source PDFs now retain their actual parser, raw text identity and verified physical-page ranges. Exact original text and all 671 chunk texts remain unchanged. Page buttons open a current, hash-pinned PDF; ambiguous or historical locations stay explicitly unavailable. This improves source inspection and integrity, not semantic acceptance.','checks'));
  box.append(el('p',fmt(pdfVerified.unitTests.passed)+' current unit checks across '+fmt(pdfVerified.unitTests.suites)+' suites passed. The local replica-set run verified '+fmt(pdfVerified.localIngest.httpResponses)+' HTTP responses and all '+fmt(pdfVerified.localIngest.verifiedWorkspaceLocations)+' workspace locations. '+fmt(pdfVerified.browser.provenanceCases)+' source UI cases and '+fmt(pdfVerified.browser.recoveryCases)+' new editor-recovery cases passed. Earlier checkpoints overlap these totals.','checks'));
  box.append(evidenceTable('Same-input local parser observation',['Measure','Historical facade','Receipt facade'],[['Source files / physical pages','10 / 599','10 / 599'],['Exact chunk texts','671','671 — byte-equivalent'],['Actual parser and physical locations','Not retained','Retained and verified'],['Ordered local parse time',seconds(pdfNative.totals.plainMs),seconds(pdfNative.totals.receiptMs)],['Provider / model calls','0','0']]));
  box.append(el('p','The paired audit deliberately parsed each file once per arm (20 native extractions total). Production enriched parsing uses one extraction. Approximately 695 ms extra across ten files is a local ordered observation with cache/order effects; it is not a general speed guarantee or an end-to-end generation benchmark.','caption'));
  const actualExample=pdfProduction.localExample?.receipt,actualChunk=actualExample?.chunks.find(chunk=>chunk.sourceProvenance?.locator.status==='verified'&&chunk.sourceProvenance.locator.pageSpans.some(span=>span.physicalPage===9));
  if(actualChunk){box.append(el('h3','Real retained input → actual local output'),el('p','Chapter 10 is the unchanged original PDF with 40 pages. The chunk below is exact text returned by this local ingest. Its first physical page precedes page 9 because chunks can cross pages.'),el('pre',actualChunk.text),details('Exact chunk and source/page bindings from real Mongo publication',pretty(actualChunk)));const input=el('a','Open the unchanged original PDF at physical page 9');input.href='../../'+pdfProduction.originalExamplePdf.file+'#page=9';box.append(input);const io=el('a','Open all 32 exact local HTTP inputs and responses');io.href='../../'+pdfProduction.localHttpResult.path;box.append(document.createTextNode(' · '),io);}
  box.append(el('h3','What changed, and what remains unknown'),el('p','New ingests retain private raw-text receipts and current chunk bindings. New v2 runs opt into provenance-aware evidence; historical packets, exact retries and lost-response replay keep their original branch. Exact selected quote groups carry their own ranges rather than borrowing a whole page or merging nonadjacent quotes. Source location never replaces entailment review. The 379 historical learning-point gaps, missing chart meaning and saved-question ambiguities are still unresolved.','notice'));
  box.append(el('p','Screenshots below show the compiled existing inspector with synthetic intercepted DTOs, including a hostile text string deliberately rendered literally. They verify page-link and layout behavior. Real local PDF/HTTP receipts are inspected separately below; these screenshots are not model outputs.','caption'));
  const gallery=el('div');gallery.className='pair';gallery.append(pdfShot('pdf-provenance-desktop-light.png','Compiled desktop inspector: Chunk 21 points to physical PDF pages 9 and 10. Synthetic intercepted source text.'),pdfShot('pdf-provenance-mobile-dark.png','Compiled mobile dark inspector: parser and physical page receipt fields shown with synthetic intercepted metadata.'));box.append(gallery);
  box.append(details('Root acceptance receipt: tests, local HTTP boundaries, failures and limits',pretty(pdfProduction.verification)),details('Exact native PDF before/after, identities and timing observations',pretty(pdfProduction.nativeAudit)),details('Compiled UI cases, initial fixture failure and final screenshots',pretty(pdfProduction.ui)),details('Historical unexecuted paid declaration and preserved code',pretty(pdfProduction.lineage)));
  const report=el('a','Implementation, reproduction steps and limitations');report.href='../../docs/design/question-generation-quality/PDF-PROVENANCE-IMPLEMENTATION-2026-10-17.md';box.append(report);document.getElementById('sources').prepend(box);
  const latest=el('div');latest.id='latest-production-pdf';latest.append(el('h3','Latest — inspectable PDF provenance; quality verdict remains open'),el('p','Production page provenance now has explicit local acceptance evidence. No new model experiment or professor acceptance was added in this phase. The previous r3 paid declaration is historical and unexecuted because production code changed; its original inputs, caps, ledgers and archived code remain preserved. A new current-code declaration would be required before an approved live probe.','notice'));const jump=el('a','Inspect same-input evidence and screenshots');jump.href='#production-pdf-provenance';latest.append(jump);document.querySelector('#overview h2').after(latest);
  const pending=document.getElementById('source-interpretation-pending');if(pending)pending.prepend(el('p','Current execution state: historical and unexecuted. The r3 declaration below predates production PDF provenance changes and cannot run against current code. Its approval request is still unanswered; no replacement live execution is authorized.','notice'));
}
const answerability=D.answerabilitySourceConditions||{};
if(answerability.promptComparison||answerability.conditionReplay||answerability.diagnosis){
  const diagnosis=answerability.diagnosis?.receipt,comparison=answerability.promptComparison?.receipt,replay=answerability.conditionReplay?.receipt,ui=answerability.ui?.receipt,verified=answerability.verification?.receipt;
  const lazyReceipt=(title,value)=>{const d=el('details');d.append(el('summary',title));let loaded=false;d.addEventListener('toggle',()=>{if(d.open&&!loaded){loaded=true;d.append(el('pre',typeof value==='string'?value:pretty(value)));}});return d;};
  const receiptLink=(label,pin)=>{const a=el('a',label);a.href='../../'+pin.path;return a;};
  const box=el('section',undefined,'chapter');box.id='answerability-source-conditions';
  box.append(el('div','17 OCT / CURRENT OFFLINE ENGINEERING','chapter-number'),el('h2','Make answer exclusions and source conditions inspectable'),
    el('p','Two historical source-supported questions still have an unresolved unique-answer problem. The current change asks for literal option-by-option findings and preserves source conditions alongside the original learning points. The evidence below shows unchanged historical candidates, new contract inputs and offline checks. It does not contain a newly obtained model verdict.','notice'),
    evidenceTable('Current evidence boundaries',['Measure','Recorded observation'],[
      ['New provider/model calls in this phase',diagnosis?.newProviderCalls===0?'0 — no new semantic output': 'Not recorded'],
      ['New saved Drafts',diagnosis?.newSavedDrafts===0?'0 — no new batch-yield result':'Not recorded'],
      ['Extracted learning points',replay?fmt(replay.extractedLearningPointsBefore)+' before / '+fmt(replay.extractedLearningPointsAfter)+' after':'Not recorded'],
      ['Sidecar conditions',replay?fmt(replay.conditionCounts?.linked)+' linked / '+fmt(replay.conditionCounts?.orphan)+' orphan':'Not recorded'],
      ['Teacher acceptance / review-time improvement','Unknown — not measured'],
    ]),el('p','The same-input controls preserve candidate text, original source packet, starting Bank snapshot, teacher requirements and requested difficulty. The contract addition does not authorize accepting a candidate, rewriting historical results or generating a new outline.','checks'));
  const retained=answerability.retainedControls?.receipt;
  if(retained?.cases)box.append(evidenceTable('Six retained controls — historical status, not a new assessment',['Case','Tagged key','Historical eligibility','Requested difficulty'],retained.cases.map(row=>[row.id,(row.taggedCorrectKeys||[]).join(', ')||'Not recorded',row.historicalStatus||'Not recorded',row.difficulty||'Not recorded'])));
  box.append(el('h3','The two concrete failures to test again'),el('p','Read the literal answer first. A correct explanation attached to an option does not make the option itself correct. Conversely, a supported but nonexclusive strategy cannot be excluded merely because another table cell is the intended answer.','caption'));
  for(const row of diagnosis?.cases||[]){
    const article=el('article');article.id='answerability-case-'+row.id;
    article.append(el('h3',row.id+' · unchanged candidate and historical judgment'));
    const pair=el('div',undefined,'pair'),old=el('div'),judgment=row.historicalAssessment||{},audit=row.independentSourceAudit||{};
    old.append(el('h3','Historical source review — retained'),el('p','Eligibility: '+(judgment.status||'not recorded')+'. Source: '+(judgment.sourceSupport||'not recorded')+'. Novelty: '+(judgment.novelty||'not recorded')+'.','checks'));
    for(const reason of judgment.reasons||[])old.append(el('p',reason));
    old.append(el('p','Requested difficulty: '+(judgment.requestedDifficulty||'not recorded')+'; achieved: '+(judgment.achievedDifficulty||'not recorded')+(judgment.difficultyMismatch?' — mismatch retained.':'.'),'caption'));
    const raw=row.historicalRawSourceReview;if(raw)old.append(lazyReceipt('Exact historical raw source-review response — not a new output',raw.content),lazyReceipt('Historical model identity and reported usage',{model:raw.model,usage:raw.usage,metadata:raw.metadata,pin:row.historicalRawSourceReviewPin}));
    pair.append(questionPanel('Exact retained question and option feedback',row.candidate),old);article.append(pair);
    if(audit.answerValidity)article.append(el('h3','Why unique correctness remains unestablished'),el('p',audit.answerValidity.status,'caption'),el('p',audit.answerValidity.reason,'notice'));
    if(audit.sourceActorsNotationAndPremises)article.append(el('p',audit.sourceActorsNotationAndPremises.reason),el('p',audit.sourceActorsNotationAndPremises.tableLimitation,'caption'));
    article.append(el('h3','New contract requirement — input only'),el('p',row.newContractBehavior||'The new protocol has not been assessed on this case.'),el('p','New semantic output: not obtained. This paragraph describes required behavior, not a successful new model decision.','empty'),lazyReceipt('Exact teacher requirements and unchanged input list',{requirements:row.requirements,sameInputPreserved:row.sameInputPreserved}),lazyReceipt('Independent source audit and its exact supporting quotations',audit));
    box.append(article);
  }
  if(!diagnosis)box.append(el('p','The final exact-case diagnosis is pending. No new case judgment is inferred from its absence.','empty'));
  const contracts=answerability.contracts?.receipt?.selectedContracts||[];
  box.append(el('h3','What the new reviewer must return'),el('p','MCQ checks must account for all four actual keys. A resolved answer requires one fully correct literal response matching the tagged key. Incorrect-option exclusions require a source contradiction or an explicit condition from the actual stem; an unsupported exclusion stays undetermined. True/False records the truth of the full statement separately from its feedback. Numerical verification remains a separate gate.'));
  for(const contract of contracts.filter(row=>row.caseId!=='P04')){box.append(lazyReceipt(contract.caseId+' · exact new '+(contract.caseId==='TF'?'True/False':'MCQ')+' review-contract prefix — not the full input',contract.exactContractPrefix||'Exact contract boundary unavailable.'));if(contract.fullPromptFile){const a=el('a','Complete exact '+contract.caseId+' review input');a.href='../../'+contract.fullPromptFile;box.append(a);}}
  box.append(el('p',contracts.length?'Only the exact current prefix before AUTHORING POLICY is embedded here. The complete frozen source/Bank/candidate prompt inputs remain available in the pinned original file below.':'The final compacted review-contract input is pending verification. The earlier r1 prefix remains linked with its historical prompt comparison; it is not presented as current.','caption'));
  const repair=answerability.repairBrief?.receipt;
  if(repair){
    box.append(el('h3','The repair instruction now carries the literal-answer defect'),el('p','This paired comparison runs the archived and current pure planner against the same retained P01 candidate, sources, Bank and teacher requirements. Its multi-correct verdict is deliberately synthetic. The output below is an actual repair instruction from code, not a new generated question, model judgment or successful semantic repair.','notice'));
    const row=repair.cases?.P01;
    if(row){const pair=el('div',undefined,'pair');for(const [arm,label] of [['before','Before · archived planner'],['after','After · current planner']]){const result=row[arm]||{},panel=el('div');panel.append(el('h3',label),el('p','Plan: '+(result.planExists===true?'present':result.planExists===false?'absent':'not recorded')+'. Strategy: '+(result.strategy||'not recorded')+'.','caption'));if(result.critiqueExcerpt!==undefined){panel.append(lazyReceipt((result.excerptComplete?'Exact repair critique':'Repair critique excerpt — first '+fmt(result.excerptLimit)+' characters')+' ('+fmt(result.critiqueCharacters)+' recorded characters)',result.critiqueExcerpt));if(result.critique?.path)panel.append(receiptLink('Open full exact critique',result.critique));}pair.append(panel);}box.append(pair,el('p','Paired inputs unchanged after both planners: '+(row.inputUnchangedAfterBothPlanners===true?'yes':'not established')+'. Teacher requirements remain binding; no narrow table-lookup criterion was invented.','caption'));}
    const uncertain=repair.cases?.P04;if(uncertain)box.append(el('p','P04 uncertainty-only control: archived plan '+(uncertain.before?.planExists===false?'absent':'not established')+'; current plan '+(uncertain.after?.planExists===false?'absent':'not established')+'. Uncertain evidence alone still does not invent a supported correction. This control also uses an injected verdict.','checks'));
    box.append(lazyReceipt('Paired pure-planner input/code pins and limits',answerability.repairBrief));
  }
  box.append(el('h3','Source conditions survive the learning-point summary'),el('p','This file-only replay adds a linked condition sidecar to organization and review inputs. It preserves the 999 original extracted points rather than inflating the LO count. Conditions are retrieval context grounded in the retained source quotations; they are not extra teacher-approved objectives or proof that all course conditions were found.'));
  for(const id of ['E482','E947','E946']){
    const row=replay?.selected?.[id];if(!row)continue;
    const old=row.before||{},after=row.after||{},pair=el('div',undefined,'pair'),before=el('div'),next=el('div');
    before.append(el('h3',id+' · retained point before'),el('p',old.materialName||'Source not recorded','caption'),el('p',old.objective||'Objective text not recorded'));
    const quotes=el('details');quotes.append(el('summary','Inspect exact original quotation groups'),el('pre',old.quote||'Quote not recorded'));
    for(const passage of old.supportingPassages||[])quotes.append(el('p',passage.passageId,'caption'),el('pre',passage.quote));before.append(quotes);
    next.append(el('h3','After · linked condition context'));
    if(after.conditions?.length){const list=el('ul');for(const condition of after.conditions){const item=el('li',condition.name);item.append(el('small',' · '+condition.id+' → '+condition.evidenceIds.join(', ')));list.append(item);}next.append(list);}else next.append(el('p','No condition linked to this point in this replay. This is not a finding that no additional condition exists.','empty'));
    next.append(lazyReceipt('Exact before/after identities and condition links',row));pair.append(before,next);box.append(pair);
  }
  if(replay)box.append(evidenceTable('Bounded source-condition input cost — conservative units, not billed tokens',['Measure','Recorded bound'],[
    ['New prompt context bytes',fmt(replay.promptContextBytes)],['Historical organization estimate',fmt(replay.organizationBudget?.previousEstimate)],['Added conservative estimate',fmt(replay.organizationBudget?.addedConservativeEstimate)],['After upper bound / unchanged cap',fmt(replay.organizationBudget?.conservativeAfterUpperBound)+' / '+fmt(replay.organizationBudget?.maxInputTokens)],['Estimate fits cap',replay.organizationBudget?.fits===true?'Yes — offline bound only':'Not established'],
  ]),el('p',replay.organizationBudget?.note||'Provider usage was not observed.','caption'));
  const initialComparison=answerability.initialPromptComparison?.receipt,initialHeadroom=answerability.correctionHeadroom?.initial?.receipt,finalHeadroom=answerability.correctionHeadroom?.final?.receipt;
  if(initialComparison)box.append(el('h3','Initial prompt fit did not guarantee correction headroom'),el('p','The retained r1 initial inputs fit their raw input cap, with a maximum of '+fmt(initialComparison.maxConservativeInput)+' units. The subsequent real-assessor file-only correction audit exposed a separate failure: correction text can exceed that same cap. These original failures remain recorded; they are not a new model judgment.','notice'));
  const failedCorrections=(initialHeadroom?.rows||[]).filter(row=>row.correction&&row.correction.fitsRawCap===false);
  if(failedCorrections.length)box.append(evidenceTable('Retained r1 corrections that exceeded the unchanged raw cap',['Case / injected structural defect','Initial units','Correction units','Cap','Offline budget admission'],failedCorrections.map(row=>[row.caseId+' / '+row.scenario,fmt(row.initial?.inputEstimate),fmt(row.correction?.inputEstimate),fmt(initialHeadroom.limits?.maxInputTokens),row.correction?.admitted===false?'Refused':'Inspect receipt'])));
  if(comparison?.cases)box.append(evidenceTable('Current compacted review input — exact teacher/source/Bank/candidate tail retained',['Case','Previous initial units','Current initial units','Saved instruction units','Data tail byte-identical'],comparison.cases.map(row=>[row.caseId,fmt(row.previousInitialInputEstimate),fmt(row.currentInitialInputEstimate),fmt(row.savedInstructionUnits),row.payloadTailByteIdentical===true?'Yes':'Not established'])),el('p','Current maximum initial input: '+fmt(Math.max(...comparison.cases.map(row=>row.currentInitialInputEstimate)))+' conservative units. Maximum across the audited initial/correction paths: '+fmt(comparison.finalMaxRawInputEstimate)+' / '+fmt(comparison.cap)+'. These are offline prompt estimates; no new provider usage, latency, quality or saved-yield result follows.','caption'));
  else if(comparison)box.append(evidenceTable('Current compacted retained review-prompt comparison — no provider dispatch',['Case / stage','Before units','After units','Added','Unchanged cap'],(comparison.prompts||[]).map(row=>[row.caseId+' / '+row.stage,fmt(row.beforeConservativeUnits),fmt(row.afterConservativeUnits),fmt(row.deltaConservativeUnits),fmt(row.cap)])),el('p','Current maximum initial input: '+fmt(comparison.maxConservativeInput)+' conservative units. Correction headroom is assessed separately below. These are offline prompt estimates; no new provider usage, latency, quality or saved-yield result follows.','caption'));
  if(finalHeadroom)box.append(evidenceTable('Current file-only initial and correction headroom',['Case / injected structural defect','Initial raw units','Correction raw units','Raw cap','Offline correction admission'],(finalHeadroom.rows||[]).map(row=>[row.caseId+' / '+row.scenario,fmt(row.initial?.inputEstimate),fmt(row.correction?.inputEstimate),fmt(finalHeadroom.limits?.maxInputTokens),row.correction?.admitted===true?'Admitted to throwing fixture; no provider':row.correction?.admitted===false?'Refused':'Not recorded'])),el('p','The current headroom receipt records '+fmt(answerability.correctionHeadroom.scenarioCount)+' injected structural scenarios, '+fmt(answerability.correctionHeadroom.simulatedInitialAdmissions)+' simulated initial admissions and '+fmt(answerability.correctionHeadroom.simulatedCorrectionAdmissions)+' simulated correction admissions. All final corrections fit: '+(answerability.correctionHeadroom.allFinalCorrectionsFit===true?'yes, under the recorded estimator and scenarios':'not established')+'. Maximum raw estimate: '+fmt(answerability.correctionHeadroom.largestFinalRawEstimate)+' / '+fmt(answerability.correctionHeadroom.unchangedCap)+'. This tests real prompt construction and budget admission with synthetic responses, not model interpretation or billed-token accuracy.','caption'),el('p',answerability.correctionHeadroom.estimatorScope||'Provider usage was not observed.','caption'));
  box.append(el('h3','Existing Source and memory checks — synthetic UI evidence'));
  if(ui)box.append(el('p',fmt(ui.passed)+' / '+fmt(ui.uniqueCases)+' isolated browser cases passed; failed: '+fmt(ui.failed)+'. Desktop light and mobile dark receipt scans report zero WCAG A/AA violations. The fixture intercepts every API, rejects mutations and external requests, and starts no app server, database or model. The count is a UI denominator, not semantic accuracy.','checks'));
  const gallery=el('details');gallery.append(el('summary','Inspect the four current UI screenshots — synthetic intercepted judgments'));
  const captions={'answerability-generation-existing-checks.png':'Existing generation check details with the new receipt; all displayed judgments are synthetic intercepted data.','answerability-regeneration-existing-checks.png':'Existing regeneration Source and memory checks; restored synthetic receipt, no new generation.','answerability-desktop-light.png':'Expanded desktop receipt: literal answer, reason, exclusion and separately labelled feedback. Synthetic data.','answerability-mobile-dark.png':'Expanded mobile dark receipt: the same synthetic checks, including a deliberate long text wrapping test.'};
  const shots=el('div',undefined,'pair');for(const image of answerability.screenshots||[]){const figure=el('figure'),a=el('a'),img=el('img');a.href=image.bookFile;img.src=image.bookFile;img.alt=captions[image.bookFile]||'Synthetic intercepted answerability receipt.';img.loading='lazy';a.append(img);figure.append(a,el('figcaption',img.alt));shots.append(figure);}gallery.append(shots);box.append(gallery);
  if(ui?.initialFailure)box.append(el('p','Initial fixture run: '+fmt(ui.initialFailure.passed)+' passed, '+fmt(ui.initialFailure.failed)+' failed, '+fmt(ui.initialFailure.didNotRun)+' not run. The two causes were a broad quote selector and omitted local rich-text globals; the original failure report/traces remain preserved. The final run replaced neither those failures nor any historical model result.','caption'));
  box.append(el('h3','Verification and remaining work'));
  box.append(verified?el('p','Final engineering verification is recorded. Inspect its exact suite-specific counts and limits below; overlapping earlier checkpoints must not be added together.','checks'):el('p','Final engineering verification is pending at this book build. The recorded UI and input-replay receipts remain inspectable; no missing test result is treated as passing.','empty'));
  if(verified?.tests)box.append(evidenceTable('Current engineering regression receipt — overlapping historical counts are separate',['Suites','Passed / total','Failed','Terminal exit'],[[fmt(verified.tests.suites),fmt(verified.tests.passed)+' / '+fmt(verified.tests.total),fmt(verified.tests.failed),fmt(verified.tests.terminalExitCode)]]));
  if(verified?.paidProbe){const paid=verified.paidProbe,superseded=Boolean(D.visualSourceObligations?.taskDemandImplementation);box.append(el('h3',superseded?'Historical r5 preparation — unexecuted and superseded':'Prepared paid probe — still unexecuted'),el('p',(superseded?'At this prior checkpoint, preparation state was: ':'Current preparation state: ')+paid.state+'. The r5 declaration pins '+fmt(verified.codeSnapshot?.files)+' archived code files and retains '+fmt(paid.priorLedgers)+' earlier ledgers. '+(superseded?'Subsequent task-demand changes require a new prospective declaration; inspect the newer source-obligations chapter. ':'')+'Preparation is not approval or execution; no new provider result follows.','notice'));if(paid.declaration)box.append(receiptLink('Open the exact unexecuted r5 declaration',paid.declaration));if(verified.failedPreparation)box.append(el('p','An earlier r4 preparation failed on its local CJS/TypeScript setup before model work; the corrected file-only preparation and original failure remain pinned in the final verification.','caption'),receiptLink('Inspect the retained r4 setup failure',verified.failedPreparation));}
  for(const [title,pin] of [['Final engineering verification',answerability.verification],['Current prompt comparison and unchanged input bindings',answerability.promptComparison],['Current correction-headroom receipt',answerability.correctionHeadroom?.final],['Retained first compaction checkpoint',answerability.correctionHeadroom?.firstCompact],['Retained r1 initial-only prompt comparison',answerability.initialPromptComparison],['Retained r1 correction-cap failures',answerability.correctionHeadroom?.initial],['Exact source-condition replay and cost bound',answerability.conditionReplay],['UI verification, per-case reports and initial fixture failures',answerability.ui],['Exact case diagnosis and preservation pins',answerability.diagnosis]])if(pin)box.append(lazyReceipt(title,pin));
  const links=el('p');for(const [label,pin] of [['Complete six-case controls',answerability.retainedControls],['Complete current prompt inputs',answerability.contracts],['Historical r1 contract input',answerability.initialContracts],['Historical r1 correction audit',answerability.correctionHeadroom?.initial],['Full diagnosis',answerability.diagnosis],['Source-condition replay',answerability.conditionReplay],['UI reports',answerability.ui],['Final verification',answerability.verification]])if(pin){links.append(receiptLink(label,pin),document.createTextNode(' · '));}box.append(links);
  if(diagnosis?.knownOpenRequirements){const list=el('ul');for(const requirement of diagnosis.knownOpenRequirements)list.append(el('li',requirement));box.append(el('p','Still required before any claim of improvement:'),list);}
  box.append(el('p','A new approved model probe is still required to determine whether the model follows the new exclusions on fixed negative and positive controls. This phase adds no actual new outline, accepted question-quality result, complete saved-yield result or professor acceptance. Charts and visual-page meaning remain open.','notice'));
  document.getElementById('overview').after(box);
  const latest=el('div');latest.id='latest-answerability-source-conditions';latest.append(el('h3','Latest — literal-answer checks and retained source conditions'),el('p','Offline engineering and exact input evidence only: the historical P01/P04 answer ambiguities remain visible. New model calls: '+(diagnosis?.newProviderCalls===0?'0':'not recorded')+'. No new semantic acceptance or saved-yield result.','notice'));
  const jump=el('a','Inspect exact failures, new contract inputs, source conditions and UI evidence');jump.href='#answerability-source-conditions';latest.append(jump);document.querySelector('#overview h2').after(latest);
}
const visual=D.visualSourceObligations||{},visualVerified=visual.verification?.receipt;
if(visual.verification){
  const inventory=visual.inventory?.receipt,totals=inventory?.totals||{},pageChecks=visual.originalPageChecks?.receipt,demand=visual.taskDemandAudit?.receipt;
  const lazy=(title,value)=>{const d=el('details');d.append(el('summary',title));let loaded=false;d.addEventListener('toggle',()=>{if(d.open&&!loaded){loaded=true;d.append(el('pre',typeof value==='string'?value:pretty(value)));}});return d;};
  const fileLink=(label,pin)=>{const a=el('a',label),path=pin.path||pin.file||'';a.href='../../'+path.replace(/^\/Users\/fanhaocheng\/tlef\/tlef-financebot\//,'');return a;};
  const box=el('section',undefined,'chapter');box.id='visual-source-obligations';
  box.append(el('div','17 OCT / LOCAL VISUAL OBLIGATIONS','chapter-number'),el('h2','Account for each original page before claiming it was understood'),
    el('p','A mapped text span can coexist with an unread table, chart or actor relationship on the same page. This local audit records page-level observations and a bounded inspection queue. It does not interpret chart values, create learning objectives or establish complete pedagogical coverage.','notice'),
    evidenceTable('Page accounting — these states describe different work',['Measure','Recorded pages'],[
      ['Expected physical pages',fmt(totals.expectedPages)],['Pages represented in the ledger',fmt(totals.accountedPages)],
      ['Operator inspection observed',fmt(totals.operatorInspectedPages)],['Operator inspection unknown',fmt(totals.inspectionUnknownPages)],
      ['Interpretation remains unknown',fmt(totals.interpretationUnknownPages)],['Teacher review remains unreviewed',fmt(totals.reviewUnreviewedPages)],
    ]),el('p','Native text, image paints, vector paths and unobserved inspection are separate signals. A page can contain more than one signal, so those counts must not be added as disjoint coverage. Geometry does not establish a legend, numerical series, formula condition or teaching objective.','checks'));
  if(inventory?.files){box.append(evidenceTable('Every selected original file remains accounted for',['Original file','Physical pages','Operator inspected','Inspection unknown','Recorded elapsed ms'],inventory.files.map(file=>[file.name||('Chapter '+file.chapter),fmt(file.pageCount),fmt(file.operatorInspectedPages),fmt(file.inspectionUnknownPages),fmt(file.elapsedMs)])));const originals=el('details');originals.append(el('summary','Open each original PDF and its complete page ledger'));for(const file of inventory.files){const row=el('p');row.append(el('strong',file.name||('Chapter '+file.chapter)),document.createTextNode(' · '));if(file.pdf)row.append(fileLink('Original PDF',file.pdf),document.createTextNode(' · '));if(file.ledger)row.append(fileLink('Complete page ledger',file.ledger));originals.append(row);}box.append(originals);}
  box.append(evidenceTable('Observed signals overlap — none classifies a page’s meaning',['Signal','Recorded pages'],[['Raster image paints observed',fmt(totals.pagesWithRasterPaints)],['Vector path constructions observed',fmt(totals.pagesWithVectorPaths)],['Native text matches the declared footer-only heuristic',fmt(totals.nativeFooterHeuristicPages)],['Native text empty',fmt(totals.nativeEmptyPages)]]));
  const qr=visual.priorityQueue?.receipt,queue=Array.isArray(qr)?qr:qr?.pages||qr?.priorityQueue||qr?.items||[];
  box.append(el('h3','A six-page diagnostic queue, with at most two from one file'),el('p','The queue prioritizes a bounded next inspection step. It does not grant coverage to selected pages or erase the remaining pages. Unselected, unprobed and unresolved records stay in the full ledger. The separately selected original-page controls below are not the queue and are not a random evaluation sample.'));
  if(queue.length){box.append(evidenceTable('Recorded priority queue — diagnostic selection only',['Page identity','Physical page','Priority reasons'],queue.map(row=>{const reasons=row.diagnosticReasons||row.reasons;return [row.pageId||('Chapter '+row.chapter),fmt(row.physicalPage),Array.isArray(reasons)?reasons.join('; '):reasons||'Not recorded'];})));const links=el('p');for(const row of queue){if(row.pdf){const a=fileLink(row.pageId+' · original PDF page',row.pdf);a.href+='#page='+row.physicalPage;links.append(a,document.createTextNode(' · '));}if(row.ledger)links.append(fileLink(row.pageId+' · complete page ledger',row.ledger),document.createTextNode(' · '));}box.append(links);}
  else box.append(el('p','No final priority queue is available in this receipt. No empty queue or completed coverage is inferred.','empty'));
  const joined=visual.originalLedgerReconciliation?.receipt;
  if(joined?.rows)box.append(evidenceTable('Same original pages, different signals — object counts do not reveal meaning',['Original physical page','Source-only observation','Native non-whitespace','Raster paints','Vector paths','In six-page queue'],joined.rows.map(row=>['Chapter '+row.chapter+' · p'+row.physicalPage,row.rootObservedContent,fmt(row.nativeNonWhitespaceCharacters),fmt(row.rasterPaints),fmt(row.vectorPathConstructions),row.selectedInDiagnosticQueue===true?'Yes':row.selectedInDiagnosticQueue===false?'No':'Not recorded'])),el('p','These joins check original PDF/native/chunk/ledger identities. The content descriptions come from the separately retained coding-agent inspection, not an automatic classifier or professor review. All five ledger interpretations remain unknown. In particular, zero raster paints on the vector chart does not mean no visual content.','caption'),lazy('Exact original-control identity reconciliation and limitations',visual.originalLedgerReconciliation));
  box.append(el('h3','Inspect the unchanged originals beside their actual text input'));
  if(pageChecks)box.append(el('p',pageChecks.scope||'Selected source-page observations.'),el('p',pageChecks.selection||'These source-only checks do not establish teacher acceptance.','caption'));
  for(const row of pageChecks?.pages||[]){
    const article=el('article');article.append(el('h3','Chapter '+row.chapter+' · physical page '+row.physicalPage+' · '+(row.observedContent||'content not classified')));
    const pair=el('div',undefined,'pair'),image=el('div'),text=el('div');
    if(row.bookFile){const figure=el('figure'),a=el('a'),img=el('img');a.href=row.bookFile;img.src=row.bookFile;img.alt='Pinned original Chapter '+row.chapter+', physical page '+row.physicalPage+'. '+(row.observedContent||'Independent source inspection');img.loading='lazy';a.append(img);figure.append(a,el('figcaption','Original page pixels. Content-type notes are an independent coding-agent inspection; no chart/table values were added to source evidence.'));image.append(figure);}
    if(row.originalPdf?.path){const a=fileLink('Open original PDF at physical page '+row.physicalPage,row.originalPdf);a.href+='#page='+row.physicalPage;image.append(a);}
    const native=row.nativeText||{};
    text.append(el('h3','Exact retained native input'),el('p',fmt(native.wordCount)+' words · '+fmt(native.nonWhitespaceCharacters)+' non-whitespace characters · '+fmt(native.digitBearingTokens)+' digit-bearing tokens. These are text observations, not recovered values.','caption'));
    if(typeof native.text==='string')text.append(lazy('Inspect exact physical-page native text',native.text));
    const chunks=row.currentChunks?.rows||[];
    text.append(el('p',row.currentChunks?.basis||'Chunk binding not recorded.','caption'));
    if(chunks.length){const d=el('details');d.append(el('summary','Inspect '+fmt(chunks.length)+' exact retained overlapping chunks'));let loaded=false;d.addEventListener('toggle',()=>{if(d.open&&!loaded){loaded=true;for(const chunk of chunks)d.append(el('p','Stored chunk index '+chunk.index+' (not a page number)','caption'),el('pre',chunk.text));}});text.append(d);}
    for(const observation of row.observations||[])text.append(el('p',observation));
    text.append(el('p','Interpretation: '+(row.interpretation||'unknown')+'. Review: '+(row.review||'not recorded')+'.','caption'));
    for(const limit of row.limitations||[])text.append(el('p',limit,'caption'));
    pair.append(image,text);article.append(pair,lazy('Exact original/render/chunk identities and inspection recipe',row));box.append(article);
  }
  if(!pageChecks)box.append(el('p','Pinned original-page checks are pending; no missing render is treated as inspected.','empty'));
  box.append(el('h3','Useful question supply must also fulfill the requested task'),el('p','A source-supported answer and the teacher’s requested task are separate outcomes. A conceptual missing-data response can be safe while leaving a numerical request unfilled. A clear easy question does not fulfill a hard request merely because it passes a source review.','checks'));
  if(demand){
    const p04=demand.P04||{},assessment=p04.assessment||{},cohort=demand.cohort||{},arms=cohort.byArm||{};
    box.append(el('h3','Actual historical P04: a hard request became an eligible easy draft'),evidenceTable('Retained public-path request contract',['Requested','Candidate label','Assessed','Historical eligibility','Difficulty mismatch','Historical saved'],[[p04.request?.difficulty||'Not recorded',p04.candidate?.difficulty||'Not recorded',assessment.achievedDifficulty||'Not recorded',assessment.status||'Not recorded',assessment.difficultyMismatch===true?'Recorded true':assessment.difficultyMismatch===false?'Recorded false':'Not recorded',fmt(p04.savedCount)]]),el('p',p04.actualCondition||'The exact contract finding is not recorded.','notice'));
    const trace=p04.traceReceipt?.receipt;
    if(Array.isArray(trace)){const d=el('details');d.append(el('summary','Inspect the seven retained actual request/response calls — historical, not rerun'));for(const [index,call] of trace.entries()){const prompt=(call.selectedPromptLines||[]).join('\n');d.append(lazy('Historical call '+(index+1)+' · selected exact request lines and returned JSON',{selectedPromptLines:call.selectedPromptLines,output:call.output,file:call.file,promptSha256:call.promptSha256,actualOptions:call.actualOptions}));if(prompt.includes('Requested task difficulty: easy.'))d.append(el('p','This retained replacement-generator input explicitly requests easy, while the original request remains hard.','caption'));}box.append(d);}
    const reference=el('a','Inspect the unchanged P04 question and source-answer ambiguity');reference.href='#answerability-case-P04';box.append(reference);
    box.append(el('p','The answerability change documented above did not itself close this audited difficulty contract. This finding refers to the historical frozen code/receipts. The new selected-request repair is documented separately below; its engineering tests do not establish actual model acceptance.','caption'));
    const rows=['luna-low','luna-medium','luna-high','sol-medium','sol-high'].filter(id=>arms[id]).map(id=>{const r=arms[id],n=r.positiveRequested;return [id,fmt(n),fmt(r.positiveKind?.true)+' / '+fmt(n),fmt(r.positiveDifficulty?.true)+' / '+fmt(n),fmt(r.positiveLabEligible?.true)+' / '+fmt(n),fmt(r.positiveStrictFulfillment)+' / '+fmt(n)];});
    box.append(el('h3','Historical recovered cohort — descriptive requested-supply rates'),evidenceTable('Positive cases only; no causal model ranking',['Arm','Requested positive','Kind fulfilled','Difficulty matched','Lab eligible','Strict fulfillment'],rows),el('p',cohort.strictFulfillmentDefinition||'Strict fulfillment is not teacher acceptance.','caption'),el('p','The cohort keeps positive and chart-negative cases separate. It combines original and later transport-recovery acquisitions, retains failed/unknown usage and has no professor labels. These fixed-case counts do not establish a generally superior model or a causal effect of reasoning effort.','caption'));
    if(Object.keys(arms).length){const all=Object.values(arms),positive=all.reduce((n,row)=>n+row.positiveRequested,0),negative=all.reduce((n,row)=>n+row.negativeRequested,0),strict=all.reduce((n,row)=>n+row.positiveStrictFulfillment,0),hard=all.reduce((n,row)=>n+(row.positiveByRequestedDifficulty?.hard?.requested||0),0),hardMatched=all.reduce((n,row)=>n+(row.positiveByRequestedDifficulty?.hard?.matched?.true||0),0),negativeKind=all.reduce((n,row)=>n+row.negativeKind.true,0);box.append(el('p',fmt(strict)+' / '+fmt(positive)+' positive requests meet the recorded strict definition. Hard requests matched: '+fmt(hardMatched)+' / '+fmt(hard)+'. Numerical kind fulfilled on the deliberately missing-chart negative: '+fmt(negativeKind)+' / '+fmt(negative)+'. Unknown/invalid judgments remain separate in the full receipt.','checks'));}
    const representatives=el('details');representatives.append(el('summary','Inspect exact real positive/mismatch/fallback controls — historical model judgments'));
    for(const row of cohort.representatives||[]){const data=row.observed||{},q=row.recordedGenerator?.receipt?.parsed,panel=el('div');panel.append(el('h3',data.cellId||'Recorded control'),el('p','Requested '+(data.difficulty?.requested||'unknown')+'; declared '+(data.difficulty?.candidateDeclared||'unknown')+'; assessed '+(data.difficulty?.judgeAchieved||'unknown')+'. Kind fulfilled: '+String(data.requestedKindFulfilled)+'. Lab eligible: '+String(data.combinedLabEligible)+'.','caption'));if(q)panel.append(lazy('Exact retained parsed candidate',q));for(const capture of row.captures||[])if(capture.file)panel.append(fileLink(capture.stage+' · complete exact capture',capture.file),document.createTextNode(' · '));representatives.append(panel);}box.append(representatives,lazy('Bounded task-demand audit: exact fields, trace pins and limitations',visual.taskDemandAudit));
  }else box.append(el('p','The independent task-demand audit is pending; no model success rate is inferred.','empty'));
  const implementation=visual.taskDemandImplementation?.receipt,currentHeadroom=visual.demandCurrentHeadroom?.receipt,pipeline=visual.demandPipelineControls?.receipt;
  if(implementation){
    const current=el('article');current.id='task-demand-current';current.append(el('h3','New selected-request task-demand gate — engineered, with model validation pending'),el('p',implementation.scope,'notice'),el('p','Protocol: '+(implementation.protocol||'Not recorded')+'. State: '+implementation.state+'. The historical P04 result is preserved; a new simulated control does not replace its model judgment.','caption'));
    const behavior=el('ul');for(const item of implementation.behavior||[])behavior.append(el('li',item));current.append(behavior,el('p','The gate binds the requested task to the reviewed candidate, source and teacher requirements. A model’s reported cognitive level is still a judgment that needs calibration; passing these scripted mechanics cannot prove that a new real question is conceptually hard.','checks'));
    if(implementation.tests)current.append(evidenceTable('Current integrated engineering check — not a semantic-quality denominator',['Suites','Passed / total','Failed','Terminal exit'],[[fmt(implementation.tests.suites),fmt(implementation.tests.passed)+' / '+fmt(implementation.tests.total),fmt(implementation.tests.failed),fmt(implementation.tests.exitCode)]]),el('p','The local operator mechanics tests above are a separate scope. Overlapping core/pipeline checkpoints and earlier successes are not added to this integrated count.','caption'));
    if(pipeline){current.append(el('p',pipeline.scope,'caption'));const controls=el('details');controls.append(el('summary','Inspect '+fmt(pipeline.tests?.length)+' selected public-save, adoption and historical-retry controls'));controls.append(evidenceTable('Selected scripted pipeline controls — model and persistence boundaries are mocked',['Exact control','Recorded outcome'],(pipeline.tests||[]).map(row=>[row.test,row.status])));current.append(controls,el('p',pipeline.historicalBoundary,'caption'),el('p','Freeform regeneration: '+pipeline.regenerationTargets,'caption'));}
    if(currentHeadroom){
      current.append(el('h3','Input cost: per-call headroom and the whole-run ceiling are separate'),evidenceTable('Exact current six-case input construction — conservative admission units, not billed tokens',['Control','Initial input','Largest of three corrections','Corrections fitting input cap'],(currentHeadroom.summary||[]).map(row=>[row.caseId,fmt(row.initial?.inputEstimate),fmt(row.largestCorrectionEstimate),fmt(row.correctionFits)+' / '+fmt(row.correctionCount)])),el('p',fmt(currentHeadroom.initialCount)+' unique initial prompts and '+fmt(currentHeadroom.correctionCount)+' actual correction payloads were constructed with injected malformed responses. They fit the unchanged '+fmt(currentHeadroom.limits?.maxInputTokens)+' per-call input ceiling. Exact original source/Bank/candidate/teacher data remain deep-equal outside three explicit control-metadata keys; absent-selector historical initial bytes match on '+fmt(currentHeadroom.legacyAbsentSelectorBytesIdentical)+' controls.','caption'));
      const aggregate=currentHeadroom.aggregateWorstMeasured||{},snapshot=aggregate.full16SendSimulation?.snapshot||{};
      current.append(el('p','The measured worst-case '+fmt(aggregate.hypotheticalSends)+'-send scenario would require '+fmt(aggregate.conservativeInputPlusOutputUnits)+' admission units. Under the unchanged '+fmt(currentHeadroom.limits?.maxEstimatedTokens)+' ceiling, the real budget simulation stops after '+fmt(snapshot.observedSends)+' admissions with '+fmt(snapshot.admissionTokens)+' reserved. Sixteen is a maximum, not a promise that every correction and role review can run. No limits were raised to make the test fit.','notice'));
      const history=visual.demandHeadroomHistory?.receipt;if(history?.failureHistory?.R1PerCallRefusals)current.append(evidenceTable('Preserved first headroom failures — subsequently compacted instructions only',['Control','Malformed-response scenario','Refused correction input'],history.failureHistory.R1PerCallRefusals.map(row=>[row.caseId,row.scenario,fmt(row.correctionEstimate)])),el('p',history.requestedKindBasis,'caption'));
      current.append(lazy('Current exact prompt pins, conservative budget snapshots and limits',visual.demandCurrentHeadroom));
    }
    for(const item of implementation.legacyPreservation||[])current.append(el('p',item,'caption'));
    current.append(el('p','Initial pipeline verification failures and intermediate receipts remain in the full implementation receipt. Synthetic review labels and mocked persistence test the real control flow; this phase saved no real Draft and produced no new semantic judgment.','caption'),lazy('Complete new implementation verification, test scope and retained failure history',visual.taskDemandImplementation));
    box.append(current);
  }
  const paid=visual.currentPaidProbe?.receipt;
  if(paid){const historical=Boolean(D.pageTextObligations?.verification);box.append(el('h3',historical?'Historical r6 preparation — unexecuted after later production edits':'Fresh r6 preparation — no paid execution'),el('p',(historical?'At this earlier checkpoint, state was: ':'State: ')+paid.state+'. '+fmt(paid.codeFiles)+' current and archived code pins were verified at preparation; '+fmt(paid.historicalR5ArchiveFilesVerified)+' historical r5 archive files and '+fmt(paid.priorLedgersVerified)+' prior ledgers remained preserved. '+(historical?'Later page-observation production changes make r6 historical. A fresh prospective declaration is required; inspect the newer page-text chapter. ':'R5 is historical and unexecuted. The r6 declaration is prepared and unexecuted. ')+'Explicit API approval remains pending.','notice'),el('p','Recorded limits: '+fmt(paid.limits?.maxSends)+' sends maximum; '+fmt(paid.limits?.maxInputTokens)+' input units per call; '+fmt(paid.limits?.maxOutputTokens)+' output cap; '+fmt(paid.limits?.maxEstimatedTokens)+' conservative total units. Preparation and file-only simulation provide no provider usage or semantic result.','caption'),el('p',paid.note,'caption'));if(paid.declaration)box.append(fileLink('Open the exact retained r6 declaration',paid.declaration));box.append(lazy('Retained r6 preparation and its historical code pins',visual.currentPaidProbe));}
  box.append(el('h3','Scope, local cost and next evidence required'));
  const local=visual.localVerification?.receipt,measurement=inventory?.measurement||{};
  if(inventory?.measurement)box.append(evidenceTable('Measured local operator audit — separate from generation latency and tokens',['Measure','Recorded observation'],[['Audit wall time',fmt(measurement.elapsedMs)+' ms'],['Final output directory',local?.finalRunDirectoryBytes===undefined?'Not recorded':fmt(local.finalRunDirectoryBytes)+' bytes'],['Maximum sampled worker RSS',fmt(measurement.maximumWorkerRssBytes)+' bytes'],['Concurrent file workers',fmt(measurement.limits?.concurrency)],['Maximum selected diagnostic pages',fmt(measurement.limits?.queuePages)],['Maximum selected pages per file',fmt(measurement.limits?.queuePerFile)]]),el('p','These measurements are one local corpus run. They do not measure upload/index/model latency, provider tokens, repeated-run performance or semantic recall. The optional canvas/polyfill warnings remain in per-file diagnostics; this operator/text audit did not render or interpret pages.','caption'));
  if(local)box.append(el('p','Separate local mechanics verification: '+fmt(local.unitTestCount)+' tests; typecheck exit '+fmt(local.typecheck?.exitCode)+'; lint exit '+fmt(local.lint?.exitCode)+'. Earlier failures and intermediate runs remain linked in that receipt; counts are not added to the question-pipeline suites.','caption'),lazy('Exact local audit verification, preserved failures and resource limits',visual.localVerification));
  box.append(el('p','The audit performs local observation work only. Existing source text and numerical evidence stay usable under their existing gates. A suspected visual page supplies no automatic LO, source proof or permission to infer missing numerical values. Any later page interpretation needs its own bounded source evidence, uncertainty checks and authorization.','notice'));
  for(const [label,pin] of [['Final offline verification and currentness boundaries',visual.verification],['Complete per-file/page ledger summary and local timing/storage',visual.inventory],['Local mechanics verification and retained failures',visual.localVerification],['Bounded diagnostic queue',visual.priorityQueue],['Original-page renders, exact text and source-only observations',visual.originalPageChecks],['Root source-integrity checks',visual.rootIntegrityCheck],['Historical task-demand audit and historical code pins',visual.taskDemandAudit],['New task-demand implementation verification',visual.taskDemandImplementation],['Selected real pipeline controls with mocked boundaries',visual.demandPipelineControls],['New prospective paid-probe preparation — not execution',visual.currentPaidProbe]])if(pin)box.append(lazy(label,pin),fileLink('Open complete '+label.toLowerCase(),pin));
  if(visualVerified?.newProviderCalls!==undefined)box.append(el('p','New provider calls: '+fmt(visualVerified.newProviderCalls)+'. New saved Drafts: '+fmt(visualVerified.newSavedDrafts)+'. New applied outlines: '+fmt(visualVerified.newAppliedOutlines)+'. Teacher acceptance and improved saved yield remain unmeasured.','caption'));
  document.getElementById('overview').after(box);
  const latest=el('div');latest.id='latest-visual-source-obligations';latest.append(el('h3','Latest — original-page obligations and requested-task controls'),el('p','Inspect the local page ledger, original chart/table controls and historical task-fulfillment failures, followed by the new demand gate and its bounded offline controls. Observed objects, mapped text and scripted success are not completed visual interpretation or teacher acceptance.','notice'));
  const jump=el('a','Inspect original pages, the bounded queue and request-fulfillment evidence');jump.href='#visual-source-obligations';latest.append(jump);document.querySelector('#overview h2').after(latest);
  if(implementation){const jump=el('a','Inspect the current task-demand repair and exact engineering/cost limits');jump.href='#task-demand-current';latest.append(document.createTextNode(' · '),jump);}
}
const pageText=D.pageTextObligations||{},pageTextFinal=pageText.verification?.receipt;
if(pageTextFinal){
  const replay=pageText.replay?.receipt,totals=replay?.totals||{},ocr=pageText.ocr?.receipt,cells=pageText.cells?.receipt;
  const lazy=(title,value)=>{const d=el('details');d.append(el('summary',title));let loaded=false;d.addEventListener('toggle',()=>{if(d.open&&!loaded){loaded=true;d.append(el('pre',typeof value==='string'?value:pretty(value)));}});return d;};
  const link=(label,pin)=>{const a=el('a',label);a.href='../../'+pin.path;return a;};
  const box=el('section',undefined,'chapter');box.id='page-text-obligations';
  box.append(el('div','17 OCT / PHYSICAL-PAGE TEXT INPUT AND OUTPUT','chapter-number'),el('h2','Physical pages retain an independent text observation'),el('p','A mapped passage from one chunk can contain a footer from a sparse page and useful teaching text from the next page. The new optional metadata records each original physical page separately. It preserves native text and existing question/outline behavior; it supplies no new visual interpretation or coverage credit.','notice'));
  box.append(evidenceTable('Actual ten-file replay — same original PDFs and retained native inputs',['Input or output','Recorded result'],[['Original PDFs',fmt(totals.files)],['Physical pages accounted',fmt(totals.pages)],['Blank native text',fmt(totals.blank)],['Sparse native text: fewer than 120 non-whitespace characters',fmt(totals.sparse)],['Native text present: at least 120 characters',fmt(totals.present)],['Visual interpretation unknown',fmt(totals.visualInterpretationUnknown)],['Teaching coverage not assessed',fmt(totals.teachingCoverageNotAssessed)],['File-only observation/projection wall time',fmt(replay?.elapsedMs)+' ms']]),el('p','The '+fmt(replay?.elapsedMs)+' ms measurement covers the production pure builder/projection over already retained native receipts. It excludes fresh upload, PDF parsing, OCR, embedding, model calls and end-to-end generation latency. Blank/sparse/present measure text volume; a short title can be sparse while a chart’s axis labels can make its native text present.','caption'));
  if(replay?.files)box.append(evidenceTable('Actual observed corpus states by file — no synthetic UI counts',['Original chapter','Physical pages','Blank','Sparse','Present'],replay.files.map(file=>{const counts=file.observation?.counts||{};return ['Chapter '+file.chapter,fmt(counts.total),fmt(counts.blank),fmt(counts.sparse),fmt(counts.present)];})));
  if(pageText.replay)box.append(link('Open exact ten-file inputs, outputs, compressed ranges and source hashes',pageText.replay),lazy('Bounded per-file observation summary and original input identities',pageText.replay));
  const original=D.visualSourceObligations?.originalPageChecks?.receipt?.pages?.find(row=>row.chapter===10&&row.physicalPage===10),control=replay?.rasterTableControl;
  const historical=D.outlineContinuation?.result?.receipt?.child?.structureResult,point=historical?.evidence?.find(row=>row.id==='E785'),target=historical?.coverage?.sourceInventory?.targets?.find(row=>row.materialId===point?.materialId&&row.evidenceIds?.includes('E785')&&row.passageId===point?.sourcePassageId);
  box.append(el('h3','Concrete control: Chapter 10, physical page 10, remains sparse beside a mapped chunk'));
  const pair=el('div',undefined,'pair'),image=el('div'),text=el('div');
  if(original?.bookFile){const figure=el('figure'),a=el('a'),img=el('img');a.href=original.bookFile;img.src=original.bookFile;img.loading='lazy';img.alt='Unchanged original Chapter 10 physical page 10: regional dividend and buyback table.';a.append(img);figure.append(a,el('figcaption','Reuses the original pinned raster-table page already shown in the previous chapter. No new render or duplicate source payload.'));image.append(figure);}
  if(original?.originalPdf){const a=link('Open original PDF at physical page 10',original.originalPdf);a.href+='#page=10';image.append(a);}
  text.append(el('p','Native input: '+fmt(original?.nativeText?.wordCount)+' footer words and '+fmt(control?.nonWhitespaceCharacters)+' non-whitespace characters. New output: '+(control?.state||'not recorded')+'. Interpretation remains unknown; teaching coverage remains unassessed.','checks'));
  if(original?.nativeText?.text!==undefined)text.append(el('pre',original.nativeText.text));
  if(point&&target){text.append(el('p','The retained outline separately marks '+target.passageId+' / E785 as '+target.status+' in stored chunk index '+point.chunkIndex+'. That quote spans page footers and a following-page payout formula. The mapped passage does not mean this page’s regional table was read.'),lazy('Exact historical mapped passage — existing immutable receipt',{materialId:point.materialId,chunkIndex:point.chunkIndex,learningPoint:point.objective,status:target.status,passageId:target.passageId,quote:target.quote,supportingPassages:point.supportingPassages}),el('p','The historical outline and later provenance replay use distinct material IDs. Their original PDF identities remain pinned separately; no old record or mapping was rewritten.','caption'));}
  pair.append(image,text);box.append(pair);
  box.append(el('h3','One local OCR diagnostic on that same original image'));
  if(ocr&&cells){box.append(evidenceTable('Recorded OCR process — local diagnostic, not production source admission',['Measurement','Observed result'],[['Tool',ocr.toolVersion],['Recorded local OCR runs',fmt(pageTextFinal.localOCR?.calls)],['Native retained words',fmt(ocr.nativeRetainedWords)],['OCR words',fmt(ocr.wordCount)],['Local OCR wall time',fmt(ocr.elapsedMs)+' ms'],['Specified cells inspected',fmt(cells.selectedCells)],['Exact literal matches in those cells',fmt(cells.exactLiteralMatches)],['Literal mismatches retained',fmt(cells.mismatched)]]),el('p','All three selected mismatches preserve an extra vertical table-border glyph. These 21 specified cells showed no observed digit mismatch, but they do not measure whole-table OCR accuracy, row/column interpretation or semantic correctness. Coordinates were manually specified from the original; table reconstruction is not implemented. No OCR text was admitted to production source evidence.','notice'));
    const chosen=(cells.cells||[]).filter(row=>row.exactLiteralMatch===false||row.column==='Number of firms');
    box.append(evidenceTable('Selected literal controls — all three failures plus three number-of-firms cells',['Region','Specified column','Expected literal','Observed literal','Exact match'],chosen.map(row=>[row.region,row.column,row.expectedLiteral,row.observedLiteral,row.exactLiteralMatch?'Pass':'Mismatch'])));
    const manual=pageText.manualControls?.receipt;if(manual?.labelTiming)box.append(el('p',manual.labelTiming,'caption'));
    for(const [label,pin] of [['Complete recorded OCR input, command, timings and TSV identity',pageText.ocr],['All 21 specified cell results, coordinates and limitations',pageText.cells],['Original manual cell controls and labeling timing',pageText.manualControls]])if(pin)box.append(lazy(label,pin),link('Open '+label.toLowerCase(),pin));
  }
  box.append(el('h3','Production UI checks use a separate, explicitly synthetic denominator'),el('p','The screenshots below exercise the compiled source-coverage renderer with hostile names, intercepted APIs and a synthetic ten-file/599-page fixture: 10 blank, 10 sparse and 579 present. They are not the actual corpus distribution above (0 blank, 111 sparse, 488 present). The fixture checks pinned hrefs without opening the source API.','notice'));
  const shots=el('div',undefined,'pair');for(const shot of pageText.screenshots||[]){const figure=el('figure'),a=el('a'),img=el('img');a.href=shot.bookFile;img.src=shot.bookFile;img.loading='lazy';const mobile=shot.path.includes('mobile');img.alt=(mobile?'Mobile dark':'Desktop light')+' synthetic native-page text UI with literal hostile source name and independently paginated physical pages.';a.append(img);figure.append(a,el('figcaption',(mobile?'Mobile dark':'Desktop light')+' · synthetic 10 blank / 10 sparse / 579 present · native-table counts are not a live-course or actual-corpus result.'));shots.append(figure);}box.append(shots);
  box.append(evidenceTable('Independent engineering scopes — do not add overlapping checkpoints',['Scope','Recorded checks','Meaning'],[['New physical-page UI',fmt(pageTextFinal.ui?.newTests),'Static intercepted rendering, pagination, escaping and scoped accessibility'],['Existing source-coverage UI regression',fmt(pageTextFinal.ui?.existingRegression?.expected),'Previously supported source/passage behavior'],['Current scripted/unit integration',fmt(pageTextFinal.unitTests?.passed)+' passed / '+fmt(pageTextFinal.unitTests?.suites)+' suites','Mocked adapters and actual pure helpers; no new live ingest or semantic labels']]),el('p',pageTextFinal.ui?.rootImageReview,'caption'));
  if(pageText.browserLaunchFailure)box.append(el('p','The first UI attempt stopped before any browser test because the sandbox blocked its local static-server bind. The rerun used scoped execution; the original launch failure is preserved.','caption'),link('Inspect the original pre-browser launch failure',pageText.browserLaunchFailure));
  box.append(el('h3','Current limits and the next unresolved work'),el('p',pageTextFinal.priorDeclaration?.state,'notice'));
  if(pageText.priorDeclaration)box.append(link('Inspect retained r6 preservation and all 260 historical archive identities',pageText.priorDeclaration));
  if(pageText.nextDuplicateGap){box.append(el('p','At this checkpoint, a separate synthetic Bank-memory audit found the 121st same-LO head and 81st cross-LO head outside bounded recent snapshots. That gap was still unresolved by the page-text work; the original observation remains preserved.','caption'),link('Open the exact historical memory-window audit',pageText.nextDuplicateGap));if(D.exactBankRepair?.verification){const a=el('a','Inspect the later exact normalized Bank repair and its separate validation');a.href='#exact-bank-repair';box.append(document.createTextNode(' · '),a);}}
  const boundaries=pageTextFinal.boundaries||{};box.append(el('p','Recorded new paid provider calls: '+fmt(boundaries.paidProviderCalls)+'. New database runs: '+fmt(boundaries.newDatabaseRuns)+'. New saved Drafts: '+fmt(boundaries.newSavedDrafts)+'. New applied outlines: '+fmt(boundaries.newAppliedOutlines)+'. Local OCR model diagnostics: '+fmt(boundaries.localOCRCalls)+'. All 599 actual page interpretations remain unknown. Neither native-volume metadata nor this selected-cell OCR check establishes valid question yield or professor acceptance.','checks'),lazy('Final exact verification, source pins, testing scopes and remaining limits',pageText.verification),link('Open final page-observation verification',pageText.verification));
  document.getElementById('overview').after(box);
  const latest=el('div');latest.id='latest-page-text-obligations';latest.append(el('h3','Latest — exact page-text inputs, independent sparse pages and bounded local OCR'),el('p','Actual 599-page replay: 111 sparse, 0 blank, 488 present. The original raster table stays independently inspectable beside a historically mapped chunk; local OCR and synthetic UI checks retain separate denominators. No new model-quality or saved-yield result.','notice'));const jump=el('a','Inspect actual page observations, literal OCR failures and the separate UI evidence');jump.href='#page-text-obligations';latest.append(jump);document.querySelector('#overview h2').after(latest);
}
const bankRepair=D.exactBankRepair||{},bankFinal=bankRepair.verification?.receipt;
if(bankFinal){
  const replay=bankRepair.replay?.receipt,mongo=bankRepair.mongo?.receipt,policy=bankFinal.policy||{},ui=bankRepair.ui?.receipt;
  const lazy=(title,value)=>{const d=el('details');d.append(el('summary',title));let loaded=false;d.addEventListener('toggle',()=>{if(d.open&&!loaded){loaded=true;d.append(el('pre',typeof value==='string'?value:pretty(value)));}});return d;};
  const link=(label,pin)=>{const a=el('a',label);a.href='../../'+pin.path;return a;};
  const box=el('section',undefined,'chapter');box.id='exact-bank-repair';
  box.append(el('div','17 OCT / EXACT CURRENT-BANK COVERAGE','chapter-number'),el('h2','Exact repeats beyond recent memory now have a separate bounded check'),el('p','The same unchanged candidate was previously missed when its identical current question sat outside the recent semantic-memory window. The new versioned check scans normalized current content across the course before independent v2 persistence. It does not extend the semantic prompt window or prove conceptual novelty.','notice'));
  if(bankRepair.input?.receipt?.candidate)box.append(questionPanel('Exact unchanged synthetic candidate used in the before/after replay',bankRepair.input.receipt.candidate));
  const primary=(replay?.cases||[]).filter(row=>['same-lo-121','cross-lo-81'].includes(row.id));
  box.append(evidenceTable('Same candidate and declared Bank contents — actual old/new pure modules, mocked collections',['Control','Old versions loaded','Old exact matches','New current versions checked','New exact matches','New scan status'],primary.map(row=>[row.id,fmt(row.before.entries),fmt(row.before.matches.filter(match=>match.kind==='exact-duplicate').length),fmt(row.after.receipt.versionsChecked),fmt(row.after.receipt.exactMatchCount),row.after.receipt.status])),el('p','The primary candidate content is byte-preserved, and the 121-head and 81-head fixtures reproduce the retained input declarations. Both old results already declared truncated memory. The new result closes the normalized exact-content omission; it does not turn these synthetic fixtures into real question-quality or teacher labels.','caption'));
  if(replay){box.append(lazy('Exact candidate/input hashes, original before/after source pins and all 13 controls',bankRepair.replay),link('Open all 13 same-input replay controls',bankRepair.replay));const controls=el('details');controls.append(el('summary','Inspect all 13 deterministic controls, including negative and incomplete cases'),evidenceTable('Exact matching and semantic variants remain distinct',['Control','Old recorded comparison','New exact matches','New status / reason'],replay.cases.map(row=>[row.id,row.before.matches.length?row.before.matches.map(match=>match.kind).join(', '):'No recorded match',fmt(row.after.receipt.exactMatchCount),row.after.receipt.status+(row.after.receipt.incompleteReason?' · '+row.after.receipt.incompleteReason:'')])));box.append(controls);}
  box.append(el('h3','Actual isolated Mongo control: 202 current heads, two exact repeats'));
  const real=mongo?.groups?.find(row=>row.name==='legacy-window-versus-all-heads'),race=mongo?.groups?.find(row=>row.name==='real-course-fence-competing-writes');
  if(real)box.append(evidenceTable('Real local Mongo with synthetic owned data — separate from the file-only replay',['Measure','Recorded observation'],[['Same-LO / cross-LO current heads',fmt(real.ownHeads)+' / '+fmt(real.crossHeads)],['Old bounded versions selected',fmt(real.legacySelectedHeads)],['Old exact matches',fmt(real.legacyExactMatches)],['New heads scanned / current versions checked',fmt(real.exactReceipt.headsScanned)+' / '+fmt(real.exactReceipt.versionsChecked)],['New exact matches',fmt(real.exactReceipt.exactMatchCount)],['New exact scan status',real.exactReceipt.status],['All local control groups',fmt(mongo.groups.length)],['Recorded all-controls elapsed',fmt(mongo.elapsedMs)+' ms']]));
  if(race)box.append(evidenceTable('Actual replica-set competing writes through the production course fence',['Observed outcome','Recorded result'],[['Topology',race.topology],['Executed / simulated',String(race.executed)+' / '+String(race.simulated)],['Committed synthetic head',fmt(race.fulfilled)],['Rejected competing write',race.rejected.join(', ')],['Current exact matches after the control',fmt(race.exactCurrentMatches)],['Transaction callback invocations',fmt(race.transactionCallbackInvocations)]]),el('p','One synthetic write committed and the competing write received the duplicate rejection. This was an actual replica-set transaction control, not a mocked concurrency claim. The owned database was subsequently dropped. It created no product Draft or adopted question, and does not establish the same concurrency guarantee on a standalone deployment.','checks'));
  if(mongo)box.append(el('p','The '+fmt(mongo.elapsedMs)+' ms figure is the recorded elapsed time for all nine local controls. It is not question-generation latency, a full production workload benchmark or the latency of a 20,000-head Bank. Application database used: '+String(mongo.applicationDatabaseUsed)+'. Owned database drop confirmed: '+String(mongo.cleanup?.dropped)+'. The course/keyset index was tested only inside this owned database; application indexes were not changed.','caption'),lazy('Actual local Mongo groups, explicit sessions, query diagnostics and cleanup',bankRepair.mongo),link('Open the actual isolated Mongo receipt',bankRepair.mongo));
  box.append(el('h3','Versioned scope, source bindings and bounded cost'),el('p','Protocol: '+policy.selector+'. '+policy.default+' '+policy.intent,'notice'),el('p',policy.semanticMemory,'checks'),el('p','The normalized fingerprint includes explanations, option roles, numeric kind, parameter definitions and derived formulas. A different explanation or metadata can therefore change the hash even when a student sees similar wording. This is not all visible-repeat detection or semantic equivalence. Imported/current versions can be checked without prepared pedagogical fingerprints.','caption'));
  box.append(evidenceTable('Deterministic scan limits and final-save behavior',['Control','Recorded policy'],[['Keyset page size',fmt(policy.ceilings?.pageSize)+' heads'],['Maximum heads',fmt(policy.ceilings?.maxHeads)],['Time ceiling',fmt(policy.ceilings?.maxMs)+' ms'],['Semantic prompt memory','120 recent same-LO + 80 recent cross-LO heads; unchanged'],['Final save/adoption',policy.finalSave],['Declared index and tested scope',policy.index]]),el('p','The candidate/course/count/digest receipt is validated and the lookup is repeated within the final course-fenced write. Missing or invalid current versions and scan ceilings remain explicit incomplete checks. A zero-match partial scan is not treated as uniqueness. The look-ahead count is only an unscanned-head lower bound, not an estimate of the remaining Bank size.','caption'));
  const boundaries=bankFinal.boundaries||{};
  box.append(evidenceTable('Additional work from this exact-match step — no new model prompt',['Cost or boundary','Recorded result'],[['Paid provider / embedding attempts',fmt(boundaries.providerAttempts)+' / '+fmt(boundaries.embeddingAttempts)],['Additional model input / output tokens',fmt(boundaries.inputTokens)+' / '+fmt(boundaries.outputTokens)],['Application database used',String(boundaries.applicationDatabaseUsed)],['Product Drafts saved / candidates adopted',fmt(boundaries.productSavedDrafts)+' / '+fmt(boundaries.productAdoptedCandidates)],['Transient synthetic committed heads',fmt(boundaries.transientOwnedTransactionHeadsCommitted)],['Owned transient database dropped',String(boundaries.transientDatabaseDropped)]]),el('p','The new step spends database reads, hashing/CPU and bounded transaction work rather than adding the entire Bank to a model prompt. Existing generation, evidence and semantic-review calls retain their own token costs. This phase does not measure lower total authoring cost or a better cost per useful question.','caption'));
  box.append(el('h3','Compact receipts in the existing generation and regeneration checks'),el('p','The two captures below are explicitly synthetic UI inputs: 121 current versions checked and zero exact matches. They demonstrate scope wording, counts, missing/incomplete detail and narrow-layout wrapping. They are separate from the actual Mongo control with 202 checked versions and two matches.','notice'));
  const shots=el('div',undefined,'pair');for(const shot of bankRepair.screenshots||[]){const figure=el('figure'),a=el('a'),img=el('img');a.href=shot.bookFile;img.src=shot.bookFile;img.loading='lazy';const mobile=shot.path.includes('mobile');img.alt=(mobile?'Mobile dark':'Desktop light')+' exact Bank receipt: synthetic 121 current versions checked and zero matches; semantic-memory limits remain separate.';a.append(img);figure.append(a,el('figcaption',(mobile?'Mobile dark':'Desktop light')+' · synthetic 121 checked / 0 matches · actual isolated Mongo uses 202 / 2.'));shots.append(figure);}box.append(shots);
  box.append(evidenceTable('Current engineering verification — separate test scopes',['Scope','Recorded result','Practical limit'],[['Current scripted regression',fmt(bankFinal.unitTests?.passed)+' passed / '+fmt(bankFinal.unitTests?.suites)+' suites / '+fmt(bankFinal.unitTests?.failed)+' failed','Helper and admission tests are included, not added again'],['Compiled generation/regeneration UI',fmt(bankFinal.ui?.cases)+' cases','Intercepted synthetic receipts; no actual Bank scan'],['Actual owned local Mongo',fmt(bankFinal.localMongo?.groups)+' groups','Real database/fence mechanics with a synthetic eligible semantic shell']]),el('p',bankFinal.ui?.rootImageReview,'caption'));
  const first=bankRepair.priorFailedTests?.receipt;if(first)box.append(el('p','The first combined regression recorded 931 passes and one Supertest ECONNRESET. The exact command was repeated without a source change; the final 932 passed. The original diagnostic remains preserved rather than being rewritten as a successful run.','caption'),lazy('Retained first combined regression transport failure',bankRepair.priorFailedTests));
  if(ui?.failureHistory)box.append(lazy('UI scope and initial local-bind, discovery and selector failures',bankRepair.ui));
  box.append(el('h3','What remains unmeasured'),el('p',bankFinal.pendingPaidProbe,'notice'),el('p','No new model response, semantic false-refusal repair outcome, valid-question yield, model ranking or professor acceptance was measured. Native page observations still describe text volume; visual source meaning remains unresolved. The original narrow-memory gap and all earlier tests stay as historical checkpoints, with this newer exact repair linked alongside them.','checks'));
  for(const [label,pin] of [['Final exact-Bank verification and current source pins',bankRepair.verification],['Same-input controls and unchanged old-source bindings',bankRepair.replay],['Compact original candidate projection; complete fixture linked',bankRepair.input],['Actual Mongo terminal integrity and cleanup verification',bankRepair.mongoVerification],['Compiled UI verification and screenshots',bankRepair.ui],['Design and implementation contract',bankRepair.docs]])if(pin)box.append(link(label,pin),lazy(label+' · bounded receipt',pin));
  document.getElementById('overview').after(box);
  const latest=el('div');latest.id='latest-exact-bank-repair';latest.append(el('h3','Latest — exact current-Bank repeats beyond recent semantic memory'),el('p','Same-input 121/81 misses now have exact matches; actual owned Mongo checks 202 current heads and finds both repeats. Separate replica-set competing writes commit once and reject the duplicate. No new model-quality or saved-yield claim.','notice'));const jump=el('a','Inspect exact old/new inputs, actual Mongo/concurrency and compact UI receipts');jump.href='#exact-bank-repair';latest.append(jump);document.querySelector('#overview h2').after(latest);
}
const taskRepair=D.taskRetrievalRepair||{},taskFinal=taskRepair.verification?.receipt;
if(taskFinal){
  const replay=taskRepair.replay?.receipt,input=taskRepair.input?.receipt,headroom=taskRepair.headroom?.receipt,firstHeadroom=taskRepair.headroomInitial?.receipt;
  const lazy=(title,value)=>{const d=el('details');d.append(el('summary',title));let loaded=false;d.addEventListener('toggle',()=>{if(d.open&&!loaded){loaded=true;d.append(el('pre',pretty(value)));}});return d;};
  const link=(label,pin)=>{const a=el('a',label);a.href='../../'+pin.path;return a;};
  const box=el('section',undefined,'chapter');box.id='task-retrieval-repair';
  box.append(el('div','17 OCT / CURRENT-COURSE TASK RETRIEVAL','chapter-number'),el('h2','Older tasks can enter the same bounded comparison call'),el('p','The preceding exact-content check remains separate. This change traverses current course questions before local nomination, rather than ranking only recent 120/80 snapshots. A nominated question is a comparison candidate, not a duplicate verdict. For independent tasks, the quality call must explicitly compare each required inference and solution path; explicit edits and variants retain intentional-overlap semantics.','notice'));
  if(input?.candidate)box.append(questionPanel('Exact synthetic candidate retained across the before/after task-memory replay',input.candidate));
  const examples=(input?.examples||[]).filter(row=>['same-lo-older-121','cross-lo-older-81'].includes(row.id));
  if(examples[0]?.target)box.append(questionPanel('Older declared current question — a scripted same-task target with different content',examples[0].target),el('p','The fixture relation is declared by the test author. It is not a new teacher label or a captured model duplicate judgment. The exact linked fixture retains all distractors, feedback, question versions and descriptors.','caption'));
  if(replay){box.append(evidenceTable('Same immutable candidate and Bank fixtures — actual before/after service code with in-memory collections',['Control','Old versions loaded','Old target shown','New current versions checked','New target shown','Required comparison','Traversal'],replay.cases.map(row=>[row.id,fmt(row.before.loadedEntries),String(row.before.targetExposed),fmt(row.after.receipt?.versionsChecked),String(row.after.targetExposed),String(row.after.targetRequired),row.after.receipt?.status??'unavailable'])),el('p','Exposure and mandatory-comparison selection are distinct outputs. A raw question without a prepared descriptor can be exposed without becoming one of the two required comparators. Archived, foreign and obsolete/current-version exclusions remain visible in the controls. No row in this table is a semantic correctness or novelty label.','caption'),lazy('Compact seven-case inputs, exact code hashes, query hashes and current-profile controls',taskRepair.replay),link('Open exact before/after outputs, rendered memory and preserved source copies',taskRepair.replay));}
  box.append(el('h3','What the new versioned path does'),el('ol',undefined,'checks'));
  const steps=box.lastElementChild;for(const text of [
    'New durable v2 requests select course-task-retrieval-v1. Historical absent selectors, exact retries and same-UUID recovery retain their recorded behavior.',
    'Traverse current active course heads in 128-head pages, bounded by 20,000 heads and five seconds. Validate immutable ownership and current/hash-bound profiles; use actual question content when a prepared descriptor is missing.',
    'Locally nominate up to 64 global entries within a maximum 200-entry memory. Retain recent fillers and the immutable original comparator. Keep the existing rendered prompt bounds of 12 entries / 12,000 characters.',
    'For create-independent-task, require explicit inference/path comparison rows for at most two mandatory entries, including the original when required. Independent and uncertain verdicts cannot silently skip a required row; explicit edits/variants retain intentional-overlap semantics and shared terms can have a valid different-inference comparison.',
    'Refresh retrieval for the actual candidate and for a changed repair. Bind the context to the candidate/query and current effective profiles; repeat local currentness and admission checks inside the existing course fence.'
  ])steps.append(el('li',text));
  box.append(el('p','The new branch does not request a new embedding. A query vector can be reused only when an already retained vector has a known provider/model identity and belongs to the exact same query; changed queries use explicit local lexical/profile-text fallback. Neither that heuristic nor a high local score establishes semantic equivalence or recall.','notice'),el('p','The complete mandatory comparator must fit the existing prompt limit. Missing data, invalid identities or scan limits create an explicit shortfall rather than a silent no-duplicate conclusion. For independent tasks, comparison omissions or foreign/duplicate identities remain format/admission failures under the existing correction and send budget. Explicit edit/variant comparison semantics remain unchanged. Exact normalized-content scanning and final-write fencing from the prior chapter remain intact.','checks'));
  const caps=headroom?.limits||{},captures=(headroom?.rows||[]).flatMap(row=>row.captures||[]),initialRefusals=firstHeadroom?.refusedCaptures||[];
  box.append(el('h3','Prompt size and failure history — measured input, no semantic result'));
  if(headroom)box.append(evidenceTable('Current file-only prompt and correction admission',['Measure','Recorded value'],[['Scenarios',fmt(headroom.rows?.length)],['Captured prompts',fmt(captures.length)],['Maximum captured input estimate',captures.length?fmt(Math.max(...captures.map(row=>row.inputEstimate))):'unavailable'],['Per-call input ceiling',fmt(caps.maxInputTokens)],['Per-call output ceiling',fmt(caps.maxOutputTokens)],['Send / total reservation ceilings',fmt(caps.maxSends)+' / '+fmt(caps.maxEstimatedTokens)],['Refused captures',fmt(headroom.refusedCaptures?.length)]]),el('p','These are conservative local input estimates and simulated admissions, not provider-reported token usage. Per-call fit does not prove that every possible multi-call path fits the total budget. Existing limits remain authoritative. No saved-yield or semantic outcome follows from the prompt-size result.','caption'),lazy('Current exact prompt/correction captures and per-scenario budgets',taskRepair.headroom),link('Open current exact prompt and correction receipts',taskRepair.headroom));
  if(firstHeadroom)box.append(el('p','The initial headroom run had '+fmt(initialRefusals.length)+' refused captures. Its exact failures remain preserved below rather than being overwritten by a later input-compaction result.','caption'),evidenceTable('Initial retained headroom refusals',['Case','Scenario','Exact captured file','Input estimate','Admitted'],initialRefusals.map(row=>[row.caseId,row.scenario,row.file,fmt(row.inputEstimate),String(row.admitted)])),lazy('Initial failed headroom receipt',taskRepair.headroomInitial));
  const taskMongo=taskRepair.mongo?.receipt;if(taskMongo){const current=taskMongo.groups?.find(row=>row.name==='legacy-window-versus-current-task-nominations'),race=taskMongo.groups?.find(row=>row.name==='real-course-fence-concurrent-currentness');box.append(el('h3','Separate actual local Mongo controls — synthetic tasks, real reads and course fence'));
    if(current)box.append(evidenceTable('Owned local database: nomination exposure, not a duplicate verdict',['Measure','Observed result'],[['Same-LO / cross-LO heads',fmt(current.ownHeads)+' / '+fmt(current.crossHeads)],['Old retained heads / older targets exposed',fmt(current.legacyRetained)+' / '+fmt(current.legacyTargetHits)],['New current heads / older targets exposed',fmt(current.currentHeads)+' / '+fmt(current.currentTargetHits)],['Rendered selected entries / characters',fmt(current.selectedEntries)+' / '+fmt(current.selectedCharacters)],['Semantic comparison',current.semanticComparison]]));
    if(race)box.append(el('h4','Actual course-fence concurrent writes'),el('p','Observed topology: '+race.topology+'. Committed owned synthetic heads: '+fmt(race.fulfilled)+'. Rejected competing write: '+race.rejected.join(', ')+'.','checks'),evidenceTable('Actual replica-set course-fence currentness control',['Measure','Observed result'],[['Real execution / simulated transaction',String(race.executed)+' / '+String(race.simulatedTransaction)],['Committed owned synthetic head',fmt(race.fulfilled)],['Rejected competing write',race.rejected.join(', ')],['Transaction callback invocations',fmt(race.transactionCallbackInvocations)],['Source-currentness boundary',race.sourceCurrentness]]));
    box.append(el('p','All '+fmt(taskMongo.groups?.length)+' groups took '+fmt(taskMongo.elapsedMs)+' ms together. This is local control-suite elapsed time, not question-generation latency or a production Bank benchmark. Application database used: '+String(taskMongo.applicationDatabaseUsed)+'. Owned database dropped: '+String(taskMongo.cleanup?.dropped)+'. Remaining owned namespace collections: '+fmt(taskMongo.cleanup?.sameOwnedNamespaceCollectionsAfterDrop)+'.','caption'),el('p',taskMongo.semanticAssessment,'notice'),lazy('Actual local Mongo groups, synthetic judgments, currentness limits and cleanup',taskRepair.mongo),link('Open complete actual local Mongo terminal receipt',taskRepair.mongo));
  }
  box.append(el('h3','Same existing Instructor surfaces, compact truthful diagnostics'),el('p','These two captures use synthetic receipts with 202 current versions checked, two nominations and two required comparisons. They show counts and scope wording inside the existing generation checks; they do not show an actual live Bank scan or a completed semantic comparison.','notice'));
  const shots=el('div',undefined,'pair');for(const shot of taskRepair.screenshots||[]){const figure=el('figure'),a=el('a'),img=el('img');a.href=shot.bookFile;img.src=shot.bookFile;img.loading='lazy';const mobile=shot.path.includes('mobile');img.alt=(mobile?'Mobile dark':'Desktop light')+' synthetic task retrieval receipt: 202 current versions checked, two nominations, two required comparisons; local scores are not novelty verdicts.';a.append(img);figure.append(a,el('figcaption',(mobile?'Mobile dark':'Desktop light')+' · synthetic 202 checked / 2 nominated / 2 required.'));shots.append(figure);}box.append(shots);
  box.append(el('p','An incomplete 503 adoption check retains the same candidate and explicit retry. Recognized invalid 422 retrieval/selection bindings retain the previews and unsaved editor text but block stale replacement; only this question’s recovery keys are cleared. Historical absence invents no scan counts. Intercepted error responses test client behavior, not a real server transaction.','checks'));
  const tests=taskFinal.unitTests||{},ui=taskFinal.ui||{},boundaries=taskFinal.boundaries||{};
  box.append(evidenceTable('Engineering evidence — separate scopes',['Scope','Recorded result','Limit'],[['Current scripted regression',fmt(tests.passed)+' passed / '+fmt(tests.suites)+' suites / '+fmt(tests.failed)+' failed','Scripted judgments and collections; not teacher calibration'],['Before/after pure replay',fmt(replay?.cases?.length)+' controls','Declared synthetic task relations; no provider judgment'],['Compiled existing UI',fmt(ui.cases)+' cases / 2 compact captures','Intercepted synthetic receipts, scoped accessibility checks']]),el('p','Earlier focused failures are retained: regeneration fixtures initially omitted the new retrieval receipt. Repairing the fixture tests the newly selected contract; it does not establish that a real model produces better questions.','caption'));
  if(taskRepair.priorFailedTests)box.append(lazy('Retained first focused test failures and subsequent fixture correction',taskRepair.priorFailedTests));
  if(taskRepair.bookReaderHistory)box.append(el('p','The first book-reader check stopped before screenshots because the recorded topology appeared only in an accessible table title. The visible concurrency summary now names the recorded replica-set topology; the original failed reader receipt and first-build hashes remain linked. No evidence or reader assertion was weakened.','caption'),link('Open the original reader failure and first-build artifact hashes',taskRepair.bookReaderHistory),lazy('Book-only visible-topology correction history',taskRepair.bookReaderHistory));
  const archive=taskRepair.sourceArchive?.receipt,oldArchive=taskFinal.preservedPreviousSourceArchive;if(archive)box.append(el('p','The current implementation and combined regression sources have '+fmt(archive.fileCount)+' exact archived copies, totaling '+fmt(archive.totalBytes)+' bytes. The previous exact-Bank archive retains '+fmt(oldArchive?.filesChecked)+' verified unchanged files. The newer chapter does not rewrite those prior source bytes or results.','caption'),link('Open current exact source-copy manifest',taskRepair.sourceArchive),lazy('Current source-copy count and preservation scope',taskRepair.sourceArchive));
  box.append(el('h3','Cost and the open quality goal'),el('p','No new provider or embedding send was made for this phase’s local retrieval/replay and UI checks. Traversal, hashing, descriptor validation and transaction replay spend database/CPU time in production; bounded nominated memory still consumes tokens inside the normal existing quality call. Newly missing required rows may consume the existing same-candidate correction allowance, which costs tokens when executed; runtime model-call counts are not guaranteed unchanged. No new standalone model stage or higher ceiling is introduced. This does not mean zero total authoring cost or lower cost per useful question.','notice'),lazy('Exact phase boundaries and unexecuted paid-work status',{boundaries,pendingPaidProbe:taskFinal.pendingPaidProbe,limits:taskFinal.limits}),el('p','Semantic duplicate recall, false-refusal rate, saved-question yield, professor review time and model calibration remain unmeasured by these engineering controls. R6 remains historical and unexecuted. A fresh prospective declaration and explicit API approval are required before a paid comparison; this chapter performs neither. Visual source interpretation and teacher acceptance remain separate open requirements.','checks'));
  for(const [label,pin] of [['Final task-retrieval verification and current source pins',taskRepair.verification],['Exact unchanged synthetic candidate and declared older targets',taskRepair.input],['Compiled UI cases, initial launch failure and screenshots',taskRepair.ui],['Implementation and verification contract',taskRepair.docs]])if(pin)box.append(link(label,pin),lazy(label+' · bounded receipt',pin));
  document.getElementById('overview').after(box);
  const latest=el('div');latest.id='latest-task-retrieval-repair';latest.append(el('h3','Latest — current-course task nomination with mandatory inference comparisons'),el('p','Older questions can enter a bounded quality comparison, with actual candidate/repair refresh and explicit comparison obligations. Local ranking is not a novelty verdict; no new paid semantic result is claimed.','notice'));const jump=el('a','Inspect exact before/after tasks, prompt headroom failures and compact existing UI');jump.href='#task-retrieval-repair';latest.append(jump);document.querySelector('#overview h2').after(latest);
}
// SUPPORTED_COVERAGE_BOOK_START
{
  const coverageRepair=D.supportedCoverageRepair,proof=coverageRepair?.replay?.receipt,input=coverageRepair?.input?.receipt;
  if(proof&&input){
    const box=el('section',undefined,'chapter');box.id='supported-lo-coverage-repair';
    const link=(label,pin)=>{const a=el('a',label);a.href='../../'+pin.path;return a};
    box.append(el('div','08 / SOURCE-CAPABILITY REPAIR · OFFLINE ONLY','chapter-number'),el('h2','Recover an omitted capability while keeping prior coverage'),
      el('p','The existing source-reviewed outline can contain a supported LO whose wording leaves out a separately taught, assigned capability. A new internal wording-only mode can revisit that selected LO without changing its topic, evidence scope or the other objectives.'),
      el('p','The before example below is an actual retained result. Every new proposal and review response in the after example is explicitly scripted. No paid semantic recovery, new saved question, applied hierarchy or improved yield is claimed.','notice'));
    const metrics=el('div',undefined,'metrics');for(const [number,label] of [['1','selected existing LO'],['1','requested capability · E13'],['2','prior capabilities · E14 / E15'],[fmt(proof.execution?.providerCalls),'new provider calls']]){const cell=el('div',undefined,'metric');cell.append(el('strong',number),el('span',label));metrics.append(cell)}box.append(metrics);
    const point=input.evidence.find(row=>row.id==='E13'),diagnosis=coverageRepair.diagnosis?.receipt;
    box.append(el('h3','The exact original already teaches the missing rationale'),el('p',point.materialName+' · chunk index '+point.chunkIndex+' · '+point.sourcePassageId+' · review alias S4. These are retained source locators, not invented physical page numbers.','caption'),
      el('blockquote',diagnosis?.primaryObservation?.quote||point.quote,'question'),
      el('p','E13 was assigned to both L1 and L4, but no recorded finding credits it. L4 already owns and cites this complete original for E14. The source-reading hypothesis is to state the residual-versus-contractual-claim rationale explicitly; the reviewer did not delete an existing clause. This is an agent diagnosis, not a teacher label.','checks'));
    const pair=el('div',undefined,'pair'),before=el('div'),after=el('div');
    before.append(el('h3','Recorded before — actual completed outline'),el('p',proof.before.name,'question'),el('p','Source finding: '+input.oldTarget.reason),
      evidenceTable('Recorded L4 status and coverage',['Field','Actual retained value'],[['Source status',input.oldTarget.status],['Credited points',proof.before.creditedIds.join(', ')],['Selected uncredited point',proof.before.requestedGloballyUncreditedPoint],['Old pure repair refusal',proof.before.actualOldPureRefusal]]));
    after.append(el('h3','Scripted after — no model dispatch'),el('p',proof.after.proposedName,'question'),el('p','Synthetic wording and synthetic reviewer output demonstrate the new contract only.','notice'),
      evidenceTable('Scripted gain-and-preserve contract',['Field','Synthetic demonstration'],[['Fresh credits',proof.after.targetFinding.coveredEvidenceIds.join(', ')],['Server coverage assessment',proof.after.assessment.status+' · scripted inputs'],['Unchanged sibling findings',fmt(proof.after.unchangedSiblingFindings)],['Parent/source/topic/identity changes','None']]));pair.append(before,after);box.append(pair,
      el('p','The tested difference is one explicit source-backed rationale, while old E14/E15 remain required. The branch cannot claim success by replacing old coverage with the new point. A real model still needs to propose useful wording and pass an independent source review.','checks'));
    if(coverageRepair.wordingAudit){const first=coverageRepair.firstIllustration?.receipt,audit=coverageRepair.wordingAudit.receipt;box.append(el('h3','An initial scripted illustration was too compressed'),el('p','The initial synthetic wording received scripted E14 credit while omitting the explicit observable/continually-updated stock-price rationale. Root’s independent wording inspection identified this weakness. That first result remains preserved; a scripted passed receipt is not semantic proof.','notice'));if(first)box.append(details('Initial illustrative wording and scripted credits — retained, not replaced',pretty({name:first.after.proposedName,scriptedCredits:first.after.targetFinding.coveredEvidenceIds})));box.append(el('p','The revised illustration above explicitly names observability, continual updating, rational-investor assumptions and the old employee/customer/social compatibility alongside E13. Longer wording is justified here to preserve meaning. The revision remains synthetic and receives no measured model-quality claim.','checks'),link('Open the initial immutable replay',coverageRepair.firstIllustration),document.createTextNode(' · '),link('Open the independent wording audit',coverageRepair.wordingAudit),details('Exact scope of the independent wording finding',pretty(audit)));}
    box.append(el('h3','Five ways the child must remain a shortfall'),evidenceTable('Explicitly scripted negative and missing-review controls',['Control','Recorded contract result','Requested points missing','Previous points lost'],proof.controls.map(row=>{const target=row.assessment.targets[0];return[row.id,row.assessment.status,target.missingEvidenceIds.join(', ')||'None',target.lostEvidenceIds.join(', ')||'None']})),
      details('Exact shortfall reasons — server computed, synthetic inputs',pretty(proof.controls)),
      el('p','Missing review is separate from a semantic negative or missing credit. No synthetic negative finding is inserted. Foreign/duplicate references, stale bindings or missing nontarget authority remain malformed failures. The complete parent remains unchanged; no shortfall is automatically applied.','caption'));
    const admission=proof.inputAdmission||{};box.append(el('h3','Bounded input and durable workflow'),
      evidenceTable('Actual complete input construction — conservative units, not billed tokens',['Input / limit','Recorded units'],[['Proposal input',fmt(admission.proposalShapedInput)],['Independent review input',fmt(proof.simulatedReviewAttempts[0]?.estimatedShapedInput)],['Correction input',fmt(admission.maxReviewShapedInput)],['Input ceiling / output reservation',fmt(admission.maxInput)+' / '+fmt(admission.outputReservation)],['Inherited used / remaining units',fmt(admission.inheritedUsedUnits)+' / '+fmt(admission.inheritedRemainingUnits)],['Native reservations in this file-only replay',fmt(admission.actualBudgetReservationsMade)]]),
      el('p','The production pure estimator and AuthoringBudget admission check accept these exact inputs. Two completion callbacks in the shared review loop return injected data; they are not SDK or provider sends. This replay uses no-op currentness/write callbacks, so it does not establish Mongo, Agenda, HTTP or transaction acceptance.','caption'),
      el('p','The new internal mode shares the existing one-parent-checkpoint cycle, at most two targets, revision CAS, source/provider checks and the smaller inherited budget remainder. Limits remain 10 new native reservations, 48,000 input units, 6,000 output units/send and 540,000 new conservative units. Changed wording receives fresh review; every requested point and all prior credited points must survive. A shortfall receipt is persisted before the child fails and skips finalization.','checks'));
    box.append(el('h3','Inspect exact input, output and code identities'));
    const raw=el('details');raw.id='supported-coverage-raw-io';raw.append(el('summary','Open complete local input and explicitly scripted output'));
    for(const [index,row] of coverageRepair.rawIO.entries()){const item=details(row.label,row.text);item.id='supported-coverage-io-'+index;item.append(el('p',row.scope+' SHA-256 '+row.sha256,'caption'),link('Open full pinned file',row));raw.append(item)}box.append(raw);
    const pure=coverageRepair.pureTests?.receipt,service=coverageRepair.serviceTests?.receipt;
    box.append(el('h3','Engineering checks and unchanged interpretation limits'),evidenceTable('Separate focused scopes — do not add overlapping checkpoints',['Scope','Recorded result','What it proves'],[['Pure helper plus old wording regression',pure?fmt(pure.numPassedTests)+' passed / '+fmt(pure.numPassedTestSuites)+' suites':'Not loaded','Strict target/source/delta and gain-with-preservation mechanics'],['Durable service regression',service?fmt(service.numPassedTests)+' passed / '+fmt(service.numPassedTestSuites)+' suite':'Final receipt pending','Mocked authority/CAS/budget/shortfall paths'],['Retained E13/L4 replay','1 scripted positive + 5 scripted shortfalls','Same original inputs; no semantic model result']]));
    if(coverageRepair.initialTests)box.append(el('p','The first pure-test table had a harness-only empty-row/done-callback timeout; the wrapper was corrected without relaxing production checks. A separate VM replay first exposed cross-realm Error constructors; shared host Error restores normal Node module behavior. Both initial failures remain linked.','caption'),details('Retained initial test summary',pretty(coverageRepair.initialTests)));
    const verification=coverageRepair.verification?.receipt;if(verification)box.append(details('Final combined engineering receipt — exact scope retained',pretty(verification)));else box.append(el('p','A combined final engineering receipt has not been loaded at this build. Focused scopes above are recorded separately; missing results are not treated as passing.','empty'));
    box.append(el('p','The 379 uncredited extracted points are not 379 proven curriculum omissions. Some are repeated framing, unanswered activities or faulty extraction titles. The existing L82/L92 withheld-wording pilot and row-aware table fix are separate work. This text-only example does not resolve the 136 visual-review passages or establish coverage of all 599 physical pages.','notice'));
    for(const [label,pin] of [['Exact retained input and full own originals',coverageRepair.input],['Revised replay, synthetic controls and every raw-file hash',coverageRepair.replay],['Initial immutable illustrative replay',coverageRepair.firstIllustration],['Audited pre-change gap and original source references',coverageRepair.diagnosis],['Exact code/input pins and retained source copies',coverageRepair.pins],['Pure focused test report',coverageRepair.pureTests],['Service focused test report',coverageRepair.serviceTests],['Service source pins, initial failed checks and rerun scope',coverageRepair.serviceVerification],['Implementation and compatibility contract',coverageRepair.docs]])if(pin){const paragraph=el('p',undefined,'caption');paragraph.append(link(label,pin));box.append(paragraph)}
    document.getElementById('overview').after(box);
    const latest=el('div');latest.id='latest-supported-coverage-repair';latest.append(el('h3','Latest — selected supported-LO coverage repair, offline proof only'),el('p','One retained omission can enter a source-bound repair that must preserve old coverage. The after demonstration is synthetic; the real 119/142 outline result and original paid ledgers are unchanged.','notice'));const jump=el('a','Inspect actual E13/L4 originals and the scripted gain-and-preserve controls');jump.href='#supported-lo-coverage-repair';latest.append(jump);document.querySelector('#overview h2').after(latest);
  }
}
// SUPPORTED_COVERAGE_BOOK_END
// AUTHORING_FLOW_HEADROOM_BOOK_START
{
  const flow=D.authoringFlowHeadroom;
  if(flow?.versions?.length){
    const box=el('section',undefined,'chapter');box.id='authoring-flow-headroom';
    const link=(label,pin)=>{const a=el('a',label);a.href='../../'+pin.path;return a};
    const flat=version=>version.result.receipt.rows.flatMap(row=>row.captures.map(capture=>({...capture,caseId:row.caseId,scenario:row.scenario})));
    const last=flow.versions.at(-1),record=last.result.receipt,captures=flat(last),actual=captures.filter(row=>row.actualAdmission),fresh=record.refusals.filter(row=>!row.scenario.includes('legacy')),legacy=record.refusals.filter(row=>row.scenario.includes('legacy'));
    box.append(el('div','09 / COMPLETE AUTHORING FLOW · OFFLINE INPUT AUDIT','chapter-number'),el('h2','Measure the complete request, including repair and retry envelopes'),
      el('p','A quality-review prompt fitting its cap does not establish that planning, generation, validation, content review, shape retries, JSON retries and semantic repair also fit. This follow-up runs those actual prompt/admission paths with scripted SDK responses and in-memory adapters.'),
      el('p','No provider or embedding request was sent. Reported provider tokens are unavailable, not a measured zero-token authoring run. Conservative input units, simulated reservations and successful fake responses are engineering evidence only; they do not measure semantic quality or saved yield.','notice'));
    const phases={'run-r4':'Pre-fix capture; raw prompt sizes are not complete transport envelopes','run-r6':'Grouped-original planning only; remaining refusals preserved','run-r7':'Partial generation/repair fixes; fresh and legacy failures remain','run-r8':'Further compact guidance; three fresh refusals remain','run-r9':'Further bounded rendering; one fresh refusal remains','run-r10':'Original 47 scenarios; no fresh input refusals','run-r11':'Adds the actual nested JSON-retry path; six legacy refusals retained'};
    box.append(evidenceTable('Retained input-admission checkpoints — same base controls with explicit fixture variants',['Checkpoint','Scope','Scenario rows / stopped','Actual-envelope pairs / captures','Refused captures','Largest actual input'],flow.versions.map(version=>{const all=flat(version),pairs=all.filter(row=>row.actualAdmission),rows=version.result.receipt.rows;return[version.label,phases[version.label]||'Recorded follow-up',fmt(rows.length)+' / '+fmt(rows.filter(row=>row.outcome==='stopped').length),fmt(pairs.length)+' / '+fmt(all.length),fmt(version.result.receipt.refusals.length),pairs.length?fmt(Math.max(...pairs.map(row=>row.actualAdmission.inputEstimate))):'Not recorded; raw-only checkpoint']})),
      el('p','A missing actual-admission envelope is unknown, not a zero-sized request. The later paired captures retain both the raw before-request prompt and the actual model-admission representation. Every refusal stays in its original receipt; overlapping runs are not added together. A completed scenario means the harness returned, not that all authoring stages passed: a simulated fallback can complete after a refused capture. Stopped scenarios and refused captures therefore use separate denominators.','caption'));
    box.append(el('h3','Latest recorded scope: '+last.label),evidenceTable('Latest measured boundaries — controlled inputs, no model verdict',['Measure','Recorded value'],[['Scenario rows / stopped',fmt(record.rows.length)+' / '+fmt(record.rows.filter(row=>row.outcome==='stopped').length)],['Actual-admission captures',fmt(actual.length)+' / '+fmt(captures.length)],['Fresh-path refused captures',fmt(fresh.length)],['Explicit legacy-path refused captures',fmt(legacy.length)],['Actual provider sends',fmt(record.actualProviderSends)],['Provider input / output tokens',record.observedProviderInputTokens===null&&record.observedProviderOutputTokens===null?'Unavailable — no provider send':fmt(record.observedProviderInputTokens)+' / '+fmt(record.observedProviderOutputTokens)]]));
    const refusalRows=record.refusals.map(row=>[row.caseId,row.scenario,row.stage,fmt(row.inputEstimate),row.reason]);
    if(refusalRows.length)box.append(evidenceTable('Latest refused captures — never relabelled as passing',['Case','Scenario','Stage','Actual input estimate','Guard reason'],refusalRows));
    const stopped=record.rows.filter(row=>row.outcome==='stopped');if(stopped.length)box.append(evidenceTable('Latest stopped scenarios — separate from refused captures',['Case','Scenario','Failure','Progress diagnostics'],stopped.map(row=>[row.caseId,row.scenario,row.failure?.message||'No failure message recorded',row.progressFailures.length?pretty(row.progressFailures):'None recorded'])));
    const nested=record.rows.find(row=>row.scenario==='public-global202-nested-quality-json-retry'),retry=nested?.captures.filter(row=>row.stage==='quality-review');if(retry?.length){box.append(el('h3','The fragile boundary: P02 correction followed by a real JSON-retry envelope'),evidenceTable('Same scripted candidate; unchanged 24,000-unit input ceiling',['Step','Actual conservative input','Headroom'],retry.map((row,index)=>[['Initial quality assessment','Same-candidate correction','Correction JSON retry'][index]||'Further recorded attempt',fmt(row.actualAdmission.inputEstimate),fmt(24000-row.actualAdmission.inputEstimate)])),el('p','The final measured JSON-retry input is 23,916 units, leaving only 84. This narrow margin is not a guarantee for other sources, Bank content, teacher requests or error messages. All scripted public flows still create zero Drafts: fitting every recorded request does not establish an eligible or useful question.','notice'));}
    const checks=el('details');checks.append(el('summary','Inspect every captured stage and its exact prompt files'));
    for(const version of flow.versions){const item=el('details');item.append(el('summary',version.label+' · '+fmt(version.result.receipt.rows.length)+' scenario rows'));for(const row of version.result.receipt.rows){const paragraph=el('p');paragraph.append(el('strong',row.caseId+' / '+row.scenario+' · '+row.outcome));if(row.failure)paragraph.append(document.createTextNode(' · '+row.failure.name+': '+row.failure.message));for(const capture of row.captures){const raw={path:version.result.path.replace(/results\.json$/,'')+capture.file};paragraph.append(document.createTextNode(' · '),link(capture.stage+' raw input',raw));if(capture.actualAdmission){const exact={path:version.result.path.replace(/results\.json$/,'')+capture.actualAdmission.file};paragraph.append(document.createTextNode(' / '),link('actual admission envelope',exact));}}item.append(paragraph)}checks.append(item)}box.append(checks);
    box.append(el('h3','Source identity and historical behavior stay inspectable'));
    for(const version of flow.versions){const p=el('p',undefined,'caption');p.append(link(version.label+' complete result',version.result));if(version.manifest)p.append(document.createTextNode(' · '),link('exact controls, source-copy pins and runtime substitutes',version.manifest));if(version.verification)p.append(document.createTextNode(' · '),link('identity/compatibility verification',version.verification));box.append(p)}
    if(flow.comparisonFailure)box.append(el('p','The first strict all-followups comparison failed: production option shuffling can change later validator/reviewer option order and keys. Historical initial-prompt identity and followup estimates must be reported separately; no broad byte-identity claim follows from equal size. The original failed comparison remains retained.','caption'),details('Exact comparison failure and per-followup differences',pretty(flow.comparisonFailure)));
    if(flow.focusedHistory)box.append(details('Overlapping focused tests and original failures — not additive',pretty(flow.focusedHistory)));
    if(flow.protectedComparison)box.append(details('Exact protected-data comparison — 98 old captures plus seven added retry captures',pretty(flow.protectedComparison)),link('Full original protected-block comparison and hashes',flow.protectedComparison));
    const combined=flow.combinedTests?.receipt;if(combined)box.append(el('p','The integrated offline suite records '+fmt(combined.numPassedTests)+' passed tests across '+fmt(combined.numPassedTestSuites)+' suites. This overlaps the earlier pure/service checkpoints; it is not an additional unique total or a provider acceptance run. The initial combined attempt ended on a sandbox Supertest EPERM before a JSON report; the unchanged external-sandbox rerun is recorded separately.','checks'),link('Integrated test report — exact assertions and scope',flow.combinedTests));
    if(flow.sourceChanges?.length){const changes=el('details');changes.append(el('summary','Compare exact archived helper, template, protocol and integration source changes'));for(const row of flow.sourceChanges){const p=el('p');p.append(el('strong',row.path),document.createTextNode(' · '));if(row.before)p.append(link('r4 before',row.before));else p.append(document.createTextNode('Not present in r4 source manifest'));p.append(document.createTextNode(' / '),link(last.label+' after',row.after),el('small','SHA-256 '+(row.beforeSha256||'new archived file')+' → '+row.afterSha256));changes.append(p)}box.append(changes);}
    if(flow.runnerTrace){const p=el('p',undefined,'caption');p.append(document.createTextNode(flow.runnerTrace.scope+' '),link('Initial archived fixture runner',flow.runnerTrace.before),document.createTextNode(' · '),link('Latest archived fixture/fault inputs',flow.runnerTrace.after));box.append(p);}
    if(flow.verification)box.append(details('Final root verification — exact engineering scope',pretty(flow.verification)),link('Open final full-flow verification',flow.verification));else box.append(el('p','Final full-flow verification is still pending at this build. The latest recorded capture and all its remaining failures are shown above; no pending outcome is counted as passing.','empty'));
    if(flow.engineeringVerification)box.append(details('Final integrated tests, typecheck, lint and exact source archive',pretty(flow.engineeringVerification)),link('Open final source/check receipt',flow.engineeringVerification));if(flow.docs){const p=el('p',undefined,'caption');p.append(link('Implementation, scope and remaining headroom limits',flow.docs));box.append(p);}
    box.append(el('p','No source, teacher requirement, candidate or full mandatory Bank comparator may be silently shortened to fit. New versioned renderings can avoid repeated source metadata and redundant instructions while preserving exact source aliases and legacy absent-selector behavior. Input/currentness checks, existing total budgets and missing-call reservations remain authoritative. Semantic equivalence of compressed guidance still needs real review.','checks'),el('p','These results do not establish lower cost per useful saved question, model ranking, complete source coverage or reduced professor review time. Actual ten-file questions and outlines retain their earlier paid outcomes.','notice'));
    document.getElementById('supported-lo-coverage-repair')?.after(box);
  }
}
// AUTHORING_FLOW_HEADROOM_BOOK_END
// NUMERIC_FINITE_BOOK_START
{
  const finite=D.numericFiniteDomain;
  if(finite?.before){
    const box=el('section',undefined,'chapter');box.id='numeric-finite-domain';const before=finite.before.receipt,input=finite.input.receipt,counter=before.unsampledCounterexample;
    const link=(label,pin)=>{const a=el('a',label);a.href='../../'+pin.path;return a};
    box.append(el('div','10 / NUMERICAL VALIDATION · BOUNDED LOCAL PROOF','chapter-number'),el('h2','Catch a collision that 100 seeded checks missed'),
      el('p','A synthetic two-parameter question passed the old numerical validator even though one declared parameter tuple made its answer and distractor identical. This is an exact arithmetic counterexample, not a generated finance question or a model-quality result.','notice'),
      el('p','The preceding r11 request-sizing and source-currentness receipts remain historical observations of their archived code. This numerical change does not refresh those code pins or the pending paid-probe declaration. Any new full-flow check is a separate receipt below.','caption'),
      el('div',input.stem,'question'),el('p','X = 1…15 and Y = 1…9, both step 1: 135 declared slot-entry combinations. The retained 100 seeds visited 70 unique tuples and never visited X = 1, Y = 2. Sampling 100 draws therefore did not mean testing 100 different combinations.'));
    box.append(evidenceTable('Exact omitted tuple — the two displayed values collide',['Value','Declared formula','Computed at X = 1, Y = 2'],input.derivedValues.map(row=>[row.name,row.formula,fmt(counter.computedValues[row.name])])));
    if(finite.servingBoundary){const serving=finite.servingBoundary.receipt;box.append(el('p','This fixes earlier admission detection, not a newly fixed student-serving wrong answer. The retained pre-edit and current serving guards both reject the bad draw at seed '+serving.badSeed+', redraw to safe seed '+serving.goodSeed+', and refuse after eight repeated bad draws.','notice'),details('Exact old/current serving-boundary responses and redraw warnings',pretty(finite.servingBoundary)));}
    const pair=el('div',undefined,'pair');pair.id='numeric-finite-comparison';const old=el('article');old.append(el('h3','Before — accepted after sampled checks'),el('p','Recorded validator result: '+String(before.result.ok)),el('p',fmt(before.result.sampleSeeds.length)+' fixed seeds; '+fmt(before.uniqueSampledCombinations)+' unique tuples / '+fmt(before.declaredCombinations)+' declared tuples.'),details('Exact retained old verification response',pretty(before.result)));const next=el('article');next.append(el('h3','After — same input, bounded finite-grid validation'));if(finite.after){const after=finite.after.receipt;next.append(el('p','Recorded validator result: '+String(after.after.ok)),el('p',after.after.error,'notice'),el('p','Failing tuple indices: '+after.after.failingCombination.indices.join(', ')+'. The candidate input is unchanged.'),details('Exact after response and controls',pretty(finite.after)));}else next.append(el('p','Final after-response and integrated verification are pending. No unrecorded outcome is counted as passing.','empty'));pair.append(old,next);box.append(pair);
    box.append(el('h3','What the finite-grid proof covers'),el('p','Fresh closed-formula verification keeps the same 100 seed checks, then additionally evaluates every declared slot-entry tuple when the whole finite Cartesian grid fits within 256 entries. It uses the same draw-index semantics, formula evaluator and displayed-value checks as production. A collision refuses validation immediately; this unsafe example stops at the second tuple, rather than successfully checking all 135.'),
      evidenceTable('Bounded work and explicit limits',['Scope','Behavior'],[['Small valid closed-formula grid','At most 256 additional tuple evaluations after the existing 100 samples; a positive exhaustive receipt requires the complete grid.'],['Large, malformed or ambiguous domain','Explicit sampled coverage with a reason; no partial enumeration is labelled exhaustive.'],['Duplicate explicit values','Entry combinations retain their production weighting; the count is not a count of distinct displayed outcomes.'],['Historical stored proof','No automatic upgrade or claim that existing Approved items gained an exhaustive receipt.'],['Script-backed generator','Existing 25-seed sampled path; no new exhaustive script proof.'],['Fresh student draw','Existing per-draw collision/display guards and bounded refusal remain.']]),
      el('p','The Cartesian grid is a conservative superset of production draws. An exhaustive arithmetic pass does not establish that every tuple has a reachable PRNG seed, that the supplied formula is the correct finance model, that a premise is taught, or that the question has one semantically defensible answer.','caption'));
    const after=finite.after?.receipt,safe=after?.positiveControl;if(safe){const coverage=safe.result.verification.parameterCoverage;box.append(el('h3','Separate positive control — complete coverage of its small grid'),el('p',safe.label),evidenceTable('A different synthetic distractor formula; not an automatic question repair',['Value','Control formula'],safe.input.derivedValues.map(row=>[row.name,row.formula])),el('p','Recorded result: '+String(safe.result.ok)+' · '+coverage.mode+' · '+fmt(coverage.checkedCombinations)+' / '+fmt(coverage.totalCombinations)+' declared slot-entry combinations; maximum '+fmt(coverage.maxCombinations)+'.','checks'));}
    box.append(el('h3','Local work and model cost'),evidenceTable('Cost boundary — no model stage is added',['Resource','Scope'],[['New provider/embedding calls','Zero for this deterministic validation; no new standalone model stage is needed.'],['Additional work','Bounded local tuple evaluation and displayed-value checks; CPU work is not free.'],['Generation retry cost','Stricter admission can refuse templates that previously served by safe redraw; existing generation retries can consume more of the existing budget.'],['Latency claim','No general production latency improvement is inferred from local timings.'],['Saved question or teacher outcome','No higher yield, unchanged total cost or teacher benefit is established.']]));
    if(after?.benchmark){const bench=after.benchmark;box.append(evidenceTable('Warm local timing — one synthetic safe fixture only',['Run','Iterations','Median milliseconds'],[['Old sampled validator',fmt(bench.before.iterations),bench.before.medianMs.toFixed(6)],['New sampled plus finite-grid validator',fmt(bench.after.iterations),bench.after.medianMs.toFixed(6)]]),el('p',bench.scope+' These same-process observations are not a representative benchmark or an end-to-end speed claim.','caption'));}
    if(finite.flowRecheck){const flow=finite.flowRecheck.receipt;box.append(el('h3','Fresh request-size recheck after adding proof metadata'),evidenceTable('Separate current-code scripted replay — old r11 receipt stays historical',['Measure','Recorded result'],[['Scenario rows / raw-and-admission pairs',fmt(flow.counts.scenarios)+' / '+fmt(flow.counts.capturePairs)],['Fresh / historical input refusals',fmt(flow.counts.freshRefusals)+' / '+fmt(flow.counts.historicalRefusals)],['CAPM quality inputs before',flow.capmQuality.before.map(fmt).join(' / ')],['CAPM quality inputs after',flow.capmQuality.after.map(fmt).join(' / ')],['Added finite-proof metadata',fmt(flow.capmQuality.additionalBytesPerCandidate)+' input units in each of two recorded CAPM candidate blocks'],['Nested P02 JSON retry / headroom',fmt(flow.nestedP02.jsonRetry)+' / '+fmt(flow.nestedP02.headroom)],['Saved Drafts',fmt(flow.counts.savedDrafts)]]),el('p','The added arithmetic receipt changes prompt size, so old source pins were not assumed current. This replay records the new bytes and retains the same narrow 84-unit P02 boundary. Its semantic outputs, retrieval and persistence remain scripted or isolated; no paid quality or billing result follows.','caption'),details('Fresh full-flow identity, recorded randomness and scope',pretty(finite.flowRecheck)),link('Full current-code flow capture and exact prompt files',finite.flowResult));}
    if(finite.recordedSourcePinDifferences?.length)box.append(el('p','The initial counterexample capture and its earlier source archive contain a different params.service.ts hash. Both are preserved; the capture hashes were recorded after module import, so the initial archive alone is not proof of every executed source byte. Read the additive reconciliation before claiming exact reproduction.','caption'),details('Original recorded source-pin discrepancy',pretty(finite.recordedSourcePinDifferences)));
    for(const pin of finite.sourceReconciliation||[])box.append(details('Additive before-source reconciliation',pretty(pin)));
    if(finite.beforeReconstruction){const reconstruction=finite.beforeReconstruction.receipt;box.append(el('p','An additive reconstruction now captures source bytes before compilation and executes the exact archived pre-edit verifier and parameter module. It reconfirms acceptance of the same input and all 100 recorded draws, without rewriting the initial discrepancy.','caption'),details('Reconstruction input, result and every executed-source hash',pretty(finite.beforeReconstruction)),link('Open additive exact-source reconstruction',finite.beforeReconstruction));}
    const tests=finite.focusedTests?.receipt;if(tests)box.append(el('p','The focused offline checkpoint records '+fmt(tests.numPassedTests)+' passed tests in '+fmt(tests.numPassedTestSuites)+' suites. Integrated results are separate and may overlap this count. The original failing regression is retained.','checks'));
    const integrated=finite.integrationTests?.receipt;if(integrated)box.append(el('p','The new numerical integration scope records '+fmt(integrated.numPassedTests)+' passed tests across '+fmt(integrated.numPassedTestSuites)+' suites. It is a separate, overlapping scope from the earlier 39-suite/1,274-test authoring checkpoint; these totals are not added.','checks'));
    if(finite.verification)box.append(details('Final integrated engineering verification — exact scope',pretty(finite.verification)));else box.append(el('p','Final integrated verification is pending at this build.','empty'));
    if(finite.uiVerification){const ui=finite.uiVerification.receipt;box.append(el('p','The compiled parameter editor passes '+fmt(ui.stats.expected)+' intercepted UI cases. These exercise receipt labels, invalid metadata and save-state banners with synthetic API responses; they do not validate arithmetic or real model output. Accessibility checks cover the banner only.','caption'),details('Compiled UI receipt, exact intercepted I/O and predecessor runs',pretty(finite.uiVerification)));const gallery=el('details');gallery.id='numeric-finite-ui';gallery.append(el('summary','Inspect compiled UI banners — synthetic intercepted responses'));for(const shot of finite.screenshots){const f=el('figure'),a=el('a'),img=el('img');a.href=shot.bookFile;img.src=shot.bookFile;img.loading='lazy';img.alt=shot.path.includes('rejected')?'Compiled parameter editor: synthetic failed-tuple response replaces prior success.':(shot.path.includes('mobile')?'Mobile dark':'Desktop light')+' compiled parameter editor: synthetic recorded complete-grid receipt.';a.append(img);f.append(a,el('figcaption',img.alt+' No real numerical or model acceptance is inferred from this UI fixture.'));gallery.append(f)}box.append(gallery);}
    for(const [label,pin]of[['Exact unchanged fixture input',finite.input],['Original accepted counterexample and all 100 draws',finite.before],['Original before-source archive manifest',finite.beforeManifest],['Retained failing regression',finite.regressionBefore],['Focused numerical tests',finite.focusedTests],['Numerical integration scope',finite.integrationTests],['Exact after result and finite-grid controls',finite.after],['Existing pre-edit/current serving safeguards',finite.servingBoundary],['Compiled UI fixture verification',finite.uiVerification],['Final verification receipt',finite.verification],['Implementation, historical-proof compatibility and limits',finite.docs]])if(pin){const p=el('p',undefined,'caption');p.append(link(label,pin));box.append(p)}
    box.append(el('p','Separate open boundaries: physical-page locations and native-text volume do not determine chart/table meaning. The supported-LO repair is an internal branch, without a new UI or endpoint. Neither is solved by this arithmetic proof.','caption'));
    document.getElementById('authoring-flow-headroom')?.after(box);
  }
}
// NUMERIC_FINITE_BOOK_END
// OUTLINE_REPAIR_WORKSPACE_BOOK_START
{
  const workspace=D.outlineRepairWorkspace;
  if(workspace){
    const box=el('section',undefined,'chapter');box.id='outline-repair-workspace';
    const link=(label,pin)=>{const a=el('a',label);a.href='../../'+pin.path;return a};
    const final=workspace.verification?.receipt;
    box.append(el('div','11 / INSTRUCTOR OUTLINE REPAIR · PRODUCT WORKFLOW','chapter-number'),
      el('h2','Inspect a bounded repair without losing the original draft'),
      el('p','The internal wording-repair engine now has an Instructor workflow: inspect exact original evidence, select at most two objectives, confirm one bounded attempt, compare the separate proposal and independent review, explicitly choose the repaired draft, then Apply. This is a product and adoption-integrity improvement; its scripted demonstrations do not establish useful semantic recovery.','notice'));
    if(!final)box.append(el('p','Final engineering verification is pending at this build. Earlier failures are retained below. An unrecorded test, database result or source pin is not treated as a pass.','empty'));
    box.append(evidenceTable('The same retained failed-child scenario — two actual compiled workbench versions',['Step','Retained earlier implementation','Current implementation'],[
      ['Initial input','Completed parent outline, teacher-edited label and selected objectives.','The same parent outline, teacher edits and selection.'],
      ['Newest server run','A terminal failed child becomes the newest structure run.','The same synthetic terminal child and unchanged parent remain authoritative inputs.'],
      ['Observed workflow','Newest-run replacement could clear the visible parent result and local edits; no repair read panel was available.','Parent text and selection remain accessible across failure and reload. The child shortfall is inspected separately.'],
      ['Admission boundary','No new repaired-child authority replay was attached to ordinary Apply.','A repaired result requires matching transaction-bound parent, source, proposal, review, credit and budget authority before writes.']
    ]),el('p','The pair is a UI recovery comparison using authored source text and scripted server responses. It is not a same-input model-output improvement or a measurement of recovered course coverage.','caption'));
    box.append(el('h3','From a finding to an explicit decision'),evidenceTable('New Instructor path — full original evidence stays authoritative',['Action','Visible result','Bound'],[
      ['Open Repair outline wording','Uncredited source points to review, plus unsupported or uncertain wording.','Uncredited extraction points are prompts for inspection, not proven missing curriculum.'],
      ['Choose one mode and targets','Exact original wording, point text and source quotes.','At most two objectives; coverage mode names one to eight points per objective.'],
      ['Confirm the attempt','One durable child and its existing SSE progress.','One cycle shared across both modes and all alternative selections.'],
      ['Inspect before / after','Separate wording proposal and independent source review.','Coverage repair must gain every requested credit and retain every old credit.'],
      ['Use repaired draft, then Apply','The reviewed child is selected only explicitly; Apply is separate.','Failed, unresolved, stale or malformed authority cannot inherit eligible status.'],
      ['Edit labels intentionally','Teacher-authored text remains allowed.','The response identifies edited labels; model review covers stored wording, not later edits.']
    ]));
    if(workspace.ui){const ui=workspace.ui.receipt;box.append(el('h3','Compiled workbench screenshots and exact intercepted I/O'),el('p',fmt(ui.results?.stats?.expected)+' expected / '+fmt(ui.results?.stats?.unexpected)+' unexpected browser results. Every API response in this scope is intercepted. Desktop and mobile images show production view code, but model findings are synthetic and no live course is changed.','caption'),details('Compiled UI verification, exact case receipts and source pins',pretty(workspace.ui)));}
    if(workspace.sameInputComparison)box.append(details('Exact same-input actions, identity checks and observed before / after',pretty(workspace.sameInputComparison)),link('Open the paired unchanged input and screenshot receipt',workspace.sameInputComparison));
    if(workspace.scriptedCoverageExample){const example=workspace.scriptedCoverageExample.receipt,child=example.syntheticFinalServerView.child;box.append(el('h3','Exact synthetic repair request and visible output'),el('div',child.targets[0].before,'question'),el('p','Proposed wording: '+child.targets[0].after),el('p','This generic proposed wording is deliberately reported as a UI fixture, not a semantic improvement. Its scripted E1 credit does not establish that the label explicitly preserves the observable/continually-updated share-price rationale. A real source review may disagree.','notice'),details('Exact parent, source quotes, POST body, proposal and scripted review',pretty(workspace.scriptedCoverageExample)));}
    if(workspace.screenshots?.length){const gallery=el('div',undefined,'pair');gallery.id='outline-workspace-screenshots';const ordered=[...workspace.screenshots].sort((a,b)=>({12:0,13:1,1:2,2:3,3:4,4:5}[a.case]??9)-({12:0,13:1,1:2,2:3,3:4,4:5}[b.case]??9));for(const shot of ordered){const f=el('figure'),a=el('a'),img=el('img');a.href=shot.bookFile;img.src=shot.bookFile;img.loading='lazy';img.alt=shot.label||shot.path;a.append(img);f.append(a,el('figcaption',img.alt));gallery.append(f)}box.append(gallery);}
    if(workspace.uiCases?.length){const d=el('details');d.append(el('summary','Open all '+fmt(workspace.uiCases.length)+' exact intercepted input/output case files'));for(const row of workspace.uiCases){const p=el('p',undefined,'caption');p.append(link(String(row.number).padStart(2,'0')+' · '+row.title+' · '+row.status,row.receipt));d.append(p)}box.append(d);}
    box.append(el('h3','Independent adoption authority'),el('p','The repaired Apply path requires transaction support and the matching course fence. It rereads the complete parent/checkpoint/progress/branch/child, current original source, immutable proposal, independent findings, credit-preservation assessment, budget bindings and the whole production-finalized result using the actual session. This authoritative write check is separate from a best-effort GET display.','checks'),el('p','Unknown latest runs remain quarantined until their parent or child identity is verified. Browser session storage restores only edited labels and selection into fresh server source bindings, scoped to actor, course and run. A failed or malformed read must not briefly enable an unclassified repaired result. Ordinary historical nonrepair Apply retains its compatibility behavior.'));
    if(workspace.mongo){const mongo=workspace.mongo.receipt;box.append(evidenceTable('Actual exclusively owned local Mongo — separate from mocked routes and UI',['Observation','Recorded result'],[['Terminal groups',fmt(mongo.groups.filter(row=>row.status==='passed').length)+' / '+fmt(mongo.groups.length)+' passed'],['Session propagation',fmt(mongo.groups.find(row=>row.name==='guard-reads-share-actual-session')?.actualMongoReads)+' guard reads use the same actual ClientSession'],['Committed positive control','One topic, one LO and one assignment; teacher text preserved and labelled instructor-edited'],['Negative authority controls','Twelve invalid/stale/archived/deleted authority cases preserve hierarchy and materials'],['Foreign nested course scope','Guard and Apply refuse before any requested-course read/write'],['Actual rollback','An exception after one uncommitted LO aborts hierarchy/material changes'],['Owned cleanup',String(mongo.cleanup.dropped)+' · '+fmt(mongo.cleanup.residualNamespaceCollections)+' residual namespace collections'],['Provider / embedding / vector / job sends','Zero; '+fmt(mongo.counters.scriptedCompletionCalls)+' scripted completions are fixture control flow'],['Reported provider input / output',String(mongo.reportedProviderInputTokens)+' / '+String(mongo.reportedProviderOutputTokens)+' · unknown, not billed zero']]),details('Actual exclusively owned local Mongo mechanics — scripted completions',pretty(workspace.mongo)),el('p','The database harness scope is actual transaction/session, current-source and rollback behavior in an owned namespace. HTTP, SAML, PDF ingestion, real providers and semantic teaching quality are outside that scope. Unknown provider usage in scripted adapters is not billed usage.','caption'));}
    const prior=workspace.firstRegression?.receipt,firstUi=workspace.initialUi?.receipt;
    box.append(el('h3','Failures remain part of the record'));
    if(prior)box.append(el('p','The initial combined regression recorded '+fmt(prior.numPassedTests)+' passing and '+fmt(prior.numFailedTests)+' failing tests across '+fmt(prior.numPassedTestSuites)+' passing and '+fmt(prior.numFailedTestSuites)+' failing suites. Its original receipt is retained.','caption'),details('Initial failing combined regression — unchanged',pretty(workspace.firstRegression)));
    if(firstUi)box.append(el('p','The first compiled UI run recorded '+fmt(firstUi.stats?.expected)+' expected and '+fmt(firstUi.stats?.unexpected)+' unexpected results. Fixture corrections and later checks do not rewrite that first checkpoint.','caption'),details('Initial compiled UI checkpoint — unchanged',pretty(workspace.initialUi)));
    for(const attempt of workspace.mongoAttempts||[])if(attempt.receipt?.status!=='passed')box.append(details('Retained owned-Mongo attempt · '+attempt.path,pretty(attempt)),link('Open unchanged database attempt and cleanup receipt',attempt));
    box.append(el('h3','The real database exposed a false refusal hidden by mocks'),el('p','The first Mongo failure was a fixture passage-ID error; the source join remained strict. The next two reached a completed child, but full-result comparison refused an otherwise matching BSON round trip: an own optional coverage.synthesisInput value of undefined was stored as null, while fresh JSON hashing omitted the key. The custom-finalizer unit mocks did not expose that representation difference.','notice'),el('p','Fresh finalization now omits an absent synthesis receipt. Comparison treats only null/undefined absence of that single optional field equivalently; non-null receipts, required and extra fields, original quotes, review findings, credit and budget authority must still match. Real BSON controls and changed-receipt refusals verify this narrow correction. It adds no semantic credit, model send or repair cycle.','checks'),link('Read the exact persistence defect and normalization boundary',workspace.docs));
    for(const [key,label]of [['retainedBefore','Exact completed child previously refused after BSON persistence'],['beforeRefusal','Actual full-result refusal before the narrow fix'],['finalAdoption','Successful current adoption response and scripted source inputs']]){const pin=workspace.persistenceReconciliation?.[key];if(pin)box.append(details(label,pretty(pin)),link(label+' · original file',pin));}
    if(final)box.append(evidenceTable('Final engineering checkpoints — overlapping scopes are not added',['Scope','Recorded result','Limit'],[['Combined unit/integration regression',fmt(final.combinedRegression.passedTests)+' tests / '+fmt(final.combinedRegression.passedSuites)+' suites / '+fmt(final.combinedRegression.failedTests)+' failures','Mocked services/routes and pure admission controls'],['Backend focused checkpoint',fmt(final.backend.focusedTests)+' tests / '+fmt(final.backend.focusedSuites)+' suites','Included in, not additional to, combined scope'],['Project compilation / scoped lint',String(final.combinedRegression.fullProjectTypecheck)+' / '+fmt(final.combinedRegression.scopedLintFiles)+' files','Static checks'],['Compiled UI',fmt(final.client.cases)+' intercepted cases / '+fmt(final.client.screenshots)+' screenshots','Synthetic server findings'],['Owned local Mongo',fmt(final.localMongo.groups)+' groups','Actual sessions and rollback; scripted semantics'],['Current exact source copies',fmt(final.sourceCopyCount)+' files','Historical before copies and failed receipts remain linked']]),details('Final combined engineering verification and exact scope',pretty(workspace.verification)));
    box.append(el('h3','Speed, tokens and the unchanged quality requirement'),evidenceTable('Extra work is bounded, not assumed free',['Resource','Current contract'],[
      ['Read and compare','GET performs no model work; the panel uses retained checkpoint/extraction evidence.'],
      ['Repair ceiling','Ten new observable sends; 48,000 input / 6,000 output conservative units per send; 540,000 new units, also bounded by the parent remainder.'],
      ['Cost interpretation','Conservative reservations are not actual billed tokens or a price estimate. Missing provider usage stays unknown.'],
      ['Reuse','No new extraction pass, queue or automatic hierarchy Apply.'],
      ['Outcome still required','Useful recovered LOs, correct visual interpretation, higher valid saved-question yield, lower review time and Luna/Sol model calibration require real source-based evaluation.']
    ]),el('p','The real ten-file outline observation is unchanged: 599 pages / 671 chunks; 119 source-supported and 23 withheld objectives; 379 model-derived points without credited coverage. This workflow neither interprets unread figures/tables nor proves that all uncredited points should be added as objectives. No new real model call, saved Draft, teacher acceptance or semantic recovery is established by these checks.','notice'));
    for(const [label,pin]of[['Final verification and all current source bindings',workspace.verification],['Exact current code copies',workspace.sourceManifest],['Exact prior client source copies',workspace.before?.client],['Exact prior backend source copies',workspace.before?.backend],['Exact prior adoption source copies',workspace.before?.root],['Retained prior-workbench compile receipt',workspace.before?.build],['Compiled browser fixtures and before/after captures',workspace.ui],['Owned local Mongo result and cleanup',workspace.mongo],['Implementation contract and limits',workspace.docs],['Original plan and test scope',workspace.plan]])if(pin){const p=el('p',undefined,'caption');p.append(link(label,pin));box.append(p)}
    document.getElementById('numeric-finite-domain')?.after(box);
  }
}
// OUTLINE_REPAIR_WORKSPACE_BOOK_END
// SOURCE_RECOVERY_DIAGNOSTIC_BOOK_START
{
  const diagnostic=D.sourceRecoveryDiagnostic;
  if(diagnostic){
    const box=el('section',undefined,'chapter');box.id='source-recovery-diagnostic';
    const link=(label,pin)=>{const a=el('a',label);a.href='../../'+pin.path;return a};
    const result=diagnostic.results.receipt,expanded=diagnostic.expandedComparison.receipt,
      reference=diagnostic.adjudicatedReference.receipt,adjudication=diagnostic.adjudication.receipt,
      diversity=diagnostic.diversity.receipt,proposal=diversity.counterfactualSpecification;
    box.append(el('div','12 / SOURCE RECOVERY · LOCAL DIAGNOSTIC','chapter-number'),
      el('h2','Recover table literals, then inspect repeated learning tasks'),
      el('p','A real regional Dividends / Buybacks table was almost invisible to native PDF extraction. A local grid-line transform recovers more literal text on this one page. Separately, inspection of the completed ten-file outline explains why three overlapping capability pairs escaped the existing redundancy warning. These are diagnostic findings; neither change has been admitted into production generation.','notice'));
    box.append(evidenceTable('Same retained Chapter 10 source — physical page 10, image object 133',['Input / operation','Observed output','Interpretation'],[
      ['Four native extractors','18 non-whitespace units: only the author and page-number footer.','The table body is an embedded raster, not native page text.'],
      ['Earlier 1,500-pixel page-render OCR','18 / 21 selected numeric literals matched.','Three border-glyph mismatches remain in the original receipt.'],
      ['Direct embedded raster, nearest-neighbor 2×, PSM 6','1 / 21 selected numeric literals matched.','The failed arm remains inspectable; a larger crop alone was insufficient.'],
      ['Same raster and scale, long-grid-line mask, PSM 6','21 / 21 selected literals; '+fmt(result.ocr[1].receipt.elapsedMs)+' ms local OCR.','No expected values were supplied to the transform or OCR.'],
      ['Same mask, PSM 3','21 / 21 selected literals; '+fmt(result.ocr[2].receipt.elapsedMs)+' ms local OCR.','Same engine and weights: correlated modes, not independent truth.'],
      ['Expanded, frozen root-agent reference','90 / 91 numeric literals against each frozen OCR mode.','The reference was transcribed after studying the 21-cell diagnostic, before reading complete OCR output.'],
      ['One source-pixel reference adjudication','91 / 91 after correcting the reference from 53.10% to 53.11%.','The original 90 / 91 result, wrong reference and raw OCR remain unchanged.']
    ]));
    box.append(el('p','This is one previously studied table, not a blinded or random benchmark, independent teacher gold, a general OCR accuracy estimate, or proof that generated questions improved. Header meaning, groupings, denominators, dates and finance premises still require source interpretation.','caption'));
    const gallery=el('div',undefined,'pair');gallery.id='source-recovery-images';
    for(const shot of diagnostic.images.slice(0,4)){const f=el('figure'),a=el('a'),img=el('img');a.href=shot.bookFile;img.src=shot.bookFile;img.loading='lazy';img.alt=shot.label;a.append(img);f.append(a,el('figcaption',shot.label));gallery.append(f)}box.append(gallery);
    box.append(el('h3','Exact inputs and outputs — including the failed arm'),
      el('p','The original 855 × 271 embedded image is pinned to unchanged PDF bytes, physical page and image stream. Geometry-only grid candidates assign OCR words to rectangles once; no reference literal selects, normalizes or moves a word. The local comparison does not rewrite the native chunks or manufacture native-source quote authority.'),
      details('Exact PDF/page/image binding, tool versions and geometric join',pretty({source:diagnostic.sourceBinding,grid:diagnostic.grid,join:expanded.joinRule})),
      details('Every selected-cell mismatch, exact local command, duration and unchanged PDF hash',pretty(diagnostic.results)));
    for(const row of diagnostic.raw.slice(0,4))box.append(details(row.path.split('/').at(-1)+' · exact raw output',row.text),link('Open raw '+row.path.split('/').at(-1),row));
    box.append(el('h3','The expanded check caught a reference transcription error'),
      el('p','Both frozen OCR modes read Small Asia / % of Payers as 53.11%. The initial root-agent reference said 53.10%. Inspection of the original-pixel crop and a display-only nearest-neighbor enlargement confirmed 53.11%. Only a new adjudicated reference was added; neither OCR output nor the original reference/comparison was corrected.','notice'));
    const crops=el('div',undefined,'pair');crops.id='source-recovery-adjudication';
    for(const shot of diagnostic.images.slice(4)){const f=el('figure'),a=el('a'),img=el('img');a.href=shot.bookFile;img.src=shot.bookFile;img.loading='lazy';img.alt=shot.label;a.append(img);f.append(a,el('figcaption',shot.label));crops.append(f)}box.append(crops,
      details('Exact source-crop adjudication; original and additive reference hashes',pretty(diagnostic.adjudication)));
    const comparison=el('details');comparison.id='source-recovery-all-cells';comparison.append(el('summary','Inspect all 91 numeric cells — original reference, both raw OCR modes and adjudicated source reading'));
    const rows=expanded.arms[0].numeric.cells.map((cell,index)=>{const other=expanded.arms[1].numeric.cells[index],current=reference.rows[cell.rowIndex].numericLiterals[cell.columnIndex-1];
      return [cell.rootLabel+' · '+cell.columnHeader,cell.referenceLiteral,cell.ocrLiteral,other.ocrLiteral,current,
        cell.exactLiteralMatch&&other.exactLiteralMatch?'Matched original reference':'Retained mismatch; source reference adjudicated'];});
    comparison.append(evidenceTable('All 13 rows × 7 numeric columns; exact literal strings, no normalization',['Cell','Original reference','PSM 6 raw','PSM 3 raw','Adjudicated reference','Original check'],rows),
      el('p','Both modes also match 13/13 row labels, 8/8 column-header strings and 2/2 group-header strings against this agent reference. Literal agreement does not establish their semantic relationships. The all-cell view is a display projection of unchanged original receipts.','caption'),
      details('Full expanded comparison with every source box and raw OCR word',pretty(diagnostic.expandedComparison)));box.append(comparison);
    box.append(el('h3','Why repeated capabilities escaped the outline warning'),
      el('p','The actual final outline contains 119 source-supported LOs. Its stored inventory and a replay of the current pure inventory both return zero redundancy warnings, after considering all 119 without truncation. The warning compares credited-point Jaccard overlap at a 0.8 threshold. The audited capability pairs score 0.10, 0.708 and 0.24, so all fall below it. Their final source reviews ran in separate batches and did not compare these peer tasks.','notice'),
      el('p','A source-supported LO can still repeat another supported capability. Point overlap is useful for nominating comparisons, but a shared source or shared finance term cannot decide whether two required operations are the same. A two-peer nomination experiment catches the three audited pairs and also nominates L3/L127; it has no established semantic recall.'));
    const pairRows=diversity.pairs.map(pair=>[pair.first+' / '+pair.second,pair.originalReviewBatches.first+' / '+pair.originalReviewBatches.second,
      pair.admittedMetrics.jaccard.toFixed(3),pair.firstFinal.name,pair.secondFinal.name]);
    box.append(evidenceTable('Actual final wording, original batch positions and credited overlap',['Pair','Review batches','Credited Jaccard','First admitted wording','Second admitted wording'],pairRows));
    for(const pair of diversity.pairs)box.append(details(pair.first+' / '+pair.second+' · exact original sections, points and independent findings',pretty(pair)));
    box.append(el('h3','A cleanup specification still needs an independent source review'),
      evidenceTable('Proposed only — no new model review and no hierarchy Apply',['Proposed action','Coverage condition','Current status'],[
        ['Narrow L127 to its unique corporate-decision framing','Preserve E663/E665/E666; detailed leverage comparison remains under L104.','Not reviewed or adopted.'],
        ['Remove broad L128 after reviewing E685 under L105','E685 cannot disappear just because most of L128 overlaps other LOs.','Reassignment requires a fresh full-original review.'],
        ['Retain L106 expected-appreciation capability','Its unique E690 operation is not covered merely by a broad transaction label.','Preserve distinct operations.'],
        ['Mechanical before / proposed union',proposal.initialObjectives+' → '+proposal.hypotheticalObjectives+' LOs; '+proposal.initialDistinctCredits+' → '+proposal.hypotheticalDistinctCredits+' distinct credited IDs.','ID-union preservation is not semantic support for the proposed new wording.']
      ]),
      el('p','The current per-objective wording-repair workflow correctly refuses credit loss on an individual target. This cross-LO consolidation would need a separate versioned global-preservation contract and independent peer/source review; it must not reuse the existing mode to bypass those requirements.','checks'),
      details('Exact unexecuted cleanup specification and all preserved / reassigned credits',pretty(proposal)),
      details('Source-grounded negative controls: shared original, different required operations',pretty(diversity.proposedControls)),
      details('Proposed implementation and bounded comparator cost — not production behavior',pretty(diagnostic.diversityProposal)));
    box.append(el('h3','Cost and the remaining admission boundary'),evidenceTable('Observed local work — no paid inference in this diagnostic',['Resource','Recorded scope'],[
      ['Local OCR','Three new Tesseract invocations; expanded checking and source adjudication add zero OCR calls.'],
      ['Provider / embeddings / application database','Zero calls in this diagnostic. No token or money savings is inferred.'],
      ['Production interpretation','Unknown; the OCR is a candidate transcript, not original native evidence.'],
      ['Real outline and questions','No new LO or question, hierarchy Apply, saved Draft or teacher acceptance.'],
      ['Next evidence required','Bounded derived-source OCR admission and genuine cross-LO review, followed by source-based output and useful-yield evaluation.']
    ]));
    for(const [label,pin]of[['Exact source/page/image binding',diagnostic.sourceBinding],['Original diagnostic and failed arm',diagnostic.results],['21-cell comparison and earlier 18/21 receipt',diagnostic.selectedComparison],['Pre-expanded-reference artifact freeze',diagnostic.preExpandedFreeze],['Original expanded reference — retained 53.10% error',diagnostic.originalReference],['Original expanded 90/91 comparison',diagnostic.expandedComparison],['Source-pixel adjudication — additive only',diagnostic.adjudication],['Adjudicated reference',diagnostic.adjudicatedReference],['Local diagnostic verification before root adjudication',diagnostic.verification],['Actual outline redundancy diagnosis',diagnostic.diversity],['Unexecuted cleanup implementation proposal',diagnostic.diversityProposal],['Pure outline replay verification',diagnostic.diversityVerification],['All prior book file and payload bindings',diagnostic.baseline]]){const p=el('p',undefined,'caption');p.append(link(label,pin));box.append(p)}
    const recommendation=diagnostic.raw.find(row=>row.path.endsWith('.md'));box.append(link('Local derived-source implementation recommendation; not shipped',recommendation));
    document.getElementById('outline-repair-workspace')?.after(box);
  }
}
// SOURCE_RECOVERY_DIAGNOSTIC_BOOK_END
// OUTLINE_CAPABILITY_IMPLEMENTATION_BOOK_START
{
  const implementation=D.outlineCapabilityImplementation;
  if(implementation){
    const box=el('section',undefined,'chapter');box.id='outline-capability-implementation';
    const link=(label,pin)=>{const a=el('a',label);a.href='../../'+pin.path;return a};
    const latest=implementation.latestPacking?.receipt,plan=latest?.stages?.newComplete,
      minimum=latest?.minimumCompleteReviewAdmission?.value,native=latest?.nativeEnvelopeAnalysis;
    box.append(el('div','13 / CAPABILITY REVIEW · IMPLEMENTATION AND COST','chapter-number'),
      el('h2','Compare repeated operations without hiding the extra work'),
      el('p','Fresh opt-in outlines can now compare each candidate capability against at most two nominated peers across the full proposal. The same source-review response must keep source support, topic placement and task distinctness separate. Exact original quote witnesses bind the comparison; similarity scores never decide eligibility. These controls are engineering work, with no new real-model semantic result.','notice'));
    box.append(evidenceTable('What the new opt-in contract adds',['Mechanism','Concrete behavior','Limit'],[
      ['Whole-proposal peer nomination','Cross-topic peers are selected before packing; subset corrections keep the same complete peer originals.','At most two nominated peers; no exhaustive semantic-duplicate recall claim.'],
      ['Same-call operation comparison','Candidate/peer operations and source-bound shared or unique capabilities are required separately from sourceStatus.','Valid quotes prove reference integrity, not the truth of a semantic verdict.'],
      ['Independent operations survive','Explanation and calculation can remain distinct even when their original section is shared.','A shared chapter, equation or evidence ID cannot itself justify rejection.'],
      ['Overlapping broad wording is held','Equivalent, partly overlapping or uncertain unchanged objectives cannot be admitted merely because they are source-supported.','Unique credits remain explicit gaps until a narrowed survivor passes a separate review.'],
      ['Cross-batch contradictions','Conflicting reciprocal relations are routed through the existing bounded correction; unresolved conflict remains refused.','No unlimited retry or implicit acceptance.'],
      ['Whole-review minimum admission','The known native input plus fixed output reservations are checked before the first new review send.','Correction, transport failure and unknown work can still exhaust a sufficient initial plan.']
    ]));
    const rows=(implementation.trials||[]).filter(Boolean).map(pin=>{const r=pin.receipt,n=r.stages?.newComplete,s=r.stages?.singletons;
      const failed=s?.overCap||[];return [pin.path.split('/').at(-2),r.sourcesUnchanged===false?'Source changed during run — retained failure diagnosis':'Source pins stable during this run',
        n?.status==='planned'?fmt(n.batches)+' batches / '+fmt(n.objectives)+' LOs':'Refused before a complete plan',
        s?.status==='not-repeated-r4-scope-retained'?'Not repeated; 142-case r4 evidence retained':failed.length?failed.map(row=>row.id+': '+fmt(row.estimate)).join('; '):'No raw singleton cap failure',
        n?.maxInputEstimate===undefined?'No complete-plan maximum':fmt(n.maxInputEstimate)+' / '+fmt(r.inputLimit),
        r.nativeEnvelopeAnalysis?fmt(r.nativeEnvelopeAnalysis.newNativeInitialOver48000.length)+' / '+fmt(r.nativeEnvelopeAnalysis.newNativeJsonCorrectionOver48000.length):'Not measured in this trial'];});
    box.append(el('h3','The same actual 142-objective proposal exposes admission failures'),
      el('p','Every trial uses the same retained ten-file proposal, exact original sections and a 46,500-unit raw-input limit. Packing is pure local TypeScript work. The first attempt retains a whole-source pin change and cannot serve as a clean current-source verification. Later trials retain their own immutable code and packet receipts. No trial sends these prompts to a model.'),
      evidenceTable('Actual local packing history — failures remain visible',['Trial','Source identity','Complete planner','Single-objective raw failures','Complete-plan raw maximum','Initial / JSON retry over 48k'],rows));
    if(plan)box.append(evidenceTable('Latest recorded whole-plan mechanics',['Observation','Recorded result'],[
      ['Original source-only planner','23 batches, byte-identical to the retained checkpoint.'],
      ['New actual send plan',fmt(plan.batches)+' batches / '+fmt(plan.objectives)+' objectives.'],
      ['Largest raw prompt',fmt(plan.maxInputEstimate)+' / 46,500 conservative units.'],
      ['Largest initial native envelope',fmt(Math.max(...latest.actualSendRows.map(row=>row.nativeEnvelopeEstimate)))+' / 48,000 conservative units.'],
      ['Largest exact JSON-correction envelope',fmt(Math.max(...latest.actualSendRows.map(row=>row.nativeEnvelopeJsonCorrectionEstimate)))+' / 48,000; '+fmt(48000-Math.max(...latest.actualSendRows.map(row=>row.nativeEnvelopeJsonCorrectionEstimate)))+' units remain.'],
      ['Native initial requests',fmt(native?.newNativeInitialOver48000?.length)+' above the existing 48,000 continuation cap.'],
      ['Existing JSON-correction suffix',fmt(native?.newNativeJsonCorrectionOver48000?.length)+' requests above that cap; not treated as successful corrections.'],
      ['Lazy checkpoint storage',fmt(plan.checkpointCompactBytes)+' / 8,000,000 compact JSON bytes.'],
      ['Source and projection checks','All actual candidate point descriptions, peer LO wording, original sections and canonical comparisons are inspected against frozen server context.']
    ]));
    if(native?.newNativeJsonCorrectionOver48000?.length)box.append(el('p','Remaining format-correction shortfalls: '+native.newNativeJsonCorrectionOver48000.map(row=>row.ids.join(', ')+' = '+fmt(row.estimate)+' native units').join('; ')+'. An initially admitted prompt does not imply its corrected JSON request fits. The existing send guard may refuse that additional work.','notice'));
    box.append(el('h3','Prompt compaction has explicit exclusions'),
      el('p','The server retains every immutable objective, learning-point definition and complete original section. The model prompt emits each candidate’s full learning-point descriptions, IDs and source IDs once through a shared catalog. Peer-only extracted-point descriptions are deliberately excluded: peers retain complete LO wording, topic, evidence IDs, material IDs, source IDs and full original sections. Private content hashes and hierarchy coordinates stay server-side. This is a targeted reference projection, not a claim that every raw metadata field travels losslessly.','checks'),
      el('p','New-protocol storage omits duplicate rendered prompts and duplicate source arrays. The actual send is reconstructed from the stored complete context and checked again. Historical absent-selector packets and their prompt bytes remain unchanged. No original text, LO wording, required peer or input ceiling is trimmed to obtain a pass.'));
    if(implementation.largestActualPrompt){const prompt=implementation.largestActualPrompt;box.append(el('h3','Inspect the largest exact actual-send input'),el('p','Candidate IDs '+prompt.objectiveIds.join(', ')+' · '+fmt(prompt.inputEstimate)+' raw / '+fmt(prompt.nativeEnvelopeEstimate)+' native conservative units. This is a prepared local packet, with no corresponding real-model output in this experiment.','caption'),details('Full actual prompt — original sections and comparison requirements included',prompt.text),link('Open the exact pinned actual-send prompt',prompt));}
    if(minimum){box.append(el('h3','The complete ten-file review still does not fit the existing budget'),
      evidenceTable('Actual exported minimum-plan function with the unchanged retained baseBudget',['Resource','Recorded conservative units'],[
        ['Source-only initial native input',fmt(native.oldInitialNativeInputSum)],
        ['New initial native input',fmt(minimum.inputUnits)],
        ['New fixed output reservations',fmt(minimum.outputUnits)+' = '+fmt(minimum.batches)+' × 6,000'],
        ['Minimum additional reservation',fmt(minimum.minimumAdditionalUnits)],
        ['Remaining retained allowance',fmt(minimum.remainingUnits)+' units / '+fmt(minimum.remainingSends)+' sends'],
        ['Minimum plan fits',String(minimum.fits)+' — the worker must refuse before its first new capability-review call.']
      ]),el('p','The protocol adds work: more split calls repeat complete originals and reserve more output. These are conservative UTF-8 admission units, not provider tokens or a monetary estimate. The 2-million-unit parent ceiling has not been raised. This known ten-file budget shortfall is an explicit experimental constraint; it is not a completed fast, inexpensive end-to-end solution.','notice'),details('Exact exported minimum-plan output and unchanged budget input',pretty(latest.minimumCompleteReviewAdmission)));}
    box.append(el('h3','Controlled demonstrations — mechanics, not model improvement'));
    if(implementation.demonstrations){const checks=implementation.demonstrations.receipt.checks;box.append(el('p','The following fixed inputs and raw scripted responses exercise correction, false-positive protection and early budget refusal. Their expected labels are fixture controls. They do not establish real-model duplication judgment, valid saved yield or professor acceptance.','caption'),evidenceTable('Scripted controls using actual production parsers and admission helpers',['Fixed control','Mechanical output','Semantic limit'],[
      ['Source-positive partly overlapping wording',fmt(checks.sourceOnlySelectable)+' source-only selectable → '+fmt(checks.overlapSelectable)+' capability-selectable; '+fmt(checks.capabilityHeld)+' held.','The overlap relation was scripted; no model detected it.'],
      ['Different operations from the same original',fmt(checks.sameSourceDifferentOperationSelectable)+' selectable, preserving both shared-source operations and the third objective.','The distinct relation was scripted; no false-positive rate is measured.'],
      ['Reciprocal cross-batch contradiction',fmt(checks.scriptedCompletionCallbacks)+' scripted callbacks; L2 uses its second existing attempt.','Correction control flow, not actual model self-correction.'],
      ['Whole-review budget shortfall','Minimum plan fits: '+String(!checks.wholeBudgetInsufficient)+'.','Fixed synthetic limits demonstrate refusal; the separate 142-LO budget result uses its actual retained allowance.']
    ]),details('Exact demonstration inputs, raw responses and parsed findings',pretty(implementation.demonstrations)));const p=el('p');p.append(link('Open all fixed demonstration records',implementation.demonstrations));box.append(p);if(implementation.demonstrationVerification){const p=el('p');p.append(link('Open scripted-control verification and exact source pins',implementation.demonstrationVerification));box.append(p)}}
    else box.append(el('p','Final controlled demonstration receipts are pending at this build. Their absence cannot become a passing semantic result.','empty'));
    if(implementation.finalVerification){const final=implementation.finalVerification.receipt;box.append(evidenceTable('Final engineering verification — separate from semantic quality',['Scope','Recorded result'],[
      ['Unit / integration regression',fmt(final.checks.regression.passedTests)+' passing tests / '+fmt(final.checks.regression.suites)+' suites; '+fmt(final.checks.regression.failedTests)+' failures.'],
      ['Typecheck / scoped lint / diff',String(final.checks.typecheck.exitCode)+' / '+String(final.checks.lint.exitCode)+' ('+fmt(final.checks.lint.files)+' files) / '+String(final.checks.scopedDiffCheck.exitCode)+' exit codes.'],
      ['Source and historical compatibility',fmt(final.sourceFiles.length)+' pinned files; historical source-only grounding/review and per-objective repair remain byte-identical.'],
      ['New provider / embedding / application database / queue','Zero in this implementation verification.'],
      ['Earlier R7 paid preflight','Stale after source changes; it is not executable as the current declaration. No new ledger or dispatch.']
    ]),details('Final engineering checks, code pins and exact scope',pretty(implementation.finalVerification)),link('Open final engineering verification',implementation.finalVerification));}
    else box.append(el('p','Root final regression verification is pending at this build. Pure prompt packing alone does not verify the worker or adoption integration.','empty'));
    box.append(el('p','The observed real outline remains 119 source-supported and 23 withheld LOs, with 379 model-derived points without credited coverage. No new capability verdict was generated, no 119-to-118 cleanup was adopted and no question was saved by these mechanical checks. Real source-calibrated duplicate detection, safe repair yield, teacher review time and model comparisons still require separate validation.','notice'));
    const trialLinks=el('details');trialLinks.append(el('summary','Open exact historical packing results, prepared packets and prompts'));
    for(const pin of implementation.trials||[])if(pin){const p=el('p',undefined,'caption');p.append(link(pin.path.split('/').at(-2)+' · exact result and linked packets',pin));trialLinks.append(p)}box.append(trialLinks);
    if(implementation.readerPresentationCorrection)box.append(el('p','The first reader checks passed, while visual inspection caught two adjacent receipt links with no separating space. The links now occupy separate paragraphs. This reader-only presentation fix changes no source input, model output or mechanical result.','caption'));
    for(const [label,pin]of[['Latest recorded exact packing result',implementation.latestPacking],['Independent exact actual-send, original and budget check',implementation.packingIndependentVerification],['Retained historical demonstration verification',implementation.historicalDemonstrationVerification],['Implementation contract and explicit remaining gaps',implementation.implementation],['Initial reader checks before the visual spacing fix',implementation.firstReaderVerification],['Archived reader presentation before the spacing fix',implementation.readerPresentationCorrection],['All prior book payload and asset bindings',implementation.baseline]])if(pin){const p=el('p',undefined,'caption');p.append(link(label,pin));box.append(p)}
    document.getElementById('source-recovery-diagnostic')?.after(box);
  }
}
// OUTLINE_CAPABILITY_IMPLEMENTATION_BOOK_END
// OUTLINE_CAPABILITY_PEER_ELIGIBILITY_BOOK_START
{
  const followup=D.outlineCapabilityPeerEligibility,chapter=document.getElementById('outline-capability-implementation');
  if(followup&&chapter){
    const box=el('section',undefined,'checks');box.id='outline-capability-peer-eligibility';
    const link=(label,pin)=>{const a=el('a',label);a.href='../../'+pin.path;return a};
    box.append(el('h3','Latest correction: a resolved source-rejected peer must not veto the supported objective'),
      el('p','This dated follow-up supersedes the 614-test/source checkpoint retained below. The earlier chapter, raw outputs and screenshots remain historical. A further admission-rule defect was found after that checkpoint: an independently source-supported LO could be held solely because it overlapped a peer already withheld by the independent source gate.','notice'));
    if(!followup.after||!followup.finalVerification)box.append(el('p','Fresh correction and root verification receipts are pending at this build. The older checkpoint must not be presented as current verification.','empty'));
    box.append(el('p','Only an exact, complete independent source verdict of unsupported or uncertain makes a peer non-selectable for this rule. It does not supply source support to the candidate. Missing, malformed, stale or unbound peer findings remain unresolved; valid comparison rows, quote/pair bindings and all source checks are still required. A peer that is source-supported continues to matter even when another capability relation holds it. This avoids a circular eligibility shortcut.'));
    if(followup.before&&followup.after){const before=followup.before.receipt,after=followup.after.receipt;
      const cases=before.cases.filter(row=>row.id.startsWith('supported-vs-')).map(row=>{const next=after.cases.find(item=>item.id===row.id);return [row.id,row.sourceSupported.join(', ')||'None',row.eligible.join(', ')||'None',next?.eligible?.join(', ')||'None',String(next?.complete??'unrecorded')];});
      box.append(evidenceTable('Same constructed source/operation verdicts — before and after the admission rule',['Fixed case','Source-supported candidate','Selectable before','Selectable after','Mechanically complete after'],cases),
        el('p','These six status/relation combinations are deliberately scripted. Some equivalent-wording/negative-source combinations are intentionally artificial to isolate rule sensitivity. They are not six observed model errors, an empirical false-positive rate, a professor benchmark or six saved questions.','caption'));
      const controls=after.cases.filter(row=>!row.id.startsWith('supported-vs-')).map(row=>[row.id,row.eligible?.join(', ')||'None',String(row.complete),row.final?.status||'Inspect exact receipt']);
      box.append(evidenceTable('Controls remain strict — no waiver for unknown or supported competing peers',['Fixed control','Selectable after','Complete','Finalization'],controls),details('Exact retained before summary',pretty(followup.before)),details('Exact new summary — scripted labels only',pretty(followup.after)));
    }
    if(followup.exampleAfter){const sample=followup.exampleAfter.receipt,previous=followup.exampleBefore?.receipt;
      box.append(el('h3','One fixed input, unchanged scripted judgments, a different admission decision'),el('p','The supported objective combines buyback effects with expected price appreciation. Its peer adds a stochastic-equation forecast that the fixed source does not supply. Both still receive the same partial-overlap relation. The changed rule admits only the independently supported L1; it does not make the unsupported peer selectable.'),details('Exact synthetic source, both complete objectives and unchanged evidence',pretty({themes:sample.input.themes,evidence:sample.input.evidence,sections:sample.input.sections})),details('Raw scripted response and canonical parser findings — no model call',pretty({rawSameCallEnvelope:sample.input.rawSameCallEnvelope,parsed:sample.output})),details('Earlier admission of the same raw judgments — retained',pretty(previous?.output)));
    }
    if(followup.exactCaseLinks?.length){const links=followup.exactCaseLinks.map(row=>[row.id,link('Before · full fixed input/output',row.before),link('After · full fixed input/output',row.after)]);box.append(evidenceTable('Every fixed case has original and corrected raw receipts',['Fixed case','Original receipt','Corrected receipt'],links));}
    if(followup.comparison)box.append(details('Exact same-input comparison and identity limits',pretty(followup.comparison)),link('Open frozen eleven-case before/after comparison',followup.comparison));
    if(followup.helperCloseout)box.append(details('Exact helper rule, unchanged prompts and separate focused checks',pretty(followup.helperCloseout)),link('Open helper closeout and retained-source bindings',followup.helperCloseout));
    if(followup.finalVerification){const checks=followup.finalVerification.receipt.checks||{},reg=checks.regression||{};
      box.append(el('h3','Latest verification — engineering checks, not semantic acceptance'),el('p',fmt(reg.suites)+' suites / '+fmt(reg.passedTests)+' passing tests are recorded in the latest root receipt. The 614-test checkpoint below remains unchanged historical evidence. Test fixtures and parsed source labels remain scripted.'),el('p','The adoption controls serialize the nested peer receipt through real BSON, then check matching-course session propagation using intercepted readers and a hierarchy-write spy. The valid receipt reaches that write; changing either its peer-source hash or comparison hash is refused before the write. This is local persistence/adoption guard evidence, not an application-database Apply or an accepted outline.'),details('Latest source pins, regression and bounded correction checks',pretty(followup.finalVerification)),link('Open latest engineering verification',followup.finalVerification));
    }
    if(followup.packing){const result=followup.packing.receipt,plan=result.minimumCompleteReviewAdmission.value,rows=result.stages.newComplete.rows;
      box.append(el('h3','Current packing reconciliation — no new budget headroom'),evidenceTable('Actual 142-LO packing after the peer-eligibility fix',['Exact current measurement','Result'],[['Actual proposal / planned sends','142 objectives / '+fmt(rows.length)+' batches'],['Maximum raw input',fmt(Math.max(...rows.map(row=>row.inputEstimate)))+' / 46,500'],['Maximum native envelope',fmt(Math.max(...rows.map(row=>row.nativeEnvelopeEstimate)))+' / 48,000'],['Maximum exact first JSON correction',fmt(Math.max(...rows.map(row=>row.nativeEnvelopeJsonCorrectionEstimate)))+' / 48,000; 8 units remain'],['Lazy stored checkpoint',fmt(result.stages.newComplete.checkpointCompactBytes)+' / 8,000,000 bytes'],['Minimum complete-review reservation',fmt(plan.minimumAdditionalUnits)+' vs '+fmt(plan.remainingUnits)+' remaining; fits = '+String(plan.fits)]]),el('p','All 67 actual send prompts retain the same candidate point data, complete peer wording, original sections and 244 required comparison directions. Fixed-width bound code/context hashes change. Conservative UTF-8 admission units, source bytes and prompt lengths match the earlier r5 run; these are not provider tokens, billing or model latency. More split calls repeat originals and reserve output, so this review is still unaffordable under the unchanged retained budget.','caption'),details('Reconciled actual 142-LO prompt packing and unchanged budget boundary',pretty(followup.packing)),link('Open latest pure packing reconciliation',followup.packing));
    }
    if(followup.packingIndependentVerification){const p=el('p',undefined,'caption');p.append(link('Open independent exact-packet and budget reconciliation',followup.packingIndependentVerification));box.append(p)}
    for(const [label,pin]of[['Latest BSON adoption guard verification — mocked database boundaries',followup.applyBsonVerification],['Latest controlled demonstration raw input and output — scripted labels',followup.currentDemonstrations],['Latest demonstration verification and current source pins',followup.currentDemonstrationVerification]])if(pin){const p=el('p',undefined,'caption');p.append(link(label,pin));box.append(p)}
    box.append(el('p','The actual ten-file budget gap, global credit-preserving consolidation and real-model semantic calibration remain open. This eligibility correction does not create a new model judgment, hierarchy Apply, saved question or teacher acceptance. The earlier native-input and budget results below remain historical measurements unless the linked current reconciliation explicitly verifies their equivalence.','notice'));
    for(const [label,pin]of[['Prior chapter13 reader checkpoint — preserved',followup.priorBookCheckpoint],['Earlier policy diagnosis',followup.policyAnalysis],['All 48 earlier payload and asset bindings',followup.baseline]])if(pin){const p=el('p',undefined,'caption');p.append(link(label,pin));box.append(p)}
    chapter.insertBefore(box,chapter.children[2]||null);
  }
}
// OUTLINE_CAPABILITY_PEER_ELIGIBILITY_BOOK_END
// OUTLINE_SOURCE_OVERLAP_PACKING_BOOK_START
{
  const experiment=D.outlineSourceOverlapPacking,addendum=document.getElementById('outline-capability-peer-eligibility');
  if(experiment&&addendum){
    const box=el('div');box.id='outline-source-overlap-packing';
    const result=experiment.result.receipt,comparison=result.comparison,best=result.plans.find(row=>row.name===comparison.best);
    const link=(label,pin)=>{const a=el('a',label);a.href='../../'+pin.path;return a};
    box.append(el('h3','Packing experiment: share complete originals within each review request'),
      el('p','A separate local experiment groups LOs that need overlapping original sections, so one request repeats fewer of the same source bytes. It compares the same actual 142-candidate proposal and all 244 required comparison directions under the unchanged four-candidate, source and input limits. This algorithm is not wired into production.','notice'));
    const names={'current-recursive':'Current production grouping','greedy-canonical':'Experimental greedy · original LO order','greedy-largest-singleton':'Experimental greedy · largest first'};
    box.append(evidenceTable('Alternative grouping of exactly the same required source and comparison data',['Local packing plan','Review sends','Minimum conservative reservation','Maximum exact JSON input','Fits remaining budget'],result.plans.map(row=>[names[row.name]||row.name,fmt(row.batches),fmt(row.minimumInitialNativePlusOutput),fmt(row.maxExactJsonRetryInput)+' / 48,000',String(row.exactProductionAdmissionPlan.fits)])),
      el('p','The better of these two tested heuristics changes '+fmt(comparison.baselineBatches)+' → '+fmt(comparison.bestBatches)+' sends and '+fmt(comparison.baselineMinimumUnits)+' → '+fmt(comparison.bestMinimumUnits)+' conservative units: '+fmt(comparison.avoidedConservativeUnits)+' fewer reserved units ('+(comparison.relativeReservationReduction*100).toFixed(2)+'%). The best tested plan still exceeds the '+fmt(comparison.remainingUnits)+' retained remainder by '+fmt(comparison.stillOverBy)+'. This is a measured estimate reduction, not an actual provider-token, money or latency saving.'),
      el('p','Every final group is reconstructed with the actual frozen selector and renderer. Candidate point definitions, peer LO wording, complete originals, canonical pair identities and the whole-proposal nominations remain exact; no source clipping, comparator removal, cap increase or historical-review reuse is involved. The deterministic 16-item shortlist search is not a proof of globally optimal packing.'),
      el('p','The measured replay section after loader initialization took '+(result.timings.totalWallMs/1000).toFixed(3)+' seconds locally, including the baseline and '+fmt(result.timings.uniqueTrialGroups)+' trial groups; startup transpilation and input-snapshot setup are excluded. It made zero provider, embedding, database, network, queue or OCR calls. Changed grouping or order may change future model judgments; semantic equivalence, accepted yield and professor time remain unmeasured.','caption'),
      details('Exact experimental plan summaries, immutable source bindings and scope',pretty(experiment.result)));
    for(const [label,pin]of[['Open all exact groups and actual prompt packets',experiment.result],['Open largest actual best-plan prompt — source input, no model output',experiment.largestActualBestGroup.prompt],['Preserved r1 reader delivery before this experiment',experiment.priorReaderDelivery],['All 49 previous payload and asset bindings',experiment.baseline]]){const p=el('p',undefined,'caption');p.append(link(label,pin));box.append(p)}
    if(experiment.verification){const p=el('p',undefined,'caption');p.append(link('Open file-only experiment verification',experiment.verification));box.append(p)}
    if(experiment.rootVerification){const proof=experiment.rootVerification.receipt;box.append(el('h4','Why regrouping alone cannot fit this retained allowance'),el('p','An independent byte-count lower bound under this unchanged packet format and at most four candidates per request is '+fmt(proof.minimumRawInputPlusOutput)+' units, already above '+fmt(proof.remainingUnits)+'. It counts disjoint original-source rows, candidate-point rows, candidate rows, at least 36 unchanged instruction prefixes and 36 output reservations. Extra peer metadata, escaping and corrections are omitted, so this is deliberately a lower bound. It is not a claim that every future protocol has the same minimum.'),details('Independent disjoint-row obligations and exact current contract limits',pretty(experiment.rootVerification)));const p=el('p',undefined,'caption');p.append(link('Open root independent packet and lower-bound verification',experiment.rootVerification));box.append(p)}
    if(experiment.closeout){box.append(el('p','Further affordability work needs a separately tested contract, such as valid review reuse or source- and credit-preserving consolidation before full review. Keeping this exact 142-LO proposal requires a fresh complete-work budget decision. None of those changes is implemented by this grouping experiment.'));const p=el('p',undefined,'caption');p.append(link('Open final experiment closeout, stopped preparatory attempts and next architecture',experiment.closeout));box.append(p)}
    const notices=addendum.querySelectorAll(':scope > p.notice');addendum.insertBefore(box,notices[notices.length-1]||null);
  }
}
// OUTLINE_SOURCE_OVERLAP_PACKING_BOOK_END
// OUTLINE_SOURCE_OVERLAP_INTEGRATION_BOOK_START
{
  const integration=D.outlineSourceOverlapIntegration,chapter=document.getElementById('outline-capability-implementation');
  if(integration&&chapter){
    const box=el('section',undefined,'checks');box.id='outline-source-overlap-integration';
    const link=(label,pin)=>{const a=el('a',label);a.href='../../'+pin.path;return a};
    const replay=integration.sameInputReplay?.receipt,implementation=integration.implementation?.receipt;
    box.append(el('h3','Current implementation: source-overlap packing and a pure planning cache'),
      el('p','This integration is in the local working tree; no commit, push or deployment is included.','caption'),
      el('p','This dated integration supersedes the preceding 639-test source checkpoint. Read the older sections below as preserved historical checkpoints: their statements that production used 67 groups and the 40-group plan was only a local experiment describe the earlier code. The integration below changes the existing explicit experimental selector; default and absent historical selectors keep their legacy behavior.','notice'));
    if(!integration.finalVerification)box.append(el('p','Final combined regression and source verification are pending. The linked actual planner replay is separate from that still-pending combined receipt.','empty'));
    if(replay){const before=replay.before,current=replay.current,plan=current.admission;
      box.append(el('h4','The actual production planner now selects 40 groups on the same retained proposal'),
        evidenceTable('Same actual142-LO input, complete sources and required comparisons',['Measured pure production planning','Before','Current'],[
          ['Planned review sends',fmt(before.sends),fmt(current.sends)],
          ['Minimum native-input plus output reservation',fmt(before.admission.minimumAdditionalUnits),fmt(plan.minimumAdditionalUnits)],
          ['Candidate IDs / required directed comparisons','142 / 244','142 / 244'],
          ['Complete referenced original sections',fmt(before.completeReferencedOriginals),fmt(current.completeReferencedOriginals)],
          ['Maximum raw input',fmt(before.maxRawInput)+' / 46,500',fmt(current.maxRawInput)+' / 46,500'],
          ['Maximum exact JSON correction',fmt(before.maxJsonRetryInput)+' / 48,000',fmt(current.maxJsonRetryInput)+' / 48,000'],
          ['Compact checkpoint bytes',fmt(before.compactCheckpointBytes),fmt(current.compactCheckpointBytes)]
        ]),
        el('p','The planner groups overlapping original-source requirements and chooses the cheaper complete plan over the prior recursive split. Each final group uses the actual shared renderer and exact full candidate points, peer wording, original sections and canonical comparisons. A bounded search falls back to the complete recursive plan when its ceiling is reached; it never returns a partial plan.'),
        el('p','The same retained allowance still refuses: '+fmt(plan.minimumAdditionalUnits)+' minimum units exceed '+fmt(plan.remainingUnits)+' remaining by '+fmt(plan.minimumAdditionalUnits-plan.remainingUnits)+'. This is 28.65% fewer conservative reserved units than the earlier plan, but no provider tokens, money, model latency, semantic accuracy or saved yield were measured. Regrouping may change model judgments.','notice'));
      const groups=el('details');groups.append(el('summary','All 40 actual planned groups — exact source inputs'));
      groups.append(evidenceTable('Every current group and its complete renderer input',['Group','Candidate IDs','Exact prompt','Complete send packet'],current.records.map(row=>[row.number,row.objectiveIds.join(', '),link('Prompt',row.prompt),link('Send JSON',row.send)])));box.append(groups);
      const timing=replay.timing;
      box.append(el('h4','The planning cache reuses deterministic CPU work'),
        evidenceTable('One local pure-planner measurement; not end-to-end authoring latency',['Call','Observed local wall milliseconds'],[
          ['Before planner · cold',timing.beforeCold.wallMs.toFixed(3)],
          ['Current planner · cold',timing.currentCold.wallMs.toFixed(3)],
          ['Current planner · fresh structured clone warm hit',timing.currentWarmFreshStructuredClone.wallMs.toFixed(3)],
          ['Current planner · warm hit after caller mutation',timing.currentWarmAfterCallerMutation.wallMs.toFixed(3)]
        ]),
        el('p','This process-local cache stores only a pure deterministic plan keyed by complete inputs and the current complete protocol hash. It has at most four entries and 16,000,000 encoded-plan bytes, and clones on store and return. The actual replay constructs once, accepts an equal fresh structured clone and isolates a returned nested mutation. It caches no model verdict, source finding or provider response; source currentness and final Apply authority remain separate checks.'),
        el('p','These timings cover synchronous pure planner calls only. Loader transpilation, artifact export, source/currentness database reads, provider latency, model execution and transaction performance are excluded. A 20.127 ms warm lookup is not a claim that question generation takes 20 ms.','caption'),
        details('Exact same-input production planning, cache controls and every linked source packet',pretty(integration.sameInputReplay)));
    }
    if(integration.reviewReuseStudy){const study=integration.reviewReuseStudy.receipt,counts=study.summary.counts;
      box.append(el('h4','Source-review reuse remains refused — it is a different cache'),
        el('p','A separate frozen-history study replays 142 source findings from 30 retained native calls: 119 supported, 19 unsupported and 4 uncertain, retaining 620 distinct coverage credits. These are already purchased raw replies, not new model judgments. It yields zero admissible current capability-protocol cache hits.'),
        evidenceTable('The two original-source instruction cohorts remain distinct',['Source instruction cohort in the frozen study','Winning findings','Supported / negative','Current capability cache hits'],study.integrity.sourceInstructionCohorts.map(row=>[row.exactCurrentSourceInstructions?'Matches the study reference legacy instructions':'Earlier source instructions',row.rows,row.supported+' / '+row.negative,row.strictCurrentCapabilityCacheHits])),
        el('p','The earlier 103 findings do not match the later source instruction/schema identity. The later 39 match those legacy source instructions, but the full capability request adds a different envelope, nominated peers and same-call comparisons. Matching one instruction segment cannot make the whole native request identical. No retained capability comparison response exists to supply the missing authority.'),
        el('p','The safe loader also preserves a declared runtime-hash mismatch and the retained artifact origin; it does not substitute a freshly computed self-hash for authenticated application provenance. The 19 study controls comprise one actual raw-history replay and 18 deliberately mutated refusal controls. Canonical normalization changes diagnostics for 20 old objective IDs across nine calls, with zero source-status changes; this does not convert an old source verdict into a fresh current-schema semantic decision.','caption'),
        el('p','The frozen 170 nominated pairs and 244 required directions are planning data. A proposed independent-source/canonical-pair protocol, including a possible 115 source-supported-pair subset, is not implemented here. Current required comparisons are not silently omitted.'),
        details('Exact source cohorts, historical parser differences, refused reuse and retained prototype failures',pretty(integration.reviewReuseStudy)));
      for(const example of integration.reviewReuseExamples||[]){box.append(details(example.proof.id+' · '+(example.proof.sourceInstructionsMatchCurrent?'later':'earlier')+' source-instruction cohort and complete retained raw-history bindings',pretty(example.proof)));const p=el('p',undefined,'caption');p.append(link(example.proof.id+' · exact recorded native input/output history',example.rawHistory));box.append(p)}
    }
    if(integration.gapVerification)box.append(el('h4','Recovery and Apply preserve the curriculum order'),el('p','The focused controls exercise noncontiguous packed IDs, exact BSON recovery, actual checkpoint validators and both production finalizers with in-memory collections and a mocked transaction session. Valid input reaches the mocked Apply continuation in original curriculum order. Swapped item or candidate identities refuse recovery and Apply before that continuation. These controls are not a real application-database transaction or a semantic acceptance test.'),details('Exact checkpoint, identity, cache and Apply controls with retained failed fixtures',pretty(integration.gapVerification)));
    if(integration.finalVerification){const final=integration.finalVerification.receipt;box.append(el('h4','Latest combined engineering verification'),el('p',fmt(final.checks.suitesPassed)+' suites / '+fmt(final.checks.testsPassed)+' passing tests; zero failed or pending. Whole-project typecheck and scoped '+fmt(final.checks.lintFiles)+'-file lint pass. Focused counts overlap this combined run and are not added to it. Database/session boundaries remain mocked; actual BSON serialization and production parsers/finalizers establish mechanics.'),details('Final combined source pins, regression, typecheck and lint',pretty(integration.finalVerification)))}
    for(const [label,pin]of[['Latest production integration verification',integration.finalVerification],['Independent final cache, packing, recovery and Apply inspection',integration.independentInspection],['Exact production implementation and preserved earlier failures',integration.implementation],['Exact same-input production before/after replay',integration.sameInputReplay],['Independent full-byte production replay verification',integration.independentReplayVerification],['Source-review reuse refusal study and all prototype failures',integration.reviewReuseStudy],['Proposed future independent-source/canonical-pair protocol — not implemented',integration.reviewReuseProposal],['Every retained source finding and full native-history proof',integration.reviewReuseProofManifest],['Preserved reader delivery before production integration',integration.priorReaderDelivery],['All 50 previous payload and asset bindings',integration.baseline]])if(pin){const p=el('p',undefined,'caption');p.append(link(label,pin));box.append(p)}
    for(const pin of integration.retainedPlanningCacheAttempts||[])if(pin){const p=el('p',undefined,'caption');p.append(link(pin.path.split('/').at(-2)+' · exact planning-cache test receipt',pin));box.append(p)}
    box.append(el('p','The smaller current plan still cannot complete under the retained 995,670-unit remainder. Source-review reuse, global source/credit-preserving consolidation, real-model semantic calibration and useful saved yield remain separate open work. No new paid review, adopted outline, saved question or teacher acceptance is claimed.','notice'));
    chapter.insertBefore(box,chapter.children[2]||null);
  }
}
// OUTLINE_SOURCE_OVERLAP_INTEGRATION_BOOK_END
// OUTLINE_TERMINAL_BUDGET_COHORT_BOOK_START
{
  const budget=D.outlineTerminalBudgetCohort,section=document.getElementById('outline-source-overlap-integration');
  if(budget&&section){
    const target=[...section.querySelectorAll(':scope > p.notice')].find(node=>node.textContent.startsWith('The same retained allowance still refuses:'));
    if(target){
      const paragraph=el('p','Budget cohort clarification. The 995,670-unit remainder above is the pre-continuation checkpoint used for the same-input 67→40 packing measurement: 20 sends and 1,004,330 admitted units under a 2,000,000-unit cap. The later recorded source-only terminal ledger has 31 sends and 1,454,173 admitted units, leaving 545,827. A new repair must load and authenticate the latest durable parent/progress/ledger and derive its remaining allowance there; it must never reset to the earlier prefix. Neither historical file amount authorizes dispatch. The pure plan cache stores grouping, not the inherited allowance or permission to spend.','notice');paragraph.id='outline-terminal-budget-cohort';
      const raw=details('Exact checkpoint and later terminal budget evidence with JSON field paths',pretty(budget.note));
      const line=el('p',undefined,'caption'),link=el('a','Open pinned budget-cohort clarification and original ledger references');link.href='../../'+budget.note.path;line.append(link);
      target.after(paragraph,raw,line);
    }
  }
}
// OUTLINE_TERMINAL_BUDGET_COHORT_BOOK_END
// OUTLINE_CONSOLIDATION_CORE_BOOK_START
{
  const core=D.outlineConsolidationCore;
  if(core){
    const box=el('section',undefined,'chapter');box.id='outline-consolidation-core';
    const link=(label,pin)=>{const a=el('a',label);a.href='../../'+pin.path;return a};
    const historical=document.getElementById('outline-capability-implementation');
    if(historical){const note=el('p','Historical source checkpoint. The 680-test integration below is preserved exactly. Chapter 14 changes the adoption service and its test, so those earlier source pins are not the current consolidation verification. Read Chapter 14 for the separately frozen 735-test foundation and its unfinished runtime.','notice');note.id='outline-consolidation-historical-status';historical.insertBefore(note,historical.children[2]||null)}
    box.append(el('div','14 / SOURCE-PRESERVING CONSOLIDATION · FOUNDATION','chapter-number'),
      el('h2','Preserve capabilities before reducing overlap'),
      el('p','This integration is in the local working tree; no commit, push or deployment is included.','caption'),
      el('p','The consolidation core and authenticated parent reader are implemented and mechanically tested. A durable child worker, full-work admission, fresh review, transactional child Apply and Instructor UI are not implemented. This is a foundation, not a completed consolidation feature or evidence of better question quality.','notice'),
      el('p','This checkpoint supersedes the preceding 680-test source snapshot because the adoption service and its test changed. All 52 earlier payload values and their source inputs, failures and screenshots remain historical evidence. The current foundation has 21 suites / 735 passing tests; scripted judgments and mocked storage do not establish semantic recovery.'));
    box.append(el('h3','An explicit rewrite must preserve every member’s old credit obligations'),
      el('p','An instructor-selected group contains two to four source-supported parent objectives. An untrusted proposal names surviving IDs, replacement wording and explicit predecessor-to-successor lineage. Three objectives may become two, or two may remain two with narrower wording. No broad winner is chosen automatically. Unaffected objects and global IDs remain intact; each survivor receives only its explicit predecessors’ original-source scope.'),
      el('p','Recorded parent findings are observations. The core checks old credit assignments and recalculates child peer nominations, including affected unchanged third objectives. Every replacement needs fresh source review. A minimum replacement-target list does not authorize copying unchanged source findings. Missing parent comparison rows require complete fresh child comparison envelopes; a structurally valid draft grants no review, spending or adoption authority.'));
    const controls=core.controls;
    box.append(el('h3','Five controls use the actual retained 142-objective input'),
      el('p','The original source findings are retained model judgments, not teacher-calibrated truth. Replacement wording and credit assignments below are agent-proposed controls. Three proposals pass structural checks as unreviewed drafts; the two negative controls refuse. No new semantic verdict or accepted survivor is produced.','caption'),
      evidenceTable('Actual retained-input consolidation controls',['Selected objective IDs','Structural outcome','Child / fresh directions','Exact complete input, proposal and output'],controls.map(row=>[row.selectedIds.join(', '),row.status+(row.error?' · '+row.error:''),row.draftSummary?row.draftSummary.childObjectives+' / '+row.draftSummary.requiredFreshComparisons:'No child draft',link('Exact control JSON',row.exactInputProposalOutput)])));
    for(const row of controls){
      const detail=el('details');detail.append(el('summary',row.id+' · '+row.status));
      if(row.originalMembers.length)detail.append(evidenceTable(row.id+' exact original wording',['Parent ID','Original objective wording','Assigned evidence IDs'],row.originalMembers.map(item=>[item.id,item.name,item.evidenceIds.join(', ')])));
      if(row.proposal)detail.append(evidenceTable(row.id+' exact unreviewed replacement wording',['Surviving ID','Proposed wording','Assigned evidence IDs'],row.proposal.replacements.map(item=>[item.id,item.name,item.evidenceIds.join(', ')])),details('Exact predecessor-to-successor lineage',pretty(row.proposal.lineage)));
      detail.append(details('Exact structural observations and old member-credit obligations',pretty({selectedIds:row.selectedIds,status:row.status,error:row.error,originalSectionCount:row.originalSectionCount,oldCreditObligations:row.oldCreditObligations,draftSummary:row.draftSummary})),link('Complete originals, proposal, before/after contexts and error',row.exactInputProposalOutput));box.append(detail);
    }
    box.append(el('p','For L105/L106/L128, the explicit proposal retires L128 and keeps L105/L106: 141 objectives, 25 old credit obligations and 242 required fresh comparison directions. Omitting calculation credit E690 refuses with structure-consolidation-old-credit-unassigned. Selecting a source-negative parent also refuses. The equal-count narrowing controls retain 142 objectives and 244 fresh directions; neither is a reviewed consolidation.','checks'));
    box.append(el('h3','The parent reader authenticates history without turning failure into success'),
      el('p','The new parent reader requires the caller’s matching-course transaction and replays source bindings, raw review history, complete results and terminal budgets through the existing capability authority. It reconstructs canonical planned order and full alias-aware context from lazy batches, then returns a cloned private receipt bound to the exact parent, checkpoint, progress and raw history. The receipt contains the authenticated terminal ledger; it is not permission to spend or write a hierarchy.'),
      el('p','A genuine failed, fully reviewed all-held parent can be inspected for consolidation only after the exact finalizer failure, complete source/comparison replay, zero eligible objectives, at least one source-supported finding and absence of a result property are verified. The parent remains failed. Ordinary Apply continues to reject failed runs; imported source-only diagnostics cannot become durable parent authority.'),
      el('h4','A worker-shaped diagnostic false refusal was reproduced and fixed'),
      el('p','Fresh generation clones its synthesis checkpoint before review and later appends one diagnostic for each invalid logical review response. The first parent reader compared that terminal array directly with the frozen pre-review array, rejecting an otherwise authentic corrected all-held parent. The fix derives exactly the worker’s appended records from independently replayed raw history: the first canonical failure reason truncated to 600 characters, exact item/content attempt and one record per failed logical dispatch. It preserves the frozen prefix and all other synthesis metadata. Edited, reordered, missing, duplicate or extra records still refuse.'),
      evidenceTable('Same scripted fixture definition executed before and after the diagnostic fix',['Execution','Passed','Failed','Exact test receipt'],[['Captured old implementation',57,1,link('Red receipt',core.diagnosticRed)],['Fixed implementation',58,0,link('Green receipt',core.diagnosticGreen)]]),
      el('p','These are separate executions of the same scripted fixture definition, not byte-identical provider envelopes or a full real-worker run. The controls use real BSON, parsers, receipts and finalizers with scripted judgments and mocked collection/transaction boundaries. The independent review found no remaining concrete defect in this failed-parent scope.','caption'),
      el('p','A related pre-existing ordinary completed-result synthesis drift remains unresolved. This failed-parent fix does not repair that separate Apply path.','notice'),
      details('Independent finding before the fix',pretty(core.parentReviewBefore)),details('Independent narrow fix inspection and exact source pins',pretty(core.parentReviewAfter)));
    const budget=core.budgetLowerBound.receipt;
    box.append(el('h3','The counterfactual child still cannot fit the terminal allowance'),
      evidenceTable('Optimistic lower bound; not rendered child packing or provider usage',['Obligation','Conservative units'],[['594 complete original JSON rows, sent at least once',fmt(budget.sourceRowUtf8JsonOnce)],['At least 36 reviews × 6,000 output reservation',fmt(budget.minimumOutputReserve)],['Source plus output lower bound',fmt(budget.sourcePlusOutputLowerBound)],['Latest recorded terminal remainder',fmt(budget.remainingTerminalUnits)],['Minimum shortfall',fmt(budget.minimumExcess)]]),
      el('p','The 717,642-unit lower bound already exceeds the later recorded 545,827-unit remainder by 171,815. It omits proposal work, all learning-point definitions, peers, instructions, native escaping and corrections. It is not an actual rendered child plan, provider token count or model latency measurement. No source-reuse authority exists for this counterfactual child. A future runner must authenticate its latest durable ledger and refuse known-impossible full work before sending; neither historical ledger amount authorizes a purchase.','notice'),
      details('Exact child/source JSON-row lower bound and original terminal budget references',pretty(core.budgetLowerBound)));
    box.append(el('h3','Preparation defects remain separate from semantic outcomes'),
      evidenceTable('Preserved preparation failures and corrected inputs',['Retained failure','What happened','What it establishes'],[['V1 fixture alias/corpus misjoin','Review alias S391 for L104/E655 was joined to corpus S391 instead of the correct S425. The selected quote was absent.','Audit fixture defect; not an established production binding or model verdict failure.'],['First root v2 verifier','It read originalSourceIds instead of pointProvenanceCorpusSectionIds and raised KeyError.','Verifier schema error; not a demonstrated v2 fixture defect.'],['Corrected v2 fixture','58 full review originals and 23 separate point-provenance originals remain correctly bound.','Raw future input/source bindings only; no accepted survivor or semantic review.']]),
      details('Exact retained fixture and verifier failures',pretty(core.preparationFailures)),details('Corrected v2 input verification',pretty(core.correctedInputVerification)));
    const final=core.finalVerification.receipt;
    box.append(el('h3','Current engineering verification and unfinished runtime'),
      el('p',fmt(final.verification.combinedSuites)+' suites / '+fmt(final.verification.combinedPassedTests)+' passing tests; full-project typecheck and scoped '+fmt(final.verification.scopedLintFiles)+'-file lint pass. The 58-test diagnostic run and earlier focused counts overlap the combined denominator. The foundation made zero provider, application-database, embedding, queue or OCR calls. A separately authorized review-only API probe is a different evidence phase and is not part of these tests.'),
      el('p','The dedicated durable child/cycle, whole-work admission and budget settlement, explicit-ID checkpoint packing, fresh raw review persistence, stable-ID finalization, lost-credit shortfalls, transactional child Apply and Instructor UI remain unimplemented. Existing names-only repair and exact continuation cannot safely substitute for that runtime. No improved semantic recovery, accepted outline, saved question, provider savings or professor-time result is established.','notice'),
      details('Exact current-source regression, typecheck, lint and scope',pretty(core.finalVerification)),details('Pure core closeout and all earlier compiler/loader/closeout attempts',pretty(core.pureCoreCloseout)));
    for(const [label,pin]of[['Current foundation verification',core.finalVerification],['Implementation note and required next integration',core.implementationDoc],['Retained actual input replay',core.actualReplay],['Full alias-aware original context',core.exactInputContext],['Exact retained source findings — old observations',core.exactInputFindings],['Corrected raw v2 fixture — input, not a verdict',core.correctedRawInput],['Explicit next runtime map',core.runtimeMap],['Combined 735-test JSON receipt',core.combinedTests],['All 52 prior payload and asset bindings',core.baseline],['Previous final reader delivery',core.priorReaderDelivery]]){const p=el('p',undefined,'caption');p.append(link(label,pin));box.append(p)}
    const sources=el('details');sources.append(el('summary','Exact verified source and test snapshots'));
    for(const pin of core.sourceCode){const p=el('p',undefined,'caption');p.append(link(pin.path.split('/code-before/')[1],pin));sources.append(p)}box.append(sources);
    document.querySelector('main > footer').before(box);
    const nav=el('a','14 · Consolidation foundation');nav.href='#outline-consolidation-core';document.querySelector('nav[aria-label="Book chapters"]').append(nav);
  }
}
// OUTLINE_CONSOLIDATION_CORE_BOOK_END
// SOURCE_INTERPRETATION_LIVE_BOOK_START
{
  const live=D.sourceInterpretationLive;
  if(live){
    const box=el('section',undefined,'chapter');box.id='source-interpretation-live';
    const link=(label,pin)=>{const a=el('a',label);a.href='../../'+pin.path;return a};
    const status='Current execution status · 17 October 2026: explicit approval was received and R8 review-only execution completed. Older approval-pending and R3–R6 unexecuted notes are preserved historical snapshots, not the current authorization status. Read Chapter 15 for exact terminal evidence and remaining failures.';
    const overviewNote=el('p',status,'notice');overviewNote.id='source-interpretation-live-current-status';document.querySelector('#overview h2').after(overviewNote);
    document.getElementById('source-interpretation-pending')?.prepend(el('p',status,'notice'));
    box.append(el('div','15 / AUTHORIZED API REVIEW · SELECTED TUNING COHORT','chapter-number'),
      el('h2','The live reviews still miss important defects'),
      el('p',status,'notice'),
      el('p','This separately authorized phase reviewed the same six retained candidate/source/Bank/teacher contexts and all ten initial R7 prompt shapes. R8 refreshed the execution code pins and archived 280 files. It did not generate or repair a candidate, refresh live Bank memory, upload materials, save a Draft or Apply an outline. All 53 prior payload values remain unchanged.'),
      el('p','Only P02 is review-eligible. Five quality responses validate their schema; T/F ends in a schema fallback. This is one eligible review in six selected cases, not a 1/6 generation or saved-question yield result. P01 and P04 were withheld for other reasons while answerability still passed incorrectly; withholding alone does not demonstrate ambiguity detection.','notice'));
    box.append(el('h3','What this means for the original instructor problems'),
      evidenceTable('Original product pains remain the acceptance target',['Instructor problem','Current evidence','What is still required'],[
        ['Out-of-notes material and notation','Bound original passages, exact citations and notation checks exist; this probe retains visible source/notation passes. P01/P04 still misinterpret a table.','Correct source interpretation and teacher-calibrated exclusions; citation membership alone is insufficient.'],
        ['Repeated tasks within an LO or Bank','P02 distinguishes two mechanisms against the exact shown Bank tasks. The six frozen contexts do not refresh live memory.','A complete generation/regeneration acceptance run with current memory and semantic duplicate negatives.'],
        ['Hard means wordier','P04 direct lookup is withheld against Hard. P03 has a genuine fixed Easy versus Medium conflict.','Consistent task demand and source-capacity handling without lowering the teacher’s request.'],
        ['Multiple uploaded chapters and coverage','Earlier 599-page/671-chunk engineering receipts and explicit mapping gaps remain unchanged. This phase uploads nothing.','Full coverage and useful-yield validation; visual/source gaps and the expensive full review remain open.'],
        ['Regeneration obeys edits and remembers the Bank','The current system has bound memory/requirements mechanics, but this phase rewrites no candidate.','Prospective regeneration with exact teacher clauses, current Bank and acceptance outcomes.'],
        ['Decimal numerical variation','P03 and CAPM finite numerical models pass recorded grid/seed checks; CAPM decimal demand passes.','Fix template review and answerability false holds while preserving numerical guards.']
      ]));
    const analysis=live.analysis.receipt,counts=analysis.counts;
    const displayFinding=row=>row.id==='P03'?'Genuine fixed Easy/Medium mismatch; additional reviewer contradiction, not an established false refusal.':row.finding;
    const displayDetail=row=>row.id==='P03'?'The fixed request is Easy, but the unchanged candidate and its task descriptor are Medium. The review separately contradicts itself by describing an easy fulfilled task while reporting achievedDifficulty medium. Source, notation, answerability, Bank comparison and finite arithmetic can pass while the fixed request remains mismatched. A field-only relabel does not prove recovery; this is not an established false refusal.':row.detail;
    box.append(el('h3','Read the reason, not only the withheld label'),
      evidenceTable('Six selected cases with separate mechanical and semantic findings',['Case','Recorded quality outcome','Schema','Observed defect or control'],analysis.cases.map(row=>[row.id,row.qualityStatus,row.qualitySchemaValidated?'Validated':'Fallback; not a semantic verdict',displayFinding(row)])),
      el('p','Prominent case summaries use the final independent classification. The terminal analyst’s earlier P03 false-refusal hypothesis remains unchanged only inside the explicitly labelled raw/provisional receipt below.','caption'),
      el('p','P01 and P04 expose unsupported distractor exclusion: mitigation is not elimination, and placement in a source-table column is not proof of exclusivity. P03 says its task is fulfilled and describes an easy application, but emits achievedDifficulty medium against the fixed Easy request. Its original candidate and descriptor are also Medium, so a genuine request mismatch exists; a false refusal is not established. CAPM now accepts decimal numeric demand, yet its separate content reviewer rejects unresolved template placeholders despite a deterministic displayed-input proof. T/F role and content checks pass; its quality fallback is a JSON type failure.'),
      el('h3','Inspect each exact context, response and native request'));
    const label=el('label','Retained case');label.htmlFor='source-live-case-select';const select=el('select');select.id='source-live-case-select';
    for(const row of analysis.cases){const option=el('option',row.id+' · '+row.qualityStatus);option.value=row.id;select.append(option)}
    const panel=el('div');panel.id='source-live-case-panel';box.append(label,select,panel);
    function renderLiveCase(){
      const id=select.value,row=analysis.cases.find(item=>item.id===id),input=live.originalCases.find(item=>item.id===id),outcome=live.outcomes.find(item=>item.id===id);
      panel.replaceChildren();panel.append(el('h4',id+' · exact retained candidate'),el('p',input.candidate.stem,'question'));
      for(const option of input.candidate.options){const line=el('div',option.key+' · '+option.text,'option');line.append(el('small','Recorded role: '+option.role+' · '+option.explanation));panel.append(line)}
      panel.append(el('p',displayFinding(row),'notice'),el('p',displayDetail(row)),el('p','Next action: '+row.nextAction,'checks'),
        details('Exact teacher request, source packet, Bank memory and candidate definitions',pretty(input)),
        details('Full recorded assessment, answerability, task demand and numerical results',pretty(outcome)),
        details('Blinded independent expectation for this exact case',pretty(live.blindExpectations.receipt.expectations.find(item=>item.id===id))));
      const independentRow=live.independentComparison?.receipt.cases.find(item=>item.id===id);
      if(independentRow)panel.append(el('p','Independent comparison: '+independentRow.independentReasonedComparison.summary,'checks'),details('Independent source, request, answerability and refusal classification',pretty(independentRow.independentReasonedComparison)));
      const calls=live.captures.filter(item=>item.call.caseId===id);
      for(const entry of calls){const capture=entry.capture,call=entry.call,detail=el('details');detail.className='checks';detail.append(el('summary','Call '+call.index+' · '+call.kind+' · exact input and raw output'),
        el('h4','Exact model-facing prompt'),el('pre',capture.admission.prompt),el('h4','Exact raw visible output'),el('pre',capture.cumulativeVisibleText??capture.rawResponse?.content??'(No visible content recorded)'),
        details('Actual native SDK arguments — full captured request',pretty(capture.actualArguments)),
        details('Raw provider response and full native transport capture',pretty(capture.rawResponse)),
        details('Exact per-call options, usage and binding',pretty(call)),link('Complete pinned native transcript',entry.exactTranscript));panel.append(detail)}
    }
    select.addEventListener('change',renderLiveCase);renderLiveCase();
    box.append(el('h3','Ambiguity and false refusals remain open'),
      el('p','P01’s A response says asset-class diversification mitigates market risk; C says it cannot diversify market risk away. Those claims are not mutually exclusive merely because mitigation differs from elimination. The retained table explicitly uses an investor mitigation row. P04’s review similarly treats a strategy listed in another column as an exclusion proof. Both answerability checks pass, so their final withheld status does not resolve the ambiguity.'),
      el('p','The numeric cases separate arithmetic from review interpretation. P03 has all 16 explicit slot combinations plus 100 seeded checks; CAPM has all 27 plus 100 seeded checks and displayed-input verification. These finite-domain mechanical receipts do not prove source support or task novelty. CAPM’s content-review rejection of the symbolic template is a separate interpretation failure; the numerical serving guard remains required.','checks'));
    box.append(el('h3','Every observed API call and its cost are retained'),
      evidenceTable('Authorized R8 review-only totals; provider-reported usage is distinct from admission units',['Observation','Recorded value'],[
        ['Observed SDK calls / wire attempts / HTTP 200',counts.nativeSdkCalls+' / '+counts.secondaryWireFetchAttempts+' / '+counts.transportSuccesses],
        ['Reported input tokens',fmt(counts.knownInputTokens)],['Reported output tokens',fmt(counts.knownOutputTokens)],['Reported total tokens',fmt(counts.knownTotalTokens)],
        ['Conservative reservation units / authorized maximum',fmt(counts.conservativeReservationUnits)+' / '+fmt(counts.maxConservativeUnits)],
        ['Recorded phase elapsed time',(counts.elapsedMs/1000).toFixed(3)+' seconds'],['Unknown-usage calls',counts.unknownUsageCalls],['Saved / adopted','0 / 0']]),
      el('p','All 12 observed native calls returned. P04 used the existing correction for a missing solution citation; T/F used it for an answerability type error. There were two logical assessment corrections and zero observed JSON parse retries. All requests used gpt-6-luna, reasoning none, temperature 0 and a 2,000-output-token cap. Reported input/output tokens are not conservative UTF-8 admission units. SDK retry visibility and provider billing guarantees remain limited; this is not a dollar-saving or general latency comparison.','caption'),
      evidenceTable('All 12 exact provider captures',['Call / case','Stage','Input / output tokens','Observed milliseconds','Full exact native transcript'],live.captures.map(entry=>[entry.call.index+' · '+entry.call.caseId,entry.call.kind,entry.call.usage.inputTokens+' / '+entry.call.usage.outputTokens,entry.call.elapsedMs,link('Native input/output JSON',entry.exactTranscript)])));
    box.append(el('h3','T/F exposed a concrete prompt and schema mismatch'),
      el('p','The paid quality prompt described stemTruth:true|false|undetermined without quoted string literals. The schema requires the strings "true", "false" or "undetermined". Both actual quality responses returned JSON boolean true; the correction repeated the ambiguous shape and only named invalid_type. The final quality outcome is a schema fallback, not a validated semantic refusal. The separate role and content reviews pass and correctly distinguish a literal False response from truthful corrective feedback.'),
      el('p','The independent comparison also finds masked secondary defects: the T/F correction splits one exact required-change clause into different rows and omits solution citations. Its strict-variant caveat remains because the candidate adds a market-risk conjunct to the original stem. Fixing the JSON string type alone does not establish eligibility, preserved task identity or a complete repair.','notice'),
      el('p','Select TF above to inspect both exact boolean responses and the successful role/content checks. The historical paid responses stay unchanged.','caption'));
    if(live.tfOffline){const tf=live.tfOffline.receipt;box.append(el('h4','Separate offline T/F follow-up — no post-fix API call'),el('p','The later instructions explicitly quote all string enum literals and provide typed correction guidance. The strict schema still rejects both original paid boolean responses. Changing only the type in offline copies validates the answerability schema alone, not the complete quality envelope. No coercion, wider schema, extra cycle, higher limit or post-fix provider send is introduced.','notice'),el('p','The retained red run has '+tf.checks.red.passed+' passes and '+tf.checks.red.failed+' failure; the green checkpoint has '+tf.checks.green.suites+' suites / '+tf.checks.green.passed+' passes, with typecheck and scoped lint passing. A compact-branch test-preparation correction is disclosed in the receipt, so these denominators are not a matched quality-rate comparison. The masked solution-citation and exact-requirement defects still matter. This does not change the R8 fallback into a paid recovery, semantic pass or saved question.','caption'),details('Pinned offline T/F instruction/schema verification',pretty(live.tfOffline)),details('Independent narrow offline T/F review',pretty(live.tfIndependentReview)));const p=el('p');p.append(link('Offline-only T/F follow-up receipt',live.tfOffline));box.append(p)}else box.append(el('p','A narrow offline-only T/F instruction/schema follow-up is awaiting its final verification receipt. No post-fix API response is claimed.','empty'));
    box.append(el('h3','Independent expectations were frozen before output inspection'),
      el('p','A separate reviewer froze six exact-context expectations before examining the R8 outputs. This describes the reviewer’s inspection order, not a claim that provider responses did not yet exist. The receipt discloses a later unsolicited T/F note and which secondary analyses were read after freeze. These are reasoned, uncalibrated AI judgments, not professor labels or held-out population accuracy. Exact source quotes and separate rational-arithmetic controls remain inspectable.'));
    if(live.independentComparison){box.append(el('p','The independent audit matches all six candidate hashes and all 12 transcript records, sums provider-reported usage, and resolves 46 own-source quote references. These checks establish input/output and reference integrity; they do not validate the reviewer’s semantic interpretation. The final additive closeout retains the initial comparison closeout and the read-only null-field preview failure.','caption'),details('Final independent comparison against blinded expectations',pretty(live.independentComparison)),details('Independent byte/reference verification',pretty(live.independentVerification)),details('Final independent comparison closeout r2',pretty(live.independentCloseout)));const p=el('p');p.append(link('Independent terminal comparison and limits',live.independentReview));box.append(p)}else box.append(el('p','Independent comparison of the terminal outputs against those frozen expectations is pending. The terminal analysis above is not presented as that independent conclusion.','empty'));
    box.append(el('h3','What this paid phase establishes'),
      el('p','This is a selected tuning cohort after known failures. It establishes the recorded behavior and usage of these six exact contexts under one review configuration. It does not establish general accuracy, better multi-file source coverage, complete Bank duplicate recall, saved-question yield, model ranking or reduced professor review time. No candidate rewrite, new source/candidate generation, application-database operation, queue write, Draft save or adoption occurred.','notice'),
      details('Raw/provisional terminal analyst receipt — earlier P03 hypothesis superseded above',pretty(live.analysis)),details('Exact terminal verification and archived code/file identities',pretty(live.terminalVerification)));
    for(const [name,pin]of[['Explicit R8 authorization',live.authorization],['Original six complete context payloads',live.originalInput],['Exact R7→R8 unchanged input/prompt proof',live.sourcePayloadFreeze],['Complete immutable live result',live.results],['Conservative terminal ledger',live.ledger],['Archived 280-file execution code manifest',live.archivedCode],['Frozen blinded independent expectations',live.blindExpectations],['Terminal delivery receipt',live.delivery],['Independent comparison final closeout r2',live.independentCloseout],['Root archive verification — exact prompt bytes, not path equality',live.rootArchiveVerification],['Retained first root verifier metadata-path failure',live.retainedRootVerifierFailure],['Original foundation documentation before current status updates',live.foundationDocumentationArchive],['English paid-result implementation note',live.implementationDoc],['Full goal-progress audit — goal remains active; reader was pending at write',live.rootGoalStatus],['All 53 preceding book values and assets',live.baseline]]){const p=el('p',undefined,'caption');p.append(link(name,pin));box.append(p)}
    document.querySelector('main > footer').before(box);const nav=el('a','15 · Live review failures and cost');nav.href='#source-interpretation-live';document.querySelector('nav[aria-label="Book chapters"]').append(nav);
  }
}
// SOURCE_INTERPRETATION_LIVE_BOOK_END
// NUMERIC_SEMANTIC_REVIEW_BOOK_START
{
  const numeric=D.numericSemanticReview;
  if(numeric){
    const box=el('section',undefined,'chapter');box.id='numeric-semantic-review';
    const link=(label,pin)=>{const a=el('a',label);a.href='../../'+pin.path;return a};
    box.append(el('div','16 / NUMERIC REVIEW REPRESENTATION · OFFLINE ONLY','chapter-number'),
      el('h2','Show numeric reviewers one verified example'),
      el('p','This implementation is in the local working tree; no commit, push or deployment is included.','caption'),
      el('p','The server now prepares a bounded rendered numerical example beside the complete original template. This chapter records offline arithmetic, representation, persistence and admission checks. No new model response exists after this change. The unchanged R8 CAPM rejection remains a failure observation; it is not replaced by a scripted or inferred pass.','notice'),
      el('p','All 54 preceding payload values and 525 prior PNGs remain preserved. Chapters 14–15 are dated evidence: R8 code is archived at its paid terminal checkpoint, and its later T/F checks are an earlier offline checkpoint. Their source pins are not upgraded into this phase’s current-source verification.'));
    box.append(el('h3','The original problem was template interpretation, not missing arithmetic inputs'),
      el('p','The actual paid CAPM content request already contained parameter domains, derived formulas and a positive displayed-input verification note. The reviewer nevertheless rejected its unresolved template placeholders. The separate quality check left a wrong beta-halving response undetermined. The original numerical receipt covers all 27 explicit combinations plus 100 seeded checks. These facts separate a concrete representation/interpretation failure from numerical verification; they do not approve the distractor’s finance story, source assumptions or teacher-clause compliance.'),
      el('p','The additional representation fills one example using the trusted existing slot resolver, formula evaluator and serving formatter. It keeps the full original symbolic candidate and all source, Bank and teacher context. The declared key, roles and feedback remain candidate claims. Arithmetic cannot create source support, an exclusive distractor exclusion, semantic novelty or a lower difficulty target.','checks'));
    const display=numeric.display||{};
    box.append(el('h3','Full private sample and compact model projection have different jobs'));
    if(display.samples)box.append(evidenceTable('Only duplicated witness projection is compacted; original payload and private proof unchanged',['Case','Earlier model fragment bytes','Compact fragment bytes','Private witness / receipt equal'],display.samples.map(row=>[row.id,row.beforeFragmentBytes,row.afterFragmentBytes,String(row.privateWitnessExactEqual)+' / '+String(row.privateReceiptExactEqual)])),el('p','Quality adds another 126 bytes of original-stem citation guidance. Native envelopes add their own escaping/framing; fragment bytes alone are not the full input cost.','caption'));
    for(const row of display.samples||[]){
      const sample=row.fullWitness?.sample;
      box.append(el('h4',row.id+' · deterministic sample, not a new model answer'));
      if(sample){box.append(el('p',sample.stem,'question'),evidenceTable(row.id+' actual rendered sample',['Option','Rendered text','Declared role','Computed raw value'],sample.options.map(option=>[option.key,option.text,option.role,option.value])),el('p','Declared key: '+sample.declaredKey+'. Its semantic correctness still needs source/answerability review.','caption'))}
      if(row.compactModelFragment)box.append(details('Exact compact additional model fragment',row.compactModelFragment));
      box.append(details('Complete private sample and numerical scope — not all sent as duplicate prompt metadata',pretty(row.fullWitness)));
    }
    box.append(el('p','The full witness is computed privately; complete samples remain in audit/test artifacts. Normal database records persist only bounded numericReview metadata receipts and the full canonical candidate in cached-stage bindings, not a new general raw-I/O collection. The compact model fragment omits redundant private metadata and repeated candidate claims; complete original roles, key, feedback, formulas and source context remain in the surrounding packet. A null feedback entry references the complete original feedback for that exact key only after template/hash binding confirms the rendered feedback is unchanged. Changed rendered feedback is included. This is not source, teacher, Bank or candidate truncation.'),
      el('p','Conceptual/T/F templates without numerical definitions are explicitly not-applicable and add zero witness text. An unavailable result discloses its reason; it creates neither a proof nor a missing-premise waiver. The existing source, literal-answerability, teacher and numerical serving checks remain independent.'));
    box.append(el('h3','Compare exact paid input with the new local representation'));
    const caseLabel=el('label','Retained numerical case');caseLabel.htmlFor='numeric-review-case-select';const cases=el('select');cases.id='numeric-review-case-select';
    for(const id of ['CAPM','P03']){const option=el('option',id);option.value=id;cases.append(option)}
    const stageLabel=el('label','Review stage');stageLabel.htmlFor='numeric-review-stage-select';const stages=el('select');stages.id='numeric-review-stage-select';
    for(const [value,text]of[['quality-review','Quality'],['role-validation','Option roles'],['content-review','Content']]){const option=el('option',text);option.value=value;stages.append(option)}
    const panel=el('div');panel.id='numeric-review-io-panel';box.append(caseLabel,cases,stageLabel,stages,panel);
    function renderNumericReview(){
      const id=cases.value,stage=stages.value,old=D.sourceInterpretationLive?.captures.find(row=>row.call.caseId===id&&row.call.kind===stage),fresh=numeric.exactText[id+'-'+stage],control=numeric.exactText[id+'-'+stage+'-absent'];
      panel.replaceChildren();panel.append(el('h4',id+' · '+stage));
      if(old){panel.append(details('Exact historical R8 paid prompt — unchanged',old.capture.admission.prompt),details('Exact historical R8 raw response — unchanged',old.capture.cumulativeVisibleText??old.capture.rawResponse?.content??'(No visible content recorded)'),link('Full immutable R8 native arguments/input/output',old.exactTranscript))}else panel.append(el('p','No paid R8 response for this case/stage was executed. No historical output is invented.','caption'));
      if(control)panel.append(details('Exact current absent-selector control — local, no API call',control.text),link('Open exact local control prompt bytes',control));
      if(fresh){panel.append(details('Exact new offline model-facing input — complete original plus computed example',fresh.text),link('Open exact new local prompt bytes',fresh))}else panel.append(el('p','Inspect the linked final native-envelope receipts for this local path.','caption'));
      panel.append(el('p','New model output: none. This phase made no provider call; the new input has not demonstrated model acceptance or recovery of the old refusal.','notice'));
    }
    cases.addEventListener('change',renderNumericReview);stages.addEventListener('change',renderNumericReview);renderNumericReview();
    box.append(el('h3','Input headroom includes the failures, not only the fitting arm'),
      el('p','The first full-witness measurement included eight overflows in the fresh-current compact explicit cohort. The full 416-path matrix also includes historical requirement cohorts and their separate failures. The revision compacts redundant witness projection only, while keeping complete original candidate/source/teacher/Bank payloads and unchanged input/output/send ceilings. Read every cohort separately: a fresh-cohort fit is not a claim that every historical path or future course fits.'));
    if(display.headroomRows)box.append(evidenceTable('File-only native admission before and after witness projection compaction',['Cohort','Before paths / overflows','Before maximum','After paths / overflows','After maximum'],display.headroomRows.map(row=>[row.cohort,row.beforePaths+' / '+row.beforeOverflows,row.beforeMax,row.afterPaths+' / '+row.afterOverflows,row.afterMax])));
    box.append(el('p','The fresh explicit cohort now has 0/104 overflows, with maximum 23,505 and 495 units remaining under 24,000. Nine historical explicit paths and four historical absent-selector paths still overflow: 13 refused paths in the complete 416-path matrix. Those historical failures have not disappeared. All 416 final native envelopes and 104 unique prompts match the preceding projection run after the non-renderer cache repair; 102 imported source pins are separately frozen.','checks'));
    box.append(el('p','These are actual local renderer/envelope/admission observations with intercepted provider boundaries. Native input estimates and reserved output units are not provider-reported tokens, money, model latency or saved yield. Known oversize paths refuse before dispatch; no source clipping, larger cap or ledger reset is a remedy. Local arithmetic and repeated receipt replay also consume CPU.','notice'));
    box.append(el('h3','Persistence binds the exact candidate the checks saw'),
      el('p','Fresh v2 public runs and durable regeneration persist server-rendered-numeric-review-v1. Workers, task plans and exact retries carry the stored selector; initially absent historical selectors and same-UUID recovery keep their contracts. All three review paths receive the current representation, including changed repair and evidence expansion.'),
      el('p','Cached role/content findings bind the full canonical candidate and a fresh server receipt, including unavailable/not-applicable states. Repair-stage metadata records the exact pre-canonical candidate that the role/content calls examined. It cannot claim those reviewers saw a later normalized candidate. Final public save and regeneration adoption replay the receipt inside the existing course fence. Initial-to-fresh selector equality prevents a new contract from downgrading to legacy absence during transactional reread.'),
      el('p','The helper bounds sample text and numerical work, uses the real fresh verifier, and executes no generation script. One displayed sample is not all possible draws; the receipt distinguishes the existing sampled checks from a complete finite grid. Source, Bank, teacher, task-demand and numerical-serving guards are not waived.'));
    box.append(el('h3','Current engineering verification and explicit remaining work'));
    if(display.verificationSummary)box.append(el('p',display.verificationSummary));
    box.append(el('h4','A same-fixture BSON repair-cache control exposed a real provenance bug'),el('p','The repaired conceptual candidate was canonicalized after its role/content calls. Saving that normalized candidate beside the raw-stage receipt made valid cached recovery refuse. The retry now returns the actual raw numericReviewCandidate and its stage binding; public recovery persists that checked candidate while final quality/save still canonicalizes. The exact same scripted fixture with real BSON changes from 29/30 to 30/30 checks. This is a mechanical cache correction, not a paid-model before/after or recovered semantic yield.','checks'));
    box.append(el('p','The initial broad regression’s legacy-fixture failures and the eager absent-selector snapshot bug remain retained, together with their narrow conditional-evaluation fix and subsequent verification. Earlier lint, loader and measurement failures are evidence, not discarded attempts. Scripted improved reviewer replies prove wiring only. The R8 paid results remain one eligible selected review and zero saved/adopted questions; no post-change semantic recovery or professor-time improvement is claimed.','notice'),
      el('p','The next acceptance work must test whether reviewers use this representation correctly while preserving source-negative, ambiguity, teacher-clause, numerical-collision and genuine demand-mismatch controls. P03’s fixed Easy versus Medium mismatch does not disappear when its arithmetic is rendered. P01/P04 table ambiguity and multi-file source coverage remain separate open problems.'),
      details('Final current-source implementation, verification and limits',pretty(numeric.finalVerification)));
    for(const [name,pin]of Object.entries(numeric.evidence)){const p=el('p',undefined,'caption');p.append(link(name,pin));box.append(p)}
    for(const [name,pin]of Object.entries(numeric.files)){const p=el('p',undefined,'caption');p.append(link(name,pin));box.append(p)}
    for(const [name,pin]of [['English numerical-review implementation note',numeric.implementationDoc],['All 54 preceding payload and asset identities',numeric.baseline]]){const p=el('p',undefined,'caption');p.append(link(name,pin));box.append(p)}
    document.querySelector('main > footer').before(box);const nav=el('a','16 · Numerical review witness');nav.href='#numeric-semantic-review';document.querySelector('nav[aria-label="Book chapters"]').append(nav);
  }
}
// NUMERIC_SEMANTIC_REVIEW_BOOK_END
// ANSWER_EXCLUSION_WARRANTS_BOOK_START
{
 const w=D.answerExclusionWarrants;
 if(w){
  const box=el('section',undefined,'chapter');box.id='answer-exclusion-warrants';
  const link=(label,pin)=>{const a=el('a',label);a.href='../../'+pin.path;return a};
  const v=w.finalVerification.receipt,fixture=w.evidence['Exact five-case R8 inputs and six actual responses'].receipt,spec=w.evidence['Independent interpretation; not professor labels'].receipt,native=w.evidence['Final native envelope and prompt matrix'].receipt;
  box.append(el('div','17 / LITERAL EXCLUSION WARRANTS · OFFLINE IMPLEMENTATION','chapter-number'),el('h2','Require a warrant before excluding an alternative'),
   el('p','This integration is in the local working tree; no commit, push or deployment is included.','caption'),
   el('p','Model outcome after this change: unknown. No new paid response, saved question, professor acceptance or review-time improvement is established. The actual R8 P01/P04 answerability misses remain unchanged; scripted contract checks do not replace their paid responses.','notice'),
   el('p','All 55 preceding payload values and 565 prior PNGs remain preserved, including chapter16. Its 719-test source checkpoint is historical after this change; its numerical measurements and original R8 observations are not rewritten. Current verification is 21 suites / 840 passing tests, with full-project typecheck and scoped 23-file lint. Focused checks overlap that total.'));
  box.append(el('h3','Actual paid failures: mitigation is not elimination'),el('p','Five unchanged MCQ contexts contain six actual R8 quality responses because P04 has two attempts. Exactly 130 displayed-source-span occurrences join to retained original text. Source identity is not entailment, a professor label or representative coverage. The T/F response from R8 is outside this five-case MCQ fixture.'),
   evidenceTable('Actual R8 observations and distinct diagnostic controls',['Case','Actual retained quality / answerability','Independent interpretation and protected boundary'],[
    ['P01','Withheld / passed','The rejected alternative says mitigate; the rejection cites inability to diversify away. That changes the predicate. Independent inspection finds an insufficient exclusion, not a professor-certified second answer. Overall withholding for other reasons did not detect ambiguity.'],
    ['P04','Withheld / passed, twice','Table placement and “an investor” do not establish exclusivity for the broad can-mitigate question. Easy versus fixed Hard demand remains a separate mismatch.'],
    ['P02','Eligible / passed; no save/adoption','Option A explicitly denies a source-taught averaging mechanism. A direct false clause can remain a valid negative; corrective feedback is not another literal answer.'],
    ['CAPM','Withheld / withheld','A taught formula can refute wrong arithmetic without teaching the wrong operation as true. Source assumptions, feedback and numerical correctness remain separate. No new model recovery is shown.'],
    ['P03','Withheld / passed','The fixed Easy request versus achieved Medium remains a genuine demand mismatch. This is not an established false refusal.']]),
   el('p','Actual paid input/output, independent inspection and new scripted contract output have different provenance. Shared candidate/source inputs do not mean identical prompts or identical responses. No result here is a new generation yield.','checks'));
  box.append(el('h3','Same quality call, stronger diagnostic contract'),el('p','Literal option → scoped exclusion warrant → strongest source-supported applicability challenge → server answer-set check. The warrant and challenge use the same existing quality-review call, not another agent or paid stage. Literal findings are independent of the proposed key and option role; the server checks uniqueness/key only afterward.','checks'),
   el('p','Every negative records an exact original option clause, a permitted basis, any exact student-visible task restriction and a bounded challenge. Viable or uncertain alternatives stay withheld. Table placement, strength alone, silence and undetermined bases do not establish exclusion. Direct false clauses, genuine task restrictions and taught derivations retain a positive route. Reference membership, hashes and valid fields do not prove entailment or applicability.'),
   el('p','Fresh v2 requests persist literal-exclusion-warrants-v1 through workers, exact retry, durable regeneration and UUID recovery. Historical absence and T/F preserve their earlier contracts. Final course-fenced checks bind the full candidate, immutable requirements, original source packet and used numeric witness. Recorded-withheld replay preserves diagnostics and grants no admission. Source, teacher, Bank, numerical and task-demand checks remain required.'),
   el('p','Malformed output uses only the existing one correction; genuine ambiguity is not a schema retry. Current correction diagnostics group owned error paths while retaining the exact code/path multiset. Owned instructions are compacted without clipping source, Bank, teacher or candidate data. Numeric optionQuote/stemQuote must refer to ORIGINAL CANDIDATE text, never its rendered sample.'));
  box.append(el('h3','Inspect original input, actual output and scripted control'));
  const label=el('label','Retained MCQ case');label.htmlFor='exclusion-case-select';const cases=el('select');cases.id='exclusion-case-select';for(const id of ['P01','P04','P02','CAPM','P03']){const o=el('option',id);o.value=id;cases.append(o)}
  const shapeLabel=el('label','Local scripted response shape');shapeLabel.htmlFor='exclusion-shape-select';const shape=el('select');shape.id='exclusion-shape-select';for(const[value,text]of[['scripted-ambiguity-shape','Ambiguity shape — scripted'],['scripted-resolved-shape','Resolved shape — scripted']]){const o=el('option',text);o.value=value;shape.append(o)}
  const panel=el('div');panel.id='exclusion-io-panel';box.append(label,cases,shapeLabel,shape,panel);
  function showExclusion(){
   const c=fixture.cases.find(row=>row.id===cases.value),analysis=spec.caseAnalyses.find(row=>row.id===cases.value),q=c.exactApprovedControl;
   panel.replaceChildren(el('h4',c.id+' · actual R8 input and output'));
   panel.append(el('p',q.candidate.stem,'question'));for(const option of q.candidate.options)panel.append(el('div',option.key+' · '+option.text,'option'));
   panel.append(el('p','Observed overall quality: '+c.observed.wholeQualityStatus+'; recorded answerability: '+c.observed.answerabilityStatus+'. Saved/adopted: zero.','caption'),
    el('p',analysis.independentDiagnostic,'checks'),el('p','Independent AI inspection of retained originals; no human label and no fresh semantic execution. '+analysis.independentWholeQualityCaveat,'caption'),
    details('Exact unchanged candidate, source packet, Bank memory and teacher requirements',pretty({candidate:q.candidate,packet:q.packet,memory:q.memory,requirements:q.requirements})),details('All exact source aliases and original bindings for this case',pretty(c.qualityReviewAttempts.map(a=>({captureId:a.captureId,source:a.exactShownSourceObject,bindings:a.spanOriginalBindings})))));
   c.qualityReviewAttempts.forEach((a,i)=>{
    const cap=a.completeCapture,raw=cap.cumulativeVisibleText??cap.rawResponse?.content??'';
    panel.append(el('h4','Actual paid R8 quality response '+(i+1)),details('Exact actual R8 paid prompt '+(i+1),cap.admission.prompt),details('Exact actual R8 raw response '+(i+1),raw),details('Actual R8 native arguments, usage and full capture '+(i+1),pretty(cap)),link('Open unchanged paid prompt '+(i+1),a.exactPromptFile));
   });
   for(const selector of ['absent','selected']){const p=w.exactText[c.id+'-'+selector];panel.append(details(selector==='selected'?'Exact new local exclusion-contract input — no API call':'Exact local absent-selector control — no API call',p.text),link('Open exact '+selector+' local prompt bytes',p),details('Actual local '+selector+' native envelope — intercepted',pretty(p.native.receipt)))}
   const control=w.scriptedControls[c.id+'-'+shape.value];panel.append(el('p','New provider output: none. The following body is a scripted schema/length control, not a model response, semantic success, repaired candidate or teacher judgment.','notice'),details('Scripted contract body — never a new paid response',pretty(control.receipt)),link('Open exact scripted control file',control));
  }
  cases.addEventListener('change',showExclusion);shape.addEventListener('change',showExclusion);showExclusion();
  box.append(el('h3','Input fit improved; semantic effect and output fit remain unknown'),el('p','Every row below is an OFFLINE counterfactual native-path measurement using forced correction inputs and an intercepted fake SDK. The historical-format 4 absent and 4 selected overflows are not actual paid R8 API failures. Actual R8 quality outputs are the six retained responses for these five MCQs.','notice'),
   evidenceTable('Offline native correction-path cohorts, not paid calls',['Requirements cohort','Measured paths','Overflow paths','Maximum conservative input units','Remaining under 24,000'],native.cohortSummary.map(r=>[r.cohort,r.measuredPaths,r.overflowPaths,fmt(r.maximumInputUnits),r.minimumHeadroom])),
   el('p','Final retained compact-plus-numeric selected: 128/128 paths fit, maximum 23,906/24,000, only 94 units remaining. Its absent control has 112/112 fitting paths, maximum 23,505. All 480 native envelopes and 120 unique prompts remain inspectable. These are conservative input units, not provider tokens, money or latency. Different 112/128 path sets are not a paired semantic comparison.','checks'),
   evidenceTable('Retained failed trials in the selected compact/numeric cohort',['Checkpoint','Paths','Overflows','Maximum input units'],['First native trial, failures retained','Second native trial, failures retained'].map(name=>{const r=w.evidence[name].receipt.cohortSummary.find(row=>row.cohort==='retained-compact-plus-numeric-selected');return[name,r.measuredPaths,r.overflowPaths,r.maximumInputUnits]})),
   el('p','The first trial refused 6/128 at maximum 25,279; the second still refused 1/128. Grouped correction paths and compact owned instructions recover measured input admission. Full candidate/source/Bank/teacher payloads remain equal within each selector pair; sibling role/content prompts stay unchanged. This pair adds the stated compact-authoring/numeric selectors on both sides; it does not emulate every fresh task-retrieval or Exact-Bank default. No cap increase, payload clipping or allowance reset is included.'),
   el('p','The 24 scripted output bodies reach 4,287 UTF-8 bytes, but bytes and an input estimator are not output-token counts. No general output fit under the unchanged 2,000 output-token cap is proved. R8’s 16-send / 320,000-unit ceiling belonged to its completed, closed authorization. These offline measurements renew no allowance. A future paid preflight requires separate authorization.'));
  box.append(el('h3','Where an Instructor sees the exclusion check'),el('p','Generate questions → Generation activity → View steps → Check details → Answerability checks. Regeneration: Question editor → Regenerate side by side → Source and memory checks. Both use the same shared component. Open an option, then Exclusion check for its clause, basis, alternative challenge, short issue labels and source quotations.'),
   el('p','No extra page, model request, override or auto-adoption is added. Missing/unknown/malformed receipts show unavailable; historical absent-protocol DOM matches the prior compiled renderer. Quotations locate evidence, not entailment proof. The screenshots below are coherent, explicitly scripted UI fixtures; they are not P01 provider output.','caption'));
  const uiLabel=el('label','Instructor screenshot');uiLabel.htmlFor='exclusion-ui-select';const uiSelect=el('select');uiSelect.id='exclusion-ui-select';for(const row of w.uiImages){const o=el('option',row.name);o.value=row.name;uiSelect.append(o)}
  const preferred=(matchMedia('(max-width:800px)').matches?'mobile':'desktop')+'-'+(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');uiSelect.value=preferred;
  const fig=el('figure'),imgLink=el('a'),img=el('img'),caption=el('figcaption','Scripted shared Instructor renderer. Open the image for exact full-size footage.');img.alt='Scripted Instructor exclusion disclosure with viable mitigation alternative, withheld status and source quotation';img.style.maxHeight='none';img.style.width='min(100%,760px)';imgLink.append(img);fig.append(imgLink,caption);function uiShot(){const row=w.uiImages.find(r=>r.name===uiSelect.value);img.src=row.path;imgLink.href=row.path}uiSelect.addEventListener('change',uiShot);uiShot();box.append(uiLabel,uiSelect,fig);
  box.append(el('h3','Engineering verification and the business question still open'),el('p','Final 21 suites / 840 tests pass, full-project typecheck and scoped 23-file lint. Focused core63, wrapper23, lifecycle291 and public-fence38 checks overlap840; do not add them. UI27 static browser cases are a separate rendering denominator. Real BSON/production parsers execute with scripted reviewer findings and mocked storage boundaries, not a real Mongo commit or live provider.'),
   el('p','The retained 21/22 red → 22/22 green BSON wrapper checkpoint exposed a prototype-only replay refusal; bounded plain-data reconstruction fixes the mechanical join. The final 23rd wrapper check pins original-template quotation guidance. Earlier compiler, lifecycle, browser-locator, source-copy and oversize failures remain linked. None establishes improved model semantics.','caption'),
   el('p','The original business question remains open: will the reviewer now avoid unsupported exclusions without rejecting valid alternatives, while keeping real false clauses, numerical controls, teacher demands and novel tasks? No post-change answer is measured. Original R8 stays one eligible selected review among six reviewed candidates, zero saved/adopted; it is not new generation yield. Multi-file visual coverage, repeated-task quality, consolidation and professor calibration remain separate unfinished work.','notice'));
  for(const[name,pin]of Object.entries(w.evidence)){const p=el('p',undefined,'caption');p.append(link(name,pin));box.append(p)}
  for(const[name,pin]of Object.entries(w.files)){const p=el('p',undefined,'caption');p.append(link(name,pin));box.append(p)}
  const p=el('p',undefined,'caption');p.append(link('All 55 preceding payload/565 PNG baseline identities',w.baseline));box.append(p,details('Final verification, source freeze and explicit limits',pretty(w.finalVerification.receipt)));
  document.querySelector('main > footer').before(box);const nav=el('a','17 · Exclusion warrants');nav.href='#answer-exclusion-warrants';document.querySelector('nav[aria-label="Book chapters"]').append(nav);
 }
}
// ANSWER_EXCLUSION_WARRANTS_BOOK_END
// OUTLINE_RUNTIME_CONTINUATION_BOOK_START
{
 const w=D.outlineRuntimeContinuation;
 if(w){
  const box=el('section',undefined,'chapter');box.id='outline-runtime-continuation';
  const link=(label,pin)=>{const a=el('a',label);a.href='../../'+pin.path;return a};
  const sub=(id,title)=>{const h=el('h3',title);h.id='runtime-'+id;box.append(h);return h};
  const evidence=(name)=>w.evidence[name]?.receipt;
  box.append(el('div','18 / CONSOLIDATION REVIEW · LOCAL PREPARATORY ENGINE','chapter-number'),
   el('h2','Prepare a full fresh review before a consolidation can count'),
   el('p','This work is in the local working tree; no commit, push or deployment is included.','caption'),
   el('p','Consolidation is not activated. There is no durable consolidation child, checkpoint, worker, HTTP route, Apply or Instructor UI flow. A new pure review engine and lower-bound helper are preparation for that work. The copied ordinary-Apply patch is also not integrated. No paid consolidation review, saved outline, semantic consolidation improvement or professor acceptance is established. The separately authorized R9 authoring probe is disclosed below.','notice'),
   el('p','All 56 predecessor payload values and 653 prior PNGs remain preserved. Earlier checkpoints describe their original code and evidence; they are not rewritten as fresh outcomes. The actual R8 answerability misses, zero saved/adopted questions and unfinished multi-file coverage remain visible in the preceding chapters.'),
   el('p',w.display.verificationSummary));
  if(w.r9?.phaseStatus==='terminal'){
   const latest=el('p','Latest paid R9 result: P02 and CAPM are model-labelled eligible (2/5); zero saved/adopted. Source-based AI review diagnoses P01/P04 exclusion false passes even though other gates withhold them. Consolidation itself remains unreviewed and unwired. ','notice');const jump=el('a','Read the complete R9 observations and exact I/O');jump.href='#runtime-r9';latest.append(jump);box.append(latest);
  }
  sub('business','Which original business problem does this address?');
  box.append(evidenceTable('Business problems and the actual scope of this phase',['Pain','New local preparation','Still unproven or unfinished'],[
   ['Repeated objectives within one topic','Explicitly select 2–4 supported stable LO IDs, propose fewer or narrower survivors and retain predecessor/credit lineage.','Whether a model proposes useful, nonredundant teaching capabilities; no real consolidation has been accepted or applied.'],
   ['Unsupported material or lost source coverage','Every child LO receives fresh original-source and capability review; every old credited point remains an explicit successor obligation.','Valid source references do not establish entailment. Visual/qualifier interpretation, 379 unmapped extracted points and teacher-calibrated coverage remain open.'],
   ['Speed and token cost','An optimistic impossibility floor can refuse before expensive full planning; exact grouping still uses full native inputs and existing caps.','The retained fixed141 plan is unaffordable under the recorded terminal remainder. Pure CPU timing is not provider latency or billing.'],
   ['Too many mechanical review failures','The engine replays exact raw scripted findings and preserves failed terminal diagnostics. A separate real-worker harness isolates one ordinary-Apply false refusal.','The copied Apply correction is not active; no new paid semantic recovery or saved-yield result exists.'],
  ]));
  sub('contract','Explicit IDs, full originals and complete fresh review');
  box.append(el('p','The local engine reconstructs the canonical plan and draft from the whole parent context and exact source findings. Stable survivor IDs keep their source coordinates; retirements and predecessor-to-successor lineage are explicit. Old credits must survive within each previous owner’s assigned successors, including unchanged LOs outside the selected group.'),
   el('p','All child objectives are reviewed afresh. Parent source rows and earlier capability observations are not reused as approval. Candidate learning-point definitions, complete own originals, full nominated-peer LO wording and original source rows remain bound. Batches carry explicit IDs; corrected attempts and raw logical history replay against exactly those prompts and bindings.'),
   el('p','Final local projection checks whole-child admission and all selected-lineage plus unchanged-parent credit obligations before rebuilding stable Topic/LO order. A local complete result is still not durable history authentication, permission to spend, a child checkpoint or Apply authority. Missing source support, a held successor, lost credit or malformed raw history cannot be repaired by inventing a positive receipt.','checks'));
  if(w.display.engineRows)box.append(evidenceTable('Local contract controls; scripted findings, not new model outcomes',['Control','Observed mechanical behavior','Limit'],w.display.engineRows));
  for(const name of ['Final local engineering verification','Fresh review engine source and controlled tests'])if(w.evidence[name])box.append(link(name,w.evidence[name]));
  sub('budget','An optimistic lower bound versus the exact fixed-child plan');
  box.append(el('p','The actual retained context contains142 objectives and594 complete original identities. The current renderer emits each source as the exact public JSON row {id,material,chunkIndex,text}. Those594 individual rows total501,642 UTF-8 bytes; private source records total547,815 and are excluded from the model-bound floor. Equal text under different aliases remains separate. Native escaping, instructions, candidates, peers, separators and correction attempts are all omitted from this optimistic bound.'),
   evidenceTable('These are different measurements, not alternative saved-yield results',['Case','Child targets','Minimum / actual sends','Additional conservative units','Interpretation'],[
    ['Unknown supported2-ID selection; optimistically2→1','141','at least36','717,642','Lower bound only'],
    ['Unknown supported3-ID selection; optimistically3→1','140','at least35','711,642','Lower bound only'],
    ['Unknown supported4-ID selection; optimistically4→1','139','at least35','711,642','Lower bound only'],
    ['Retained fixed3→2 draft','141','at least36','717,642','Lower bound after exact draft validation'],
    ['Exact local fresh-review plan for that fixed draft','141','40 actual planned groups','1,912,402','1,672,402 native input +240,000 reserved output; no calls'],
    ['Earlier142-target original proposal plan','142','40 planned groups','1,908,131','Different proposal/cohort, preserved in chapter14'],
   ]),
   el('p','With at most4 candidate targets per send and6,000 output units reserved per send, any complete fresh child review must contain each full source identity at least once. Serialized source objects occupy disjoint array elements; the actual native estimator cannot be smaller than raw UTF-8. Thus sum public rows once plus ceil(targets/4)×6,000. The helper derives rows from the actual renderer and refuses key, alias, material, coordinate, text or coalescing drift. This is a current-protocol lower bound, not an information-theoretic bound for arbitrary future compression or authenticated review reuse.'),
   el('p','Even711,642 exceeds the recorded terminal unit remainder545,827. The exact fixed141 plan is much larger. A lower-bound result can only say cannot-fit or not-ruled-out; the latter never means fits, execution allowed or source/credit approval. The complete full-context diagnostic prompt is intentionally not an admissible send. The new helper is not connected to an application service.','notice'));
  const floorControls=el('div',undefined,'controls'),floorLabel=el('label','Inspect exact local floor output'),floorSelect=el('select');floorSelect.id='runtime-floor-select';
  for(const [key,row]of Object.entries(w.floorResults||{})){const o=el('option',row.label);o.value=key;floorSelect.append(o)}floorLabel.append(floorSelect);floorControls.append(floorLabel);box.append(floorControls);
  const floorPanel=el('div');floorPanel.id='runtime-floor-panel';box.append(floorPanel);
  const showFloor=()=>{const selected=w.floorResults?.[floorSelect.value];floorPanel.replaceChildren();if(selected){floorPanel.append(details('Exact pure helper result; no permission to dispatch',pretty(selected.receipt)),link('Open the complete pinned output',selected),el('p','No new source/model judgment, child, provider call or ledger write occurred.','caption'))}};
  floorSelect.addEventListener('change',showFloor);showFloor();
  sub('ceilings','Retained ceilings disagree: preserve and refuse');
  box.append(evidenceTable('Recorded accounting is not human API authorization',['Record','Cumulative send ceiling','Recorded used','Arithmetic remainder','Authority'],[
   ['Durable progress / shared phase ledger / prepared checkpoint / continuation declaration','100','31','69','Historical recorded bound; no new approval'],
   ['Terminal diagnostic/result receipt and continuationBaseBudget','256','31','225','Inconsistent diagnostic arithmetic; not an executable allowance'],
   ['Token accounting in both records','2,000,000 units','1,454,173 units','545,827 units','Same historical unit remainder; no reset'],
  ]),
   el('p','The exact retained256 diagnostic supplied with the expected durable/prepared100 limits refuses before planning with inherited-limits. Neither receipt is silently normalized. The original retained parent is imported legacy source-review data, has no explicit current capability selector, and is independently ineligible for current production consolidation authentication. These raw inputs support a counterfactual arithmetic audit, not a live parent.'),
   el('p','The current continuation producer still accepts matching count/pending/token totals without checking limit equality, then copies prior.limits into its cumulative diagnostic. An extracted-current-function control reproduces the 256-send ceiling in the diagnostic while actual reservation progress stays at 100. It uses injected in-memory boundaries and creates no real child. Current explicit Apply and both new preparation helpers require exact inherited-limit equality and refuse the mismatch. A scoped producer follow-up is recorded; pinned production files were not edited.','checks'),
   el('p','The historical continuation phase is terminal and closed. Neither69 nor225 sends, and neither545,827 units nor an older prefix balance, grants fresh API permission. A future durable service must authenticate the latest parent and applicable phase ledger in its matching-course transaction. A pure helper cannot authenticate a caller that changes both its receipt and expected ceiling.','notice'));
  for(const name of ['Exact retained ceiling/progress/declaration provenance','Current producer: extracted function reproduction','Retained imported-parent authority limits'])if(w.evidence[name]){const p=el('p',undefined,'caption');p.append(link(name,w.evidence[name]));box.append(p)}
  sub('worker','A separate actual-worker false refusal remains unintegrated');
  box.append(el('p','An isolated harness calls the actual fresh worker, parser, finalizer and ordinary completed Apply guard. It uses one exact first-section excerpt from each of ten retained PDFs, scripted model labels, real BSON round trips and mocked collections/transactions. It does not rerun all599 pages or the142-objective semantic review.'),
   evidenceTable('Mechanical ordinary-Apply regression; no new provider output',['Control','Current production guard','Copied patch candidate'],[
    ['Uncorrected10-excerpt fresh worker result','Accepts','Retains acceptance'],
    ['Malformed logical review corrected within the existing attempt allowance','Finalizer finds10 eligible LOs; Apply refuses result-changed','Accepts only the exact raw-history-derived diagnostic suffix'],
    ['Missing, extra, reordered or altered suffix/prefix/metadata','Refuses or remains invalid','Must refuse'],
   ]),
   el('p','The worker appends exact logical-review failures after checkpoint persistence. Ordinary completed Apply recomputes with the frozen pre-review synthesis receipt, so complete stored-result equality can refuse a valid corrected worker result. The copied candidate derives only the exact suffix from already validated raw history, preserves the synthesis prefix and every other result binding, and keeps continuation semantics separate.'),
   el('p','The candidate is an isolated file; no production import uses it. Thirteen focused controls and a virtual candidate typecheck validate mechanics only. The retained test moved into a standalone offline suite because it needs ignored evidence artifacts; its exact former unit-source bytes and failed attempts remain archived. The earlier paid source-only continuation did not execute or prove this fresh-worker failure.','notice'));
  sub('r9','R9 · separately authorized bounded authoring probe');
  box.append(el('p','The file-prepared launcher has 33 local tests and 5 native intercepted initial inputs, with 960 code pins retained. The user subsequently gave explicit authorization for R9’s five retained-context quality reviews only, capped at 10 SDK sends / 10 physical wire posts, 24,000 input units and 2,000 output tokens per send, and 260,000 conservative reservation units. It excludes regeneration, candidate repair, fresh Bank retrieval, role/content calls, database work and saving/adoption. R8’s authorization remains completed and closed.','caption'));
  if(w.r9?.phaseStatus==='terminal'||w.r9?.phaseStatus==='terminal-awaiting-independent-audit'){
   box.append(el('p',w.r9.summary,'notice'));
   if(w.r9.outcomeRows)box.append(evidenceTable('Exact bounded R9 observations; no full generation-batch or teacher-acceptance claim',['Case','R8 → R9 final quality label','Independent source-based diagnosis'],w.r9.outcomeRows));
   if(w.r9.usageRows)box.append(evidenceTable('R9 recorded usage and bounded work',['Measure','Recorded value','Scope'],w.r9.usageRows));
   box.append(el('p','These are actual quality-review observations on retained contexts, not new generated questions, saved yield, teacher acceptance or evidence that consolidation works. Historical R8 prompts/responses remain unchanged and separately inspectable. Missing/invalid schema, ambiguity judgments, genuine demand mismatches and any transport failure retain separate denominators.','checks'));
   box.append(el('p','Schema correction can change a semantic judgment. P02’s first raw R9 response says duplicate; after the same-candidate required Bank-comparator correction, its raw novelty becomes independent and the final review is eligible. Calling this only a format repair would hide the change. A valid structured response is not proof of semantic stability.','notice'));
   box.append(el('p','Independent interpretation is a post-output source-based AI diagnostic, not professor labels or a blinded accuracy study. P03 is judged only against its own p89/p90/p48 passages and its numeric witness: Total Beta =1.20/0.60=2, then3+2×6=15%. Its p90 worked example uses2.75+1.6783×(5.5%)=11.98%. The clearer p108 percentage example belongs only to CAPM’s packet and supplies no P03 admission evidence. Candidate-declared Medium, fixed requested Easy and R9 model-achieved Easy remain three separate fields; that difficulty judgment is uncalibrated.','checks'));
   box.append(el('p','The full six-context R8 run includes T/F, which is absent here. Within these same five MCQ contexts, R8 labelled1/5 eligible and R9 labelled2/5. This is not a saved-yield, cost-savings or latency comparison, and three changed selectors prevent causal attribution. Mitigate/eliminate strength, nonexclusive table placement, planned OR versus required AND, and source-grounded unit equivalence are next reasoning targets.','notice'));
   if(w.r9.sourceAnchors)box.append(details('Exact own-source anchors and boundaries; not teacher entailment labels',pretty(w.r9.sourceAnchors.receipt)));


  }else{
   box.append(el('p','Human authorization is received; root is conducting the bounded R9 probe. No terminal result is yet available in this staging checkpoint. This chapter does not fabricate outcomes, tokens, model latency or recovered yield.','notice'));
  }
  box.append(el('p','A launcher readiness flag alone is not human permission. The separate exact authorization and terminal ledger must be retained, and neither a historical remainder nor unused phase capacity renews another paid run. This book performs no provider call.','caption'));
  if(w.r9?.sends?.length){
   const ioTitle=el('h4','Inspect every actual R9 attempt');ioTitle.id='runtime-r9-io';box.append(ioTitle,
    el('p','These are actual terminal R9 inputs and visible outputs. Frozen context means the candidate, originals, Bank memory and teacher requirements are inspectable; it does not mean the R8 and R9 prompts or selectors are identical. Three selectors changed together, so any changed judgment cannot be attributed to one change. No private model reasoning is requested or displayed.','caption'));
   const controls=el('div',undefined,'controls'),label=el('label','Actual SDK send'),select=el('select');select.id='runtime-r9-send-select';
   for(const row of w.r9.sends){const option=el('option','Send '+row.sdkId+' · '+row.caseId);option.value=String(row.sdkId);select.append(option)}label.append(select);controls.append(label);box.append(controls);
   const panel=el('div');panel.id='runtime-r9-io-panel';box.append(panel);
   const show=()=>{const row=w.r9.sends.find(item=>String(item.sdkId)===select.value);panel.replaceChildren();if(!row)return;
    const context=w.r9.contexts?.cases?.find(item=>item.id===row.caseId);
    panel.append(el('h4','Actual R9 send '+row.sdkId+' · '+row.caseId),el('p','Input estimate '+row.inputUnits+' units; reserved '+row.reserved+' units; reported input/output '+row.inputTokens+' / '+row.outputTokens+' tokens. These are separate accounting quantities.','caption'));
    if(context)panel.append(details('Exact retained candidate, source, Bank and requirements for '+row.caseId,pretty(context)));
    panel.append(details('Exact actual R9 prompt',row.prompt.text),details('Exact actual R9 visible response content',row.responseContent.text),details('Exact physical request JSON',pretty(row.request.receipt)),details('Exact provider response JSON and usage',pretty(row.response.receipt)));
    for(const[key,pin]of [['Complete exact prompt',row.prompt],['Complete exact visible response content',row.responseContent],['Complete exact physical request JSON',row.request],['Complete exact provider response JSON',row.response]]){const p=el('p',undefined,'caption');p.append(link(key,pin));panel.append(p)}
   };select.addEventListener('change',show);show();
  }

  sub('io','Exact inputs, local outputs, source and failed attempts');
  box.append(el('p','These links retain original contexts, full source catalogs, proposed lineage, the fixed unreviewed draft, actual local40-group plan, raw scripted histories, code copies, refusal receipts and earlier failures. Local scripted responses are separate from unchanged historical paid responses. Inspect linked complete files; a short display is not source clipping in the actual review packet.'));
  for(const[name,pin]of Object.entries(w.evidence||{})){const p=el('p',undefined,'caption');p.append(link(name,pin));box.append(p)}
  for(const[name,pin]of Object.entries(w.files||{})){const p=el('p',undefined,'caption');p.append(link(name,pin));box.append(p)}
  if(w.finalVerification)box.append(details('Final source freeze, local test scope and explicit limitations',pretty(w.finalVerification.receipt)));
  sub('remaining','The next step is durable integration and calibrated acceptance');
  box.append(el('p','Remaining engineering: authenticate an eligible current parent and exact terminal ledger; persist an immutable selected-ID child/proposal; reserve every native/correction attempt against that ledger; recover raw history and failure diagnostics durably; and revalidate stable final output inside course-fenced Apply before exposing an Instructor flow. The isolated ordinary-Apply correction needs its own integration decision.'),
   el('p','Remaining business proof: demonstrate useful source-supported consolidation without deleting distinct teaching capabilities; test ambiguity/exclusion and numerical-review improvements with separately authorized paid controls; measure valid saved supply, review time and multi-file conceptual/visual coverage with professor review. More local gate tests do not answer these semantic questions.','notice'));
  document.querySelector('main > footer').before(box);const nav=el('a','18 · Consolidation review preparation');nav.href='#outline-runtime-continuation';document.querySelector('nav[aria-label="Book chapters"]').append(nav);
 }
}
// OUTLINE_RUNTIME_CONTINUATION_BOOK_END

// REVIEW_DECISION_INTEGRITY_BOOK_START
{
 const w=D.reviewDecisionIntegrity;
 if(w){
  const box=el('section',undefined,'chapter');box.id='review-decision-integrity';
  const link=(label,pin)=>{const a=el('a',label);a.href='../../'+pin.path;return a;};
  const lazy=(title,value)=>{const d=el('details');d.append(el('summary',title));let loaded=false;d.addEventListener('toggle',()=>{if(d.open&&!loaded){loaded=true;d.append(el('pre',typeof value==='string'?value:pretty(value)));}});return d;};
  const sub=(id,title)=>{const h=el('h3',title);h.id='integrity-'+id;box.append(h);};
  box.append(el('div','19 / REVIEW DECISIONS AND OUTLINE GUARDS','chapter-number'),el('h2','A format repair must preserve the review decision'),
   el('p','P02 changed from duplicate to independent while the model repaired a missing Bank comparator. Its candidate, source, Bank and teacher request did not change. The new guard keeps a valid initial judgment from silently disappearing during that correction; it does not determine which judgment is true.'),
   el('p','Current local checkpoint: 881 tests in 19 suites, full project typecheck and scoped lint pass. Replaying the same seven closed R9 responses changes retained eligibility from 2/5 to 1/5. This lower count is an integrity result, not an improvement in useful question supply. No new API calls, saved questions, adoptions or professor labels.','notice'));
  box.append(evidenceTable('What this chapter establishes',['Evidence','Result','Boundary'],[
   ['Production software regression','881 / 881 tests; 19 suites','Scripted judgments and mocked/denied external systems'],
   ['Same R9 outputs, interpreted locally','P02 withheld; only CAPM eligible (1/5)','No new model response or saved-yield measurement'],
   ['Fresh compact native request sizing','128 / 128 measured paths fit; 52 input units remain at the maximum','Fixed local inputs, not all future source/Bank/request expansions'],
   ['Next model comparison','Five fixed cases × three review configurations','Offline plan only; no executable declaration or API authorization'],
  ]));
  sub('contract','What is frozen, and what may still be repaired');
  box.append(el('p','Fresh opt-in v2 authoring pins frozen-review-decisions-v1. Before the existing one same-candidate schema correction, the server captures bounded valid decisions from raw parsed JSON. The correction may fill malformed fields and fix source locators. It may not silently reverse or remove valid source, notation, novelty, difficulty, length, answer, teacher, comparison, task-demand or missing-premise judgments.'),
   el('p','Full source → original valid decisions → one format correction → exact decision replay → eligible or withheld. Valid negative findings survive a malformed neighboring row. Conflicting duplicate identities remain a conflict, while blank invalid fields remain fillable. The actual MCQ/T/F shape, complete candidate, original evidence and requirements bind the receipt.','checks'),
   el('p','A drift result withholds and cannot drive automatic candidate rewriting. Public save and regeneration adoption recheck the bound receipt and selector inside the course fence. Historical absence, baseline/v1 and exact recorded retries keep their earlier branch. Native JSON retries inside the provider wrapper are outside this parsed-response decision comparison. No source/Bank/numeric/demand/teacher gate or correction cap is waived.'),
   lazy('Complete guarded software contract and final verification',w.finalVerification));
  sub('replay','Same retained outputs: eligibility falls from 2/5 to 1/5');
  box.append(el('p','The actual R9 phase remains seven SDK calls / seven physical POSTs and 39,190 provider-reported tokens, already completed and closed. This new experiment reuses those exact seven visible replies as local completion callbacks in two branches. It executes no completeJson, native adapter or provider. Fourteen local callbacks are not fourteen API calls.','notice'),
   evidenceTable('Five fixed contexts; old replies reused without acquiring new judgments',['Case','Actual R9 / absent-selector replay','New selector replay','Interpretation'],[
    ['P01','Withheld; exclusion facet passed','Withheld; decision drift disclosed','The mitigate-versus-eliminate exclusion remains semantically unresolved.'],
    ['P02','Eligible after duplicate → independent correction','Withheld for changed novelty/teacher/actionable finding','The server now refuses the reversal; neither model label is professor truth.'],
    ['P04','Withheld; exclusion facet passed','Withheld, consistent recorded decisions','Nonexclusive table placement still masquerades as exclusion; Hard/Easy remains separate.'],
    ['CAPM','Eligible','Eligible, consistent recorded decisions','Quality-call control only; not a new full generation/save/teacher acceptance.'],
    ['P03','Withheld on notation','Withheld, consistent recorded decisions','Its percentage-unit false refusal and requested-demand interpretation remain open.'],
   ]),
   el('p','All seven absent-selector prompts reproduce the actual R9 prompt bytes. Only the new reviewRepairProtocol selector is added to the same full contexts for the selected branch. P03 uses only its own p89/p90/p48 packet; CAPM-only p108 is not P03 evidence. Candidate Medium, requested Easy and model-achieved Easy remain distinct recorded fields. This is post-output engineering analysis, not blinded or teacher-labelled accuracy.'),
   el('p','Serialized native JSON body bytes and model admission units are different quantities. All fourteen historical-admission projections fit: the selected branch reaches 21,840 / 24,000 input units, leaving 2,160. Its maximum serialized body is separately 22,870 UTF-8 bytes / 22,804 UTF-16 units. The earlier P02 body-size overflow inference used 24,881 body units incorrectly: its actual historical admission estimate was 23,812 and fitted with 188 remaining. The original mistake and explicit correction remain linked. The actual local native-renderer measurement below is a separate experiment.','checks'));
  const ioControls=el('div',undefined,'controls'),ioLabel=el('label','Retained case'),caseSelect=el('select');caseSelect.id='integrity-case-select';
  for(const id of ['P01','P02','P04','CAPM','P03']){const o=el('option',id);o.value=id;caseSelect.append(o)}ioLabel.append(caseSelect);
  const branchLabel=el('label','Local interpretation branch'),branchSelect=el('select');branchSelect.id='integrity-branch-select';
  for(const[value,label]of [['historical-absent-selector','Absent selector — exact R9 prompts'],['selected-frozen-review','Selected guard — same retained replies']]){const o=el('option',label);o.value=value;branchSelect.append(o)}branchLabel.append(branchSelect);ioControls.append(ioLabel,branchLabel);box.append(ioControls);
  const ioPanel=el('div');ioPanel.id='integrity-io-panel';ioPanel.setAttribute('aria-live','polite');box.append(ioPanel);
  const showIo=()=>{ioPanel.replaceChildren();const row=w.replayCases?.find(row=>row.id===caseSelect.value)?.branches?.[branchSelect.value];
   if(!row){ioPanel.append(el('p','No retained local replay is available for this selection.','empty'));return;}
   ioPanel.append(el('h4',caseSelect.value+' · '+(branchSelect.value==='historical-absent-selector'?'absent selector':'selected guard')),
    el('p','Recorded local status: '+row.assessment.status+'. These are historical raw model replies injected into the current software; no new model result.','caption'),
    lazy('Exact replayed assessment and decision receipt',row.assessment),link('Open complete input context',row.inputs));
   for(const attempt of row.callbacks){const d=el('details');d.append(el('summary','Local callback '+attempt.index+' · inspect exact I/O'),
     el('p','This callback is an offline injection, not a dispatch. Complete retained records are linked; no source or output is shortened.' ,'caption'),
     el('p','Historical admission projection: '+fmt(attempt.receipt.historicalAdmissionInputUnits)+' / '+fmt(attempt.receipt.declaredInputLimit)+' input units. Serialized body: '+fmt(attempt.receipt.projectedBodyUtf8Bytes)+' UTF-8 bytes / '+fmt(attempt.receipt.projectedBodyUtf16Units)+' UTF-16 units. Admission was not executed.','caption'),
     lazy('Exact replay prompt',attempt.promptText),link('Open complete prompt text',attempt.receipt.prompt),
     lazy('Exact retained visible model response',attempt.responseText),link('Open complete retained response text',attempt.receipt.originalRawResponse),
     lazy('Exact local input and retained output record',attempt.receipt),link('Open complete callback JSON',attempt));ioPanel.append(d);}
  };caseSelect.addEventListener('change',showIo);branchSelect.addEventListener('change',showIo);showIo();
  for(const[name,pin]of Object.entries(w.replayEvidence||{})){const p=el('p',undefined,'caption');p.append(link(name,pin));box.append(p)}
  sub('headroom','Speed and token cost: preserve inputs and keep the cap');
  box.append(evidenceTable('Local native shaping: 512 intercepted envelopes across four cohorts',['Cohort','Measured paths','Input refusals','Maximum input units'],[
   ['Historical-style absent','128','4','24,780 / 24,000'],['Historical-style selected','128','11','25,109 / 24,000'],
   ['Fresh compact absent','128','0','23,906 / 24,000'],['Fresh compact selected','128','0','23,948 / 24,000'],
  ]),
   el('p','Earlier fresh compact selected trials refused 16/128, then 4/128, then 2/128 paths. They remain recorded. The final measured cohort fits 128/128, including streaming and nested JSON corrections, with only 52 conservative input units at its tightest point. This is narrow headroom, not a general fit guarantee or provider billing-token measurement.'),
   el('p','Only repeated owned instructions, error metadata and model-facing judgment projections were compacted. Full originals, Bank, candidate and teacher payloads, ordered private decision vectors and existing caps remain intact. No new model stage, embedding, automatic semantic re-review or hidden budget refill was added. Source expansion can still exceed a cap and must stop explicitly.'),
   lazy('Exact measured native cohorts and preserved overflow history',w.headroom));
  sub('outlines','Two outline guard fixes are now in production code');
  box.append(evidenceTable('Mechanical outline work; focused counts overlap the combined 881',['Fix','Verification','Still separate'],[
   ['Completed corrected-worker Apply','70 focused tests; actual generator/driver/finalizer + BSON + mocked transaction','No full 599-page semantic rerun or real Mongo commit'],
   ['Inherited continuation ceilings','188 tests / four suites; all four immutable limit fields, both directions','No new allowance; retained 256 versus 100 discrepancy is refused'],
   ['Suspected spent-child restart count gap','Caller/state proof: second invocation is not supported today','Future same-child resumability must replay prior work; no speculative patch'],
  ]),
   el('p','Fresh ordinary Apply now derives only the exact post-checkpoint logical-review correction suffix from validated raw history. It preserves the frozen synthesis prefix and compares the complete rebuilt result, source, peers and budget before writes. Missing, extra, reordered or tampered records still refuse; continuation keeps its frozen receipt.'),
   el('p','Continuation creation, existing-child recovery and dispatch compare maxSends, maxInputTokens, maxOutputTokens and maxEstimatedTokens to the immutable checkpoint. Smaller native caps are preserved; an output allowance below the required 6000 refuses. The suspected second-process counter example cannot occur through the queued-only worker claim and legal state transitions. Finding the same existing child does not restart it.'),
   el('p','This chapter supersedes chapter 18’s then-current statements that the ordinary Apply patch and producer limit guard were not integrated. Chapter 18 and all 57 historical non-time payload values remain unchanged. The durable consolidation child/worker/HTTP/Apply/UI flow is still unfinished; these guard fixes do not activate it.','notice'));
  for(const[name,pin]of Object.entries(w.outlineEvidence||{})){const p=el('p',undefined,'caption');p.append(link(name,pin));box.append(p)}
  sub('calibration','Next: calibrate the judge before ranking generators');
  box.append(el('p','Offline proposal only. No executable matrix launcher, fresh human approval, model calls or results exist for this plan. R9’s remaining capacity is closed. A reviewed new launcher, current native envelopes, both dispatch counters and a fresh bounded authorization are required before any acquisition.','notice'),
   evidenceTable('Proposed reviewer configurations; not measured model performance',['Arm','Reasoning','Native temperature','Common experimental output cap'],[
    ['gpt-6-luna','none','0','6000'],['gpt-6-luna','medium','omitted','6000'],['gpt-6.1-sol','medium','omitted','6000'],
   ]),
   el('p','Stage A: five unchanged cases × three configurations = 15 planned cells. Proposed ceilings: 20 SDK sends AND 20 physical POSTs, 24,000 input units per attempt, 6000 completion tokens, 600,000 total reserved units, serial acquisition and no SDK retries. JSON/schema corrections all count; the theoretical 60-send worst case does not fit, so stop partial and retain all 15 denominators. Sol 6.1 none is unsupported and must make zero dispatches.'),
   el('p','The common 6000 cap includes reasoning plus visible output. It differs from production Luna-none quality 2000 and cannot measure production-none cost or latency. Medium arms omit temperature as capabilities require, so this is a configuration comparison, not a literally one-wire-field intervention. Judge exact facets: P01 claim strength/OR-versus-AND; P04 nonexclusive actor/table applicability; P02 explicit false clauses versus true partials; CAPM taught derivation; P03 own-source unit equivalence. Overall withholding by an unrelated gate is not successful ambiguity detection.'),
   el('p','If no judge avoids these false exclusions and blanket refusals, stop before generator rankings. Disputed source/difficulty labels require professor adjudication; model agreement is not truth. Only afterward, separately freeze four generation tasks × the same three configurations, one fixed blinded judge, 12 initial candidates and 12 reviews. Proposed 30 attempts / 960,000 units remain a separate unauthorised plan; no cross-arm candidate memory and no initial semantic repair.'),
   lazy('Complete offline calibration proposal, exclusions and prerequisites',w.calibration));
  sub('limits','What still does not work');
  box.append(el('p','The guard detects changed decisions; it does not fix a consistently wrong review. P01/P04 still need valid source entailment and unique-answer reasoning. P03’s percentage-notation refusal, requested task difficulty and source-capacity interpretation need calibration. Multiple-chapter pedagogical and visual coverage, nonredundant supported consolidation, valid saved supply and professor review time are not established. More passing software tests do not resolve these semantic questions.','notice'));
  for(const[name,pin]of Object.entries(w.evidence||{})){const p=el('p',undefined,'caption');p.append(link(name,pin));box.append(p)}
  document.querySelector('main > footer').before(box);const nav=el('a','19 · Review decision integrity');nav.href='#review-decision-integrity';document.querySelector('nav[aria-label="Book chapters"]').append(nav);
  const latest=el('p',undefined,'notice');latest.append(el('strong','Latest local checkpoint: '),document.createTextNode('review-correction integrity and outline guard fixes; semantic quality remains unresolved. '));const jump=el('a','Read chapter 19 and the exact offline evidence');jump.href='#review-decision-integrity';latest.append(jump);document.getElementById('overview').append(latest);
 }
}
// REVIEW_DECISION_INTEGRITY_BOOK_END

// REVIEW_CALIBRATION_PREPARATION_BOOK_START
{
 const w=D.reviewCalibrationPreparation;
 if(w){
  const box=el('section',undefined,'chapter');box.id='review-calibration-preparation';
  box.append(el('div','20 / LOCAL FLOW AND CONTROLLED CALIBRATION','chapter-number'),el('h2','Inspect the next comparison before it spends'),
   el('p','Local engineering evidence. R9 is closed; these prepared requests contain no new provider output. Model accuracy, saved supply, professor acceptance and ten-chapter pedagogical coverage remain unproven.','notice'));
  const mcLink=(label,pin)=>{const a=el('a',label);a.href='../../'+pin.path;return a};
  const mcDetails=(label,value)=>details(label,pretty(value));
  const mcTable=(label,headers,rows)=>{const region=el('div',undefined,'table-region');region.setAttribute('role','region');region.setAttribute('aria-label',label);region.tabIndex=0;const table=el('table');const head=el('thead'),tr=el('tr');for(const name of headers){const th=el('th',name);th.scope='col';tr.append(th)}head.append(tr);table.append(head);const body=el('tbody');for(const row of rows){const r=el('tr');for(const value of row)r.append(el('td',String(value)));body.append(r)}table.append(body);region.append(table);return region};
  const sub=(id,title)=>{const h=el('h3',title);h.id='calibration-'+id;box.append(h)};
  sub('configuration','Five unchanged cases, three explicit configurations');
  box.append(mcTable('Prepared reviewer configurations',['Arm','Effort','Temperature','Production quality cap','Experimental cap'],[
   ['Luna6','none','0','2000','6000'],['Luna6','medium','omitted','6000','6000'],['Sol6.1','medium','omitted','6000','6000']]),
   el('p','The candidate, complete fixed source packet, Bank memory and teacher requirements are unchanged within each case. Initial prompt bytes match across all three arms. Earlier AI verdicts and transcript paths are excluded. Corrections depend on each arm’s own reply. The common 6000 cap includes reasoning plus visible JSON and changes the production Luna-none envelope.'),
   mcTable('Local request sizing',['Planned cells','Local native envelopes','Observed fit','Largest input estimate','New provider calls'],[[w.preparation.plannedCells,w.preparation.interceptedNativeEnvelopes,w.preparation.admitted+'/'+w.preparation.interceptedNativeEnvelopes,w.preparation.maximumAdmissionInputUnits+' / 24000',0]]),
   el('p','The renderer exercised the real quality assessor, JSON helper, model capability shaping and native adapter behind denied external boundaries. Historical/scripted response shapes are sizing controls, not fresh judgments. Future reply-dependent correction prompts may still overflow and must refuse. The raw UTF-8 admission estimate is separate from serialized request-body bytes.'),
   mcDetails('Exact preparation summary and boundary counters',w.preparation));
  sub('limits','One shared proposed allowance; no refill');
  box.append(el('p','Proposed ceiling: 20 SDK sends AND 20 physical POSTs, 600,000 conservative reservation units, 24,000 input units and 6000 completion tokens per send, serial acquisition, 180-second deadline and SDK retries disabled. Native JSON retries and logical corrections all consume the same limits. All 15 planned cells remain in the denominator, including cells that never start.'),
   el('p','Known, durably recorded JSON-format exhaustion can end only that cell. Unknown usage, transport uncertainty, identity mismatch, a guard fault or journal failure stops the entire phase with reservations retained. R9 authority does not carry forward.'),mcDetails('Admission arithmetic; estimates are not reported tokens or prices',w.admission));
  sub('native-io','Exact prepared native input');
  const controls=el('div',undefined,'controls'),caseLabel=el('label','Case'),armLabel=el('label','Configuration'),stageLabel=el('label','Request shape');
  const caseSelect=el('select'),armSelect=el('select'),stageSelect=el('select');caseSelect.id='calibration-case-select';armSelect.id='calibration-arm-select';stageSelect.id='calibration-stage-select';
  for(const id of ['P01','P02','P04','CAPM','P03']){const option=el('option',id);option.value=id;caseSelect.append(option)}
  for(const id of ['luna-none','luna-medium','sol-medium']){const option=el('option',id);option.value=id;armSelect.append(option)}
  caseLabel.append(caseSelect);armLabel.append(armSelect);stageLabel.append(stageSelect);controls.append(caseLabel,armLabel,stageLabel);
  const status=el('p',undefined,'caption');status.setAttribute('aria-live','polite');const pane=el('div');
  function showNative(){pane.replaceChildren();const row=w.native.find(value=>value.key===stageSelect.value);if(!row){status.textContent='No local request for this selection.';return}
   status.textContent=row.cellId+' · '+row.kind+' · native JSON attempt '+row.jsonAttempt+' · LOCAL SCRIPTED INTERCEPT ONLY';
   pane.append(mcTable('Selected local request admission',['Input estimate','Input headroom','Body UTF-8 bytes','Production / experimental cap'],[[row.nativeInputUnits,row.inputHeadroom,row.nativeBodyUtf8Bytes,row.productionRequestedOutputCap+' / '+row.experimentalOutputCap]]),
    mcDetails('Full native request JSON; source/Bank/candidate text retained',row.nativeRequest),
    el('p','New provider output: none. The local intercept returned deliberately scripted JSON for envelope inspection; this is not a question-generation or model-quality result.','notice'));
   const p=el('p',undefined,'caption');p.append(mcLink('Exact request file',row.native),document.createTextNode(' · '),mcLink('Exact assessor prompt file',row.prompt));pane.append(p);
  }
  function chooseNative(){stageSelect.replaceChildren();for(const row of w.native.filter(value=>value.caseId===caseSelect.value&&value.armId===armSelect.value)){const option=el('option',row.kind+' · JSON attempt '+row.jsonAttempt);option.value=row.key;stageSelect.append(option)}showNative()}
  caseSelect.addEventListener('change',chooseNative);armSelect.addEventListener('change',chooseNative);stageSelect.addEventListener('change',showNative);box.append(controls,status,pane);chooseNative();
  sub('consolidation','Automatic proposal, teacher preview, complete fresh review');
  box.append(el('p',w.outline.summary),mcDetails('Current local implementation and verification',w.outline),
   el('p','The retained 142-LO historical parent remains ineligible and cannot receive a reset allowance. Consolidation after a completed review cannot make that earlier workload cheap. Automatic consolidation before the initial full review remains a separate implementation gap; this chapter does not claim that ten-chapter source coverage or LO quality is solved.','notice'));
  sub('facets','Read each disputed judgment separately');
  box.append(mcTable('Predeclared diagnostic facets',['Case','Specific issue to inspect'],[
   ['P01','Mitigation versus elimination; alternatives are not a mandatory conjunction.'],['P02','An explicit false averaging denial is not a merely incomplete true answer.'],['P04','Table placement is not exclusivity; requested Hard and candidate Easy remain separate.'],['CAPM','Taught formula and computed samples; wrong distractor arithmetic need not be taught true.'],['P03','Use only its own source packet for percentage notation; requested Easy and candidate Medium remain separate.']]),
   el('p','Initial, corrected and guarded assessments are retained separately. Decision drift excludes whole-cell pairing even when final JSON parses. Professor labels remain null unless independently recorded. No count, model agreement or scripted test automatically selects a winning reviewer or authorizes a generator experiment.'),mcDetails('Verification and execution readiness',w.verification));
  for(const[name,pin]of Object.entries(w.evidence||{})){const p=el('p',undefined,'caption');p.append(mcLink(name,pin));box.append(p)}
  document.querySelector('main > footer').before(box);const nav=el('a','20 · Controlled calibration');nav.href='#review-calibration-preparation';document.querySelector('nav[aria-label="Book chapters"]').append(nav);
 }
}
// REVIEW_CALIBRATION_PREPARATION_BOOK_END


for(const [label,pin] of [['Model recovery',recovery.codeSnapshot],['Stopped public acceptance',currentPublic.codeSnapshot]]){if(!pin)continue;const box=el('div');box.append(el('h3',label+' — exact historical code preserved'),el('p',fmt(pin.receipt.files.length)+' source files were preserved in separate copies after terminal completion and verified against their prospective pre-send hashes. Later additive edits were reversed only in those copies where required. Original declarations/results were not rewritten and no archived source was executed.'),details('Exact manifest, preservation method and every verified code hash',pretty(pin)));const a=el('a','Open the historical source manifest');a.href='../../'+pin.path;box.append(a);document.getElementById('phase-two-verification').append(box);}
const caseSelect=document.getElementById('case-select'),cellSelect=document.getElementById('cell-select');
function showCell(){const c=cells.find(v=>v.schedule.id===cellSelect.value);if(!c)return;put('cell-status',c.schedule.arm.model+' · '+c.schedule.arm.effort+' · '+c.status+' · initial eligibility: '+(c.eligibleBeforeRepair===null?'not assessed':String(c.eligibleBeforeRepair))+' · saved: false · adopted: false');const cand=document.getElementById('candidate');cand.replaceChildren();const q=c.normalizedCandidate||c.originalCandidate;if(q){cand.append(el('h3','Generated candidate'),el('div',q.stem,'question'));for(const o of q.options||[]){const row=el('div',o.key+' · '+o.text,'option');row.append(el('small','Proposed role: '+o.role+' · '+o.explanation));cand.append(row)}cand.append(details('Original generator JSON and normalization',pretty({original:c.originalCandidate,normalized:c.normalizedCandidate,deterministic:c.deterministic})));}else cand.append(el('p','No parsed candidate. Inspect retained raw output below.','empty'));const assessed=document.getElementById('cell-assessment');assessed.replaceChildren();const admission=D.admission?.rows.find(r=>r.cellId===c.schedule.id);if(admission)assessed.append(details('Deterministic production gates and unavailable checks',pretty(admission)));if(c.qualityBeforeRepair)assessed.append(details('Source / notation / task assessment',pretty(c.qualityBeforeRepair)));if(c.repaired)assessed.append(details('Repair: exact before / after',pretty(c.repaired)));if(c.error)assessed.append(el('p','Recorded error: '+c.error.message,'notice'));const ts=document.getElementById('transcripts');ts.replaceChildren();for(const cap of c.captures||[]){const t=cap.transcript;if(!t)continue;const h=el('h3',t.stage+' · '+t.status);ts.append(h);for(const a of t.attempts||[]){const d=el('details');d.append(el('summary','Attempt '+(a.number+1)+' · '+a.dispatch+' · '+a.inputSha256.slice(0,12)));d.append(el('p','Exact request options'),el('pre',pretty(a.input.options)),el('p','Exact visible input'),el('pre',a.input.prompt),el('p','Raw visible output before parsing'),el('pre',a.rawVisibleText||'(empty visible output)'),details('Provider usage / identity events',pretty(a.events)));ts.append(d)}}}
function selectCase(){cellSelect.replaceChildren();for(const c of cells.filter(v=>v.schedule.caseId===caseSelect.value)){const o=el('option',c.schedule.arm.id+' · r'+c.schedule.repetition);o.value=c.schedule.id;cellSelect.append(o)}showCell()}
if(cells.length){caseSelect.replaceChildren();for(const id of [...new Set(cells.map(c=>c.schedule.caseId))]){const o=el('option',id);o.value=id;caseSelect.append(o)}selectCase();caseSelect.addEventListener('change',selectCase);cellSelect.addEventListener('change',showCell)}
for(const a of document.querySelectorAll('.sidebar nav a'))a.addEventListener('click',()=>{for(const other of document.querySelectorAll('.sidebar nav a'))other.removeAttribute('aria-current');a.setAttribute('aria-current','location')});
</script></body></html>'''


if __name__ == '__main__':
    build()
