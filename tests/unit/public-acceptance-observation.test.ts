/** Real production completeJson/observers with a synthetic native transport.
 * These assertions establish recording fidelity, never model output quality. */
const sendMessage = jest.fn(); const streamConversation = jest.fn();
jest.mock('../../server/src/config/env', () => ({ env: { llmProvider: 'ollama', llmDefaultModel: 'ministral-3:latest',
  llmEndpoint: 'http://unit.invalid', llmApiKey: '', genaiDebug: false } }));
jest.mock('ubc-genai-toolkit-llm', () => ({ LLMModule: jest.fn().mockImplementation(() => ({ sendMessage, streamConversation })) }));

import type * as LlmModule from '../../server/src/components/genai/llm';
import { installPublicObservation, reconcilePublicCaptures, summarizePublicCaptures, initializePublicLedger,
  reservePublicNativeAttempt, type PublicNativeCapture, type PublicNativeLedger } from '../../scripts/quality-lab/public-acceptance-observation';
import { AuthoringBudget, withAuthoringBudget } from '../../server/src/components/genai/llm/authoring-budget';
import type { ModelCallEvent } from '../../server/src/components/genai/llm';
import type { ModelCallReceipt } from '../../server/src/types/model-usage';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const configuration = { provider: 'ollama', defaultModel: 'ministral-3:latest' };
describe('public acceptance facade-only native observation', () => {
  let facade: typeof LlmModule; let observation: ReturnType<typeof installPublicObservation>; let persisted: PublicNativeCapture[];
  beforeEach(() => {
    sendMessage.mockReset(); streamConversation.mockReset(); facade = require('../../server/src/components/genai/llm') as typeof LlmModule; persisted = [];
    observation = installPublicObservation(facade, { configuration, caseId: () => 'unit-only', assertCurrent: async () => undefined,
      reserve: async () => 'unit-reservation', save: async capture => { persisted.push(capture); } });
  });
  afterEach(() => { observation.restore(); });
  it('preserves the helper identity, implicit effort shaping and original nonstreaming transport', async () => {
    const originalHelper = facade.completeJson;
    sendMessage.mockResolvedValue({ content: '{"ok":true}', model: 'gpt-6-luna', usage: { promptTokens: 12, completionTokens: 4, totalTokens: 16 } });
    const options = { model: 'gpt-6-luna', maxTokens: 8000, temperature: 0.7 };
    await expect(facade.completeJson('Original native prompt', options)).resolves.toEqual({ ok: true });
    expect(facade.completeJson).toBe(originalHelper); expect(options).not.toHaveProperty('reasoningEffort'); expect(streamConversation).not.toHaveBeenCalled();
    const [prompt, actual] = sendMessage.mock.calls[0] as [string, Record<string, unknown>];
    expect(prompt).toBe('Original native prompt'); expect(actual.reasoning_effort).toBe('none'); expect(actual.temperature).toBe(0.7);
    expect(observation.captures[0].admission.options).toEqual(actual); expect(observation.captures[0].admission.jsonAttempt).toBeNull();
    expect(observation.captures[0].rawResponse).toEqual({ content: '{"ok":true}', model: 'gpt-6-luna', usage: { promptTokens: 12, completionTokens: 4, totalTokens: 16 } });
    expect(summarizePublicCaptures(observation.captures)).toMatchObject({ attemptReservations: 1, successfulFacadeReturns: 1, actualObservedSends: null, reportedInputTokens: null });
  });
  it('preserves original streaming, cancellation, local onAttempt and the outer production-style usage observer together', async () => {
    const onText = jest.fn(); const onAttempt = jest.fn(); const release = jest.fn(); const checkpoint = jest.fn(async () => release); const outer: ModelCallEvent[] = [];
    streamConversation.mockImplementation(async (_messages: unknown, callback: (text: string) => void) => { callback('{"'); callback('ok":true}'); return { content: '{"ok":true}', model: 'gpt-6-luna' }; });
    await facade.withModelCallObserver(event => { outer.push(event); }, () => facade.completeJson('Streaming original', { model: 'gpt-6-luna', maxTokens: 8000, reasoningEffort: 'high', onText, onAttempt, beforeRequest: checkpoint }));
    expect(sendMessage).not.toHaveBeenCalled(); expect(onText.mock.calls.map(call => call[0])).toEqual(['', '{"', '{"ok":true}']);
    expect(checkpoint).toHaveBeenCalledTimes(1); expect(release).toHaveBeenCalledTimes(1);
    expect(onAttempt.mock.calls.map(call => (call[0] as ModelCallEvent).type)).toEqual(['started', 'finished']); expect(outer.map(event => event.type)).toEqual(['started', 'finished']);
    expect(observation.captures[0].cumulativeVisibleText).toBe('{"ok":true}'); expect(observation.captures[0].transport).toBe('streamConversation');
    expect(observation.captures[0].actualArguments[2]).toMatchObject({ reasoning_effort: 'high', max_completion_tokens: 8000 });
  });
  it('records both raw JSON replies and the exact production correction without inventing JSON-attempt metadata', async () => {
    sendMessage.mockResolvedValueOnce({ content: 'not JSON' }).mockResolvedValueOnce({ content: '{"recovered":true}' });
    await expect(facade.completeJson('Initial prompt', { model: 'gpt-6-luna', maxTokens: 8000 })).resolves.toEqual({ recovered: true });
    expect(observation.captures).toHaveLength(2); expect(observation.captures.map(item => item.admission.jsonAttempt)).toEqual([null, null]);
    expect(observation.captures[1].admission.prompt).toContain('Your previous reply was not valid JSON.');
    expect(observation.captures[0].rawResponse).toEqual({ content: 'not JSON' }); expect(sendMessage).toHaveBeenCalledTimes(2);
  });
  it('records generic native failure as unknown dispatch and unknown usage, while the original observer still records its failed call', async () => {
    const outer: ModelCallEvent[] = []; sendMessage.mockRejectedValue(new Error('Synthetic provider failure'));
    await expect(facade.withModelCallObserver(event => { outer.push(event); }, () => facade.completeJson('Native failure', { model: 'gpt-6-luna', maxTokens: 8000 }))).rejects.toThrow('Synthetic provider failure');
    expect(sendMessage).toHaveBeenCalledTimes(1); expect(observation.captures[0].state).toBe('dispatch-unknown'); expect(outer[1]).toMatchObject({ type: 'finished', outcome: 'failed' });
    expect(summarizePublicCaptures(observation.captures)).toMatchObject({ dispatchUnknownCaptures: 1, actualObservedSends: null, reportedInputTokens: null });
  });
  it('releases the untouched original checkpoint when phase admission refuses and performs no native send', async () => {
    observation.restore(); const release = jest.fn();
    observation = installPublicObservation(facade, { configuration, caseId: () => 'unit', assertCurrent: async () => undefined,
      reserve: async () => { throw new Error('Declared phase exhausted'); }, save: async capture => { persisted.push(capture); } });
    await expect(facade.completeJson('Budget failure', { model: 'gpt-6-luna', maxTokens: 8000, beforeRequest: async () => release })).rejects.toThrow('Declared phase exhausted');
    expect(release).toHaveBeenCalledTimes(1); expect(sendMessage).not.toHaveBeenCalled(); expect(observation.captures[0].state).toBe('phase-refused');
  });
  it('keeps a phase reservation charged when a real unchanged native budget refuses before dispatch', async () => {
    const native = new AuthoringBudget('unit', { maxSends: 0 });
    await expect(withAuthoringBudget(native, () => facade.completeJson('Native denial', { model: 'gpt-6-luna', maxTokens: 8000 }))).rejects.toThrow('authoring-budget-exhausted:sends');
    expect(sendMessage).not.toHaveBeenCalled(); expect(observation.captures[0].reservationId).toBe('unit-reservation'); expect(observation.captures[0].state).toBe('known-native-denial');
    expect(summarizePublicCaptures(observation.captures)).toMatchObject({ attemptReservations: 1, knownNativeAdmissionDenials: 1, actualObservedSends: null });
  });
  it('serializes two concurrent real file reservations while keeping provider work parallel', async () => {
    observation.restore(); const directory = await mkdtemp(path.join(os.tmpdir(), 'public-parallel-admission-')); const ledgerFile = path.join(directory, 'ledger.json'); const sha = 'c'.repeat(64);
    await initializePublicLedger(ledgerFile, sha); let releaseProvider!: () => void; let bothStarted!: () => void; let started = 0;
    const providerGate = new Promise<void>(resolve => { releaseProvider = resolve; }); const parallelStarted = new Promise<void>(resolve => { bothStarted = resolve; });
    sendMessage.mockImplementation(async (prompt: string) => { started++; if (started === 2) bothStarted(); await providerGate; return { content: JSON.stringify({ prompt }) }; });
    observation = installPublicObservation(facade, { configuration, caseId: () => 'parallel-case', assertCurrent: async () => undefined,
      reserve: admission => reservePublicNativeAttempt(ledgerFile, sha, 'parallel-case', admission), save: async capture => { persisted.push(capture); } });
    try {
      const first = facade.completeJson('First generator', { model: 'gpt-6-luna', maxTokens: 8000 }); const second = facade.completeJson('Second generator', { model: 'gpt-6-luna', maxTokens: 8000 });
      await parallelStarted; expect(started).toBe(2); releaseProvider();
      await expect(Promise.all([first, second])).resolves.toEqual([{ prompt: 'First generator' }, { prompt: 'Second generator' }]);
      const ledger = JSON.parse(await readFile(ledgerFile, 'utf8')) as PublicNativeLedger; expect(ledger.attemptReservations).toBe(2);
      expect(new Set(ledger.reservations.map(item => item.id)).size).toBe(2); expect(observation.captures.map(item => item.admission.prompt)).toEqual(['First generator', 'Second generator']);
      expect(summarizePublicCaptures(observation.captures).successfulFacadeReturns).toBe(2);
    } finally { releaseProvider(); observation.restore(); await rm(directory, { recursive: true, force: true }); }
  });
  it('fails closed on recording loss before a provider call and restores native method identities', async () => {
    observation.restore(); const original = facade.llm.sendMessage; observation = installPublicObservation(facade, { configuration, caseId: () => 'unit', assertCurrent: async () => undefined,
      reserve: async () => 'reservation', save: async () => { throw new Error('Synthetic disk failure'); } });
    await expect(facade.completeJson('Cannot record', { model: 'gpt-6-luna', maxTokens: 8000 })).rejects.toThrow('Synthetic disk failure'); expect(sendMessage).not.toHaveBeenCalled();
    expect(() => observation.assertHealthy()).toThrow('recording-failed'); observation.restore(); expect(facade.llm.sendMessage).toBe(original);
  });
  it('works across actual TSX read-only export getters with no native/provider/network access', () => {
    const code = `const assert=require('node:assert/strict'); const net=require('node:net'); global.fetch=()=>{throw Error('No network')}; net.Socket.prototype.connect=function(){throw Error('No sockets')};
+const envPath=require.resolve('./server/src/config/env.ts'); require.cache[envPath]={id:envPath,filename:envPath,loaded:true,exports:{env:{llmProvider:'ollama',llmDefaultModel:'ministral-3:latest',llmEndpoint:'http://unit.invalid',llmApiKey:'',genaiDebug:false}}};
+let sends=0; const toolkit=require.resolve('ubc-genai-toolkit-llm');require.cache[toolkit]={id:toolkit,filename:toolkit,loaded:true,exports:{LLMModule:class{async sendMessage(){sends++;return {content:'{"ok":true}'}}}}};
+const llm=require('./server/src/components/genai/llm/index.ts');const recorder=require('./scripts/quality-lab/public-acceptance-observation.ts');const descriptor=Object.getOwnPropertyDescriptor(llm,'completeJson');assert.equal(typeof descriptor.get,'function');assert.equal(descriptor.set,undefined);assert.equal(descriptor.configurable,false);
+const identity=llm.completeJson;const installed=recorder.installPublicObservation(llm,{configuration:{provider:'ollama',defaultModel:'ministral-3:latest'},caseId:()=> 'unit',assertCurrent:async()=>{},reserve:async()=> 'unit',save:async()=>{}});
+(async()=>{try{assert.deepEqual(await llm.completeJson('unit',{model:'gpt-6-luna',maxTokens:100}),{ok:true});assert.equal(llm.completeJson,identity);assert.equal(sends,1);console.log(JSON.stringify({readOnlyGetter:true,helperUnchanged:true,nativeSyntheticSends:sends,networkCalls:0}));}finally{installed.restore()}})().catch(e=>{console.error(e.message);process.exitCode=1});`.replace(/^\+/gm, '');
    const output = execFileSync(process.execPath, ['--import', 'tsx', '-e', code], { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', timeout: 15000 });
    expect(JSON.parse(output.trim().split('\n').at(-1)!)).toEqual({ readOnlyGetter: true, helperUnchanged: true, nativeSyntheticSends: 1, networkCalls: 0 });
  });
});

function recorded(capture: PublicNativeCapture, id: string, responseId: string | null): ModelCallReceipt {
  return { _id: id, trackingSessionId: 'unit', provider: capture.admission.provider, requestedModel: capture.admission.model, actualModel: null, responseId,
    stage: 'generation', jsonAttempt: 0, requestOptions: { max_completion_tokens: 8000, reasoning_effort: 'none', responseFormat: 'json' }, startedAt: new Date(capture.nativeEnteredAt!),
    finishedAt: new Date(capture.completedAt!), durationMs: 10, outcome: 'succeeded', retryVisibility: 'unknown', usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15,
      reasoningTokens: null, cachedInputTokens: null, cacheWriteTokens: null, totalOrigin: 'provider', countSource: 'provider-reported' } };
}
function captured(id: string, responseId: string | null): PublicNativeCapture {
  return { version: 1, id, caseId: 'unit', admission: { provider: 'ollama', model: 'gpt-6-luna', prompt: 'unit', outputCap: 8000, jsonAttempt: null,
    options: { max_completion_tokens: 8000, reasoning_effort: 'none', responseFormat: 'json' } }, reservationId: id, transport: 'sendMessage', actualArguments: [], cumulativeVisibleText: null,
    rawResponse: { content: '{}', ...(responseId ? { metadata: { id: responseId } } : {}) }, startedAt: '2026-10-16T00:00:00.000Z', nativeEnteredAt: '2026-10-16T00:00:00.001Z',
    completedAt: '2026-10-16T00:00:00.100Z', elapsedMs: 100, state: 'returned', error: null };
}
describe('independent native receipt correspondence', () => {
  it('uses exact unique response IDs and preserves real JSON-attempt counters', () => {
    const capture = captured('raw1', 'response1'); const receipt = recorded(capture, 'call1', 'response1'); receipt.jsonAttempt = 1;
    expect(reconcilePublicCaptures([capture], [receipt])[0].binding).toMatchObject({ method: 'exact-response-id', callId: 'call1', jsonAttempt: 1 });
    expect(summarizePublicCaptures([capture], [receipt])).toMatchObject({ actualObservedSends: 1, reportedInputTokens: 12, reportedOutputTokens: 3 });
  });
  it('labels a sole options/time correspondence as inferred and leaves a parallel pair ambiguous', () => {
    const first = captured('raw1', null); const second = captured('raw2', null); const receipts = [recorded(first, 'call1', null), recorded(second, 'call2', null)];
    expect(reconcilePublicCaptures([first], [receipts[0]])[0].binding).toMatchObject({ method: 'inferred-options-and-time', callId: 'call1' });
    expect(reconcilePublicCaptures([first, second], receipts).every(item => item.binding.method === 'ambiguous' && item.binding.callId === null)).toBe(true);
    expect(reconcilePublicCaptures([first, second], [receipts[0]]).every(item => item.binding.method === 'ambiguous' && item.binding.callId === null)).toBe(true);
  });
  it('never resolves duplicate response IDs and does not steal an exact match for an inferred capture', () => {
    const exact = captured('exact', 'response1'); const unknown = captured('unknown', null); const receipt = recorded(exact, 'call1', 'response1');
    const rows = reconcilePublicCaptures([exact, unknown], [receipt]); expect(rows[0].binding.method).toBe('exact-response-id'); expect(rows[1].binding.callId).toBeNull();
    expect(reconcilePublicCaptures([exact, captured('duplicate', 'response1')], [receipt]).every(item => item.binding.callId === null)).toBe(true);
    expect(() => reconcilePublicCaptures([exact], [receipt, receipt])).toThrow('duplicate-receipt-id');
  });
  it('leaves missing receipts unresolved and cannot turn unknown usage into zero tokens', () => {
    const capture = captured('raw1', null); expect(reconcilePublicCaptures([capture], [])[0].binding.method).toBe('unmatched');
    expect(summarizePublicCaptures([capture], [])).toMatchObject({ successfulFacadeReturns: 1, actualObservedSends: 0, reportedInputTokens: null, reportedOutputTokens: null });
    const denial = { ...capture, state: 'known-native-denial' as const, rawResponse: null };
    expect(reconcilePublicCaptures([denial], [recorded(capture, 'unrelated', null)])[0].binding.method).toBe('known-native-denial');
  });
});
