import { describe, expect, it } from 'vitest';
import {
  PROMPT_TIER_LABELS,
  effectivePromptLevel,
  isThinkingOff,
  nativeReasoningEffort,
  nativeThinkingBudget,
  requestTimeoutSecondsFor,
  thinkingBudgetTokens,
  thinkingTimeoutSecondsFor,
  thinkingTierOf,
} from './protocol';

describe('thinking level mapping', () => {
  it('maps built-in and API-provided values to semantic tiers', () => {
    expect(thinkingTierOf('quick')).toBe('quick');
    expect(thinkingTierOf('minimal')).toBe('quick');
    expect(thinkingTierOf('low')).toBe('quick');
    expect(thinkingTierOf('balanced')).toBe('balanced');
    expect(thinkingTierOf('medium')).toBe('balanced');
    expect(thinkingTierOf('deep')).toBe('deep');
    expect(thinkingTierOf('high')).toBe('deep');
    expect(thinkingTierOf('xhigh')).toBe('deep');
    expect(thinkingTierOf('custom-unknown')).toBe('balanced');
  });

  it('treats off values as disabled and maps timeouts', () => {
    expect(isThinkingOff('off')).toBe(true);
    expect(isThinkingOff('false')).toBe(true);
    expect(isThinkingOff('high')).toBe(false);
    expect(thinkingTimeoutSecondsFor('minimal')).toBe(60);
    expect(thinkingTimeoutSecondsFor('high')).toBe(240);
  });

  it('separates the request timeout from the thinking tier', () => {
    // No override: the tier default still applies.
    expect(requestTimeoutSecondsFor('minimal')).toBe(60);
    expect(requestTimeoutSecondsFor('high')).toBe(240);
    expect(requestTimeoutSecondsFor('balanced', null)).toBe(120);
    // An explicit limit wins regardless of the thinking level.
    expect(requestTimeoutSecondsFor('minimal', 300)).toBe(300);
    expect(requestTimeoutSecondsFor('high', 90)).toBe(90);
    expect(requestTimeoutSecondsFor('balanced', 0)).toBe(120);
  });

  it('emits exact native efforts for API levels and null when disabled', () => {
    expect(nativeReasoningEffort('minimal')).toBe('minimal');
    expect(nativeReasoningEffort('high')).toBe('high');
    expect(nativeReasoningEffort('deep')).toBe('high');
    expect(nativeReasoningEffort('off')).toBeNull();
    expect(nativeThinkingBudget('high')).toBe(4096);
    expect(nativeThinkingBudget('quick')).toBe(1024);
    expect(nativeThinkingBudget('off')).toBeNull();
  });

  it('resolves the in-app prompt level independently', () => {
    expect(effectivePromptLevel('high')).toBe('high');
    expect(effectivePromptLevel('high', 'quick')).toBe('quick');
    expect(effectivePromptLevel('high', null)).toBe('high');
    expect(effectivePromptLevel(undefined, undefined)).toBe('balanced');
    expect(PROMPT_TIER_LABELS).toEqual({
      quick: '精简',
      balanced: '标准',
      deep: '详尽',
    });
  });

  it('applies explicit thinking-token budgets on top of the tier budget', () => {
    expect(thinkingBudgetTokens('quick')).toBe(1024);
    expect(thinkingBudgetTokens('quick', 1500)).toBe(1500);
    expect(thinkingBudgetTokens('quick', null)).toBe(1024);
    expect(thinkingBudgetTokens('off', 1500)).toBeNull();
  });
});
