import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { ResolvedStepModels } from '../../server/src/services/step-models';

export const PUBLIC_ACCEPTANCE_SCOPE = 'quality-lab-public-http-agenda-acceptance-v1';
// Phase attempts include reservations that the unchanged native budget may
// subsequently refuse, reducing dispatches under this same strict78 limit.
export const PUBLIC_ACCEPTANCE_LIMITS = Object.freeze({ maxSends: 78, maxInputTokens: 24000, maxOutputTokens: 24000,
  maxConservativeTokens: 3_744_000 });
export const PUBLIC_CASES = Object.freeze([
  { id: 'thin-topic-bank-memory', count: 3, difficulty: 'easy' as const, kind: 'conceptual' as const, sourceChapter: 3,
    loName: 'Distinguish firm-specific and market risk and explain diversification.',
    prompt: 'Create independent learning tasks, not paraphrases or numerical variants. The Bank already tests that diversification reduces firm-specific risk. Stay within the source.' },
  { id: 'capm-decimals-notation', count: 2, difficulty: 'easy' as const, kind: 'calculation' as const, sourceChapter: 4,
    loName: 'Calculate the cost of equity using CAPM, preserving the source notation and units.',
    prompt: 'Use decimal input variations and the notation used by the source. Distinguish beta from total volatility. Compute answers from explicit formulas.' },
  { id: 'outside-scope-and-hardness', count: 1, difficulty: 'hard' as const, kind: 'conceptual' as const, sourceChapter: 3,
    loName: 'Distinguish firm-specific and market risk and explain diversification.',
    prompt: 'Keep the reading short. Only use this learning objective and original source. Do not invent unsupported prerequisite concepts to make the question hard.' },
]);
export const REGENERATION_CASES = Object.freeze([
  { intent: 'edit-existing' as const, prompt: 'Change firm-specific to company-specific. Preserve the True/False option order and keep True correct. Keep the stem short.' },
  { intent: 'create-variant' as const, prompt: 'Use a brief different investment context to test the same diversification proposition. Preserve the answer semantics.' },
  { intent: 'create-independent-task' as const, prompt: 'Create a different independent True/False learning task grounded in the risk chapter. Do not repeat the proposition that diversification reduces firm-specific risk.' },
]);
export interface ArchivedSource {
  material: { _id: string; name: string; format: 'pdf'; kind: 'reading'; revision: number; excerpt: string;
    sourceManifest: { version: 1; sourceTextHash: string; chunkCount: number; characterCount: number; indexedCount: number;
      parserVersion: string; chunkerVersion: string; indexedAt: string; ingestRunId: string } };
  pdfSha256: string; chunks: Array<{ index: number; text: string; characterCount: number }>;
}
export interface PublicReference {
  status: string; controls: { sourceControls: ArchivedSource[]; startingBankVersions: Array<{ type: 'true-false'; stem: string;
    options: Array<{ key: string; text: string; role: 'correct' | 'common-misconception'; explanation: string }>; difficulty: 'easy'; numericKind: 'conceptual' }>;
    cases: Array<{ name: string; count: number; difficulty: string; kind: string; prompt: string; loName: string }> };
}
export interface PublicAcceptanceDeclaration {
  version: 1; scope: typeof PUBLIC_ACCEPTANCE_SCOPE; database: string; expectedModels: ResolvedStepModels;
  historicalReference: { path: string; sha256: string }; corpus: { path: string; sha256: string };
  priorLedgers: Array<{ path: string; sha256: string; scope: string }>;
  code: Array<{ file: string; sha256: string }>; pdfs: Array<{ chapter: 3 | 4; path: string; sha256: string }>;
  limits: typeof PUBLIC_ACCEPTANCE_LIMITS; publicCases: typeof PUBLIC_CASES; regenerationCases: typeof REGENERATION_CASES;
  comparison: 'Current public acceptance versus a budget-confounded historical reference; not causal old/new A/B.';
  preparedAt: string;
}
export const publicHash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
export const publicObjectHash = (value: unknown): string => publicHash(JSON.stringify(value));

export function assertPublicTarget(env: { mongodbUri: string; mongodbDbName: string; qdrantUrl: string; embeddingsProvider: string }, database: string): void {
  const mongo = new URL(env.mongodbUri); const qdrant = new URL(env.qdrantUrl);
  const local = (host: string) => ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host);
  if (mongo.protocol !== 'mongodb:' || !local(mongo.hostname) || mongo.port !== '27029' || mongo.username || mongo.password ||
    env.mongodbDbName !== database || !/^financebot_quality_smoke_retest_[a-z0-9_]+$/.test(database)) throw new Error('public-acceptance-owned-mongo-required');
  if (!['http:', 'https:'].includes(qdrant.protocol) || !local(qdrant.hostname) || qdrant.port !== '6333' || qdrant.username || qdrant.password ||
    env.embeddingsProvider !== 'fastembed') throw new Error('public-acceptance-local-qdrant-fastembed-required');
}

/** The source receipt is checked without importing production env or connecting. */
export function validatePublicReference(reference: PublicReference): void {
  assert.equal(reference.status, 'completed');
  assert.equal(reference.controls.sourceControls.length, 2);
  assert.equal(reference.controls.startingBankVersions.length, 1);
  const sourceIds = new Set<string>();
  for (const source of reference.controls.sourceControls) {
    assert.match(source.material._id, /^[a-f0-9]{24}$/); assert(!sourceIds.has(source.material._id)); sourceIds.add(source.material._id);
    assert.equal(source.material.format, 'pdf'); assert.equal(source.material.kind, 'reading'); assert.match(source.pdfSha256, /^[a-f0-9]{64}$/);
    const manifest = source.material.sourceManifest; const hash = createHash('sha256');
    assert.equal(manifest.version, 1); assert.equal(manifest.chunkCount, source.chunks.length); assert.equal(manifest.indexedCount, source.chunks.length);
    assert(source.chunks.length > 0);
    for (const [index, chunk] of source.chunks.entries()) {
      assert.equal(chunk.index, index); assert.equal(chunk.characterCount, chunk.text.length); assert(chunk.text.trim());
      hash.update(`${index}:${Buffer.byteLength(chunk.text, 'utf8')}:`).update(chunk.text);
    }
    assert.equal(hash.digest('hex'), manifest.sourceTextHash);
    assert.equal(source.chunks.reduce((sum, chunk) => sum + chunk.characterCount, 0), manifest.characterCount);
  }
  for (const expected of PUBLIC_CASES) {
    const actual = reference.controls.cases.find(item => item.name === expected.id); assert(actual);
    for (const key of ['count', 'difficulty', 'kind', 'prompt', 'loName'] as const) assert.equal(actual[key], expected[key]);
  }
  const seed = reference.controls.startingBankVersions[0];
  assert.equal(seed.type, 'true-false'); assert.equal(seed.stem, 'Diversification can reduce firm-specific risk.');
  assert.equal(seed.numericKind, 'conceptual'); assert.equal(seed.difficulty, 'easy');
  assert.equal(seed.options.length, 2); assert.equal(seed.options[0].text, 'True'); assert.equal(seed.options[0].role, 'correct');
  assert.equal(seed.options[1].text, 'False'); assert.equal(seed.options[1].role, 'common-misconception');
}

export async function verifyPublicDeclaration(declaration: PublicAcceptanceDeclaration): Promise<void> {
  assert.equal(declaration.version, 1); assert.equal(declaration.scope, PUBLIC_ACCEPTANCE_SCOPE);
  assert.deepEqual(declaration.limits, PUBLIC_ACCEPTANCE_LIMITS); assert.deepEqual(declaration.publicCases, PUBLIC_CASES);
  assert.deepEqual(declaration.regenerationCases, REGENERATION_CASES);
  assert.equal(declaration.comparison, 'Current public acceptance versus a budget-confounded historical reference; not causal old/new A/B.');
  assert(declaration.code.length > 0); assert.equal(new Set(declaration.code.map(item => item.file)).size, declaration.code.length);
  assert.equal(declaration.pdfs.length, 2); assert.deepEqual(declaration.pdfs.map(item => item.chapter).sort(), [3, 4]);
  assert(declaration.priorLedgers.length >= 2, 'Pin finalized preceding phase ledgers; do not reset their accounting.');
  assert.equal(new Set(declaration.priorLedgers.map(item => item.path)).size, declaration.priorLedgers.length);
  for (const item of declaration.priorLedgers) {
    const raw = await readFile(item.path); assert.equal(publicHash(raw), item.sha256);
    assert.equal((JSON.parse(raw.toString()) as { scope: string }).scope, item.scope);
  }
  for (const item of [declaration.historicalReference, declaration.corpus, ...declaration.pdfs]) assert.equal(publicHash(await readFile(item.path)), item.sha256);
  for (const item of declaration.code) assert.equal(publicHash(await readFile(item.file)), item.sha256, `Code drift: ${item.file}`);
  const reference = JSON.parse(await readFile(declaration.historicalReference.path, 'utf8')) as PublicReference;
  validatePublicReference(reference);
  for (const pdf of declaration.pdfs) {
    assert(reference.controls.sourceControls.some(source => source.pdfSha256 === pdf.sha256 && source.material.name.startsWith(`Chapter ${pdf.chapter}:`)));
    assert.equal((await readFile(pdf.path)).subarray(0, 5).toString(), '%PDF-');
  }
}

export function classifySavedSupply(input: { requested: number; savedIds: string[]; ownedDraftIds: string[]; exportedSavedVersionIds: string[];
  versions: Array<{ id: string; questionId: string; runId: string; item: number }>; runId: string }): { requested: number; saved: number; missing: number } {
  assert(Number.isSafeInteger(input.requested) && input.requested > 0);
  assert.equal(new Set(input.savedIds).size, input.savedIds.length); assert.deepEqual([...input.savedIds].sort(), [...input.ownedDraftIds].sort());
  assert.equal(input.versions.length, input.savedIds.length);
  assert.deepEqual(input.versions.map(item => item.id).sort(), [...input.exportedSavedVersionIds].sort());
  assert.equal(new Set(input.versions.map(item => item.item)).size, input.versions.length);
  for (const version of input.versions) {
    assert.equal(version.runId, input.runId); assert(input.savedIds.includes(version.questionId));
    assert(Number.isSafeInteger(version.item) && version.item >= 0 && version.item < input.requested);
  }
  assert(input.savedIds.length <= input.requested);
  return { requested: input.requested, saved: input.savedIds.length, missing: input.requested - input.savedIds.length };
}
