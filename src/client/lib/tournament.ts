import type {
  ModelProfileView,
  ThinkingLevel,
  TournamentGameStatus,
  TournamentGameView,
  TournamentModelRequest,
  TournamentModelView,
  TournamentPhase,
  TournamentStartRequest,
  TournamentState,
} from '../../shared/protocol';
import {
  DEFAULT_THINKING_LEVEL,
  DEFAULT_THINKING_LEVELS,
  TOURNAMENT_MAX_GAMES_PER_PAIR,
  TOURNAMENT_MAX_MODELS,
  TOURNAMENT_MIN_MODELS,
  TOURNAMENT_POINTS,
} from '../../shared/protocol';
import type { PresetKey } from '../presets';
import {
  PROVIDER_LABELS,
  createModelConfig,
  presetByKey,
  validateModelConfig,
} from '../presets';
import { detectPreset } from './profiles';
import { SIDE_LABEL } from './chess';
import { thinkingLevelLabel } from './format';

export type TournamentTone = 'idle' | 'running' | 'paused' | 'finished' | 'error';

export interface TournamentModelDraft {
  id: string;
  /** Non-null when this entrant uses a saved model-library profile. */
  profileId: string | null;
  name: string;
  preset: PresetKey;
  provider: 'openai' | 'anthropic';
  baseUrl: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  thinkingOptions: ThinkingLevel[];
  apiReasoning: boolean;
  apiKey: string;
  showKey: boolean;
  /** In-app prompt intensity; null follows the API thinking level. */
  promptLevel: ThinkingLevel | null;
  /** Hard thinking-token cap; null uses the provider/tier default. */
  maxThinkingTokens: number | null;
  /** Hard total-output cap; null sends no cap. */
  maxCompletionTokens: number | null;
  /** Independent per-step wait override; null follows the thinking tier. */
  requestTimeoutSeconds: number | null;
}

export interface TournamentFieldErrors {
  profile?: string;
  name?: string;
  provider?: string;
  baseUrl?: string;
  model?: string;
  maxThinkingTokens?: string;
  maxCompletionTokens?: string;
  requestTimeoutSeconds?: string;
}

export type TournamentModelErrors = Record<string, TournamentFieldErrors>;

export interface TournamentValidation {
  ok: boolean;
  modelErrors: TournamentModelErrors;
  gamesError: string | null;
  formError: string | null;
}

export interface TournamentPlan {
  modelCount: number;
  gamesPerPair: number;
  pairings: number;
  totalGames: number;
  gamesPerModel: number;
}

export interface TournamentPairGroup {
  pairIndex: number;
  games: TournamentGameView[];
}

export const DEFAULT_GAMES_PER_PAIR = 2;

export const TOURNAMENT_MODEL_SEALS = ['壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌'] as const;

export const TOURNAMENT_PHASE_LABELS: Record<TournamentPhase, string> = {
  idle: '待开赛',
  running: '巡演中',
  finished: '已完赛',
  stopped: '已中止',
  error: '异常中止',
};

export const TOURNAMENT_PHASE_HINTS: Record<TournamentPhase, string> = {
  idle: '配置阵容与每对局数，开赛后自动逐局对弈。',
  running: '按配对阵顺序逐局进行，可随时中止赛事。',
  finished: '全部对局已经完成，名次按积分自动结算。',
  stopped: '赛事已中止，尚未进行的对局不再执行。',
  error: '赛事因异常中止，可查看错误后重新开赛。',
};

export const TOURNAMENT_GAME_STATUS_LABELS: Record<TournamentGameStatus, string> = {
  scheduled: '待赛',
  running: '进行中',
  finished: '已完成',
  failed: '失败',
  canceled: '已取消',
};

const GAME_STATUS_TONES: Record<TournamentGameStatus, TournamentTone> = {
  scheduled: 'idle',
  running: 'running',
  finished: 'finished',
  failed: 'error',
  canceled: 'paused',
};

export const TOURNAMENT_POINTS_LEGEND = `胜 +${TOURNAMENT_POINTS.win} · 和 +${TOURNAMENT_POINTS.draw} · 负 +${TOURNAMENT_POINTS.loss}`;

export const TOURNAMENT_TIEBREAK_LEGEND = '同分依次比较胜场、和局与报名顺序。';

let draftCounter = 0;

function nextDraftId(): string {
  draftCounter += 1;
  return `entrant-${Date.now().toString(36)}-${draftCounter.toString(36)}`;
}

export function normalizeModelName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

export function createTournamentDraft(
  presetKey: PresetKey = 'deepseek',
  name?: string,
): TournamentModelDraft {
  const preset = presetByKey(presetKey);
  const config = createModelConfig(presetKey);
  return {
    id: nextDraftId(),
    profileId: null,
    name: name ?? preset.label,
    preset: config.preset,
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    thinkingLevel: config.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
    thinkingOptions: [...DEFAULT_THINKING_LEVELS],
    apiReasoning: config.apiReasoning,
    apiKey: '',
    showKey: false,
    promptLevel: config.promptLevel,
    maxThinkingTokens: config.maxThinkingTokens,
    maxCompletionTokens: config.maxCompletionTokens,
    requestTimeoutSeconds: config.requestTimeoutSeconds,
  };
}

export function createDefaultTournamentDrafts(): TournamentModelDraft[] {
  return [createTournamentDraft('deepseek', 'DeepSeek'), createTournamentDraft('openai', 'OpenAI')];
}

export function uniqueModelName(base: string, drafts: readonly TournamentModelDraft[]): string {
  const trimmed = base.trim() || '模型';
  const taken = new Set(drafts.map((draft) => normalizeModelName(draft.name)));
  if (!taken.has(normalizeModelName(trimmed))) {
    return trimmed;
  }

  let suffix = 2;
  while (taken.has(normalizeModelName(`${trimmed} ${suffix}`))) {
    suffix += 1;
  }
  return `${trimmed} ${suffix}`;
}

export function applyPresetToDraft(
  draft: TournamentModelDraft,
  presetKey: PresetKey,
): TournamentModelDraft {
  const previous = presetByKey(draft.preset);
  const next = presetByKey(presetKey);
  const currentName = draft.name.trim();
  const shouldAdoptLabel = currentName.length === 0 || currentName === previous.label;

  return {
    ...draft,
    profileId: null,
    preset: next.key,
    provider: next.provider,
    baseUrl: next.baseUrl,
    model: next.model,
    thinkingLevel: 'balanced',
    thinkingOptions: [...DEFAULT_THINKING_LEVELS],
    apiReasoning: next.provider === 'openai',
    promptLevel: null,
    maxThinkingTokens: null,
    maxCompletionTokens: null,
    requestTimeoutSeconds: null,
    name: shouldAdoptLabel ? next.label : draft.name,
  };
}

/**
 * Fill an entrant from a saved profile. The entrant label is preserved unless
 * it was still the previous preset's default, in which case the profile name is
 * adopted with a unique suffix.
 */
export function applyProfileToDraft(
  draft: TournamentModelDraft,
  profile: ModelProfileView,
  existing: readonly TournamentModelDraft[],
): TournamentModelDraft {
  const previousPreset = presetByKey(draft.preset);
  const currentName = draft.name.trim();
  const shouldAdoptName =
    currentName.length === 0 || currentName === previousPreset.label;
  const others = existing.filter((item) => item.id !== draft.id);

  return {
    ...draft,
    profileId: profile.id,
    preset: detectPreset(profile.provider, profile.baseUrl, profile.model),
    provider: profile.provider,
    baseUrl: profile.baseUrl,
    model: profile.model,
    thinkingLevel: profile.thinkingLevel,
    thinkingOptions: [...profile.thinkingLevels],
    apiReasoning: profile.apiReasoning,
    promptLevel: profile.promptLevel ?? null,
    maxThinkingTokens: profile.maxThinkingTokens ?? null,
    maxCompletionTokens: profile.maxCompletionTokens ?? null,
    requestTimeoutSeconds: profile.requestTimeoutSeconds ?? null,
    apiKey: '',
    showKey: false,
    name: shouldAdoptName ? uniqueModelName(profile.name, others) : draft.name,
  };
}

export function duplicateTournamentDraft(
  draft: TournamentModelDraft,
  existing: readonly TournamentModelDraft[],
): TournamentModelDraft {
  return {
    ...draft,
    id: nextDraftId(),
    name: uniqueModelName(`${draft.name.trim() || '模型'} 副本`, existing),
    showKey: false,
  };
}

export function calculateTournamentPlan(modelCount: number, gamesPerPair: number): TournamentPlan {
  const safeCount = Math.max(0, Math.min(TOURNAMENT_MAX_MODELS, Math.floor(modelCount)));
  const safeGames = Number.isFinite(gamesPerPair)
    ? Math.max(0, Math.floor(gamesPerPair))
    : 0;
  const pairings = (safeCount * (safeCount - 1)) / 2;

  return {
    modelCount: safeCount,
    gamesPerPair: safeGames,
    pairings,
    totalGames: pairings * safeGames,
    gamesPerModel: Math.max(0, safeCount - 1) * safeGames,
  };
}

export function validateTournamentDrafts(
  drafts: readonly TournamentModelDraft[],
  gamesPerPair: number,
  profiles?: readonly ModelProfileView[],
): TournamentValidation {
  const modelErrors: TournamentModelErrors = {};
  const nameCounts = new Map<string, number>();

  for (const draft of drafts) {
    const key = normalizeModelName(draft.name);
    if (key.length > 0) {
      nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
    }
  }

  for (const draft of drafts) {
    const errors: TournamentFieldErrors = { ...validateModelConfig(draft) };
    if (
      draft.profileId &&
      profiles &&
      !profiles.some((profile) => profile.id === draft.profileId)
    ) {
      errors.profile = '所选模型已不存在，请重新选择。';
    }
    const name = draft.name.trim();

    if (!name) {
      errors.name = '请填写名称。';
    } else if (name.length > 80) {
      errors.name = '名称过长，最多 80 个字符。';
    } else if ((nameCounts.get(normalizeModelName(name)) ?? 0) > 1) {
      errors.name = '名称不可重复。';
    }

    if (Object.keys(errors).length > 0) {
      modelErrors[draft.id] = errors;
    }
  }

  let gamesError: string | null = null;
  if (
    !Number.isInteger(gamesPerPair) ||
    gamesPerPair < 1 ||
    gamesPerPair > TOURNAMENT_MAX_GAMES_PER_PAIR
  ) {
    gamesError = `每对局数须为 1–${TOURNAMENT_MAX_GAMES_PER_PAIR} 的整数。`;
  }

  let formError: string | null = null;
  if (drafts.length < TOURNAMENT_MIN_MODELS) {
    formError = `至少需要 ${TOURNAMENT_MIN_MODELS} 位参赛模型。`;
  } else if (drafts.length > TOURNAMENT_MAX_MODELS) {
    formError = `最多支持 ${TOURNAMENT_MAX_MODELS} 位参赛模型。`;
  }

  return {
    ok: Object.keys(modelErrors).length === 0 && gamesError === null && formError === null,
    modelErrors,
    gamesError,
    formError,
  };
}

/**
 * Optional per-game overrides shared by every request shape. Fields left at
 * their "follow / no limit" default (null) are omitted, exactly like the
 * existing independent timeout override.
 */
function draftOptionalOverrides(draft: TournamentModelDraft): {
  promptLevel?: ThinkingLevel;
  maxThinkingTokens?: number;
  maxCompletionTokens?: number;
  requestTimeoutSeconds?: number;
} {
  return {
    ...(draft.promptLevel != null ? { promptLevel: draft.promptLevel } : {}),
    ...(draft.maxThinkingTokens != null
      ? { maxThinkingTokens: draft.maxThinkingTokens }
      : {}),
    ...(draft.maxCompletionTokens != null
      ? { maxCompletionTokens: draft.maxCompletionTokens }
      : {}),
    ...(draft.requestTimeoutSeconds != null
      ? { requestTimeoutSeconds: draft.requestTimeoutSeconds }
      : {}),
  };
}

/** One draft as the wire request shared by tournaments, championships and qualifiers. */
export function draftToModelRequest(draft: TournamentModelDraft): TournamentModelRequest {
  if (draft.profileId) {
    return {
      name: draft.name.trim(),
      profileId: draft.profileId,
      thinkingLevel: draft.thinkingLevel,
      apiReasoning: draft.apiReasoning,
      ...draftOptionalOverrides(draft),
    };
  }
  return {
    name: draft.name.trim(),
    provider: draft.provider,
    baseUrl: draft.baseUrl.trim(),
    model: draft.model.trim(),
    apiKey: draft.apiKey,
    thinkingLevel: draft.thinkingLevel,
    apiReasoning: draft.apiReasoning,
    ...draftOptionalOverrides(draft),
  };
}

export function toTournamentStartRequest(
  drafts: readonly TournamentModelDraft[],
  gamesPerPair: number,
): TournamentStartRequest {
  return {
    models: drafts.map(draftToModelRequest),
    gamesPerPair,
  };
}

export function groupGamesByPair(
  games: readonly TournamentGameView[],
): TournamentPairGroup[] {
  const buckets = new Map<number, TournamentGameView[]>();

  for (const game of games) {
    const bucket = buckets.get(game.pairIndex);
    if (bucket) {
      bucket.push(game);
    } else {
      buckets.set(game.pairIndex, [game]);
    }
  }

  return [...buckets.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([pairIndex, pairGames]) => ({
      pairIndex,
      games: [...pairGames].sort((left, right) => left.gameIndex - right.gameIndex),
    }));
}

export function findCurrentGame(
  state: TournamentState | null,
): TournamentGameView | null {
  if (!state || !state.currentGameId) {
    return null;
  }
  return state.games.find((game) => game.id === state.currentGameId) ?? null;
}

export function tournamentPhaseTone(phase: TournamentPhase): TournamentTone {
  switch (phase) {
    case 'running':
      return 'running';
    case 'finished':
      return 'finished';
    case 'stopped':
      return 'paused';
    case 'error':
      return 'error';
    default:
      return 'idle';
  }
}

export function gameStatusTone(status: TournamentGameStatus): TournamentTone {
  return GAME_STATUS_TONES[status];
}

export function modelThinkingLabel(model: TournamentModelView | undefined): string {
  if (!model) {
    return '—';
  }
  return `${thinkingLevelLabel(model.thinkingLevel)}${model.apiReasoning ? ' · API' : ''}`;
}

export function modelDescriptor(model: TournamentModelView | undefined): string {
  if (!model) {
    return '';
  }
  return `${PROVIDER_LABELS[model.provider]} · ${model.model}`;
}

export function describeTournamentGameResult(game: TournamentGameView): string {
  if (game.result && game.result.text.trim().length > 0) {
    return game.result.text;
  }
  if (game.status === 'finished') {
    if (!game.winnerModelId) {
      return '和局';
    }
    return game.winnerModelId === game.redModelId
      ? `红方 ${game.redName} 胜`
      : `黑方 ${game.blackName} 胜`;
  }
  return TOURNAMENT_GAME_STATUS_LABELS[game.status];
}

export function describeFailedSide(game: TournamentGameView): string | null {
  if (!game.failedSide) {
    return null;
  }
  const name = game.failedSide === 'red' ? game.redName : game.blackName;
  return `${SIDE_LABEL[game.failedSide]} ${name} 异常`;
}

export function formatTournamentClock(timestamp: number | null): string {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) {
    return '—';
  }
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(timestamp));
  } catch {
    return '—';
  }
}

export function tournamentAriaSummary(
  state: TournamentState | null,
  plan: TournamentPlan,
  loadError: string | null,
): string {
  if (!state) {
    return loadError ? '赛事服务尚未就绪。' : '正在连接赛事服务。';
  }

  const total = state.totalGames > 0 ? state.totalGames : plan.totalGames;
  const leader = state.standings[0];
  const parts: string[] = [
    `自动评测，${TOURNAMENT_PHASE_LABELS[state.phase]}`,
    `已处理 ${state.processedGames}/${total} 局`,
    `已完赛 ${state.completedGames} 局`,
  ];

  if (leader) {
    parts.push(`当前第一 ${leader.name}，积 ${leader.points} 分`);
  }

  if (state.error) {
    parts.push(`赛事异常：${state.error}`);
  }

  return `${parts.join('，')}。`;
}
