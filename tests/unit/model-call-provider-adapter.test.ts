import { createOpenAIUsageAdapter } from '../../server/src/components/genai/llm/openai-usage-adapter';
import { observeModelCall, withModelCallObserver, type ModelCallEvent } from '../../server/src/components/genai/llm/model-call';

const config = { provider: 'openai' as const, defaultModel: 'synthetic-model', apiKey: 'synthetic-test-only' };
const usage = { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130,
  prompt_tokens_details: { cached_tokens: 60 }, completion_tokens_details: { reasoning_tokens: 12 } };
const chunks = async function* (...events: unknown[]) { yield* events; };

describe('source-controlled OpenAI-compatible usage adapter', () => {
  it('keeps the nonstream request shape and native usage details', async () => {
    const events: ModelCallEvent[] = [];
    const create = jest.fn().mockResolvedValue({ id: 'reply-1', model: 'actual-model', choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage });
    const adapter = createOpenAIUsageAdapter(config, { create });
    const options = { max_completion_tokens: 500, reasoning_effort: 'none', temperature: 0, responseFormat: 'json' as const, systemPrompt: 'Synthetic system' };
    const result = await withModelCallObserver(event => { events.push(event); }, () => observeModelCall(config, options, () => adapter.sendMessage('Synthetic user', options)));
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({ model: 'synthetic-model', stream: false, max_completion_tokens: 500,
      reasoning_effort: 'none', response_format: { type: 'json_object' }, messages: [{ role: 'system', content: 'Synthetic system' }, { role: 'user', content: 'Synthetic user' }] });
    expect(result).toMatchObject({ content: '{"ok":true}', usage: { promptTokens: 100, completionTokens: 30, totalTokens: 130 } });
    expect(events[1]).toMatchObject({ responseId: 'reply-1', actualModel: 'actual-model', usage: { totalTokens: 130, cachedInputTokens: 60, reasoningTokens: 12 } });
  });
  it('captures the final empty-choices usage chunk without treating it as text', async () => {
    // Official streaming contract: https://developers.openai.com/cookbook/examples/how_to_stream_completions
    const events: ModelCallEvent[] = []; const visible: string[] = [];
    const create = jest.fn().mockResolvedValue(chunks(
      { id: 'stream-1', model: 'actual-model', choices: [{ delta: { content: 'Synthetic ' } }] },
      { id: 'stream-1', choices: [{ delta: { content: 'text' }, finish_reason: 'stop' }] },
      { id: 'stream-1', choices: [], usage },
    ));
    const adapter = createOpenAIUsageAdapter(config, { create });
    const result = await withModelCallObserver(event => { events.push(event); }, () => observeModelCall(config, {}, () => adapter.streamConversation([], part => visible.push(part), { responseFormat: 'json' })));
    expect(result.content).toBe('Synthetic text'); expect(visible).toEqual(['Synthetic ', 'text']);
    expect(create.mock.calls[0][0]).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    expect(create.mock.calls[0][0].response_format).toBeUndefined();
    expect(events[1]).toMatchObject({ outcome: 'succeeded', actualModel: 'actual-model', usage: { totalTokens: 130, cachedInputTokens: 60 } });
  });
  it('does not invent usage when the stream ends without a usage frame', async () => {
    const events: ModelCallEvent[] = [];
    const create = jest.fn().mockResolvedValue(chunks({ choices: [{ delta: { content: 'Synthetic' } }] }));
    const adapter = createOpenAIUsageAdapter(config, { create });
    await withModelCallObserver(event => { events.push(event); }, () => observeModelCall(config, {}, () => adapter.streamConversation([], () => {})));
    expect(events[1]).toMatchObject({ usage: { totalTokens: null, countSource: 'unavailable' }, actualModel: null });
  });
  it('retains reported usage when a callback cancels after the terminal frame', async () => {
    const events: ModelCallEvent[] = [];
    const error = Object.assign(new Error('Synthetic cancellation'), { name: 'AbortError' });
    const create = jest.fn().mockResolvedValue(chunks({ id: 'cancel-1', model: 'actual-model', choices: [{ delta: { content: 'Synthetic' } }], usage }));
    const adapter = createOpenAIUsageAdapter(config, { create });
    await expect(withModelCallObserver(event => { events.push(event); }, () => observeModelCall(config, {}, () => adapter.streamConversation([], () => { throw error; })))).rejects.toBe(error);
    expect(create).toHaveBeenCalledTimes(1);
    expect(events[1]).toMatchObject({ outcome: 'cancelled', usage: { totalTokens: 130 }, responseId: 'cancel-1' });
  });
  it('retains prior usage when iteration later fails, including compatible sandbox calls', async () => {
    const events: ModelCallEvent[] = [];
    const create = jest.fn().mockResolvedValue((async function* () {
      yield { id: 'failed-1', choices: [], usage }; throw new Error('Synthetic disconnect');
    })());
    const compatible = { ...config, provider: 'ubc-llm-sandbox' as const, endpoint: 'https://synthetic.invalid/v1' };
    const adapter = createOpenAIUsageAdapter(compatible, { create });
    await expect(withModelCallObserver(event => { events.push(event); }, () => observeModelCall(compatible, {}, () => adapter.streamConversation([], () => {})))).rejects.toThrow('Synthetic disconnect');
    expect(create).toHaveBeenCalledTimes(1); expect(events[1]).toMatchObject({ outcome: 'failed', usage: { totalTokens: 130 }, provider: 'ubc-llm-sandbox' });
  });
});
