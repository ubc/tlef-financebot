/** File-only reconstruction first; root alone may explicitly execute the capped review probe. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { assessGenerationQuality, snapshotQualityCandidate } from '../../server/src/services/generation-quality.service';
import { bindPlannedAuthoringTask, buildGenerationSemanticRepairPlan } from '../../server/src/services/generation-semantic-repair';
import { modelRequestOptions } from '../../server/src/components/genai/llm/model-capabilities';
import { installPublicObservation, publicSafeError, type PublicNativeAdmission, type PublicNativeCapture } from './public-acceptance-observation';
import type { completeJson } from '../../server/src/components/genai/llm';
import type { AuthoringRequirements, GenerationQualityAssessment } from '../../server/src/types/generation-quality';
import type { GenerationEvidencePacket } from '../../server/src/types/generation-evidence';
import type { GenerationMemoryContent, GenerationMemorySnapshot } from '../../server/src/services/generation-memory.service';
import type { ModelCallEvent } from '../../server/src/components/genai/llm/model-call';

const ROOT = path.resolve(__dirname, '../..');
export const YIELD_LIMITS = Object.freeze({ maxSends: 4, maxInputTokens: 24000, maxOutputTokens: 6000, maxEstimatedTokens: 120000 });
const STEP = Object.freeze({ model: 'gpt-6-luna', maxTokens: 2000 }); // Omitted effort historically shapes to native none.
const NATIVE = Object.freeze({ ...modelRequestOptions({ ...STEP, reasoningEffort: 'none', temperature: 0 }), responseFormat: 'json' });
const IDS = ['d0ddcc25-b0e9-4ea0-935e-93788155de94', '794b448b-e320-48db-9bde-bc04d210839e', '42ef699c-a026-459b-99c3-5b9b856b0a07', 'f358bb0f-4689-45eb-b573-07c687e429ce'];
const PLANNER = 'faf49c3b-2f0c-46a6-95b0-7c6a5b3d7f4d';
const CODE = ['scripts/quality-lab/run-yield-repair-probe.ts', 'scripts/quality-lab/public-acceptance-observation.ts', 'scripts/quality-lab/public-acceptance-controls.ts',
  'server/src/services/generation-quality.service.ts', 'server/src/services/generation-semantic-repair.ts', 'server/src/services/generation-memory.service.ts',
  'server/src/services/generation-citation-spans.ts', 'server/src/services/generation-evidence.service.ts', 'server/src/services/generation-model-budget.ts',
  'server/src/services/authoring-budget.service.ts', 'server/src/components/genai/logger.ts',
  'server/src/types/generation-quality.ts', 'server/src/types/authoring-budget.ts', 'server/src/components/genai/llm/index.ts',
  'server/src/components/genai/llm/model-call.ts', 'server/src/components/genai/llm/openai-usage-adapter.ts', 'server/src/components/genai/llm/request-deadline.ts',
  'server/src/components/genai/llm/model-capabilities.ts', 'server/src/components/genai/llm/authoring-budget.ts', 'server/src/components/genai/llm/provider-usage.ts',
  'server/src/components/genai/llm/latex-escapes.ts', 'server/src/config/env.ts', 'package.json', 'package-lock.json'];
type Identity = { file: string; sha256: string };
type Transcript = PublicNativeCapture & { actualArguments: [string, Record<string, unknown>]; rawResponse: { content: string } };
type ProbeCandidate = GenerationMemoryContent & { taskDescriptor?: NonNullable<AuthoringRequirements['plannedTask']> };
type ProbeCase = { id: 'A-contradictory-novelty' | 'B-retained-replacement'; item: number; packet: GenerationEvidencePacket; memory: GenerationMemorySnapshot;
  candidate: GenerationMemoryContent; requirements: AuthoringRequirements; firstPrompt: string; retained: Transcript; correctionPrompt?: string };
export interface YieldControls { version: 1; scope: 'retained-yield-review-only-v1'; limits: typeof YIELD_LIMITS; step: typeof STEP;
  provider: string; endpoint: string; timeoutMs: 180000; identities: Identity[]; cases: ProbeCase[]; offline: unknown;
  limitations: string[]; saved: 0; adopted: 0; teacherAcceptance: null }
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const objectHash = (value: unknown) => hash(JSON.stringify(value));
const json = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T;
const identity = async (file: string): Promise<Identity> => ({ file: path.resolve(file), sha256: hash(await readFile(file)) });
async function save(file: string, value: unknown, exclusive = false): Promise<void> {
  const temporary = exclusive ? file : `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); if (!exclusive) await rename(temporary, file);
}
const response = (t: Transcript): unknown => JSON.parse(t.rawResponse.content);
const candidate = (prompt: string): GenerationMemoryContent => JSON.parse(prompt.slice(prompt.lastIndexOf('\n\nCANDIDATE: ') + 13));
function line(prompt: string, prefix: string): string { const rows = prompt.split('\n').filter(row => row.startsWith(prefix)); assert.equal(rows.length, 1, prefix); return rows[0].slice(prefix.length); }
export function reconstructRequirements(prompt: string, content: ProbeCandidate, fullPlan?: NonNullable<AuthoringRequirements['plannedTask']>): AuthoringRequirements {
  const changes = JSON.parse(line(prompt, 'Required changes: ')) as string[];
  const plannedText = line(prompt, 'Planned learning task: '); const suffix = '. Check the actual question implements';
  assert(plannedText.indexOf(suffix) > 0, 'Missing planned task boundary.');
  const planned = fullPlan ?? JSON.parse(plannedText.slice(0, plannedText.indexOf(suffix))) as NonNullable<AuthoringRequirements['plannedTask']>;
  if (!fullPlan) { planned.passageIds = [...(content.taskDescriptor?.passageIds ?? [])]; planned.intent = 'create-independent-task'; }
  assert.equal(line(prompt, 'Intent: '), 'create-independent-task.');
  const bound = bindPlannedAuthoringTask({ intent: 'create-independent-task', requiredChanges: changes.slice(1),
    preserve: JSON.parse(line(prompt, 'Preserved invariants: ')), requestedDifficulty: 'easy' }, planned);
  assert.deepEqual(bound.requiredChanges, changes, 'Cannot bind the exact server-planned first requirement.'); return bound;
}
type Complete = typeof completeJson;
const inputFor = (c: ProbeCase, complete: Complete) => ({ packet: c.packet, memory: c.memory, candidate: c.candidate, requirements: c.requirements,
  item: c.item, policy: 'grounded-memory-v2' as const, step: STEP, complete });
export async function replay(c: ProbeCase, responses: unknown[]): Promise<{ assessment: GenerationQualityAssessment; prompts: string[] }> {
  const prompts: string[] = [];
  const complete: Complete = async <T>(prompt: string) => { prompts.push(prompt); assert(prompts.length <= responses.length, 'Unexpected offline completion.'); return structuredClone(responses[prompts.length - 1]) as T; };
  return { assessment: await assessGenerationQuality(inputFor(c, complete)), prompts };
}
export async function reconstructYieldControls(origin: string): Promise<YieldControls> {
  const runFile = path.join(origin, 'first-run-readonly.json'); const fixtureFile = path.join(origin, 'fixture-thin-topic-bank-memory.json'); const plannerFile = path.join(origin, 'private-transcripts', `${PLANNER}.json`);
  const run = (await json<{ run: { result: { quality: { evidence: GenerationEvidencePacket; assessments: GenerationQualityAssessment[] } } } }>(runFile)).run;
  const fixture = await json<{ startingMemory: GenerationMemorySnapshot; sources: Array<{ pdfSha256: string; current: { storagePath: string } }> }>(fixtureFile);
  const files = IDS.map(id => path.join(origin, 'private-transcripts', `${id}.json`)); const ts = await Promise.all(files.map(file => json<Transcript>(file)));
  for (const t of ts) { assert.equal(t.state, 'returned'); assert.equal(t.transport, 'sendMessage'); assert.deepEqual(t.actualArguments[1], NATIVE); }
  const packet = run.result.quality.evidence; const memory = fixture.startingMemory;
  const planner = await json<Transcript>(plannerFile); assert.equal(planner.state, 'returned');
  const tasks = (response(planner) as { tasks: NonNullable<AuthoringRequirements['plannedTask']>[] }).tasks; assert.equal(tasks.length, 3);
  const initial = [ts[0], ts[2]].map((t, index): ProbeCase => ({ id: index === 0 ? 'A-contradictory-novelty' : 'B-retained-replacement', item: index,
    packet, memory, candidate: candidate(t.actualArguments[0]), requirements: reconstructRequirements(t.actualArguments[0], candidate(t.actualArguments[0]), tasks[index]),
    firstPrompt: t.actualArguments[0], retained: t }));
  for (const [i, c] of initial.entries()) {
    const recorded = run.result.quality.assessments.find(a => a.item === i)!; assert.equal(recorded.evidencePacketId, packet.id); assert.equal(recorded.memoryDigest, memory.snapshotDigest);
    const frozen = i === 0 ? recorded.candidate : recorded.semanticRepair?.before; assert(frozen);
    assert.equal(snapshotQualityCandidate(c.candidate).contentHash, frozen.contentHash, 'Retained candidate hash mismatch.');
  }
  const a = await replay(initial[0], [response(ts[0]), response(ts[1])]); assert.equal(a.prompts[0], ts[0].actualArguments[0]);
  assert.equal(a.assessment.status, 'withheld'); assert(a.assessment.responseIssues?.some(issue => issue.code === 'bank-comparator-required'));
  assert.equal(a.prompts.length, 2); assert(a.prompts[1].includes('Do not change booleans merely to pass validation.')); initial[0].correctionPrompt = a.prompts[1];
  const b = await replay(initial[1], [response(ts[2])]); assert.equal(b.prompts[0], ts[2].actualArguments[0]); assert.equal(b.assessment.status, 'withheld');
  const plan = buildGenerationSemanticRepairPlan({ ...initial[1], assessment: b.assessment }); assert(plan); assert.equal(plan.strategy, 'replace-independent-task');
  const bCandidate = candidate(ts[3].actualArguments[0]); const retainedB = run.result.quality.assessments.find(a => a.item === 1)!;
  assert.equal(snapshotQualityCandidate(bCandidate).contentHash, retainedB.candidate?.contentHash);
  assert.equal(snapshotQualityCandidate(bCandidate).contentHash, retainedB.semanticRepair?.after?.contentHash);
  const historicalB = { ...initial[1], candidate: bCandidate, requirements: { ...initial[1].requirements, plannedTask: undefined,
    plannedInferenceRequirement: undefined, original: snapshotQualityCandidate(initial[1].candidate) } };
  const oldB = await replay(historicalB, [response(ts[3])]); assert.equal(oldB.prompts[0], ts[3].actualArguments[0]); assert.equal(oldB.assessment.status, 'withheld');
  assert.deepEqual(plan.requirements.requiredChanges, initial[1].requirements.requiredChanges.slice(1)); assert.deepEqual(plan.requirements.preserve, initial[1].requirements.preserve);
  const currentB = { ...initial[1], candidate: bCandidate, requirements: plan.requirements, retained: ts[3] };
  const newB = await replay(currentB, [response(ts[3])]); assert.equal(newB.assessment.status, 'withheld'); currentB.firstPrompt = newB.prompts[0];
  const pdfs = await Promise.all(fixture.sources.map(async source => { const pin = await identity(source.current.storagePath); assert.equal(pin.sha256, source.pdfSha256); return pin; }));
  const { env } = await import('../../server/src/config/env'); assert.equal(env.llmProvider, ts[0].admission.provider); assert(['openai', 'ubc-llm-sandbox'].includes(env.llmProvider));
  assert.equal(env.llmRequestTimeoutMs, 180000); const endpoint = new URL(env.llmEndpoint || 'https://api.openai.com/v1'); assert(!endpoint.username && !endpoint.password && !endpoint.search);
  return { version: 1, scope: 'retained-yield-review-only-v1', limits: YIELD_LIMITS, step: STEP, provider: env.llmProvider, endpoint: endpoint.href, timeoutMs: 180000,
    identities: [...await Promise.all([...CODE.map(file => path.join(ROOT, file)), runFile, fixtureFile, plannerFile, ...files].map(identity)), ...pdfs], cases: [initial[0], currentB],
    offline: { exactInitialPrompts: 3, A: a, originalB: b, historicalReplacementB: oldB, correctedReplacementB: newB, replacementPlan: plan, originalTranscripts: ts, originalPlannerTranscript: planner,
      historicalCorrectionA: ts[1], sourcePdfHashesVerified: pdfs.length }, saved: 0, adopted: 0, teacherAcceptance: null,
    limitations: ['Review only: no generation, persistence, adoption, publication or live Bank refresh.', 'A and B may duplicate one another. Same frozen seed-only Bank isolates the fixes; two eligible reviews are not two mutually independent saved slots. Recheck current Bank/batch before any adoption.',
      'Lab eligibility is a model judgment, not teacher acceptance or measured general saved yield.', 'Observed native sends exclude hidden SDK retries; unknown usage remains reserved. Historical endpoint was not recorded; the current endpoint is prospectively pinned.'] };
}
export interface YieldLedger { declarationSha256: string; limits: typeof YIELD_LIMITS; accounting: 'conservative-reservations-v1'; reservations: Array<{ id: string; caseId: string; inputEstimate: number; output: number; admissionSha256: string }> }
export function reserveYield(ledger: YieldLedger, declarationSha256: string, admission: PublicNativeAdmission, caseId: string): string {
  assert.equal(ledger.declarationSha256, declarationSha256); assert.deepEqual(ledger.limits, YIELD_LIMITS); assert.equal(ledger.accounting, 'conservative-reservations-v1');
  assert.equal(new Set(ledger.reservations.map(r => r.id)).size, ledger.reservations.length);
  assert(ledger.reservations.every(r => Number.isSafeInteger(r.inputEstimate) && r.inputEstimate > 0 && r.inputEstimate <= YIELD_LIMITS.maxInputTokens && r.output === 2000));
  assert.deepEqual(admission.options, NATIVE); assert.equal(admission.model, STEP.model); assert.equal(admission.outputCap, 2000);
  const inputEstimate = Buffer.byteLength(admission.prompt + (admission.systemPrompt ?? ''), 'utf8') + 32;
  assert(inputEstimate <= YIELD_LIMITS.maxInputTokens, 'yield-probe-input-cap'); assert(ledger.reservations.length < YIELD_LIMITS.maxSends, 'yield-probe-send-cap');
  assert(ledger.reservations.reduce((n, r) => n + r.inputEstimate + r.output, 0) + inputEstimate + admission.outputCap <= YIELD_LIMITS.maxEstimatedTokens, 'yield-probe-total-cap');
  const id = randomUUID(); ledger.reservations.push({ id, caseId, inputEstimate, output: admission.outputCap, admissionSha256: objectHash(admission) }); return id;
}
export async function verifyYieldControls(controls: YieldControls): Promise<void> {
  assert.equal(controls.version, 1); assert.equal(controls.scope, 'retained-yield-review-only-v1'); assert.deepEqual(controls.limits, YIELD_LIMITS); assert.deepEqual(controls.step, STEP);
  assert.equal(controls.timeoutMs, 180000); assert.deepEqual(controls.cases.map(c => c.id), ['A-contradictory-novelty', 'B-retained-replacement']);
  assert.equal(new Set(controls.identities.map(pin => pin.file)).size, controls.identities.length);
  for (const file of CODE) assert(controls.identities.some(pin => pin.file === path.join(ROOT, file)), `Missing code identity: ${file}`);
  for (const pin of controls.identities) assert.equal(hash(await readFile(pin.file)), pin.sha256, `Code/source drift: ${pin.file}`);
  const { env } = await import('../../server/src/config/env'); assert.equal(env.llmProvider, controls.provider); assert.equal(env.llmRequestTimeoutMs, controls.timeoutMs);
  assert.equal(new URL(env.llmEndpoint || 'https://api.openai.com/v1').href, controls.endpoint);
}
export function yieldUsage(events: ModelCallEvent[]) {
  const starts = events.filter(e => e.type === 'started'); const finished = events.filter((e): e is Extract<ModelCallEvent, { type: 'finished' }> => e.type === 'finished');
  const values = (key: 'inputTokens' | 'outputTokens') => finished.flatMap(e => e.usage[key] === null ? [] : [e.usage[key]!]);
  const input = values('inputTokens'); const output = values('outputTokens');
  return { observedSdkCalls: starts.length, finishedCalls: finished.length, knownInputSubtotal: input.length ? input.reduce((a, b) => a + b, 0) : null,
    knownOutputSubtotal: output.length ? output.reduce((a, b) => a + b, 0) : null, inputKnownCalls: input.length, outputKnownCalls: output.length,
    unknownUsageCalls: starts.filter(start => !finished.some(end => end.callId === start.callId && end.usage.inputTokens !== null && end.usage.outputTokens !== null)).length,
    complete: starts.length > 0 && starts.length === finished.length && input.length === starts.length && output.length === starts.length, retryVisibility: 'unknown' };
}
function offlineSocketFence(): () => void {
  const original = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (): never { throw new Error('yield-preflight-network-forbidden'); };
  return () => { net.Socket.prototype.connect = original; };
}
export async function prepareYieldProbe(origin: string, output: string): Promise<string> {
  const restore = offlineSocketFence();
  try {
    await mkdir(output, { recursive: false }); const controls = await reconstructYieldControls(origin); await verifyYieldControls(controls);
    await save(path.join(output, 'controls.json'), controls, true); const controlsPin = await identity(path.join(output, 'controls.json'));
    const declaration = { version: 1, scope: controls.scope, controls: controlsPin, limits: YIELD_LIMITS, saved: 0, adopted: 0, preparedAt: new Date().toISOString(),
      execution: 'Root must supply --live once, exact declaration SHA256, and a new output directory. No provider/DB calls during preparation.' };
    await save(path.join(output, 'declaration.json'), declaration, true); return hash(await readFile(path.join(output, 'declaration.json')));
  } finally { restore(); }
}
export async function executeYieldProbe(declarationFile: string, declarationSha256: string, output: string): Promise<void> {
  assert.match(declarationSha256, /^[a-f0-9]{64}$/); assert.equal(hash(await readFile(declarationFile)), declarationSha256);
  const declaration = await json<{ controls: Identity; limits: typeof YIELD_LIMITS; scope: string }>(declarationFile);
  assert.equal(hash(await readFile(declaration.controls.file)), declaration.controls.sha256); const controls = await json<YieldControls>(declaration.controls.file);
  assert.equal(declaration.scope, controls.scope); assert.deepEqual(declaration.limits, YIELD_LIMITS); await verifyYieldControls(controls);
  await mkdir(output, { recursive: false }); await save(path.join(path.dirname(declarationFile), 'execution-claim.json'), { declarationSha256, output: path.resolve(output), pid: process.pid }, true);
  const ledger: YieldLedger = { declarationSha256, limits: YIELD_LIMITS, accounting: 'conservative-reservations-v1', reservations: [] };
  const ledgerFile = path.join(output, 'ledger.json'); await save(ledgerFile, ledger, true); await mkdir(path.join(output, 'private-transcripts'));
  const facade = await import('../../server/src/components/genai/llm'); const { env } = await import('../../server/src/config/env');
  const { AuthoringBudget, withAuthoringBudget } = await import('../../server/src/components/genai/llm/authoring-budget');
  const { withModelCallObserver } = await import('../../server/src/components/genai/llm/model-call');
  const events: ModelCallEvent[] = []; const outcomes: unknown[] = []; let active = controls.cases[0].id; let status = 'running'; let error: unknown = null; let recordingFailure: unknown;
  const budget = new AuthoringBudget(controls.scope, YIELD_LIMITS); const assertCurrent = async () => { assert(!recordingFailure, 'yield-probe-native-event-recording-failed'); await verifyYieldControls(controls); assert.equal(hash(await readFile(declarationFile)), declarationSha256); assert.equal(hash(await readFile(declaration.controls.file)), declaration.controls.sha256); };
  const observer = installPublicObservation(facade, { configuration: { provider: env.llmProvider, defaultModel: env.llmDefaultModel }, caseId: () => active, assertCurrent,
    reserve: async (admission, caseId) => { const current = await json<YieldLedger>(ledgerFile); const id = reserveYield(current, declarationSha256, admission, caseId); await save(ledgerFile, current); return id; },
    save: async capture => save(path.join(output, 'private-transcripts', `${capture.id}.json`), capture) });
  const persist = async () => save(path.join(output, 'results.json'), { version: 1, status, declarationSha256, outcomes, events, captures: observer.captures,
    budget: budget.snapshot(), usage: yieldUsage(events), ledger: await json(ledgerFile), error, saved: 0, adopted: 0, teacherAcceptance: null, limitations: controls.limitations });
  await persist();
  try {
    for (const c of controls.cases) {
      active = c.id; let calls = 0;
      const complete: Complete = async <T>(prompt: string, options?: Parameters<Complete>[1]): Promise<T> => {
        calls++;
        if (c.id === 'A-contradictory-novelty' && calls === 1) { assert.equal(prompt, c.firstPrompt); return response(c.retained) as T; }
        if (calls === (c.id === 'A-contradictory-novelty' ? 2 : 1)) assert.equal(prompt, c.id === 'A-contradictory-novelty' ? c.correctionPrompt : c.firstPrompt);
        assert.equal(options?.onText, undefined); return facade.completeJson<T>(prompt, options);
      };
      const slot = new AuthoringBudget(`${controls.scope}:${c.id}`, YIELD_LIMITS);
      const assessed = await withAuthoringBudget(budget, () => withAuthoringBudget(slot, () => withModelCallObserver(async event => { events.push(event); try { await persist(); } catch (failure) { recordingFailure = failure; throw failure; } }, () => assessGenerationQuality(inputFor(c, complete)))));
      outcomes.push({ id: c.id, assessment: assessed, candidateHash: snapshotQualityCandidate(c.candidate).contentHash, logicalCompleteCalls: calls }); await persist();
      observer.assertHealthy(); await assertCurrent(); if (observer.captures.some(capture => capture.state !== 'returned') || events.some(event => event.type === 'finished' && event.outcome !== 'succeeded')) throw new Error('yield-probe-native-admission-or-transport-failed');
    }
    await assertCurrent(); status = 'completed';
  } catch (caught) { status = 'stopped'; error = publicSafeError(caught); throw caught; }
  finally { await persist(); observer.restore(); }
}
if (require.main === module) {
  const arg = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
  const output = arg('--output'); assert(output, '--output required');
  void (arg('--live') === undefined
    ? prepareYieldProbe(path.resolve(arg('--origin') ?? path.join(ROOT, 'audit-results/quality-lab-public-http-2026-10-16-bootstrap-live')), path.resolve(output)).then(sha => console.log(JSON.stringify({ preflight: path.resolve(output), declarationSha256: sha, providerCalls: 0 })))
    : (async () => { assert.equal(arg('--live'), 'once'); assert(arg('--declaration') && arg('--declaration-sha256')); await executeYieldProbe(path.resolve(arg('--declaration')!), arg('--declaration-sha256')!, path.resolve(output)); })())
    .catch(error => { console.error(publicSafeError(error)); process.exitCode = 1; });
}
