import { createOpenAIUsageAdapter } from '../../server/src/components/genai/llm/openai-usage-adapter';
import { createRequestDeadline, ModelCallTimeoutError } from '../../server/src/components/genai/llm/request-deadline';
import { observeModelCall, withModelCallObserver, type ModelCallEvent } from '../../server/src/components/genai/llm/model-call';
import { AuthoringBudget, withAuthoringBudget } from '../../server/src/components/genai/llm/authoring-budget';

const config = { provider: 'openai' as const, defaultModel: 'synthetic-model', apiKey: 'synthetic-test-only' };
const usage = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const chunk = (content: string) => ({ choices: [{ delta: { content } }] });

describe('total completion deadline', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { expect(jest.getTimerCount()).toBe(0); jest.useRealTimers(); });

  it.each(['sync', 'async'] as const)('recognizes an elapsed deadline on a %s failure before the timer callback runs', async mode => {
    const deadline = createRequestDeadline(100);
    const pending = deferred<unknown>();
    try {
      const work = deadline.wait(() => {
        if (mode === 'sync') {
          jest.setSystemTime(Date.now() + 100);
          throw new Error('Upstream failure after deadline');
        }
        return pending.promise;
      });
      if (mode === 'async') {
        jest.setSystemTime(Date.now() + 100);
        pending.reject(new Error('Upstream failure after deadline'));
      }
      await expect(work).rejects.toBeInstanceOf(ModelCallTimeoutError);
      expect(deadline.signal.aborted).toBe(true);
    } finally { deadline.dispose(); }
  });

  it('bounds a client that never returns headers, passes signal outside the body, and preserves unknown usage', async () => {
    const events: ModelCallEvent[] = [];
    const create = jest.fn().mockReturnValue(new Promise(() => {}));
    const adapter = createOpenAIUsageAdapter(config, { create }, { requestTimeoutMs: 100 });
    const work = withModelCallObserver(e => { events.push(e); }, () => observeModelCall(config, {}, () => adapter.sendMessage('Synthetic')));
    const failure = expect(work).rejects.toMatchObject({ name: 'ModelCallTimeoutError', code: 'model-call-timeout', timeoutMs: 100 });
    await jest.advanceTimersByTimeAsync(100);
    await failure;
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].signal).toBeUndefined();
    expect(create.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(create.mock.calls[0][1].signal.aborted).toBe(true);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ type: 'finished', outcome: 'failed', usage: { totalTokens: null, inputTokens: null, outputTokens: null } });
  });

  it('bounds a stream after one chunk and never processes a late chunk or stuck iterator cleanup', async () => {
    const late = deferred<IteratorResult<unknown>>();
    const next = jest.fn().mockResolvedValueOnce({ done: false, value: chunk('First') }).mockReturnValue(late.promise);
    const close = jest.fn().mockReturnValue(new Promise(() => {}));
    const create = jest.fn().mockResolvedValue({ [Symbol.asyncIterator]: () => ({ next, return: close }) });
    const callback = jest.fn(); const events: ModelCallEvent[] = [];
    const adapter = createOpenAIUsageAdapter(config, { create }, { requestTimeoutMs: 100 });
    const work = withModelCallObserver(e => { events.push(e); }, () => observeModelCall(config, {}, () => adapter.streamConversation([], callback)));
    const failure = expect(work).rejects.toBeInstanceOf(ModelCallTimeoutError);
    await jest.advanceTimersByTimeAsync(100); await failure;
    expect(callback.mock.calls).toEqual([['First']]); expect(close).toHaveBeenCalledTimes(1);
    const receipt = JSON.stringify(events);
    late.resolve({ done: false, value: { ...chunk('Late'), usage } });
    await jest.advanceTimersByTimeAsync(0);
    expect(callback.mock.calls).toEqual([['First']]); expect(JSON.stringify(events)).toBe(receipt);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('keeps usage already received when a compatible stream subsequently stalls', async () => {
    const next = jest.fn().mockResolvedValueOnce({ done: false, value: { choices: [], usage } }).mockReturnValue(new Promise(() => {}));
    const create = jest.fn().mockResolvedValue({ [Symbol.asyncIterator]: () => ({ next }) });
    const compatible = { ...config, provider: 'ubc-llm-sandbox' as const };
    const adapter = createOpenAIUsageAdapter(compatible, { create }, { requestTimeoutMs: 100 });
    const events: ModelCallEvent[] = [];
    const work = withModelCallObserver(e => { events.push(e); }, () => observeModelCall(compatible, {}, () => adapter.streamConversation([], () => {})));
    const failure = expect(work).rejects.toBeInstanceOf(ModelCallTimeoutError);
    await jest.advanceTimersByTimeAsync(100); await failure;
    expect(events[1]).toMatchObject({ outcome: 'failed', usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 } });
  });

  it('uses one total deadline rather than renewing it after every chunk', async () => {
    let count = 0;
    const create = jest.fn().mockResolvedValue({ [Symbol.asyncIterator]: () => ({ next: () => new Promise(resolve => {
      // Both timers settle before the test finishes; this imitates a client
      // delivering late data even after the transport signal was aborted.
      setTimeout(() => resolve({ done: false, value: chunk(String(++count)) }), 60);
    }) }) });
    const callback = jest.fn();
    const adapter = createOpenAIUsageAdapter(config, { create }, { requestTimeoutMs: 100 });
    const failure = expect(adapter.streamConversation([], callback)).rejects.toBeInstanceOf(ModelCallTimeoutError);
    await jest.advanceTimersByTimeAsync(100); await failure;
    expect(callback.mock.calls).toEqual([['1']]);
    await jest.advanceTimersByTimeAsync(20);
    expect(callback.mock.calls).toEqual([['1']]);
  });

  it('aborts the installed SDK streamed response through fetch, without an application retry', async () => {
    let transportSignal: AbortSignal | undefined;
    let requestBody: Record<string, unknown> | undefined;
    const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      transportSignal = options?.signal as AbortSignal;
      requestBody = JSON.parse(String(options?.body));
      const body = new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk('First'))}\n\n`));
        transportSignal!.addEventListener('abort', () => controller.error(Object.assign(new Error('Aborted transport'), { name: 'AbortError' })), { once: true });
      } });
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    });
    try {
      const adapter = createOpenAIUsageAdapter(config, undefined, { requestTimeoutMs: 100 });
      const callback = jest.fn();
      const failure = expect(adapter.streamConversation([], callback)).rejects.toBeInstanceOf(ModelCallTimeoutError);
      await jest.advanceTimersByTimeAsync(100); await failure;
      expect(fetch).toHaveBeenCalledTimes(1); expect(transportSignal?.aborted).toBe(true);
      expect(requestBody).not.toHaveProperty('signal'); expect(callback.mock.calls).toEqual([['First']]);
    } finally { fetch.mockRestore(); }
  });

  it('releases concurrency after timeout while retaining its entire unknown-cost reservation', async () => {
    const budget = new AuthoringBudget('deadline-test', { maxSends: 1, maxEstimatedTokens: 1000, maxOutputTokens: 100 }, undefined,
      { accounting: 'reported-usage-settlement-v1' });
    const adapter = createOpenAIUsageAdapter(config, { create: () => new Promise(() => {}) }, { requestTimeoutMs: 100 });
    const work = withAuthoringBudget(budget, () => observeModelCall(config, { maxTokens: 100 }, () => adapter.sendMessage('Synthetic'), 'Synthetic'));
    const failure = expect(work).rejects.toBeInstanceOf(ModelCallTimeoutError);
    await jest.advanceTimersByTimeAsync(0);
    const reserved = budget.snapshot().admissionTokens;
    expect(reserved).toBeGreaterThan(100);
    await jest.advanceTimersByTimeAsync(100); await failure;
    expect(budget.snapshot()).toMatchObject({ pendingSends: 0, conservativeFinishedSends: 1, settledSends: 0, admissionTokens: reserved });
    await expect(withAuthoringBudget(budget, () => observeModelCall(config, { maxTokens: 100 }, () => adapter.sendMessage('Retry'), 'Retry')))
      .rejects.toThrow('authoring-budget-exhausted:sends');
  });

  it.each(['resolve', 'reject'] as const)('consumes late nonstream %s without a second receipt or unhandled rejection', async (settle) => {
    const late = deferred<unknown>(); const events: ModelCallEvent[] = [];
    const adapter = createOpenAIUsageAdapter(config, { create: () => late.promise }, { requestTimeoutMs: 100 });
    const work = withModelCallObserver(e => { events.push(e); }, () => observeModelCall(config, {}, () => adapter.sendMessage('Synthetic')));
    const failure = expect(work).rejects.toBeInstanceOf(ModelCallTimeoutError);
    await jest.advanceTimersByTimeAsync(100); await failure;
    const receipt = JSON.stringify(events);
    if (settle === 'resolve') late.resolve({ usage, choices: [{ message: { content: 'Late' } }] });
    else late.reject(new Error('Late upstream disconnect'));
    await jest.advanceTimersByTimeAsync(0);
    expect(JSON.stringify(events)).toBe(receipt);
  });

  it('clears the timer after successful nonstream and stream completions', async () => {
    const response = { model: 'synthetic-model', usage, choices: [{ message: { content: 'Done' } }] };
    const send = createOpenAIUsageAdapter(config, { create: async () => response }, { requestTimeoutMs: 100 });
    expect((await send.sendMessage('Synthetic')).content).toBe('Done');
    const create = jest.fn().mockResolvedValue((async function* () { yield chunk('Done'); yield { choices: [], usage }; })());
    const stream = createOpenAIUsageAdapter(config, { create }, { requestTimeoutMs: 100 });
    expect((await stream.streamConversation([], () => {})).usage?.totalTokens).toBe(18);
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(200);
    expect(create.mock.calls[0][1].signal.aborted).toBe(false);
  });

  it('aborts and cleans the stream if the consumer throws, preserving that error', async () => {
    const error = Object.assign(new Error('Cancelled by caller'), { name: 'AbortError' });
    const close = jest.fn().mockRejectedValue(new Error('Cleanup failure'));
    const create = jest.fn().mockResolvedValue({ [Symbol.asyncIterator]: () => ({ next: async () => ({ done: false, value: chunk('First') }), return: close }) });
    const adapter = createOpenAIUsageAdapter(config, { create }, { requestTimeoutMs: 100 });
    await expect(adapter.streamConversation([], () => { throw error; })).rejects.toBe(error);
    expect(create.mock.calls[0][1].signal.aborted).toBe(true); expect(close).toHaveBeenCalledTimes(1);
  });

  it.each([0, -1, NaN, Infinity, 0.5, 2_147_483_648])('rejects unsafe timeout %s before creating a timer', value => {
    expect(() => createRequestDeadline(value)).toThrow('positive timer-safe integer');
  });
});
