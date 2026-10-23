import type {
  ChampionshipGameView,
  QualifierGroupId,
  QualifierGroupView,
  QualifierPhase,
  QualifierState,
  TournamentStanding,
} from '../../shared/protocol';
import {
  CHAMPIONSHIP_QUALIFIER_ADVANCE_PER_GROUP,
  CHAMPIONSHIP_QUALIFIER_GROUP_GAMES,
} from '../../shared/protocol';
import type { TournamentTone } from './tournament';

/** Presentation helpers for the ten-model qualifying round. */

export const QUALIFIER_PHASE_LABELS: Record<QualifierPhase, string> = {
  idle: '待开赛',
  running: '入围赛进行中',
  finished: '入围赛完成',
  stopped: '已中止',
  error: '异常中止',
  interrupted: '中断待续',
};

export const QUALIFIER_PHASE_HINTS: Record<QualifierPhase, string> = {
  idle: '10 位模型分入 A、B 两组，组内单循环；每组前二进入四号种子池。',
  running: '两组同轮并行，每轮 4 局且不共享选手；可随时中止。',
  finished: '每组前二已进入四号种子池，可以开始抽签。',
  stopped: '入围赛已中止，断点已保存；可继续入围赛，或重新发起。',
  error: '入围赛因异常中止，断点已保存；可继续入围赛，或重新发起。',
  interrupted: '服务重启或断电后已恢复断点；点击「继续入围赛」接着进行。',
};

export const QUALIFIER_GROUP_ORDER: readonly QualifierGroupId[] = ['A', 'B'];

export function qualifierGroupLabel(groupId: QualifierGroupId | null | undefined): string {
  return groupId ? `${groupId} 组` : '待定';
}

export function qualifierPhaseTone(phase: QualifierPhase): TournamentTone {
  switch (phase) {
    case 'running':
      return 'running';
    case 'finished':
      return 'finished';
    case 'stopped':
    case 'interrupted':
      return 'paused';
    case 'error':
      return 'error';
    default:
      return 'idle';
  }
}

export interface QualifierProgress {
  percent: number;
  processedGames: number;
  completedGames: number;
  totalGames: number;
  groupGamesProcessed: number;
  groupsComplete: number;
}

/**
 * Four weighted quarters: 20 games in two groups. Canceled games were never
 * played, so they are excluded from the completed counter.
 */
export function qualifierProgress(state: QualifierState | null): QualifierProgress {
  const canceled =
    state?.games.filter((game) => game.status === 'canceled').length ?? 0;
  const played =
    state?.games.filter(
      (game) => game.status === 'finished' || game.status === 'failed',
    ).length ?? 0;
  const groupsComplete =
    state?.groups.filter((group) => group.complete).length ?? 0;
  const processedGames = Math.max(0, (state?.processedGames ?? 0) - canceled);
  const totalGames = state?.groupGamesTotal || CHAMPIONSHIP_QUALIFIER_GROUP_GAMES;
  const percent =
    state?.phase === 'finished'
      ? 100
      : Math.min(99, Math.round((played / totalGames) * 100));

  return {
    percent: Math.max(0, percent),
    processedGames,
    completedGames: state?.completedGames ?? 0,
    totalGames,
    groupGamesProcessed: played,
    groupsComplete,
  };
}

/** Group rows that would advance: final once complete, provisional while live. */
export function qualifierStandingQualified(
  group: QualifierGroupView,
  standing: TournamentStanding,
): boolean {
  if (group.complete && group.qualifiedModelIds.length > 0) {
    return group.qualifiedModelIds.includes(standing.modelId);
  }
  return standing.rank <= CHAMPIONSHIP_QUALIFIER_ADVANCE_PER_GROUP;
}

export function qualifierQualificationLabel(
  group: QualifierGroupView,
  standing: TournamentStanding,
): string {
  if (!qualifierStandingQualified(group, standing)) {
    return '';
  }
  return group.complete ? '已晋级' : '暂列晋级';
}

/** Names of the four qualifiers in A1, B1, A2, B2 order. */
export function qualifierQualifiedNames(state: QualifierState | null): string[] {
  if (!state) return [];
  const nameById = new Map(state.entrants.map((entrant) => [entrant.id, entrant.name]));
  return state.qualifiedModelIds
    .map((id) => nameById.get(id))
    .filter((name): name is string => Boolean(name));
}

export interface QualifierCurrentGame {
  game: ChampionshipGameView;
  groupId: QualifierGroupId;
  label: string;
}

/** Up to two human-readable rows for the games currently being played. */
export function qualifierCurrentGames(
  state: QualifierState | null,
): QualifierCurrentGame[] {
  if (!state || state.phase !== 'running') return [];
  const byId = new Map(state.games.map((game) => [game.id, game]));
  const games: QualifierCurrentGame[] = [];
  for (const gameId of state.currentGameIds) {
    const game = byId.get(gameId);
    if (!game || !game.groupId) continue;
    games.push({
      game,
      groupId: game.groupId as QualifierGroupId,
      label: `${qualifierGroupLabel(game.groupId as QualifierGroupId)} · 红方 ${game.redName} 对 黑方 ${game.blackName}`,
    });
  }
  return games;
}

export function qualifierAriaSummary(
  state: QualifierState | null,
  loadError: string | null,
): string {
  if (!state) {
    return loadError ? '入围赛服务尚未就绪。' : '正在连接入围赛服务。';
  }

  const progress = qualifierProgress(state);
  const qualified = qualifierQualifiedNames(state);
  const parts: string[] = [
    `入围赛，${QUALIFIER_PHASE_LABELS[state.phase]}`,
    `已赛 ${progress.groupGamesProcessed}/${progress.totalGames} 局`,
    `小组 ${progress.groupsComplete}/2 完成`,
  ];
  if (qualified.length > 0) {
    parts.push(`晋级 ${qualified.join('、')}`);
  }
  if (state.error) {
    parts.push(`入围赛异常：${state.error}`);
  }
  return `${parts.join('，')}。`;
}
