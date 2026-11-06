import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildReviewCalibrationReport, REVIEW_CALIBRATION_ARMS, REVIEW_CALIBRATION_SCHEDULE, runReviewCalibrationReportCli,
  type ReviewCalibrationReportInput } from '../../scripts/quality-lab/review-calibration-report';

const hash = 'a'.repeat(64);
const evidence = [{ path: 'synthetic/local-input.json', sha256: hash, bytes: 12 }];
const bindings = { candidate: hash, packet: hash, memory: hash, requirements: hash, context: hash };
type Cell = ReviewCalibrationReportInput['run']['cells'][number];
function review() {
  return { sourceSupport: 'supported', notation: 'consistent', novelty: 'independent', citations: [{ spanIds: ['S1'] }], missingPremises: [],
    taskComparisons: [], answerability: { kind: 'mcq', options: [{ key: 'A', verdict: 'undetermined' }] },
    taskDemand: { status: 'uncertain' }, achievedDifficulty: 'easy', changes: [], invariants: [], justifiedLength: 'justified', findings: [] };
}
function cell(index: number, sdkId: number): Cell {
  const planned = REVIEW_CALIBRATION_SCHEDULE[index], arm = REVIEW_CALIBRATION_ARMS.find(row => row.id === planned.armId)!;
  const prompt = `Full unchanged synthetic context for ${planned.caseId}`;
  const inputUnits = Buffer.byteLength(prompt) + 32;
  const raw = review();
  return { ...planned, cellId: planned.id, inputDifficulty: { requested: planned.caseId === 'P04' ? 'hard' : 'easy', candidate: planned.caseId === 'P03' ? 'medium' : 'easy', evidence }, state: 'reviewed', formatStatus: 'validated', inputBindings: { ...bindings },
    quality: { ...raw, status: 'withheld', requestedDifficulty: planned.caseId === 'P04' ? 'hard' : 'easy', candidate: { difficulty: planned.caseId === 'P03' ? 'medium' : 'easy' },
      reviewRepair: { status: 'consistent' } },
    logicalReviews: [{ logicalAttempt: 0, prompt, productionRequestedOutputCap: arm.reasoningEffort === 'none' ? 2000 : 6000,
      experimentalNativeOutputCap: 6000, state: 'parsed', parsed: raw, rawText: JSON.stringify(raw), sdkIds: [sdkId], evidence }],
    attempts: [{ sdkId, logicalAttempt: 0, jsonAttempt: 0, prompt, productionRequestedOutputCap: arm.reasoningEffort === 'none' ? 2000 : 6000,
      experimentalNativeOutputCap: 6000, nativeRequest: { model: arm.model, reasoning_effort: arm.reasoningEffort,
        ...(arm.nativeTemperature === 'omitted' ? {} : { temperature: arm.nativeTemperature }), max_completion_tokens: 6000, stream: false,
        response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] },
      inputUnits, reservationUnits: inputUnits + 6000, dispatched: true, physicalPosts: 1, settled: true, unknown: false,
      visibleOutput: JSON.stringify(raw), returnedModel: arm.model, finishReason: 'stop',
      usage: { inputTokens: 8, outputTokens: 2, reasoningTokens: 1, cachedInputTokens: 4 }, evidence }],
  };
}
function input(cells: Cell[] = []): ReviewCalibrationReportInput {
  return { version: 'review-calibration-report-input-v1', mode: 'scripted-offline', run: { cells,
    sdkSends: cells.flatMap(row => row.attempts).filter(row => row.dispatched).length,
    physicalWirePosts: cells.flatMap(row => row.attempts).reduce((sum, row) => sum + row.physicalPosts, 0),
    conservativeReservations: cells.flatMap(row => row.attempts).reduce((sum, row) => sum + row.reservationUnits, 0) },
    rubric: { version: 'synthetic-predeclared-rubric-v1', evidence, annotations: [] }, professorLabels: null, evidence };
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function full() { return input(REVIEW_CALIBRATION_SCHEDULE.map((_row, index) => cell(index, index + 1))); }
function addCorrection(value: Cell) {
  const first = value.attempts[0];
  value.attempts.push({ ...clone(first), sdkId: first.sdkId + 100, logicalAttempt: 1, jsonAttempt: 0 });
  value.logicalReviews.push({ ...clone(value.logicalReviews[0]), logicalAttempt: 1, sdkIds: [first.sdkId + 100] });
}

describe('review calibration offline facet report', () => {
  test('retains planned15 cells even with no recorded rows and unknown provider totals', () => {
    const report = buildReviewCalibrationReport(input());
    expect(report.denominators).toEqual({ plannedCases: 5, plannedArms: 3, plannedCells: 15, recordedCellRows: 0, notStartedCells: 15, interruptedCells: 0, reviewedCells: 0, formatInvalidCells: 0, mechanicallyComparableCases: 0 });
    expect(report.cells.every(row => !row.sourceRowPresent && row.state === 'not-started')).toBe(true);
    expect(report.usage.input.knownTotal).toBeNull();
    expect(report.usage.providerTokenTotalWhenComplete).toBeNull();
    expect(report.professorLabels).toBeNull();
    expect(report.executionAllowed).toBe(false);
  });
  test('fills sparse records without dropping unstarted arms or changing schedule', () => {
    const report = buildReviewCalibrationReport(input([cell(7, 1)]));
    expect(report.cells.map(row => row.id)).toEqual(REVIEW_CALIBRATION_SCHEDULE.map(row => row.id));
    expect(report.denominators.recordedCellRows).toBe(1);
    expect(report.denominators.notStartedCells).toBe(14);
    expect(report.cells[7].sourceRowPresent).toBe(true);
    expect(report.caseComparisons.every(row => !row.mechanicallyComparableThreeArms)).toBe(true);
  });
  test('full synthetic three-arm cases are mechanically comparable, never semantically graded', () => {
    const report = buildReviewCalibrationReport(full());
    expect(report.denominators.mechanicallyComparableCases).toBe(5);
    expect(report.caseComparisons.every(row => row.semanticCorrectness === 'unassessed')).toBe(true);
    expect(report.caseComparisons.every(row => Object.values(row.comparableFacets).every(Boolean))).toBe(true);
    expect(report).not.toHaveProperty('winner');
    expect(report).not.toHaveProperty('accuracy');
    expect(report.cells.every(row => row.professorLabels === null)).toBe(true);
  });
  test('guarded withheld and passed answerability remain separate from Hard-demand hold', () => {
    const value = cell(6, 1);
    const raw = value.logicalReviews[0].parsed as ReturnType<typeof review>;
    raw.answerability = { kind: 'mcq', options: [{ key: 'A', verdict: 'fully-correct' }] };
    value.quality = { ...raw, status: 'withheld', requestedDifficulty: 'hard', achievedDifficulty: 'easy', candidate: { difficulty: 'easy' },
      answerability: { status: 'passed' }, taskDemand: { status: 'withheld' }, reviewRepair: { status: 'consistent' } };
    const row = buildReviewCalibrationReport(input([value])).cells[6];
    expect(row.facets.guarded.qualityStatus).toBe('withheld');
    expect(row.facets.guarded.answerability).toEqual({ status: 'passed' });
    expect(row.facets.guarded.taskDemand).toEqual({ status: 'withheld' });
    expect(row.facets.guarded.difficulty).toMatchObject({ requested: 'hard', candidate: 'easy', achieved: 'easy' });
  });
  test('initial and corrected raw novelty survive a guarded drift refusal without gold labels', () => {
    const value = cell(3, 1); addCorrection(value);
    (value.logicalReviews[0].parsed as ReturnType<typeof review>).novelty = 'duplicate';
    value.quality = { ...review(), status: 'withheld', reviewRepair: { status: 'drift', changes: [{ path: 'novelty' }] } };
    const row = buildReviewCalibrationReport(input([value])).cells[3];
    expect(row.facets.initial.bank.novelty).toBe('duplicate');
    expect(row.facets.final.bank.novelty).toBe('independent');
    expect(row.drift.status).toBe('drift');
    expect(row.comparisonEligible).toBe(false);
    expect(row.professorLabels).toBeNull();
  });
  test('raw source supported and canonical source uncertain do not overwrite each other', () => {
    const value = cell(0, 1);
    (value.quality as Record<string, unknown>).sourceSupport = 'uncertain';
    const row = buildReviewCalibrationReport(input([value])).cells[0];
    expect(row.facets.final.source.support).toBe('supported');
    expect(row.facets.guarded.source.support).toBe('uncertain');
    expect(row.reviews.initial?.rawText).toBe(value.logicalReviews[0].rawText);
    expect(row.retainedObservation).toEqual(value);
  });
  test('repaired initial issues are retained without being labelled final-format-invalid', () => {
    const value = cell(0, 1); addCorrection(value);
    (value.quality as Record<string, unknown>).responseIssues = [{ attempt: 0, path: 'taskComparisons', code: 'required' }];
    const row = buildReviewCalibrationReport(input([value])).cells[0];
    expect(row.format.initialIssues).toHaveLength(1);
    expect(row.format.correctedIssues).toEqual([]);
    expect(row.format.recordedStatus).toBe('validated');
    expect(row.comparisonEligible).toBe(true);
  });
  test('known JSON exhaustion and a later unstarted arm retain independent states', () => {
    const value = cell(0, 1);
    value.state = 'cell-format-invalid'; value.formatStatus = 'invalid'; delete value.quality;
    value.logicalReviews[0].state = 'known-json-exhausted'; delete value.logicalReviews[0].parsed;
    value.attempts.push({ ...clone(value.attempts[0]), sdkId: 2, jsonAttempt: 1, visibleOutput: 'still not JSON' });
    value.logicalReviews[0].sdkIds = [1, 2];
    const report = buildReviewCalibrationReport(input([value]));
    expect(report.denominators.formatInvalidCells).toBe(1);
    expect(report.denominators.notStartedCells).toBe(14);
    expect(report.cells[0].facets.final.source.support).toBeNull();
    expect(report.cells[0].comparisonEligible).toBe(false);
    expect(report.usage.providerTokenTotalWhenComplete).toBe(20);
  });
  test('reasoning/cache are subsets and are not added to provider total', () => {
    const report = buildReviewCalibrationReport(input([cell(0, 1)]));
    expect(report.usage.input.knownTotal).toBe(8);
    expect(report.usage.output.knownTotal).toBe(2);
    expect(report.usage.reasoningSubsetOfOutput.knownTotal).toBe(1);
    expect(report.usage.cachedSubsetOfInput.knownTotal).toBe(4);
    expect(report.usage.providerTokenTotalWhenComplete).toBe(10);
    expect(report.usage.cacheWrite.knownTotal).toBeNull();
  });
  test('partial and unknown usage stay nullable and exclude mechanical pairing', () => {
    const value = cell(0, 1);
    value.attempts[0].usage!.outputTokens = null; value.attempts[0].unknown = true; value.attempts[0].settled = false;
    const report = buildReviewCalibrationReport(input([value]));
    expect(report.usage.input.knownTotal).toBe(8);
    expect(report.usage.output.knownTotal).toBeNull();
    expect(report.usage.output.unknownSends).toBe(1);
    expect(report.usage.providerTokenTotalWhenComplete).toBeNull();
    expect(report.cells[0].comparisonEligible).toBe(false);
  });
  test('a reserved but undispatched attempt is not counted as zero provider usage or a reviewed cell', () => {
    const value = cell(0, 1); value.state = 'interrupted';
    Object.assign(value.attempts[0], { dispatched: false, physicalPosts: 0, settled: false, unknown: false, usage: null });
    const report = buildReviewCalibrationReport(input([value]));
    expect(report.accounting.derived.sdkSends).toBe(0);
    expect(report.usage.providerTokenTotalWhenComplete).toBeNull();
    expect(report.cells[0].comparisonEligible).toBe(false);
  });
  test('subset violations remain inspectable and are reported as integrity issues', () => {
    const value = cell(0, 1); value.attempts[0].usage!.reasoningTokens = 7; value.attempts[0].usage!.cachedInputTokens = 99;
    const report = buildReviewCalibrationReport(input([value]));
    expect(report.accounting.integrityIssues.map(row => row.code)).toEqual(expect.arrayContaining(['reasoning-subset-exceeds-output', 'cached-subset-exceeds-input']));
    expect(report.cells[0].attempts[0].usage!.reasoningTokens).toBe(7);
    expect(report.cells[0].comparisonEligible).toBe(false);
  });
  test('mismatched returned model is retained without fallback or mechanical pairing', () => {
    const value = cell(0, 1); value.attempts[0].returnedModel = 'unexpected-model';
    const row = buildReviewCalibrationReport(input([value])).cells[0];
    expect(row.attempts[0].returnedModel).toBe('unexpected-model');
    expect(row.comparisonEligible).toBe(false);
  });
  test('different initial prompt in one arm invalidates only that case pairing', () => {
    const value = full(); const target = value.run.cells[2];
    target.logicalReviews[0].prompt += 'changed';
    const report = buildReviewCalibrationReport(value);
    expect(report.caseComparisons[0].sameInitialPrompts).toBe(false);
    expect(report.caseComparisons[0].mechanicallyComparableThreeArms).toBe(false);
    expect(report.denominators.mechanicallyComparableCases).toBe(4);
  });
  test('different input bindings cannot be hidden by equal prompts or caller comparable flag', () => {
    const value = full(); value.run.cells[1].inputBindings!.packet = 'b'.repeat(64);
    Object.assign(value.run.cells[1], { comparable: true });
    const report = buildReviewCalibrationReport(value);
    expect(report.caseComparisons[0].sameDeclaredInputBindings).toBe(false);
    expect(report.caseComparisons[0].mechanicallyComparableThreeArms).toBe(false);
  });
  test('dated returned model aliases are preserved exactly and valid calendar dates are mechanical only', () => {
    const value = cell(0, 1); value.attempts[0].returnedModel = 'gpt-6-luna-2026-10-17';
    const row = buildReviewCalibrationReport(input([value])).cells[0];
    expect(row.attempts[0].returnedModel).toBe('gpt-6-luna-2026-10-17');
    expect(row.comparisonEligible).toBe(true);
    value.attempts[0].returnedModel = 'gpt-6-luna-2026-99-99';
    expect(buildReviewCalibrationReport(input([value])).cells[0].comparisonEligible).toBe(false);
  });
  test('missing required drift receipt excludes pairing while raw initial facets retain own shape observations', () => {
    const value = cell(0, 1); delete (value.quality as Record<string, unknown>).reviewRepair;
    (value.logicalReviews[0].parsed as Record<string, unknown>).notation = 'not-an-enum';
    const row = buildReviewCalibrationReport(input([value])).cells[0];
    expect(row.comparisonEligible).toBe(false);
    expect(row.reviewValidity.initial.facetShapes.source).toBe('recognized-enum');
    expect(row.reviewValidity.initial.facetShapes.notation).toBe('invalid-shape');
    expect(row.reviewValidity.initial.facetShapes.answerability).toBe('present-unvalidated');
    expect(row.facets.initial.notation).toBe('not-an-enum');
  });
  test('requested/candidate/achieved difficulty stays separate for P03', () => {
    const row = buildReviewCalibrationReport(input([cell(12, 1)])).cells[12];
    expect(row.facets.guarded.difficulty).toMatchObject({ requested: 'easy', candidate: 'medium', achieved: 'easy' });
    expect(row.facets.final.difficulty.candidate).toBe('medium');
  });
  test('counter disagreement is disclosed, not normalized away', () => {
    const value = full(); value.run.sdkSends = 0;
    const report = buildReviewCalibrationReport(value);
    expect(report.accounting.recorded.sdkSends).toBe(0);
    expect(report.accounting.derived.sdkSends).toBe(15);
    expect(report.accounting.integrityIssues.map(row => row.code)).toContain('sdk-count-mismatch');
    expect(report.denominators.mechanicallyComparableCases).toBe(0);
  });
  test.each(['medium-temperature', 'wrong-message', 'wire-without-sdk', 'input-estimator', 'reservation', 'phase-cap'])('reports native/accounting anomaly %s', variant => {
    const value = input([cell(1, 1)]), attempt = value.run.cells[0].attempts[0];
    if (variant === 'medium-temperature') (attempt.nativeRequest as Record<string, unknown>).temperature = 0;
    if (variant === 'wrong-message') (attempt.nativeRequest as Record<string, unknown>).messages = [{ role: 'system', content: 'other' }];
    if (variant === 'wire-without-sdk') attempt.dispatched = false;
    if (variant === 'input-estimator') attempt.inputUnits++;
    if (variant === 'reservation') attempt.reservationUnits++;
    if (variant === 'phase-cap') value.run.conservativeReservations = 600001;
    const report = buildReviewCalibrationReport(value);
    expect(report.accounting.integrityIssues.length).toBeGreaterThan(0);
    expect(report.cells[1].comparisonEligible).toBe(false);
  });
  test('manual annotations do not grade keywords, produce accuracy or select a judge', () => {
    const value = full(); value.rubric.annotations = [{ caseId: 'P01', facet: 'answerability', origin: 'manual-ai-diagnostic', text: 'Provisional mitigate != eliminate concern; not professor truth.', evidence }];
    const report = buildReviewCalibrationReport(value);
    expect(report.cells[0].annotations[0].origin).toBe('manual-ai-diagnostic');
    expect(report.denominators.mechanicallyComparableCases).toBe(5);
    expect(report.caseComparisons.every(row => row.semanticCorrectness === 'unassessed')).toBe(true);
    expect(report.professorLabels).toBeNull();
    expect(report).not.toHaveProperty('selectedReviewer');
  });
  test('explicit professor labels are separate caller records with evidence, never inferred', () => {
    const value = input(); value.professorLabels = [{ caseId: 'P03', facet: 'notation', label: 'Requires clarification', assessor: 'Synthetic professor fixture', evidence }];
    const report = buildReviewCalibrationReport(value);
    expect(report.professorLabels).toEqual(value.professorLabels);
    expect(report.denominators.recordedCellRows).toBe(0);
    expect(report.authority).toContain('no transcript authentication');
  });
  test('report copies protect input and independent builds from caller mutation', () => {
    const value = input([cell(0, 1)]), before = clone(value);
    const first = buildReviewCalibrationReport(value); first.cells[0].attempts[0].usage!.inputTokens = 900;
    expect(value).toEqual(before);
    expect(buildReviewCalibrationReport(value).cells[0].attempts[0].usage!.inputTokens).toBe(8);
  });
  test.each(['duplicate-cell', 'wrong-cell-id', 'wrong-arm', 'duplicate-sdk', 'attempt-link', 'json-order', 'missing-parsed'])('rejects contradictory report identity %s', variant => {
    const value = input([cell(0, 1)]);
    if (variant === 'duplicate-cell') value.run.cells.push(clone(value.run.cells[0]));
    if (variant === 'wrong-cell-id') value.run.cells[0].cellId = 'P03--sol-medium--r1';
    if (variant === 'wrong-arm') value.run.cells[0].armId = 'sol-medium';
    if (variant === 'duplicate-sdk') value.run.cells.push(cell(1, 1));
    if (variant === 'attempt-link') value.run.cells[0].logicalReviews[0].sdkIds = [2];
    if (variant === 'json-order') value.run.cells[0].attempts[0].jsonAttempt = 1;
    if (variant === 'missing-parsed') delete value.run.cells[0].logicalReviews[0].parsed;
    expect(() => buildReviewCalibrationReport(value)).toThrow();
  });
  test('rejects executable/cyclic/non-JSON values without running accessors', () => {
    let getterCalls = 0; const getter = Object.defineProperty({}, 'value', { enumerable: true, get() { getterCalls++; return 1; } });
    expect(() => buildReviewCalibrationReport(getter)).toThrow('plain-json');
    expect(getterCalls).toBe(0);
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    for (const value of [cyclic, { value: undefined }, { value: Infinity }, { value: () => 1 }, new Date()]) expect(() => buildReviewCalibrationReport(value)).toThrow();
  });
  test('fixed exported schedule and arm objects cannot be mutated to alter the denominator', () => {
    expect(Object.isFrozen(REVIEW_CALIBRATION_SCHEDULE)).toBe(true);
    expect(Reflect.set(REVIEW_CALIBRATION_SCHEDULE[0], 'caseId', 'other')).toBe(false);
    expect(Reflect.set(REVIEW_CALIBRATION_ARMS[0], 'model', 'other')).toBe(false);
    expect(buildReviewCalibrationReport(input()).cells).toHaveLength(15);
  });
  test.each(['missing-visible-output', 'missing-evidence', 'unresolved-final-reference'])('incomplete final evidence excludes mechanical pairing: %s', variant => {
    const value = cell(0, 1);
    if (variant === 'missing-visible-output') value.attempts[0].visibleOutput = null;
    if (variant === 'missing-evidence') value.attempts[0].evidence = [];
    if (variant === 'unresolved-final-reference') (value.quality as Record<string, unknown>).responseIssues = [{ attempt: 0, path: 'citations', code: 'unknown-span' }];
    const row = buildReviewCalibrationReport(input([value])).cells[0];
    expect(row.comparisonEligible).toBe(false);
    expect(row.retainedObservation).toEqual(value);
  });
  test('accepts the launcher structural aliases while retaining the exact original run', () => {
    const value = clone(input([cell(0, 1)])) as unknown as Record<string, unknown>;
    const run = value.run as Record<string, unknown>, rows = run.cells as Array<Record<string, unknown>>;
    const attempt = (rows[0].attempts as Array<Record<string, unknown>>)[0];
    attempt.id = attempt.sdkId; delete attempt.sdkId;
    attempt.conservativeReservation = attempt.reservationUnits; delete attempt.reservationUnits;
    attempt.sdkDispatched = attempt.dispatched; delete attempt.dispatched;
    attempt.experimentalOutputCap = attempt.experimentalNativeOutputCap; delete attempt.experimentalNativeOutputCap;
    attempt.state = 'known'; delete attempt.unknown;
    const before = clone(value), report = buildReviewCalibrationReport(value);
    expect(report.retainedRun).toEqual(run);
    expect(report.cells[0].retainedObservation).toEqual(rows[0]);
    expect(report.cells[0].attempts[0].sdkId).toBe(1);
    expect(report.cells[0].comparisonEligible).toBe(true);
    expect(value).toEqual(before);
  });
  test('conflicting launcher aliases refuse rather than selecting the convenient one', () => {
    const value = input([cell(0, 1)]);
    Object.assign(value.run.cells[0].attempts[0], { id: 99 });
    expect(() => buildReviewCalibrationReport(value)).toThrow('conflicting-alias');
  });
  test('launcher unknown-state alias cannot become complete known work', () => {
    const value = input([cell(0, 1)]) as unknown as Record<string, unknown>;
    const attempt = (((value.run as Record<string, unknown>).cells as Array<Record<string, unknown>>)[0].attempts as Array<Record<string, unknown>>)[0];
    delete attempt.unknown; attempt.state = 'unknown';
    expect(buildReviewCalibrationReport(value).cells[0].comparisonEligible).toBe(false);
  });
  test('missing fixed-input metadata is unknown even if a hypothetical quality snapshot or mismatch suggests a label', () => {
    const value = cell(12, 1); delete value.inputDifficulty;
    (value.quality as Record<string, unknown>).difficultyMismatch = true;
    const row = buildReviewCalibrationReport(input([value])).cells[12];
    expect(row.facets.guarded.difficulty.requested).toBeNull();
    expect(row.facets.guarded.difficulty.candidate).toBeNull();
    expect(row.facets.guarded.difficulty.achieved).toBe('easy');
    expect(row.inputDifficulty).toBeNull();
    expect(row.comparisonEligible).toBe(false);
  });
  test('same-case fixed difficulty metadata must agree across arms and carry evidence', () => {
    const value = full(); value.run.cells[1].inputDifficulty!.candidate = 'hard';
    const report = buildReviewCalibrationReport(value);
    expect(report.caseComparisons[0].sameFixedDifficultyMetadata).toBe(false);
    expect(report.caseComparisons[0].mechanicallyComparableThreeArms).toBe(false);
    value.run.cells[1].inputDifficulty!.evidence = [];
    expect(() => buildReviewCalibrationReport(value)).toThrow();
  });
  test('explicit local CLI creates new output, leaves input exact and refuses overwrite/URL paths', () => {
    const directory = mkdtempSync(join(tmpdir(), 'review-calibration-report-'));
    try {
      const source = join(directory, 'source.json'), output = join(directory, 'report.json');
      const text = JSON.stringify(input([cell(0, 1)])); writeFileSync(source, text);
      expect(runReviewCalibrationReportCli(['--input', source, '--output', output])).toEqual({ output, plannedCells: 15 });
      expect(JSON.parse(readFileSync(output, 'utf8')).denominators.plannedCells).toBe(15);
      expect(readFileSync(source, 'utf8')).toBe(text);
      const retained = readFileSync(output, 'utf8');
      expect(() => runReviewCalibrationReportCli(['--input', source, '--output', output])).toThrow();
      expect(readFileSync(output, 'utf8')).toBe(retained);
      expect(() => runReviewCalibrationReportCli(['--input', source, '--output', source])).toThrow('exclusive-output');
      expect(() => runReviewCalibrationReportCli(['--input', 'https://example.invalid/input', '--output', output])).toThrow('local-files');
      expect(() => runReviewCalibrationReportCli([])).toThrow('Usage');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
