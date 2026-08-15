// Unit test — the completeJson<T> helper added to components/genai/llm.
// Mocks the toolkit's LLMModule so we exercise the helper's own parse/retry
// logic (not a real provider): it must parse plain JSON, tolerate ```json
// code fences and surrounding prose, retry exactly once on a first unparseable
// reply, and throw when even the retry is not JSON. temperature defaults to 0.
const sendMessage = jest.fn();
jest.mock('ubc-genai-toolkit-llm', () => ({
  LLMModule: jest.fn().mockImplementation(() => ({ sendMessage, getAvailableModels: jest.fn() })),
}));

import { completeJson } from '../../server/src/components/genai/llm';
import { modelRequestOptions } from '../../server/src/components/genai/llm/model-capabilities';

beforeEach(() => {
  sendMessage.mockReset();
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
