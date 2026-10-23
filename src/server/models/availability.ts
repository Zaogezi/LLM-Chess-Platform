import type { ModelSetup, ModelTestResponse } from '../../shared/protocol';
import { MODEL_TEST_TIMEOUT_SECONDS } from '../../shared/protocol';
import { redactSecrets } from '../providers/http';
import type { ProviderFactory } from '../providers/index';
import { defaultProviderFactory } from '../providers/index';

const PROBE_PROMPT = {
  system: 'You are a connectivity checker for a local Chinese chess application. Reply with exactly OK.',
  messages: [{ role: 'user' as const, content: 'Reply with exactly: OK' }],
};

const MAX_REPLY_PREVIEW = 120;

export interface ModelTestOptions {
  /** Tests use a shorter wait than a real game move; production default is 30s. */
  timeoutMs?: number;
}

function previewOf(text: string, apiKey: string): string {
  const clean = redactSecrets(text.replace(/\s+/g, ' ').trim(), [apiKey]);
  return clean.length > MAX_REPLY_PREVIEW
    ? `${clean.slice(0, MAX_REPLY_PREVIEW)}…`
    : clean;
}

function failureMessage(error: unknown, apiKey: string): string {
  const raw =
    error instanceof Error && error.message.trim().length > 0
      ? error.message.trim()
      : '未知错误';
  return redactSecrets(raw, [apiKey]);
}

/**
 * Send one small completion request to verify that the configured endpoint,
 * model id and (optional) key actually work. This is deliberately not retried:
 * a failure is reported to the library card so the user can fix the config.
 *
 * The configured thinking/reasoning settings are respected; the request is
 * therefore representative of what a real game would send, not a mock.
 */
export async function testModelAvailability(
  setup: ModelSetup,
  providerFactory: ProviderFactory = defaultProviderFactory,
  options: ModelTestOptions = {},
): Promise<ModelTestResponse> {
  const startedAt = Date.now();
  const timeoutMs = Math.max(250, Math.round(options.timeoutMs ?? MODEL_TEST_TIMEOUT_SECONDS * 1000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const provider = providerFactory(setup.provider);
    const reply = await provider.complete(setup, PROBE_PROMPT, controller.signal);
    const latencyMs = Math.max(0, Date.now() - startedAt);
    const replyPreview = previewOf(reply.text, setup.apiKey);
    return {
      ok: true,
      provider: setup.provider,
      model: setup.model,
      latencyMs,
      tokensIn: reply.tokensIn,
      tokensOut: reply.tokensOut,
      message: '模型可用，接口已成功返回内容。',
      replyPreview,
      testedAt: Date.now(),
    };
  } catch (error) {
    const latencyMs = Math.max(0, Date.now() - startedAt);
    const timedOut = controller.signal.aborted;
    const detail = timedOut
      ? `测试超时（${Math.ceil(timeoutMs / 1000)} 秒），模型未在限定时间内返回`
      : failureMessage(error, setup.apiKey);
    return {
      ok: false,
      provider: setup.provider,
      model: setup.model,
      latencyMs,
      tokensIn: 0,
      tokensOut: 0,
      message: `模型不可用：${detail}`,
      replyPreview: '',
      testedAt: Date.now(),
    };
  } finally {
    clearTimeout(timer);
  }
}
