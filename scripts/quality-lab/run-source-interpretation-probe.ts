import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { z } from 'zod';
import type { completeJson } from '../../server/src/components/genai/llm';
import { modelRequestOptions } from '../../server/src/components/genai/llm/model-capabilities';
import type { ModelCallEvent } from '../../server/src/components/genai/llm/model-call';
import type { GenerationMemorySnapshot } from '../../server/src/services/generation-memory.service';
import { assessGenerationQuality, snapshotQualityCandidate } from '../../server/src/services/generation-quality.service';
import { VALIDATOR_PROMPT, REVIEWER_PROMPT, verifyGeneratedNumerics, type GeneratorOutput } from '../../server/src/services/generation.service';
import type { GenerationEvidencePacket } from '../../server/src/types/generation-evidence';
import type { AuthoringRequirements, GenerationQualityAssessment } from '../../server/src/types/generation-quality';
import { installPublicObservation, publicSafeError, type PublicNativeAdmission } from './public-acceptance-observation';
import { yieldUsage } from './run-yield-repair-probe';

export const INTERPRETATION_SCOPE = 'retained-source-interpretation-review-only-v1';
export const INTERPRETATION_LIMITS = { maxSends: 16, maxInputTokens: 24000, maxOutputTokens: 2000, maxEstimatedTokens: 320000 } as const;
export const INTERPRETATION_STEP = { model: 'gpt-6-luna', reasoningEffort: 'none', temperature: 0, maxTokens: 2000 } as const;
const ROOT = path.resolve(__dirname, '../..');
const IDS = ['P01', 'P02', 'P03', 'P04', 'CAPM', 'TF'];
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const objectHash = (value: unknown) => sha(JSON.stringify(value));
interface Pin { file: string; sha256: string }
export interface InterpretationCase {
  id: string; loName: string; type: 'mcq' | 'true-false'; difficulty?: 'easy' | 'medium' | 'hard'; prompt?: string;
  packet: GenerationEvidencePacket; memory: GenerationMemorySnapshot; candidate: GeneratorOutput;
  requirements: AuthoringRequirements; previousAssessment: GenerationQualityAssessment; sourceReviewTranscriptFile: string;
  roleReview?: { validatorTranscriptFile: string; reviewerTranscriptFile: string };
}
export interface InterpretationInput { version: 1; cases: InterpretationCase[]; identities: Pin[]; limitations: string[] }
interface Controls { version: 1; scope: typeof INTERPRETATION_SCOPE; input: Pin; code: Pin[]; provider: string; endpoint: string; timeoutMs: number;
  limits: typeof INTERPRETATION_LIMITS; step: typeof INTERPRETATION_STEP; candidateHashes: Record<string, string>; priorLedgers: Pin[]; promptShapes: Pin }
export interface InterpretationLedger { declarationSha256: string; limits: typeof INTERPRETATION_LIMITS;
  reservations: Array<{ id: string; caseId: string; inputEstimate: number; output: number; admissionSha256: string }> }
const loadJson = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T;
const pin = async (file: string): Promise<Pin> => ({ file: path.resolve(file), sha256: sha(await readFile(file)) });
async function save(file: string, value: unknown, exclusive = false): Promise<void> {
  const temporary = exclusive ? file : `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  if (!exclusive) await rename(temporary, file);
}
async function verifyPins(pins: Pin[]): Promise<void> {
  assert.equal(new Set(pins.map(p => p.file)).size, pins.length, 'duplicate-file-pin');
  for (const p of pins) { assert(path.isAbsolute(p.file)); assert.match(p.sha256, /^[a-f0-9]{64}$/); assert.equal(sha(await readFile(p.file)), p.sha256, `file-drift:${p.file}`); }
}
export function validateInterpretationInput(input: InterpretationInput): void {
  assert.equal(input.version, 1); assert.deepEqual(input.cases.map(c => c.id), IDS);
  assert(input.identities.length > 0 && input.limitations.length > 0);
  for (const c of input.cases) {
    assert(c.loName.trim()); assert(['mcq', 'true-false'].includes(c.type));
    assert.equal(c.previousAssessment.policy, 'grounded-memory-v2');
    assert.equal(snapshotQualityCandidate({ ...c.candidate, type: c.type }).contentHash, c.previousAssessment.candidate?.contentHash, `${c.id}:candidate-drift`);
    assert.equal(c.previousAssessment.evidencePacketId, c.packet.id, `${c.id}:source-context-drift`);
    assert.equal(c.previousAssessment.memoryDigest, c.memory.snapshotDigest, `${c.id}:memory-context-drift`);
    assert.equal(c.packet.policyVersion, 'grounded-memory-v2');
    assert(c.packet.passages.length > 0 && c.packet.materials.length > 0);
    assert(c.requirements && Array.isArray(c.requirements.requiredChanges) && Array.isArray(c.requirements.preserve));
    assert(input.identities.some(p => p.file === path.resolve(c.sourceReviewTranscriptFile)), `${c.id}:missing-historical-review-pin`);
    if (c.roleReview) for (const file of Object.values(c.roleReview)) assert(input.identities.some(p => p.file === path.resolve(file)), `${c.id}:missing-role-review-pin`);
    if (['CAPM', 'TF'].includes(c.id)) assert(c.roleReview, `${c.id}:role-probe-input-missing`);
  }
}
export function reserveInterpretation(ledger: InterpretationLedger, declarationSha256: string, admission: PublicNativeAdmission, caseId: string): string {
  assert.equal(ledger.declarationSha256, declarationSha256); assert.deepEqual(ledger.limits, INTERPRETATION_LIMITS);
  assert(IDS.includes(caseId)); assert.equal(new Set(ledger.reservations.map(r => r.id)).size, ledger.reservations.length);
  assert(ledger.reservations.every(r => Number.isSafeInteger(r.inputEstimate) && r.inputEstimate > 0 && r.inputEstimate <= INTERPRETATION_LIMITS.maxInputTokens && r.output === 2000));
  assert.equal(admission.model, INTERPRETATION_STEP.model); assert.equal(admission.outputCap, 2000);
  assert.deepEqual(admission.options, { ...modelRequestOptions(INTERPRETATION_STEP), responseFormat: 'json' });
  const inputEstimate = Buffer.byteLength(admission.prompt + (admission.systemPrompt ?? ''), 'utf8') + 32;
  assert(inputEstimate <= INTERPRETATION_LIMITS.maxInputTokens, 'interpretation-input-cap');
  assert(ledger.reservations.length < INTERPRETATION_LIMITS.maxSends, 'interpretation-send-cap');
  assert(ledger.reservations.reduce((n, r) => n + r.inputEstimate + r.output, 0) + inputEstimate + 2000 <= INTERPRETATION_LIMITS.maxEstimatedTokens, 'interpretation-total-cap');
  const id = randomUUID(); ledger.reservations.push({ id, caseId, inputEstimate, output: 2000, admissionSha256: objectHash(admission) }); return id;
}
async function codePins(): Promise<Pin[]> {
  const files: string[] = ['package.json', 'package-lock.json'];
  for (const folder of ['server/src', 'scripts/quality-lab']) for (const file of await readdir(path.join(ROOT, folder), { recursive: true })) {
    if (file.endsWith('.ts')) files.push(path.join(folder, file));
  }
  return Promise.all(files.sort().map(file => pin(path.join(ROOT, file))));
}
const validatorSchema = z.object({ roleAssessment: z.string().min(1), moveAssessment: z.string().optional() }).strict();
const reviewerSchema = z.object({ decision: z.enum(['pass', 'flag', 'reject']), reasoning: z.string().min(1), suggestedDifficulty: z.enum(['easy', 'medium', 'hard']).optional() }).strict();
type Complete = typeof completeJson;
/** Some production assessment failures become withheld. A failed transport or
 * evidence checkpoint must still stop every later native invocation. */
export function guardedInterpretationCompletion(complete: Complete, checkpoint: () => Promise<void>) {
  let stopped = false; let failure: unknown;
  const stop = (caught: unknown) => { if (!stopped) { stopped = true; failure = caught; } };
  const assertHealthy = () => { if (stopped) throw failure; };
  const guarded: Complete = async <T>(prompt: string, options?: Parameters<Complete>[1]): Promise<T> => {
    try { assertHealthy(); await checkpoint(); return await complete<T>(prompt, options); }
    catch (caught) { stop(caught); throw caught; }
  };
  return { complete: guarded, stop, assertHealthy, get stopped() { return stopped; } };
}
/** No generator, repair, persistence, live Bank refresh or adoption is reachable here. */
export async function runInterpretationCase(c: InterpretationCase, complete: Complete, checkpoint: () => Promise<void>) {
  const numerics = verifyGeneratedNumerics(c.candidate);
  const assessment = await assessGenerationQuality({ packet: c.packet, memory: c.memory, candidate: { ...c.candidate, type: c.type },
    item: c.previousAssessment.item, step: INTERPRETATION_STEP, policy: 'grounded-memory-v2', requirements: c.requirements, beforeRequest: checkpoint, complete });
  let validation: z.infer<typeof validatorSchema> | null = null; let review: z.infer<typeof reviewerSchema> | null = null;
  if (c.roleReview && ['CAPM', 'TF'].includes(c.id)) {
    const chunks = c.packet.passages.map(p => ({ materialId: p.materialId, chunkIndex: p.chunkIndex, text: p.text }));
    validation = validatorSchema.parse(await complete(VALIDATOR_PROMPT({ loName: c.loName, question: c.candidate, chunks, authoringPolicy: 'grounded-memory-v2' }),
      { ...INTERPRETATION_STEP, beforeRequest: checkpoint, usageContext: { stage: 'interpretation-validator' } }));
    review = reviewerSchema.parse(await complete(REVIEWER_PROMPT({ loName: c.loName, question: c.candidate, type: c.type, chunks,
      verificationFailure: numerics.failure, verificationProven: Boolean(numerics.fields.verification), roleAssessment: validation.roleAssessment,
      moveAssessment: validation.moveAssessment, authoringPolicy: 'grounded-memory-v2' }),
    { ...INTERPRETATION_STEP, beforeRequest: checkpoint, usageContext: { stage: 'interpretation-content-review' } }));
  }
  return { id: c.id, candidateHash: snapshotQualityCandidate({ ...c.candidate, type: c.type }).contentHash, numerics, assessment, validation, review };
}
async function configuration() {
  const { env } = await import('../../server/src/config/env');
  assert(['openai', 'ubc-llm-sandbox'].includes(env.llmProvider)); assert.equal(env.llmRequestTimeoutMs, 180000);
  const endpoint = new URL(env.llmEndpoint || 'https://api.openai.com/v1'); assert(!endpoint.username && !endpoint.password && !endpoint.search);
  return { provider: env.llmProvider, endpoint: endpoint.href, timeoutMs: env.llmRequestTimeoutMs };
}
/** Inspect real production prompt construction with an explicitly refused
 * injected completion. Its fallback assessment is not a semantic result. */
export async function interpretationPromptShapes(input: InterpretationInput) {
  const shapes: Array<{ caseId: string; stage: string; prompt: string; utf8InputEstimate: number }> = [];
  const add = (caseId: string, stage: string, prompt: string) => {
    const utf8InputEstimate = Buffer.byteLength(prompt, 'utf8') + 32;
    assert(utf8InputEstimate <= INTERPRETATION_LIMITS.maxInputTokens, `${caseId}:${stage}:initial-prompt-too-large`);
    shapes.push({ caseId, stage, prompt, utf8InputEstimate });
  };
  for (const c of input.cases) {
    let calls = 0; let captured: string | undefined;
    await assessGenerationQuality({ packet: c.packet, memory: c.memory, candidate: { ...c.candidate, type: c.type }, item: c.previousAssessment.item,
      step: INTERPRETATION_STEP, policy: 'grounded-memory-v2', requirements: c.requirements,
      complete: async prompt => { calls++; captured = prompt; throw new Error('offline-prompt-inspection-refused'); } });
    assert.equal(calls, 1, `${c.id}:not-one-reviewable-candidate`);
    assert(captured); add(c.id, 'quality-review', captured);
    if (c.roleReview && ['CAPM', 'TF'].includes(c.id)) {
      const chunks = c.packet.passages.map(p => ({ materialId: p.materialId, chunkIndex: p.chunkIndex, text: p.text }));
      add(c.id, 'validator', VALIDATOR_PROMPT({ loName: c.loName, question: c.candidate, chunks, authoringPolicy: 'grounded-memory-v2' }));
      const old = await loadJson<{ rawResponse: { content: string } }>(c.roleReview.validatorTranscriptFile);
      const validation = validatorSchema.parse(JSON.parse(old.rawResponse.content)); const numerics = verifyGeneratedNumerics(c.candidate);
      add(c.id, 'content-review-with-historical-validator', REVIEWER_PROMPT({ loName: c.loName, question: c.candidate, type: c.type, chunks,
        verificationFailure: numerics.failure, verificationProven: Boolean(numerics.fields.verification), roleAssessment: validation.roleAssessment,
        moveAssessment: validation.moveAssessment, authoringPolicy: 'grounded-memory-v2' }));
    }
  }
  return { scope: 'File-only prompt shapes; refused injected completions are never semantic observations. Content review will use a fresh validator finding at execution.', shapes };
}
export async function prepareInterpretation(inputFile: string, priorLedgerFiles: string[], output: string): Promise<string> {
  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (): never { throw new Error('interpretation-preflight-network-forbidden'); };
  try {
    const input = await loadJson<InterpretationInput>(inputFile); validateInterpretationInput(input); await verifyPins(input.identities);
    assert(priorLedgerFiles.length >= 2, 'prior-paid-ledgers-required');
    const promptShapes = await interpretationPromptShapes(input);
    await mkdir(output, { recursive: false }); await save(path.join(output, 'prompt-shapes.json'), promptShapes, true);
    const controls: Controls = { version: 1, scope: INTERPRETATION_SCOPE, input: await pin(inputFile), code: await codePins(), ...await configuration(),
      limits: INTERPRETATION_LIMITS, step: INTERPRETATION_STEP,
      candidateHashes: Object.fromEntries(input.cases.map(c => [c.id, snapshotQualityCandidate({ ...c.candidate, type: c.type }).contentHash])),
      priorLedgers: await Promise.all(priorLedgerFiles.map(pin)), promptShapes: await pin(path.join(output, 'prompt-shapes.json')) };
    await save(path.join(output, 'controls.json'), controls, true);
    await save(path.join(output, 'declaration.json'), { version: 1, scope: INTERPRETATION_SCOPE, controls: await pin(path.join(output, 'controls.json')),
      limits: INTERPRETATION_LIMITS, saved: 0, adopted: 0, preparedAt: new Date().toISOString(),
      scopeLimits: ['Tuning cases selected after observed failures; no held-out accuracy or general quality estimate.', 'Same candidate/source/Bank requirements with changed review prompts; later acquisition cohort, not a same-code model comparison.',
        'All prior calls, negative results and unknown usage remain in immutable referenced ledgers. This is a new explicitly capped review-only phase.', 'No candidate rewrite, semantic repair, upload, embedding, DB write, teacher acceptance or effective saved-yield claim.'] }, true);
    return sha(await readFile(path.join(output, 'declaration.json')));
  } finally { net.Socket.prototype.connect = originalConnect; }
}
export async function executeInterpretation(file: string, expectedSha: string, output: string): Promise<void> {
  assert.match(expectedSha, /^[a-f0-9]{64}$/); assert.equal(sha(await readFile(file)), expectedSha);
  const declaration = await loadJson<{ version: number; scope: string; controls: Pin; limits: unknown }>(file);
  assert.equal(declaration.version, 1); assert.equal(declaration.scope, INTERPRETATION_SCOPE); assert.deepEqual(declaration.limits, INTERPRETATION_LIMITS);
  await verifyPins([declaration.controls]); const controls = await loadJson<Controls>(declaration.controls.file);
  assert.equal(controls.version, 1); assert.equal(controls.scope, INTERPRETATION_SCOPE); assert.deepEqual(controls.step, INTERPRETATION_STEP); assert.deepEqual(controls.limits, INTERPRETATION_LIMITS);
  const input = await loadJson<InterpretationInput>(controls.input.file); validateInterpretationInput(input);
  assert.deepEqual(controls.candidateHashes, Object.fromEntries(input.cases.map(c => [c.id, snapshotQualityCandidate({ ...c.candidate, type: c.type }).contentHash])));
  const assertCurrent = async () => { assert.equal(sha(await readFile(file)), expectedSha); assert.deepEqual(controls.code.map(p => p.file), (await codePins()).map(p => p.file), 'code-pin-set-drift'); await verifyPins([declaration.controls, controls.input, controls.promptShapes, ...controls.code, ...controls.priorLedgers, ...input.identities]); assert.deepEqual(await configuration(), { provider: controls.provider, endpoint: controls.endpoint, timeoutMs: controls.timeoutMs }); };
  await assertCurrent(); await mkdir(output, { recursive: false });
  await save(path.join(path.dirname(file), 'execution-claim.json'), { declarationSha256: expectedSha, output: path.resolve(output), pid: process.pid }, true);
  await mkdir(path.join(output, 'private-transcripts')); await mkdir(path.join(output, 'code-snapshot'));
  for (const p of controls.code) { const bytes = await readFile(p.file); assert.equal(sha(bytes), p.sha256, 'snapshot-code-drift'); const target = path.join(output, 'code-snapshot', path.relative(ROOT, p.file)); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes, { flag: 'wx' }); }
  await save(path.join(output, 'code-snapshot', 'manifest.json'), controls.code, true);
  const facade = await import('../../server/src/components/genai/llm');
  const { AuthoringBudget, withAuthoringBudget } = await import('../../server/src/components/genai/llm/authoring-budget');
  const { withModelCallObserver } = await import('../../server/src/components/genai/llm/model-call');
  const ledgerFile = path.join(output, 'ledger.json'); const initial: InterpretationLedger = { declarationSha256: expectedSha, limits: INTERPRETATION_LIMITS, reservations: [] };
  await save(ledgerFile, initial, true); let active = IDS[0]; let status = 'running'; let error: unknown = null; const started = Date.now();
  const events: ModelCallEvent[] = []; const outcomes: unknown[] = []; const budget = new AuthoringBudget(INTERPRETATION_SCOPE, INTERPRETATION_LIMITS);
  const observer = installPublicObservation(facade, { configuration: { provider: controls.provider, defaultModel: INTERPRETATION_STEP.model }, caseId: () => active, assertCurrent,
    reserve: async (admission, caseId) => { const current = await loadJson<InterpretationLedger>(ledgerFile); const id = reserveInterpretation(current, expectedSha, admission, caseId); await save(ledgerFile, current); return id; },
    save: capture => save(path.join(output, 'private-transcripts', `${capture.id}.json`), capture) });
  const persist = async () => save(path.join(output, 'results.json'), { version: 1, status, elapsedMs: Date.now() - started, declarationSha256: expectedSha, outcomes, events,
    captures: observer.captures, usage: yieldUsage(events), ledger: await loadJson(ledgerFile), budget: budget.snapshot(), error, saved: 0, adopted: 0, teacherAcceptance: null });
  const checkpoint = async () => { guard.assertHealthy(); observer.assertHealthy(); await assertCurrent(); };
  const guard = guardedInterpretationCompletion(facade.completeJson, checkpoint);
  await persist();
  try {
    for (const c of input.cases) {
      active = c.id;
      const slot = new AuthoringBudget(`${INTERPRETATION_SCOPE}:${c.id}`, INTERPRETATION_LIMITS);
      const result = await withAuthoringBudget(budget, () => withAuthoringBudget(slot, () => withModelCallObserver(async event => { events.push(event); try { await persist(); } catch (caught) { guard.stop(caught); throw caught; } },
        () => runInterpretationCase(c, guard.complete, checkpoint))));
      outcomes.push({ ...result, verificationComplete: !guard.stopped }); await persist(); await checkpoint();
      assert(observer.captures.every(capture => capture.state === 'returned'), 'interpretation-native-dispatch-or-admission-failure');
    }
    status = 'completed';
  } catch (caught) { status = 'stopped'; error = publicSafeError(caught); throw caught; }
  finally { await persist(); observer.restore(); }
}
export function interpretationArguments(args: string[]): Record<string, string> {
  const allowed = new Set(['--input', '--prior-ledgers', '--output', '--live', '--declaration', '--declaration-sha256']); const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) { const key = args[i]; const value = args[i + 1]; assert(allowed.has(key) && value && !value.startsWith('--') && !(key in result), 'invalid-duplicate-or-missing-argument'); result[key] = value; }
  assert(result['--output'], '--output-required');
  if (result['--live']) { assert.equal(result['--live'], 'once'); assert(result['--declaration'] && result['--declaration-sha256']); assert(!result['--input'] && !result['--prior-ledgers']); }
  else { assert(result['--input'] && result['--prior-ledgers']); assert(!result['--declaration'] && !result['--declaration-sha256']); }
  return result;
}
if (require.main === module) void (async () => {
  const args = interpretationArguments(process.argv.slice(2));
  if (args['--live']) await executeInterpretation(path.resolve(args['--declaration']), args['--declaration-sha256'], path.resolve(args['--output']));
  else console.log(JSON.stringify({ declarationSha256: await prepareInterpretation(path.resolve(args['--input']), args['--prior-ledgers'].split(',').map(file => path.resolve(file)), path.resolve(args['--output'])), providerCalls: 0 }));
})().catch(error => { console.error(publicSafeError(error)); process.exitCode = 1; });
