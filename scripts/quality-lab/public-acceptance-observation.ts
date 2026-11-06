import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rmdir, writeFile } from 'node:fs/promises';
import type { ModelSendAdmission } from '../../server/src/components/genai/llm';
import type { LLMModule, LLMOptions } from 'ubc-genai-toolkit-llm';
import type { ModelCallReceipt } from '../../server/src/types/model-usage';
import { PUBLIC_ACCEPTANCE_LIMITS, PUBLIC_ACCEPTANCE_SCOPE, publicObjectHash } from './public-acceptance-controls';

/** The native facade does not expose its scoped JSON-attempt counter. It is
 * deliberately unknown until an independently persisted receipt is linked. */
export type PublicNativeAdmission = Omit<ModelSendAdmission, 'jsonAttempt'> & { jsonAttempt: number | null };
export interface PublicNativeLedger {
  version: 1; scope: typeof PUBLIC_ACCEPTANCE_SCOPE; declarationSha256: string; limits: typeof PUBLIC_ACCEPTANCE_LIMITS;
  accounting: 'conservative-native-attempt-reservations-v1'; attemptReservations: number; conservativeUnits: number;
  reservations: Array<{ id: string; caseId: string; inputSha256: string; inputEstimate: number; outputReservation: number; at: string }>;
}
export async function initializePublicLedger(file: string, declarationSha256: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(declarationSha256)) throw new Error('public-acceptance-declaration-sha-required');
  const ledger: PublicNativeLedger = { version: 1, scope: PUBLIC_ACCEPTANCE_SCOPE, declarationSha256, limits: PUBLIC_ACCEPTANCE_LIMITS,
    accounting: 'conservative-native-attempt-reservations-v1', attemptReservations: 0, conservativeUnits: 0, reservations: [] };
  await writeFile(file, JSON.stringify(ledger, null, 2) + '\n', { flag: 'wx' });
}
export async function reservePublicNativeAttempt(file: string, declarationSha256: string, caseId: string, admission: PublicNativeAdmission): Promise<string> {
  const lock = `${file}.lock`; await mkdir(lock);
  try {
    const ledger = JSON.parse(await readFile(file, 'utf8')) as PublicNativeLedger;
    if (ledger.version !== 1 || ledger.scope !== PUBLIC_ACCEPTANCE_SCOPE || ledger.declarationSha256 !== declarationSha256 ||
      publicObjectHash(ledger.limits) !== publicObjectHash(PUBLIC_ACCEPTANCE_LIMITS) || ledger.accounting !== 'conservative-native-attempt-reservations-v1' ||
      ledger.attemptReservations !== ledger.reservations.length || new Set(ledger.reservations.map(item => item.id)).size !== ledger.reservations.length ||
      ledger.conservativeUnits !== ledger.reservations.reduce((sum, item) => sum + item.inputEstimate + item.outputReservation, 0)) throw new Error('public-acceptance-ledger-identity-mismatch');
    const inputEstimate = Buffer.byteLength(admission.prompt + (admission.systemPrompt ?? ''), 'utf8') + 32;
    if (inputEstimate > ledger.limits.maxInputTokens) throw new Error('public-acceptance-phase-input-cap');
    if (!Number.isSafeInteger(admission.outputCap) || admission.outputCap < 1 || admission.outputCap > ledger.limits.maxOutputTokens) throw new Error('public-acceptance-phase-output-cap');
    if (ledger.attemptReservations >= ledger.limits.maxSends || ledger.conservativeUnits + inputEstimate + admission.outputCap > ledger.limits.maxConservativeTokens) throw new Error('public-acceptance-phase-total-cap');
    const id = randomUUID(); ledger.reservations.push({ id, caseId, inputSha256: publicObjectHash(admission), inputEstimate,
      outputReservation: admission.outputCap, at: new Date().toISOString() });
    ledger.attemptReservations++; ledger.conservativeUnits += inputEstimate + admission.outputCap;
    const temporary = `${file}.${randomUUID()}.tmp`; await writeFile(temporary, JSON.stringify(ledger, null, 2) + '\n', { flag: 'wx' }); await rename(temporary, file);
    return id;
  } finally { await rmdir(lock); }
}
export interface PublicReceiptBinding {
  method: 'exact-response-id' | 'inferred-options-and-time' | 'ambiguous' | 'unmatched' | 'known-native-denial' | 'not-entered';
  callId: string | null; possibleCallIds: string[]; jsonAttempt: number | null;
}
export interface PublicNativeCapture {
  version: 1; id: string; caseId: string; admission: PublicNativeAdmission; reservationId: string | null;
  transport: string; actualArguments: unknown[]; cumulativeVisibleText: string | null; rawResponse: unknown | null;
  startedAt: string; nativeEnteredAt: string | null; completedAt: string | null; elapsedMs: number;
  state: 'prepared' | 'phase-refused' | 'native-entered' | 'returned' | 'known-native-denial' | 'dispatch-unknown';
  error: { name: string; message: string } | null;
}
export const publicSafeError = (error: unknown): { name: string; message: string } => error instanceof Error ? {
  name: error.name, message: error.message.replace(/(?:Bearer\s+|api[-_ ]?key[=:]\s*)\S+/gi, '[redacted]').slice(0, 1600),
} : { name: 'UnknownError', message: 'unknown-error' };

/** Patch only the writable facade methods. TSX's module exports can be
 * read-only accessors, and replacing completeJson would also risk changing its
 * native transport. Neither the production outer usage observer nor the
 * caller's local onAttempt/onText/cancellation callbacks are replaced. */
export function installPublicObservation(facade: { llm: LLMModule }, input: {
  configuration: { provider: string; defaultModel: string; defaultOptions?: LLMOptions };
  caseId(): string; assertCurrent(): Promise<void>; reserve(admission: PublicNativeAdmission, caseId: string): Promise<string>;
  save(capture: PublicNativeCapture): Promise<void>;
}): { restore(): void; captures: PublicNativeCapture[]; assertHealthy(): void } {
  const restores: Array<() => void> = []; const captures: PublicNativeCapture[] = []; let recordingFailure: unknown;
  // Two production generators run in parallel. Only admission is serialized;
  // an unrelated process/abandoned on-disk lock still fails closed.
  let admissionQueue = Promise.resolve();
  const serializeAdmission = <T>(work: () => Promise<T>): Promise<T> => {
    const result = admissionQueue.then(work); admissionQueue = result.then(() => undefined, () => undefined); return result;
  };
  const healthy = () => { if (recordingFailure) throw new Error('public-acceptance-recording-failed'); };
  const persist = async (capture: PublicNativeCapture) => {
    try { await input.save(structuredClone(capture)); } catch (error) { recordingFailure ??= error; throw error; }
  };
  for (const name of ['sendMessage', 'sendConversation', 'streamConversation', 'sendStructuredConversation'] as const) {
    const original = facade.llm[name]; const descriptor = Object.getOwnPropertyDescriptor(facade.llm, name);
    if (typeof original !== 'function') continue;
    const wrapped = async (...args: unknown[]) => {
      healthy(); const started = Date.now(); const optionIndex = name === 'streamConversation' || name === 'sendStructuredConversation' ? 2 : 1;
      // This is the exact shaping used by observeLLMModule, immediately inside
      // this facade. It is not the caller's requested/default effort guess.
      const options: LLMOptions = { ...input.configuration.defaultOptions, ...(args[optionIndex] as LLMOptions | undefined), ...(name === 'streamConversation' ? { stream: true } : {}) };
      const admission: PublicNativeAdmission = { prompt: typeof args[0] === 'string' ? args[0] : JSON.stringify(args[0]),
        systemPrompt: options.systemPrompt, provider: input.configuration.provider, model: options.model ?? input.configuration.defaultModel, options,
        outputCap: Number(options.maxTokens ?? options.max_completion_tokens ?? options.max_output_tokens ?? 0), jsonAttempt: null };
      const capture: PublicNativeCapture = { version: 1, id: randomUUID(), caseId: input.caseId(), admission, reservationId: null, transport: name,
        actualArguments: args.map(arg => typeof arg === 'function' ? { callback: 'original-forwarded' } : structuredClone(arg)), cumulativeVisibleText: null,
        rawResponse: null, startedAt: new Date(started).toISOString(), nativeEnteredAt: null, completedAt: null, elapsedMs: 0, state: 'prepared', error: null };
      captures.push(capture); const forwarded = [...args];
      if (name === 'streamConversation' && typeof args[1] === 'function') {
        const callback = args[1] as (text: string) => void;
        forwarded[1] = (text: string) => { capture.cumulativeVisibleText = (capture.cumulativeVisibleText ?? '') + text; callback(text); };
      }
      try {
        await serializeAdmission(async () => { healthy(); await input.assertCurrent(); await persist(capture);
          capture.reservationId = await input.reserve(admission, capture.caseId); await persist(capture); });
        capture.nativeEnteredAt = new Date().toISOString(); capture.state = 'native-entered'; await persist(capture);
        const response: unknown = await Reflect.apply(original, facade.llm, forwarded);
        capture.rawResponse = structuredClone(response); capture.state = 'returned'; healthy(); return response;
      } catch (error) {
        capture.error = publicSafeError(error);
        capture.state = capture.nativeEnteredAt === null ? 'phase-refused' :
          error && typeof error === 'object' && 'code' in error && error.code === 'authoring-budget-exhausted' ? 'known-native-denial' : 'dispatch-unknown';
        throw error;
      } finally { capture.completedAt = new Date().toISOString(); capture.elapsedMs = Date.now() - started; await persist(capture); }
    };
    Object.defineProperty(facade.llm, name, { value: wrapped, configurable: true, writable: true });
    restores.push(() => { if (descriptor) Object.defineProperty(facade.llm, name, descriptor); else Reflect.deleteProperty(facade.llm, name); });
  }
  let restored = false;
  return { captures, assertHealthy: healthy, restore: () => { if (restored) return; restored = true; for (const restore of restores.reverse()) restore(); } };
}
const responseId = (capture: PublicNativeCapture): string | null => {
  const result = capture.rawResponse as { metadata?: { id?: unknown } } | null;
  return typeof result?.metadata?.id === 'string' && result.metadata.id.length > 0 ? result.metadata.id : null;
};
function nativeReceiptOptions(capture: PublicNativeCapture): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const key of ['temperature', 'maxTokens', 'max_completion_tokens', 'max_output_tokens', 'reasoning_effort', 'stream', 'responseFormat']) {
    const value = capture.admission.options[key];
    if (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && value.length <= 80) result[key] = value;
  }
  return result;
}
/** Native Mongo receipts are independent evidence. Exact response IDs are
 * recorded links; unique option/time correspondence is explicitly inferred.
 * Parallel ambiguous matches remain unresolved, never assigned arbitrarily. */
export function reconcilePublicCaptures(captures: PublicNativeCapture[], receipts: ModelCallReceipt[]): Array<{ captureId: string; binding: PublicReceiptBinding }> {
  if (new Set(receipts.map(item => item._id)).size !== receipts.length) throw new Error('public-acceptance-duplicate-receipt-id');
  const exactIds = captures.map(responseId);
  const proposals = captures.map((capture, index) => {
    if (capture.state === 'known-native-denial') return { captureId: capture.id, binding: { method: 'known-native-denial' as const, callId: null, possibleCallIds: [], jsonAttempt: null } };
    if (capture.nativeEnteredAt === null) return { captureId: capture.id, binding: { method: 'not-entered' as const, callId: null, possibleCallIds: [], jsonAttempt: null } };
    const id = exactIds[index]; const exact = id ? receipts.filter(item => item.responseId === id) : [];
    const exactUnique = id !== null && exact.length === 1 && exactIds.filter(item => item === id).length === 1;
    const options = nativeReceiptOptions(capture);
    const inferred = receipts.filter(item => item.provider === capture.admission.provider && item.requestedModel === capture.admission.model &&
      publicObjectHash(item.requestOptions) === publicObjectHash(options) && new Date(item.startedAt).getTime() >= new Date(capture.nativeEnteredAt!).getTime() &&
      capture.completedAt !== null && new Date(item.startedAt).getTime() <= new Date(capture.completedAt).getTime());
    const candidates = exact.length ? exact : inferred;
    const unique = exactUnique || exact.length === 0 && inferred.length === 1;
    const chosen = unique ? candidates[0] : undefined;
    return { captureId: capture.id, binding: { method: exactUnique ? 'exact-response-id' as const : chosen ? 'inferred-options-and-time' as const : candidates.length ? 'ambiguous' as const : 'unmatched' as const,
      callId: chosen?._id ?? null, possibleCallIds: candidates.map(item => item._id), jsonAttempt: chosen?.jsonAttempt ?? null } };
  });
  const exactAssigned = new Set(proposals.filter(item => item.binding.method === 'exact-response-id').map(item => item.binding.callId));
  for (const proposal of proposals) if (proposal.binding.method === 'inferred-options-and-time' && exactAssigned.has(proposal.binding.callId)) {
    proposal.binding.method = 'ambiguous'; proposal.binding.callId = null; proposal.binding.jsonAttempt = null;
  }
  // Compute conflicts before mutating either side; a loop must not make its
  // first ambiguous match disappear and accidentally admit the second one.
  const assignmentCounts = new Map<string, number>();
  for (const proposal of proposals) if (proposal.binding.callId) assignmentCounts.set(proposal.binding.callId, (assignmentCounts.get(proposal.binding.callId) ?? 0) + 1);
  for (const proposal of proposals) if (proposal.binding.callId && assignmentCounts.get(proposal.binding.callId)! > 1) {
    proposal.binding.method = 'ambiguous'; proposal.binding.callId = null; proposal.binding.jsonAttempt = null;
  }
  return proposals;
}
export function summarizePublicCaptures(captures: PublicNativeCapture[], receipts?: ModelCallReceipt[]): {
  attemptReservations: number; successfulFacadeReturns: number; knownNativeAdmissionDenials: number; dispatchUnknownCaptures: number;
  actualObservedSends: number | null; recordedFinishedCalls: number | null; reportedInputTokens: number | null; reportedOutputTokens: number | null;
  inputKnownCalls: number; outputKnownCalls: number;
} {
  if (receipts && new Set(receipts.map(item => item._id)).size !== receipts.length) throw new Error('public-acceptance-duplicate-receipt-id');
  const inputs = (receipts ?? []).flatMap(item => item.usage.inputTokens === null ? [] : [item.usage.inputTokens]);
  const outputs = (receipts ?? []).flatMap(item => item.usage.outputTokens === null ? [] : [item.usage.outputTokens]);
  return { attemptReservations: captures.filter(item => item.reservationId !== null).length, successfulFacadeReturns: captures.filter(item => item.state === 'returned').length,
    knownNativeAdmissionDenials: captures.filter(item => item.state === 'known-native-denial').length,
    dispatchUnknownCaptures: captures.filter(item => item.state === 'native-entered' || item.state === 'dispatch-unknown').length,
    actualObservedSends: receipts ? receipts.length : null, recordedFinishedCalls: receipts ? receipts.filter(item => item.outcome !== 'pending').length : null,
    reportedInputTokens: inputs.length ? inputs.reduce((a, b) => a + b, 0) : null, reportedOutputTokens: outputs.length ? outputs.reduce((a, b) => a + b, 0) : null,
    inputKnownCalls: inputs.length, outputKnownCalls: outputs.length };
}
