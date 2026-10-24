import type { ModelSetup, ThinkingLevel, ThinkingTier } from '../../shared/protocol';
import {
  DEFAULT_THINKING_LEVEL,
  THINKING_LEVEL_TIMEOUT_SECONDS,
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
