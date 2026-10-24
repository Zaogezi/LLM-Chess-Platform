import type { ModelSetup, ThinkingLevel, ThinkingTier } from '../../shared/protocol';
import {
  DEFAULT_THINKING_LEVEL,
  THINKING_LEVEL_TIMEOUT_SECONDS,
  effectivePromptLevel,
  thinkingBudgetTokens,
  thinkingTierOf,
} from '../../shared/protocol';

/**
 * Per-step request timeouts. Stronger thinking gets a longer allowance so a
 * genuinely deliberating model is not cut off at the same 120s boundary as a
 * fast response. Pause/Reset still abort immediately.
 */
export const THINKING_TIMEOUT_MS: Record<ThinkingTier, number> = {
  quick: THINKING_LEVEL_TIMEOUT_SECONDS.quick * 1000,
  balanced: THINKING_LEVEL_TIMEOUT_SECONDS.balanced * 1000,
  deep: THINKING_LEVEL_TIMEOUT_SECONDS.deep * 1000,
};

export function resolveThinkingLevel(
  setup: Pick<ModelSetup, 'thinkingLevel'>,
): ThinkingLevel {
  return setup.thinkingLevel?.trim() || DEFAULT_THINKING_LEVEL;
}

export function thinkingTimeoutMs(
  setup: Pick<ModelSetup, 'thinkingLevel'>,
): number {
  return THINKING_TIMEOUT_MS[thinkingTierOf(resolveThinkingLevel(setup))];
}

/**
 * Effective single-step wait limit. Models may set an explicit limit that is
 * independent of the thinking tier used for prompt/reasoning behaviour.
 */
export function requestTimeoutMs(
  setup: Pick<ModelSetup, 'thinkingLevel' | 'requestTimeoutSeconds'>,
): number {
  const override = setup.requestTimeoutSeconds;
  if (typeof override === 'number' && Number.isFinite(override) && override > 0) {
    return Math.round(override) * 1000;
  }
  return thinkingTimeoutMs(setup);
}

export function timeoutSeconds(timeoutMs: number): number {
  return Math.max(1, Math.round(timeoutMs / 1000));
}

/**
 * Prompt intensity is independent from the API reasoning parameter: an explicit
 * `promptLevel` wins, otherwise the old behaviour (follow thinkingLevel) stays.
 */
export function resolvePromptLevel(
  setup: Pick<ModelSetup, 'thinkingLevel' | 'promptLevel'>,
): ThinkingLevel {
  return effectivePromptLevel(setup.thinkingLevel, setup.promptLevel);
}

/** Positive integer cap from the setup, or null when unset/invalid. */
function tokenCap(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;
}

/**
 * Anthropic extended-thinking budget for this setup, or null when the API
 * reasoning switch is off (or the level disables thinking).
 */
export function thinkingBudgetFor(
  setup: Pick<ModelSetup, 'apiReasoning' | 'thinkingLevel' | 'maxThinkingTokens'>,
): number | null {
  if (!setup.apiReasoning) return null;
  return thinkingBudgetTokens(resolveThinkingLevel(setup), setup.maxThinkingTokens);
}

export function maxThinkingTokensFor(
  setup: Pick<ModelSetup, 'maxThinkingTokens'>,
): number | null {
  return tokenCap(setup.maxThinkingTokens);
}

export function maxCompletionTokensFor(
  setup: Pick<ModelSetup, 'maxCompletionTokens'>,
): number | null {
  return tokenCap(setup.maxCompletionTokens);
}

/** True for an OpenRouter base URL, which supports `reasoning.max_tokens`. */
export function isOpenRouterEndpoint(setup: Pick<ModelSetup, 'baseUrl'>): boolean {
  try {
    const host = new URL(setup.baseUrl).hostname.toLocaleLowerCase();
    return host === 'openrouter.ai' || host.endsWith('.openrouter.ai');
  } catch {
    return false;
  }
}

/**
 * Official OpenAI and OpenAI reasoning-model families require
 * `max_completion_tokens`; most other OpenAI-compatible gateways still only
 * understand the legacy `max_tokens` parameter.
 */
export function usesMaxCompletionTokens(
  setup: Pick<ModelSetup, 'baseUrl' | 'model'>,
): boolean {
  try {
    const host = new URL(setup.baseUrl).hostname.toLocaleLowerCase();
    if (host === 'api.openai.com' || host.endsWith('.openai.com')) return true;
  } catch {
    // Fall through to the model-name heuristic.
  }
  return /^(o[1-9](?:-|$)|gpt-5|gpt-6|codex)/i.test(setup.model.trim());
}
