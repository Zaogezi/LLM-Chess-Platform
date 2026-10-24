import type { ModelSetup } from '../../shared/protocol';
import { API_THINKING_OUTPUT_TOKENS } from '../../shared/protocol';
import { resolveEndpoint } from './endpoint';
import { asNonNegativeInt, asRecord, isQuotaExceeded, requestJson } from './http';
import {
  maxCompletionTokensFor,
  requestTimeoutMs,
  thinkingBudgetFor,
} from './thinking';
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

  const budget = thinkingBudgetFor(setup);
  // Extended thinking is deducted from max_tokens, so the explicit completion
  // cap must still leave room for the final JSON answer beyond the budget.
  let maxTokens =
    maxCompletionTokensFor(setup) ??
    (budget ? budget + API_THINKING_OUTPUT_TOKENS : 1200);
  if (budget && maxTokens <= budget) {
    maxTokens = budget + API_THINKING_OUTPUT_TOKENS;
  }
  const body: Record<string, unknown> = {
    model: setup.model,
    max_tokens: maxTokens,
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
    timeoutMs: requestTimeoutMs(setup),
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
    const quotaExceeded = isQuotaExceeded(null, message);
    throw new ProviderError(`模型服务错误：${message}`, {
      retryable: !quotaExceeded,
      quotaExceeded,
    });
  }

  const truncated = data.stop_reason === 'max_tokens';
  const text = extractText(data).trim();
  if (!text) {
    if (truncated) {
      throw new ProviderError(
        '模型输出达到 max_tokens 上限（stop_reason=max_tokens），未产生可用内容；请提高最大输出 token 或降低思考预算',
        { truncated: true, retryable: false },
      );
    }
    throw new ProviderError('模型返回了空内容，请检查模型 ID 与 Anthropic 协议配置', {
      retryable: true,
    });
  }

  const usage = asRecord(data.usage);
  return {
    text,
    tokensIn: usage ? asNonNegativeInt(usage.input_tokens) : 0,
    tokensOut: usage ? asNonNegativeInt(usage.output_tokens) : 0,
    truncated,
  };
}

export const anthropicProvider: ModelProvider = {
  provider: 'anthropic',
  complete,
};
