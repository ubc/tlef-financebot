import type { LLMModule } from 'ubc-genai-toolkit-llm';
import { captureModelCallResponse, observeLLMModule, observeModelCall, withModelCallContext, withModelCallObserver,
  type ModelCallEvent } from '../../server/src/components/genai/llm/model-call';

const config = { provider: 'openai' as const, defaultModel: 'synthetic-model' };
const response = { content: 'synthetic', model: 'actual-model', usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 }, metadata: { id: 'response-1' } };
const collect = (events: ModelCallEvent[]) => (event: ModelCallEvent) => { events.push(event); };

describe('model call observation', () => {
  it('records paired safe events per invocation and excludes private request fields', async () => {
    const events: ModelCallEvent[] = [];
    const work = jest.fn().mockResolvedValue(response);
    await withModelCallObserver(collect(events), () => withModelCallContext({ stage: 'review', item: 2, candidateAttempt: 1 }, undefined,
      () => observeModelCall(config, { temperature: 0, max_completion_tokens: 500, systemPrompt: 'private material', apiKey: 'secret' }, work)));
    expect(work).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'started', actualModel: null, responseId: null, retryVisibility: 'unknown' });
    expect(events[1]).toMatchObject({ type: 'finished', outcome: 'succeeded', actualModel: 'actual-model', responseId: 'response-1',
      usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 }, usageContext: { stage: 'review', item: 2, candidateAttempt: 1 } });
    expect(events[1].callId).toBe(events[0].callId);
    expect(events[0].callId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(events)).not.toMatch(/private material|secret|systemPrompt|apiKey/);
  });
  it('records distinct concurrent calls and replaces parent owners in nested scopes', async () => {
    const outer: ModelCallEvent[] = []; const first: ModelCallEvent[] = []; const second: ModelCallEvent[] = [];
    await withModelCallObserver(collect(outer), () => Promise.all([
      withModelCallObserver(collect(first), () => observeModelCall(config, {}, async () => response)),
      withModelCallObserver(collect(second), () => observeModelCall(config, {}, async () => response)),
    ]));
    expect(outer).toHaveLength(0); expect(first).toHaveLength(2); expect(second).toHaveLength(2);
    expect(first[0].callId).not.toBe(second[0].callId);
  });
  it('allows a local observer alongside the scoped owner without duplicate delivery', async () => {
    const events: ModelCallEvent[] = []; const local = jest.fn(); const owner = collect(events);
    await withModelCallObserver(owner, () => withModelCallContext({ stage: 'generator' }, local, () => observeModelCall(config, {}, async () => response)));
    expect(events).toHaveLength(2); expect(local).toHaveBeenCalledTimes(2);
    await withModelCallObserver(owner, () => withModelCallContext({}, owner, () => observeModelCall(config, {}, async () => response)));
    expect(events).toHaveLength(4);
  });
  it('isolates synchronous and asynchronous observer exceptions from the response', async () => {
    const work = jest.fn().mockResolvedValue(response);
    await expect(withModelCallObserver(() => { throw new Error('telemetry outage'); }, () => observeModelCall(config, {}, work))).resolves.toBe(response);
    await expect(withModelCallObserver(async () => { throw new Error('async telemetry outage'); }, () => observeModelCall(config, {}, work))).resolves.toBe(response);
    expect(work).toHaveBeenCalledTimes(2);
  });
  it('preserves raw provider usage captured before an interrupted call throws', async () => {
    const events: ModelCallEvent[] = [];
    const error = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    await expect(withModelCallObserver(collect(events), () => observeModelCall(config, {}, async () => {
      captureModelCallResponse({ usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 }, format: 'openai-chat', model: 'actual', responseId: 'paid-1' });
      captureModelCallResponse({ format: 'openai-chat' });
      throw error;
    }))).rejects.toBe(error);
    expect(events[1]).toMatchObject({ outcome: 'cancelled', actualModel: 'actual', responseId: 'paid-1', usage: { totalTokens: 13 } });
  });
  it('reports failed calls without usage as unknown, not zero', async () => {
    const events: ModelCallEvent[] = []; const error = new Error('provider failure');
    await expect(withModelCallObserver(collect(events), () => observeModelCall(config, {}, async () => { throw error; }))).rejects.toBe(error);
    expect(events[1]).toMatchObject({ outcome: 'failed', usage: { totalTokens: null, countSource: 'unavailable' } });
  });
  it('instruments direct facade send and stream calls', async () => {
    const events: ModelCallEvent[] = [];
    const sendMessage = jest.fn().mockResolvedValue(response); const streamConversation = jest.fn().mockResolvedValue(response);
    const module = observeLLMModule({ sendMessage, streamConversation } as unknown as LLMModule, config);
    await withModelCallObserver(collect(events), async () => {
      await module.sendMessage('synthetic'); await module.streamConversation([], () => {});
    });
    expect(sendMessage).toHaveBeenCalledTimes(1); expect(streamConversation).toHaveBeenCalledTimes(1);
    expect(events.filter(event => event.type === 'started')).toHaveLength(2);
    expect(events[2]).toMatchObject({ requestOptions: { stream: true } });
  });
});
