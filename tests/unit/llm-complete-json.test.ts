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
