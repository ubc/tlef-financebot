import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { sha256 } from '../../scripts/quality-lab/protocol';
import { assertDeclaredLedger, emptyDeclaredLedger, initializeDeclaredOutlineLedger, OUTLINE_PHASE_TWO_LIMITS, readDeclaredOutlinePhase, validateOutlineDeclaration, type OutlinePhaseDeclaration } from '../../scripts/quality-lab/phase-declaration';
import type { ConservativeLedger } from '../../scripts/quality-lab/ledger';
import { reserveLedger } from '../../scripts/quality-lab/ledger';

describe('prospective separate outline phase', () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'quality-outline-phase-')); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
  async function prepare() {
    const prior: ConservativeLedger = { version: 1, createdAt: '2026-10-16', scope: 'quality-lab-2026-10-16-phase-one', accounting: 'conservative-reservations-v1', limits: { maxSends: 100, maxConservativeTokens: 2000000, maxInputTokens: 200000 },
      reservedSends: 64, conservativeTokens: 1799920, reservations: Array.from({ length: 64 }, (_, index) => ({ id: String(index), cellId: 'prior', stage: 'prior', jsonAttempt: 0, inputSha256: 'synthetic', inputEstimate: 28123 + (index < 48 ? 1 : 0), outputReservation: 0, reservedAt: '2026-10-16' })) };
    const priorRaw = JSON.stringify(prior); const originRaw = '{"synthetic":"unchanged original fixture"}';
    const priorFile = path.join(directory, 'prior.json'); const originFile = path.join(directory, 'origin.json'); const file = path.join(directory, 'declaration.json'); const ledgerFile = path.join(directory, 'new-ledger.json');
    await writeFile(priorFile, priorRaw); await writeFile(originFile, originRaw);
    const declaration: OutlinePhaseDeclaration = { version: 1, phase: 'ten-chapter-source-acceptance', createdAt: '2026-10-16', scope: 'new-phase', ledger: ledgerFile, limits: { ...OUTLINE_PHASE_TWO_LIMITS }, maximumOutputTokens: 24000, extractionOutputCap: 12000, synthesisOutputCap: 24000, model: { model: 'gpt-6-luna', reasoningEffort: 'medium' },
      priorLedger: { path: priorFile, sha256: sha256(priorRaw), scope: prior.scope, reservedSends: 64, conservativeTokens: 1799920, immutable: true }, sourceFixtureOrigin: { path: originFile, sha256: sha256(originRaw) }, purpose: 'Synthetic isolated phase test.' };
    const raw = JSON.stringify(declaration); const digest = sha256(raw); await writeFile(file, raw);
    return { declaration, file, digest, ledgerFile, priorFile, priorRaw, originFile };
  }
  it('pins exact declaration bytes and keeps the completed old ledger unchanged while initializing a new allowance', async () => {
    const control = await prepare();
    const preflight = await readDeclaredOutlinePhase(control.file, control.digest, control.ledgerFile, 'new-phase', true);
    expect(preflight.ledgerExists).toBe(false); expect(preflight.ledger.reservedSends).toBe(0);
    await initializeDeclaredOutlineLedger(control.file, control.digest);
    expect((await readDeclaredOutlinePhase(control.file, control.digest, control.ledgerFile, 'new-phase')).ledgerExists).toBe(true);
    expect(await readFile(control.priorFile, 'utf8')).toBe(control.priorRaw);
    await writeFile(control.file, (await readFile(control.file, 'utf8')) + '\n');
    await expect(readDeclaredOutlinePhase(control.file, control.digest, control.ledgerFile, 'new-phase')).rejects.toThrow('phase-file-changed');
  });
  it('never overwrites a used ledger or adopts changed limits or scope', async () => {
    const control = await prepare(); await initializeDeclaredOutlineLedger(control.file, control.digest);
    await reserveLedger(control.ledgerFile, OUTLINE_PHASE_TWO_LIMITS, 'new-phase', 'cell', { stage: 'source-extraction', prompt: 'Exact source', model: 'gpt-6-luna', effort: 'medium', maxOutputTokens: 12000, allowedActualModels: ['gpt-6-luna'], maxSends: 2 }, 0, 'Exact source');
    const used = await readFile(control.ledgerFile, 'utf8');
    await expect(initializeDeclaredOutlineLedger(control.file, control.digest)).rejects.toThrow('already-exists'); expect(await readFile(control.ledgerFile, 'utf8')).toBe(used);
    await expect(readDeclaredOutlinePhase(control.file, control.digest, control.ledgerFile, 'different-scope')).rejects.toThrow('path-or-scope');
    const ledger = JSON.parse(used) as ConservativeLedger; ledger.limits.maxSends = 161; await writeFile(control.ledgerFile, JSON.stringify(ledger));
    await expect(readDeclaredOutlinePhase(control.file, control.digest, control.ledgerFile, 'new-phase')).rejects.toThrow('declared-ledger-mismatch');
  });
  it('refuses changed parent bytes even when its numeric totals are the same', async () => {
    const control = await prepare(); await initializeDeclaredOutlineLedger(control.file, control.digest);
    await writeFile(control.priorFile, control.priorRaw + '\n');
    await expect(readDeclaredOutlinePhase(control.file, control.digest, control.ledgerFile, 'new-phase')).rejects.toThrow('frozen-input-changed');
  });
  it('requires production stage caps, separate paths and exact phase identity on ledger receipts', async () => {
    const { declaration } = await prepare();
    expect(() => validateOutlineDeclaration({ ...declaration, extractionOutputCap: 10000 } as never)).toThrow('declaration-invalid');
    expect(() => validateOutlineDeclaration({ ...declaration, ledger: declaration.priorLedger.path })).toThrow('declaration-invalid');
    const ledger = emptyDeclaredLedger(declaration, 'a'.repeat(64));
    expect(() => assertDeclaredLedger(ledger, declaration, 'b'.repeat(64))).toThrow('declared-ledger-mismatch');
    ledger.conservativeTokens = 1; expect(() => assertDeclaredLedger(ledger, declaration, 'a'.repeat(64))).toThrow('ledger-invalid');
  });
});
