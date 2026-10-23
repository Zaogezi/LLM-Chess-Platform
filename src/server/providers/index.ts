import type { ProviderKind } from '../../shared/protocol';
import { anthropicProvider } from './anthropic';
import { openaiProvider } from './openai';
import type { ModelProvider, ProviderFactory } from './types';

export const defaultProviderFactory: ProviderFactory = (kind: ProviderKind) => {
  return kind === 'anthropic' ? anthropicProvider : openaiProvider;
};

export function createProvider(kind: ProviderKind): ModelProvider {
  return defaultProviderFactory(kind);
}

export { ProviderError } from './types';
export type {
  CompletionRequest,
  ConversationMessage,
  ModelProvider,
  ProviderFactory,
  ProviderReply,
} from './types';
