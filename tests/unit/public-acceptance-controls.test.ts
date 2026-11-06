import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { assertPublicTarget, classifySavedSupply, PUBLIC_ACCEPTANCE_LIMITS, PUBLIC_CASES, publicObjectHash, validatePublicReference,
  type PublicReference } from '../../scripts/quality-lab/public-acceptance-controls';
import { initializePublicLedger, reservePublicNativeAttempt, type PublicNativeLedger } from '../../scripts/quality-lab/public-acceptance-observation';
import type { ModelSendAdmission } from '../../server/src/components/genai/llm';

jest.mock('../../server/src/config/env', () => { throw new Error('Offline public acceptance guards must not import runtime config.'); });
jest.mock('../../server/src/components/mongodb', () => { throw new Error('Offline public acceptance guards must not import Mongo.'); });
jest.mock('../../server/src/components/genai/llm', () => { throw new Error('Offline public acceptance guards must not import provider code.'); });

const safeTarget = { mongodbUri: 'mongodb://127.0.0.1:27029/?directConnection=true', mongodbDbName: 'financebot_quality_smoke_retest_unit', qdrantUrl: 'http://localhost:6333', embeddingsProvider: 'fastembed' };
function reference(): PublicReference {
  return { status: 'completed', controls: {
    sourceControls: [3, 4].map(chapter => {
      const text = `Original synthetic chapter ${chapter} evidence.`;
      return { material: { _id: String(chapter).repeat(24), name: `Chapter ${chapter}: Synthetic.pdf`, format: 'pdf', kind: 'reading', revision: 2, excerpt: text,
        sourceManifest: { version: 1, sourceTextHash: createHash('sha256').update(`0:${Buffer.byteLength(text)}:`).update(text).digest('hex'),
          chunkCount: 1, characterCount: text.length, indexedCount: 1, parserVersion: 'unit-original', chunkerVersion: 'unit-original', indexedAt: '2026-10-14T00:00:00Z', ingestRunId: '1'.repeat(24) } },
        pdfSha256: String(chapter).repeat(64), chunks: [{ index: 0, text, characterCount: text.length }] };
    }),
    cases: PUBLIC_CASES.map(item => ({ ...item, name: item.id })),
    startingBankVersions: [{ type: 'true-false', stem: 'Diversification can reduce firm-specific risk.', difficulty: 'easy', numericKind: 'conceptual',
      options: [{ key: 'A', text: 'True', role: 'correct', explanation: 'Combining investments can reduce firm-specific risk.' },
        { key: 'B', text: 'False', role: 'common-misconception', explanation: 'Firm-specific risk can be diversified; market risk remains.' }] }],
  } };
}
const admission = (prompt = 'Synthetic request'): ModelSendAdmission => ({ prompt, model: 'gpt-6-luna', provider: 'openai', options: { model: 'gpt-6-luna', reasoning_effort: 'none', max_completion_tokens: 8000 }, outputCap: 8000, jsonAttempt: 0 });

describe('isolated public acceptance guards and immutable source controls', () => {
  it('admits only the exact local disposable Mongo27029 and local FastEmbed/Qdrant target', () => {
    expect(() => assertPublicTarget(safeTarget, safeTarget.mongodbDbName)).not.toThrow();
    for (const patch of [{ mongodbUri: 'mongodb://prod.example:27029' }, { mongodbUri: 'mongodb://localhost:27017' },
      { mongodbUri: 'mongodb+srv://localhost:27029' }, { mongodbUri: 'mongodb://user:secret@localhost:27029' },
      { mongodbDbName: 'financebot' }, { qdrantUrl: 'https://external.example:6333' }, { embeddingsProvider: 'openai' }]) {
      expect(() => assertPublicTarget({ ...safeTarget, ...patch }, safeTarget.mongodbDbName)).toThrow();
    }
  });
  it('binds complete original chunk text/order/count/hash and unchanged3+2+1 requests', () => {
    const valid = reference(); expect(() => validatePublicReference(valid)).not.toThrow();
    const bad = structuredClone(valid); bad.controls.sourceControls[0].chunks[0].text += ' drifting';
    expect(() => validatePublicReference(bad)).toThrow();
    const shortened = structuredClone(valid); shortened.controls.sourceControls[0].chunks = []; expect(() => validatePublicReference(shortened)).toThrow();
    const promptChanged = structuredClone(valid); promptChanged.controls.cases[0].prompt += ' extra'; expect(() => validatePublicReference(promptChanged)).toThrow();
    const seedChanged = structuredClone(valid); seedChanged.controls.startingBankVersions[0].options[0].role = 'common-misconception'; expect(() => validatePublicReference(seedChanged)).toThrow();
  });
  it('counts only exact saved owned Drafts bound to unique requested immutable slots and exported versions', () => {
    const receipt = { requested: 3, savedIds: ['q1'], ownedDraftIds: ['q1'], exportedSavedVersionIds: ['v1'], runId: 'run', versions: [{ id: 'v1', questionId: 'q1', runId: 'run', item: 2 }] };
    expect(classifySavedSupply(receipt)).toEqual({ requested: 3, saved: 1, missing: 2 });
    expect(() => classifySavedSupply({ ...receipt, ownedDraftIds: [] })).toThrow();
    expect(() => classifySavedSupply({ ...receipt, exportedSavedVersionIds: ['new-current-version'] })).toThrow();
    expect(() => classifySavedSupply({ ...receipt, versions: [{ ...receipt.versions[0], runId: 'other' }] })).toThrow();
    expect(() => classifySavedSupply({ ...receipt, versions: [{ ...receipt.versions[0], item: 3 }] })).toThrow();
  });
});

describe('native-attempt conservative phase ledger', () => {
  let directory: string; let ledgerFile: string; const declarationSha = 'a'.repeat(64);
  beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'public-acceptance-ledger-')); ledgerFile = path.join(directory, 'ledger.json'); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
  it('creates wx-only, reserves exact native options/UTF8 input and does not release on an unknown native dispatch', async () => {
    await initializePublicLedger(ledgerFile, declarationSha);
    await expect(initializePublicLedger(ledgerFile, declarationSha)).rejects.toThrow();
    await reservePublicNativeAttempt(ledgerFile, declarationSha, 'case', admission('β = 1.25'));
    const ledger = JSON.parse(await readFile(ledgerFile, 'utf8')) as PublicNativeLedger;
    expect(ledger.attemptReservations).toBe(1); expect(ledger.reservations[0].inputEstimate).toBe(Buffer.byteLength('β = 1.25') + 32);
    expect(ledger.reservations[0].inputSha256).toBe(publicObjectHash(admission('β = 1.25')));
    expect(ledger.conservativeUnits).toBe(Buffer.byteLength('β = 1.25') + 32 + 8000);
  });
  it('refuses a foreign declaration, corrupted sums, input/output overflow and missing ledgers without resetting them', async () => {
    await expect(reservePublicNativeAttempt(ledgerFile, declarationSha, 'case', admission())).rejects.toThrow();
    await initializePublicLedger(ledgerFile, declarationSha); const before = await readFile(ledgerFile, 'utf8');
    await expect(reservePublicNativeAttempt(ledgerFile, 'b'.repeat(64), 'case', admission())).rejects.toThrow('identity-mismatch');
    await expect(reservePublicNativeAttempt(ledgerFile, declarationSha, 'case', admission('x'.repeat(24000)))).rejects.toThrow('input-cap');
    await expect(reservePublicNativeAttempt(ledgerFile, declarationSha, 'case', { ...admission(), outputCap: 24001 })).rejects.toThrow('output-cap');
    expect(await readFile(ledgerFile, 'utf8')).toBe(before);
    const corrupted = JSON.parse(before) as PublicNativeLedger; corrupted.conservativeUnits++;
    await writeFile(ledgerFile, JSON.stringify(corrupted)); await expect(reservePublicNativeAttempt(ledgerFile, declarationSha, 'case', admission())).rejects.toThrow('identity-mismatch');
  });
  it('enforces the78-reservation phase maximum and never steals a concurrent/abandoned lock', async () => {
    await initializePublicLedger(ledgerFile, declarationSha); const ledger = JSON.parse(await readFile(ledgerFile, 'utf8')) as PublicNativeLedger;
    ledger.reservations = Array.from({ length: PUBLIC_ACCEPTANCE_LIMITS.maxSends }, (_, index) => ({ id: `${index}`, caseId: 'case', inputSha256: 'unit', inputEstimate: 100, outputReservation: 8000, at: 'unit' }));
    ledger.attemptReservations = ledger.reservations.length; ledger.conservativeUnits = ledger.attemptReservations * 8100; await writeFile(ledgerFile, JSON.stringify(ledger));
    await expect(reservePublicNativeAttempt(ledgerFile, declarationSha, 'case', admission())).rejects.toThrow('total-cap');
    await mkdir(`${ledgerFile}.lock`); await expect(reservePublicNativeAttempt(ledgerFile, declarationSha, 'case', admission())).rejects.toThrow();
    expect(JSON.parse(await readFile(ledgerFile, 'utf8')).attemptReservations).toBe(78);
  });
});
