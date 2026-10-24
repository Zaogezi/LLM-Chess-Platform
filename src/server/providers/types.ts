import type { ModelSetup } from '../../shared/protocol';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  system: string;
  messages: ConversationMessage[];
}

export interface ProviderReply {
  text: string;
  tokensIn: number;
  tokensOut: number;
  /** The provider stopped because a token cap (`length`/`max_tokens`) was hit. */
  truncated?: boolean;
}

export interface ModelProvider {
  readonly provider: 'openai' | 'anthropic';
  complete(
    setup: ModelSetup,
    request: CompletionRequest,
    signal: AbortSignal,
  ): Promise<ProviderReply>;
}

export type ProviderFactory = (kind: 'openai' | 'anthropic') => ModelProvider;

export class ProviderError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;
  /** The request exceeded its per-step wait limit rather than failing outright. */
  readonly timeout: boolean;
  readonly timeoutSeconds: number | null;
  /** The provider rejected the request because the key's quota/credit ran out. */
  readonly quotaExceeded: boolean;
  /** The reply hit a configured token cap before becoming usable. */
  readonly truncated: boolean;

  constructor(
    message: string,
    options: {
      status?: number | null;
      retryable?: boolean;
      timeout?: boolean;
      timeoutSeconds?: number | null;
      quotaExceeded?: boolean;
      truncated?: boolean;
    } = {},
  ) {
    super(message);
    this.name = 'ProviderError';
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
    this.timeout = options.timeout ?? false;
    this.timeoutSeconds = options.timeoutSeconds ?? null;
    this.quotaExceeded = options.quotaExceeded ?? false;
    this.truncated = options.truncated ?? false;
  }
}
