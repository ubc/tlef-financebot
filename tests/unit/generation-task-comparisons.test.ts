import {
  requiredTaskComparisonIssues, taskRetrievalComparisonCorrection, taskRetrievalComparisonInstruction,
  taskRetrievalComparisonsEnabled, TASK_RETRIEVAL_COMPARISON_PROTOCOL,
} from '../../server/src/services/generation-task-comparisons';
import type { TaskComparisonSelection, TaskComparisonReview } from '../../server/src/services/generation-task-comparisons';

const q1 = '000000000000000000000001', q2 = '000000000000000000000002', q3 = '000000000000000000000003';
const v1 = '000000000000000000000011', v2 = '000000000000000000000012', v3 = '000000000000000000000013';
const id1 = `q:${q1}:${v1}`, id2 = `q:${q2}:${v2}`, id3 = `q:${q3}:${v3}`;
const requirements = { intent: 'create-independent-task' as const, taskRetrievalProtocol: TASK_RETRIEVAL_COMPARISON_PROTOCOL };
function selection(pin = false): TaskComparisonSelection {
  return { requiredComparisonIds: [id1, id2], entries: [
    { id: id1, source: 'bank', questionId: q1, versionId: v1, comparisonRole: pin ? 'pinned-original' : 'retrieved-task' },
    { id: id2, source: 'bank', questionId: q2, versionId: v2, comparisonRole: 'retrieved-task' },
    { id: id3, source: 'bank', questionId: q3, versionId: v3 },
  ] };
}
function different(entryId = id1) {
  return { entryId, sameInference: false, sameSolutionPath: false,
    contrast: 'Both concern CAPM, but the Bank recalls the meaning of beta; the candidate must infer why idiosyncratic risk earns no premium.' };
}
function review(novelty: 'independent' | 'uncertain' | 'duplicate' | 'variant' = 'independent'): TaskComparisonReview {
  return { novelty, taskComparisons: [different(id1), different(id2)] };
}

describe('pure versioned required Bank task comparisons', () => {
  it('leaves the historical independent empty-comparison path untouched but closes it for the new selector', () => {
    const empty = { novelty: 'independent', taskComparisons: [] };
    expect(requiredTaskComparisonIssues(empty, selection(), { intent: 'create-independent-task' })).toEqual([]);
    expect(requiredTaskComparisonIssues(empty, selection(), requirements)).toEqual([
      { path: 'taskComparisons', code: 'required-task-comparison-missing' },
    ]);
  });

  it.each(['independent', 'uncertain'] as const)('requires both nominated rows even with a %s verdict', novelty => {
    expect(requiredTaskComparisonIssues({ novelty, taskComparisons: [different(id1)] }, selection(), requirements))
      .toContainEqual({ path: 'taskComparisons', code: 'required-task-comparison-missing' });
    expect(requiredTaskComparisonIssues(review(novelty), selection(), requirements)).toEqual([]);
  });

  it('allows shared vocabulary with a different inference/path instead of forcing high-similarity matches', () => {
    const result = review(); const before = JSON.stringify(result);
    expect(requiredTaskComparisonIssues(result, selection(), requirements)).toEqual([]);
    expect(JSON.stringify(result)).toBe(before);
    expect(taskRetrievalComparisonInstruction(selection(), requirements)).toContain('Similarity never forces true booleans');
  });

  it.each([[true, false], [false, true], [false, false]])('permits an independent verdict when inference=%s and path=%s do not both match', (sameInference, sameSolutionPath) => {
    expect(requiredTaskComparisonIssues({ novelty: 'independent', taskComparisons: [
      { ...different(id1), sameInference, sameSolutionPath }, different(id2),
    ] }, selection(), requirements)).toEqual([]);
  });

  it.each(['independent', 'uncertain'] as const)('rejects contradictory %s with an actual same-inference and same-path row', novelty => {
    expect(requiredTaskComparisonIssues({ novelty, taskComparisons: [
      { ...different(id1), sameInference: true, sameSolutionPath: true }, different(id2),
    ] }, selection(), requirements)).toContainEqual({ path: 'matchedEntryIds', code: 'nonmatching-verdict-has-matches' });
  });

  it.each(['duplicate', 'variant'] as const)('requires a valid positive comparator for %s without inventing one from rank', novelty => {
    expect(requiredTaskComparisonIssues(review(novelty), selection(), requirements))
      .toContainEqual({ path: 'matchedEntryIds', code: 'bank-comparator-required' });
    expect(requiredTaskComparisonIssues({ novelty, taskComparisons: [
      { ...different(id1), sameInference: true, sameSolutionPath: true }, different(id2),
    ] }, selection(), requirements)).toEqual([]);
  });

  it('checks a pinned original plus one ordinary full comparator within the same two-entry obligation', () => {
    expect(requiredTaskComparisonIssues(review(), selection(true), requirements)).toEqual([]);
    expect(requiredTaskComparisonIssues({ novelty: 'independent', taskComparisons: [different(id1)] }, selection(true), requirements))
      .toContainEqual({ path: 'taskComparisons', code: 'required-task-comparison-missing' });
    expect(taskRetrievalComparisonInstruction(selection(true), requirements)).toContain('M1,M2');
  });

  it('derives M aliases from actual selected order, including an intervening same-batch entry', () => {
    const chosen = selection();
    chosen.entries = [chosen.entries[1], { id: 'batch:run:0', source: 'batch' }, chosen.entries[0], chosen.entries[2]];
    const text = taskRetrievalComparisonInstruction(chosen, requirements);
    expect(text).toContain('M3,M1');
    expect(text).not.toContain(id1); expect(text).not.toContain(id2);
  });

  it('rejects duplicate required rows, including conflicting positive/negative descriptions', () => {
    const issues = requiredTaskComparisonIssues({ novelty: 'duplicate', taskComparisons: [different(id1),
      { ...different(id1), sameInference: true, sameSolutionPath: true }, different(id2),
    ] }, selection(), requirements);
    expect(issues).toContainEqual({ path: 'taskComparisons.1.entryId', code: 'unknown-or-duplicate-memory-comparison' });
    expect(issues).toContainEqual({ path: 'taskComparisons', code: 'required-task-comparison-duplicated' });
    expect(issues).toContainEqual({ path: 'matchedEntryIds', code: 'bank-comparator-required' });
  });

  it.each(['M1', 'E1', 'q:foreign:version', 'batch:not-shown:0'])('rejects an unresolved/foreign %s comparison rather than borrowing source identity', foreign => {
    expect(requiredTaskComparisonIssues({ novelty: 'independent', taskComparisons: [different(id1), different(id2), different(foreign)] }, selection(), requirements))
      .toContainEqual({ path: 'taskComparisons.2.entryId', code: 'unknown-or-duplicate-memory-comparison' });
  });

  it.each([
    { sameInference: 'false' }, { sameSolutionPath: undefined }, { contrast: '' }, { contrast: ' '.repeat(20) }, { contrast: 'x'.repeat(241) },
  ])('requires a valid comparison body, not merely the expected entry ID: %o', patch => {
    expect(requiredTaskComparisonIssues({ novelty: 'independent', taskComparisons: [{ ...different(id1), ...patch }, different(id2)] }, selection(), requirements))
      .toContainEqual({ path: 'taskComparisons.0', code: 'task-comparison-row-invalid' });
  });

  it.each([undefined, null, {}, 'not-an-array'])('rejects absent/malformed comparison arrays: %s', taskComparisons => {
    expect(requiredTaskComparisonIssues({ novelty: 'independent', taskComparisons }, selection(), requirements))
      .toContainEqual({ path: 'taskComparisons', code: 'task-comparisons-schema-invalid' });
  });

  it('bounds excessive response arrays and rejects unknown novelty without exposing literal response data', () => {
    const issues = requiredTaskComparisonIssues({ novelty: 'invented-verdict', taskComparisons: Array.from({ length: 1000 }, () => different(id1)) }, selection(), requirements);
    expect(issues).toContainEqual({ path: 'taskComparisons', code: 'task-comparisons-schema-invalid' });
    expect(issues).toContainEqual({ path: 'novelty', code: 'task-comparison-verdict-invalid' });
    expect(issues.length).toBeLessThanOrEqual(17); expect(JSON.stringify(issues)).not.toContain('invented-verdict');
  });

  it.each([
    ['missing required IDs', (value: TaskComparisonSelection) => { delete value.requiredComparisonIds; }],
    ['removed obligations', (value: TaskComparisonSelection) => { value.requiredComparisonIds = []; }],
    ['duplicate required IDs', (value: TaskComparisonSelection) => { value.requiredComparisonIds = [id1, id1]; }],
    ['three required IDs', (value: TaskComparisonSelection) => { value.requiredComparisonIds = [id1, id2, id3]; }],
    ['foreign required ID', (value: TaskComparisonSelection) => { value.requiredComparisonIds = [id1, `q:${q3}:${v2}`]; }],
    ['wrong role', (value: TaskComparisonSelection) => { value.entries[0].comparisonRole = undefined; }],
    ['batch role spoof', (value: TaskComparisonSelection) => { value.entries[0].source = 'batch'; }],
    ['wrong question binding', (value: TaskComparisonSelection) => { value.entries[0].questionId = q3; }],
    ['wrong version binding', (value: TaskComparisonSelection) => { value.entries[0].versionId = v3; }],
    ['duplicate selected ID', (value: TaskComparisonSelection) => { value.entries = [...value.entries, value.entries[0]]; }],
    ['omitted marked comparator', (value: TaskComparisonSelection) => { value.requiredComparisonIds = [id1]; }],
    ['unrequired extra role', (value: TaskComparisonSelection) => { value.entries[2].comparisonRole = 'retrieved-task'; }],
    ['two original pins', (value: TaskComparisonSelection) => { value.entries[0].comparisonRole = 'pinned-original'; value.entries[1].comparisonRole = 'pinned-original'; }],
  ] as const)('rejects tampered server selection %s before rendering a model obligation', (_label, tamper) => {
    const chosen = selection(); tamper(chosen);
    expect(requiredTaskComparisonIssues(review(), chosen, requirements))
      .toEqual([{ path: 'memory.requiredComparisonIds', code: 'task-retrieval-selection-invalid' }]);
    expect(() => taskRetrievalComparisonInstruction(chosen, requirements)).toThrow('generation-task-retrieval-selection-invalid');
  });

  it('permits an actually empty Bank and same-batch-only selection without inventing a required Bank row', () => {
    for (const chosen of [{ entries: [], requiredComparisonIds: [] },
      { entries: [{ id: 'batch:run:0', source: 'batch' as const }], requiredComparisonIds: [] }]) {
      expect(requiredTaskComparisonIssues({ novelty: 'independent', taskComparisons: [] }, chosen, requirements)).toEqual([]);
      expect(taskRetrievalComparisonInstruction(chosen, requirements)).toBe('');
    }
  });

  it('allows genuinely unrelated unmarked Bank fillers with no required nominations', () => {
    const chosen: TaskComparisonSelection = { requiredComparisonIds: [], entries: [
      { id: id3, source: 'bank', questionId: q3, versionId: v3 },
    ] };
    expect(requiredTaskComparisonIssues({ novelty: 'independent', taskComparisons: [] }, chosen, requirements)).toEqual([]);
    expect(taskRetrievalComparisonInstruction(chosen, requirements)).toBe('');
  });

  it('keeps ordinary non-required selected and same-batch comparisons valid without weakening required rows', () => {
    const chosen = selection(); chosen.entries = [...chosen.entries, { id: 'batch:run:0', source: 'batch' }];
    expect(requiredTaskComparisonIssues({ novelty: 'independent', taskComparisons: [different(id1), different(id2), different(id3), different('batch:run:0')] }, chosen, requirements)).toEqual([]);
  });

  it('returns concise correction guidance only for the new applicable response errors', () => {
    const issues = requiredTaskComparisonIssues({ novelty: 'independent', taskComparisons: [] }, selection(), requirements);
    const correction = taskRetrievalComparisonCorrection(issues, requirements);
    expect(correction).toContain('exactly once'); expect(correction).toContain('never forces true booleans');
    expect(correction).toContain('No candidate/source rewrite'); expect(correction.length).toBeLessThan(400);
    expect(taskRetrievalComparisonCorrection([{ path: 'citations', code: 'unknown-passage' }], requirements)).toBe('');
    expect(taskRetrievalComparisonCorrection([{ path: 'memory.requiredComparisonIds', code: 'task-retrieval-selection-invalid' }], requirements)).toBe('');
  });

  it('preserves absent historical prompt/correction/issue behavior without inspecting malformed old records', () => {
    const brokenSelection = undefined as unknown as TaskComparisonSelection;
    expect(taskRetrievalComparisonsEnabled()).toBe(false);
    expect(requiredTaskComparisonIssues(undefined as unknown as TaskComparisonReview, brokenSelection)).toEqual([]);
    expect(taskRetrievalComparisonInstruction(brokenSelection)).toBe('');
    expect(taskRetrievalComparisonCorrection([{ path: 'taskComparisons', code: 'required-task-comparison-missing' }])).toBe('');
  });

  it.each(['edit-existing', 'create-variant'] as const)('keeps %s comparison semantics outside the independent new obligation', intent => {
    const request = { ...requirements, intent };
    expect(taskRetrievalComparisonsEnabled(request)).toBe(false);
    expect(requiredTaskComparisonIssues({ novelty: 'variant', taskComparisons: [] }, selection(), request)).toEqual([]);
    expect(taskRetrievalComparisonInstruction(selection(), request)).toBe('');
    expect(taskRetrievalComparisonCorrection([{ path: 'taskComparisons', code: 'required-task-comparison-missing' }], request)).toBe('');
  });

  it('refuses unknown explicit protocol values rather than treating them as old absence', () => {
    const unknown = { ...requirements, taskRetrievalProtocol: 'future-unreviewed-policy' };
    expect(() => taskRetrievalComparisonsEnabled(unknown)).toThrow('generation-task-retrieval-protocol-invalid');
    expect(() => requiredTaskComparisonIssues(review(), selection(), unknown)).toThrow('generation-task-retrieval-protocol-invalid');
    expect(() => taskRetrievalComparisonInstruction(selection(), unknown)).toThrow('generation-task-retrieval-protocol-invalid');
    expect(() => taskRetrievalComparisonCorrection([], unknown)).toThrow('generation-task-retrieval-protocol-invalid');
  });
});
