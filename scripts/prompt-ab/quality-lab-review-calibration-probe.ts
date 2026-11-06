/** Fixed-input, approval-gated REVIEW calibration. Importing this module is inert.
 * No legacy declaration or synthetic fixture authorizes paid execution.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- Guarded application imports and CJS isolation follow the durable authority claim. */
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
import type * as BudgetModule from '../../server/src/components/genai/llm/authoring-budget';
import type * as CapabilityModule from '../../server/src/components/genai/llm/model-capabilities';
import type * as ModelBudgetModule from '../../server/src/services/generation-model-budget';
import type * as UsageModule from '../../server/src/components/genai/llm/provider-usage';
import type * as NetModule from 'node:net';
import type OpenAI from 'openai';
import type { CompleteJsonOptions, ModelSendAdmission } from '../../server/src/components/genai/llm';
import type { ModelCallEvent } from '../../server/src/components/genai/llm/model-call';
import type { OpenAICompletionClient } from '../../server/src/components/genai/llm/openai-usage-adapter';
import type { AuthoringRequirements, GenerationQualityAssessment } from '../../server/src/types/generation-quality';
import type { GenerationMemoryContent, GenerationMemorySnapshot } from '../../server/src/services/generation-memory.service';
import type { GenerationEvidencePacket } from '../../server/src/types/generation-evidence';
import type { ModelUsage } from '../../server/src/components/genai/llm/provider-usage';

export const CALIBRATION_CASE_ORDER = Object.freeze(['P01', 'P02', 'P04', 'CAPM', 'P03'] as const);
export const CALIBRATION_ARMS = Object.freeze([
  Object.freeze({ id: 'luna-none', model: 'gpt-6-luna', reasoningEffort: 'none', nativeTemperature: 0 }),
  Object.freeze({ id: 'luna-medium', model: 'gpt-6-luna', reasoningEffort: 'medium', nativeTemperature: 'omitted' }),
  Object.freeze({ id: 'sol-medium', model: 'gpt-6.1-sol', reasoningEffort: 'medium', nativeTemperature: 'omitted' }),
] as const);
export type CalibrationArm = typeof CALIBRATION_ARMS[number];
export const CALIBRATION_SCHEDULE = Object.freeze(CALIBRATION_CASE_ORDER.flatMap((caseId, caseIndex) =>
  CALIBRATION_ARMS.map((_arm, offset) => { const arm = CALIBRATION_ARMS[(caseIndex + offset) % 3];
    return Object.freeze({ order: caseIndex * 3 + offset, id: `${caseId}--${arm.id}--r1`, caseId, armId: arm.id, repetition: 1 as const }); })));
export const CALIBRATION_LIMITS = Object.freeze({ maxSdkSends: 20, maxPhysicalWirePosts: 20, maxInputUnitsPerSend: 24000,
  maxOutputTokensPerSend: 6000, maxConservativeReservationUnits: 600000, deadlineMsPerSend: 180000, maxConcurrentCalls: 1, sdkMaxRetries: 0 });
export const CALIBRATION_FAILURE_POLICY = Object.freeze({ version: 'known-format-invalid-v1', knownCompleteJsonOrSchemaExhaustion: 'cell-format-invalid-then-next-fixed-cell', identityTransportGuardJournalOrUnknown: 'sticky-stop-phase', returnedModelIdentity: 'requested-or-exact-dated-alias' });
const ENDPOINT = 'https://api.openai.com/v1';
const WIRE_URL = `${ENDPOINT}/chat/completions`;
const LAUNCHER = 'scripts/prompt-ab/quality-lab-review-calibration-probe.ts';
const TEST = 'tests/unit/quality-lab-review-calibration-probe.test.ts';
const HISTORICAL_INPUT_SHA256 = 'fd4449f968e51f5c10f18b5eac5696f529fe2f47d5e9b1d9fee438d84eb3e94f';
const selectors = { authoringPromptProtocol: 'compact-authoring-v1', numericReviewProtocol: 'server-rendered-numeric-review-v1',
  exclusionReviewProtocol: 'literal-exclusion-warrants-v1', reviewRepairProtocol: 'frozen-review-decisions-v1' } as const;
const SAFE_CONFIGURATION = Object.freeze({ provider: 'openai', endpoint: ENDPOINT, allowedPath: '/chat/completions', streaming: false,
  sdkMaxRetriesRequired: 0, perCallDeadlineMs: 180000, experimentalMaxOutputTokens: 6000 });
const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const json = (value: unknown): string => JSON.stringify(value);
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const same = (left: unknown, right: unknown): boolean => canonical(left) === canonical(right);
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export class CalibrationRefusal extends Error { constructor(readonly code: string) { super(code); this.name = 'CalibrationRefusal'; } }
function fail(code: string): never { throw new CalibrationRefusal(code); }
type WriteBytes = (fd: number, bytes: Buffer, offset: number, length: number) => number;
export interface CalibrationPin { path: string; sha256: string; bytes?: number }
export interface CalibrationCase { id: string; type: 'mcq'; candidate: GenerationMemoryContent; packet: GenerationEvidencePacket;
  memory: GenerationMemorySnapshot; requirements: AuthoringRequirements }
export interface CalibrationDeclaration {
  version: 'review-calibration-approved-v1'; executionAllowed: boolean; executionMode: 'live' | 'offline-fixture'; authorizationId: string;
  outputDirectory: string; caseOrder: readonly string[]; arms: typeof CALIBRATION_ARMS; limits: typeof CALIBRATION_LIMITS;
  safeConfiguration: typeof SAFE_CONFIGURATION; failurePolicy: typeof CALIBRATION_FAILURE_POLICY; historicalInputs: CalibrationPin; fixedInputs: CalibrationPin; schedule: CalibrationPin; currentCode: CalibrationPin;
  initialPrompts: Array<{ id: string; caseId: string; armId: string; prompt: CalibrationPin; nativeRequest: CalibrationPin;
    productionRequestedOutputCap: number; experimentalNativeOutputCap: 6000 }>;
}
export interface CalibrationLaunchOptions {
  root: string; declarationPath: string; declarationSha256: string; approvalPath: string; approvalSha256: string;
  freezePath: string; freezeSha256: string; outputDirectory: string; executeApproved: boolean;
  /** Only programmatic denied-network tests. Never exposed by the CLI. */ offlineFixture?: true;
}
export interface ReviewCalibrationRuntime {
  assess: typeof QualityModule.assessGenerationQuality; render: typeof QualityModule.renderGenerationQualityReviewPrompt;
  select: typeof MemoryModule.selectGenerationMemory; complete: typeof LlmModule.completeJson;
  estimateInput: typeof BudgetModule.estimateAuthoringTokens; modelOptions: typeof CapabilityModule.modelRequestOptions;
  productionCap: typeof ModelBudgetModule.generationStageOutputCap; normalizeUsage: typeof UsageModule.normalizeProviderUsage;
  install(client: OpenAICompletionClient, config: LLMConfig): () => void; requiredCodeFiles: string[];
}
export interface CalibrationDependencies {
  /** All injections require synthetic denied-network mode; none are live CLI arguments. */
  transport?: (url: string, init: RequestInit) => Promise<Response>;
  clientFactory?: (options: { apiKey: string; baseURL: string; maxRetries: 0; timeout: 180000; fetch: typeof fetch }) => OpenAICompletionClient;
  runtime?: ReviewCalibrationRuntime; credentials?: () => { provider: string; endpoint: string; apiKey: string };
  fsync?: (fd: number) => void; write?: WriteBytes;
}
function writeAll(fd: number, text: string, write: WriteBytes = fs.writeSync): void {
  const bytes = Buffer.from(text); let offset = 0;
  while (offset < bytes.length) { const count = write(fd, bytes, offset, bytes.length - offset);
    if (!Number.isSafeInteger(count) || count <= 0 || count > bytes.length - offset) fail('calibration-short-write-failed'); offset += count; }
}
function syncDirectory(directory: string, sync: (fd: number) => void): void {
  const fd = fs.openSync(directory, 'r'); try { sync(fd); } finally { fs.closeSync(fd); }
}
function safePath(root: string, relative: string): string {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes('\0')) fail('calibration-path-invalid');
  const target = path.resolve(root, relative), prefix = path.resolve(root) + path.sep;
  if (!target.startsWith(prefix)) fail('calibration-path-outside-root');
  let ancestor = target; while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const realRoot = fs.realpathSync(root), actual = fs.realpathSync(ancestor);
  if (actual !== realRoot && !actual.startsWith(realRoot + path.sep)) fail('calibration-symlink-outside-root'); return target;
}
function checkedFile(root: string, pin: CalibrationPin): Buffer {
  if (!pin || typeof pin.path !== 'string' || !/^[a-f0-9]{64}$/.test(pin.sha256)) fail('calibration-pin-invalid');
  const target = safePath(root, pin.path); if (fs.statSync(target).size > 32 * 1024 * 1024) fail('calibration-pin-file-too-large');
  const bytes = fs.readFileSync(target);
  if (hash(bytes) !== pin.sha256 || pin.bytes !== undefined && bytes.length !== pin.bytes) fail('calibration-file-drift'); return bytes;
}
function readBound(root: string, file: string, sha256: string): Record<string, unknown> {
  return record(JSON.parse(checkedFile(root, { path: file, sha256 }).toString('utf8')));
}
function armFor(id: string): CalibrationArm { const arm = CALIBRATION_ARMS.find(value => value.id === id); if (!arm) fail('calibration-arm-invalid'); return arm; }
function productionOutput(arm: CalibrationArm): number { return arm.reasoningEffort === 'none' ? 2000 : 6000; }
function expectedNative(prompt: string, arm: CalibrationArm): Record<string, unknown> {
  return { model: arm.model, messages: [{ role: 'user', content: prompt }], ...(arm.nativeTemperature === 0 ? { temperature: 0 } : {}),
    response_format: { type: 'json_object' }, stream: false, reasoning_effort: arm.reasoningEffort, max_completion_tokens: 6000 };
}
export function validateReviewCalibrationLaunch(options: CalibrationLaunchOptions): {
  declaration: CalibrationDeclaration; cases: CalibrationCase[]; pins: CalibrationPin[]; verify: () => void;
} {
  if (!options.executeApproved) fail('calibration-explicit-execution-flag-required');
  const d = readBound(options.root, options.declarationPath, options.declarationSha256);
  if (d.version !== 'review-calibration-approved-v1' || d.executionAllowed !== true) fail('calibration-declaration-not-approved');
  if (d.executionMode !== (options.offlineFixture ? 'offline-fixture' : 'live')) fail('calibration-execution-mode-invalid');
  if (typeof d.authorizationId !== 'string' || !/^review-calibration-new-[a-zA-Z0-9-]{8,}$/.test(d.authorizationId)) fail('calibration-fresh-authorization-required');
  if (!same(d.caseOrder, CALIBRATION_CASE_ORDER) || !same(d.arms, CALIBRATION_ARMS) || !same(d.limits, CALIBRATION_LIMITS)
    || !same(d.safeConfiguration, SAFE_CONFIGURATION) || !same(d.failurePolicy, CALIBRATION_FAILURE_POLICY) || d.outputDirectory !== options.outputDirectory) fail('calibration-scope-or-configuration-changed');
  const approval = readBound(options.root, options.approvalPath, options.approvalSha256), freeze = readBound(options.root, options.freezePath, options.freezeSha256);
  if (approval.synthetic !== Boolean(options.offlineFixture) || freeze.synthetic !== Boolean(options.offlineFixture)) fail('calibration-synthetic-approval-not-live');
  if (approval.version !== 'review-calibration-human-approval-v1' || approval.issuer !== (options.offlineFixture ? 'synthetic-test-harness' : 'human-user') || approval.approved !== true
    || approval.authorizationId !== d.authorizationId || approval.declarationSha256 !== options.declarationSha256 || approval.freezeSha256 !== options.freezeSha256
    || !/^[a-f0-9]{64}$/.test(String(approval.humanMessageSha256)) || typeof approval.humanMessageId !== 'string' || !approval.humanMessageId
    || typeof approval.approvedAt !== 'string') fail('calibration-human-approval-binding-invalid');
  if (freeze.version !== 'review-calibration-safety-freeze-v1' || freeze.reviewed !== true || freeze.declarationSha256 !== options.declarationSha256
    || freeze.authorizationId !== d.authorizationId || !/^[a-f0-9]{64}$/.test(String(freeze.independentReviewSha256))) fail('calibration-safety-freeze-binding-invalid');
  const human = record(JSON.parse(checkedFile(options.root, approval.humanEvidence as CalibrationPin).toString('utf8')));
  if (human.role !== (options.offlineFixture ? 'synthetic-user' : 'user') || human.messageId !== approval.humanMessageId || typeof human.message !== 'string'
    || hash(human.message) !== approval.humanMessageSha256 || !same(human.approves, { authorizationId: d.authorizationId,
      declarationSha256: options.declarationSha256, freezeSha256: options.freezeSha256 })) fail('calibration-human-evidence-invalid');
  const reviewPin = freeze.independentReview as CalibrationPin, review = record(JSON.parse(checkedFile(options.root, reviewPin).toString('utf8')));
  if (reviewPin.sha256 !== freeze.independentReviewSha256 || review.status !== (options.offlineFixture ? 'synthetic-reviewed-for-denied-fixture' : 'reviewed-safe-for-approval')
    || review.codeManifestSha256 !== record(d.currentCode).sha256 || review.fixedInputsSha256 !== record(d.fixedInputs).sha256
    || review.scheduleSha256 !== record(d.schedule).sha256 || review.initialPromptsSha256 !== hash(canonical(d.initialPrompts))) fail('calibration-review-evidence-invalid');
  const declaration = d as unknown as CalibrationDeclaration;
  const historicalBytes = checkedFile(options.root, declaration.historicalInputs), historical = record(JSON.parse(historicalBytes.toString('utf8')));
  if (!options.offlineFixture && hash(historicalBytes) !== HISTORICAL_INPUT_SHA256) fail('calibration-historical-origin-invalid');
  if (options.offlineFixture && historical.synthetic !== true) fail('calibration-synthetic-origin-required');
  if (!same(historical.caseOrder, CALIBRATION_CASE_ORDER) || !Array.isArray(historical.cases) || historical.cases.length !== 5) fail('calibration-historical-cases-invalid');
  const source = record(JSON.parse(checkedFile(options.root, declaration.fixedInputs).toString('utf8')));
  if (!same(source.caseOrder, CALIBRATION_CASE_ORDER) || !Array.isArray(source.cases) || source.cases.length !== 5) fail('calibration-fixed-cases-invalid');
  const expectedCases = (historical.cases as CalibrationCase[]).map(value => ({ id: value.id, type: 'mcq', candidate: value.candidate, packet: value.packet,
    memory: value.memory, requirements: { ...value.requirements, reviewRepairProtocol: selectors.reviewRepairProtocol } }));
  if (!same(source.cases, expectedCases)) fail('calibration-fixed-context-changed');
  const cases = source.cases as CalibrationCase[];
  for (const [index, value] of cases.entries()) {
    if (value.id !== CALIBRATION_CASE_ORDER[index] || value.type !== 'mcq' || value.candidate.type && value.candidate.type !== 'mcq') fail('calibration-case-order-invalid');
    for (const [key, wanted] of Object.entries(selectors)) if (record(value.requirements)[key] !== wanted) fail('calibration-selector-invalid');
    if (value.requirements.answerabilityProtocol !== 'option-answerability-v1' || value.requirements.taskDemandProtocol !== 'task-demand-v1'
      || value.requirements.exactBankProtocol !== undefined || value.requirements.taskRetrievalProtocol !== undefined) fail('calibration-forbidden-retrieval-selector');
  }
  const schedule = record(JSON.parse(checkedFile(options.root, declaration.schedule).toString('utf8')));
  if (!same(schedule.schedule, CALIBRATION_SCHEDULE) || !same(schedule.arms, CALIBRATION_ARMS)) fail('calibration-schedule-changed');
  const manifest = record(JSON.parse(checkedFile(options.root, declaration.currentCode).toString('utf8')));
  if (!Array.isArray(manifest.files)) fail('calibration-code-manifest-invalid');
  const pins = manifest.files.map(value => (record(value).original ?? value) as CalibrationPin);
  if (new Set(pins.map(value => value.path)).size !== pins.length) fail('calibration-code-pin-duplicate');
  for (const required of [LAUNCHER, TEST, 'package-lock.json', 'package.json', 'server/src/config/env.ts',
    'server/src/services/generation-quality.service.ts', 'server/src/services/generation-review-repair.ts', 'server/src/components/genai/llm/model-capabilities.ts']) {
    if (!pins.some(value => value.path === required)) fail('calibration-required-code-pin-missing');
  }
  if (!Array.isArray(declaration.initialPrompts) || declaration.initialPrompts.length !== 15) fail('calibration-initial-prompt-scope-invalid');
  const promptByCase = new Map<string, string>();
  declaration.initialPrompts.forEach((value, index) => {
    const cell = CALIBRATION_SCHEDULE[index], arm = armFor(cell.armId);
    if (value.id !== cell.id || value.caseId !== cell.caseId || value.armId !== cell.armId || value.productionRequestedOutputCap !== productionOutput(arm)
      || value.experimentalNativeOutputCap !== 6000) fail('calibration-initial-prompt-scope-invalid');
    const bytes = checkedFile(options.root, value.prompt), prompt = bytes.toString('utf8');
    if (!Buffer.from(prompt).equals(bytes) || bytes.length + 32 > 24000) fail('calibration-initial-input-overflow');
    if (promptByCase.has(cell.caseId) && promptByCase.get(cell.caseId) !== prompt) fail('calibration-initial-prompt-arm-drift'); promptByCase.set(cell.caseId, prompt);
    if (!same(JSON.parse(checkedFile(options.root, value.nativeRequest).toString('utf8')), expectedNative(prompt, arm))) fail('calibration-initial-native-shape-invalid');
  });
  const verify = () => {
    readBound(options.root, options.declarationPath, options.declarationSha256); readBound(options.root, options.approvalPath, options.approvalSha256);
    readBound(options.root, options.freezePath, options.freezeSha256); checkedFile(options.root, approval.humanEvidence as CalibrationPin); checkedFile(options.root, reviewPin);
    for (const value of [declaration.fixedInputs, declaration.historicalInputs, declaration.schedule, declaration.currentCode, ...pins]) checkedFile(options.root, value);
    for (const value of declaration.initialPrompts) { checkedFile(options.root, value.prompt); checkedFile(options.root, value.nativeRequest); }
  };
  verify(); return { declaration, cases, pins, verify };
}

const networkScope = new AsyncLocalStorage<boolean>();
const completionScope = new AsyncLocalStorage<{ cellId: string; logical: number }>();
/** Exactly one explicit HTTPS request, with no HTTP redirects or retry loop. */
async function singleHttpsPost(url: string, init: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {}; new Headers(init.headers).forEach((value, key) => { headers[key] = value; });
    const request = https.request(url, { method: 'POST', headers, signal: init.signal ?? undefined }, response => {
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 8 * 1024 * 1024) { request.destroy(new CalibrationRefusal('calibration-response-too-large')); return; } chunks.push(chunk); });
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
  const denied = () => { onDenied(); return fail('calibration-ambient-network-or-process-denied'); };
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
export function loadReviewCalibrationRuntime(): ReviewCalibrationRuntime {
  const q = require('../../server/src/services/generation-quality.service') as typeof QualityModule;
  const m = require('../../server/src/services/generation-memory.service') as typeof MemoryModule;
  const llm = require('../../server/src/components/genai/llm') as typeof LlmModule;
  const adapterModule = require('../../server/src/components/genai/llm/openai-usage-adapter') as typeof AdapterModule;
  const observed = require('../../server/src/components/genai/llm/model-call') as typeof ObserverModule;
  const budget = require('../../server/src/components/genai/llm/authoring-budget') as typeof BudgetModule;
  const caps = require('../../server/src/components/genai/llm/model-capabilities') as typeof CapabilityModule;
  const modelBudget = require('../../server/src/services/generation-model-budget') as typeof ModelBudgetModule;
  const usage = require('../../server/src/components/genai/llm/provider-usage') as typeof UsageModule;
  return { estimateInput: budget.estimateAuthoringTokens, modelOptions: caps.modelRequestOptions, productionCap: modelBudget.generationStageOutputCap, normalizeUsage: usage.normalizeProviderUsage, assess: q.assessGenerationQuality, render: q.renderGenerationQualityReviewPrompt, select: m.selectGenerationMemory, complete: llm.completeJson,
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
          value: () => fail('calibration-ambient-llm-method-denied') }); }
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
      : name.endsWith('jobs') ? { defineJob() {}, enqueueJob: () => fail('calibration-forbidden-queue'), scheduleRecurring: () => fail('calibration-forbidden-queue') }
      : new Proxy({}, { get: (_target, key) => key === '__esModule' ? false : () => fail('calibration-forbidden-io') });
    const module = new (require('node:module'))(resolved) as NodeJS.Module; module.filename = resolved; module.loaded = true; module.exports = api; require.cache[resolved] = module;
  }
  return () => { for (const [key, previous] of saved) { if (previous) require.cache[key] = previous; else delete require.cache[key]; } };
}

export interface CalibrationLogicalReview {
  logicalAttempt: 0 | 1; prompt: string; systemPrompt?: string; productionRequestedOutputCap: number; experimentalNativeOutputCap: 6000;
  state: 'started' | 'parsed' | 'known-json-exhausted'; parsed: unknown | null; rawText: string | null; sdkIds: number[]; evidence: CalibrationPin[];
}
export interface CalibrationAttempt {
  id: number; cellId: string; caseId: string; armId: string; logicalAttempt: 0 | 1; jsonAttempt: number;
  prompt: string; systemPrompt?: string; nativeRequest: Record<string, unknown>; model: string; reasoningEffort: string; nativeTemperature: 0 | 'omitted';
  productionRequestedOutputCap: number; experimentalOutputCap: 6000; inputUnits: number; nativeBodyUtf8Bytes: number; conservativeReservation: number;
  sdkDispatched: boolean; physicalPosts: number; state: 'reserved' | 'known' | 'unknown'; settled: boolean; wireResponseRecorded: boolean; sdkResultRecorded: boolean;
  visibleOutput: string | null; rawResponse?: Record<string, unknown>; returnedModel: string | null; finishReason: string | null; usage: ModelUsage | null;
  startedAt: string; finishedAt?: string; durationMs?: number; evidence: CalibrationPin[];
}
export interface CalibrationCellSummary {
  id: string; cellId: string; caseId: string; armId: string; order: number; repetition: 1;
  state: 'not-started' | 'interrupted' | 'reviewed' | 'cell-format-invalid'; quality?: GenerationQualityAssessment;
  logicalReviews: CalibrationLogicalReview[]; attempts: CalibrationAttempt[]; stopCode: string | null;
  inputDifficulty: { requested: string | null; candidate: string | null; evidence: CalibrationPin[] };
  decisionIntegrityStatus?: 'consistent' | 'drift' | 'unavailable';
  inputBindings: Record<'candidate' | 'packet' | 'memory' | 'requirements' | 'context', string>;
  formatStatus?: 'validated' | 'invalid' | 'truncated'; comparable?: boolean;
}
export interface CalibrationSummary {
  version: 'review-calibration-terminal-v1'; status: 'completed' | 'partial'; plannedCells: 15; plannedCases: 5; schedule: typeof CALIBRATION_SCHEDULE;
  cells: CalibrationCellSummary[]; sdkReservations: number; sdkSends: number; wireReservations: number; physicalWirePosts: number; conservativeReservations: number;
  reportedInputTokens: number; reportedOutputTokens: number; reportedReasoningTokens: number; reasoningKnownSends: number;
  reportedCachedInputTokens: number; cacheKnownSends: number; unknownUsageSends: number; stopCode: string | null;
  startedAt: string; finishedAt?: string; phaseElapsedMs?: number; sumSdkDurationMs: number; saved: 0; adopted: 0; teacherAcceptance: null;
}
class Journal {
  private fd: number; private previous = '0'.repeat(64); private sequence = 0;
  failed = false;
  constructor(directory: string, private sync: (fd: number) => void, private redact: (text: string) => string, private write: WriteBytes) {
    this.fd = fs.openSync(path.join(directory, 'journal.jsonl'), 'wx', 0o600);
    try { syncDirectory(directory, sync); } catch (error) { fs.closeSync(this.fd); throw error; }
  }
  append(kind: string, data: unknown): void {
    if (this.failed) fail('calibration-journal-already-failed');
    try {
      const body = this.redact(json({ sequence: this.sequence + 1, kind, previous: this.previous, data }));
      if (Buffer.byteLength(body) > 8 * 1024 * 1024) fail('calibration-record-too-large');
      const digest = hash(body); writeAll(this.fd, json({ body: JSON.parse(body), sha256: digest }) + '\n', this.write); this.sync(this.fd);
      this.previous = digest; this.sequence++;
    } catch (error) { this.failed = true; throw error; }
  }
  get committed() { return { sequence: this.sequence, sha256: this.previous }; }
  close(): void { fs.closeSync(this.fd); }
}
export function assertCalibrationAdmissionBudget(state: { sdkReservations: number; conservativeReservations: number }, inputUnits: number, outputCap: number): void {
  if (!Number.isSafeInteger(state.sdkReservations) || state.sdkReservations < 0 || !Number.isSafeInteger(state.conservativeReservations)
    || state.conservativeReservations < 0 || !Number.isSafeInteger(inputUnits) || inputUnits < 32) fail('calibration-budget-state-invalid');
  if (state.sdkReservations >= CALIBRATION_LIMITS.maxSdkSends) fail('calibration-sdk-send-limit');
  if (inputUnits > CALIBRATION_LIMITS.maxInputUnitsPerSend || outputCap !== 6000) fail('calibration-per-send-input-or-output-limit');
  if (state.conservativeReservations + inputUnits + outputCap > CALIBRATION_LIMITS.maxConservativeReservationUnits) fail('calibration-total-reservation-limit');
}
export function matchesReturnedCalibrationModel(requested: string, returned: string): boolean {
  return returned === requested || returned.startsWith(requested + '-') && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(returned.slice(requested.length + 1));
}
export function assertCalibrationWireBudget(reservations: number): void {
  if (!Number.isSafeInteger(reservations) || reservations < 0) fail('calibration-wire-state-invalid');
  if (reservations >= CALIBRATION_LIMITS.maxPhysicalWirePosts) fail('calibration-physical-post-limit');
}
function visibleResponse(value: unknown): Record<string, unknown> {
  const source = record(value);
  return { id: source.id ?? null, model: source.model ?? null, created: source.created ?? null,
    choices: (Array.isArray(source.choices) ? source.choices : []).map(value => { const choice = record(value), message = record(choice.message);
      return { index: choice.index ?? null, message: { role: message.role ?? null, content: typeof message.content === 'string' ? message.content : null,
        refusal: typeof message.refusal === 'string' ? message.refusal : null }, finish_reason: choice.finish_reason ?? null }; }), usage: source.usage ?? null };
}
function validateHeaders(input: HeadersInit | undefined, secret: string): { names: string[]; public: Record<string, string> } {
  const headers = new Headers(input), allowed = new Set(['accept', 'authorization', 'content-type', 'user-agent',
    'x-stainless-lang', 'x-stainless-package-version', 'x-stainless-os', 'x-stainless-arch', 'x-stainless-runtime', 'x-stainless-runtime-version',
    'x-stainless-retry-count', 'x-stainless-timeout', 'x-stainless-async']);
  if (headers.get('authorization') !== `Bearer ${secret}` || headers.get('content-type') !== 'application/json'
    || headers.has('x-stainless-retry-count') && headers.get('x-stainless-retry-count') !== '0') fail('calibration-wire-headers-invalid');
  const publicHeaders: Record<string, string> = {};
  headers.forEach((value, key) => { if (!allowed.has(key) || value.length > 500 || /[\r\n]/.test(value)) fail('calibration-wire-headers-invalid');
    if (key !== 'authorization') { if (value.includes(secret)) fail('calibration-sensitive-header'); publicHeaders[key] = value; } });
  return { names: [...headers.keys()].sort(), public: publicHeaders };
}
async function responseText(response: Response, signal: AbortSignal | null | undefined): Promise<string> {
  const reader = response.body?.getReader(); if (!reader) return '';
  const chunks: Uint8Array[] = []; let length = 0; let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => { onAbort = () => { void reader.cancel().catch(() => {}); reject(new CalibrationRefusal('calibration-response-aborted')); };
    if (signal?.aborted) onAbort(); else signal?.addEventListener('abort', onAbort, { once: true }); });
  try {
    while (true) { const chunk = await Promise.race([reader.read(), aborted]); if (chunk.done) break;
      length += chunk.value.length; if (length > 8 * 1024 * 1024) { void reader.cancel().catch(() => {}); fail('calibration-response-too-large'); } chunks.push(chunk.value); }
    return Buffer.concat(chunks).toString('utf8');
  } finally { if (onAbort) signal?.removeEventListener('abort', onAbort); }
}
let running = false;
export async function runReviewCalibrationProbe(options: CalibrationLaunchOptions, dependencies: CalibrationDependencies = {}): Promise<CalibrationSummary> {
  const validated = validateReviewCalibrationLaunch(options);
  if (running) fail('calibration-concurrent-runtime-denied');
  if (!options.offlineFixture && Object.keys(dependencies).length) fail('calibration-live-injection-forbidden');
  if (options.offlineFixture && (!dependencies.transport || !dependencies.credentials)) fail('calibration-offline-fixture-transport-required');
  const allowedCode = new Set(validated.pins.map(value => safePath(options.root, value.path)));
  const directory = safePath(options.root, options.outputDirectory); if (fs.existsSync(directory)) fail('calibration-resume-forbidden');
  const claimDirectory = safePath(options.root, 'audit-results/model-review-calibration-2026-10-17/launcher/execution-claims');
  fs.mkdirSync(claimDirectory, { recursive: true, mode: 0o700 });
  const claim = path.join(claimDirectory, validated.declaration.authorizationId + '.json');
  if (fs.existsSync(claim)) fail('calibration-authorization-already-claimed');
  const sync = dependencies.fsync ?? fs.fsyncSync, write = dependencies.write ?? fs.writeSync;
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const fd = fs.openSync(claim, 'wx', 0o600);
  try { writeAll(fd, json({ declarationSha256: options.declarationSha256, authorizationId: validated.declaration.authorizationId,
    outputDirectory: options.outputDirectory, state: 'claimed-no-resume-no-refill' }), write); sync(fd); } finally { fs.closeSync(fd); }
  syncDirectory(claimDirectory, sync); syncDirectory(path.dirname(directory), sync);
  let secret = ''; const redact = (text: string) => secret ? text.split(secret).join('[REDACTED]') : text;
  const journal = new Journal(directory, sync, redact, write); running = true;
  const started = Date.now(), casesHash = hash(canonical(validated.cases));
  const summary: CalibrationSummary = { version: 'review-calibration-terminal-v1', status: 'partial', plannedCells: 15, plannedCases: 5,
    schedule: CALIBRATION_SCHEDULE, cells: CALIBRATION_SCHEDULE.map(cell => {
      const input = validated.cases.find(value => value.id === cell.caseId)!;
      return { ...cell, cellId: cell.id, state: 'not-started', logicalReviews: [], attempts: [], stopCode: null,
        inputDifficulty: { requested: input.requirements.requestedDifficulty ?? null, candidate: typeof record(input.candidate).difficulty === 'string' ? record(input.candidate).difficulty as string : null, evidence: [validated.declaration.fixedInputs] },
        inputBindings: { candidate: hash(canonical(input.candidate)), packet: hash(canonical(input.packet)), memory: hash(canonical(input.memory)),
          requirements: hash(canonical(input.requirements)), context: hash(canonical(input)) } };
    }), sdkReservations: 0, sdkSends: 0, wireReservations: 0, physicalWirePosts: 0, conservativeReservations: 0, reportedInputTokens: 0,
    reportedOutputTokens: 0, reportedReasoningTokens: 0, reasoningKnownSends: 0, reportedCachedInputTokens: 0, cacheKnownSends: 0,
    unknownUsageSends: 0, stopCode: null, startedAt: new Date(started).toISOString(), sumSdkDurationMs: 0, saved: 0, adopted: 0, teacherAcceptance: null };
  let poisoned: string | null = null, closed = false; let current: CalibrationCellSummary | undefined;
  let pending: { admission: ModelSendAdmission; logical: 0 | 1; requestedOutput: number } | undefined;
  let active: { attempt: CalibrationAttempt; body: string } | undefined; let runtime: ReviewCalibrationRuntime | undefined;
  const event = (kind: string, data: unknown) => { if (closed) fail('calibration-phase-terminal');
    try { journal.append(kind, data); } catch { poisoned = 'calibration-durable-recording-failed'; fail(poisoned); } };
  const artifact = (name: string, value: unknown): CalibrationPin => {
    if (closed) fail('calibration-phase-terminal'); const bytes = Buffer.from(redact(JSON.stringify(value, null, 2) + '\n'));
    const target = path.join(directory, name); const artifactFd = fs.openSync(target, 'wx', 0o600);
    try { writeAll(artifactFd, bytes.toString(), write); sync(artifactFd); } catch { poisoned = 'calibration-durable-recording-failed'; fail(poisoned); }
    finally { fs.closeSync(artifactFd); } syncDirectory(directory, sync);
    return { path: path.relative(options.root, target), sha256: hash(bytes), bytes: bytes.length };
  };
  const check = () => { if (closed) fail('calibration-phase-terminal'); if (poisoned) fail(poisoned); validated.verify();
    if (hash(canonical(validated.cases)) !== casesHash) fail('calibration-in-memory-input-changed');
    const unbound = (runtime?.requiredCodeFiles ?? []).filter(file => !allowedCode.has(file));
    if (unbound.length) { event('imported-code-not-pinned', { files: unbound.map(file => path.relative(options.root, file)) }); fail('calibration-imported-code-not-pinned'); } };
  const markUnknown = (attempt: CalibrationAttempt) => { if (!closed && attempt.sdkDispatched && !attempt.settled && attempt.state !== 'unknown') {
    attempt.state = 'unknown'; if (!attempt.sdkResultRecorded || !attempt.usage || attempt.usage.inputTokens === null || attempt.usage.outputTokens === null) summary.unknownUsageSends++; } };
  let restoreFacade = () => {}, restoreModules = () => {}, restoreNetwork = () => {};
  try {
    event('phase-start', { declarationSha256: options.declarationSha256, approvalSha256: options.approvalSha256, freezeSha256: options.freezeSha256,
      limits: CALIBRATION_LIMITS, plannedCells: CALIBRATION_SCHEDULE, fullInputs: validated.declaration.fixedInputs,
      scope: 'Quality-only fixed cases; common6000experimental cap is not production-none cost. No generator/DB/save/adoption/hidden reasoning.' });
    restoreNetwork = installNetworkIsolation(() => { poisoned ??= 'calibration-ambient-network-or-process-denied';
      try { event('ambient-operation-denied', { code: poisoned }); } catch { /* Sticky even if a dependency swallows it. */ } });
    restoreModules = blockForbiddenModules();
    const credentials = dependencies.credentials?.() ?? (() => { const { env } = require('../../server/src/config/env') as typeof EnvModule;
      return { provider: env.llmProvider, endpoint: env.llmEndpoint || ENDPOINT, apiKey: env.llmApiKey }; })();
    if (credentials.provider !== 'openai' || (typeof credentials.endpoint === 'string' ? credentials.endpoint.replace(/\/$/, '') : '') !== ENDPOINT || typeof credentials.apiKey !== 'string'
      || credentials.apiKey.length < 16 || !/^[A-Za-z0-9._-]+$/.test(credentials.apiKey)
      || options.offlineFixture && !credentials.apiKey.startsWith('OFFLINE-')) fail('calibration-provider-configuration-invalid');
    secret = credentials.apiKey; runtime = dependencies.runtime ?? loadReviewCalibrationRuntime(); check();
    for (const arm of CALIBRATION_ARMS) {
      const step = { model: arm.model, reasoningEffort: arm.reasoningEffort, ...(arm.nativeTemperature === 0 ? { temperature: 0 } : {}) };
      if (runtime.productionCap(step, 'quality') !== productionOutput(arm)
        || !same(runtime.modelOptions({ ...step, maxTokens: 6000 }), { model: arm.model, reasoning_effort: arm.reasoningEffort,
          ...(arm.nativeTemperature === 0 ? { temperature: 0 } : {}), max_completion_tokens: 6000 })) fail('calibration-capability-shape-changed');
    }
    const wireFetch: typeof fetch = async (input, init = {}) => {
      try {
        check(); if (!active || active.attempt.physicalPosts) fail('calibration-wire-unbound-or-retry'); assertCalibrationWireBudget(summary.wireReservations);
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url !== WIRE_URL || init.method !== 'POST' || typeof init.body !== 'string' || init.body !== active.body) fail('calibration-wire-endpoint-or-body-invalid');
        if (!init.signal || init.signal.aborted) fail('calibration-aborted-before-wire'); const publicHeaders = validateHeaders(init.headers, secret);
        const attempt = active.attempt; summary.wireReservations++; attempt.physicalPosts++;
        event('wire-reserved', { sdkId: attempt.id, cellId: attempt.cellId, wireId: summary.wireReservations, url, method: 'POST',
          nativeBody: attempt.nativeRequest, nativeBodyUtf8Bytes: Buffer.byteLength(init.body), nativeBodySha256: hash(init.body), headers: publicHeaders });
        summary.physicalWirePosts++;
        const response = await networkScope.run(!options.offlineFixture, () => (dependencies.transport ?? singleHttpsPost)(url, { ...init, redirect: 'error' }));
        check(); const raw = await responseText(response, init.signal); check();
        let parsed: unknown; try { parsed = JSON.parse(raw); } catch { parsed = null; }
        if (raw.includes(secret) || json(parsed).includes(secret)) { event('sensitive-wire-response', { sdkId: attempt.id, rawSha256: hash(raw), bytes: Buffer.byteLength(raw) }); fail('calibration-sensitive-response-stop'); }
        event('wire-response', { sdkId: attempt.id, cellId: attempt.cellId, status: response.status, rawBodyUtf8Bytes: Buffer.byteLength(raw), rawBodySha256: hash(raw),
          response: visibleResponse(parsed), projection: 'Exact visible content/native usage only; no hidden reasoning fields retained.' });
        attempt.wireResponseRecorded = true;
        if (response.status < 200 || response.status >= 300 || response.redirected || response.url && response.url !== WIRE_URL) fail('calibration-http-or-redirect-stop');
        return new Response(raw, { status: response.status, headers: { 'content-type': 'application/json' } });
      } catch (error) {
        if (closed) throw new CalibrationRefusal('calibration-phase-terminal');
        poisoned ??= error instanceof CalibrationRefusal ? error.code : 'calibration-uncertain-wire-outcome';
        try { event('wire-denied-or-stopped', { sdkId: active?.attempt.id ?? null, code: poisoned, reservationRetained: true }); } catch { /* Sticky. */ }
        throw new CalibrationRefusal(poisoned);
      }
    };
    const factory = dependencies.clientFactory ?? (config => { const NativeOpenAI = (require('openai') as { default: typeof OpenAI }).default;
      const sdk = new NativeOpenAI(config); return { create: (request, requestOptions) => sdk.chat.completions.create(request as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, requestOptions) }; });
    const sdk = factory({ apiKey: secret, baseURL: ENDPOINT, maxRetries: 0, timeout: 180000, fetch: wireFetch });
    const client: OpenAICompletionClient = { create: async (request, requestOptions) => {
      check(); const scope = completionScope.getStore();
      if (!current || scope?.cellId !== current.id || !pending || scope.logical !== pending.logical || active) fail('calibration-sdk-without-admission');
      const arm = armFor(current.armId), admission = pending.admission, native = JSON.parse(json(request)) as Record<string, unknown>, body = json(native);
      if (body.includes(secret) || !same(native, expectedNative(admission.prompt, arm)) || admission.systemPrompt !== undefined
        || !requestOptions?.signal || requestOptions.signal.aborted) fail('calibration-native-request-invalid');
      const units = runtime!.estimateInput(admission.prompt, admission.systemPrompt);
      if (units !== Buffer.byteLength(admission.prompt, 'utf8') + 32) fail('calibration-admission-estimator-changed');
      assertCalibrationAdmissionBudget(summary, units, admission.outputCap);
      summary.sdkReservations++; summary.conservativeReservations += units + 6000;
      const attempt: CalibrationAttempt = { id: summary.sdkReservations, cellId: current.id, caseId: current.caseId, armId: current.armId,
        logicalAttempt: pending.logical, jsonAttempt: admission.jsonAttempt, prompt: admission.prompt, nativeRequest: native, model: arm.model,
        reasoningEffort: arm.reasoningEffort, nativeTemperature: arm.nativeTemperature, productionRequestedOutputCap: pending.requestedOutput,
        experimentalOutputCap: 6000, inputUnits: units, nativeBodyUtf8Bytes: Buffer.byteLength(body), conservativeReservation: units + 6000,
        sdkDispatched: false, physicalPosts: 0, state: 'reserved', settled: false, wireResponseRecorded: false, sdkResultRecorded: false,
        visibleOutput: null, returnedModel: null, finishReason: null, usage: null, startedAt: new Date().toISOString(), evidence: [] };
      current.attempts.push(attempt); current.logicalReviews[pending.logical].sdkIds.push(attempt.id);
      active = { attempt, body }; pending = undefined;
      event('sdk-reserved', attempt); attempt.evidence.push(artifact(`send-${attempt.id}-reserved.json`, attempt));
      try {
        check(); attempt.sdkDispatched = true; summary.sdkSends++;
        const result = record(await sdk.create(request, requestOptions)); check();
        if (attempt.physicalPosts !== 1 || !attempt.wireResponseRecorded) fail('calibration-sdk-wire-count-mismatch');
        const projected = visibleResponse(result); if (json(projected).includes(secret)) fail('calibration-sensitive-response-stop');
        const usage = runtime!.normalizeUsage('openai', result.usage, 'openai-chat');
        const choice = record(Array.isArray(projected.choices) ? projected.choices[0] : undefined), message = record(choice.message);
        attempt.rawResponse = projected; attempt.visibleOutput = typeof message.content === 'string' ? message.content : null;
        attempt.returnedModel = typeof result.model === 'string' ? result.model : null; attempt.finishReason = typeof choice.finish_reason === 'string' ? choice.finish_reason : null;
        attempt.usage = usage; attempt.finishedAt = new Date().toISOString(); attempt.durationMs = Date.parse(attempt.finishedAt) - Date.parse(attempt.startedAt);
        summary.sumSdkDurationMs += attempt.durationMs;
        event('sdk-result', { ...attempt, rawResponse: projected, usage }); attempt.sdkResultRecorded = true;
        if (usage.inputTokens === null || usage.outputTokens === null) fail('calibration-unknown-usage-stop');
        if (!attempt.returnedModel || !matchesReturnedCalibrationModel(arm.model, attempt.returnedModel)) fail('calibration-returned-model-identity-stop');
        summary.reportedInputTokens += usage.inputTokens; summary.reportedOutputTokens += usage.outputTokens;
        if (usage.reasoningTokens !== null) { summary.reportedReasoningTokens += usage.reasoningTokens; summary.reasoningKnownSends++; }
        if (usage.cachedInputTokens !== null) { summary.reportedCachedInputTokens += usage.cachedInputTokens; summary.cacheKnownSends++; }
        if (usage.outputTokens > 6000 || usage.reasoningTokens !== null && usage.reasoningTokens > usage.outputTokens
          || usage.cachedInputTokens !== null && usage.cachedInputTokens > usage.inputTokens) fail('calibration-provider-usage-or-cap-invalid');
        attempt.evidence.push(artifact(`send-${attempt.id}-result.json`, attempt)); attempt.settled = true; attempt.state = 'known'; check(); return result;
      } catch (error) {
        if (closed) throw new CalibrationRefusal('calibration-phase-terminal');
        poisoned ??= error instanceof CalibrationRefusal ? error.code : 'calibration-uncertain-sdk-outcome'; markUnknown(attempt);
        try { event('sdk-stopped', { sdkId: attempt.id, code: poisoned, reservationRetained: true }); } catch { /* Keep poison. */ }
        throw new CalibrationRefusal(poisoned);
      } finally { active = undefined; }
    } };
    restoreFacade = runtime.install(client, { provider: 'openai', defaultModel: 'gpt-6-luna', apiKey: secret, endpoint: ENDPOINT });
    for (let index = 0; index < CALIBRATION_SCHEDULE.length; index++) {
      check(); if (summary.sdkReservations >= 20) fail('calibration-sdk-send-limit');
      current = summary.cells[index]; current.state = 'interrupted'; const input = validated.cases.find(value => value.id === current!.caseId)!;
      const arm = armFor(current.armId), initial = checkedFile(options.root, validated.declaration.initialPrompts[index].prompt).toString('utf8');
      const sdkStart = summary.sdkSends, wireStart = summary.physicalWirePosts; let logicalCount = 0; let knownJsonExhaustion = false;
      event('cell-start', { ...CALIBRATION_SCHEDULE[index], inputBindings: current.inputBindings, declaredArm: arm,
        productionRequestedOutputCap: productionOutput(arm), experimentalNativeOutputCap: 6000 });
      async function checkedComplete<T>(prompt: string, completeOptions: CompleteJsonOptions = {}): Promise<T> {
        const logicalIndex = logicalCount++;
        const logical = logicalIndex as 0 | 1;
        try {
          check(); if (!current || logicalIndex > 1 || completeOptions.usageContext?.stage !== 'quality-review' || completeOptions.usageContext.item !== index
            || completeOptions.onText || completeOptions.systemPrompt !== undefined || completeOptions.model !== arm.model || completeOptions.reasoningEffort !== arm.reasoningEffort
            || completeOptions.maxTokens !== productionOutput(arm) || (arm.nativeTemperature === 0 ? completeOptions.temperature !== 0 : completeOptions.temperature !== undefined)
            || logical === 0 && prompt !== initial || logical === 1 && !(prompt.startsWith(initial + '\n\nSCHEMA FIX:') || prompt.startsWith(initial + '\n\nSAME-CANDIDATE REVIEW CORRECTION'))) fail('calibration-forbidden-stage-model-or-prompt');
          const review: CalibrationLogicalReview = { logicalAttempt: logical, prompt, productionRequestedOutputCap: completeOptions.maxTokens,
            experimentalNativeOutputCap: 6000, state: 'started', parsed: null, rawText: null, sdkIds: [], evidence: [] };
          current.logicalReviews.push(review); event('logical-review-start', { cellId: current.id, ...review });
          const value = await completionScope.run({ cellId: current.id, logical }, () => runtime!.complete<T>(prompt, { ...completeOptions, maxTokens: 6000,
            beforeRequest: async admission => {
              check(); const release = await completeOptions.beforeRequest?.(admission);
              const previousAttempts = current!.attempts.filter(value => value.logicalAttempt === logical);
              if (!admission || pending || active || admission.jsonAttempt !== previousAttempts.length || previousAttempts.length > 1 || admission.provider !== 'openai' || admission.model !== arm.model || admission.outputCap !== 6000
                || admission.systemPrompt !== undefined || ![0, 1].includes(admission.jsonAttempt)
                || admission.prompt !== prompt && !(admission.jsonAttempt === 1 && admission.prompt === `${prompt}\n\nYour previous reply was not valid JSON. Respond with ONLY the JSON value — no prose, no explanation, no code fences.`)) fail('calibration-json-admission-invalid');
              pending = { admission, logical, requestedOutput: completeOptions.maxTokens! }; return release;
            }, onAttempt: (modelEvent: ModelCallEvent) => { try { event('production-model-observer', { cellId: current?.id, logical, event: modelEvent }); }
              catch { poisoned = 'calibration-durable-recording-failed'; } },
          }));
          check(); review.parsed = value; review.rawText = current.attempts.filter(value => value.logicalAttempt === logical).at(-1)?.visibleOutput ?? null;
          review.state = 'parsed'; event('logical-review-parsed', { cellId: current.id, ...review });
          review.evidence.push(artifact(`cell-${current.id}-logical-${logical}.json`, review)); return value;
        } catch (error) {
          const attempts = current?.attempts.filter(value => value.logicalAttempt === logical) ?? [];
          const known = !poisoned && !pending && !active && attempts.length === 2 && attempts[0].jsonAttempt === 0 && attempts[1].jsonAttempt === 1
            && attempts.every(value => value.cellId === current!.id && value.armId === arm.id && value.settled && value.sdkDispatched && value.physicalPosts === 1
              && value.wireResponseRecorded && value.sdkResultRecorded && value.usage?.inputTokens !== null && value.usage?.outputTokens !== null && value.evidence.length === 2);
          if (error instanceof Error && error.message === 'llm-json-parse-failed' && known) {
            const review = current!.logicalReviews[logical]; review.state = 'known-json-exhausted'; review.rawText = attempts.at(-1)?.visibleOutput ?? null;
            knownJsonExhaustion = true; event('logical-json-exhausted', { cellId: current!.id, ...review });
            review.evidence.push(artifact(`cell-${current!.id}-logical-${logical}.json`, review)); throw error;
          }
          poisoned ??= error instanceof CalibrationRefusal ? error.code : 'calibration-completion-interrupted'; throw error;
        }
      }
      const quality = await runtime.assess({ packet: input.packet, memory: input.memory, candidate: { ...input.candidate, type: 'mcq' }, requirements: input.requirements,
        item: index, policy: 'grounded-memory-v2', step: { model: arm.model, reasoningEffort: arm.reasoningEffort, ...(arm.nativeTemperature === 0 ? { temperature: 0 } : {}) }, complete: checkedComplete });
      check(); if (summary.sdkSends === sdkStart || summary.physicalWirePosts === wireStart || pending || active || !current.attempts.every(value => value.settled)) fail('calibration-cell-without-complete-model-dispatch');
      current.quality = quality;
      const unresolved = quality.responseIssues?.some(issue => issue.attempt === 1 && issue.code !== 'review-semantic-decision-changed') ?? false;
      const truncated = current.attempts.some(value => value.finishReason === 'length');
      current.state = knownJsonExhaustion || unresolved ? 'cell-format-invalid' : 'reviewed';
      current.formatStatus = knownJsonExhaustion || unresolved ? 'invalid' : truncated ? 'truncated' : 'validated';
      const finalParsed = current.logicalReviews.at(-1)?.state === 'parsed' && current.logicalReviews.at(-1)?.parsed !== null;
      const requiredReceipts = finalParsed && quality.answerability?.protocol === 'option-answerability-v1'
        && quality.answerability.exclusionProtocol === 'literal-exclusion-warrants-v1' && !!quality.exclusionReview
        && quality.taskDemand?.protocol === 'task-demand-v1' && quality.reviewRepair?.protocol === 'frozen-review-decisions-v1';
      current.decisionIntegrityStatus = quality.reviewRepair?.status === 'drift' ? 'drift' : requiredReceipts && quality.reviewRepair?.status === 'consistent' ? 'consistent' : 'unavailable';
      current.comparable = current.formatStatus === 'validated' && current.decisionIntegrityStatus === 'consistent'; current.stopCode = knownJsonExhaustion ? 'known-json-exhausted' : unresolved ? 'unresolved-schema-or-reference' : null;
      event('cell-reviewed', current); artifact(`cell-${current.id}-terminal.json`, current);
    }
    summary.status = 'completed';
  } catch (error) {
    if (active) markUnknown(active.attempt);
    summary.stopCode = poisoned ?? (error instanceof CalibrationRefusal ? error.code : 'calibration-local-failure');
    if (current?.state === 'interrupted') current.stopCode = summary.stopCode;
    if (!journal.failed) try { event('phase-stopped', { code: summary.stopCode, sdkSends: summary.sdkSends,
      physicalWirePosts: summary.physicalWirePosts, conservativeReservations: summary.conservativeReservations }); } catch { /* No further dispatch. */ }
  } finally {
    try { restoreFacade(); } finally { try { restoreModules(); } finally { restoreNetwork(); running = false; } }
    summary.finishedAt = new Date().toISOString(); summary.phaseElapsedMs = Date.now() - started;
    if (!journal.failed) try { journal.append('phase-terminal', summary); } catch { summary.stopCode = 'calibration-durable-recording-failed'; summary.status = 'partial'; }
    closed = true; journal.close();
  }
  const terminal = { ...summary, journalStatus: journal.failed ? 'incomplete-no-resume' : 'complete', journalCommitted: journal.committed };
  const terminalFd = fs.openSync(path.join(directory, 'terminal-receipt.json'), 'wx', 0o600);
  try { writeAll(terminalFd, redact(JSON.stringify(terminal, null, 2) + '\n'), write); sync(terminalFd); } finally { fs.closeSync(terminalFd); }
  syncDirectory(directory, sync); return structuredClone(summary);
}
export function parseReviewCalibrationCli(argv: string[], root = process.cwd()): CalibrationLaunchOptions | null {
  const allowed = new Set(['--execute-approved', '--approved-declaration', '--declaration-sha256', '--human-approval',
    '--approval-sha256', '--safety-freeze', '--freeze-sha256', '--output']);
  for (let i = 0; i < argv.length; i++) { const flag = argv[i]; if (!allowed.has(flag)) fail('calibration-cli-unknown-argument');
    if (flag !== '--execute-approved') { if (!argv[i + 1] || argv[i + 1].startsWith('--')) fail('calibration-cli-argument-required'); i++; } }
  if (!argv.includes('--execute-approved')) return null;
  if (argv.filter(value => value === '--execute-approved').length !== 1) fail('calibration-cli-duplicate-argument');
  const get = (key: string) => { if (argv.filter(value => value === key).length !== 1 || !argv[argv.indexOf(key) + 1] || argv[argv.indexOf(key) + 1].startsWith('--')) fail('calibration-cli-argument-required'); return argv[argv.indexOf(key) + 1]; };
  return { root, executeApproved: true, declarationPath: get('--approved-declaration'),
    declarationSha256: get('--declaration-sha256'), approvalPath: get('--human-approval'), approvalSha256: get('--approval-sha256'),
    freezePath: get('--safety-freeze'), freezeSha256: get('--freeze-sha256'), outputDirectory: get('--output') };
}
async function main(): Promise<void> {
  const options = parseReviewCalibrationCli(process.argv.slice(2));
  if (!options) { process.stdout.write('DRAFT preparation only. No provider dispatch; a fresh reviewed freeze and human authorization are required.\n'); return; }
  const result = await runReviewCalibrationProbe(options);
  process.stdout.write(json({ status: result.status, plannedCells: result.plannedCells, sdkSends: result.sdkSends, physicalWirePosts: result.physicalWirePosts, stopCode: result.stopCode }) + '\n');
}
if (require.main === module) void main().catch(error => { process.stderr.write((error instanceof CalibrationRefusal ? error.code : 'calibration-local-refusal') + '\n'); process.exitCode = 1; });
