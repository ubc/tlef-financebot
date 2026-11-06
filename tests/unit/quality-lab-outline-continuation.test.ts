import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ConservativeLedger } from '../../scripts/quality-lab/ledger';
import type { PublicNativeAdmission } from '../../scripts/quality-lab/public-acceptance-observation';
import type { StructureReviewCheckpointBody } from '../../server/src/types/structure-review';
import type { OutlineGroundingBatch } from '../../server/src/services/structure-outline-grounding';
import { appendContinuationReservation, assertContinuationLedger, assertContinuationTarget, CONTINUATION_IDENTITY,
  continuationPendingPlan, parseContinuationArguments, recordedContinuationOptions, recoverContinuationSelector } from '../../scripts/quality-lab/run-outline-continuation';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function parentLedger(): ConservativeLedger {
  return { version: 1, createdAt: '2026-10-17T01:37:14.518Z', scope: 'quality-lab-2026-10-16-outline-v2-acceptance', accounting: 'conservative-reservations-v1',
    limits: { maxSends: 100, maxConservativeTokens: 2000000, maxInputTokens: 200000 }, reservedSends: 20, conservativeTokens: 1004330,
    reservations: Array.from({ length: 20 }, (_, index) => ({ id: `prior-${index}`, cellId: 'outline-v2-acceptance', stage: 'outline-source-review',
      jsonAttempt: 0, inputSha256: hash(index), inputEstimate: index === 19 ? 48330 : 40000, outputReservation: index === 19 ? 6000 : 10000, reservedAt: '2026-10-17T01:47:52.232Z' })) };
}
const admission = (size = 47968): PublicNativeAdmission => ({ prompt: 'x'.repeat(size), provider: 'openai', model: 'gpt-6-luna', outputCap: 6000,
  options: { model: 'gpt-6-luna', reasoning_effort: 'medium', stream: true, maxTokens: 6000, responseFormat: 'json' }, jsonAttempt: null });
let directory: string;
beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'outline-continuation-offline-')); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

it('requires explicit mode/new output and rejects unknown, duplicate, unpaired and live flags in preparation', () => {
  expect(parseContinuationArguments(['--mode', 'prepare', '--output', 'fresh'])).toEqual({ '--mode': 'prepare', '--output': 'fresh' });
  for (const args of [[], ['--mode', 'prepare', '--output'], ['--mode', 'prepare', '--output', 'fresh', '--anything', '1'],
    ['--mode', 'prepare', '--output', 'fresh', '--mode', 'live'], ['--mode', 'prepare', '--output', 'fresh', '--confirm-root-owned-execution', 'once'],
    ['--mode', 'live', '--output', 'fresh']]) expect(() => parseContinuationArguments(args)).toThrow();
});

it('preserves actual omission/none options and compares only metadata-visible shaping without hiding raw options', () => {
  expect(recordedContinuationOptions({ model: 'gpt-6-luna', systemPrompt: 'private original', maxTokens: 6000, responseFormat: 'json' }))
    .toEqual({ maxTokens: 6000, responseFormat: 'json' });
  expect(recordedContinuationOptions({ reasoning_effort: 'none', temperature: 0, stream: false })).toEqual({ temperature: 0, reasoning_effort: 'none', stream: false });
});

it('requires exact local Mongo27029 direct connection, owned database and prospectively pinned provider identity', () => {
  const config = { mongodbUri: 'mongodb://127.0.0.1:27029/?directConnection=true', mongodbDbName: CONTINUATION_IDENTITY.database,
    llmProvider: 'openai', llmEndpoint: 'https://example.invalid/v1' };
  const providerHash = hash({ provider: config.llmProvider, endpoint: config.llmEndpoint });
  expect(assertContinuationTarget(config, providerHash).origin).toBe('https://example.invalid');
  for (const altered of [{ mongodbUri: 'mongodb://127.0.0.1:27029/' }, { mongodbUri: 'mongodb://remote.invalid:27029/?directConnection=true' },
    { mongodbUri: 'mongodb://user:secret@127.0.0.1:27029/?directConnection=true' }, { mongodbDbName: 'production' }, { llmEndpoint: 'https://other.invalid/v1' }]) {
    expect(() => assertContinuationTarget({ ...config, ...altered }, providerHash)).toThrow();
  }
});

it('preserves every parent reservation byte/order even when a tamper leaves aggregate costs equal', () => {
  const before = parentLedger(); assertContinuationLedger(before, structuredClone(before));
  const altered = structuredClone(before); altered.reservations[0].inputEstimate++; altered.reservations[1].inputEstimate--;
  expect(() => assertContinuationLedger(before, altered)).toThrow('prefix');
  const largerLimit = structuredClone(before); largerLimit.limits.maxConservativeTokens++;
  expect(() => assertContinuationLedger(before, largerLimit)).toThrow();
  const reset = structuredClone(before); reset.reservations = []; reset.reservedSends = 0; reset.conservativeTokens = 0;
  expect(() => assertContinuationLedger(before, reset)).toThrow();
});

it('appends at most eighteen actual-shaped reservations without resetting the1,004,330 prefix', async () => {
  const before = parentLedger(); const file = path.join(directory, 'ledger.json'); await writeFile(file, JSON.stringify(before), { flag: 'wx' });
  for (let index = 0; index < 18; index++) await appendContinuationReservation(file, before, admission(), index % 2);
  const final = JSON.parse(await readFile(file, 'utf8')) as ConservativeLedger;
  expect(final.reservedSends).toBe(38); expect(final.conservativeTokens).toBe(1976330);
  expect(final.reservations.slice(0, 20)).toEqual(before.reservations);
  const bytes = await readFile(file, 'utf8');
  await expect(appendContinuationReservation(file, before, admission(), 0)).rejects.toThrow();
  expect(await readFile(file, 'utf8')).toBe(bytes);
});

it('charges portable JSON correction and never releases failed/unknown work', async () => {
  const before = parentLedger(); const file = path.join(directory, 'ledger.json'); await writeFile(file, JSON.stringify(before));
  await appendContinuationReservation(file, before, admission(100), 0);
  await appendContinuationReservation(file, before, admission(200), 1);
  const state = JSON.parse(await readFile(file, 'utf8')) as ConservativeLedger;
  expect(state.reservedSends).toBe(22); expect(state.conservativeTokens).toBe(1004330 + 6132 + 6232);
  expect(state.reservations.slice(-2).map(row => row.jsonAttempt)).toEqual([0, 1]);
  expect(state.reservations.slice(0, 20)).toEqual(before.reservations);
});

it('fails closed on an abandoned lock, oversized input/output and incompatible effort/transport', async () => {
  const before = parentLedger(); const file = path.join(directory, 'ledger.json'); await writeFile(file, JSON.stringify(before));
  for (const altered of [{ ...admission(), prompt: 'x'.repeat(47969) }, { ...admission(), outputCap: 6001 },
    { ...admission(), options: { ...admission().options, stream: false } }, { ...admission(), options: { ...admission().options, reasoning_effort: 'low' } }]) {
    await expect(appendContinuationReservation(file, before, altered, 0)).rejects.toThrow();
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(before);
  }
  const fs = await import('node:fs/promises'); await fs.mkdir(`${file}.lock`);
  await expect(appendContinuationReservation(file, before, admission(), 0)).rejects.toMatchObject({ code: 'EEXIST' });
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(before);
});

it('selects only unresolved exact IDs with complete unchanged own originals through current trusted declarations', async () => {
  const source = await readFile(path.resolve('server/src/services/structure-outline-grounding.ts'), 'utf8');
  const select = recoverContinuationSelector(`${source}\nthrow new Error('Top-level/import code must not execute in preflight');`);
  const original = { id: 'full-original', alias: 'S1', materialId: 'material', materialName: 'Chapter', chunkIndex: 0, text: 'Full original text, not a generated summary.' };
  const batch: OutlineGroundingBatch = { objectives: ['L103', 'L104'].map((id, i) => ({ id, themeIndex: 0, loIndex: i, topic: 'Risk', name: `Task ${id}`,
    contentHash: hash(id), evidenceIds: ['E1'], materialIds: ['material'], sourceIds: ['S1'], learningPoints: [{ id: 'E1', objective: 'Source proposition', materialId: 'material', sourceIds: ['S1'] }] })),
    sources: [original], prompt: 'Must re-render the exact subset with current trusted renderer.' };
  const body = { batches: [batch] } as StructureReviewCheckpointBody;
  const plan = continuationPendingPlan(body, [{ id: 'L103' }], select);
  expect(plan).toHaveLength(1); expect(plan[0].ids).toEqual(['L104']);
  const selected = select(batch, ['L104']); expect(selected.sources).toEqual([original]); expect(selected.prompt).toContain(original.text);
  expect(selected.prompt).not.toContain('Task L103'); expect(plan[0].promptSha256).toBe(createHash('sha256').update(selected.prompt).digest('hex'));
  expect(() => continuationPendingPlan(body, [{ id: 'foreign' }], select)).toThrow();
  expect(() => continuationPendingPlan(body, [{ id: 'L103' }, { id: 'L103' }], select)).toThrow();
  expect(() => recoverContinuationSelector('export const fake = true;')).toThrow('missing');
});

it('stops when a full-original prompt exceeds the fixed cap rather than trimming source text', async () => {
  const select = recoverContinuationSelector(await readFile(path.resolve('server/src/services/structure-outline-grounding.ts'), 'utf8'));
  const batch = { objectives: [{ id: 'L104', sourceIds: ['S1'], topic: 'Risk', name: 'One exact task', learningPoints: [] }],
    sources: [{ alias: 'S1', materialName: 'Full chapter', text: 'x'.repeat(48000) }] } as unknown as OutlineGroundingBatch;
  expect(() => continuationPendingPlan({ batches: [batch] } as StructureReviewCheckpointBody, [], select)).toThrow('input cap');
});
