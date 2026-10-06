import OpenAI from 'openai';
import { APIError } from 'ubc-genai-toolkit-core';
import type { LLMConfig, LLMModule, LLMOptions, LLMResponse, Message } from 'ubc-genai-toolkit-llm';
import { captureModelCallResponse } from './model-call';

type WireObject = Record<string, unknown>;
export interface OpenAICompletionClient {
  create(request: WireObject): Promise<unknown>;
}
const object = (value: unknown): WireObject => value && typeof value === 'object' ? value as WireObject : {};
const text = (value: unknown): string => typeof value === 'string' ? value : '';

function messagesFor(messages: Message[], options: LLMOptions): WireObject[] {
  const converted: WireObject[] = messages.map(message => ({ role: message.role,
    content: message.images?.length ? [
      ...(message.content ? [{ type: 'text', text: message.content }] : []),
      ...message.images.map(image => ({ type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}` } })),
    ] : message.content }));
  if (options.systemPrompt && !messages.some(message => message.role === 'system')) converted.unshift({ role: 'system', content: options.systemPrompt });
  return converted;
}

/** Mirrors toolkit 0.3.0 Chat requests, retaining native usage it discards. */
export function createOpenAIUsageAdapter(config: LLMConfig, suppliedClient?: OpenAICompletionClient): Pick<LLMModule, 'sendMessage' | 'sendConversation' | 'streamConversation'> {
  // Deliberately retain the SDK's existing default retry policy. The observer
  // labels physical retry visibility unknown rather than claiming one bill.
  const client = suppliedClient ?? (() => {
    const sdk = new OpenAI({ apiKey: config.apiKey, ...(config.endpoint ? { baseURL: config.endpoint } : {}) });
    return { create: (request: WireObject) => sdk.chat.completions.create(request as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming) };
  })();
  const provider = config.provider;
  const requestFor = (messages: Message[], options: LLMOptions, streaming: boolean): WireObject => {
    const { model, temperature, maxTokens, responseFormat } = options;
    const rest = { ...options };
    for (const key of ['model', 'temperature', 'maxTokens', 'systemPrompt', 'responseFormat', 'stream', 'structuredOutputName']) delete rest[key];
    return { model: model || config.defaultModel, messages: messagesFor(messages, options), temperature, max_tokens: maxTokens,
      // The installed toolkit omits response_format on its streaming path.
      // Preserve that behavior; observing usage must not change generation.
      ...(!streaming ? { response_format: responseFormat === 'json' ? { type: 'json_object' } : undefined } : {}),
      stream: streaming, ...rest,
      ...(streaming ? { stream_options: { ...object(rest.stream_options), include_usage: true } } : {}) };
  };
  const capture = (value: WireObject): void => captureModelCallResponse({ usage: value.usage, format: 'openai-chat', model: value.model, responseId: value.id });
  const usageFor = (value: unknown): LLMResponse['usage'] => {
    const usage = object(value);
    return { promptTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined,
      completionTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined,
      totalTokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : undefined };
  };
  function handleError(error: unknown): Error {
    if (error instanceof Error && ['AbortError', 'APIUserAbortError'].includes(error.name)) return error;
    if (error instanceof OpenAI.APIError) return new APIError(
      provider === 'ubc-llm-sandbox' ? `UBC LLM Sandbox API Error: ${error.message}` : error.message,
      error.status || 500, { type: error.name, code: error.code, param: error.param });
    if (provider === 'ubc-llm-sandbox' && error instanceof Error) return new APIError(`UBC LLM Sandbox Provider Error: ${error.message}`, 500);
    return new APIError('Unknown error occurred while calling OpenAI API');
  }
  async function sendConversation(messages: Message[], options: LLMOptions = {}): Promise<LLMResponse> {
    try {
      const effective = { ...config.defaultOptions, ...options };
      const response = object(await client.create(requestFor(messages, effective, false)));
      capture(response);
      const choices = Array.isArray(response.choices) ? response.choices : [];
      const choice = object(choices[0]);
      return { content: text(object(choice.message).content), model: text(response.model), usage: usageFor(response.usage),
        metadata: { provider, id: response.id, created: response.created, finishReason: choice.finish_reason } };
    } catch (error) { throw handleError(error); }
  }
  return {
    sendConversation,
    sendMessage: (message: string, options?: LLMOptions) => sendConversation([{ role: 'user', content: message }], options),
    async streamConversation(messages: Message[], callback: (chunk: string) => void, options: LLMOptions = {}): Promise<LLMResponse> {
      try {
        const effective = { ...config.defaultOptions, ...options };
        const stream = await client.create(requestFor(messages, effective, true)) as AsyncIterable<unknown>;
        let content = '';
        let usage: unknown;
        let responseId: unknown;
        let actualModel: unknown;
        let finishReason: unknown;
        for await (const event of stream) {
          const chunk = object(event);
          capture(chunk);
          if (chunk.usage != null) usage = chunk.usage;
          if (chunk.id != null) responseId = chunk.id;
          if (chunk.model != null) actualModel = chunk.model;
          const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
          const choice = object(choices[0]);
          if (choice.finish_reason != null) finishReason = choice.finish_reason;
          const delta = text(object(choice.delta).content);
          if (delta) { content += delta; callback(delta); }
        }
        // Length truncation remains a successful transport response, as in the
        // original toolkit. completeJson can reject/retry its invalid content.
        return { content, model: text(actualModel) || effective.model || config.defaultModel,
          ...(usage != null ? { usage: usageFor(usage) } : {}), metadata: { provider, id: responseId, finishReason } };
      } catch (error) { throw handleError(error); }
    },
  };
}

export function installOpenAIUsageAdapter(module: LLMModule, config: LLMConfig): void {
  if (config.provider !== 'openai' && config.provider !== 'ubc-llm-sandbox') return;
  const adapter = createOpenAIUsageAdapter(config);
  module.sendMessage = adapter.sendMessage;
  module.sendConversation = adapter.sendConversation;
  module.streamConversation = adapter.streamConversation;
}
