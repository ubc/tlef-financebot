// Unit test — the completeJson<T> helper added to components/genai/llm.
// Mocks the toolkit's LLMModule so we exercise the helper's own parse/retry
// logic (not a real provider): it must parse plain JSON, tolerate ```json
// code fences and surrounding prose, retry exactly once on a first unparseable
// reply, and throw when even the retry is not JSON. temperature defaults to 0.
const sendMessage = jest.fn();
const streamConversation = jest.fn();
// Never allow a local .env provider/key to activate a real native transport.
jest.mock('../../server/src/config/env', () => ({ env: {
  llmProvider: 'ollama', llmDefaultModel: 'ministral-3:latest',
  llmEndpoint: 'http://synthetic.invalid', llmApiKey: '', genaiDebug: false,
} }));
jest.mock('ubc-genai-toolkit-llm', () => ({
  LLMModule: jest.fn().mockImplementation(() => ({ sendMessage, streamConversation, getAvailableModels: jest.fn() })),
}));

import { completeJson, llm, withModelCallObserver, type ModelCallEvent } from '../../server/src/components/genai/llm';
import { modelRequestOptions } from '../../server/src/components/genai/llm/model-capabilities';

beforeEach(() => {
  sendMessage.mockReset();
  streamConversation.mockReset();
});

it('parses a plain JSON object reply', async () => {
  sendMessage.mockResolvedValue({ content: '{"themeName":"Bonds","confidence":0.8}' });
  await expect(completeJson('prompt')).resolves.toEqual({ themeName: 'Bonds', confidence: 0.8 });
  expect(sendMessage).toHaveBeenCalledTimes(1);
});

it('strips ```json code fences and surrounding prose', async () => {
  sendMessage.mockResolvedValue({
    content: 'Sure, here you go:\n```json\n{"ok":true}\n```\nHope that helps!',
  });
  await expect(completeJson('prompt')).resolves.toEqual({ ok: true });
});

it('retries exactly once when the first reply is not JSON, then succeeds', async () => {
  sendMessage
    .mockResolvedValueOnce({ content: 'I cannot help with that.' })
    .mockResolvedValueOnce({ content: '{"recovered":true}' });
  await expect(completeJson('prompt')).resolves.toEqual({ recovered: true });
  expect(sendMessage).toHaveBeenCalledTimes(2);
});

it('throws when even the retry is not valid JSON', async () => {
  sendMessage.mockResolvedValue({ content: 'still not json' });
  await expect(completeJson('prompt')).rejects.toThrow();
  expect(sendMessage).toHaveBeenCalledTimes(2);
});

it('puts back LaTeX commands whose single backslash JSON read as a control character', async () => {
  // The reply as the model sent it: `\times`, `\frac`, `\beta` and `\right` with ONE backslash,
  // which JSON decodes as tab, form feed, backspace and carriage return.
  sendMessage.mockResolvedValue({
    content: String.raw`{"options":[{"explanation":"$$FV={{C}}\times{{N}}$$ and $\frac{a}{b}$, $\beta$, $\rho$"}]}`,
  });
  const result = await completeJson<{ options: Array<{ explanation: string }> }>('prompt');
  expect(result.options[0]!.explanation).toBe(String.raw`$$FV={{C}}\times{{N}}$$ and $\frac{a}{b}$, $\beta$, $\rho$`);
  expect(sendMessage).toHaveBeenCalledTimes(1);
});

it('parses a reply whose single-backslash LaTeX is not a JSON escape at all, without a retry call', async () => {
  // `\l`, `\s` and `\d` are invalid JSON escapes, so JSON.parse rejects the whole reply.
  sendMessage.mockResolvedValue({
    content: String.raw`{"explanation":"$\left(1+\frac{r}{12}\right)^{n}$ and $\sqrt{x}$, keeping \\ and \"quotes\""}`,
  });
  await expect(completeJson('prompt')).resolves.toEqual({
    explanation: String.raw`$\left(1+\frac{r}{12}\right)^{n}$ and $\sqrt{x}$, keeping \ and "quotes"`,
  });
  expect(sendMessage).toHaveBeenCalledTimes(1);
});

it('leaves correctly escaped LaTeX, real newlines and tabs before non-letters alone', async () => {
  sendMessage.mockResolvedValue({
    content: String.raw`{"text":"$\\times$ line one\nnext line\t42","n":3}`,
  });
  await expect(completeJson('prompt')).resolves.toEqual({ text: '$\\times$ line one\nnext line\t42', n: 3 });
});

it('defaults temperature to 0 and requests JSON response format', async () => {
  sendMessage.mockResolvedValue({ content: '{}' });
  await completeJson('prompt', { model: 'ministral-3:latest' });
  const options = sendMessage.mock.calls[0][1];
  expect(options.temperature).toBe(0);
  expect(options.responseFormat).toBe('json');
  expect(options.model).toBe('ministral-3:latest');
});

// --- request shaping per capability profile ---------------------------------
// Each of these mirrors a request shape verified against the live OpenAI API on
// 2026-08-14. Getting one wrong is a hard 400 on the first call, not a
// degradation, so they are pinned rather than left to integration.

it('sends temperature and the toolkit maxTokens key on a classic model', () => {
  // An Ollama-style model: the pre-profile shape, unchanged.
  const options = modelRequestOptions({ model: 'ministral-3:latest', temperature: 0.7, maxTokens: 500 });
  expect(options.temperature).toBe(0.7);
  expect(options.maxTokens).toBe(500);
  expect(options.max_completion_tokens).toBeUndefined();
});

it('keeps temperature but renames the token cap on gpt-5.4-nano', () => {
  // nano takes a temperature AND rejects max_tokens — the pairing a
  // two-profile split got wrong, and that only a live call exposed. This is
  // also today's production shape, so it must not change.
  const options = modelRequestOptions({ model: 'gpt-5.4-nano', temperature: 0.7, maxTokens: 500 });
  expect(options.temperature).toBe(0.7);
  expect(options.max_completion_tokens).toBe(500);
  expect(options.maxTokens).toBeUndefined();
});

it('OMITS temperature entirely on gpt-5.6-luna', () => {
  // Not "sets it to 1" — the key must be absent. luna reasons by default, and
  // while reasoning it answers any explicit temperature with a 400.
  const options = modelRequestOptions({ model: 'gpt-5.6-luna', temperature: 0 });
  expect('temperature' in options).toBe(false);
});

it('drops a caller temperature on luna rather than failing', () => {
  // GENERATOR_TEMPERATURE = 0.7 keeps being passed by generation.service; on
  // luna it lapses silently instead of taking down the pipeline.
  const options = modelRequestOptions({ model: 'gpt-5.6-luna', temperature: 0.7 });
  expect('temperature' in options).toBe(false);
});

it('restores the temperature knob on luna when effort is explicitly none', () => {
  // Verified live: luna accepts temperature 0.7 alongside reasoning_effort
  // 'none'. The constraint belongs to the request, not to the model.
  const options = modelRequestOptions({ model: 'gpt-5.6-luna', temperature: 0.7, reasoningEffort: 'none' });
  expect(options.temperature).toBe(0.7);
  expect(options.reasoning_effort).toBe('none');
});

it('withdraws the temperature knob on nano as soon as effort is set', () => {
  // The mirror image, and the trap for anyone adding effort to the generator:
  // asking for reasoning costs you GENERATOR_TEMPERATURE without saying so.
  const options = modelRequestOptions({ model: 'gpt-5.4-nano', temperature: 0.7, reasoningEffort: 'low' });
  expect('temperature' in options).toBe(false);
  expect(options.reasoning_effort).toBe('low');
});

it('forwards an explicit reasoning effort, and omits it otherwise', () => {
  expect(modelRequestOptions({ model: 'gpt-5.6-luna', reasoningEffort: 'xhigh' }).reasoning_effort).toBe('xhigh');
  // Omitted unless asked, so today's production requests are unchanged.
  expect('reasoning_effort' in modelRequestOptions({ model: 'gpt-5.6-luna' })).toBe(false);
});

it('drops a reasoning effort on a model that has no reasoning channel', () => {
  const options = modelRequestOptions({ model: 'ministral-3:latest', reasoningEffort: 'high' });
  expect(options.reasoning_effort).toBeUndefined();
  expect(options.temperature).toBe(0);
});

it('asks for effort none so a reasoning model still answers deterministically', async () => {
  // The point of completeJson is a reproducible JSON answer, and a temperature
  // is only legal while the effective effort is `none`. Without this default,
  // pointing LLM_DEFAULT_MODEL at a model that reasons by default would silently
  // drop every caller's `temperature: 0` — making classification, structure
  // validation and review nondeterministic with nothing logged.
  sendMessage.mockResolvedValue({ content: '{}' });
  await completeJson('prompt', { model: 'gpt-5.6-luna' });
  const options = sendMessage.mock.calls[0][1];
  expect(options.reasoning_effort).toBe('none');
  expect(options.temperature).toBe(0);
});

it('lets a caller opt into reasoning, giving up the temperature knowingly', async () => {
  sendMessage.mockResolvedValue({ content: '{}' });
  await completeJson('prompt', { model: 'gpt-5.6-luna', reasoningEffort: 'high' });
  const options = sendMessage.mock.calls[0][1];
  expect(options.reasoning_effort).toBe('high');
  expect('temperature' in options).toBe(false);
});

it('shapes the JSON-retry request identically to the first attempt', async () => {
  sendMessage
    .mockResolvedValueOnce({ content: 'not json' })
    .mockResolvedValueOnce({ content: '{"ok":true}' });
  await completeJson('prompt', { model: 'gpt-5.6-luna', maxTokens: 400 });
  // Assert concrete keys, NOT object identity: completeJson passes the same
  // object reference to both calls, so `toEqual(calls[0][1])` would hold even
  // if every key were shaped wrongly.
  expect(sendMessage.mock.calls[1][1]).toMatchObject({
    model: 'gpt-5.6-luna',
    reasoning_effort: 'none',
    temperature: 0,
    max_completion_tokens: 400,
    responseFormat: 'json',
  });
  expect(sendMessage.mock.calls[1][1].maxTokens).toBeUndefined();
});


it('emits cumulative visible text before completion and resets before the JSON retry', async () => {
  const seen: string[] = [];
  streamConversation.mockImplementationOnce(async (_messages, chunk) => {
    chunk('not JSON');
    expect(seen).toEqual(['', 'not JSON']);
    return { content: 'not JSON' };
  }).mockImplementationOnce(async (_messages, chunk) => {
    chunk('{"stem":"A ');
    expect(seen[seen.length - 1]).toBe('{"stem":"A ');
    chunk('question"}');
    return { content: '{"stem":"A question"}' };
  });
  await expect(completeJson('prompt', { onText: text => seen.push(text), model: 'gpt-5.6-luna', maxTokens: 100 })).resolves.toEqual({ stem: 'A question' });
  expect(seen).toEqual(['', 'not JSON', '', '{"stem":"A ', '{"stem":"A question"}']);
  expect(sendMessage).not.toHaveBeenCalled();
  expect(streamConversation.mock.calls[0][2]).toMatchObject({ model: 'gpt-5.6-luna' });
});

it('checks cancellation again before an automatic JSON retry', async () => {
  sendMessage.mockResolvedValue({ content: 'not json' });
  const beforeRequest = jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('content-run-conflict'));
  await expect(completeJson('prompt', { beforeRequest })).rejects.toThrow('content-run-conflict');
  expect(sendMessage).toHaveBeenCalledTimes(1);
  expect(beforeRequest).toHaveBeenCalledTimes(2);
});

it('records every JSON attempt separately while preserving transport success', async () => {
  const events: ModelCallEvent[] = [];
  sendMessage.mockResolvedValueOnce({ content: 'invalid JSON', model: 'synthetic', usage: { promptTokens: 10, completionTokens: 2 } })
    .mockResolvedValueOnce({ content: '{"ok":true}', model: 'synthetic', usage: { promptTokens: 15, completionTokens: 3 } });
  await withModelCallObserver(event => { events.push(event); }, () => completeJson('Synthetic', { usageContext: { stage: 'generator', item: 1, candidateAttempt: 0 } }));
  expect(events).toHaveLength(4);
  expect(events[0]).toMatchObject({ type: 'started', usageContext: { stage: 'generator', item: 1, candidateAttempt: 0, jsonAttempt: 0 } });
  expect(events[2]).toMatchObject({ type: 'started', usageContext: { jsonAttempt: 1 } });
  expect(events[0].callId).not.toBe(events[2].callId);
  expect(events[1]).toMatchObject({ outcome: 'succeeded', usage: { totalTokens: 12 } });
  expect(events[3]).toMatchObject({ outcome: 'succeeded', usage: { totalTokens: 18 } });
});

it('records direct facade calls as well as completeJson calls', async () => {
  const events: ModelCallEvent[] = [];
  sendMessage.mockResolvedValue({ content: 'Synthetic', model: 'synthetic', usage: { promptTokens: 2, completionTokens: 1 } });
  await withModelCallObserver(event => { events.push(event); }, () => llm.sendMessage('Synthetic RAG request'));
  expect(events).toHaveLength(2);
  expect(events[1]).toMatchObject({ type: 'finished', usage: { totalTokens: 3 } });
});

it('does not record a provider attempt cancelled by its checkpoint', async () => {
  const observer = jest.fn(); const beforeRequest = jest.fn().mockRejectedValue(new Error('content-run-conflict'));
  await expect(withModelCallObserver(observer, () => completeJson('Synthetic', { beforeRequest }))).rejects.toThrow('content-run-conflict');
  expect(observer).not.toHaveBeenCalled(); expect(sendMessage).not.toHaveBeenCalled();
});

it('records a provider failure without an automatic JSON correction call', async () => {
  const events: ModelCallEvent[] = [];
  sendMessage.mockRejectedValue(new Error('Synthetic provider failure'));
  await expect(withModelCallObserver(event => { events.push(event); }, () => completeJson('Synthetic'))).rejects.toThrow('Synthetic provider failure');
  expect(sendMessage).toHaveBeenCalledTimes(1);
  expect(events[1]).toMatchObject({ outcome: 'failed', usage: { totalTokens: null, countSource: 'unavailable' } });
});

it('isolates both local attempt listeners and legacy usage listeners from paid work', async () => {
  const usage = { promptTokens: 2, completionTokens: 1 };
  sendMessage.mockResolvedValue({ content: '{"ok":true}', usage });
  await expect(completeJson('Synthetic', { onAttempt: async () => { throw new Error('Synthetic recording failure'); },
    onUsage: () => { throw new Error('Synthetic legacy recording failure'); } })).resolves.toEqual({ ok: true });
  expect(sendMessage).toHaveBeenCalledTimes(1);
});

it('still reports both attempts to the compatible usage hook', async () => {
  const onUsage = jest.fn();
  sendMessage.mockResolvedValueOnce({ content: 'invalid', usage: { promptTokens: 2, completionTokens: 1 } })
    .mockResolvedValueOnce({ content: '{}', usage: { promptTokens: 3, completionTokens: 2 } });
  await completeJson('Synthetic', { onUsage });
  expect(onUsage.mock.calls).toEqual([[{ promptTokens: 2, completionTokens: 1 }], [{ promptTokens: 3, completionTokens: 2 }]]);
});
