import { AsyncLocalStorage } from 'node:async_hooks';
import type { LLMOptions } from 'ubc-genai-toolkit-llm';
import { env } from '../../../config/env';
import type { AuthoringBudgetLimits, AuthoringBudgetReceipt, AuthoringBudgetOptions, AuthoringLogicalWork } from '../../../types/authoring-budget';

export interface ModelSendAdmission {
  prompt: string;
  systemPrompt?: string;
  provider: string;
  model: string;
  options: LLMOptions;
  outputCap: number;
  jsonAttempt: number;
}
export class AuthoringBudgetError extends Error {
  readonly code = 'authoring-budget-exhausted';
  constructor(readonly reason: 'sends' | 'input' | 'output' | 'total' | AuthoringLogicalWork, readonly receipt: AuthoringBudgetReceipt) {
    super(`authoring-budget-exhausted:${reason}`);
  }
}

const positive = (value: number | undefined, fallback: number) => Number.isSafeInteger(value) && value! > 0 ? value! : fallback;
export function defaultAuthoringLimits(overrides: Partial<AuthoringBudgetLimits> = {}): AuthoringBudgetLimits {
  return {
    maxSends: Math.min(overrides.maxSends ?? positive(env.authoringMaxSends, 256), positive(env.authoringMaxSends, 256)),
    maxInputTokens: overrides.maxInputTokens ?? positive(env.authoringMaxInputTokens, 24000),
    maxOutputTokens: overrides.maxOutputTokens ?? positive(env.authoringMaxOutputTokens, 24000),
    maxEstimatedTokens: Math.min(overrides.maxEstimatedTokens ?? positive(env.authoringMaxEstimatedTokens, 2_000_000), positive(env.authoringMaxEstimatedTokens, 2_000_000)),
  };
}
/** UTF-8 bytes deliberately overestimate normal text. This is an admission
 * estimate, not provider billing or a provider-compatible tokenizer. */
export function estimateAuthoringTokens(prompt: string, systemPrompt = ''): number {
  return Buffer.byteLength(prompt + systemPrompt, 'utf8') + 32;
}

export class AuthoringBudget {
  private receipt: AuthoringBudgetReceipt;
  private knownInputSends = 0;
  private knownOutputSends = 0;
  private stopped?: Error;
  private reservations = new Map<number, { tokens: number; finished: boolean }>();
  constructor(readonly group: string, limits: Partial<AuthoringBudgetLimits> = {}, readonly checkActive?: () => Promise<void>, options: AuthoringBudgetOptions = {}) {
    this.receipt = { version: 1, estimator: 'utf8-bytes-conservative-v1', retryVisibility: 'unknown', limitScope: 'process',
      observedSends: 0, estimatedInputTokens: 0, reservedOutputTokens: 0, reportedInputTokens: null, reportedOutputTokens: null, usageCompleteness: 'unknown',
      accounting: options.accounting ?? 'conservative-reservations-v1', admissionTokens: 0, pendingSends: 0, settledSends: 0, conservativeFinishedSends: 0,
      queueWaitMs: 0, executionMs: 0, rejectedSends: 0, limits: defaultAuthoringLimits(limits),
      logical: { generatorAttempts: 0, repairCycles: 0, evidenceExpansions: 0, limits: { generatorAttempts: 2, repairCycles: 1, evidenceExpansions: 1 } } };
  }
  snapshot(): AuthoringBudgetReceipt { return structuredClone(this.receipt); }
  /** Logical work belongs to this slot, while underlying sends charge every
   * enclosing budget. A format repair is a send rather than a new generator. */
  reserveLogical(kind: AuthoringLogicalWork): void {
    const key = kind === 'generator-attempt' ? 'generatorAttempts' : kind === 'repair-cycle' ? 'repairCycles' : 'evidenceExpansions';
    if (this.receipt.logical[key] >= this.receipt.logical.limits[key]) throw new AuthoringBudgetError(kind, this.snapshot());
    this.receipt.logical[key]++;
  }
  stopSends(error: Error): void { this.stopped ??= error; }
  async assertActive(): Promise<void> { await this.checkActive?.(); if (this.stopped) throw this.stopped; }
  assertAdmissible(send: ModelSendAdmission): void {
    const input = estimateAuthoringTokens(send.prompt, send.systemPrompt);
    const output = positive(send.outputCap, this.receipt.limits.maxOutputTokens);
    const limits = this.receipt.limits;
    const reason = this.receipt.observedSends >= limits.maxSends ? 'sends' : input > limits.maxInputTokens ? 'input' :
      !Number.isSafeInteger(send.outputCap) || send.outputCap <= 0 || output > limits.maxOutputTokens ? 'output' :
        this.receipt.admissionTokens! + input + output > limits.maxEstimatedTokens ? 'total' : undefined;
    if (reason) { this.receipt.rejectedSends++; throw new AuthoringBudgetError(reason, this.snapshot()); }
  }
  reserve(send: ModelSendAdmission): number {
    this.assertAdmissible(send);
    const input = estimateAuthoringTokens(send.prompt, send.systemPrompt);
    const output = positive(send.outputCap, this.receipt.limits.maxOutputTokens);
    this.receipt.observedSends++;
    this.receipt.estimatedInputTokens += input;
    this.receipt.reservedOutputTokens += output;
    this.receipt.admissionTokens! += input + output;
    this.receipt.pendingSends!++;
    const id = this.receipt.observedSends;
    this.reservations.set(id, { tokens: input + output, finished: false });
    return id;
  }
  timing(wait: number, execution: number): void { this.receipt.queueWaitMs += wait; this.receipt.executionMs += execution; }
  /** Bind completion to its admission, not a timestamp or observer event group.
   * One successful complete usage can replace one reservation exactly once. */
  finish(reservationId: number, usage?: { promptTokens?: number; completionTokens?: number }, outcome?: 'succeeded' | 'failed' | 'cancelled'): void {
    const reservation = this.reservations.get(reservationId);
    if (!reservation || reservation.finished) return;
    reservation.finished = true;
    this.receipt.pendingSends!--;
    for (const [source, target] of [['promptTokens', 'reportedInputTokens'], ['completionTokens', 'reportedOutputTokens']] as const) {
      const count = usage?.[source];
      if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) {
        this.receipt[target] = (this.receipt[target] ?? 0) + count;
        if (source === 'promptTokens') this.knownInputSends++; else this.knownOutputSends++;
      }
    }
    this.receipt.usageCompleteness = this.knownInputSends === this.receipt.observedSends && this.knownOutputSends === this.receipt.observedSends ? 'complete' :
      this.knownInputSends || this.knownOutputSends ? 'partial' : 'unknown';
    const input = usage?.promptTokens; const output = usage?.completionTokens;
    const total = input !== undefined && output !== undefined ? input + output : NaN;
    if (this.receipt.accounting === 'reported-usage-settlement-v1' && outcome === 'succeeded' &&
      Number.isSafeInteger(input) && input! >= 0 && Number.isSafeInteger(output) && output! >= 0 && Number.isSafeInteger(total)) {
      this.receipt.admissionTokens = this.receipt.admissionTokens! - reservation.tokens + total;
      this.receipt.settledSends!++;
    } else this.receipt.conservativeFinishedSends!++;
  }
}
const scopes = new AsyncLocalStorage<AuthoringBudget[]>();
/** Child slot budgets also charge their enclosing run, preventing nested retry
 * loops from obtaining a fresh allowance by opening another scope. */
export function withAuthoringBudget<T>(budget: AuthoringBudget, work: () => T): T {
  const parents = scopes.getStore() ?? [];
  return scopes.run(parents.includes(budget) ? parents : [...parents, budget], work);
}
export function currentAuthoringBudget(): AuthoringBudget | undefined { return scopes.getStore()?.at(-1); }

interface Waiter { group: string; resolve: (release: () => void) => void; }
/** Round-robin waiting groups prevent a single queued course from monopolizing
 * the process. A distributed provider quota needs deployment coordination. */
export class AuthoringSendGate {
  private active = 0;
  private queues = new Map<string, Waiter[]>();
  private lastGroup = '';
  constructor(private readonly limit: number) {}
  acquire(group: string): Promise<() => void> {
    return new Promise(resolve => {
      const rows = this.queues.get(group) ?? [];
      rows.push({ group, resolve }); this.queues.set(group, rows); this.drain();
    });
  }
  private drain(): void {
    while (this.active < this.limit && this.queues.size) {
      const groups = [...this.queues.keys()];
      const group = groups.find(candidate => candidate !== this.lastGroup) ?? groups[0];
      const queue = this.queues.get(group)!; const waiter = queue.shift()!;
      if (!queue.length) this.queues.delete(group);
      this.lastGroup = group; this.active++;
      let released = false;
      waiter.resolve(() => { if (released) return; released = true; this.active--; this.drain(); });
    }
  }
}
const providerGate = new AuthoringSendGate(positive(env.authoringProviderConcurrency, 4));
export async function admitAuthoringSend(send: ModelSendAdmission): Promise<(usage?: { promptTokens?: number; completionTokens?: number }, outcome?: 'succeeded' | 'failed' | 'cancelled') => void> {
  const budgets = scopes.getStore() ?? [];
  for (const budget of budgets) await budget.assertActive();
  const queued = Date.now();
  const release = await providerGate.acquire(budgets[0]?.group ?? 'unscoped');
  const started = Date.now();
  const reservations: Array<{ budget: AuthoringBudget; id: number }> = [];
  try {
    for (const budget of budgets) await budget.assertActive();
    for (const budget of budgets) budget.assertAdmissible(send);
    for (const budget of budgets) reservations.push({ budget, id: budget.reserve(send) });
  }
  catch (error) { release(); throw error; }
  let finished = false;
  return (usage, outcome) => {
    if (finished) return; finished = true;
    for (const { budget, id } of reservations) { budget.timing(Math.max(0, started - queued), Math.max(0, Date.now() - started)); budget.finish(id, usage, outcome); }
    release();
  };
}
