import type { ModelSetup } from '../../shared/protocol';
import {
  API_THINKING_OUTPUT_TOKENS,
  nativeThinkingBudget,
} from '../../shared/protocol';
import { resolveEndpoint } from './endpoint';
import { asNonNegativeInt, asRecord, requestJson } from './http';
import { thinkingTimeoutMs } from './thinking';
import {
  ProviderError,
  type CompletionRequest,
  type ModelProvider,
  type ProviderReply,
} from './types';

function extractText(data: Record<string, unknown>): string {
  const blocks = data.content;
  if (!Array.isArray(blocks)) return '';
  const parts: string[] = [];
  for (const block of blocks) {
    const record = asRecord(block);
    if (!record) continue;
    if (record.type === 'text' && typeof record.text === 'string') {
      parts.push(record.text);
    }
  }
  return parts.join('\n');
}

async function complete(
  setup: ModelSetup,
  request: CompletionRequest,
  signal: AbortSignal,
): Promise<ProviderReply> {
  const endpoint = resolveEndpoint(setup.baseUrl, 'messages');
  const headers: Record<string, string> = {
    'anthropic-version': '2023-06-01',
  };
  if (setup.apiKey) {
    headers['x-api-key'] = setup.apiKey;
  }

  const budget = setup.apiReasoning
    ? nativeThinkingBudget(setup.thinkingLevel ?? 'balanced')
    : null;
  const body: Record<string, unknown> = {
    model: setup.model,
    // Extended thinking is deducted from max_tokens, so reserve room for the
    // final JSON answer beyond the thinking budget.
    max_tokens: budget ? budget + API_THINKING_OUTPUT_TOKENS : 1200,
    system: request.system,
    messages: request.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  };
  if (budget) {
    body.thinking = { type: 'enabled', budget_tokens: budget };
  }

  const raw = await requestJson({
    url: endpoint,
    headers,
    body,
    signal,
    timeoutMs: thinkingTimeoutMs(setup),
  });

  const data = asRecord(raw);
  if (!data) {
    throw new ProviderError('模型服务返回了无法识别的响应结构', { retryable: true });
  }

  if (data.type === 'error') {
    const error = asRecord(data.error);
    const message =
      error && typeof error.message === 'string'
        ? error.message
        : 'Anthropic 返回了错误响应';
    throw new ProviderError(`模型服务错误：${message}`, { retryable: true });
  }

  const text = extractText(data).trim();
  if (!text) {
    throw new ProviderError('模型返回了空内容，请检查模型 ID 与 Anthropic 协议配置', {
      retryable: true,
    });
  }

  const usage = asRecord(data.usage);
  return {
    text,
    tokensIn: usage ? asNonNegativeInt(usage.input_tokens) : 0,
    tokensOut: usage ? asNonNegativeInt(usage.output_tokens) : 0,
  };
}

export const anthropicProvider: ModelProvider = {
  provider: 'anthropic',
  complete,
};
