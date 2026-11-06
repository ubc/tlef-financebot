import { mkdir, readFile, rename, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hashControl, type LabRequest } from './protocol';

export interface LedgerLimits { maxSends: number; maxConservativeTokens: number; maxInputTokens: number }
interface Reservation {
  id: string; cellId: string; stage: string; jsonAttempt: number; inputSha256: string;
  inputEstimate: number; outputReservation: number; reservedAt: string;
}
export interface ConservativeLedger {
  version: 1; createdAt: string; scope: string; accounting: 'conservative-reservations-v1'; limits: LedgerLimits;
  reservedSends: number; conservativeTokens: number; reservations: Reservation[];
}
/** Shared append-only accounting survives process restarts. A reservation is
 * never released on failure or replay, even if downstream dispatch is denied. */
export async function reserveLedger(file: string, limits: LedgerLimits, scope: string,
  cellId: string, request: LabRequest, jsonAttempt: number, actualPrompt: string, systemPrompt = ''): Promise<ConservativeLedger> {
  if (!Object.values(limits).every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('quality-lab-invalid-ledger-limits');
  await mkdir(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  await mkdir(lock); // Fail closed on concurrent work or an abandoned lock; never steal it.
  try {
    let ledger: ConservativeLedger;
    try { ledger = JSON.parse(await readFile(file, 'utf8')) as ConservativeLedger; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      ledger = { version: 1, createdAt: new Date().toISOString(), scope, accounting: 'conservative-reservations-v1', limits,
        reservedSends: 0, conservativeTokens: 0, reservations: [] };
    }
    if (ledger.version !== 1 || ledger.accounting !== 'conservative-reservations-v1' || ledger.scope !== scope || hashControl(ledger.limits) !== hashControl(limits)) throw new Error('quality-lab-ledger-scope-mismatch');
    if (ledger.reservedSends !== ledger.reservations.length || ledger.conservativeTokens !== ledger.reservations.reduce((total, item) => total + item.inputEstimate + item.outputReservation, 0)) throw new Error('quality-lab-ledger-receipt-mismatch');
    const envelope = JSON.stringify([{ role: 'user', content: actualPrompt }]);
    const inputEstimate = Buffer.byteLength(envelope + systemPrompt, 'utf8') + 32;
    const inputLimit = Math.min(limits.maxInputTokens, request.maxInputTokens ?? limits.maxInputTokens);
    if (inputEstimate > inputLimit) throw new Error('quality-lab-ledger-input-cap');
    if (ledger.reservedSends >= limits.maxSends) throw new Error('quality-lab-ledger-send-cap');
    if (ledger.conservativeTokens + inputEstimate + request.maxOutputTokens > limits.maxConservativeTokens) throw new Error('quality-lab-ledger-token-cap');
    ledger.reservations.push({ id: randomUUID(), cellId, stage: request.stage, jsonAttempt,
      inputSha256: hashControl({ actualPrompt, systemPrompt }), inputEstimate, outputReservation: request.maxOutputTokens, reservedAt: new Date().toISOString() });
    ledger.reservedSends++; ledger.conservativeTokens += inputEstimate + request.maxOutputTokens;
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(ledger, null, 2) + '\n', { flag: 'wx' }); await rename(temporary, file);
    return ledger;
  } finally { await rmdir(lock); }
}
