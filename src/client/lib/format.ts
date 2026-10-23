import type {
  Phase,
  ProviderKind,
  ResultReason,
  Side,
  ThinkingLevel,
  ThinkingTier,
} from '../../shared/protocol';
import {
  API_THINKING_OUTPUT_TOKENS,
  nativeReasoningEffort,
  nativeThinkingBudget,
  thinkingTimeoutSecondsFor,
  thinkingTierOf,
} from '../../shared/protocol';
import { SIDE_LABEL } from './chess';

export const PHASE_LABELS: Record<Phase, string> = {
  idle: '静候开局',
  running: '对弈中',
  paused: '暂歇',
  error: '异动',
  finished: '终局',
};

export const RESULT_REASON_LABELS: Record<ResultReason, string> = {
  checkmate: '将死',
  stalemate: '困毙',
  repetition: '循环判和',
  'dead-position': '死局',
  'no-progress': '无进展',
  'max-plies': '手数上限',
  timeout: '超时判负',
  forfeit: '未着判负',
};

const TIER_LABELS: Record<ThinkingTier, string> = {
  quick: '快速',
  balanced: '标准',
  deep: '深思',
};

const VALUE_LABELS: Record<string, string> = {
  minimal: '极简',
  low: '低',
  medium: '标准',
  high: '高',
  xhigh: '极高',
  max: '最大',
  off: '关闭',
  none: '关闭',
  on: '开启',
  true: '开启',
  false: '关闭',
  quick: '快速',
  balanced: '标准',
  deep: '深思',
  standard: '标准',
  fast: '快速',
};

export function thinkingLevelLabel(level: ThinkingLevel): string {
  const value = level.trim();
  const known = VALUE_LABELS[value.toLocaleLowerCase()];
  return known ?? (value || TIER_LABELS.balanced);
}

export function thinkingLevelHint(level: ThinkingLevel): string {
  const tier = thinkingTierOf(level);
  const seconds = thinkingTimeoutSecondsFor(level);
  if (tier === 'quick') {
    return `快速判断，不展开长链推演；单步等待上限 ${seconds} 秒。`;
  }
  if (tier === 'deep') {
    return `深入比较候选着法与对手应手；单步等待上限 ${seconds} 秒。`;
  }
  return `常规审局，比较若干候选着法；单步等待上限 ${seconds} 秒。`;
}

/** Human-readable description of the provider-native parameter that will be sent. */
export function describeApiReasoning(
  provider: ProviderKind,
  level: ThinkingLevel,
): string {
  if (provider === 'anthropic') {
    const budget = nativeThinkingBudget(level);
    if (budget === null) {
      return '当前档位关闭扩展思考，不发送 thinking 参数。';
    }
    return `发送扩展思考：budget_tokens=${budget}，max_tokens=${budget + API_THINKING_OUTPUT_TOKENS}（模型需支持 extended thinking）。`;
  }
  const effort = nativeReasoningEffort(level);
  if (effort === null) {
    return '当前档位关闭推理参数，不发送 reasoning_effort。';
  }
  return `发送 reasoning_effort="${effort}"（模型需支持该参数）。`;
}

export function formatDuration(milliseconds: number): string {
  const safe = Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;

  if (safe < 60_000) {
    return `${(safe / 1000).toFixed(1)} 秒`;
  }

  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes} 分 ${seconds.toString().padStart(2, '0')} 秒`;
}

export function formatStopwatch(milliseconds: number): string {
  const safe = Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function formatLatency(milliseconds: number | null | undefined): string {
  if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds) || milliseconds < 0) {
    return '—';
  }
  if (milliseconds < 1000) {
    return `${Math.round(milliseconds)} 毫秒`;
  }
  return `${(milliseconds / 1000).toFixed(1)} 秒`;
}

export function formatTokenCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) {
    return '0';
  }
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}m`;
  }
  if (count >= 10_000) {
    return `${Math.round(count / 1000)}k`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return String(Math.round(count));
}

export function turnHeadline(phase: Phase, turn: Side | null): string {
  if (!turn) {
    return '棋盘未启';
  }

  switch (phase) {
    case 'running':
      return `${SIDE_LABEL[turn]}运筹`;
    case 'paused':
      return `${SIDE_LABEL[turn]}待续`;
    case 'error':
      return '待复棋局';
    case 'finished':
      return '终局已定';
    default:
      return '棋盘未启';
  }
}
