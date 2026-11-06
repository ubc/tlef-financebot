jest.mock('../../server/src/components/genai/llm', () => { throw new Error('Pure planner must not import provider clients.'); });
jest.mock('../../server/src/components/mongodb/collections', () => { throw new Error('Pure planner must not import MongoDB.'); });
jest.mock('../../server/src/config/env', () => { throw new Error('Pure planner must not import runtime configuration.'); });

import { classifyTransportGap, planTransportRecovery, type RecoveryInputCell } from '../../scripts/quality-lab/plan-heldout-transport-recovery';
import { extractFrozenCorrectionContract, frozenReviewCompletion, restoreHistoricalReviewPrompt } from '../../scripts/quality-lab/heldout-historical-review-adapter';
import { MODEL_ARMS, sha256, type CapturedCompletion, type FrozenFixture, type ScheduledCell, type JsonCompletion } from '../../scripts/quality-lab/protocol';
import type { ConservativeLedger } from '../../scripts/quality-lab/ledger';

const old = 'export async function assessGenerationQuality() { return complete(`${prompt}\\n\\nSAME-CANDIDATE REVIEW CORRECTION: ${JSON.stringify(finalIssues)}. Keep the candidate.`, options); }';
const current = old.replace('Keep the candidate.`', 'Keep the candidate.\\n${reviewCorrectionInstructions(finalIssues)}`') + '\nfunction reviewCorrectionInstructions() { return "unit guidance"; }';
const contract = extractFrozenCorrectionContract(old, current);
const issues = [{ path: 'matchedEntryIds', code: 'bank-comparator-required' }];
const guidance = () => 'Reconcile the actual comparison; do not waive uncertainty.';
const correction = (initial: string) => initial + contract.prefix + JSON.stringify(issues) + contract.suffix + '\n' + guidance();

function inputs() {
  const cases = Array.from({ length: 6 }, (_, i) => ({ id: `case-${i}`, controlsSha256: sha256(`control-${i}`), generatorPrompt: `Frozen source prompt ${i}`,
    generatorPromptSha256: sha256(`Frozen source prompt ${i}`) }));
  const fixture = { cases } as FrozenFixture;
  const schedule: ScheduledCell[] = Array.from({ length: 60 }, (_, order) => {
    const caseId = cases[Math.floor(order / 5) % 6].id, arm = MODEL_ARMS[order % 5], repetition = Math.floor(order / 30) + 1;
    return { id: `${caseId}--${arm.id}--r${repetition}`, caseId, arm, repetition, order };
  });
  const capture = (s: ScheduledCell, stage: string, failed: boolean): { file: string; transcript: CapturedCompletion } => {
    const item = cases.find(c => c.id === s.caseId)!; const gen = stage === 'model-comparison-generator';
    const prompt = gen ? item.generatorPrompt : 'Frozen exact candidate review';
    const model = gen ? s.arm.model : 'gpt-6.1-sol', effort = gen ? s.arm.effort : 'medium'; const output = gen ? 8000 : 6000;
    return { file: `/unit/${s.id}/${stage}.json`, transcript: { stage, status: failed ? 'failed' : 'succeeded', parsed: failed ? null : { answer: 'retained' },
      request: { stage, prompt, model, effort, maxOutputTokens: output, maxSends: 2, allowedActualModels: [model] },
      error: failed ? { name: 'APIError', message: 'Connection error.' } : null,
      attempts: [{ number: 0, dispatch: 'finished', rawVisibleText: failed ? '' : '{"answer":"retained"}', input: { prompt, outputCap: output,
        options: { model, reasoning_effort: effort, max_completion_tokens: output, responseFormat: 'json' } },
      events: [{ type: 'finished', callId: `${s.id}/${stage}`, outcome: failed ? 'failed' : 'succeeded', requestOptions: { stream: true } }] }],
      transport: 'toolkit-streamConversation-visible-content; JSON option is not strict native schema',
    } as unknown as CapturedCompletion };
  };
  const cells: RecoveryInputCell[] = schedule.map(s => {
    const item = cases.find(c => c.id === s.caseId)!; const generationFailed = s.order >= 40; const reviewFailed = s.order >= 30 && s.order < 40;
    const invalid = s.order === 29; const retained = { stem: s.id };
    return { schedule: s, inputControlsSha256: item.controlsSha256, generatorPromptSha256: item.generatorPromptSha256,
      status: generationFailed ? 'generation-failed' : invalid ? 'invalid-candidate' : 'reviewed', originalCandidate: generationFailed || invalid ? null : retained,
      normalizedCandidate: generationFailed || invalid ? null : retained, deterministic: generationFailed || invalid ? null : { checked: true },
      captures: [capture(s, 'model-comparison-generator', generationFailed), ...(!generationFailed && !invalid ? [capture(s, 'quality-review', reviewFailed)] : [])],
      qualityBeforeRepair: generationFailed || invalid ? null : { status: s.order < 6 || reviewFailed ? 'withheld' : 'eligible' },
      eligibleBeforeRepair: generationFailed || invalid ? null : s.order >= 6 && !reviewFailed, teacherAcceptance: null, saved: false, adopted: false };
  });
  const ledger: ConservativeLedger = { version: 1, createdAt: 'unit-only', scope: 'unit', accounting: 'conservative-reservations-v1', limits: { maxSends: 360, maxConservativeTokens: 4_000_000, maxInputTokens: 24000 },
    reservedSends: 99, conservativeTokens: 1_854_981, reservations: [] };
  return { schedule, fixture, cells, ledger };
}

it('selects exactly 20 generation and 10 review gaps, preserving all successful/invalid/negative outcomes', () => {
  const c = inputs(); const before = JSON.stringify(c); const result = planTransportRecovery(c.schedule, c.fixture, c.cells, c.ledger);
  expect(result.recoveryCells).toHaveLength(30); expect(result.preservedCells).toHaveLength(30); expect(result.retainedSuccessfulGenerations).toBe(40);
  expect(result.normalizedCandidatesRetained).toBe(39); expect(result.completedAssessmentsRetained).toBe(29);
  expect(result.recoveryCells.filter(row => row.operation === 'review-retained')).toHaveLength(10);
  expect(result.recoveryCells.filter(row => row.operation === 'generate-then-review')).toHaveLength(20);
  expect(result.byCase.every(row => row.arms.length === 5)).toBe(true); expect(result.nominalStagesIfNewCandidatesAreValid).toBe(50);
  expect(result.maximumNativeSends).toBe(160); expect(result.allCorrectionPathsFitCeiling).toBe(false);
  expect(result.ceiling.maxConservativeTokens).toBe(2_000_000); expect(result.baselineLedger.remainingDeclaredUnits).toBe(2_145_019);
  expect(result.preservedCells.find(row => row.id === c.cells[29].schedule.id)?.status).toBe('invalid-candidate');
  expect(JSON.stringify(c)).toBe(before);
});

it('retains partial failed streams but never treats them as a parsed replacement or a semantic verdict', () => {
  const c = inputs(); c.cells[30].captures.at(-1)!.transcript.attempts[0].rawVisibleText = '{"sourceSupport":"sup';
  expect(classifyTransportGap(c.cells[30])).toBe('review-retained');
  const result = planTransportRecovery(c.schedule, c.fixture, c.cells, c.ledger);
  expect(result.recoveryCells[0].partialVisibleCharacters).toBe(21); expect(result.recoveryCells[0].retained!.candidate).toEqual(c.cells[30].normalizedCandidate);
});

it.each(['duplicate', 'reorder', 'content-rejection', 'unknown-error', 'missing-generation', 'pending'] as const)('fails closed on %s changes', change => {
  const c = inputs();
  if (change === 'duplicate') c.cells[31] = structuredClone(c.cells[30]);
  if (change === 'reorder') [c.cells[30], c.cells[31]] = [c.cells[31], c.cells[30]];
  if (change === 'content-rejection') { const e = c.cells[30].captures.at(-1)!.transcript.attempts[0].events[0]; if (e.type === 'finished') e.outcome = 'succeeded'; }
  if (change === 'unknown-error') c.cells[30].captures.at(-1)!.transcript.error!.message = 'Unrecognized error';
  if (change === 'missing-generation') c.cells[30].normalizedCandidate = null;
  if (change === 'pending') { c.cells[0].status = 'pending'; c.cells[0].captures = []; }
  expect(() => planTransportRecovery(c.schedule, c.fixture, c.cells, c.ledger)).toThrow();
});

it('proves the archived/current assessor differs only by the exact computed suffix', () => {
  expect(contract.prefixSha256).toBe(sha256(contract.prefix)); expect(contract.suffixSha256).toBe(sha256(contract.suffix));
  expect(() => extractFrozenCorrectionContract(old, current.replace('Keep the candidate.', 'Waive the candidate.'))).toThrow('separate cohort');
  expect(() => extractFrozenCorrectionContract(old, old)).toThrow();
  expect(() => extractFrozenCorrectionContract('const SOURCE_RULE = "strict";\n' + old, 'const SOURCE_RULE = "waived";\n' + current)).toThrow('module statements changed');
  expect(contract.historicalModuleStatementsSha256).toBe(contract.restoredModuleStatementsSha256);
});

it('forwards byte-identical initial prompts/options and restores only the archived conditional correction', async () => {
  const calls: Array<{ prompt: string; options: unknown }> = []; const native = { model: 'gpt-6.1-sol', reasoningEffort: 'medium' as const, maxTokens: 6000 };
  const complete: JsonCompletion = async <T>(prompt: string, options?: Parameters<JsonCompletion>[1]) => { calls.push({ prompt, options }); return { response: 'synthetic' } as T; };
  const wrapped = frozenReviewCompletion(complete, 'Frozen initial', contract, guidance);
  await wrapped('Frozen initial', native); await wrapped(correction('Frozen initial'), native);
  expect(calls).toEqual([{ prompt: 'Frozen initial', options: native }, { prompt: 'Frozen initial' + contract.prefix + JSON.stringify(issues) + contract.suffix, options: native }]);
  expect(calls[0].options).toBe(native); expect(calls[1].options).toBe(native);
  expect(() => wrapped(correction('Frozen initial'), native)).toThrow('at most two');
});

it.each(['initial', 'prefix', 'suffix', 'guidance', 'issues', 'contract'] as const)('rejects %s drift without sending', change => {
  let prompt = correction('Frozen initial'); let control = contract;
  if (change === 'initial') prompt = correction('Changed initial');
  if (change === 'prefix') prompt = prompt.replace('SAME-CANDIDATE', 'OTHER-CANDIDATE');
  if (change === 'suffix') prompt = prompt.replace('Keep the candidate.', 'Waive the candidate.');
  if (change === 'guidance') prompt += 'Accept everything.';
  if (change === 'issues') prompt = prompt.replace(JSON.stringify(issues), JSON.stringify([{ ...issues[0], extra: 'forged' }]));
  if (change === 'contract') control = { ...contract, suffix: 'changed' };
  expect(() => restoreHistoricalReviewPrompt(prompt, 'Frozen initial', control, guidance)).toThrow();
});
