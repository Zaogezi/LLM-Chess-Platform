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

  constructor(message: string, options: { status?: number | null; retryable?: boolean } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
  }
}
