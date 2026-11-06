import { hashControl, scheduleCells, type FrozenFixture, type LabArm, type LabRequest } from './protocol';
import type { LedgerLimits } from './ledger';

export function comparisonPreflight(fixture: FrozenFixture, repetitions: number, limits: LedgerLimits,
  generatorOutputTokens = 8000, judgeOutputTokens = 6000, arms?: readonly LabArm[], questionInputCap = 24000) {
  const schedule = scheduleCells(fixture, repetitions, arms);
  const rows = schedule.map(cell => {
    const item = fixture.cases.find(value => value.id === cell.caseId)!;
    const inputEstimate = Buffer.byteLength(JSON.stringify([{ role: 'user', content: item.generatorPrompt }]), 'utf8') + 32;
    if (inputEstimate > Math.min(limits.maxInputTokens, questionInputCap)) throw new Error(`quality-lab-generator-input-cap:${item.id}`);
    return { ...cell, promptSha256: item.generatorPromptSha256, controlsSha256: item.controlsSha256, inputEstimate,
      generatorOutputTokens, firstSendConservativeTokens: inputEstimate + generatorOutputTokens };
  });
  if (schedule.length * 2 > limits.maxSends) throw new Error('quality-lab-plan-insufficient-send-budget');
  if (rows.reduce((total, row) => total + row.firstSendConservativeTokens, 0) > limits.maxConservativeTokens) throw new Error('quality-lab-plan-insufficient-token-budget');
  return { version: 1 as const, fixtureSha256: fixture.fixtureSha256, schedule, scheduleSha256: hashControl(schedule), rows,
    fixedJudge: { model: 'gpt-6.1-sol', effort: 'medium', maxOutputTokens: judgeOutputTokens },
    limits, questionInputCap, plannedGeneratorCells: schedule.length, plannedOneJudgePerSuccessfulCandidate: schedule.length,
    requestedOutputSlots: schedule.length, teacherAccepted: null,
    caveat: 'Generator prompt bounds are known before dispatch. Candidate-dependent judge/repair prompts are admitted against this same shared ledger before every send; preflight does not guarantee every planned cell can fit.' };
}
export function generatorRequest(item: FrozenFixture['cases'][number], arm: LabArm, maxOutputTokens = 8000): LabRequest {
  return { stage: 'model-comparison-generator', prompt: item.generatorPrompt, model: arm.model, effort: arm.effort,
    maxOutputTokens, maxInputTokens: 24000, allowedActualModels: arm.allowedActualModels, maxSends: 2 };
}
