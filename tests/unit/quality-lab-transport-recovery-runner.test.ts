jest.mock('../../server/src/components/genai/llm', () => { throw new Error('Runner unit checks must not load provider clients.'); });
jest.mock('../../server/src/components/mongodb/collections', () => { throw new Error('Runner unit checks must not load MongoDB.'); });
jest.mock('../../server/src/config/env', () => { throw new Error('Runner unit checks must not load runtime configuration.'); });

import { assertCombinedRecoveryBudget, executeHeldoutRecovery, generationModuleAudit, latchCompletionFailure, parseRecoveryArguments, recoverySummary } from '../../scripts/quality-lab/run-heldout-transport-recovery';
import { hashControl, type JsonCompletion } from '../../scripts/quality-lab/protocol';
import type { ConservativeLedger } from '../../scripts/quality-lab/ledger';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const limits = { maxSends: 160, maxConservativeTokens: 2_000_000, maxInputTokens: 24000 };
const ledger = (scope: string, count: number, units: number, cap = limits): ConservativeLedger => ({ version: 1, scope, createdAt: 'unit-only', accounting: 'conservative-reservations-v1', limits: cap,
  reservedSends: count, conservativeTokens: units, reservations: Array.from({ length: count }, (_, i) => ({ id: String(i), cellId: 'unit', stage: 'unit', jsonAttempt: 0,
    inputSha256: 'unit', inputEstimate: i === 0 ? units : 0, outputReservation: 0, reservedAt: 'unit-only' })) });

it('accepts only explicit offline controls or a complete root-only live invocation', () => {
  expect(parseRecoveryArguments(['--output', '/unit/new'])).toEqual({ '--output': '/unit/new' });
  expect(parseRecoveryArguments(['--origin', '/unit/archive', '--output', '/unit/new'])['--origin']).toBe('/unit/archive');
  expect(parseRecoveryArguments(['--live', 'once', '--output', '/unit/new', '--declaration', '/unit/d.json', '--declaration-sha256', 'a'.repeat(64)])['--live']).toBe('once');
});

it.each(([
  [], ['--output'], ['--output', '--live'], ['--output', 'a', '--output', 'b'], ['--output', 'a', '--save', 'yes'],
  ['--output', 'a', '--declaration', 'd'], ['--output', 'a', '--live', 'yes'], ['--output', 'a', '--live', 'once'],
  ['--output', 'a', '--live', 'once', '--declaration', 'd', '--declaration-sha256', 'invalid'],
  ['--output', 'a', '--live', 'once', '--declaration', 'd', '--declaration-sha256', 'a'.repeat(64), '--origin', 'other'],
]).map(args => ({ args })))('rejects malformed, mixed or duplicate arguments before runtime imports: %j', ({ args }) => {
  expect(() => parseRecoveryArguments(args)).toThrow();
});

it.each(['adapter', 'admission', 'transport'])('rethrows a %s fault even if an assessor swallows it as withheld', async kind => {
  const failure = new Error(kind); const complete: JsonCompletion = () => { throw failure; };
  const latch = latchCompletionFailure(complete);
  const assessment = await latch.complete('frozen prompt').catch(() => ({ status: 'withheld' }));
  expect(assessment).toEqual({ status: 'withheld' }); expect(() => latch.assertSucceeded()).toThrow(failure);
});

it('keeps successful negative model judgments without manufacturing a completion error', async () => {
  const complete: JsonCompletion = async <T>() => ({ novelty: 'variant', sourceSupport: 'uncertain' } as T);
  const latch = latchCompletionFailure(complete); expect(await latch.complete('frozen prompt')).toEqual({ novelty: 'variant', sourceSupport: 'uncertain' });
  expect(() => latch.assertSucceeded()).not.toThrow();
});

it('enforces child and cumulative caps without modifying or settling unknown parent work', () => {
  const parent = ledger('parent', 99, 1_854_981, { maxSends: 360, maxConservativeTokens: 4_000_000, maxInputTokens: 24000 });
  const child = ledger('child', 160, 2_000_000); const before = hashControl(parent);
  expect(() => assertCombinedRecoveryBudget(parent, child, limits)).not.toThrow();
  expect(hashControl(parent)).toBe(before);
  const tighter = { ...parent, limits: { ...parent.limits, maxSends: 258 } };
  expect(() => assertCombinedRecoveryBudget(tighter, child, limits)).toThrow('Combined send');
  const tokens = { ...parent, limits: { ...parent.limits, maxConservativeTokens: 3_854_980 } };
  expect(() => assertCombinedRecoveryBudget(tokens, child, limits)).toThrow('Combined conservative');
  expect(() => assertCombinedRecoveryBudget(parent, { ...child, conservativeTokens: 0 }, limits)).toThrow('ledger-invalid');
});

it('permits only the declared unused generation worker and added binding import differences', () => {
  const old = 'import { buildGenerationSemanticRepairPlan, other } from "./repair";\nconst strict = true;\nexport async function runTrackedGenerationPipelineInner() { return "old"; }';
  const current = old.replace('buildGenerationSemanticRepairPlan,', 'bindPlannedAuthoringTask, buildGenerationSemanticRepairPlan,').replace('return "old"', 'return "new"');
  expect(generationModuleAudit(old, current)).toMatchObject({ statementCount: 3, allOtherStatementsIdentical: true });
  expect(() => generationModuleAudit(old, current.replace('strict = true', 'strict = false'))).toThrow('dependency changed');
  expect(() => generationModuleAudit(old, current + '\nconst hiddenChange = true;')).toThrow();
});

it('overlays only observed gaps while retaining invalid, negative and positive original outcomes', () => {
  type Controls = Parameters<typeof recoverySummary>[0]; type Cell = Parameters<typeof recoverySummary>[1][number];
  const originalCells = Array.from({ length: 60 }, (_, order) => ({ schedule: { id: `cell-${order}`, order }, status: order < 30 ? 'reviewed' : 'generation-failed',
    eligibleBeforeRepair: order < 23, originalCandidate: order < 40 ? { stem: String(order) } : null, saved: false, adopted: false }));
  originalCells[29].status = 'invalid-candidate';
  const controls = { originalCells, proof: { plan: { recoveryCells: originalCells.slice(30).map(row => ({ id: row.schedule.id })) } } } as unknown as Controls;
  const before = hashControl(originalCells), pending = recoverySummary(controls, []);
  expect(pending).toMatchObject({ requested: 60, recoveryScheduled: 30, recoveryUnresolved: 30, retainedSuccessfulGenerations: 40, recordedLabEligible: 23, saved: 0, adopted: 0 });
  const recovered = { id: 'cell-30', status: 'reviewed', eligible: true, normalizedCandidate: { stem: 'same retained candidate' } } as Cell;
  const summary = recoverySummary(controls, [recovered]); expect(summary.recordedLabEligible).toBe(24); expect(summary.recoveryUnresolved).toBe(29);
  expect(summary.cells[29].state).toBe('invalid-candidate'); expect(summary.cells[28].eligible).toBe(false); expect(hashControl(originalCells)).toBe(before);
  expect(() => recoverySummary(controls, [recovered, recovered])).toThrow();
  expect(() => recoverySummary(controls, [{ ...recovered, id: 'cell-0' }])).toThrow();
});

it('rejects an altered declaration before claiming execution, creating live output or loading runtime clients', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'heldout-recovery-guards-'));
  try { const file = path.join(temp, 'declaration.json'); await writeFile(file, '{}');
    await expect(executeHeldoutRecovery(file, 'a'.repeat(64), path.join(temp, 'live'))).rejects.toThrow();
    expect(await readdir(temp)).toEqual(['declaration.json']);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
