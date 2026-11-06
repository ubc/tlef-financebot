import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { hashControl, sha256 } from './protocol';
import type { ConservativeLedger, LedgerLimits } from './ledger';

export const OUTLINE_PHASE_TWO_LIMITS: LedgerLimits = { maxSends: 160, maxConservativeTokens: 4_000_000, maxInputTokens: 200000 };
export interface OutlinePhaseDeclaration {
  version: 1; phase: 'ten-chapter-source-acceptance'; createdAt: string; scope: string; ledger: string;
  limits: LedgerLimits; maximumOutputTokens: 24000; extractionOutputCap: 12000; synthesisOutputCap: 24000;
  model: { model: 'gpt-6-luna'; reasoningEffort: 'medium' };
  priorLedger: { path: string; sha256: string; scope: string; reservedSends: 64; conservativeTokens: 1799920; immutable: true };
  sourceFixtureOrigin: { path: string; sha256: string };
  purpose: string;
}
export interface DeclaredPhaseLedger extends ConservativeLedger { phaseDeclarationSha256: string }

export function validateOutlineDeclaration(value: OutlinePhaseDeclaration): void {
  if (value.version !== 1 || value.phase !== 'ten-chapter-source-acceptance' || !value.scope.trim() ||
      value.scope === 'quality-lab-2026-10-16-phase-one' || hashControl(value.limits) !== hashControl(OUTLINE_PHASE_TWO_LIMITS) ||
      value.maximumOutputTokens !== 24000 || value.extractionOutputCap !== 12000 || value.synthesisOutputCap !== 24000 ||
      value.model.model !== 'gpt-6-luna' || value.model.reasoningEffort !== 'medium' ||
      value.priorLedger.reservedSends !== 64 || value.priorLedger.conservativeTokens !== 1799920 || value.priorLedger.immutable !== true ||
      value.priorLedger.scope !== 'quality-lab-2026-10-16-phase-one' ||
      ![value.priorLedger.sha256, value.sourceFixtureOrigin.sha256].every(hash => /^[a-f0-9]{64}$/.test(hash)) ||
      ![value.ledger, value.priorLedger.path, value.sourceFixtureOrigin.path].every(file => path.isAbsolute(file)) ||
      value.ledger === value.priorLedger.path) throw new Error('quality-lab-outline-phase-declaration-invalid');
}
export function assertLedgerIntegrity(ledger: ConservativeLedger): void {
  if (ledger.version !== 1 || ledger.accounting !== 'conservative-reservations-v1' ||
      !Object.values(ledger.limits).every(value => Number.isSafeInteger(value) && value > 0) ||
      !Number.isSafeInteger(ledger.reservedSends) || !Number.isSafeInteger(ledger.conservativeTokens) ||
      ledger.reservedSends < 0 || ledger.conservativeTokens < 0 || ledger.reservedSends !== ledger.reservations.length ||
      ledger.reservations.some(row => !Number.isSafeInteger(row.inputEstimate) || row.inputEstimate < 0 || !Number.isSafeInteger(row.outputReservation) || row.outputReservation < 0) ||
      ledger.conservativeTokens !== ledger.reservations.reduce((sum, row) => sum + row.inputEstimate + row.outputReservation, 0) ||
      ledger.reservedSends > ledger.limits.maxSends || ledger.conservativeTokens > ledger.limits.maxConservativeTokens) throw new Error('quality-lab-outline-phase-ledger-invalid');
}
export function assertDeclaredLedger(ledger: ConservativeLedger, declaration: OutlinePhaseDeclaration, fileSha256: string): void {
  assertLedgerIntegrity(ledger);
  if (ledger.scope !== declaration.scope || hashControl(ledger.limits) !== hashControl(declaration.limits) ||
      (ledger as DeclaredPhaseLedger).phaseDeclarationSha256 !== fileSha256) throw new Error('quality-lab-outline-declared-ledger-mismatch');
}
export async function readDeclaredOutlinePhase(file: string, expectedSha256: string, ledgerFile: string, scope: string, allowMissingLedger = false) {
  const raw = await readFile(file, 'utf8');
  if (!/^[a-f0-9]{64}$/.test(expectedSha256) || sha256(raw) !== expectedSha256) throw new Error('quality-lab-outline-phase-file-changed');
  const declaration = JSON.parse(raw) as OutlinePhaseDeclaration; validateOutlineDeclaration(declaration);
  if (declaration.scope !== scope || declaration.ledger !== path.resolve(ledgerFile)) throw new Error('quality-lab-outline-phase-path-or-scope-mismatch');
  const [fixtureRaw, priorRaw] = await Promise.all([readFile(declaration.sourceFixtureOrigin.path, 'utf8'), readFile(declaration.priorLedger.path, 'utf8')]);
  if (sha256(fixtureRaw) !== declaration.sourceFixtureOrigin.sha256 || sha256(priorRaw) !== declaration.priorLedger.sha256) throw new Error('quality-lab-outline-phase-frozen-input-changed');
  const prior = JSON.parse(priorRaw) as ConservativeLedger; assertLedgerIntegrity(prior);
  if (prior.scope !== declaration.priorLedger.scope || prior.reservedSends !== declaration.priorLedger.reservedSends || prior.conservativeTokens !== declaration.priorLedger.conservativeTokens) throw new Error('quality-lab-outline-prior-phase-mismatch');
  let ledger: ConservativeLedger; let ledgerExists = true;
  try { ledger = JSON.parse(await readFile(ledgerFile, 'utf8')) as ConservativeLedger; }
  catch (error) { if (!allowMissingLedger || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; ledger = emptyDeclaredLedger(declaration, expectedSha256); ledgerExists = false; }
  assertDeclaredLedger(ledger, declaration, expectedSha256);
  return { declaration, ledger, ledgerExists, sha256: expectedSha256, file: path.resolve(file) };
}

/** Creates new files only. An existing ledger is never reset, re-scoped or
 * migrated to a larger allowance, including after an interrupted declaration. */
export function emptyDeclaredLedger(declaration: OutlinePhaseDeclaration, digest: string): DeclaredPhaseLedger {
  return { version: 1, createdAt: declaration.createdAt, scope: declaration.scope, accounting: 'conservative-reservations-v1',
    limits: declaration.limits, phaseDeclarationSha256: digest, reservedSends: 0, conservativeTokens: 0, reservations: [] };
}
export async function initializeDeclaredOutlineLedger(file: string, expectedSha256: string): Promise<void> {
  const declaration = JSON.parse(await readFile(file, 'utf8')) as OutlinePhaseDeclaration;
  const phase = await readDeclaredOutlinePhase(file, expectedSha256, declaration.ledger, declaration.scope, true);
  if (phase.ledgerExists) throw new Error('quality-lab-outline-phase-file-already-exists');
  await writeFile(declaration.ledger, JSON.stringify(phase.ledger, null, 2) + '\n', { flag: 'wx' });
}
