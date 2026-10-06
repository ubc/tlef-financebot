import { importGenerationExports, type ExportManifest } from '../../scripts/prompt-ab/evaluation/import-exports';
import { importTeacherReviews } from '../../scripts/prompt-ab/evaluation/import-reviews';
import { createBlindReview } from '../../scripts/prompt-ab/evaluation/review';
import { hashValue, type EvaluationDataset, type EvaluationQuestion, type ReviewKey, type TeacherLabel } from '../../scripts/prompt-ab/evaluation/schema';
import type { GenerationEvaluationExport } from '../../server/src/types/generation-evaluation';

const now = '2026-10-03T18:00:00.000Z';

function question(stem = 'What does beta measure in CAPM?'): EvaluationQuestion {
  return { type: 'mcq', stem, numericKind: 'conceptual', options: [
    { key: 'A', text: 'Systematic risk', role: 'correct', explanation: 'Beta measures systematic risk relative to the market.' },
    { key: 'B', text: 'Total volatility', role: 'common-misconception', explanation: 'Total volatility includes diversifiable risk.' },
  ] };
}

function manifest(): ExportManifest {
  return { experimentId: 'production-import-test', cases: [{ caseId: 'capm', repetitions: 1, context: {
    objective: 'Distinguish systematic risk from total volatility.',
    request: { type: 'mcq', difficulty: 'medium', count: 4, instruction: 'Use the lecture notation.' },
    sources: [{ id: 'original-source-id', role: 'primary', text: 'Beta measures systematic risk; total volatility also includes diversifiable risk.' }],
    bank: [{ id: 'original-bank-id', content: question('Which risks can diversification remove?') }],
    coverage: { sourcesComplete: true, bankComplete: true, notes: [] },
  } }], runs: [
    { file: 'baseline.json', caseId: 'capm', repetition: 1 },
    { file: 'pilot.json', caseId: 'capm', repetition: 1 },
  ] };
}

/** The production DTO is intentionally richer than the offline projection. */
function productionExport(policy: 'baseline' | 'grounded-memory-v1'): GenerationEvaluationExport {
  const candidate = { ...question(), contentHash: hashValue('original unbounded candidate'), truncated: false };
  return { schemaVersion: 'generation-evaluation-export-v1', exportedAt: now,
    run: { id: `${policy}-run`, courseId: 'course-id', loId: 'lo-id', secondaryLoIds: ['secondary-lo'],
      policy, requestedSlots: 4, type: 'mcq', difficulty: 'medium', prompt: 'Use the lecture notation.',
      hardnessMove: 'Compare assumptions', kind: 'conceptual',
      grounding: { allowedMaterialIds: ['original-source-id'], retrievedChunkCount: 1, pinned: true },
      status: 'partial', models: { embedding: 'embed-model', generator: 'generator-model', validator: 'validator-model', reviewer: 'reviewer-model' },
      createdAt: now, startedAt: now, finishedAt: '2026-10-03T18:00:02.500Z' },
    slots: [
      { item: 0, outcome: 'saved', candidate, questionVersionId: 'immutable-version-1', failureCodes: [],
        recordedSourceRefs: [{ materialId: 'original-source-id', chunk: 'Copied partial original excerpt.' }],
        numericVerification: { evaluatorVersion: 1, sampleSeeds: [123, 456], verifiedAt: now } },
      { item: 1, outcome: 'unavailable', failureCodes: ['historical-slot-missing'] },
      { item: 2, outcome: 'failed', failureCodes: ['generation-invalid-options'] },
      { item: 3, outcome: 'withheld', candidate: { ...candidate, stem: 'A retained candidate for instructor review.' }, failureCodes: ['quality-withheld'],
        ...(policy === 'grounded-memory-v1' ? { assessment: {
          policy, item: 3, status: 'withheld' as const, sourceSupport: 'unsupported' as const, notation: 'consistent' as const, novelty: 'variant' as const,
          reasons: ['The source does not establish the proposed inference.'], citations: [], matchedEntryIds: [], comparedEntryIds: [],
          evidencePacketId: 'original-packet', memoryDigest: 'original-memory', checkedAt: new Date(now),
          coverage: { evidenceTruncated: false, memoryTruncated: false, shownEntries: 1, totalEntries: 1, missingVersions: 0, consistency: 'best-effort' as const },
        } } : {}) },
    ],
    usage: { summary: { status: 'complete', scope: 'llm-calls', inputTokens: 3000, outputTokens: 500, totalTokens: 3500,
      reasoningTokens: null, cachedInputTokens: null, cacheWriteTokens: null, observedCalls: 3, reportedCalls: 3, callsWithKnownTotal: 3,
      pendingCalls: 0, unknownCalls: 0, coverageGaps: 0, untracked: false, retryVisibility: 'unknown', stages: [], models: [] },
      calls: [{ id: 'first-receipt', stage: 'generating', provider: 'test-provider', requestedModel: 'generator-model', actualModel: 'returned-model',
        requestOptions: { temperature: 0.2 }, outcome: 'succeeded', retryVisibility: 'unknown', startedAt: now, finishedAt: now,
        usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12, reasoningTokens: null, cachedInputTokens: null, cacheWriteTokens: null,
          totalOrigin: 'provider', countSource: 'provider-reported' } }],
      totalCalls: 3, callsTruncated: true },
    limitations: ['Retained records do not reconstruct the starting question bank.'],
  };
}

function inputs(): GenerationEvaluationExport[] {
  return [productionExport('baseline'), productionExport('grounded-memory-v1')];
}

function dataset(): EvaluationDataset {
  return importGenerationExports(manifest(), inputs());
}

function label(entry: ReviewKey['entries'][number], patch: Partial<TeacherLabel> = {}): TeacherLabel {
  return { reviewId: entry.reviewId, reviewHash: entry.reviewHash, sourceScope: null, notation: null, duplication: null,
    difficulty: null, answerQuality: null, disposition: null, reviewMinutes: null, evidenceRefs: [], notes: '', ...patch };
}

describe('production generation export import', () => {
  it('preserves every requested slot and explicit missing, failure, saved and withheld outcomes in both policies', () => {
    const result = dataset();
    expect(result.origin).toBe('recorded');
    expect(result.runs.map(run => run.policy)).toEqual(['baseline', 'grounded-memory-v1']);
    for (const run of result.runs) {
      expect(run.slots.map(slot => [slot.item, slot.outcome])).toEqual([[0, 'saved'], [1, 'missing'], [2, 'failed'], [3, 'withheld']]);
      expect(run.slots[1].candidate).toBeNull();
      expect(run.slots[2].candidate).toBeNull();
      expect(run.slots[1].limitations).toContain('historical-slot-missing');
      expect(run.slots[3].candidate?.content.stem).toBe('A retained candidate for instructor review.');
      expect(run.elapsedMs).toBe(2500);
    }
    expect(result.runs[0].slots[3].automatic).toEqual({ sourceScope: null, notation: null, duplication: null, gate: null });
    expect(result.runs[1].slots[3].automatic).toEqual({ sourceScope: 'fail', notation: 'pass', duplication: 'fail', gate: 'withheld' });
  });

  it('binds the copied question exactly without presenting an original unbounded hash as the copy hash', () => {
    const exports = inputs(); const before = JSON.stringify(exports);
    exports[0].slots[0].candidate!.truncated = true;
    const result = importGenerationExports(manifest(), exports);
    const copied = result.runs[0].slots[0].candidate!;
    expect(copied.content).toEqual(question());
    expect(copied.contentHash).toBe(hashValue(copied.content));
    expect(copied.contentHash).not.toBe(exports[0].slots[0].candidate!.contentHash);
    expect(copied.truncated).toBe(true);
    exports[0].slots[0].candidate!.truncated = false;
    expect(JSON.stringify(exports)).toBe(before);
  });

  it('always marks production imports retrospective with unknown isolation and execution controls', () => {
    const exports = inputs();
    Object.assign(exports[0], { comparison: { contextTiming: 'before-generation', isolated: true, controlsHash: hashValue('claimed controls') } });
    Object.assign(exports[0].run, { contextTiming: 'before-generation', isolated: true, controlsHash: hashValue('claimed controls'), modelSettingsVerified: true });
    const result = importGenerationExports(manifest(), exports);
    for (const run of result.runs) {
      expect(run.comparison).toEqual({ contextTiming: 'retrospective', isolated: null, controlsHash: null });
      expect(run.contextHash).toBe(hashValue(result.cases[0].context));
      expect(run.limitations.join(' ')).toContain('supplied after execution');
    }
    expect(JSON.stringify(result)).not.toContain('before-generation');
    expect(JSON.stringify(result)).not.toContain('modelSettingsVerified');
    expect(result.limitations.join(' ')).toContain('not a controlled baseline-versus-pilot effect estimate');
  });

  it('uses full run summary counters even when individual call rows are truncated', () => {
    const result = dataset();
    expect(result.runs[0].usage).toEqual({ status: 'complete', inputTokens: 3000, outputTokens: 500, totalTokens: 3500,
      observedCalls: 3, pendingCalls: 0, unknownCalls: 0, coverageGaps: 0, untracked: false });
    expect(result.runs[0].limitations.join(' ')).toContain('Individual-call export is truncated');
  });

  it('preserves unavailable usage and historical numeric proof without inferring proof from conceptual content', () => {
    const exports = inputs();
    Object.assign(exports[0].usage.summary, { status: 'unavailable', inputTokens: null, outputTokens: null, totalTokens: null,
      observedCalls: 0, reportedCalls: 0, callsWithKnownTotal: 0, coverageGaps: 1, untracked: true });
    exports[0].usage.calls = []; exports[0].usage.totalCalls = 0;
    const result = importGenerationExports(manifest(), exports);
    expect(result.runs[0].usage).toMatchObject({ status: 'unavailable', inputTokens: null, outputTokens: null, totalTokens: null, untracked: true });
    expect(result.runs[0].slots.map(slot => slot.numerical)).toEqual(['verified', 'unknown', 'unknown', 'unknown']);
  });

  it('projects safe fields without carrying arbitrary actor, prompt, receipt, source or provider metadata', () => {
    const exports = inputs();
    Object.assign(exports[0], { actor: { puid: 'UNSAFE-ACTOR' }, providerResponse: 'UNSAFE-BODY', sourcePreview: 'UNSAFE-PREVIEW' });
    Object.assign(exports[0].run, { modelPrompt: 'UNSAFE-PROMPT' });
    Object.assign(exports[0].slots[0].candidate!, { sourceRefs: ['UNSAFE-SOURCE'], rawPrompt: 'UNSAFE-CANDIDATE-PROMPT' });
    Object.assign(exports[0].usage.calls[0], { actor: { puid: 'UNSAFE-CALL-ACTOR' }, response: 'UNSAFE-RESPONSE' });
    exports[0].slots[0].recordedSourceRefs = [{ materialId: 'UNSAFE-MATERIAL', chunk: 'UNSAFE-EXCERPT' }];
    exports[0].slots[0].recordedSourceRefsTruncated = true;
    const result = importGenerationExports(manifest(), exports);
    expect(JSON.stringify(result)).not.toContain('UNSAFE-');
    expect(result.runs[0].slots[0].limitations).toContain('Recorded source excerpts were truncated.');
    expect(result.cases[0].context.sources[0].text).toBe(manifest().cases[0].context.sources[0].text);
  });

  it.each(['missing', 'duplicate', 'out-of-range'] as const)('rejects %s slot identity instead of filling positions', condition => {
    const exports = inputs();
    if (condition === 'missing') exports[0].slots.pop();
    if (condition === 'duplicate') exports[0].slots[3].item = 0;
    if (condition === 'out-of-range') exports[0].slots[3].item = 4;
    expect(() => importGenerationExports(manifest(), exports)).toThrow();
  });

  it.each(['count', 'type', 'difficulty', 'prompt'] as const)('rejects a %s mismatch between the production request and the supplied case', field => {
    const exports = inputs();
    if (field === 'count') exports[0].run.requestedSlots = 3;
    if (field === 'type') exports[0].run.type = 'true-false';
    if (field === 'difficulty') exports[0].run.difficulty = 'hard';
    if (field === 'prompt') exports[0].run.prompt = 'A different instruction';
    expect(() => importGenerationExports(manifest(), exports)).toThrow('Export request differs');
  });

  it('accepts absent difficulty and prompt only when the supplied request records mixed and empty values', () => {
    const exports = inputs(); const mapping = manifest();
    mapping.cases[0].context.request.difficulty = 'mixed'; mapping.cases[0].context.request.instruction = '';
    exports.forEach(observed => { delete observed.run.difficulty; delete observed.run.prompt; });
    expect(() => importGenerationExports(mapping, exports)).not.toThrow();
  });

  it('requires one export per mapping, known cases and a unique policy arm for every case repetition', () => {
    expect(() => importGenerationExports(manifest(), inputs().slice(0, 1))).toThrow('exactly one export');
    const mapping = manifest(); mapping.runs[0].caseId = 'unknown';
    expect(() => importGenerationExports(mapping, inputs())).toThrow('unknown case');
    const exports = inputs(); exports[1].run.policy = 'baseline';
    expect(() => importGenerationExports(manifest(), exports)).toThrow();
  });

  it('rejects unsafe nested question properties and active or non-generation export formats', () => {
    const exports = inputs();
    Object.assign(exports[0].slots[0].candidate!.options[0], { rawProviderBody: 'UNSAFE-OPTION-METADATA' });
    expect(() => importGenerationExports(manifest(), exports)).toThrow();
    const active = inputs(); Object.assign(active[0].run, { status: 'running' });
    expect(() => importGenerationExports(manifest(), active)).toThrow();
    const other = inputs(); Object.assign(other[0], { schemaVersion: 'material-export-v1' });
    expect(() => importGenerationExports(manifest(), other)).toThrow();
  });
});

describe('teacher review import integrity', () => {
  it('links manual labels to exact run/slot identities and preserves triage, fractional time and notes', () => {
    const input = dataset(); const blind = createBlindReview(input);
    const saved = blind.key.entries.find(entry => entry.runId === 'baseline-run' && entry.item === 0)!;
    const missing = blind.key.entries.find(entry => entry.runId === 'baseline-run' && entry.item === 1)!;
    const manual = label(saved, { sourceScope: 'absent', notation: 'uncertain', disposition: 'edited', reviewMinutes: 2.25,
      evidenceRefs: ['S1', 'Q1'], notes: 'Teacher checked the lecture notation and edited the explanation.' });
    const triage = label(missing, { disposition: 'source-shortfall', reviewMinutes: 0.5, notes: 'No original candidate was retained.' });
    const imported = importTeacherReviews(input, blind.key, { ...blind.reviews, reviewerId: 'teacher-a', labels: [manual, triage] });
    expect(imported).toEqual([{ runId: 'baseline-run', item: 0, label: manual }, { runId: 'baseline-run', item: 1, label: triage }]);
    expect(imported).toHaveLength(2);
  });

  it.each(['dataset-hash', 'context', 'candidate', 'key-card-hash', 'label-hash'] as const)('rejects stale %s binding', condition => {
    const input = dataset(); const blind = createBlindReview(input); const entry = blind.key.entries[0];
    const manual = label(entry, { disposition: 'accepted' });
    if (condition === 'dataset-hash') blind.key.datasetHash = hashValue('different dataset');
    if (condition === 'context') {
      input.cases[0].context.sources[0].text += ' Changed source meaning.';
      input.runs.forEach(run => { run.contextHash = hashValue(input.cases[0].context); });
      blind.key.datasetHash = hashValue(input);
    }
    if (condition === 'candidate') {
      const candidate = input.runs[0].slots[0].candidate!; candidate.content.stem += ' Changed task.';
      candidate.contentHash = hashValue(candidate.content); blind.key.datasetHash = hashValue(input);
    }
    if (condition === 'key-card-hash') entry.reviewHash = hashValue('stale card');
    if (condition === 'label-hash') manual.reviewHash = hashValue('stale label');
    expect(() => importTeacherReviews(input, blind.key, { ...blind.reviews, reviewerId: 'teacher-a', labels: [manual] })).toThrow();
  });

  it.each(['unknown-review', 'duplicate-label', 'missing-key-slot', 'duplicate-key-id', 'duplicate-key-slot', 'unknown-key-run', 'wrong-set'] as const)('rejects %s integrity errors', condition => {
    const input = dataset(); const blind = createBlindReview(input); const manual = label(blind.key.entries[0]);
    const reviews = { ...blind.reviews, reviewerId: 'teacher-a', labels: [manual] };
    if (condition === 'unknown-review') manual.reviewId = 'unknown-review';
    if (condition === 'duplicate-label') reviews.labels.push({ ...manual });
    if (condition === 'missing-key-slot') blind.key.entries.pop();
    if (condition === 'duplicate-key-id') blind.key.entries[1].reviewId = blind.key.entries[0].reviewId;
    if (condition === 'duplicate-key-slot') { blind.key.entries[1].runId = blind.key.entries[0].runId; blind.key.entries[1].item = blind.key.entries[0].item; }
    if (condition === 'unknown-key-run') blind.key.entries[0].runId = 'unknown-run';
    if (condition === 'wrong-set') reviews.reviewSetId = 'other-review-set';
    expect(() => importTeacherReviews(input, blind.key, reviews)).toThrow();
  });

  it.each(['missing', 'truncated', 'context-mismatch', 'context-unrecorded'] as const)('allows only triage for %s candidate evidence', condition => {
    const input = dataset(); const run = input.runs[0]; const slot = run.slots[0];
    if (condition === 'missing') slot.candidate = null;
    if (condition === 'truncated') slot.candidate!.truncated = true;
    if (condition === 'context-mismatch') run.contextHash = hashValue('different context');
    if (condition === 'context-unrecorded') run.contextHash = null;
    const blind = createBlindReview(input); const entry = blind.key.entries.find(row => row.runId === run.runId && row.item === slot.item)!;
    for (const patch of [{ sourceScope: 'absent' as const }, { notation: 'uncertain' as const }, { disposition: 'accepted' as const }, { disposition: 'intentional-variant' as const }]) {
      expect(() => importTeacherReviews(input, blind.key, { ...blind.reviews, reviewerId: 'teacher-a', labels: [label(entry, patch)] })).toThrow('triage');
    }
    const triage = label(entry, { disposition: 'unresolved', reviewMinutes: 1.5, notes: 'Snapshot cannot support a quality judgment.' });
    expect(importTeacherReviews(input, blind.key, { ...blind.reviews, reviewerId: 'teacher-a', labels: [triage] })[0].label).toEqual(triage);
  });

  it.each(['unassigned', ' unassigned ', '   '])('rejects completed judgments with an unassigned or blank reviewer identity (%j)', reviewerId => {
    const input = dataset(); const blind = createBlindReview(input);
    expect(() => importTeacherReviews(input, blind.key, { ...blind.reviews, reviewerId,
      labels: [label(blind.key.entries[0], { disposition: 'accepted' })] })).toThrow();
  });

  it('allows unassigned empty reviews without turning blank labels into decisions', () => {
    const input = dataset(); const blind = createBlindReview(input);
    expect(importTeacherReviews(input, blind.key, blind.reviews)).toEqual([]);
    expect(importTeacherReviews(input, blind.key, { ...blind.reviews, labels: [label(blind.key.entries[0])] })[0].label.disposition).toBeNull();
  });

  it.each(['unknown-source', 'original-source-id', 'original-bank-id', 'B2', 'B4'])('rejects absent or private evidence reference %s', reference => {
    const input = dataset(); const blind = createBlindReview(input);
    const entry = blind.key.entries.find(row => row.runId === 'baseline-run' && row.item === 3)!;
    expect(() => importTeacherReviews(input, blind.key, { ...blind.reviews, reviewerId: 'teacher-a',
      labels: [label(entry, { evidenceRefs: [reference], notes: 'A claimed comparison.' })] })).toThrow('evidence reference');
  });

  it('accepts source, bank and complete earlier-candidate aliases actually shown on the card', () => {
    const input = dataset(); const blind = createBlindReview(input);
    const entry = blind.key.entries.find(row => row.runId === 'baseline-run' && row.item === 3)!;
    const manual = label(entry, { duplication: 'present', evidenceRefs: ['S1', 'Q1', 'B1'], notes: 'Same learning task as the earlier candidate.' });
    expect(importTeacherReviews(input, blind.key, { ...blind.reviews, reviewerId: 'teacher-a', labels: [manual] })[0].label).toEqual(manual);
  });

  it('rejects a modified candidate copy whose integrity hash was not updated', () => {
    const input = dataset(); const blind = createBlindReview(input);
    input.runs[0].slots[0].candidate!.content.options[0].text = 'A different answer';
    blind.key.datasetHash = hashValue(input);
    expect(() => importTeacherReviews(input, blind.key, blind.reviews)).toThrow();
  });
});
