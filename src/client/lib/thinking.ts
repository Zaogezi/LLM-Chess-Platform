import type { ProviderKind, ThinkingLevel } from '../../shared/protocol';
import {
  DEFAULT_THINKING_LEVELS,
  OPENAI_REASONING_EFFORTS,
} from '../../shared/protocol';

/** Semantic built-in names are equivalent to the standard OpenAI efforts. */
const OPENAI_LEVEL_ALIASES: Record<string, ThinkingLevel> = {
  quick: 'low',
  fast: 'low',
  balanced: 'medium',
  standard: 'medium',
  deep: 'high',
};

/**
 * OpenAI-protocol models always use the standard reasoning_effort names in the
 * picker; legacy quick/balanced/deep selections are shown as their equivalents.
 */
export function normalizeThinkingLevel(
  provider: ProviderKind,
  value: ThinkingLevel,
): ThinkingLevel {
  if (provider !== 'openai') return value;
  const key = value.trim().toLocaleLowerCase();
  return OPENAI_LEVEL_ALIASES[key] ?? value;
}

function mergeUnique(
  options: readonly ThinkingLevel[],
  ...extra: Array<ThinkingLevel | null | undefined>
): ThinkingLevel[] {
  const result: ThinkingLevel[] = [];
  const seen = new Set<string>();
  for (const option of [...options, ...extra]) {
    const value = option?.trim();
    if (!value) continue;
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

/**
 * OpenAI-protocol models always expose minimal/low/medium/high, plus any extra
 * level names published by the API catalog. Other protocols keep their list.
 */
export function availableThinkingLevels(
  provider: ProviderKind,
  options: readonly ThinkingLevel[],
  value: ThinkingLevel,
): ThinkingLevel[] {
  const selected = normalizeThinkingLevel(provider, value);
  if (provider !== 'openai') {
    return mergeUnique(options, selected);
  }

  const custom = options.filter(
    (option) =>
      !DEFAULT_THINKING_LEVELS.some(
        (builtin) => builtin.toLocaleLowerCase() === option.toLocaleLowerCase(),
      ),
  );
  return mergeUnique([...OPENAI_REASONING_EFFORTS, ...custom], selected);
}
