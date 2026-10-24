import type { ModelSetup } from '../../shared/protocol';
import { nativeReasoningEffort } from '../../shared/protocol';
import { resolveEndpoint } from './endpoint';
import { asNonNegativeInt, asRecord, isQuotaExceeded, requestJson } from './http';
import {
  isOpenRouterEndpoint,
  maxCompletionTokensFor,
  maxThinkingTokensFor,
  requestTimeoutMs,
  usesMaxCompletionTokens,
} from './thinking';
import {
  ProviderError,
  type CompletionRequest,
  type ModelProvider,
  type ProviderReply,
} from './types';

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      const record = asRecord(part);
      if (!record) continue;
      if (typeof record.text === 'string') {
        parts.push(record.text);
      } else if (typeof record.content === 'string') {
        parts.push(record.content);
      }
    }
    return parts.join('');
  }
  return '';
}

function firstChoiceText(data: Record<string, unknown>): {
  text: string;
  refusal: string;
  truncated: boolean;
} {
  const choices = data.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return { text: '', refusal: '', truncated: false };
  }
  const choice = asRecord(choices[0]);
  if (!choice) return { text: '', refusal: '', truncated: false };

  const message = asRecord(choice.message);
  const direct = typeof choice.text === 'string' ? choice.text : '';
  const content = message ? contentToText(message.content) : '';
  const reasoning = message && typeof message.reasoning_content === 'string'
    ? message.reasoning_content
    : '';
  const refusal = message && typeof message.refusal === 'string' ? message.refusal : '';

  return {
    text: content.trim() || direct.trim() || reasoning.trim(),
    refusal: refusal.trim(),
    truncated: choice.finish_reason === 'length',
  };
}

function usageFrom(data: Record<string, unknown>): { tokensIn: number; tokensOut: number } {
  const usage = asRecord(data.usage);
  if (!usage) return { tokensIn: 0, tokensOut: 0 };
  return {
    tokensIn: asNonNegativeInt(usage.prompt_tokens ?? usage.input_tokens),
    tokensOut: asNonNegativeInt(usage.completion_tokens ?? usage.output_tokens),
  };
}

async function complete(
  setup: ModelSetup,
  request: CompletionRequest,
  signal: AbortSignal,
): Promise<ProviderReply> {
  const endpoint = resolveEndpoint(setup.baseUrl, 'chat/completions');
  const headers: Record<string, string> = {};
  if (setup.apiKey) {
    headers.authorization = `Bearer ${setup.apiKey}`;
  }

  const messages = [
    { role: 'system', content: request.system },
    ...request.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ];

  const body: Record<string, unknown> = {
    model: setup.model,
    messages,
    stream: false,
  };

  const effort = setup.apiReasoning
    ? nativeReasoningEffort(setup.thinkingLevel ?? 'balanced')
    : null;
  const thinkingCap = setup.apiReasoning ? maxThinkingTokensFor(setup) : null;
  if (isOpenRouterEndpoint(setup) && thinkingCap !== null) {
    // OpenRouter accepts either `reasoning.effort` or `reasoning.max_tokens`,
    // not both; an explicit token budget wins over the coarse effort level.
    body.reasoning = { max_tokens: thinkingCap };
  } else if (effort) {
    body.reasoning_effort = effort;
  }

  const completionCap = maxCompletionTokensFor(setup);
  if (completionCap !== null) {
    body[usesMaxCompletionTokens(setup) ? 'max_completion_tokens' : 'max_tokens'] =
      completionCap;
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

  const topLevelError = asRecord(data.error);
  if (topLevelError) {
    const message =
      typeof topLevelError.message === 'string'
        ? topLevelError.message
        : '模型服务在响应中返回了错误';
    const quotaExceeded = isQuotaExceeded(null, message);
    throw new ProviderError(`模型服务错误：${message}`, {
      retryable: !quotaExceeded,
      quotaExceeded,
    });
  }

  const { text, refusal, truncated } = firstChoiceText(data);
  if (!text) {
    if (truncated) {
      throw new ProviderError(
        '模型输出达到 token 上限（finish_reason=length），未产生可用内容；请提高最大输出 token 或降低思考预算',
        { truncated: true, retryable: false },
      );
    }
    throw new ProviderError(
      refusal
        ? `模型拒绝回答：${refusal}`
        : '模型返回了空内容，请检查模型是否支持 Chat Completions 协议',
      { retryable: !refusal },
    );
  }

  const usage = usageFrom(data);
  return { text, ...usage, truncated };
}

export const openaiProvider: ModelProvider = {
  provider: 'openai',
  complete,
};
