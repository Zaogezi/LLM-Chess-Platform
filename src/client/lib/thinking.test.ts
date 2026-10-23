import { describe, expect, it } from 'vitest';
import {
  availableThinkingLevels,
  normalizeThinkingLevel,
} from './thinking';

describe('OpenAI-compatible thinking levels', () => {
  it('offers the standard efforts for every OpenAI-protocol model', () => {
    expect(
      availableThinkingLevels('openai', ['quick', 'balanced', 'deep'], 'balanced'),
    ).toEqual(['minimal', 'low', 'medium', 'high']);
    expect(
      availableThinkingLevels('openai', [], 'deep'),
    ).toEqual(['minimal', 'low', 'medium', 'high']);
  });

  it('normalizes legacy semantic names to their OpenAI equivalents', () => {
    expect(normalizeThinkingLevel('openai', 'quick')).toBe('low');
    expect(normalizeThinkingLevel('openai', 'balanced')).toBe('medium');
    expect(normalizeThinkingLevel('openai', 'deep')).toBe('high');
    expect(normalizeThinkingLevel('anthropic', 'balanced')).toBe('balanced');
  });

  it('keeps extra API-provided levels after the standard four', () => {
    expect(
      availableThinkingLevels('openai', ['quick', 'balanced', 'deep', 'xhigh'], 'xhigh'),
    ).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh']);
  });

  it('keeps the built-in list for non-OpenAI protocols', () => {
    expect(
      availableThinkingLevels('anthropic', ['quick', 'balanced', 'deep'], 'balanced'),
    ).toEqual(['quick', 'balanced', 'deep']);
  });
});
