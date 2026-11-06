// Isolated future-launcher safety only. Synthetic authorization, intercepted
// SDK HTTP and scripted judgments; no provider/network/DB/queue operation.
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
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import childProcess from 'node:child_process';
import { llm } from '../../server/src/components/genai/llm';
import { assertProbeAdmissionBudget, loadProbeRuntime, PROBE_CASE_ORDER, PROBE_LIMITS, runExclusionWarrantsProbe, validateProbeLaunch,
  type ProbeCase, type ProbeDependencies, type ProbeLaunchOptions, type ProbeRuntime } from '../../scripts/prompt-ab/quality-lab-exclusion-warrants-probe';
import type { OpenAICompletionClient } from '../../server/src/components/genai/llm/openai-usage-adapter';
import { contentFingerprint } from '../../server/src/services/generation-memory.service';

const root = process.cwd();
const audit = path.join(root, 'audit-results/answer-exclusion-warrants-2026-10-17/launcher-r1');
const proposed = path.join(root, 'audit-results/answer-exclusion-warrants-2026-10-17/proposed-paid-preflight-r1');
const SECRET = 'OFFLINE-TEST-SECRET-NEVER-A-CREDENTIAL';
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const relative = (file: string) => path.relative(root, file);
const pin = (file: string) => ({ path: relative(file), sha256: sha(fs.readFileSync(file)) });
const runtime = loadProbeRuntime();
const historical = JSON.parse(fs.readFileSync(path.join(root, 'audit-results/quality-lab-source-interpretation-2026-10-17-live-r8/results.json'), 'utf8')) as {
  captures: Array<{ caseId: string; rawResponse: { content: string } }> };
const directories: string[] = [];
function write(file: string, value: unknown) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); return pin(file); }
function fixture(change?: (source: { caseOrder: string[]; cases: ProbeCase[] }) => void) {
  fs.mkdirSync(audit, { recursive: true }); const folder = fs.mkdtempSync(path.join(audit, 'mock-unit-')); directories.push(folder);
  const source = JSON.parse(fs.readFileSync(path.join(proposed, 'fixed-five-contexts.json'), 'utf8')) as { caseOrder: string[]; cases: ProbeCase[] };
  change?.(source);
  const inputs = write(path.join(folder, 'inputs.json'), source);
  const paths = new Set([...runtime.requiredCodeFiles, path.join(root, 'scripts/prompt-ab/quality-lab-exclusion-warrants-probe.ts'),
    path.join(root, 'tests/unit/quality-lab-exclusion-warrants-probe.test.ts'), path.join(root, 'package-lock.json'), path.join(root, 'package.json'), path.join(root, 'server/src/config/env.ts')]);
  const manifest = write(path.join(folder, 'code.json'), { files: [...paths].sort().map(pin) });
  const initial = JSON.parse(fs.readFileSync(path.join(proposed, 'exact-prompt-and-native-shapes.json'), 'utf8')) as { initials: unknown[] };
  const authorizationId = `exclusion-warrants-new-synthetic-${randomUUID()}`;
  const declaration = { version: 'exclusion-warrants-quality-probe-approved-v1', executionAllowed: true, executionMode: 'offline-fixture', authorizationId,
    caseOrder: PROBE_CASE_ORDER, limits: PROBE_LIMITS, safeConfiguration: { provider: 'openai', endpoint: 'https://api.openai.com/v1', allowedPath: '/chat/completions',
      model: 'gpt-6-luna', reasoningEffort: 'none', temperature: 0, maxOutputTokens: 2000, sdkMaxRetriesRequired: 0, streaming: false, perCallDeadlineMs: 180000 },
    fixedInputs: inputs, currentCode: manifest, initialPrompts: initial.initials.map(value => ({ id: (value as { id: string }).id, prompt: (value as { prompt: unknown }).prompt })) };
  const declarationPin = write(path.join(folder, 'declaration.json'), declaration);
  const reviewPin = write(path.join(folder, 'review.json'), { status: 'reviewed-safe-for-approval', codeManifestSha256: manifest.sha256, fixedInputsSha256: inputs.sha256,
    note: 'SCRIPTED test evidence, never actual human approval.' });
  const freezePin = write(path.join(folder, 'freeze.json'), { version: 'exclusion-warrants-safety-freeze-v1', synthetic: true, reviewed: true, authorizationId,
    declarationSha256: declarationPin.sha256, independentReview: reviewPin, independentReviewSha256: reviewPin.sha256 });
  const message = 'SYNTHETIC TEST ONLY; no human API authorization is provided.';
  const humanPin = write(path.join(folder, 'human.json'), { role: 'user', messageId: 'SYNTHETIC-TEST', message,
    approves: { authorizationId, declarationSha256: declarationPin.sha256, freezeSha256: freezePin.sha256 } });
  const approvalPin = write(path.join(folder, 'approval.json'), { version: 'exclusion-warrants-human-approval-v1', synthetic: true, issuer: 'human-user', approved: true,
    authorizationId, declarationSha256: declarationPin.sha256, freezeSha256: freezePin.sha256, humanMessageId: 'SYNTHETIC-TEST', humanMessageSha256: sha(message),
    humanEvidence: humanPin, approvedAt: '2026-10-17T00:00:00.000Z', note: 'SCRIPTED test only' });
  const options: ProbeLaunchOptions = { root, executeApproved: true, offlineFixture: true, declarationPath: declarationPin.path, declarationSha256: declarationPin.sha256,
    approvalPath: approvalPin.path, approvalSha256: approvalPin.sha256, freezePath: freezePin.path, freezeSha256: freezePin.sha256, outputDirectory: relative(path.join(folder, 'run')) };
  return { folder, source, options, declaration, declarationPin, approvalPin, freezePin, manifest };
}
function scripted(id: string, candidate: ProbeCase['candidate']): Record<string, unknown> {
  const captures = historical.captures.filter(row => row.caseId === id && row.rawResponse.content.includes('"sourceSupport"'));
  const raw = JSON.parse(captures.at(-1)!.rawResponse.content);
  raw.answerability.options = raw.answerability.options.map((row: Record<string, unknown>) => {
    const option = candidate.options.find(value => value.key === row.key)!;
    const negative = row.verdict === 'not-fully-correct';
    const basis = row.exclusionBasis === 'explicit-stem-condition' ? 'explicit-task-restriction' : row.exclusionBasis === 'incomplete-response' ? 'required-component-missing' : 'direct-contradiction';
    return { key: row.key, verdict: row.verdict, reason: String(row.reason).slice(0, 180), spanIds: row.spanIds,
      exclusion: negative ? { basis, optionQuote: option.text.slice(0, 120), stemQuote: basis === 'direct-contradiction' ? '' : String(row.stemQuote).slice(0, 120),
        challenge: { status: 'excluded', reason: 'SCRIPTED shape test only, no semantic acceptance.', spanIds: row.spanIds } } : null };
  });
  return raw;
}
function harness(f = fixture(), responses?: Array<string | object>, transportOverride?: ProbeDependencies['transport']) {
  let index = 0; const posts: Array<{ url: string; body: Record<string, unknown>; redirect: RequestRedirect | undefined }> = [];
  const transport = jest.fn(async (url: string, init: RequestInit) => {
    posts.push({ url, body: JSON.parse(String(init.body)), redirect: init.redirect });
    if (transportOverride) return transportOverride(url, init);
    const caseId = PROBE_CASE_ORDER[Math.min(index, 4)];
    const output = responses ? responses[index] ?? responses.at(-1)! : scripted(caseId, f.source.cases.find(row => row.id === caseId)!.candidate);
    index++;
    return new Response(JSON.stringify({ id: 'SCRIPTED-ID', model: 'gpt-6-luna', choices: [{ message: { content: typeof output === 'string' ? output : JSON.stringify(output) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const factory = jest.fn((config: Parameters<NonNullable<ProbeDependencies['clientFactory']>>[0]): OpenAICompletionClient => {
    const client = new OpenAI(config); return { create: (request, options) => client.chat.completions.create(request as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, options) };
  });
  return { f, posts, transport, factory, dependencies: { runtime, clientFactory: factory, transport,
    credentials: () => ({ provider: 'openai', endpoint: 'https://api.openai.com/v1', apiKey: SECRET }) } satisfies ProbeDependencies };
}
const journal = (folder: string) => fs.readFileSync(path.join(folder, 'run/journal.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line).body as { kind: string; data: Record<string, unknown> });
afterAll(() => {
  // Keep only public synthetic test artifacts as an explicit audit index.
  write(path.join(audit, 'owned-unit-artifacts.json'), { status: 'Synthetic files only; no actual authorization or provider calls', directories: directories.map(relative) });
});

it('refuses DRAFT/no execution flag and mismatched external approval before credentials or clients', async () => {
  const h = harness(); const credentials = jest.fn(h.dependencies.credentials);
  await expect(runExclusionWarrantsProbe({ ...h.f.options, executeApproved: false }, { ...h.dependencies, credentials })).rejects.toThrow('probe-explicit-execution-flag-required');
  const draft = pin(path.join(proposed, 'declaration-DRAFT.json'));
  await expect(runExclusionWarrantsProbe({ ...h.f.options, declarationPath: draft.path, declarationSha256: draft.sha256 }, { ...h.dependencies, credentials })).rejects.toThrow('probe-declaration-not-approved');
  await expect(runExclusionWarrantsProbe({ ...h.f.options, approvalSha256: '0'.repeat(64) }, { ...h.dependencies, credentials })).rejects.toThrow('probe-file-drift');
  expect(credentials).not.toHaveBeenCalled(); expect(h.factory).not.toHaveBeenCalled(); expect(h.transport).not.toHaveBeenCalled();
  await expect(runExclusionWarrantsProbe({ ...h.f.options, offlineFixture: undefined }, { ...h.dependencies, credentials })).rejects.toThrow('probe-execution-mode-invalid');
});

it('executes exact five quality-only scripted reviews through real completeJson/native SDK with maxRetries0 and restores facade', async () => {
  const h = harness(), original = llm.sendMessage;
  const result = await runExclusionWarrantsProbe(h.f.options, h.dependencies);
  expect(result).toMatchObject({ status: 'completed', plannedCases: 5, sdkSends: 5, physicalWirePosts: 5, stopCode: null, unknownUsageSends: 0, saved: 0, adopted: 0 });
  expect(result.cases.map(row => row.id)).toEqual(PROBE_CASE_ORDER); expect(result.cases.every(row => row.state === 'reviewed')).toBe(true);
  expect(result.conservativeReservations).toBe(111588); expect(h.factory.mock.calls[0][0].maxRetries).toBe(0);
  expect(h.posts.every(post => post.url === 'https://api.openai.com/v1/chat/completions' && post.redirect === 'error')).toBe(true);
  expect(llm.sendMessage).toBe(original);
  for (const row of journal(h.f.folder).filter(row => row.kind === 'production-model-observer')) expect((row.data.usageContext as { stage: string }).stage).toBe('quality-review');
  const wire = journal(h.f.folder).find(row => row.kind === 'wire-reserved')!;
  expect(wire.data.body).toEqual(h.posts[0].body); expect((wire.data.body as { max_completion_tokens: number }).max_completion_tokens).toBe(2000);
  expect(fs.readFileSync(path.join(h.f.folder, 'run/journal.jsonl'), 'utf8')).not.toContain(SECRET);
});

it('counts nested JSON plus same-candidate schema corrections against the same SDK/wire allowance', async () => {
  const f = fixture(), good = scripted('P01', f.source.cases[0].candidate) as Record<string, unknown>;
  const malformed = structuredClone(good); (malformed.answerability as { options: Array<{ key: string }> }).options[1].key = 'A';
  const outputs = ['NOT JSON', malformed, 'NOT JSON', good, ...PROBE_CASE_ORDER.slice(1).map(id => scripted(id, f.source.cases.find(row => row.id === id)!.candidate))];
  const h = harness(f, outputs); const result = await runExclusionWarrantsProbe(f.options, h.dependencies);
  expect(result).toMatchObject({ status: 'completed', sdkSends: 8, physicalWirePosts: 8 });
  expect(h.posts[1].body.messages).toEqual([{ role: 'user', content: expect.stringContaining('Your previous reply was not valid JSON.') }]);
  expect(h.posts[2].body.messages).toEqual([{ role: 'user', content: expect.stringContaining('SAME-CANDIDATE REVIEW CORRECTION') }]);
});

it('stops partial before dispatch11 without recycling known usage reservations', async () => {
  const f = fixture();
  const bad = (id: string) => { const value = scripted(id, f.source.cases.find(row => row.id === id)!.candidate) as Record<string, unknown>;
    (value.answerability as { options: Array<{ key: string }> }).options[1].key = 'A'; return value; };
  const outputs = PROBE_CASE_ORDER.flatMap(id => ['NOT JSON', bad(id), 'NOT JSON', bad(id)]);
  const h = harness(f, outputs); const result = await runExclusionWarrantsProbe(f.options, h.dependencies);
  expect(result.status).toBe('partial'); expect(result.sdkSends).toBe(10); expect(result.physicalWirePosts).toBe(10);
  expect(h.transport).toHaveBeenCalledTimes(10); expect(result.cases.filter(row => row.state === 'not-started').length).toBeGreaterThan(0);
  expect(result.conservativeReservations).toBeGreaterThan(result.reportedInputTokens + result.reportedOutputTokens);
  expect(result.cases.find(row => row.state === 'interrupted')).not.toHaveProperty('quality');
});

it.each([
  [{ sdkReservations: 10, conservativeReservations: 100 }, 1000, 2000, 'probe-sdk-send-limit'],
  [{ sdkReservations: 1, conservativeReservations: 259999 }, 1000, 2000, 'probe-total-reservation-limit'],
  [{ sdkReservations: 0, conservativeReservations: 0 }, 24001, 2000, 'probe-per-send-input-or-output-limit'],
  [{ sdkReservations: 0, conservativeReservations: 0 }, 1000, 2001, 'probe-per-send-input-or-output-limit'],
] as const)('fails closed at each independent arithmetic bound %#', (state, input, output, code) => {
  expect(() => assertProbeAdmissionBudget(state, input, output)).toThrow(code);
});

it('retains unknown usage reservation and stops before the next case/JSON repair', async () => {
  const h = harness(undefined, undefined, async () => new Response(JSON.stringify({ id: 'unknown', model: 'gpt-6-luna', choices: [{ message: { content: 'NOT JSON' } }] }), { status: 200 }));
  const result = await runExclusionWarrantsProbe(h.f.options, h.dependencies);
  expect(result).toMatchObject({ status: 'partial', sdkSends: 1, physicalWirePosts: 1, conservativeReservations: 21354, unknownUsageSends: 1, stopCode: 'probe-unknown-usage-stop' });
  expect(h.transport).toHaveBeenCalledTimes(1); expect(result.cases[0].state).toBe('interrupted'); expect(result.cases.slice(1).every(row => row.state === 'not-started')).toBe(true);
});

it.each([302, 401, 500])('does not follow/retry HTTP%s or journal a secret-echoing provider error', async status => {
  const h = harness(undefined, undefined, async () => new Response(JSON.stringify({ error: { message: SECRET } }), { status, headers: { location: 'https://evil.invalid/' } }));
  const result = await runExclusionWarrantsProbe(h.f.options, h.dependencies);
  expect(result.status).toBe('partial'); expect(result.sdkSends).toBe(1); expect(h.transport).toHaveBeenCalledTimes(1);
  expect(result.conservativeReservations).toBe(21354); expect(fs.readFileSync(path.join(h.f.folder, 'run/journal.jsonl'), 'utf8')).not.toContain(SECRET);
});

it.each(['host', 'body', 'second-wire'] as const)('refuses %s physical-wire bypass before another POST', async attack => {
  const h = harness();
  const factory: NonNullable<ProbeDependencies['clientFactory']> = config => ({ create: async request => {
    const init = { method: 'POST', body: JSON.stringify(request) };
    if (attack === 'host') return config.fetch('https://evil.invalid/v1/chat/completions', init);
    if (attack === 'body') return config.fetch('https://api.openai.com/v1/chat/completions', { ...init, body: JSON.stringify({ ...request, model: 'foreign-model' }) });
    await config.fetch('https://api.openai.com/v1/chat/completions', init); return config.fetch('https://api.openai.com/v1/chat/completions', init);
  } });
  const result = await runExclusionWarrantsProbe(h.f.options, { ...h.dependencies, clientFactory: factory });
  expect(result.status).toBe('partial'); expect(h.transport).toHaveBeenCalledTimes(attack === 'second-wire' ? 1 : 0);
});

it('refuses changed source/input/code and a copied approval alias cannot replay the same authorization', async () => {
  const h = harness(); const file = path.join(h.f.folder, 'inputs.json'); fs.appendFileSync(file, ' ');
  await expect(runExclusionWarrantsProbe(h.f.options, h.dependencies)).rejects.toThrow('probe-file-drift'); expect(h.transport).not.toHaveBeenCalled();
  const second = harness(); await runExclusionWarrantsProbe(second.f.options, second.dependencies);
  const approvalAlias = path.join(second.f.folder, 'approval-copy.json'); fs.copyFileSync(path.join(root, second.f.options.approvalPath), approvalAlias);
  await expect(runExclusionWarrantsProbe({ ...second.f.options, approvalPath: relative(approvalAlias), outputDirectory: relative(path.join(second.f.folder, 'second-run')) }, second.dependencies))
    .rejects.toThrow('probe-authorization-already-claimed');
  expect(second.transport).toHaveBeenCalledTimes(5);
});

it('refuses resume and a new output below an escaping parent symlink', async () => {
  const h = harness(); fs.mkdirSync(path.join(h.f.folder, 'run'));
  await expect(runExclusionWarrantsProbe(h.f.options, h.dependencies)).rejects.toThrow('probe-resume-forbidden');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'financebot-probe-symlink-')); const link = path.join(h.f.folder, 'escape');
  fs.symlinkSync(outside, link);
  try { await expect(runExclusionWarrantsProbe({ ...h.f.options, outputDirectory: relative(path.join(link, 'new-output')) }, h.dependencies)).rejects.toThrow('probe-symlink-outside-root'); }
  finally { fs.unlinkSync(link); fs.rmdirSync(outside); }
  expect(h.transport).not.toHaveBeenCalled();
});

it('critical fsync failure stops dispatch and restores the actual facade', async () => {
  const h = harness(), original = llm.sendMessage; let failed = false;
  const sync = (fd: number) => { const log = path.join(h.f.folder, 'run/journal.jsonl');
    if (!failed && fs.existsSync(log) && fs.readFileSync(log, 'utf8').includes('"kind":"sdk-reserved"')) { failed = true; throw new Error('SCRIPTED fsync failure'); }
    fs.fsyncSync(fd); };
  const result = await runExclusionWarrantsProbe(h.f.options, { ...h.dependencies, fsync: sync });
  expect(result.status).toBe('partial'); expect(result.stopCode).toBe('probe-durable-recording-failed'); expect(h.transport).not.toHaveBeenCalled();
  expect(result.conservativeReservations).toBe(21354); expect(result.unknownUsageSends).toBe(0); expect(llm.sendMessage).toBe(original);
});

it('rejects changed purpose config, forbidden retrieval selectors and absent independent safety evidence', () => {
  const f = fixture();
  const draft = { ...f.declaration, safeConfiguration: { ...f.declaration.safeConfiguration, model: 'other' } };
  const bad = write(path.join(f.folder, 'foreign.json'), draft);
  expect(() => validateProbeLaunch({ ...f.options, declarationPath: bad.path, declarationSha256: bad.sha256 })).toThrow('probe-configuration-changed');
  expect(() => validateProbeLaunch({ ...f.options, freezeSha256: '0'.repeat(64) })).toThrow('probe-file-drift');
});

it('rejects an unexpected role/generator dispatch before touching the client', async () => {
  const h = harness(); const bad: ProbeRuntime = { ...runtime, assess: async args => {
    await args.complete!<unknown>('FORBIDDEN', { usageContext: { stage: 'role-validator', item: 0 } }); throw new Error('unreachable');
  } };
  const result = await runExclusionWarrantsProbe(h.f.options, { ...h.dependencies, runtime: bad });
  expect(result).toMatchObject({ status: 'partial', sdkSends: 0, physicalWirePosts: 0, stopCode: 'probe-forbidden-stage-or-prompt' });
  expect(h.transport).not.toHaveBeenCalled();
});

it('keeps swallowed internal guards partial, even if the quality layer returns a withheld assessment', async () => {
  const h = harness(); const bad: ProbeRuntime = { ...runtime, assess: async args => {
    try { await args.complete!<unknown>('FORBIDDEN', { usageContext: { stage: 'generator', item: 0 } }); } catch { /* Simulate quality catch. */ }
    return runtime.assess({ ...args, complete: async <T>() => scripted('P01', h.f.source.cases[0].candidate) as T });
  } };
  const result = await runExclusionWarrantsProbe(h.f.options, { ...h.dependencies, runtime: bad });
  expect(result).toMatchObject({ status: 'partial', sdkSends: 0, physicalWirePosts: 0, stopCode: 'probe-forbidden-stage-or-prompt' });
  expect(result.cases[0]).not.toHaveProperty('quality'); expect(h.transport).not.toHaveBeenCalled();
});

it('does not call a zero-send local duplicate guard a completed model review', async () => {
  const h = harness(); const local: ProbeRuntime = { ...runtime, assess: args => runtime.assess({ ...args,
    memory: { ...args.memory, entries: [{ id: 'scripted-exact-bank', source: 'bank', content: args.candidate, fingerprint: contentFingerprint(args.candidate) }] } }) };
  const result = await runExclusionWarrantsProbe(h.f.options, { ...h.dependencies, runtime: local });
  expect(result).toMatchObject({ status: 'partial', sdkSends: 0, physicalWirePosts: 0, stopCode: 'probe-case-without-model-dispatch' });
  expect(result.cases[0]).not.toHaveProperty('quality'); expect(h.transport).not.toHaveBeenCalled();
});

it('poisons a forbidden wire even when a fake SDK swallows it before trying a valid POST', async () => {
  const h = harness();
  const factory: NonNullable<ProbeDependencies['clientFactory']> = config => ({ create: async request => {
    const init = { method: 'POST', body: JSON.stringify(request) };
    try { await config.fetch('https://evil.invalid/v1/chat/completions', init); } catch { /* SDK swallow must not refresh permission. */ }
    return config.fetch('https://api.openai.com/v1/chat/completions', init);
  } });
  const result = await runExclusionWarrantsProbe(h.f.options, { ...h.dependencies, clientFactory: factory });
  expect(result.status).toBe('partial'); expect(result.physicalWirePosts).toBe(0); expect(h.transport).not.toHaveBeenCalled();
  expect(journal(h.f.folder).some(row => row.kind === 'wire-denied-or-stopped')).toBe(true);
});

it('handles a short admission write completely, and refuses zero progress before dispatch', async () => {
  const good = harness(); let shortened = false;
  const completeWrite: NonNullable<ProbeDependencies['write']> = (fd, bytes, offset, length) => {
    if (!shortened && bytes.toString().includes('"kind":"sdk-reserved"')) { shortened = true; return fs.writeSync(fd, bytes, offset, 7); }
    return fs.writeSync(fd, bytes, offset, length);
  };
  expect((await runExclusionWarrantsProbe(good.f.options, { ...good.dependencies, write: completeWrite })).status).toBe('completed');
  expect(shortened).toBe(true); expect(journal(good.f.folder).filter(row => row.kind === 'sdk-reserved')).toHaveLength(5);
  const bad = harness(); let failed = false;
  const stopWrite: NonNullable<ProbeDependencies['write']> = (fd, bytes, offset, length) => {
    if (!failed && bytes.toString().includes('"kind":"sdk-reserved"')) { failed = true; return 0; }
    return fs.writeSync(fd, bytes, offset, length);
  };
  const result = await runExclusionWarrantsProbe(bad.f.options, { ...bad.dependencies, write: stopWrite });
  expect(result).toMatchObject({ status: 'partial', sdkSends: 0, physicalWirePosts: 0, conservativeReservations: 21354, unknownUsageSends: 0 });
  expect(bad.transport).not.toHaveBeenCalled();
});

it('does not report a physical POST when its durable wire reservation fails', async () => {
  const h = harness(); let failed = false;
  const sync = (fd: number) => { const log = path.join(h.f.folder, 'run/journal.jsonl');
    if (!failed && fs.existsSync(log) && fs.readFileSync(log, 'utf8').includes('"kind":"wire-reserved"')) { failed = true; throw new Error('SCRIPTED wire fsync failure'); }
    fs.fsyncSync(fd); };
  const result = await runExclusionWarrantsProbe(h.f.options, { ...h.dependencies, fsync: sync });
  expect(result).toMatchObject({ status: 'partial', sdkSends: 1, physicalWirePosts: 0, conservativeReservations: 21354 });
  expect(h.transport).not.toHaveBeenCalled();
});

it('stops on a result-journal failure before any schema retry or next case', async () => {
  const h = harness(); let failed = false;
  const sync = (fd: number) => { const log = path.join(h.f.folder, 'run/journal.jsonl');
    if (!failed && fs.existsSync(log) && fs.readFileSync(log, 'utf8').includes('"kind":"sdk-result"')) { failed = true; throw new Error('SCRIPTED result fsync failure'); }
    fs.fsyncSync(fd); };
  const result = await runExclusionWarrantsProbe(h.f.options, { ...h.dependencies, fsync: sync });
  expect(result).toMatchObject({ status: 'partial', sdkSends: 1, physicalWirePosts: 1, conservativeReservations: 21354 });
  expect(h.transport).toHaveBeenCalledTimes(1); expect(result.cases[0]).not.toHaveProperty('quality');
});

it('refuses forbidden live retrieval and code/input drift after the first transport', async () => {
  const forbidden = fixture(source => { source.cases[0].requirements.exactBankProtocol = 'course-exact-bank-v1'; });
  expect(() => validateProbeLaunch(forbidden.options)).toThrow('probe-forbidden-retrieval-selector');
  const h = harness();
  const transport = async () => { fs.appendFileSync(path.join(h.f.folder, 'inputs.json'), ' ');
    return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 }); };
  const result = await runExclusionWarrantsProbe(h.f.options, { ...h.dependencies, transport });
  expect(result.status).toBe('partial'); expect(result.sdkSends).toBe(1); expect(result.physicalWirePosts).toBe(1);
  expect(result.cases[0]).not.toHaveProperty('quality');
});

it('deadline/late unknown outcomes retain reservation and cannot send or write after terminal', async () => {
  const h = harness(); let release: ((response: Response) => void) | undefined; const original = llm.sendMessage;
  jest.useFakeTimers();
  try {
    const transport = jest.fn(() => new Promise<Response>(resolve => { release = resolve; }));
    const running = runExclusionWarrantsProbe(h.f.options, { ...h.dependencies, transport });
    for (let i = 0; i < 30 && !release; i++) await Promise.resolve();
    expect(release).toBeDefined(); await jest.advanceTimersByTimeAsync(180001);
    const result = await running;
    expect(result).toMatchObject({ status: 'partial', sdkSends: 1, physicalWirePosts: 1, conservativeReservations: 21354, unknownUsageSends: 1 });
    const frozenSummary = JSON.stringify(result);
    const terminal = fs.readFileSync(path.join(h.f.folder, 'run/journal.jsonl'), 'utf8');
    release!(new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), { status: 200 }));
    await jest.advanceTimersByTimeAsync(1);
    expect(fs.readFileSync(path.join(h.f.folder, 'run/journal.jsonl'), 'utf8')).toBe(terminal);
    expect(JSON.stringify(result)).toBe(frozenSummary);
    expect(transport).toHaveBeenCalledTimes(1); expect(llm.sendMessage).toBe(original);
  } finally { jest.useRealTimers(); }
});

it('restores the facade and stops after a synchronous assessment exception', async () => {
  const h = harness(), original = llm.sendMessage;
  const bad: ProbeRuntime = { ...runtime, assess: () => { throw new Error('SCRIPTED synchronous assessment failure'); } };
  const result = await runExclusionWarrantsProbe(h.f.options, { ...h.dependencies, runtime: bad });
  expect(result).toMatchObject({ status: 'partial', sdkSends: 0, physicalWirePosts: 0 });
  expect(llm.sendMessage).toBe(original); expect(h.transport).not.toHaveBeenCalled();
});

it('blocks and poisons a caught process attempt inside the permitted fake transport scope', async () => {
  const original = jest.spyOn(childProcess, 'spawn').mockImplementation(() => { throw new Error('Underlying process must not run'); });
  const h = harness();
  try {
    const transport = async () => {
      expect(() => childProcess.spawn('NEVER-EXECUTED')).toThrow('probe-ambient-network-or-process-denied');
      return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
    };
    const result = await runExclusionWarrantsProbe(h.f.options, { ...h.dependencies, transport });
    expect(result).toMatchObject({ status: 'partial', sdkSends: 1, physicalWirePosts: 1, stopCode: 'probe-ambient-network-or-process-denied' });
    expect(original).not.toHaveBeenCalled(); expect(journal(h.f.folder).some(row => row.kind === 'ambient-operation-denied')).toBe(true);
  } finally { original.mockRestore(); }
});

it.each(['OFFLINE-SYNTHETIC-quote"-backslash\\-NOT-A-CREDENTIAL', undefined, null])('refuses escaped or absent synthetic credentials before any request %#', async value => {
  const h = harness();
  const apiKey = value as string;
  const result = await runExclusionWarrantsProbe(h.f.options, { ...h.dependencies,
    credentials: () => ({ provider: 'openai', endpoint: 'https://api.openai.com/v1', apiKey }) });
  expect(result).toMatchObject({ status: 'partial', sdkSends: 0, physicalWirePosts: 0, stopCode: 'probe-existing-provider-configuration-invalid' });
  expect(h.factory).not.toHaveBeenCalled(); expect(h.transport).not.toHaveBeenCalled();
  const log = fs.readFileSync(path.join(h.f.folder, 'run/journal.jsonl'), 'utf8');
  if (apiKey) { expect(log).not.toContain(apiKey); expect(log).not.toContain(JSON.stringify(apiKey).slice(1, -1)); }
});
