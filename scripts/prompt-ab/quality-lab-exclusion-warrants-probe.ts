/** Isolated, approval-gated retained QUALITY-ONLY probe. Importing is inert.
 * This file does not authorize any provider call. The existing R8 approval and
 * the proposed-paid-preflight DRAFT are deliberately incompatible.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- Approval and I/O guards must precede synchronous application imports and CJS cache isolation. */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { LLMConfig, LLMOptions } from 'ubc-genai-toolkit-llm';
import type * as QualityModule from '../../server/src/services/generation-quality.service';
import type * as MemoryModule from '../../server/src/services/generation-memory.service';
import type * as LlmModule from '../../server/src/components/genai/llm';
import type * as AdapterModule from '../../server/src/components/genai/llm/openai-usage-adapter';
import type * as ObserverModule from '../../server/src/components/genai/llm/model-call';
import type * as EnvModule from '../../server/src/config/env';
import type * as NetModule from 'node:net';
import type OpenAI from 'openai';

import type { CompleteJsonOptions, ModelSendAdmission } from '../../server/src/components/genai/llm';
import type { ModelCallEvent } from '../../server/src/components/genai/llm/model-call';
import type { OpenAICompletionClient } from '../../server/src/components/genai/llm/openai-usage-adapter';
import type { AuthoringRequirements, GenerationQualityAssessment } from '../../server/src/types/generation-quality';
import type { GenerationMemoryContent, GenerationMemorySnapshot } from '../../server/src/services/generation-memory.service';
import type { GenerationEvidencePacket } from '../../server/src/types/generation-evidence';

export const PROBE_CASE_ORDER = ['P01', 'P02', 'P04', 'CAPM', 'P03'] as const;
export const PROBE_LIMITS = Object.freeze({ maxSdkSends: 10, maxPhysicalWirePosts: 10, maxInputUnitsPerSend: 24000,
  maxOutputTokensPerSend: 2000, maxConservativeReservationUnits: 260000 });
const ENDPOINT = 'https://api.openai.com/v1';
const WIRE_URL = `${ENDPOINT}/chat/completions`;
const MODEL = 'gpt-6-luna';
const LAUNCHER = 'scripts/prompt-ab/quality-lab-exclusion-warrants-probe.ts';
const TEST = 'tests/unit/quality-lab-exclusion-warrants-probe.test.ts';
const selectors = { authoringPromptProtocol: 'compact-authoring-v1', numericReviewProtocol: 'server-rendered-numeric-review-v1',
  exclusionReviewProtocol: 'literal-exclusion-warrants-v1' } as const;
const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const json = (value: unknown): string => JSON.stringify(value);
function fail(code: string): never { throw new ProbeRefusal(code); }
export class ProbeRefusal extends Error { constructor(readonly code: string) { super(code); this.name = 'ProbeRefusal'; } }
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const same = (left: unknown, right: unknown): boolean => json(left) === json(right);
type WriteBytes = (fd: number, bytes: Buffer, offset: number, length: number) => number;
function writeAll(fd: number, text: string, write: WriteBytes = fs.writeSync): void {
  const bytes = Buffer.from(text); let offset = 0;
  while (offset < bytes.length) {
    const count = write(fd, bytes, offset, bytes.length - offset);
    if (!Number.isSafeInteger(count) || count <= 0 || count > bytes.length - offset) fail('probe-short-write-failed');
    offset += count;
  }
}
function syncDirectory(directory: string, sync: (fd: number) => void): void {
  const fd = fs.openSync(directory, 'r'); try { sync(fd); } finally { fs.closeSync(fd); }
}
interface Pin { path: string; sha256: string; bytes?: number }
export interface ProbeCase { id: string; candidate: GenerationMemoryContent; packet: GenerationEvidencePacket;
  memory: GenerationMemorySnapshot; requirements: AuthoringRequirements; [key: string]: unknown }
interface Declaration {
  version: 'exclusion-warrants-quality-probe-approved-v1'; executionAllowed: true;
  executionMode: 'live' | 'offline-fixture';
  authorizationId: string; caseOrder: string[]; limits: typeof PROBE_LIMITS;
  safeConfiguration: { provider: 'openai'; endpoint: string; allowedPath: string; model: string; reasoningEffort: 'none';
    temperature: 0; maxOutputTokens: 2000; sdkMaxRetriesRequired: 0; streaming: false; perCallDeadlineMs: 180000 };
  fixedInputs: Pin; currentCode: Pin; initialPrompts: Array<{ id: string; prompt: Pin }>;
}
export interface ProbeLaunchOptions {
  root: string; declarationPath: string; declarationSha256: string; approvalPath: string; approvalSha256: string;
  freezePath: string; freezeSha256: string; outputDirectory: string; executeApproved: boolean;
  /** Programmatic safety tests only; the live CLI never exposes this flag. */
  offlineFixture?: true;
}
export interface ProbeRuntime {
  assess: typeof QualityModule.assessGenerationQuality;
  render: typeof QualityModule.renderGenerationQualityReviewPrompt;
  select: typeof MemoryModule.selectGenerationMemory;
  complete: typeof LlmModule.completeJson;
  install(client: OpenAICompletionClient, config: LLMConfig): () => void;
  requiredCodeFiles: string[];
}
export interface ProbeDependencies {
  /** Tests inject a fake wire; it must still cross the durable physical guard. */
  transport?: (url: string, init: RequestInit) => Promise<Response>;
  clientFactory?: (options: { apiKey: string; baseURL: string; maxRetries: 0; fetch: typeof fetch }) => OpenAICompletionClient;
  runtime?: ProbeRuntime;
  credentials?: () => { provider: string; endpoint: string; apiKey: string };
  fsync?: (fd: number) => void;
  write?: WriteBytes;
}
function safePath(root: string, relative: string): string {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes('\0')) fail('probe-path-invalid');
  const target = path.resolve(root, relative); const prefix = path.resolve(root) + path.sep;
  if (!target.startsWith(prefix)) fail('probe-path-outside-root');
  let ancestor = target; while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const realRoot = fs.realpathSync(root); const actual = fs.realpathSync(ancestor);
  if (actual !== realRoot && !actual.startsWith(realRoot + path.sep)) fail('probe-symlink-outside-root');
  return target;
}
function checkedFile(root: string, pin: Pin): Buffer {
  if (!pin || !/^[a-f0-9]{64}$/.test(pin.sha256)) fail('probe-pin-invalid');
  const bytes = fs.readFileSync(safePath(root, pin.path));
  if (hash(bytes) !== pin.sha256 || pin.bytes !== undefined && bytes.length !== pin.bytes) fail('probe-file-drift');
  return bytes;
}
function readBound(root: string, file: string, sha256: string): { bytes: Buffer; data: Record<string, unknown> } {
  const bytes = checkedFile(root, { path: file, sha256 }); return { bytes, data: record(JSON.parse(bytes.toString('utf8'))) };
}
export function validateProbeLaunch(options: ProbeLaunchOptions): { declaration: Declaration; cases: ProbeCase[]; pins: Pin[]; verify: () => void } {
  if (!options.executeApproved) fail('probe-explicit-execution-flag-required');
  const d = readBound(options.root, options.declarationPath, options.declarationSha256).data;
  if (d.version !== 'exclusion-warrants-quality-probe-approved-v1' || d.executionAllowed !== true) fail('probe-declaration-not-approved');
  if (d.executionMode !== (options.offlineFixture ? 'offline-fixture' : 'live')) fail('probe-execution-mode-invalid');
  if (typeof d.authorizationId !== 'string' || !/^exclusion-warrants-new-[a-zA-Z0-9-]{8,}$/.test(d.authorizationId)) fail('probe-fresh-authorization-required');
  if (!same(d.caseOrder, PROBE_CASE_ORDER) || !same(d.limits, PROBE_LIMITS)) fail('probe-scope-or-limits-changed');
  const config = record(d.safeConfiguration);
  const expected = { provider: 'openai', endpoint: ENDPOINT, allowedPath: '/chat/completions', model: MODEL, reasoningEffort: 'none', temperature: 0,
    maxOutputTokens: 2000, sdkMaxRetriesRequired: 0, streaming: false, perCallDeadlineMs: 180000 };
  for (const [key, value] of Object.entries(expected)) if (config[key] !== value) fail('probe-configuration-changed');
  const approval = readBound(options.root, options.approvalPath, options.approvalSha256).data;
  const freeze = readBound(options.root, options.freezePath, options.freezeSha256).data;
  if (approval.synthetic !== Boolean(options.offlineFixture) || freeze.synthetic !== Boolean(options.offlineFixture)) fail('probe-synthetic-approval-not-live');
  if (approval.version !== 'exclusion-warrants-human-approval-v1' || approval.issuer !== 'human-user' || approval.approved !== true
    || approval.authorizationId !== d.authorizationId || approval.declarationSha256 !== options.declarationSha256
    || approval.freezeSha256 !== options.freezeSha256 || !/^[a-f0-9]{64}$/.test(String(approval.humanMessageSha256))
    || typeof approval.humanMessageId !== 'string' || !approval.humanMessageId || typeof approval.approvedAt !== 'string') fail('probe-human-approval-binding-invalid');
  if (freeze.version !== 'exclusion-warrants-safety-freeze-v1' || freeze.reviewed !== true || freeze.declarationSha256 !== options.declarationSha256
    || freeze.authorizationId !== d.authorizationId || typeof freeze.independentReviewSha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(freeze.independentReviewSha256)) fail('probe-safety-freeze-binding-invalid');
  const humanEvidence = record(JSON.parse(checkedFile(options.root, approval.humanEvidence as Pin).toString('utf8')));
  if (humanEvidence.role !== 'user' || humanEvidence.messageId !== approval.humanMessageId || typeof humanEvidence.message !== 'string'
    || hash(humanEvidence.message) !== approval.humanMessageSha256 || !same(humanEvidence.approves,
      { authorizationId: d.authorizationId, declarationSha256: options.declarationSha256, freezeSha256: options.freezeSha256 })) fail('probe-human-evidence-invalid');
  const reviewEvidencePin = freeze.independentReview as Pin;
  const reviewEvidence = record(JSON.parse(checkedFile(options.root, reviewEvidencePin).toString('utf8')));
  if (reviewEvidencePin.sha256 !== freeze.independentReviewSha256 || reviewEvidence.status !== 'reviewed-safe-for-approval'
    || reviewEvidence.codeManifestSha256 !== record(d.currentCode).sha256 || reviewEvidence.fixedInputsSha256 !== record(d.fixedInputs).sha256) fail('probe-review-evidence-invalid');
  const declaration = d as unknown as Declaration;
  const source = record(JSON.parse(checkedFile(options.root, declaration.fixedInputs).toString('utf8')));
  if (!same(source.caseOrder, PROBE_CASE_ORDER) || !Array.isArray(source.cases) || source.cases.length !== 5) fail('probe-fixed-case-scope-invalid');
  const cases = source.cases as ProbeCase[];
  for (let index = 0; index < cases.length; index++) {
    const row = cases[index]; if (row.id !== PROBE_CASE_ORDER[index] || row.candidate.type && row.candidate.type !== 'mcq') fail('probe-case-order-invalid');
    const requirements = row.requirements;
    for (const [key, value] of Object.entries(selectors)) if (record(requirements)[key] !== value) fail('probe-selector-invalid');
    if (requirements.answerabilityProtocol !== 'option-answerability-v1' || requirements.exactBankProtocol !== undefined
      || requirements.taskRetrievalProtocol !== undefined) fail('probe-forbidden-retrieval-selector');
  }
  const manifest = record(JSON.parse(checkedFile(options.root, declaration.currentCode).toString('utf8')));
  if (!Array.isArray(manifest.files)) fail('probe-code-manifest-invalid');
  const pins = (manifest.files as unknown[]).map(row => (record(row).original ?? row) as Pin);
  if (new Set(pins.map(pin => pin.path)).size !== pins.length) fail('probe-code-pin-duplicate');
  for (const required of [LAUNCHER, TEST, 'package-lock.json', 'package.json', 'server/src/config/env.ts']) if (!pins.some(pin => pin.path === required)) fail('probe-launcher-or-dependency-pin-missing');
  if (!same(declaration.initialPrompts.map(row => row.id), PROBE_CASE_ORDER)) fail('probe-initial-prompt-scope-invalid');
  const verify = () => {
    readBound(options.root, options.declarationPath, options.declarationSha256);
    readBound(options.root, options.approvalPath, options.approvalSha256);
    readBound(options.root, options.freezePath, options.freezeSha256);
    checkedFile(options.root, approval.humanEvidence as Pin); checkedFile(options.root, reviewEvidencePin);
    checkedFile(options.root, declaration.fixedInputs); checkedFile(options.root, declaration.currentCode);
    for (const pin of pins) checkedFile(options.root, pin);
    for (const row of declaration.initialPrompts) checkedFile(options.root, row.prompt);
  };
  verify(); return { declaration, cases, pins, verify };
}

export interface ProbeSummary {
  status: 'completed' | 'partial'; plannedCases: 5; caseOrder: readonly string[];
  cases: Array<{ id: string; state: 'not-started' | 'interrupted' | 'reviewed'; quality?: GenerationQualityAssessment }>;
  sdkSends: number; physicalWirePosts: number; conservativeReservations: number; reportedInputTokens: number; reportedOutputTokens: number;
  unknownUsageSends: number; stopCode: string | null; saved: 0; adopted: 0;
}
class Journal {
  private fd: number; private previous = '0'.repeat(64); private sequence = 0;
  constructor(directory: string, private sync: (fd: number) => void, private redact: (text: string) => string, private write: WriteBytes) {
    this.fd = fs.openSync(path.join(directory, 'journal.jsonl'), 'wx', 0o600);
    try { syncDirectory(directory, sync); } catch (error) { fs.closeSync(this.fd); throw error; }
  }
  append(kind: string, data: unknown): void {
    const body = this.redact(json({ sequence: ++this.sequence, kind, previous: this.previous, data }));
    if (Buffer.byteLength(body) > 8 * 1024 * 1024) fail('probe-record-too-large');
    const digest = hash(body); writeAll(this.fd, `${json({ body: JSON.parse(body), sha256: digest })}\n`, this.write); this.sync(this.fd); this.previous = digest;
  }
  close(): void { fs.closeSync(this.fd); }
}
interface ActiveSend { id: number; caseId: string; prompt: string; admission: ModelSendAdmission; request: Record<string, unknown>; body: string; wires: number;
  settled: boolean; unknownRecorded: boolean; dispatched: boolean }
/** Separate arithmetic guard is testable even when the normal10×26k ceilings
 * make the total ceiling redundant. Never reduce a reservation after usage. */
export function assertProbeAdmissionBudget(state: { sdkReservations: number; conservativeReservations: number }, inputUnits: number, outputCap: number): void {
  if (!Number.isSafeInteger(state.sdkReservations) || state.sdkReservations < 0 || !Number.isSafeInteger(state.conservativeReservations)
    || state.conservativeReservations < 0 || !Number.isSafeInteger(inputUnits) || inputUnits < 32) fail('probe-budget-state-invalid');
  if (state.sdkReservations >= PROBE_LIMITS.maxSdkSends) fail('probe-sdk-send-limit');
  if (inputUnits > PROBE_LIMITS.maxInputUnitsPerSend || outputCap !== 2000) fail('probe-per-send-input-or-output-limit');
  if (state.conservativeReservations + inputUnits + outputCap > PROBE_LIMITS.maxConservativeReservationUnits) fail('probe-total-reservation-limit');
}
const networkScope = new AsyncLocalStorage<boolean>();
const completionScope = new AsyncLocalStorage<{ caseId: string }>();
/** Exactly one explicit HTTPS request, with no HTTP redirects or retry loop. */
export async function singleHttpsPost(url: string, init: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {}; new Headers(init.headers).forEach((value, key) => { headers[key] = value; });
    const request = https.request(url, { method: 'POST', headers, signal: init.signal ?? undefined }, response => {
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 8 * 1024 * 1024) { request.destroy(new ProbeRefusal('probe-response-too-large')); return; } chunks.push(chunk); });
      response.on('error', reject);
      response.on('end', () => resolve(new Response(Buffer.concat(chunks).toString('utf8'), { status: response.statusCode ?? 500,
        headers: { 'content-type': String(response.headers['content-type'] ?? 'application/json') } })));
    });
    request.on('error', reject); request.end(init.body);
  });
}
function installNetworkIsolation(onDenied: () => void): () => void {
  const restores: Array<() => void> = [];
  const replace = (target: object, key: string, value: unknown) => {
    const descriptor = Object.getOwnPropertyDescriptor(target, key); Object.defineProperty(target, key, { configurable: true, writable: true, value });
    restores.push(() => { if (descriptor) Object.defineProperty(target, key, descriptor); else Reflect.deleteProperty(target, key); });
  };
  const denied = () => { onDenied(); return fail('probe-ambient-network-or-process-denied'); };
  for (const name of ['node:net', 'node:tls', 'node:http', 'node:https', 'node:dns', 'node:child_process']) {
    const module = require(name) as Record<string, unknown>;
    const keys = name.includes('child_process') ? ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork']
      : name.includes('dns') ? ['lookup', 'resolve', 'resolve4', 'resolve6'] : ['connect', 'createConnection', 'request', 'get'];
    for (const key of keys) if (typeof module[key] === 'function') {
      const original = module[key] as (...args: unknown[]) => unknown;
      replace(module, key, (...args: unknown[]) => !name.includes('child_process') && networkScope.getStore() ? original(...args) : denied());
    }
  }
  const net = require('node:net') as typeof NetModule;
  const originalConnect = net.Socket.prototype.connect;
  replace(net.Socket.prototype, 'connect', function(this: NetModule.Socket, ...args: unknown[]) {
    if (!networkScope.getStore()) return denied(); return Reflect.apply(originalConnect, this, args);
  });
  replace(globalThis, 'fetch', denied);
  return () => { for (const restore of restores.reverse()) restore(); };
}

/** Real application helpers, imported only after approval and I/O isolation.
 * Callers provide the adapter client; no production singleton may dispatch.
 */
export function loadProbeRuntime(): ProbeRuntime {
  const q = require('../../server/src/services/generation-quality.service') as typeof QualityModule;
  const m = require('../../server/src/services/generation-memory.service') as typeof MemoryModule;
  const llm = require('../../server/src/components/genai/llm') as typeof LlmModule;
  const adapterModule = require('../../server/src/components/genai/llm/openai-usage-adapter') as typeof AdapterModule;
  const observed = require('../../server/src/components/genai/llm/model-call') as typeof ObserverModule;
  return { assess: q.assessGenerationQuality, render: q.renderGenerationQualityReviewPrompt, select: m.selectGenerationMemory, complete: llm.completeJson,
    get requiredCodeFiles() { return Object.keys(require.cache).filter(file => fs.existsSync(file)); },
    install(client, config) {
      const adapter = adapterModule.createOpenAIUsageAdapter(config, client, { requestTimeoutMs: 180000 });
      const target = llm.llm; const saved = new Map<string, PropertyDescriptor | undefined>(); const keys = new Set<string>();
      for (let proto: object | null = target; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
        for (const key of Object.getOwnPropertyNames(proto)) if (key !== 'constructor' && typeof record(target)[key] === 'function') keys.add(key);
      }
      const restore = () => { for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(target, key, descriptor); else Reflect.deleteProperty(target, key); } };
      try {
        for (const key of keys) { saved.set(key, Object.getOwnPropertyDescriptor(target, key)); Object.defineProperty(target, key, { configurable: true, writable: true,
          value: () => fail('probe-ambient-llm-method-denied') }); }
        Object.defineProperty(target, 'sendMessage', { configurable: true, writable: true, value: (message: string, options: LLMOptions = {}) =>
          observed.observeModelCall(config, options, () => adapter.sendMessage(message, options), message) });
      } catch (error) { restore(); throw error; }
      return restore;
    } };
}
function blockForbiddenModules(): () => void {
  const saved = new Map<string, NodeJS.Module | undefined>();
  for (const name of ['../../server/src/components/mongodb/collections', '../../server/src/components/mongodb', '../../server/src/components/genai/embeddings',
    '../../server/src/components/qdrant', '../../server/src/components/jobs', '../../server/src/components/param-worker', '../../server/src/components/genai/logger']) {
    const resolved = require.resolve(name); saved.set(resolved, require.cache[resolved]);
    const api = name.endsWith('logger') ? { createGenaiLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) }
      : name.endsWith('jobs') ? { defineJob() {}, enqueueJob: () => fail('probe-forbidden-queue'), scheduleRecurring: () => fail('probe-forbidden-queue') }
      : new Proxy({}, { get: (_target, key) => key === '__esModule' ? false : () => fail('probe-forbidden-io') });
    const module = new (require('node:module'))(resolved) as NodeJS.Module; module.filename = resolved; module.loaded = true; module.exports = api; require.cache[resolved] = module;
  }
  return () => { for (const [key, previous] of saved) { if (previous) require.cache[key] = previous; else delete require.cache[key]; } };
}
function rawUsage(value: Record<string, unknown>): { input: number | null; output: number | null } {
  const usage = record(value.usage); const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
  return { input: count(usage.prompt_tokens), output: count(usage.completion_tokens) };
}
let running = false;
export async function runExclusionWarrantsProbe(options: ProbeLaunchOptions, dependencies: ProbeDependencies = {}): Promise<ProbeSummary> {
  const validated = validateProbeLaunch(options); if (running) fail('probe-concurrent-runtime-denied');
  if (options.offlineFixture && (!dependencies.transport || !dependencies.credentials)) fail('probe-offline-fixture-transport-required');
  const allowedCodePaths = new Set(validated.pins.map(pin => safePath(options.root, pin.path)));
  const directory = safePath(options.root, options.outputDirectory); if (fs.existsSync(directory)) fail('probe-resume-forbidden');
  // A CLI path alias or copied attestation cannot obtain a fresh allowance.
  const claimDirectory = safePath(options.root, 'audit-results/answer-exclusion-warrants-2026-10-17/launcher-r1/execution-claims');
  fs.mkdirSync(claimDirectory, { recursive: true, mode: 0o700 });
  const claim = path.join(claimDirectory, validated.declaration.authorizationId + '.json'); if (fs.existsSync(claim)) fail('probe-authorization-already-claimed');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const sync = dependencies.fsync ?? fs.fsyncSync, write = dependencies.write ?? fs.writeSync;
  const claimFd = fs.openSync(claim, 'wx', 0o600);
  try { writeAll(claimFd, json({ declarationSha256: options.declarationSha256, authorizationId: validated.declaration.authorizationId,
    outputDirectory: options.outputDirectory, state: 'claimed-no-automatic-resume' }), write); sync(claimFd); } finally { fs.closeSync(claimFd); }
  syncDirectory(claimDirectory, sync); syncDirectory(path.dirname(directory), sync);
  let secret = ''; const redact = (text: string) => secret ? text.split(secret).join('[REDACTED]') : text;
  const journal = new Journal(directory, sync, redact, write);
  running = true;
  const summary: ProbeSummary = { status: 'partial', plannedCases: 5, caseOrder: PROBE_CASE_ORDER,
    cases: PROBE_CASE_ORDER.map(id => ({ id, state: 'not-started' })), sdkSends: 0, physicalWirePosts: 0, conservativeReservations: 0,
    reportedInputTokens: 0, reportedOutputTokens: 0, unknownUsageSends: 0, stopCode: null, saved: 0, adopted: 0 };
  let poisoned: string | null = null; let closed = false; let sdkReservations = 0; let wireReservations = 0; let current: ProbeCase | undefined; let pending: ModelSendAdmission | undefined; let active: ActiveSend | undefined;
  const event = (kind: string, value: unknown) => { if (closed) fail('probe-phase-terminal');
    try { journal.append(kind, value); } catch { poisoned = 'probe-durable-recording-failed'; fail(poisoned); } };
  let currentRuntime: ProbeRuntime | undefined;
  const markUnknown = (attempt: ActiveSend) => { if (!closed && attempt.dispatched && !attempt.settled && !attempt.unknownRecorded) { attempt.unknownRecorded = true; summary.unknownUsageSends++; } };
  const check = () => { if (poisoned) fail(poisoned); validated.verify();
    for (const file of currentRuntime?.requiredCodeFiles ?? []) if (!allowedCodePaths.has(file)) fail('probe-imported-code-not-pinned'); };
  let restoreFacade = () => {}; let restoreModules = () => {}; let restoreNetwork = () => {};
  try {
    event('phase-start', { declarationSha256: options.declarationSha256, approvalSha256: options.approvalSha256, freezeSha256: options.freezeSha256, limits: PROBE_LIMITS, plannedCases: PROBE_CASE_ORDER });
    restoreNetwork = installNetworkIsolation(() => { poisoned ??= 'probe-ambient-network-or-process-denied';
      try { event('ambient-operation-denied', { code: poisoned }); } catch { /* Sticky even if swallowed by a dependency. */ } });
    restoreModules = blockForbiddenModules();
    const credentials = dependencies.credentials?.() ?? (() => {
      const { env } = require('../../server/src/config/env') as typeof EnvModule;
      return { provider: env.llmProvider, endpoint: env.llmEndpoint || ENDPOINT, apiKey: env.llmApiKey };
    })();
    if (credentials.provider !== 'openai' || typeof credentials.endpoint !== 'string' || credentials.endpoint.replace(/\/$/, '') !== ENDPOINT
      || typeof credentials.apiKey !== 'string' || !/^[A-Za-z0-9._-]+$/.test(credentials.apiKey)) fail('probe-existing-provider-configuration-invalid');
    secret = credentials.apiKey;
    const runtime = dependencies.runtime ?? loadProbeRuntime();
    currentRuntime = runtime; check();
    const wireFetch: typeof fetch = async (input, init = {}) => {
      try {
      check(); if (!active || active.wires || wireReservations >= PROBE_LIMITS.maxPhysicalWirePosts) fail('probe-wire-limit-or-unbound');
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url !== WIRE_URL || init.method !== 'POST' || typeof init.body !== 'string' || init.body !== active.body) fail('probe-wire-endpoint-or-body-invalid');
      if (init.signal?.aborted) fail('probe-aborted-before-wire');
      const attempt = active; active.wires++; wireReservations++;
      event('wire-reserved', { sdkId: attempt.id, caseId: attempt.caseId, wireId: wireReservations, method: 'POST', url, body: JSON.parse(init.body), bodySha256: hash(init.body) });
      const transport = dependencies.transport ?? singleHttpsPost;
      summary.physicalWirePosts++;
      const response = await networkScope.run(true, () => transport(url, { ...init, redirect: 'error' }));
      check();
      event('wire-response', { sdkId: attempt.id, wireId: summary.physicalWirePosts, status: response.status });
      if (response.status >= 300 && response.status < 400 || response.redirected || response.url && response.url !== WIRE_URL) fail('probe-redirect-refused');
      return response;
      } catch (error) {
        poisoned ??= error instanceof ProbeRefusal ? error.code : 'probe-uncertain-wire-outcome';
        try { event('wire-denied-or-stopped', { sdkId: active?.id ?? null, code: poisoned, reservationRetained: true }); } catch { /* Poison survives swallowed SDK exceptions. */ }
        throw new ProbeRefusal(poisoned);
      }
    };
    const factory = dependencies.clientFactory ?? (config => {
      const NativeOpenAI = (require('openai') as { default: typeof OpenAI }).default;
      const sdk = new NativeOpenAI(config);
      return { create: (request, requestOptions) => sdk.chat.completions.create(request as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, requestOptions) };
    });
    const sdk = factory({ apiKey: secret, baseURL: ENDPOINT, maxRetries: 0, fetch: wireFetch });
    const client: OpenAICompletionClient = { create: async (request, requestOptions) => {
      check(); if (!current || completionScope.getStore()?.caseId !== current.id || !pending || active) fail('probe-sdk-without-admission');
      const native = JSON.parse(json(request)) as Record<string, unknown>;
      const body = json(native); const messages = native.messages;
      if (body.includes(secret)) fail('probe-sensitive-data-in-request');
      if (native.model !== MODEL || native.reasoning_effort !== 'none' || native.temperature !== 0 || native.stream !== false
        || native.max_completion_tokens !== 2000 || !same(native.response_format, { type: 'json_object' })
        || !same(messages, [{ role: 'user', content: pending.prompt }]) || pending.systemPrompt !== undefined
        || Object.keys(native).some(key => !['model', 'messages', 'temperature', 'response_format', 'stream', 'reasoning_effort', 'max_completion_tokens'].includes(key))) fail('probe-native-request-invalid');
      const units = Buffer.byteLength(pending.prompt, 'utf8') + 32;
      assertProbeAdmissionBudget({ sdkReservations, conservativeReservations: summary.conservativeReservations }, units, pending.outputCap);
      sdkReservations++; summary.conservativeReservations += units + 2000;
      active = { id: sdkReservations, caseId: current.id, prompt: pending.prompt, admission: pending, request: native, body, wires: 0,
        settled: false, unknownRecorded: false, dispatched: false }; pending = undefined;
      const attempt = active;
      event('sdk-reserved', { sdkId: attempt.id, caseId: attempt.caseId, admission: attempt.admission, nativeRequest: native, nativeSha256: hash(body),
        inputUnits: units, outputCap: 2000, conservativeReservation: units + 2000, sdkMaxRetries: 0, counters: { sdk: summary.sdkSends, wire: summary.physicalWirePosts } });
      try {
        attempt.dispatched = true; summary.sdkSends++;
        const response = record(await sdk.create(request, requestOptions));
        if (attempt.wires !== 1) fail('probe-sdk-wire-count-mismatch');
        if (json(response).includes(secret)) { event('sdk-sensitive-response', { sdkId: attempt.id, responseSha256: hash(json(response)) }); fail('probe-sensitive-response-stop'); }
        const usage = rawUsage(response); event('sdk-result', { sdkId: attempt.id, caseId: attempt.caseId, response, usage });
        if (usage.input === null || usage.output === null) { markUnknown(attempt); poisoned = 'probe-unknown-usage-stop'; fail(poisoned); }
        attempt.settled = true;
        summary.reportedInputTokens += usage.input; summary.reportedOutputTokens += usage.output;
        if (usage.output > 2000) fail('probe-provider-output-cap-exceeded');
        check(); return response;
      } catch (error) {
        if (closed) throw new ProbeRefusal('probe-phase-terminal');
        poisoned ??= error instanceof ProbeRefusal ? error.code : 'probe-uncertain-sdk-outcome';
        markUnknown(attempt);
        event('sdk-stopped', { sdkId: attempt.id, code: poisoned, reservationRetained: true });
        throw new ProbeRefusal(poisoned);
      } finally { active = undefined; }
    } };
    restoreFacade = runtime.install(client, { provider: 'openai', defaultModel: MODEL, apiKey: secret, endpoint: ENDPOINT });
    for (let index = 0; index < validated.cases.length; index++) {
      check(); current = validated.cases[index]; const state = summary.cases[index]; state.state = 'interrupted';
      const caseSdkStart = summary.sdkSends, caseWireStart = summary.physicalWirePosts;
      const candidate = { ...current.candidate, type: 'mcq' as const };
      const initialPin = validated.declaration.initialPrompts[index].prompt;
      // Actual first prompt is built by assessGenerationQuality below, including
      // current deterministic memory/variant selection. No hand-built surrogate.
      const initial = checkedFile(options.root, initialPin).toString('utf8');
      let logical = 0;
      async function checkedComplete<T>(prompt: string, options: CompleteJsonOptions = {}): Promise<T> {
        try { check(); logical++;
        if (logical > 2 || !current || options.usageContext?.stage !== 'quality-review' || options.usageContext.item !== index
          || options.onText || logical === 1 && prompt !== initial || logical === 2 && !prompt.startsWith(initial + '\n\nSAME-CANDIDATE REVIEW CORRECTION')) fail('probe-forbidden-stage-or-prompt');
        return await completionScope.run({ caseId: current.id }, () => runtime.complete<T>(prompt, { ...options, model: MODEL, reasoningEffort: 'none', temperature: 0, maxTokens: 2000,
          beforeRequest: async admission => {
            check(); const release = await options.beforeRequest?.(admission);
            if (!admission || pending || active || admission.provider !== 'openai' || admission.model !== MODEL || admission.outputCap !== 2000
              || ![0, 1].includes(admission.jsonAttempt) || admission.prompt !== prompt && !(admission.jsonAttempt === 1 && admission.prompt === `${prompt}\n\nYour previous reply was not valid JSON. Respond with ONLY the JSON value — no prose, no explanation, no code fences.`)) fail('probe-json-admission-invalid');
            pending = admission;
            return release;
          }, onAttempt: (modelEvent: ModelCallEvent) => { try { event('production-model-observer', modelEvent); } catch { poisoned = 'probe-durable-recording-failed'; } },
        })); } catch (error) { poisoned ??= error instanceof ProbeRefusal ? error.code : 'probe-completion-interrupted'; throw error; }
      }
      const quality = await runtime.assess({ packet: current.packet, memory: current.memory, candidate, requirements: current.requirements,
        item: index, policy: 'grounded-memory-v2', step: { model: MODEL, reasoningEffort: 'none', temperature: 0 }, complete: checkedComplete });
      check(); if (summary.sdkSends === caseSdkStart || summary.physicalWirePosts === caseWireStart) fail('probe-case-without-model-dispatch');
      state.quality = quality; state.state = 'reviewed'; event('case-reviewed', { id: current.id, quality });
    }
    summary.status = 'completed';
  } catch (error) {
    if (active) markUnknown(active);
    summary.stopCode = poisoned ?? (error instanceof ProbeRefusal ? error.code : 'probe-local-failure');
    try { event('phase-stopped', { code: summary.stopCode, sdkSends: summary.sdkSends, physicalWirePosts: summary.physicalWirePosts, conservativeReservations: summary.conservativeReservations }); } catch { /* Still no retry/dispatch. */ }
  } finally {
    try { restoreFacade(); } finally { try { restoreModules(); } finally { restoreNetwork(); running = false; } }
    try { journal.append('phase-terminal', summary); } finally { closed = true; journal.close(); }
  }
  const summaryFd = fs.openSync(path.join(directory, 'summary.json'), 'wx', 0o600);
  try { writeAll(summaryFd, redact(JSON.stringify(summary, null, 2) + '\n'), write); sync(summaryFd); } finally { fs.closeSync(summaryFd); }
  syncDirectory(directory, sync);
  return summary;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2); const get = (key: string) => {
    if (argv.filter(value => value === key).length !== 1 || !argv[argv.indexOf(key) + 1] || argv[argv.indexOf(key) + 1].startsWith('--')) fail('probe-cli-argument-required');
    return argv[argv.indexOf(key) + 1];
  };
  if (!argv.includes('--execute-approved')) {
    process.stdout.write('Preparation only. No authorization or provider dispatch. A fresh reviewed freeze and human approval are required.\n'); return;
  }
  const result = await runExclusionWarrantsProbe({ root: process.cwd(), executeApproved: true,
    declarationPath: get('--approved-declaration'), declarationSha256: get('--declaration-sha256'), approvalPath: get('--human-approval'), approvalSha256: get('--approval-sha256'),
    freezePath: get('--safety-freeze'), freezeSha256: get('--freeze-sha256'), outputDirectory: get('--output') });
  process.stdout.write(json({ status: result.status, plannedCases: result.plannedCases, sdkSends: result.sdkSends, physicalWirePosts: result.physicalWirePosts, stopCode: result.stopCode }) + '\n');
}
if (require.main === module) void main().catch(error => { process.stderr.write((error instanceof ProbeRefusal ? error.code : 'probe-local-refusal') + '\n'); process.exitCode = 1; });
