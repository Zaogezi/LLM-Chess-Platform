import type {
  HistoryChampionshipRef,
  HistoryGameSummary,
  HistoryMode,
  HistoryPlayer,
  HistoryStatus,
  HistoryTournamentRef,
  ResultReason,
} from '../../shared/protocol';
import { HISTORY_PAGE_SIZE_DEFAULT } from '../../shared/protocol';
import { PROVIDER_LABELS } from '../presets';
import { CHAMPIONSHIP_STAGE_LABELS, championshipGroupLabel } from './championship';
import { SIDE_LABEL } from './chess';
import {
  RESULT_REASON_LABELS,
  thinkingLevelLabel,
  formatDuration,
  formatTokenCount,
} from './format';

export interface HistoryFilters {
  q: string;
  mode: 'all' | HistoryMode;
  status: 'all' | HistoryStatus;
}

export interface HistoryListQuery {
  limit: number;
  offset: number;
  mode: 'all' | HistoryMode;
  status: 'all' | HistoryStatus;
  q: string;
}

export const HISTORY_PAGE_SIZE = HISTORY_PAGE_SIZE_DEFAULT;

export const DEFAULT_HISTORY_FILTERS: HistoryFilters = {
  q: '',
  mode: 'all',
  status: 'all',
};

export const HISTORY_MODE_LABELS: Record<HistoryMode, string> = {
  arena: '手动对弈',
  tournament: '自动评测',
  championship: '锦标赛',
};

export const HISTORY_STATUS_LABELS: Record<HistoryStatus, string> = {
  finished: '已完成',
  failed: '异常',
};

export const HISTORY_MODE_OPTIONS: ReadonlyArray<{ value: HistoryFilters['mode']; label: string }> = [
  { value: 'all', label: '全部来源' },
  { value: 'arena', label: '手动对弈' },
  { value: 'tournament', label: '自动评测' },
  { value: 'championship', label: '锦标赛' },
];

export const HISTORY_STATUS_OPTIONS: ReadonlyArray<{
  value: HistoryFilters['status'];
  label: string;
}> = [
  { value: 'all', label: '全部状态' },
  { value: 'finished', label: '已完成' },
  { value: 'failed', label: '异常' },
];

export type HistoryOutcomeTone = 'red' | 'black' | 'draw' | 'failed';

export interface HistoryOutcome {
  label: string;
  detail: string;
  tone: HistoryOutcomeTone;
}

export function isHistoryFilterActive(filters: HistoryFilters): boolean {
  return filters.q.trim().length > 0 || filters.mode !== 'all' || filters.status !== 'all';
}

export function describeHistoryOutcome(record: HistoryGameSummary): HistoryOutcome {
  if (record.status === 'failed') {
    const error = record.error?.trim();
    const failedSide = record.failedSide ? `${SIDE_LABEL[record.failedSide]}异常` : '对局异常';
    return {
      label: '异常',
      detail: error || failedSide,
      tone: 'failed',
    };
  }

  const reason = record.result ? RESULT_REASON_LABELS[record.result.reason] : '';
  if (record.winnerSide === 'red') {
    return { label: '红方胜', detail: reason || '已完成', tone: 'red' };
  }
  if (record.winnerSide === 'black') {
    return { label: '黑方胜', detail: reason || '已完成', tone: 'black' };
  }
  return { label: '和局', detail: reason || '双方和棋', tone: 'draw' };
}

export function formatHistoryDateTime(timestamp: number | null | undefined): string {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    return '—';
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return `${formatHistoryDate(timestamp)} ${formatHistoryTime(timestamp)}`;
}

export function formatHistoryDate(timestamp: number | null | undefined): string {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    return '—';
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function formatHistoryTime(timestamp: number | null | undefined): string {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    return '—';
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function formatHistoryTimeWithSeconds(timestamp: number | null | undefined): string {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    return '—';
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return `${formatHistoryTime(timestamp)}:${pad2(date.getSeconds())}`;
}

export function formatHistoryRange(
  firstAt: number | null,
  lastAt: number | null,
): string {
  if (firstAt === null && lastAt === null) {
    return '暂无档案';
  }
  const first = formatHistoryDate(firstAt);
  const last = formatHistoryDate(lastAt);
  if (first === last) {
    return first;
  }
  return `${first} — ${last}`;
}

export function formatHistoryCount(value: number): string {
  if (!Number.isFinite(value)) {
    return '—';
  }
  try {
    return new Intl.NumberFormat('zh-CN').format(value);
  } catch {
    return String(value);
  }
}

export function formatHistoryDuration(milliseconds: number): string {
  return formatDuration(milliseconds);
}

export function formatHistoryTokens(tokensIn: number, tokensOut: number): string {
  return `↑${formatTokenCount(tokensIn)} ↓${formatTokenCount(tokensOut)}`;
}

export function historyPlayerMeta(player: HistoryPlayer): string {
  return `${PROVIDER_LABELS[player.provider]} · ${player.model}`;
}

export function historyPlayerThinking(player: HistoryPlayer): string {
  return `${thinkingLevelLabel(player.thinkingLevel)}${
    player.apiReasoning ? ' · API' : ''
  }`;
}

export function formatHistoryTournament(ref: HistoryTournamentRef): string {
  return `第 ${ref.pairIndex} 组 · 第 ${ref.gameIndex} 局 · 每对 ${ref.gamesPerPair} 局`;
}

/**
 * Human-readable championship reference. Qualifying-round games show the group
 * and pairing number; group-stage games show the group, pairing number and game
 * number; knockout games show the stage, series slot and game number.
 */
export function formatHistoryChampionship(ref: HistoryChampionshipRef): string {
  const pair = Number.isFinite(ref.pairIndex) && ref.pairIndex > 0 ? ref.pairIndex : 0;
  if (ref.stage === 'qualifier') {
    return pair > 0
      ? `${championshipGroupLabel(ref.groupId)}入围赛 · 第 ${pair} 对`
      : `${championshipGroupLabel(ref.groupId)}入围赛`;
  }
  if (ref.stage === 'group') {
    return pair > 0
      ? `${championshipGroupLabel(ref.groupId)} · 第 ${pair} 对 · 第 ${ref.gameIndex} 局`
      : `${championshipGroupLabel(ref.groupId)} · 第 ${ref.gameIndex} 局`;
  }
  const slot = ref.stage === 'final' ? '' : ` ${pair > 0 ? pair : 1}`;
  return `${CHAMPIONSHIP_STAGE_LABELS[ref.stage]}${slot} · 第 ${ref.gameIndex} 局`;
}

/** Short description of where a championship game sat in the bracket. */
export function formatHistoryChampionshipStage(ref: HistoryChampionshipRef): string {
  const pair = Number.isFinite(ref.pairIndex) && ref.pairIndex > 0 ? ref.pairIndex : 0;
  if (ref.stage === 'qualifier') {
    return `${championshipGroupLabel(ref.groupId)}入围赛`;
  }
  if (ref.stage === 'group') {
    return championshipGroupLabel(ref.groupId);
  }
  const slot = ref.stage === 'final' ? '' : ` ${pair > 0 ? pair : 1}`;
  return `${CHAMPIONSHIP_STAGE_LABELS[ref.stage]}${slot}`;
}

export function shortHistoryId(id: string, length = 8): string {
  const trimmed = id.trim();
  if (trimmed.length <= length) {
    return trimmed;
  }
  return `${trimmed.slice(0, length)}…`;
}

export function historyResultReasonLabel(reason: ResultReason | null | undefined): string {
  if (!reason) {
    return '—';
  }
  return RESULT_REASON_LABELS[reason];
}

export function describeHistoryRecordForAria(record: HistoryGameSummary): string {
  const outcome = describeHistoryOutcome(record);
  return `${formatHistoryDateTime(record.endedAt)}，${HISTORY_MODE_LABELS[record.mode]}，红方 ${record.red.name} 对黑方 ${record.black.name}，${outcome.label}，共 ${record.plies} 手。`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
