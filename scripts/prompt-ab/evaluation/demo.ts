import type { SyntheticQualityFixtureSet } from '../quality-fixture-schema';
import { DatasetSchema, hashValue } from './schema';
import type { EvaluationDataset, EvaluationQuestion, EvaluationRun } from './schema';

/** A walkthrough fixture, never an observed generation or teacher judgment.
 * Identical final candidates in both arms avoid inventing an improvement. */
export function createDemoDataset(fixtures: SyntheticQualityFixtureSet): EvaluationDataset {
  const selected = fixtures.cases.filter(fixture => fixture.request.independentSlots > 0).slice(0, 3);
  const question = (content: typeof selected[number]['candidates'][number]['content']): EvaluationQuestion => ({
    type: content.type, stem: content.stem, options: content.options.map(option => ({
      ...option, role: option.role === 'correct' ? 'correct' : 'common-misconception',
      explanation: option.role === 'correct' ? content.correctExplanation : '',
    })),
  });
  const cases = selected.map(fixture => ({ caseId: fixture.caseId, repetitions: 1, context: {
    objective: fixture.objectiveText,
    request: { type: fixture.request.type, difficulty: fixture.request.difficulty, count: fixture.request.independentSlots, instruction: fixture.request.teacherInstruction ?? '' },
    sources: fixture.materials.filter(source => fixture.allowedMaterialIds.includes(source.sourceId)).flatMap(source => source.passages.map(passage => ({ id: passage.passageId, role: 'primary' as const, text: passage.text }))),
    bank: [...fixture.bankSnapshot, ...fixture.batchSnapshot].map(item => ({ id: item.questionId, content: question(item.content) })),
    coverage: { sourcesComplete: true, bankComplete: true, notes: ['Complete only within this authored synthetic example.'] },
  } }));
  const runs: EvaluationRun[] = cases.flatMap((item, index) => (['baseline', 'grounded-memory-v1'] as const).map(policy => ({
    runId: `synthetic-${index}-${policy}`, caseId: item.caseId, repetition: 1, policy, contextHash: hashValue(item.context),
    comparison: { contextTiming: 'synthetic', isolated: true, controlsHash: hashValue({ demonstrationOnly: true, noModelCalled: true }) },
    requestedSlots: item.context.request.count,
    slots: Array.from({ length: item.context.request.count }, (_, slot) => {
      const original = selected[index].candidates[slot];
      const content = original ? question(original.content) : undefined;
      return { item: slot, outcome: content ? 'saved' : 'missing',
        candidate: content ? { content, contentHash: hashValue(content), truncated: false } : null,
        automatic: { sourceScope: null, notation: null, duplication: null, gate: null },
        numerical: 'unknown', limitations: ['Authored demonstration; no model produced or checked this output.'] };
    }),
    usage: { status: 'unavailable', inputTokens: null, outputTokens: null, totalTokens: null, observedCalls: 0, unknownCalls: 0, pendingCalls: 0, coverageGaps: 1, untracked: true },
    elapsedMs: null, limitations: ['No generation was executed. Both arms deliberately reuse identical authored candidates.'],
  })));
  return DatasetSchema.parse({ schemaVersion: 'financebot-quality-evaluation-v1', experimentId: 'synthetic-walkthrough', origin: 'synthetic', rubricVersion: 'financebot-teacher-v1', cases, runs,
    limitations: ['This demonstrates review and reporting only. It is not a quality experiment, teacher judgment, or cost measurement.'] });
}
