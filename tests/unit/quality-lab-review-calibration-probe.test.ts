// Portable scripted safety controls. Synthetic declarations never authorize a
// provider. All actual production helpers/SDK calls terminate at denied transport.
jest.mock('../../server/src/config/env', () => ({ env: { llmProvider: 'openai', llmApiKey: 'OFFLINE-TEST-SECRET-NEVER-A-CREDENTIAL',
  llmEndpoint: 'https://api.openai.com/v1', llmDefaultModel: 'gpt-6-luna', llmRequestTimeoutMs: 180000,
  authoringMaxSends: 256, authoringMaxInputTokens: 24000, authoringMaxOutputTokens: 24000, authoringMaxEstimatedTokens: 2000000 } }));
jest.mock('../../server/src/components/mongodb/collections', () => new Proxy({}, { get: () => () => { throw new Error('DB denied'); } }));
jest.mock('../../server/src/components/genai/embeddings', () => ({ embedOne: () => { throw new Error('embedding denied'); } }));
jest.mock('../../server/src/components/qdrant', () => ({ search: () => { throw new Error('vector denied'); } }));
jest.mock('../../server/src/components/jobs', () => ({ defineJob() {}, enqueueJob: () => { throw new Error('queue denied'); } }));
jest.mock('../../server/src/components/param-worker', () => ({ executeGenerate: () => { throw new Error('worker denied'); } }));
jest.mock('../../server/src/components/genai/logger', () => ({ createGenaiLogger: () => ({ info() {}, debug() {}, warn() {}, error() {} }) }));
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import childProcess from 'node:child_process';
import OpenAI from 'openai';
import { llm } from '../../server/src/components/genai/llm';
import { CALIBRATION_CASE_ORDER, CALIBRATION_ARMS, CALIBRATION_SCHEDULE, CALIBRATION_LIMITS, CALIBRATION_FAILURE_POLICY,
  loadReviewCalibrationRuntime, runReviewCalibrationProbe, validateReviewCalibrationLaunch, parseReviewCalibrationCli,
  assertCalibrationAdmissionBudget, assertCalibrationWireBudget, matchesReturnedCalibrationModel,
  type CalibrationCase, type CalibrationDependencies, type CalibrationLaunchOptions, type ReviewCalibrationRuntime } from '../../scripts/prompt-ab/quality-lab-review-calibration-probe';
import type { OpenAICompletionClient } from '../../server/src/components/genai/llm/openai-usage-adapter';
const root = process.cwd(), SECRET = 'OFFLINE-TEST-SECRET-NEVER-A-CREDENTIAL';
const audit = path.join(root, 'audit-results/model-review-calibration-2026-10-17/launcher');
const sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const canonical = (v: unknown): string => JSON.stringify(v, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const relative = (file: string) => path.relative(root, file);
const pin = (file: string) => ({ path: relative(file), sha256: sha(fs.readFileSync(file)), bytes: fs.statSync(file).size });
function write(file: string, value: unknown) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); return pin(file); }
const runtime = loadReviewCalibrationRuntime();
const credentials = () => ({ provider: 'openai', endpoint: 'https://api.openai.com/v1', apiKey: SECRET });
function sourceCases(): CalibrationCase[] { return CALIBRATION_CASE_ORDER.map(id => {
  const text = 'SCRIPTED source: portfolio diversification removes firm-specific risk. Systematic risk remains.';
  return { id, type: 'mcq', candidate: { type: 'mcq', numericKind: 'conceptual', stem: `SCRIPTED ${id}: Which risk does diversification remove?`,
    options: [{ key: 'A', role: 'correct', text: 'Firm-specific risk', explanation: 'SCRIPTED explanation.' },
      { key: 'B', role: 'common-misconception', text: 'Systematic risk', explanation: 'SCRIPTED explanation.' },
      { key: 'C', role: 'partially-correct', text: 'All risk', explanation: 'SCRIPTED explanation.' },
      { key: 'D', role: 'clearly-wrong', text: 'No risk', explanation: 'SCRIPTED explanation.' }] },
    packet: { id: 'scripted-packet-' + id, schemaVersion: 'source-passages-v2', policyVersion: 'grounded-memory-v2', courseId: '000000000000000000000001', loIds: [],
      sourceFingerprint: 'scripted-source-' + id, parsingProvenance: 'unrecorded', materials: [{ materialId: 'material-' + id, name: 'SCRIPTED SOURCE', role: 'primary', revision: 1, activeRunId: null, contentHash: 'scripted-source-' + id, chunkCount: 1 }], findings: [],
      passages: [{ id: 'source-' + id, materialId: 'material-' + id, materialName: 'SCRIPTED SOURCE', role: 'primary', chunkIndex: 0, start: 0, end: text.length, text, selection: 'retrieved' }],
      coverage: { sourceChunks: 1, selectedChunks: 1, selectedCharacters: text.length, omittedPassages: 0, truncated: false, searchScope: 'retrieved-chunks-and-immediate-neighbors' } },
    memory: { entries: [], truncated: false, missingVersions: 0, snapshotDigest: 'scripted-memory-' + id, consistency: 'best-effort' },
    requirements: { intent: 'create-independent-task', requiredChanges: [], preserve: [], requestedType: 'mcq', requestedKind: 'conceptual', requestedDifficulty: 'easy',
      authoringPromptProtocol: 'compact-authoring-v1', answerabilityProtocol: 'option-answerability-v1', taskDemandProtocol: 'task-demand-v1',
      numericReviewProtocol: 'server-rendered-numeric-review-v1', exclusionReviewProtocol: 'literal-exclusion-warrants-v1' } };
}); }
function scripted(candidate: CalibrationCase['candidate']) {
  return { sourceSupport: 'supported', notation: 'consistent', novelty: 'independent', reasons: ['SCRIPTED verdicts only.'],
    citations: [{ kind: 'premise', claim: 'SCRIPTED premise.', spanIds: ['S1'] }, { kind: 'solution', claim: 'SCRIPTED solution.', spanIds: ['S1'] }],
    taskComparisons: [], changes: [], invariants: [], achievedDifficulty: 'easy', justifiedLength: 'justified', missingPremises: [], findings: [],
    taskDemand: { verdict: 'fulfilled', capacity: 'supported', rationale: 'SCRIPTED task label.', missingOperation: '', spanIds: ['S1'] },
    answerability: { kind: 'mcq', options: candidate.options.map(option => ({ key: option.key, verdict: option.role === 'correct' ? 'fully-correct' : 'not-fully-correct',
      reason: 'SCRIPTED literal verdict.', spanIds: ['S1'], exclusion: option.role === 'correct' ? null : { basis: 'direct-contradiction', optionQuote: option.text, stemQuote: '',
        challenge: { status: 'excluded', reason: 'SCRIPTED contradiction.', spanIds: ['S1'] } } })) } };
}
function fixture(change?: (d: Record<string, unknown>) => void) {
  fs.mkdirSync(audit, { recursive: true }); const folder = fs.mkdtempSync(path.join(audit, 'portable-'));
  const historical = { synthetic: true, caseOrder: CALIBRATION_CASE_ORDER, cases: sourceCases() };
  const historicalInputs = write(path.join(folder, 'historical.json'), historical);
  const cases = historical.cases.map(row => ({ ...row, requirements: { ...row.requirements, reviewRepairProtocol: 'frozen-review-decisions-v1' as const } }));
  const fixedInputs = write(path.join(folder, 'inputs.json'), { version: 'review-calibration-fixed-inputs-v1', caseOrder: CALIBRATION_CASE_ORDER, cases });
  const schedule = write(path.join(folder, 'schedule.json'), { version: 1, arms: CALIBRATION_ARMS, schedule: CALIBRATION_SCHEDULE });
  const paths = new Set([...runtime.requiredCodeFiles, ...['scripts/prompt-ab/quality-lab-review-calibration-probe.ts', 'tests/unit/quality-lab-review-calibration-probe.test.ts',
    'package.json', 'package-lock.json', 'server/src/config/env.ts', 'server/src/services/generation-quality.service.ts', 'server/src/services/generation-review-repair.ts',
    'server/src/components/genai/llm/model-capabilities.ts', 'server/src/components/mongodb', 'server/src/components/genai/embeddings', 'server/src/components/qdrant', 'server/src/components/jobs', 'server/src/components/param-worker', 'server/src/components/genai/logger'].map(value => value.endsWith('.ts') || value.endsWith('.json') ? path.join(root, value) : require.resolve(path.join(root, value))), ...runtime.requiredCodeFiles]);
  const currentCode = write(path.join(folder, 'code.json'), { files: [...paths].sort().map(pin) });
  const initialPrompts = CALIBRATION_SCHEDULE.map(cell => { const input = cases.find(row => row.id === cell.caseId)!;
    const prompt = runtime.render(input.packet, runtime.select(input.memory, { query: '' }), input.candidate, [], input.requirements);
    const promptFile = path.join(folder, cell.id + '.txt'); fs.writeFileSync(promptFile, prompt);
    const arm = CALIBRATION_ARMS.find(row => row.id === cell.armId)!;
    const nativeRequest = write(path.join(folder, cell.id + '.native.json'), { model: arm.model, messages: [{ role: 'user', content: prompt }],
      ...(arm.nativeTemperature === 0 ? { temperature: 0 } : {}), response_format: { type: 'json_object' }, stream: false, reasoning_effort: arm.reasoningEffort, max_completion_tokens: 6000 });
    return { id: cell.id, caseId: cell.caseId, armId: cell.armId, prompt: pin(promptFile), nativeRequest,
      productionRequestedOutputCap: arm.reasoningEffort === 'none' ? 2000 : 6000, experimentalNativeOutputCap: 6000 }; });
  const authorizationId = 'review-calibration-new-synthetic-' + randomUUID(), outputDirectory = relative(path.join(folder, 'run'));
  const declaration = { version: 'review-calibration-approved-v1', executionAllowed: true, executionMode: 'offline-fixture', authorizationId, outputDirectory,
    caseOrder: CALIBRATION_CASE_ORDER, arms: CALIBRATION_ARMS, limits: CALIBRATION_LIMITS, failurePolicy: CALIBRATION_FAILURE_POLICY,
    safeConfiguration: { provider: 'openai', endpoint: 'https://api.openai.com/v1', allowedPath: '/chat/completions', streaming: false,
      sdkMaxRetriesRequired: 0, perCallDeadlineMs: 180000, experimentalMaxOutputTokens: 6000 }, historicalInputs, fixedInputs, schedule, currentCode, initialPrompts };
  change?.(declaration); const d = write(path.join(folder, 'declaration.json'), declaration);
  const review = write(path.join(folder, 'review.json'), { status: 'synthetic-reviewed-for-denied-fixture', codeManifestSha256: currentCode.sha256,
    fixedInputsSha256: fixedInputs.sha256, scheduleSha256: schedule.sha256, initialPromptsSha256: sha(canonical(initialPrompts)) });
  const freeze = write(path.join(folder, 'freeze.json'), { version: 'review-calibration-safety-freeze-v1', synthetic: true, reviewed: true, authorizationId,
    declarationSha256: d.sha256, independentReview: review, independentReviewSha256: review.sha256 });
  const message = 'SYNTHETIC ONLY: no paid API approval.';
  const human = write(path.join(folder, 'human.json'), { role: 'synthetic-user', messageId: 'SYNTHETIC', message,
    approves: { authorizationId, declarationSha256: d.sha256, freezeSha256: freeze.sha256 } });
  const approval = write(path.join(folder, 'approval.json'), { version: 'review-calibration-human-approval-v1', synthetic: true, issuer: 'synthetic-test-harness', approved: true,
    authorizationId, declarationSha256: d.sha256, freezeSha256: freeze.sha256, humanMessageId: 'SYNTHETIC', humanMessageSha256: sha(message), humanEvidence: human, approvedAt: '2026-10-17T00:00:00.000Z' });
  const options: CalibrationLaunchOptions = { root, executeApproved: true, offlineFixture: true, declarationPath: d.path, declarationSha256: d.sha256,
    approvalPath: approval.path, approvalSha256: approval.sha256, freezePath: freeze.path, freezeSha256: freeze.sha256, outputDirectory };
  return { folder, cases, options, declaration };
}
function response(model: string, content: unknown, usage: unknown = { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200, prompt_tokens_details: { cached_tokens: 10 }, completion_tokens_details: { reasoning_tokens: 1 } }) {
  return new Response(JSON.stringify({ id: 'SCRIPTED', model, choices: [{ index: 0, message: { role: 'assistant', content: typeof content === 'string' ? content : JSON.stringify(content) }, finish_reason: 'stop' }], usage }),
    { status: 200, headers: { 'content-type': 'application/json' } });
}
function harness(f = fixture(), transform?: (body: Record<string, unknown>, index: number) => Response | Promise<Response>) {
  let count = 0; const posts: Record<string, unknown>[] = [];
  const transport = jest.fn(async (_url: string, init: RequestInit) => { const body = JSON.parse(String(init.body)); posts.push(body);
    if (transform) return transform(body, count++); count++;
    return response(body.model, scripted(f.cases.find(row => String(body.messages[0].content).includes(`SCRIPTED ${row.id}:`))!.candidate)); });
  const factory = jest.fn((config: Parameters<NonNullable<CalibrationDependencies['clientFactory']>>[0]): OpenAICompletionClient => {
    const client = new OpenAI(config); return { create: (request, options) => client.chat.completions.create(request as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, options) }; });
  return { f, posts, transport, factory, dependencies: { runtime, clientFactory: factory, transport, credentials } satisfies CalibrationDependencies };
}
const journal = (f: ReturnType<typeof fixture>) => fs.readFileSync(path.join(f.folder, 'run/journal.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as { sha256: string; body: { kind: string; previous: string; sequence: number; data: Record<string, unknown> } });
function cli(f: ReturnType<typeof fixture>): string[] { return ['--execute-approved', '--approved-declaration', f.options.declarationPath, '--declaration-sha256', f.options.declarationSha256,
  '--human-approval', f.options.approvalPath, '--approval-sha256', f.options.approvalSha256, '--safety-freeze', f.options.freezePath, '--freeze-sha256', f.options.freezeSha256, '--output', f.options.outputDirectory]; }
it('executes the fixed 15-cell schedule through actual quality, completeJson, native adapter and SDK with synthetic denied transport', async () => {
  const h = harness(), original = llm.sendMessage; const options = { ...parseReviewCalibrationCli(cli(h.f), root)!, offlineFixture: true as const };
  const result = await runReviewCalibrationProbe(options, h.dependencies);
  expect(result).toMatchObject({ status: 'completed', plannedCells: 15, plannedCases: 5, sdkSends: 15, physicalWirePosts: 15, unknownUsageSends: 0, saved: 0, adopted: 0, stopCode: null });
  expect(result.cells.every(row => row.state === 'reviewed' && row.formatStatus === 'validated' && row.comparable)).toBe(true);
  expect(result.cells.map(row => row.id)).toEqual(CALIBRATION_SCHEDULE.map(row => row.id));
  expect(result.reportedInputTokens).toBe(1500); expect(result.reportedOutputTokens).toBe(1500); expect(result.reportedReasoningTokens).toBe(15); expect(result.reportedCachedInputTokens).toBe(150);
  expect(h.factory.mock.calls[0][0]).toMatchObject({ maxRetries: 0, timeout: 180000 }); expect(llm.sendMessage).toBe(original);
  for (const cell of result.cells) { const arm = CALIBRATION_ARMS.find(row => row.id === cell.armId)!; const a = cell.attempts[0];
    expect(a.productionRequestedOutputCap).toBe(arm.reasoningEffort === 'none' ? 2000 : 6000); expect(a.experimentalOutputCap).toBe(6000);
    expect(a.inputUnits).toBe(Buffer.byteLength(a.prompt) + 32); expect(a.nativeBodyUtf8Bytes).toBeGreaterThan(a.inputUnits); expect(a.nativeRequest.max_completion_tokens).toBe(6000);
    expect(a.nativeRequest.temperature).toBe(arm.nativeTemperature === 0 ? 0 : undefined); expect(a.evidence).toHaveLength(2); }
  let previous = '0'.repeat(64); for (const row of journal(h.f)) { expect(row.body.previous).toBe(previous); expect(sha(JSON.stringify(row.body))).toBe(row.sha256); previous = row.sha256; }
});
it('requires independent fresh synthetic authority, exact scope and all pins before credentials/client creation', async () => {
  const h = harness(), credentials = jest.fn(h.dependencies.credentials);
  await expect(runReviewCalibrationProbe({ ...h.f.options, executeApproved: false }, { ...h.dependencies, credentials })).rejects.toThrow('calibration-explicit-execution-flag-required');
  await expect(runReviewCalibrationProbe({ ...h.f.options, offlineFixture: undefined }, { ...h.dependencies, credentials })).rejects.toThrow('calibration-execution-mode-invalid');
  await expect(runReviewCalibrationProbe({ ...h.f.options, approvalSha256: '0'.repeat(64) }, { ...h.dependencies, credentials })).rejects.toThrow('calibration-file-drift');
  expect(credentials).not.toHaveBeenCalled(); expect(h.factory).not.toHaveBeenCalled(); expect(h.transport).not.toHaveBeenCalled();
});
it.each(['failurePolicy', 'limits', 'arms', 'safeConfiguration'] as const)('refuses modified %s in the approved declaration', field => {
  const f = fixture(d => { d[field] = null; }); expect(() => validateReviewCalibrationLaunch(f.options)).toThrow('calibration-scope-or-configuration-changed');
});
it.each(['reviewRepairProtocol', 'exactBankProtocol', 'taskRetrievalProtocol'] as const)('refuses changed/forbidden %s even with freshly constructed synthetic pins', key => {
  const f = fixture(); const inputPath = path.join(root, f.declaration.fixedInputs.path), input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  input.cases[0].requirements[key] = 'foreign'; write(inputPath, input);
  expect(() => validateReviewCalibrationLaunch(f.options)).toThrow('calibration-file-drift');
});
it.each(['gpt-6-luna', 'gpt-6-luna-2026-10-01'])('accepts precise returned identity %s', returned => expect(matchesReturnedCalibrationModel('gpt-6-luna', returned)).toBe(true));
it.each(['gpt-6-luna-extra', 'other-gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-luna-2026-1-1', ''])('refuses imprecise/cross-arm identity %s', returned => expect(matchesReturnedCalibrationModel('gpt-6-luna', returned)).toBe(false));
it.each(['gpt-6.1-sol', null])('stops on actual response model mismatch/unknown %s and preserves all missing denominators', async model => {
  const h = harness(undefined, () => response(model as unknown as string, '{}'));
  const r = await runReviewCalibrationProbe(h.f.options, h.dependencies); expect(r).toMatchObject({ status: 'partial', sdkSends: 1, physicalWirePosts: 1, stopCode: 'calibration-returned-model-identity-stop' });
  expect(r.cells.filter(row => row.state === 'not-started')).toHaveLength(14); expect(h.transport).toHaveBeenCalledTimes(1);
});
it('charges native JSON correction at the common 6000 cap and permits known complete format exhaustion then the next cell', async () => {
  const f = fixture(), h = harness(f, (body, index) => index < 2 ? response(String(body.model), 'not JSON') : response(String(body.model), scripted(f.cases.find(row => String((body.messages as Array<{ content: string }>)[0].content).includes(`SCRIPTED ${row.id}:`))!.candidate)));
  const r = await runReviewCalibrationProbe(f.options, h.dependencies);
  expect(r).toMatchObject({ status: 'completed', sdkSends: 16, physicalWirePosts: 16, stopCode: null }); expect(r.cells[0].state).toBe('cell-format-invalid');
  expect(r.cells[0].logicalReviews[0].state).toBe('known-json-exhausted'); expect(r.cells[0].attempts.map(row => row.jsonAttempt)).toEqual([0, 1]);
  expect(r.cells[0].attempts.every(row => row.nativeRequest.max_completion_tokens === 6000 && row.state === 'known')).toBe(true);
});
it('does not trust an exception named JSON exhaustion without both durable attempts', async () => {
  const h = harness(), bad: ReviewCalibrationRuntime = { ...runtime, complete: async () => { throw new Error('llm-json-parse-failed'); } };
  const r = await runReviewCalibrationProbe(h.f.options, { ...h.dependencies, runtime: bad }); expect(r).toMatchObject({ status: 'partial', sdkSends: 0, stopCode: 'calibration-completion-interrupted' });
});
it('keeps known usage but missing usage on any native retry globally terminal', async () => {
  const h = harness(undefined, (body, index) => response(String(body.model), 'not JSON', index === 0 ? { prompt_tokens: 1, completion_tokens: 1 } : null));
  const r = await runReviewCalibrationProbe(h.f.options, h.dependencies); expect(r).toMatchObject({ status: 'partial', sdkSends: 2, physicalWirePosts: 2, unknownUsageSends: 1, stopCode: 'calibration-unknown-usage-stop' });
});
it('preserves repaired initial schema issues while classifying the successful final correction as format valid', async () => {
  const f = fixture(), h = harness(f, (body, index) => { const value = scripted(f.cases.find(row => String((body.messages as Array<{ content: string }>)[0].content).includes(`SCRIPTED ${row.id}:`))!.candidate);
    if (index === 0) (value.citations[0] as { spanIds: string[] }).spanIds = ['S999']; return response(String(body.model), value); });
  const r = await runReviewCalibrationProbe(f.options, h.dependencies);
  expect(r.status).toBe('completed'); expect(r.cells[0].logicalReviews).toHaveLength(2); expect(r.cells[0].quality?.responseIssues?.some(i => i.attempt === 0)).toBe(true);
  expect(r.cells[0]).toMatchObject({ formatStatus: 'validated', comparable: true });
});
it('does not mark semantic decision drift comparable merely because final syntax is valid', async () => {
  const f = fixture(), h = harness(f, (body, index) => { const value = scripted(f.cases.find(row => String((body.messages as Array<{ content: string }>)[0].content).includes(`SCRIPTED ${row.id}:`))!.candidate);
    if (index === 0) { value.novelty = 'duplicate'; value.citations[0].spanIds = ['S999']; } return response(String(body.model), value); });
  const r = await runReviewCalibrationProbe(f.options, h.dependencies);
  expect(r.status).toBe('completed'); expect(r.cells[0].quality?.reviewRepair?.status).toBe('drift'); expect(r.cells[0].comparable).toBe(false);
});
it('refuses a swallowed forbidden-stage guard and stops before any SDK call', async () => {
  const h = harness(), bad: ReviewCalibrationRuntime = { ...runtime, assess: async input => { try { await input.complete!<unknown>('FORBIDDEN', { model: 'gpt-6-luna', usageContext: { stage: 'generator', item: 0 } }); } catch { /* simulate service catch */ }
    return runtime.assess({ ...input, complete: async <T>() => scripted(input.candidate) as T }); } };
  const r = await runReviewCalibrationProbe(h.f.options, { ...h.dependencies, runtime: bad }); expect(r).toMatchObject({ status: 'partial', sdkSends: 0, physicalWirePosts: 0, stopCode: 'calibration-forbidden-stage-model-or-prompt' });
});
it.each(['host', 'body', 'headers', 'retry', 'second-wire'] as const)('refuses %s wire bypass with sticky poison', async attack => {
  const h = harness(); const clientFactory: NonNullable<CalibrationDependencies['clientFactory']> = config => ({ create: async (request, options) => {
    const headers = { authorization: 'Bearer ' + SECRET, 'content-type': 'application/json', 'x-stainless-retry-count': attack === 'retry' ? '1' : '0', ...(attack === 'headers' ? { evil: 'header' } : {}) };
    const init = { method: 'POST', body: JSON.stringify(attack === 'body' ? { ...request, model: 'foreign' } : request), headers, signal: options?.signal };
    if (attack === 'host') { try { await config.fetch('https://evil.invalid/', init); } catch { /* cannot refresh permission */ } }
    const first = await config.fetch('https://api.openai.com/v1/chat/completions', init); if (attack === 'second-wire') await config.fetch('https://api.openai.com/v1/chat/completions', init); return first.json(); } });
  const r = await runReviewCalibrationProbe(h.f.options, { ...h.dependencies, clientFactory }); expect(r.status).toBe('partial'); expect(h.transport).toHaveBeenCalledTimes(attack === 'second-wire' ? 1 : 0);
});
it.each(['sdk-reserved', 'wire-reserved', 'sdk-result'] as const)('fsync failure at %s is terminal and cannot trigger a correction', async kind => {
  const h = harness(); let failed = false; const fsync = (fd: number) => { const log = path.join(h.f.folder, 'run/journal.jsonl');
    if (!failed && fs.existsSync(log) && fs.readFileSync(log, 'utf8').includes(`"kind":"${kind}"`)) { failed = true; throw new Error('SCRIPTED fsync refusal'); } fs.fsyncSync(fd); };
  const r = await runReviewCalibrationProbe(h.f.options, { ...h.dependencies, fsync }); expect(r.status).toBe('partial'); expect(r.stopCode).toBe('calibration-durable-recording-failed');
  expect(h.transport).toHaveBeenCalledTimes(kind === 'sdk-result' ? 1 : 0); const receipt = JSON.parse(fs.readFileSync(path.join(h.f.folder, 'run/terminal-receipt.json'), 'utf8'));
  expect(receipt.journalStatus).toBe('incomplete-no-resume');
});
it('rechecks complete input pins after the wire response and retains an unknown reservation', async () => {
  const h = harness(undefined, () => { fs.appendFileSync(path.join(h.f.folder, 'inputs.json'), ' '); return response('gpt-6-luna', '{}'); });
  const r = await runReviewCalibrationProbe(h.f.options, h.dependencies); expect(r).toMatchObject({ status: 'partial', sdkSends: 1, physicalWirePosts: 1, unknownUsageSends: 1 }); expect(h.transport).toHaveBeenCalledTimes(1);
});
it('cannot reuse an authorization with an alias, output change, or a restart', async () => {
  const h = harness(); await runReviewCalibrationProbe(h.f.options, h.dependencies);
  await expect(runReviewCalibrationProbe(h.f.options, h.dependencies)).rejects.toThrow('calibration-resume-forbidden');
  await expect(runReviewCalibrationProbe({ ...h.f.options, outputDirectory: h.f.options.outputDirectory + '-copy' }, h.dependencies)).rejects.toThrow('calibration-scope-or-configuration-changed');
});
it.each([{ sdkReservations: 20, conservativeReservations: 1 }, { sdkReservations: 0, conservativeReservations: 599000 }, { sdkReservations: -1, conservativeReservations: 0 }])('refuses send, units or corrupt budget %j', state => expect(() => assertCalibrationAdmissionBudget(state, 1000, 6000)).toThrow());
it('independently refuses physical POST ceiling and output/input changes', () => {
  expect(() => assertCalibrationWireBudget(20)).toThrow('calibration-physical-post-limit'); expect(() => assertCalibrationWireBudget(NaN)).toThrow();
  expect(() => assertCalibrationAdmissionBudget({ sdkReservations: 0, conservativeReservations: 0 }, 24001, 6000)).toThrow();
  expect(() => assertCalibrationAdmissionBudget({ sdkReservations: 0, conservativeReservations: 0 }, 1000, 2000)).toThrow();
});
it('strictly parses the review-only CLI and has no model, input, cap, offline or endpoint override', () => {
  expect(parseReviewCalibrationCli([])).toBeNull(); for (const flag of ['--model', '--endpoint', '--offline-fixture', '--max-sends', '--arbitrary-inputs']) expect(() => parseReviewCalibrationCli([flag, 'anything'])).toThrow('calibration-cli-unknown-argument');
  const f = fixture(); const { offlineFixture: _offline, ...expected } = f.options; expect(parseReviewCalibrationCli(cli(f), root)).toEqual(expected);
  expect(() => parseReviewCalibrationCli([...cli(f), '--output', 'other'])).toThrow('calibration-cli-argument-required');
});
it('binds the durable exclusive claim before credential access', async () => {
  const h = harness(); let seen = false; const getCredentials = () => { const claim = path.join(audit, 'execution-claims', h.f.declaration.authorizationId + '.json');
    seen = fs.existsSync(claim); expect(JSON.parse(fs.readFileSync(claim, 'utf8')).state).toBe('claimed-no-resume-no-refill'); return credentials(); };
  expect((await runReviewCalibrationProbe(h.f.options, { ...h.dependencies, credentials: getCredentials })).status).toBe('completed'); expect(seen).toBe(true);
});
it('charges both logical correction and each native JSON correction independently before their SDK dispatch', async () => {
  const f = fixture(), h = harness(f, (body, index) => { if (index === 0 || index === 2) return response(String(body.model), 'not JSON');
    const value = scripted(f.cases.find(row => String((body.messages as Array<{ content: string }>)[0].content).includes(`SCRIPTED ${row.id}:`))!.candidate);
    if (index === 1) value.citations[0].spanIds = ['S999']; return response(String(body.model), value); });
  const r = await runReviewCalibrationProbe(f.options, h.dependencies); expect(r).toMatchObject({ status: 'completed', sdkSends: 18, physicalWirePosts: 18 });
  expect(r.cells[0].attempts.map(a => [a.logicalAttempt, a.jsonAttempt])).toEqual([[0, 0], [0, 1], [1, 0], [1, 1]]);
  expect(r.cells[0].attempts.every(a => a.experimentalOutputCap === 6000 && a.conservativeReservation === a.inputUnits + 6000)).toBe(true);
});
it('rejects repeated native jsonAttempt0 before a second physical post', async () => {
  const h = harness(undefined, body => response(String(body.model), 'not JSON'));
  const bad: ReviewCalibrationRuntime = { ...runtime, complete: (prompt, options) => runtime.complete(prompt, { ...options,
    beforeRequest: admission => options!.beforeRequest!({ ...admission, jsonAttempt: 0 }) }) };
  const r = await runReviewCalibrationProbe(h.f.options, { ...h.dependencies, runtime: bad }); expect(r).toMatchObject({ status: 'partial', sdkSends: 1, physicalWirePosts: 1, stopCode: 'calibration-json-admission-invalid' });
});
it('separates complete known schema exhaustion from a phase fault, retaining the 15-cell denominator', async () => {
  const f = fixture(), h = harness(f, (body, index) => response(String(body.model), index < 2 ? {} : scripted(f.cases.find(row => String((body.messages as Array<{ content: string }>)[0].content).includes(`SCRIPTED ${row.id}:`))!.candidate)));
  const r = await runReviewCalibrationProbe(f.options, h.dependencies); expect(r).toMatchObject({ status: 'completed', sdkSends: 16, physicalWirePosts: 16 });
  expect(r.cells[0]).toMatchObject({ state: 'cell-format-invalid', formatStatus: 'invalid', comparable: false }); expect(r.cells).toHaveLength(15);
});
it('stops at 20 actual SDK sends/posts without refilling even when all cells have known format failures', async () => {
  const h = harness(undefined, body => response(String(body.model), {})); const r = await runReviewCalibrationProbe(h.f.options, h.dependencies);
  expect(r).toMatchObject({ status: 'partial', sdkSends: 20, physicalWirePosts: 20, stopCode: 'calibration-sdk-send-limit' });
  expect(r.cells.filter(c => c.state === 'not-started')).toHaveLength(5); expect(r.conservativeReservations).toBeLessThanOrEqual(600000);
});
it('cannot make whole-cell comparisons from a caught local failure lacking required guarded receipts', async () => {
  const h = harness(), bad: ReviewCalibrationRuntime = { ...runtime, assess: async input => { const q = await runtime.assess(input); delete q.reviewRepair; return q; } };
  const r = await runReviewCalibrationProbe(h.f.options, { ...h.dependencies, runtime: bad }); expect(r.status).toBe('completed');
  expect(r.cells.every(c => c.comparable === false && c.decisionIntegrityStatus === 'unavailable')).toBe(true);
});
it('a transport exception/HTTP failure is globally sticky and records all unstarted cells', async () => {
  const h = harness(undefined, () => new Response('{}', { status: 503 })); const r = await runReviewCalibrationProbe(h.f.options, h.dependencies);
  expect(r).toMatchObject({ status: 'partial', sdkSends: 1, physicalWirePosts: 1, unknownUsageSends: 1, stopCode: 'calibration-http-or-redirect-stop' });
  expect(r.cells.filter(c => c.state === 'not-started')).toHaveLength(14); expect(h.transport).toHaveBeenCalledTimes(1);
});
it('deadline and late response cannot alter a terminal journal or returned snapshot', async () => {
  const h = harness(); let release: ((r: Response) => void) | undefined; const transport = () => new Promise<Response>(resolve => { release = resolve; });
  jest.useFakeTimers(); try { const running = runReviewCalibrationProbe(h.f.options, { ...h.dependencies, transport });
    for (let i = 0; i < 40 && !release; i++) await Promise.resolve(); expect(release).toBeDefined(); await jest.advanceTimersByTimeAsync(180001);
    const r = await running; expect(r).toMatchObject({ status: 'partial', sdkSends: 1, physicalWirePosts: 1, unknownUsageSends: 1 });
    const frozen = JSON.stringify(r), log = fs.readFileSync(path.join(h.f.folder, 'run/journal.jsonl'), 'utf8'); release!(response('gpt-6-luna', '{}')); await jest.advanceTimersByTimeAsync(1);
    expect(JSON.stringify(r)).toBe(frozen); expect(fs.readFileSync(path.join(h.f.folder, 'run/journal.jsonl'), 'utf8')).toBe(log);
  } finally { jest.useRealTimers(); }
});
// The child proof does not use Jest module virtualization. The test fixture is
// still explicitly synthetic, and the real SDK receives an intercepted fetch.
export async function runNativeFixture() {
  const f = fixture(); let physical = 0; const result = await runReviewCalibrationProbe({ ...parseReviewCalibrationCli(cli(f), root)!, offlineFixture: true }, { runtime, credentials,
    transport: async (_url, init) => { physical++; const body = JSON.parse(String(init.body)); return response(body.model, scripted(f.cases.find(row => body.messages[0].content.includes(`SCRIPTED ${row.id}:`))!.candidate)); } });
  write(path.join(f.folder, 'native-proof.json'), { scope: 'actual native process, production quality/completeJson/native adapter/OpenAI SDK; synthetic responses; network denied', result, physical }); return { folder: f.folder, result, physical };
}
it('runs all 15 cells in a separate native Node process through actual production runtime/adapter/SDK and parsed CLI options', () => {
  const file = path.join(audit, 'portable-native-proof.cjs'); fs.mkdirSync(audit, { recursive: true });
  fs.writeFileSync(file, `require('tsx/cjs'); const fs=require('node:fs'); const path=require('node:path'); const Module=require('node:module');\nconst test=path.resolve('tests/unit/quality-lab-review-calibration-probe.test.ts'); const nativeRequire=Module.createRequire(test);\nglobal.jest={mock:(id,factory)=>{const idPath=nativeRequire.resolve(id); const m=new Module(idPath);m.filename=idPath;m.loaded=true;m.exports=factory(); require.cache[idPath]=m;}};\nconst noop=()=>{};noop.each=()=>noop;global.it=noop;\nnativeRequire(test).runNativeFixture().then(v=>process.stdout.write(JSON.stringify({status:v.result.status,cells:v.result.cells.length,sdk:v.result.sdkSends,physical:v.physical,folder:v.folder,stop:v.result.stopCode})+'\\n')).catch(e=>{process.stderr.write(String(e.stack));process.exitCode=1;});\n`);
  const output = childProcess.execFileSync(process.execPath, [file], { cwd: root, encoding: 'utf8', timeout: 120000 });
  const result = JSON.parse(output.trim().split('\n').at(-1)!); expect(result).toMatchObject({ status: 'completed', cells: 15, sdk: 15, physical: 15, stop: null });
}, 130000);
