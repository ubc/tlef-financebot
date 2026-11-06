import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PUBLIC_ACCEPTANCE_LIMITS, PUBLIC_ACCEPTANCE_SCOPE, PUBLIC_CASES, REGENERATION_CASES, publicHash,
  verifyPublicDeclaration, type PublicAcceptanceDeclaration, type PublicReference } from '../../scripts/quality-lab/public-acceptance-controls';
import { main } from '../../scripts/quality-lab/run-public-acceptance';

jest.mock('../../server/src/config/env', () => { throw new Error('Offline declaration checks must not import runtime config.'); });
jest.mock('../../server/src/components/mongodb', () => { throw new Error('Offline declaration checks must not import Mongo.'); });
jest.mock('../../server/src/components/genai/llm', () => { throw new Error('Offline declaration checks must not import providers.'); });
jest.mock('../../server/src/components/jobs', () => { throw new Error('Offline declaration checks must not import Agenda.'); });

describe('public acceptance prospective declaration and zero-runtime boundaries', () => {
  let directory: string; let argv: string[];
  beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'public-acceptance-preflight-')); argv = process.argv; });
  afterEach(async () => { process.argv = argv; await rm(directory, { recursive: true, force: true }); });
  async function fixture(): Promise<PublicAcceptanceDeclaration> {
    const pdfs = await Promise.all(([3, 4] as const).map(async chapter => {
      const file = path.join(directory, `chapter-${chapter}.pdf`); const bytes = `%PDF-1.7\nSynthetic declaration-only chapter ${chapter}.`;
      await writeFile(file, bytes); return { chapter, path: file, sha256: publicHash(bytes) };
    }));
    const reference: PublicReference = { status: 'completed', controls: { sourceControls: pdfs.map(pdf => {
      const text = `Synthetic original chunk ${pdf.chapter}.`;
      return { pdfSha256: pdf.sha256, material: { _id: String(pdf.chapter).repeat(24), name: `Chapter ${pdf.chapter}: Unit.pdf`, format: 'pdf', kind: 'reading', revision: 2, excerpt: text,
        sourceManifest: { version: 1, sourceTextHash: createHash('sha256').update(`0:${Buffer.byteLength(text)}:`).update(text).digest('hex'),
          chunkCount: 1, characterCount: text.length, indexedCount: 1, parserVersion: 'unit', chunkerVersion: 'unit', indexedAt: 'unit', ingestRunId: 'a'.repeat(24) } },
        chunks: [{ index: 0, text, characterCount: text.length }] };
    }), cases: PUBLIC_CASES.map(item => ({ ...item, name: item.id })), startingBankVersions: [{ type: 'true-false', stem: 'Diversification can reduce firm-specific risk.', difficulty: 'easy', numericKind: 'conceptual', options: [
      { key: 'A', text: 'True', role: 'correct', explanation: 'Combining investments can reduce firm-specific risk.' },
      { key: 'B', text: 'False', role: 'common-misconception', explanation: 'Firm-specific risk can be diversified; market risk remains.' },
    ] }] } };
    const referencePath = path.join(directory, 'reference.json'); const corpusPath = path.join(directory, 'corpus.json'); const codePath = path.join(directory, 'unit-code.ts');
    await writeFile(referencePath, JSON.stringify(reference)); await writeFile(corpusPath, JSON.stringify({ chapters: pdfs })); await writeFile(codePath, '/* synthetic frozen code identity only */');
    const priorLedgers: PublicAcceptanceDeclaration['priorLedgers'] = [];
    for (const number of [1, 2]) { const file = path.join(directory, `phase-${number}.json`); const raw = JSON.stringify({ scope: `unit-final-phase-${number}`, accounting: 'unit-only', reservedSends: number });
      await writeFile(file, raw); priorLedgers.push({ path: file, sha256: publicHash(raw), scope: `unit-final-phase-${number}` }); }
    return { version: 1, scope: PUBLIC_ACCEPTANCE_SCOPE, database: 'financebot_quality_smoke_retest_unit',
      expectedModels: { embedding: 'fast-bge-small-en-v1.5', generator: { model: 'gpt-6-luna' }, validator: { model: 'gpt-6-luna' }, reviewer: { model: 'gpt-6-luna' } },
      historicalReference: { path: referencePath, sha256: publicHash(await readFile(referencePath)) }, corpus: { path: corpusPath, sha256: publicHash(await readFile(corpusPath)) },
      pdfs, code: [{ file: codePath, sha256: publicHash(await readFile(codePath)) }], priorLedgers, limits: PUBLIC_ACCEPTANCE_LIMITS,
      publicCases: PUBLIC_CASES, regenerationCases: REGENERATION_CASES, preparedAt: 'unit-only',
      comparison: 'Current public acceptance versus a budget-confounded historical reference; not causal old/new A/B.' };
  }
  it('verifies immutable sources/code/prior ledgers using files only', async () => {
    await expect(verifyPublicDeclaration(await fixture())).resolves.toBeUndefined();
  });
  it('refuses a changed original PDF and a changed transitive code receipt before any runtime import', async () => {
    const declaration = await fixture(); await writeFile(declaration.pdfs[0].path, '%PDF-drift');
    await expect(verifyPublicDeclaration(declaration)).rejects.toThrow();
    const second = await fixture(); await writeFile(second.code[0].file, 'changed implementation');
    await expect(verifyPublicDeclaration(second)).rejects.toThrow('Code drift');
  });
  it('refuses changed or missing prior phase lineage instead of resetting its budget', async () => {
    const declaration = await fixture(); await writeFile(declaration.priorLedgers[0].path, JSON.stringify({ scope: 'same-path-new-budget', reservedSends: 0 }));
    await expect(verifyPublicDeclaration(declaration)).rejects.toThrow();
    const second = await fixture(); second.priorLedgers = []; await expect(verifyPublicDeclaration(second)).rejects.toThrow('Pin finalized');
  });
  it('refuses altered3+2+1 requests and silently enlarged phase caps', async () => {
    const declaration = await fixture(); const enlarged = structuredClone(declaration);
    Object.assign(enlarged.limits, { maxSends: 94 }); await expect(verifyPublicDeclaration(enlarged)).rejects.toThrow();
    const changed = structuredClone(declaration); changed.publicCases[0].prompt += ' wider material'; await expect(verifyPublicDeclaration(changed)).rejects.toThrow();
  });
  it('does not treat a declaration-only CLI command as live authorization', async () => {
    process.argv = ['node', 'unit', '--output', path.join(directory, 'never-created'), '--declaration', path.join(directory, 'unread.json')];
    await expect(main()).rejects.toThrow('Use --live once');
    await expect(readFile(path.join(directory, 'never-created', 'ledger.json'))).rejects.toThrow();
  });
  it('requires the exact explicit live switch before reading runtime configuration', async () => {
    process.argv = ['node', 'unit', '--output', path.join(directory, 'never-created'), '--live', 'yes'];
    await expect(main()).rejects.toThrow();
    await expect(readFile(path.join(directory, 'never-created', 'execution-claim.json'))).rejects.toThrow();
  });
});
