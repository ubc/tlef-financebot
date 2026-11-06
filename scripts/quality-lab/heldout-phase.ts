import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { comparisonPreflight } from './preflight';
import { assertLedgerIntegrity } from './phase-declaration';
import type { ConservativeLedger, LedgerLimits } from './ledger';
import { hashControl, sha256, validateFixture, type FrozenFixture, type ScheduledCell } from './protocol';

export const HELDOUT_PHASE_SCOPE = 'quality-lab-2026-10-16-heldout-phase-three';
export const HELDOUT_PHASE_LIMITS: LedgerLimits = { maxSends: 360, maxConservativeTokens: 4_000_000, maxInputTokens: 24000 };
export function assertHeldoutCli(argv: string[], values: string[], flags: string[] = []): void {
  const seen = new Set<string>();
  for (let index = 2; index < argv.length; index++) {
    const name = argv[index]!;
    if (seen.has(name) || !values.includes(name) && !flags.includes(name)) throw new Error(`quality-lab-heldout-unknown-or-duplicate-option:${name}`);
    seen.add(name);
    if (flags.includes(name)) continue;
    if (!argv[index + 1] || argv[index + 1]!.startsWith('--')) throw new Error(`quality-lab-heldout-option-value-required:${name}`);
    index++;
  }
}
export interface HeldoutPhaseDeclaration {
  version: 1; phase: 'heldout-question-comparison'; createdAt: string; scope: typeof HELDOUT_PHASE_SCOPE;
  ledger: string; limits: LedgerLimits; generatorOutputCap: 8000; judgeOutputCap: 6000;
  fixedJudge: { model: 'gpt-6.1-sol'; reasoningEffort: 'medium' }; repetitions: 2; shardCount: 6; shardSize: 10; repairCandidates: 0;
  fixture: { path: string; sha256: string; controlSha256: string }; scheduleSha256: string;
  priorLedgers: Array<{ phase: 'phase-one' | 'phase-two'; path: string; sha256: string; scope: string; immutable: true }>;
  completionPolicy: 'pragmatic-hard-stop-not-a-completion-guarantee'; purpose: string;
}
export interface HeldoutShard {
  index: number; id: string; cells: ScheduledCell[]; cellIds: string[]; scheduleSha256: string;
  generatorFirstSendConservativeTokens: number; maximumObservedSends: number; maximumConservativeTokensWithinPerSendCaps: number;
}
export function planHeldoutComparison(fixture: FrozenFixture) {
  validateFixture(fixture);
  if (fixture.cases.length !== 6 || fixture.cases.some(item => item.split !== 'held-out')) throw new Error('quality-lab-heldout-six-cases-required');
  const boundary = (fixture as FrozenFixture & { heldoutBoundary?: { cases: Array<{ id: string; safetyNegative: boolean }> } }).heldoutBoundary?.cases;
  if (!boundary || boundary.length !== 6 || new Set(boundary.map(row => row.id)).size !== 6 || boundary.filter(row => row.safetyNegative).length !== 1 ||
      boundary.some(row => !fixture.cases.some(item => item.id === row.id))) throw new Error('quality-lab-heldout-safety-denominators-required');
  const full = comparisonPreflight(fixture, 2, HELDOUT_PHASE_LIMITS, 8000, 6000);
  if (full.schedule.length !== 60) throw new Error('quality-lab-heldout-sixty-cells-required');
  const correction = '\n\nYour previous reply was not valid JSON. Respond with ONLY the JSON value — no prose, no explanation, no code fences.';
  const envelope = (prompt: string) => Buffer.byteLength(JSON.stringify([{ role: 'user', content: prompt }]), 'utf8') + 32;
  const shards: HeldoutShard[] = Array.from({ length: 6 }, (_, index) => {
    const cells = full.schedule.slice(index * 10, (index + 1) * 10);
    const generator = cells.reduce((sum, cell) => sum + full.rows.find(row => row.id === cell.id)!.firstSendConservativeTokens, 0);
    const correctedGenerator = cells.reduce((sum, cell) => sum + envelope(fixture.cases.find(item => item.id === cell.caseId)!.generatorPrompt + correction) + 8000, 0);
    // One generator completion (up to2 JSON sends), then up to2 same-candidate
    // judge completions (up to2 JSON sends each). No semantic repair is run.
    const maximum = generator + correctedGenerator + cells.length * 4 * (24000 + 6000);
    if (maximum >= 2_000_000) throw new Error('quality-lab-heldout-shard-exceeds-native-default');
    return { index, id: `shard-${index + 1}`, cells, cellIds: cells.map(cell => cell.id), scheduleSha256: hashControl(cells),
      generatorFirstSendConservativeTokens: generator, maximumObservedSends: cells.length * 6, maximumConservativeTokensWithinPerSendCaps: maximum };
  });
  return { version: 1 as const, fixtureSha256: fixture.fixtureSha256, scheduleSha256: full.scheduleSha256, schedule: full.schedule, shards,
    requestedSlots: 60, positiveSupplySlots: 50, safetyNegativeSlots: 10, safetyNegativeCaseIds: boundary.filter(row => row.safetyNegative).map(row => row.id),
    plannedBaseStages: 120, conditionalMaximumObservedSends: 360,
    maximumConservativeTokensWithinPerSendCaps: shards.reduce((sum, shard) => sum + shard.maximumConservativeTokensWithinPerSendCaps, 0),
    generatorFirstSendConservativeTokens: shards.reduce((sum, shard) => sum + shard.generatorFirstSendConservativeTokens, 0),
    limits: HELDOUT_PHASE_LIMITS, generatorOutputCap: 8000, judgeOutputCap: 6000,
    executionOrder: 'Six contiguous10-cell shards preserve nominal global cell positions and rotated arm order. Each shard generates its10 initial candidates before judging its parsed candidates; later-shard generation therefore follows earlier-shard judgment. No content repairs or parallel model calls are introduced.',
    completionPolicy: 'The4m conservative allowance is a pragmatic hard stop, not a guarantee that all permitted JSON/citation correction paths can finish.',
    teacherAcceptance: null, saved: 0, adopted: 0 };
}
export type HeldoutPlan = ReturnType<typeof planHeldoutComparison>;

export function validateHeldoutDeclaration(value: HeldoutPhaseDeclaration): void {
  const digest = (text: string) => /^[a-f0-9]{64}$/.test(text);
  if (value.version !== 1 || value.phase !== 'heldout-question-comparison' || value.scope !== HELDOUT_PHASE_SCOPE ||
      hashControl(value.limits) !== hashControl(HELDOUT_PHASE_LIMITS) || !path.isAbsolute(value.ledger) ||
      value.generatorOutputCap !== 8000 || value.judgeOutputCap !== 6000 || value.fixedJudge.model !== 'gpt-6.1-sol' || value.fixedJudge.reasoningEffort !== 'medium' ||
      value.repetitions !== 2 || value.shardCount !== 6 || value.shardSize !== 10 || value.repairCandidates !== 0 ||
      !path.isAbsolute(value.fixture.path) || !digest(value.fixture.sha256) || !digest(value.fixture.controlSha256) || !digest(value.scheduleSha256) ||
      value.completionPolicy !== 'pragmatic-hard-stop-not-a-completion-guarantee' || !value.purpose.trim() ||
      value.priorLedgers.length !== 2 || new Set(value.priorLedgers.map(row => row.phase)).size !== 2 ||
      value.priorLedgers.some(row => !['phase-one', 'phase-two'].includes(row.phase) || !path.isAbsolute(row.path) || !digest(row.sha256) || !row.scope.trim() || row.scope === value.scope || row.immutable !== true) ||
      new Set([value.ledger, value.fixture.path, ...value.priorLedgers.map(row => row.path)]).size !== 4 ||
      new Set(value.priorLedgers.map(row => row.scope)).size !== 2) throw new Error('quality-lab-heldout-declaration-invalid');
}
export function emptyHeldoutLedger(declaration: HeldoutPhaseDeclaration, digest: string): ConservativeLedger & { phaseDeclarationSha256: string } {
  validateHeldoutDeclaration(declaration);
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('quality-lab-heldout-declaration-digest-invalid');
  return { version: 1, createdAt: declaration.createdAt, scope: declaration.scope, limits: declaration.limits,
    accounting: 'conservative-reservations-v1', phaseDeclarationSha256: digest, reservedSends: 0, conservativeTokens: 0, reservations: [] };
}
export async function readHeldoutPhase(file: string, digest: string, allowMissingLedger = false) {
  const raw = await readFile(file, 'utf8');
  if (!/^[a-f0-9]{64}$/.test(digest) || sha256(raw) !== digest) throw new Error('quality-lab-heldout-declaration-changed');
  const declaration = JSON.parse(raw) as HeldoutPhaseDeclaration; validateHeldoutDeclaration(declaration);
  const fixtureRaw = await readFile(declaration.fixture.path, 'utf8');
  if (sha256(fixtureRaw) !== declaration.fixture.sha256) throw new Error('quality-lab-heldout-fixture-changed');
  const fixture = JSON.parse(fixtureRaw) as FrozenFixture; const plan = planHeldoutComparison(fixture);
  if (fixture.fixtureSha256 !== declaration.fixture.controlSha256 || plan.scheduleSha256 !== declaration.scheduleSha256) throw new Error('quality-lab-heldout-control-mismatch');
  for (const prior of declaration.priorLedgers) {
    const bytes = await readFile(prior.path, 'utf8');
    if (sha256(bytes) !== prior.sha256) throw new Error('quality-lab-heldout-prior-ledger-changed');
    const receipt = JSON.parse(bytes) as ConservativeLedger; assertLedgerIntegrity(receipt);
    if (receipt.scope !== prior.scope) throw new Error('quality-lab-heldout-prior-ledger-mismatch');
  }
  let ledger: ConservativeLedger; let ledgerExists = true;
  try { ledger = JSON.parse(await readFile(declaration.ledger, 'utf8')) as ConservativeLedger; }
  catch (error) { if (!allowMissingLedger || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; ledger = emptyHeldoutLedger(declaration, digest); ledgerExists = false; }
  assertLedgerIntegrity(ledger);
  if (ledger.scope !== declaration.scope || hashControl(ledger.limits) !== hashControl(declaration.limits) ||
      (ledger as { phaseDeclarationSha256?: string }).phaseDeclarationSha256 !== digest) throw new Error('quality-lab-heldout-ledger-mismatch');
  return { declaration, digest, file: path.resolve(file), fixture, plan, ledger, ledgerExists };
}

export interface HeldoutShardReceipt {
  status: string; fixtureSha256: string; scheduleSha256: string; requestedSlots: number;
  code?: Array<{ file: string; sha256: string }>;
  heldoutPhase: { declarationSha256: string; globalScheduleSha256: string; requestedPhaseSlots: number; shardIndex: number };
  cells: Array<{ schedule: ScheduledCell; inputControlsSha256: string; generatorPromptSha256: string; status: string;
    originalCandidate: unknown; normalizedCandidate: unknown; eligibleBeforeRepair: boolean | null; teacherAcceptance: null; saved: false; adopted: false; [key: string]: unknown }>;
}
/** Missing whole shards remain explicit; an executed receipt may never omit,
 * duplicate, relabel or import a foreign cell. Neither endpoint implies saves. */
export function aggregateHeldoutResults(plan: HeldoutPlan, fixture: FrozenFixture, digest: string,
  receipts: HeldoutShardReceipt[], requireAllShards = false, expectedCode?: Array<{ file: string; sha256: string }>) {
  const seen = new Set<string>(); const shards = new Set<number>(); const cells = new Map<string, HeldoutShardReceipt['cells'][number]>();
  for (const receipt of receipts) {
    const shard = plan.shards[receipt.heldoutPhase?.shardIndex];
    if (!shard || shards.has(shard.index) || receipt.heldoutPhase.declarationSha256 !== digest || receipt.heldoutPhase.globalScheduleSha256 !== plan.scheduleSha256 ||
        receipt.heldoutPhase.requestedPhaseSlots !== 60 || receipt.fixtureSha256 !== fixture.fixtureSha256 || receipt.scheduleSha256 !== shard.scheduleSha256 ||
        receipt.requestedSlots !== 10 || receipt.cells.length !== 10 || !['completed', 'stopped'].includes(receipt.status)) throw new Error('quality-lab-heldout-shard-receipt-invalid');
    shards.add(shard.index);
    if (expectedCode && (!receipt.code || receipt.code.length !== expectedCode.length || new Set(receipt.code.map(row => row.file)).size !== expectedCode.length ||
        expectedCode.some(expected => !receipt.code!.some(actual => actual.file === expected.file && actual.sha256 === expected.sha256)))) throw new Error('quality-lab-heldout-shard-code-mismatch');
    for (const [index, cell] of receipt.cells.entries()) {
      const expected = shard.cells[index]; const item = fixture.cases.find(row => row.id === expected.caseId)!;
      if (seen.has(cell.schedule.id) || hashControl(cell.schedule) !== hashControl(expected) ||
          cell.inputControlsSha256 !== item.controlsSha256 || cell.generatorPromptSha256 !== item.generatorPromptSha256 ||
          cell.originalCandidate === undefined || cell.normalizedCandidate === undefined ||
          !(cell.eligibleBeforeRepair === null || typeof cell.eligibleBeforeRepair === 'boolean') ||
          !['pending', 'generated', 'generation-failed', 'invalid-candidate', 'reviewed', 'budget-stopped', 'identity-stopped'].includes(cell.status) ||
          receipt.status === 'completed' && ['pending', 'generated', 'budget-stopped', 'identity-stopped'].includes(cell.status) ||
          cell.teacherAcceptance !== null || cell.saved !== false || cell.adopted !== false) throw new Error('quality-lab-heldout-cell-receipt-invalid');
      seen.add(cell.schedule.id); cells.set(cell.schedule.id, cell);
    }
  }
  if (requireAllShards && shards.size !== 6) throw new Error('quality-lab-heldout-shards-missing');
  const all = plan.schedule.map(schedule => cells.get(schedule.id) ?? { schedule, status: 'not-recorded', originalCandidate: null, normalizedCandidate: null,
    eligibleBeforeRepair: null, teacherAcceptance: null, saved: false, adopted: false });
  return { status: shards.size === 6 && receipts.every(receipt => receipt.status === 'completed') ? 'completed' : 'partial', requestedSlots: 60,
    recordedShardSlots: cells.size, unrecordedSlots: all.filter(cell => cell.status === 'not-recorded').length, terminalShards: shards.size,
    generatedCandidates: all.filter(cell => cell.normalizedCandidate !== null).length,
    labEligibleCandidates: all.filter(cell => cell.eligibleBeforeRepair === true).length, cells: all, teacherAcceptance: null, savedQuestions: 0, adoptedQuestions: 0,
    positiveSupply: { requested: 50, labEligible: all.filter(cell => !plan.safetyNegativeCaseIds.includes(cell.schedule.caseId) && cell.eligibleBeforeRepair === true).length },
    safetyNegative: { requested: 10, labEligible: all.filter(cell => plan.safetyNegativeCaseIds.includes(cell.schedule.caseId) && cell.eligibleBeforeRepair === true).length,
      caveat: 'Withheld/uncertain unsupported exact-value requests are reported separately; safe shortfall is not a positive-supply failure.' },
    limitations: ['Initial lab eligibility is not complete production admission or saved yield. Full public generation, Reviewer/role checks, live source/Bank fences and durable regeneration/adoption remain separate acceptance work.',
      'Fixed Sol/medium assessment shares a family with Sol generators. No second-family assessor or teacher gold label has been supplied.',
      'A missing shard receipt means execution is unconfirmed, not proof of zero provider dispatch. Retained transcripts and the shared ledger remain authoritative for attempted costs.',
      plan.executionOrder, plan.completionPolicy] };
}
