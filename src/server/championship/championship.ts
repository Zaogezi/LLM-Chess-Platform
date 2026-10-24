import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  ArenaState,
  ChampionshipArchive,
  ChampionshipArchivePhase,
  ChampionshipEntrantView,
  ChampionshipGameSnapshot,
  ChampionshipGameView,
  ChampionshipGroupId,
  ChampionshipGroupView,
  ChampionshipPhase,
  ChampionshipSeriesDecision,
  ChampionshipSeriesView,
  ChampionshipStage,
  ChampionshipState,
  GameSettings,
  ModelSetup,
} from '../../shared/protocol';
import {
  CHAMPIONSHIP_GROUPS,
  CHAMPIONSHIP_GROUP_GAMES,
  CHAMPIONSHIP_GROUP_GAMES_PER_GROUP,
  CHAMPIONSHIP_SERIES_COUNT,
  CHAMPIONSHIP_SERIES_DRAW_POINTS,
  CHAMPIONSHIP_SERIES_GAME_LIMIT,
  CHAMPIONSHIP_SERIES_POINTS_TARGET,
  CHAMPIONSHIP_SERIES_WIN_POINTS,
  DEFAULT_THINKING_LEVEL,
} from '../../shared/protocol';
import { Arena } from '../arena/arena';
import type { ProviderFactory } from '../providers/index';
import { defaultProviderFactory } from '../providers/index';
import { XiangqiGame } from '../xiangqi/index';
import {
  ChampionshipCheckpointStore,
  type ChampionshipCheckpoint,
  type ChampionshipCheckpointPhase,
} from './checkpoint';
import {
  buildGroupGames,
  createGameView,
  createSeriesSkeleton,
  type GroupSchedule,
} from './schedule';
import {
  compareChampionshipGroupRanking,
  compareChampionshipRanking,
  computeGroupStandings,
  qualifiedModelIds,
  type ChampionshipRankingInfo,
  type GroupStandingMember,
} from './standings';
import type { ValidatedChampionshipStart } from './validate';

export interface ChampionshipGameCompletion {
  championshipId: string;
  game: ChampionshipGameView;
  finalState: ArenaState;
  red: ChampionshipEntrantView;
  black: ChampionshipEntrantView;
}

export interface ChampionshipOptions {
  providerFactory?: ProviderFactory;
  /** Deterministic positions for tests; production starts from the standard FEN. */
  createInitialGame?: () => XiangqiGame;
  gameSettings?: GameSettings;
  /** Called after a championship game finishes or fails, for the history archive. */
  onGameComplete?: (completion: ChampionshipGameCompletion) => void;
  /**
   * Resumable checkpoint persistence. Defaults to an in-memory store; the
   * production server injects a store backed by `data/championship.json`.
   */
  checkpointStore?: ChampionshipCheckpointStore;
  /**
   * Called with a terminal snapshot (finished/stopped/error/interrupted) so the
   * server can persist it in the championship archive. Never contains API keys.
   */
  onArchive?: (archive: ChampionshipArchive) => void;
}

export class ChampionshipConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChampionshipConflictError';
  }
}

class ChampionshipAbortedError extends Error {
  constructor() {
    super('锦标赛已终止');
    this.name = 'ChampionshipAbortedError';
  }
}

const CHAMPIONSHIP_GAME_SETTINGS: GameSettings = {
  moveDelayMs: 0,
  maxAttempts: 3,
};

const CANCELED_MESSAGE = '锦标赛提前终止';
const FAILED_GAME_MESSAGE = '对局执行失败，已跳过该局';
const INTERNAL_ERROR_MESSAGE = '锦标赛内部错误，可继续锦标赛或重新发起';
/** The suspended game is replayed after the quota problem is fixed. */
const QUOTA_CANCELED_MESSAGE = '模型 API 额度不足，恢复后重赛';
const QUOTA_PAUSED_MESSAGE =
  '模型 API 额度不足，锦标赛已暂停。请为相关模型充值或更换 API Key 后点击「继续锦标赛」恢复比赛';

function isProcessedGame(game: ChampionshipGameView): boolean {
  return (
    game.status === 'finished' ||
    game.status === 'failed' ||
    game.status === 'canceled'
  );
}

/**
 * A group is only complete when every game actually reached a verdict. A
 * canceled game means the championship was stopped/crashed, so no qualifier
 * may be promoted from the partial table.
 */
function isDecidedGame(game: ChampionshipGameView): boolean {
  return game.status === 'finished' || game.status === 'failed';
}

function cloneGame(game: ChampionshipGameView): ChampionshipGameView {
  return {
    ...game,
    result: game.result ? { ...game.result } : null,
  };
}

function cloneSeries(series: ChampionshipSeriesView): ChampionshipSeriesView {
  return {
    ...series,
    left: series.left ? { ...series.left } : null,
    right: series.right ? { ...series.right } : null,
  };
}

/** Reset an unadjudicated game so it can be replayed from the start. */
function resetGameForResume(game: ChampionshipGameView): void {
  game.status = 'scheduled';
  game.plies = 0;
  game.winnerModelId = null;
  game.result = null;
  game.error = null;
  game.failedSide = null;
  game.startedAt = null;
  game.finishedAt = null;
  game.durationMs = 0;
  game.tokensIn = 0;
  game.tokensOut = 0;
  game.redTokensIn = 0;
  game.redTokensOut = 0;
  game.blackTokensIn = 0;
  game.blackTokensOut = 0;
}

function applyArenaTotals(game: ChampionshipGameView, state: ArenaState): void {
  const red = state.models.red;
  const black = state.models.black;
  game.plies = state.ply;
  game.redTokensIn = red?.totalTokensIn ?? 0;
  game.redTokensOut = red?.totalTokensOut ?? 0;
  game.blackTokensIn = black?.totalTokensIn ?? 0;
  game.blackTokensOut = black?.totalTokensOut ?? 0;
  game.tokensIn = game.redTokensIn + game.blackTokensIn;
  game.tokensOut = game.redTokensOut + game.blackTokensOut;
}

function emptyGroupMembers(): Record<ChampionshipGroupId, string[]> {
  return { A: [], B: [], C: [], D: [] };
}

/** Loose function type used when resolving names to indices. */
type Lookup<T> = Map<string, T>;

/**
 * 16-entrant championship orchestrator: four seeded groups (single
 * round-robin) followed by a seven-series knockout bracket. Every knockout
 * series is identical: at most six base games, a decisive game is worth one
 * series point and a draw is worth one to both sides; the first side to reach
 * three points advances. A 3:3 tie (three draws, or equivalent) enters
 * overtime where the next decisive game wins, and a six-game all-draw series
 * falls back to group ranking; identical group rankings force extra games.
 *
 * The 24 group games are scheduled upfront. Knockout games only materialise
 * when a series actually starts, so the state never shows games that were
 * never played. Every game gets its own Arena; API keys live only in the
 * private runtime map and are dropped at finish, stop or error.
 */
export class Championship {
  private readonly providerFactory: ProviderFactory;
  private readonly createInitialGame: () => XiangqiGame;
  private readonly gameSettings: GameSettings;
  private readonly onGameComplete:
    | ((completion: ChampionshipGameCompletion) => void)
    | undefined;
  private readonly checkpointStore: ChampionshipCheckpointStore;
  private readonly onArchive: ((archive: ChampionshipArchive) => void) | undefined;
  private readonly events = new EventEmitter();

  private phase: ChampionshipPhase = 'idle';
  private revision = 0;
  private championshipId: string | null = null;
  private stage: ChampionshipStage | null = null;
  private entrants: ChampionshipEntrantView[] = [];
  private memberMeta = new Map<string, GroupStandingMember>();
  private groupMembers: Record<ChampionshipGroupId, string[]> = emptyGroupMembers();
  private runtimes = new Map<string, ModelSetup>();
  private games: ChampionshipGameView[] = [];
  private series: ChampionshipSeriesView[] = [];
  private currentGameIds: string[] = [];
  private currentSeriesIds: string[] = [];
  /** Max simultaneous games (group stage) or series (knockout round). */
  private concurrency = 1;
  private championModelId: string | null = null;
  private championName: string | null = null;
  private error: string | null = null;
  private startedAt: number | null = null;
  private finishedAt: number | null = null;
  private checkpointSavedAt: number | null = null;
  /** True once the current edition has been handed to `onArchive`. */
  private archiveEmitted = false;

  private runToken = 0;
  private runPromise: Promise<void> | null = null;
  private abortController: AbortController | null = null;
  /** Every game currently playing, keyed by game id. */
  private activeArenas = new Map<string, Arena>();
  /** Latest game whose board is still kept so the spectator page can show it. */
  private lastFinishedGameId: string | null = null;
  private lastFinalState: ArenaState | null = null;
  private stopRequested = false;
  /** Non-null while the run is suspended because a key's quota ran out. */
  private pauseReason: string | null = null;
  private disposed = false;

  constructor(options: ChampionshipOptions = {}) {
    this.providerFactory = options.providerFactory ?? defaultProviderFactory;
    this.createInitialGame = options.createInitialGame ?? (() => XiangqiGame.initial());
    this.gameSettings = options.gameSettings
      ? { ...options.gameSettings }
      : { ...CHAMPIONSHIP_GAME_SETTINGS };
    this.onGameComplete = options.onGameComplete;
    this.checkpointStore =
      options.checkpointStore ?? new ChampionshipCheckpointStore({ filePath: null });
    this.onArchive = options.onArchive;
    this.events.setMaxListeners(100);
    this.restoreCheckpointOnBoot();
  }

  onState(listener: (state: ChampionshipState) => void): () => void {
    this.events.on('state', listener);
    return () => this.events.off('state', listener);
  }

  getState(): ChampionshipState {
    const groupGames = this.games.filter((game) => game.stage === 'group');
    const configured = this.entrants.length > 0;
    const groups = configured
      ? CHAMPIONSHIP_GROUPS.map((groupId) => this.buildGroupView(groupId, groupGames))
      : [];
    const series = configured ? this.series.map(cloneSeries) : [];

    return {
      revision: this.revision,
      phase: this.phase,
      championshipId: this.championshipId,
      stage: this.stage,
      entrants: this.entrants.map((entrant) => ({ ...entrant })),
      groups,
      series,
      games: this.games.map(cloneGame),
      groupGamesTotal: CHAMPIONSHIP_GROUP_GAMES,
      groupGamesProcessed: groupGames.filter(isProcessedGame).length,
      seriesTotal: CHAMPIONSHIP_SERIES_COUNT,
      seriesProcessed: this.series.filter((item) => item.status === 'finished').length,
      scheduledGames: this.games.length,
      processedGames: this.games.filter(isProcessedGame).length,
      completedGames: this.games.filter((game) => game.status === 'finished').length,
      currentGameId: this.currentGameIds[0] ?? null,
      currentGameIds: [...this.currentGameIds],
      currentSeriesId: this.currentSeriesIds[0] ?? null,
      currentSeriesIds: [...this.currentSeriesIds],
      concurrency: this.concurrency,
      championModelId: this.championModelId,
      championName: this.championName,
      error: this.error,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      resumable:
        (this.phase === 'stopped' ||
          this.phase === 'error' ||
          this.phase === 'paused' ||
          this.phase === 'interrupted') &&
        this.entrants.length > 0 &&
        this.checkpointStore.has(),
      checkpointSavedAt: this.checkpointSavedAt,
    };
  }

  /**
   * One game plus its current (or latest finished) board for the spectator page.
   * Returns null for an unknown id. Only the running game and the last finished
   * game keep a board in memory; older games remain in the history archive.
   */
  getGameSnapshot(gameId: string): ChampionshipGameSnapshot | null {
    const game = this.games.find((candidate) => candidate.id === gameId);
    if (!game) return null;

    const activeArena = this.activeArenas.get(gameId);
    const live = activeArena !== undefined && game.status === 'running';
    let arena: ArenaState | null = live ? activeArena.getState() : null;
    if (!arena && this.lastFinishedGameId === gameId) {
      arena = this.lastFinalState;
    }

    return { game: cloneGame(game), arena, live };
  }

  start(input: ValidatedChampionshipStart): ChampionshipState {
    if (this.disposed) {
      throw new ChampionshipConflictError('服务正在关闭，无法启动锦标赛');
    }
    if (this.phase === 'running') {
      throw new ChampionshipConflictError('已有锦标赛正在进行，请先终止当前锦标赛');
    }

    // Replacing an interrupted/stopped/error edition archives it first, so a
    // freshly started championship never silently discards the previous one.
    this.archivePreviousRunIfNeeded();

    // Resolve group membership before touching any engine state so a malformed
    // (but unvalidated) payload cannot leave the run half-configured.
    const indexByName: Lookup<number> = new Map(
      input.entrants.map((entrant, index) => [entrant.name.toLocaleLowerCase(), index]),
    );
    const groupMembers = emptyGroupMembers();
    const groupIdByEntrant = new Map<string, ChampionshipGroupId>();
    for (const group of input.groups) {
      const ids: string[] = [];
      for (const name of group.entrantNames) {
        const index = indexByName.get(name.toLocaleLowerCase());
        if (index === undefined) {
          throw new Error(`锦标赛分组包含未知参赛模型：${name}`);
        }
        const id = `m${index + 1}`;
        ids.push(id);
        groupIdByEntrant.set(id, group.id);
      }
      groupMembers[group.id] = ids;
    }

    const entrantViews: ChampionshipEntrantView[] = [];
    const memberMeta = new Map<string, GroupStandingMember>();
    const runtimes = new Map<string, ModelSetup>();
    input.entrants.forEach((entrant, index) => {
      const id = `m${index + 1}`;
      const groupId = groupIdByEntrant.get(id);
      if (!groupId) {
        throw new Error(`参赛模型 ${entrant.name} 未分配到任何分组`);
      }
      entrantViews.push({
        id,
        name: entrant.name,
        provider: entrant.setup.provider,
        model: entrant.setup.model,
        thinkingLevel: entrant.setup.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
        apiReasoning: Boolean(entrant.setup.apiReasoning),
        promptLevel: entrant.setup.promptLevel ?? null,
        maxThinkingTokens: entrant.setup.maxThinkingTokens ?? null,
        maxCompletionTokens: entrant.setup.maxCompletionTokens ?? null,
        requireReason: entrant.setup.requireReason !== false,
        requestTimeoutSeconds: entrant.setup.requestTimeoutSeconds ?? null,
        keyConfigured: Boolean(entrant.setup.apiKey),
        seedPool: entrant.seedPool,
        groupId,
      });
      memberMeta.set(id, {
        id,
        name: entrant.name,
        seedPool: entrant.seedPool,
        inputIndex: index,
      });
      runtimes.set(id, entrant.setup);
    });

    const schedules: GroupSchedule[] = CHAMPIONSHIP_GROUPS.map((groupId) => ({
      id: groupId,
      members: groupMembers[groupId].map((entrantId) => {
        const member = memberMeta.get(entrantId);
        if (!member) throw new Error(`参赛模型 ${entrantId} 缺少分组信息`);
        return { id: member.id, name: member.name, seedPool: member.seedPool };
      }),
    }));

    this.runToken += 1;
    const token = this.runToken;
    this.stopRequested = false;
    this.abortController?.abort();
    this.abortController = new AbortController();

    this.entrants = entrantViews;
    this.memberMeta = memberMeta;
    this.groupMembers = groupMembers;
    this.runtimes = runtimes;
    this.games = buildGroupGames(schedules);
    this.series = createSeriesSkeleton();
    this.phase = 'running';
    this.stage = 'group';
    this.championshipId = randomUUID();
    this.error = null;
    this.pauseReason = null;
    this.startedAt = Date.now();
    this.finishedAt = null;
    this.concurrency = input.concurrency;
    this.currentGameIds = [];
    this.currentSeriesIds = [];
    this.lastFinishedGameId = null;
    this.lastFinalState = null;
    this.championModelId = null;
    this.championName = null;
    this.checkpointSavedAt = null;
    this.archiveEmitted = false;

    this.persistCheckpoint();
    this.emitState();
    this.launch(token);

    return this.getState();
  }

  /**
   * Continue a stopped/error/interrupted run from its last checkpoint. The
   * in-flight game (if any) was never archived, so it is replayed from move 1;
   * every completed group/knockout game keeps its result.
   */
  resume(): ChampionshipState {
    if (this.disposed) {
      throw new ChampionshipConflictError('服务正在关闭，无法继续锦标赛');
    }
    if (
      this.phase !== 'stopped' &&
      this.phase !== 'error' &&
      this.phase !== 'paused' &&
      this.phase !== 'interrupted'
    ) {
      throw new ChampionshipConflictError('当前没有可继续的锦标赛');
    }
    if (!this.championshipId || this.entrants.length === 0) {
      throw new ChampionshipConflictError('没有可恢复的锦标赛断点');
    }

    // A stopped/error run drops its in-memory keys. Reload the latest saved
    // runtime setups so resume can authenticate without asking for keys again.
    if (this.runtimes.size === 0) {
      const saved = this.checkpointStore.load();
      if (!saved) {
        throw new ChampionshipConflictError('断点存档不可用，请重新配置下一届');
      }
      this.restoreRuntimes(saved);
    }

    this.normalizeForResume();

    this.runToken += 1;
    const token = this.runToken;
    this.stopRequested = false;
    this.pauseReason = null;
    this.abortController?.abort();
    this.abortController = new AbortController();
    this.phase = 'running';
    this.error = null;
    this.finishedAt = null;
    this.currentGameIds = [];
    this.currentSeriesIds = [];
    this.lastFinishedGameId = null;
    this.lastFinalState = null;
    this.championModelId = null;
    this.championName = null;
    this.stage = this.deriveStage();
    // A resumed edition will be archived again with its final outcome.
    this.archiveEmitted = false;

    this.persistCheckpoint();
    this.emitState();
    this.launch(token);
    return this.getState();
  }

  async stop(): Promise<ChampionshipState> {
    if (this.phase !== 'running') {
      throw new ChampionshipConflictError('当前没有正在运行的锦标赛');
    }

    this.stopRequested = true;
    this.abortController?.abort();
    for (const arena of this.activeArenas.values()) {
      arena.dispose();
    }
    await this.runPromise;
    return this.getState();
  }

  dispose(): void {
    if (this.disposed) return;
    // A graceful shutdown is still a resumable interruption. Save the latest
    // snapshot while the runtime setups (API keys) are still available.
    if (this.phase === 'running') this.persistCheckpoint();
    this.disposed = true;
    this.runToken += 1;
    this.stopRequested = true;
    this.abortController?.abort();
    this.abortController = null;
    for (const arena of this.activeArenas.values()) {
      arena.dispose();
    }
    this.activeArenas.clear();
    this.currentGameIds = [];
    this.currentSeriesIds = [];
    this.lastFinishedGameId = null;
    this.lastFinalState = null;
    this.dropRuntimes();
    this.events.removeAllListeners();
  }

  private launch(token: number): void {
    this.runPromise = this.execute(token).catch((error: unknown) => {
      this.handleRunFailure(token, error);
    });
  }

  private handleRunFailure(token: number, error: unknown): void {
    if (this.disposed || token !== this.runToken) return;
    for (const arena of this.activeArenas.values()) {
      arena.dispose();
    }
    this.activeArenas.clear();
    this.markRemainingCanceled('锦标赛内部错误，未完成的对局已取消');
    this.markSeriesStopped();
    this.phase = 'error';
    this.error = INTERNAL_ERROR_MESSAGE;
    this.currentGameIds = [];
    this.currentSeriesIds = [];
    this.finishedAt = Date.now();
    this.persistCheckpoint();
    this.archiveRun('error');
    this.dropRuntimes();
    console.error(
      '[championship] run failed:',
      error instanceof Error ? error.message : error,
    );
    this.emitState();
  }

  /**
   * Write a resumable snapshot. Called after every completed game and on
   * start/stop/error/shutdown; the in-flight game is intentionally not stored,
   * so a power cut can only cost the current game, never a decided result.
   */
  private persistCheckpoint(): void {
    const phase = this.phase;
    if (
      !this.championshipId ||
      this.entrants.length === 0 ||
      phase === 'idle' ||
      phase === 'finished'
    ) {
      return;
    }
    if (this.runtimes.size !== this.entrants.length) {
      console.error('[championship] skipped checkpoint: runtime setups are unavailable');
      return;
    }

    const savedAt = Date.now();
    const entrants: ChampionshipCheckpoint['entrants'] = [];
    for (const entrant of this.entrants) {
      const setup = this.runtimes.get(entrant.id);
      if (!setup) {
        console.error('[championship] skipped checkpoint: missing runtime setup');
        return;
      }
      entrants.push({
        id: entrant.id,
        name: entrant.name,
        seedPool: entrant.seedPool,
        groupId: entrant.groupId,
        setup: { ...setup, displayName: entrant.name },
      });
    }

    const checkpoint: ChampionshipCheckpoint = {
      version: 2,
      savedAt,
      championshipId: this.championshipId,
      phase: phase as ChampionshipCheckpointPhase,
      stage: this.stage,
      startedAt: this.startedAt ?? savedAt,
      finishedAt: this.finishedAt,
      error: this.error,
      entrants,
      games: this.games.map(cloneGame),
      series: this.series.map(cloneSeries),
      concurrency: this.concurrency,
    };

    if (this.checkpointStore.save(checkpoint)) {
      this.checkpointSavedAt = savedAt;
    }
  }

  // ---- Championship archive ---------------------------------------------

  /** Build a terminal snapshot from the public state. Never contains keys. */
  private buildArchive(phase: ChampionshipArchivePhase): ChampionshipArchive | null {
    const state = this.getState();
    if (!state.championshipId || state.entrants.length === 0 || state.startedAt === null) {
      return null;
    }

    return {
      version: 1,
      championshipId: state.championshipId,
      phase,
      startedAt: state.startedAt,
      finishedAt: state.finishedAt,
      archivedAt: Date.now(),
      championModelId: state.championModelId,
      championName: state.championName,
      error: state.error,
      entrantNames: state.entrants.map((entrant) => entrant.name),
      completedGames: state.completedGames,
      processedGames: state.processedGames,
      scheduledGames: state.scheduledGames,
      seriesProcessed: state.seriesProcessed,
      seriesTotal: state.seriesTotal,
      entrants: state.entrants,
      groups: state.groups,
      series: state.series,
      games: state.games,
      groupGamesTotal: state.groupGamesTotal,
      groupGamesProcessed: state.groupGamesProcessed,
    };
  }

  /**
   * Hand the current edition to `onArchive` exactly once. Called on normal
   * finish, stop(), internal failure, and when start() replaces a previous
   * interrupted/stopped/error edition that has not been archived yet.
   */
  private archiveRun(phase: ChampionshipArchivePhase): void {
    if (this.archiveEmitted || !this.onArchive) return;
    if (!this.championshipId || this.entrants.length === 0) return;
    const archive = this.buildArchive(phase);
    if (!archive) return;

    try {
      this.onArchive(archive);
      this.archiveEmitted = true;
    } catch (error) {
      console.error(
        '[championship] archive callback failed:',
        error instanceof Error ? error.message : error,
      );
    }
  }

  private archivePreviousRunIfNeeded(): void {
    if (this.archiveEmitted || !this.onArchive) return;
    const phase = this.phase;
    if (phase === 'paused') {
      // A suspended edition replaced by a new one is archived as unfinished.
      this.archiveRun('interrupted');
      return;
    }
    if (phase !== 'interrupted' && phase !== 'stopped' && phase !== 'error') return;
    this.archiveRun(phase);
  }

  private restoreCheckpointOnBoot(): void {
    const checkpoint = this.checkpointStore.load();
    if (!checkpoint) return;
    try {
      this.applyCheckpoint(
        checkpoint,
        checkpoint.phase === 'running' ? 'interrupted' : checkpoint.phase,
      );
    } catch (error) {
      console.error(
        '[championship] failed to restore checkpoint:',
        error instanceof Error ? error.message : error,
      );
      this.entrants = [];
      this.memberMeta.clear();
      this.groupMembers = emptyGroupMembers();
      this.runtimes.clear();
      this.games = [];
      this.series = [];
      this.championshipId = null;
      this.stage = null;
      this.phase = 'idle';
      this.startedAt = null;
      this.finishedAt = null;
      this.error = null;
      this.checkpointSavedAt = null;
    }
  }

  private applyCheckpoint(
    checkpoint: ChampionshipCheckpoint,
    phase: ChampionshipCheckpointPhase,
  ): void {
    const entrants: ChampionshipEntrantView[] = checkpoint.entrants.map((entrant) => ({
      id: entrant.id,
      name: entrant.name,
      provider: entrant.setup.provider,
      model: entrant.setup.model,
      thinkingLevel: entrant.setup.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
      apiReasoning: Boolean(entrant.setup.apiReasoning),
      promptLevel: entrant.setup.promptLevel ?? null,
      maxThinkingTokens: entrant.setup.maxThinkingTokens ?? null,
      maxCompletionTokens: entrant.setup.maxCompletionTokens ?? null,
      requireReason: entrant.setup.requireReason !== false,
      requestTimeoutSeconds: entrant.setup.requestTimeoutSeconds ?? null,
      keyConfigured: Boolean(entrant.setup.apiKey),
      seedPool: entrant.seedPool,
      groupId: entrant.groupId,
    }));
    const memberMeta = new Map<string, GroupStandingMember>();
    const groupMembers = emptyGroupMembers();
    checkpoint.entrants.forEach((entrant, index) => {
      memberMeta.set(entrant.id, {
        id: entrant.id,
        name: entrant.name,
        seedPool: entrant.seedPool,
        inputIndex: index,
      });
      groupMembers[entrant.groupId].push(entrant.id);
    });

    this.entrants = entrants;
    this.memberMeta = memberMeta;
    this.groupMembers = groupMembers;
    // Keep secrets out of memory until the user actually resumes. The
    // checkpoint store still has the runtime setups needed by resume().
    this.runtimes = new Map();
    this.games = checkpoint.games.map(cloneGame);
    this.series = checkpoint.series.map(cloneSeries);
    this.championshipId = checkpoint.championshipId;
    this.stage = checkpoint.stage;
    this.startedAt = checkpoint.startedAt;
    this.finishedAt = checkpoint.finishedAt;
    this.error = checkpoint.error;
    this.checkpointSavedAt = checkpoint.savedAt;
    this.concurrency = checkpoint.concurrency ?? 1;
    this.currentGameIds = [];
    this.currentSeriesIds = [];
    this.championModelId = null;
    this.championName = null;
    this.phase = phase;
    this.archiveEmitted = false;
  }

  private restoreRuntimes(checkpoint: ChampionshipCheckpoint): void {
    if (checkpoint.entrants.length !== this.entrants.length) {
      throw new ChampionshipConflictError('断点存档与当前赛事不匹配，请重新配置下一届');
    }
    const knownIds = new Set(this.entrants.map((entrant) => entrant.id));
    const runtimes = new Map<string, ModelSetup>();
    for (const entrant of checkpoint.entrants) {
      if (!knownIds.has(entrant.id)) {
        throw new ChampionshipConflictError('断点存档与当前赛事不匹配，请重新配置下一届');
      }
      runtimes.set(entrant.id, { ...entrant.setup });
    }
    if (runtimes.size !== this.entrants.length) {
      throw new ChampionshipConflictError('断点存档缺少模型配置，请重新配置下一届');
    }
    this.runtimes = runtimes;
  }

  /**
   * Rebuild a consistent playable state from a checkpoint:
   * - unfinished group games go back to `scheduled`;
   * - unfinished knockout games are dropped (they were never archived);
   * - series counters, points, overtime/extra flags and outcomes are replayed
   *   from the retained games under the six-game / three-point rules;
   * - the bracket is refilled from the completed group table.
   */
  private normalizeForResume(): void {
    for (const game of this.games) {
      if (game.stage === 'group') {
        if (game.status !== 'finished' && game.status !== 'failed') {
          resetGameForResume(game);
        }
      }
    }

    if (!this.groupStageFinished()) {
      this.games = this.games.filter((game) => game.stage === 'group');
      for (const series of this.series) {
        this.resetSeries(series);
        series.left = null;
        series.right = null;
      }
      this.currentGameIds = [];
      this.currentSeriesIds = [];
      return;
    }

    // Only decided knockout games survive; anything in flight is replayed.
    this.games = this.games.filter(
      (game) =>
        game.stage === 'group' ||
        game.status === 'finished' ||
        game.status === 'failed',
    );

    for (const series of this.series) {
      const games = this.games
        .filter((game) => game.stage !== 'group' && game.seriesId === series.id)
        .sort((left, right) => left.gameIndex - right.gameIndex);
      if (games.length > 0 && (!series.left || !series.right)) {
        throw new ChampionshipConflictError('断点中的系列赛缺少对阵双方');
      }
      this.resetSeries(series);
      for (const game of games) {
        this.recordSeriesGame(series, game);
        this.refreshSeriesOutcome(series, game);
        if (series.status === 'finished') break;
      }
    }

    this.refreshBracket();
    this.currentGameIds = [];
    this.currentSeriesIds = [];
  }

  private resetSeries(series: ChampionshipSeriesView): void {
    series.status = 'pending';
    series.leftWins = 0;
    series.rightWins = 0;
    series.leftPoints = 0;
    series.rightPoints = 0;
    series.draws = 0;
    series.failed = 0;
    series.playedGames = 0;
    series.overtime = false;
    series.extra = false;
    series.winnerModelId = null;
    series.decision = null;
  }

  private deriveStage(): ChampionshipStage {
    if (!this.groupStageFinished()) return 'group';
    const next = this.series.find((series) => series.status !== 'finished');
    return next?.stage ?? 'final';
  }

  private emitState(): void {
    this.revision += 1;
    this.events.emit('state', this.getState());
  }

  private isCurrent(token: number): boolean {
    return !this.disposed && this.phase === 'running' && token === this.runToken;
  }

  private dropRuntimes(): void {
    this.runtimes.clear();
  }

  private findSeries(id: string): ChampionshipSeriesView | undefined {
    return this.series.find((series) => series.id === id);
  }

  /** Read through a helper so mutations inside `refreshSeriesOutcome` widen. */
  private isSeriesFinished(series: ChampionshipSeriesView): boolean {
    return series.status === 'finished';
  }

  private seriesSide(modelId: string): { modelId: string; name: string } {
    const entrant = this.entrants.find((item) => item.id === modelId);
    if (!entrant) throw new Error(`锦标赛无法找到参赛模型 ${modelId}`);
    return { modelId: entrant.id, name: entrant.name };
  }

  private buildGroupView(
    groupId: ChampionshipGroupId,
    groupGames: readonly ChampionshipGameView[],
  ): ChampionshipGroupView {
    const games = groupGames.filter((game) => game.groupId === groupId);
    const members = this.groupMembers[groupId]
      .map((id) => this.memberMeta.get(id))
      .filter((member): member is GroupStandingMember => Boolean(member));
    const standings = computeGroupStandings(members, games);
    const complete =
      games.length === CHAMPIONSHIP_GROUP_GAMES_PER_GROUP &&
      games.every(isDecidedGame);

    return {
      id: groupId,
      entrantIds: [...this.groupMembers[groupId]],
      standings,
      complete,
      qualifiedModelIds: complete ? qualifiedModelIds(standings) : [],
    };
  }

  /** Group rank/points/seed data used for colours and the stage-cap tie-break. */
  private rankingMap(): Map<string, ChampionshipRankingInfo> {
    const ranking = new Map<string, ChampionshipRankingInfo>();
    const groupGames = this.games.filter((game) => game.stage === 'group');

    for (const groupId of CHAMPIONSHIP_GROUPS) {
      const members = this.groupMembers[groupId]
        .map((id) => this.memberMeta.get(id))
        .filter((member): member is GroupStandingMember => Boolean(member));
      const standings = computeGroupStandings(
        members,
        groupGames.filter((game) => game.groupId === groupId),
      );
      for (const row of standings) {
        const meta = this.memberMeta.get(row.modelId);
        ranking.set(row.modelId, {
          modelId: row.modelId,
          rank: row.rank,
          points: row.points,
          wins: row.wins,
          draws: row.draws,
          seedPool: meta?.seedPool ?? 0,
          inputIndex: meta?.inputIndex ?? 0,
        });
      }
    }

    return ranking;
  }

  private groupStageFinished(): boolean {
    const groupGames = this.games.filter((game) => game.stage === 'group');
    return (
      groupGames.length === CHAMPIONSHIP_GROUP_GAMES &&
      groupGames.every(isDecidedGame)
    );
  }

  private refreshBracket(): void {
    if (this.groupStageFinished()) this.fillQuarterfinalSides();
    this.fillLaterRound('sf1', 'qf1', 'qf2');
    this.fillLaterRound('sf2', 'qf3', 'qf4');
    this.fillLaterRound('final', 'sf1', 'sf2');
  }

  private fillQuarterfinalSides(): void {
    const groupGames = this.games.filter((game) => game.stage === 'group');
    const qualifiers = new Map<ChampionshipGroupId, string[]>();
    for (const groupId of CHAMPIONSHIP_GROUPS) {
      const members = this.groupMembers[groupId]
        .map((id) => this.memberMeta.get(id))
        .filter((member): member is GroupStandingMember => Boolean(member));
      const standings = computeGroupStandings(
        members,
        groupGames.filter((game) => game.groupId === groupId),
      );
      qualifiers.set(groupId, qualifiedModelIds(standings));
    }

    const pairs: ReadonlyArray<
      [string, ChampionshipGroupId, number, ChampionshipGroupId, number]
    > = [
      ['qf1', 'A', 0, 'B', 1],
      ['qf2', 'C', 0, 'D', 1],
      ['qf3', 'B', 0, 'A', 1],
      ['qf4', 'D', 0, 'C', 1],
    ];

    for (const [seriesId, leftGroup, leftIndex, rightGroup, rightIndex] of pairs) {
      const series = this.findSeries(seriesId);
      if (!series || series.status !== 'pending' || series.left || series.right) continue;
      const leftId = qualifiers.get(leftGroup)?.[leftIndex];
      const rightId = qualifiers.get(rightGroup)?.[rightIndex];
      if (!leftId || !rightId) {
        throw new Error(`锦标赛无法确定 ${seriesId} 的对阵双方`);
      }
      series.left = this.seriesSide(leftId);
      series.right = this.seriesSide(rightId);
    }
  }

  private fillLaterRound(
    targetId: string,
    leftSourceId: string,
    rightSourceId: string,
  ): void {
    const target = this.findSeries(targetId);
    if (!target || target.status !== 'pending' || target.left || target.right) return;
    const leftSource = this.findSeries(leftSourceId);
    const rightSource = this.findSeries(rightSourceId);
    if (!leftSource || !rightSource) return;
    if (leftSource.status !== 'finished' || !leftSource.winnerModelId) return;
    if (rightSource.status !== 'finished' || !rightSource.winnerModelId) return;
    target.left = this.seriesSide(leftSource.winnerModelId);
    target.right = this.seriesSide(rightSource.winnerModelId);
  }

  private markRemainingCanceled(message: string): void {
    const now = Date.now();
    for (const game of this.games) {
      if (game.status === 'scheduled' || game.status === 'running') {
        game.status = 'canceled';
        game.error = message;
        game.finishedAt ??= now;
        if (game.startedAt !== null) {
          game.durationMs = Math.max(0, game.finishedAt - game.startedAt);
        }
      }
    }
    this.currentGameIds = [];
  }

  private markSeriesStopped(): void {
    for (const series of this.series) {
      if (series.status === 'pending' || series.status === 'running') {
        series.status = 'stopped';
      }
    }
    this.currentSeriesIds = [];
  }

  /**
   * Run up to `this.concurrency` independent tasks. `tasks` in a group batch
   * never share an entrant, so no model receives two simultaneous games.
   */
  private async runBounded<T>(
    tasks: readonly T[],
    token: number,
    run: (task: T) => Promise<void>,
  ): Promise<void> {
    const queue = [...tasks];
    const workers = Math.max(1, Math.min(this.concurrency, queue.length));
    await Promise.all(
      Array.from({ length: workers }, async () => {
        while (this.isCurrent(token) && !this.stopRequested) {
          const task = queue.shift();
          if (task === undefined) return;
          await run(task);
          if (!this.isCurrent(token)) return;
        }
      }),
    );
  }

  /**
   * Group phase. With concurrency 1 keep the historical sequential order;
   * otherwise run three waves of disjoint pairings (1+2, 3+4, 5+6), because
   * the two games in each wave use all four players of every group.
   */
  private async runGroupStage(token: number): Promise<void> {
    const groupGames = this.games.filter((game) => game.stage === 'group');
    const runOne = async (game: ChampionshipGameView): Promise<void> => {
      if (game.status !== 'scheduled') return;
      await this.runGame(game, token);
      if (!this.isCurrent(token)) return;
      this.persistCheckpoint();
    };

    if (this.concurrency <= 1) {
      for (const game of groupGames) {
        if (!this.isCurrent(token) || this.stopRequested) break;
        await runOne(game);
        if (!this.isCurrent(token) || this.stopRequested) break;
      }
      return;
    }

    for (const pairIndexes of [
      [1, 2],
      [3, 4],
      [5, 6],
    ]) {
      if (!this.isCurrent(token) || this.stopRequested) return;
      const wave = groupGames.filter(
        (game) => game.status === 'scheduled' && pairIndexes.includes(game.pairIndex),
      );
      if (wave.length === 0) continue;
      await this.runBounded(wave, token, runOne);
    }
  }

  /**
   * Knockout phase. Series in the same round are independent, so run them
   * concurrently; games inside one series stay sequential because each point
   * changes who is still alive in that series.
   */
  private async runKnockoutStage(token: number): Promise<void> {
    while (this.isCurrent(token) && !this.stopRequested) {
      this.refreshBracket();
      const pending = this.series.filter(
        (series) =>
          series.status === 'pending' && series.left !== null && series.right !== null,
      );
      if (pending.length === 0) return;

      const stage = pending[0]!.stage;
      const batch = pending.filter((series) => series.stage === stage);
      this.stage = stage;
      await this.runBounded(batch, token, (series) => this.runSeries(series, token));
      if (!this.isCurrent(token) || this.stopRequested) return;

      this.refreshBracket();
      this.stage = this.deriveStage();
      this.persistCheckpoint();
      this.emitState();
    }
  }

  private async execute(token: number): Promise<void> {
    // ---- Group phase: all 24 games are already scheduled. -----------------
    await this.runGroupStage(token);

    if (!this.isCurrent(token)) return;

    if (!this.stopRequested) {
      this.refreshBracket();
      this.stage = this.deriveStage();
      this.persistCheckpoint();
      this.emitState();
    }

    // ---- Knockout phase: same-round series may run concurrently. ----------
    await this.runKnockoutStage(token);

    if (!this.isCurrent(token)) return;

    this.currentGameIds = [];
    this.currentSeriesIds = [];

    if (this.stopRequested) {
      this.markRemainingCanceled(CANCELED_MESSAGE);
      this.markSeriesStopped();
      if (this.pauseReason) {
        // Suspended by a quota error: keep the checkpoint and let the user fix
        // the key and press 继续锦标赛. The interrupted game is replayed.
        this.phase = 'paused';
        this.error = this.pauseReason;
        this.finishedAt = null;
        this.persistCheckpoint();
        this.dropRuntimes();
        this.emitState();
        return;
      }
      this.phase = 'stopped';
      this.finishedAt = Date.now();
      this.persistCheckpoint();
      this.archiveRun('stopped');
      this.dropRuntimes();
      this.emitState();
      return;
    }

    const finalSeries = this.findSeries('final');
    if (!finalSeries || finalSeries.status !== 'finished' || !finalSeries.winnerModelId) {
      throw new Error('锦标赛未能在决赛中产生冠军');
    }
    const champion = this.entrants.find(
      (entrant) => entrant.id === finalSeries.winnerModelId,
    );
    this.championModelId = finalSeries.winnerModelId;
    this.championName = champion?.name ?? null;
    this.stage = 'final';
    this.phase = 'finished';
    this.finishedAt = Date.now();
    this.checkpointStore.clear();
    this.checkpointSavedAt = null;
    this.archiveRun('finished');
    this.dropRuntimes();
    this.emitState();
  }

  private async runSeries(
    series: ChampionshipSeriesView,
    token: number,
  ): Promise<void> {
    if (!series.left || !series.right) {
      throw new Error(`锦标赛系列赛 ${series.id} 缺少对阵双方`);
    }

    this.stage = series.stage;
    series.status = 'running';
    if (!this.currentSeriesIds.includes(series.id)) {
      this.currentSeriesIds.push(series.id);
    }
    this.persistCheckpoint();
    this.emitState();

    while (this.isCurrent(token) && !this.stopRequested) {
      const left = series.left;
      const right = series.right;
      if (!left || !right) {
        throw new Error(`锦标赛系列赛 ${series.id} 缺少对阵双方`);
      }

      const game = this.createSeriesGame(series, left, right, series.playedGames + 1);
      this.games.push(game);
      await this.runGame(game, token);
      if (!this.isCurrent(token)) return;
      if (this.stopRequested) break;
      if (game.status !== 'finished' && game.status !== 'failed') break;

      this.recordSeriesGame(series, game);
      this.refreshSeriesOutcome(series, game);
      this.persistCheckpoint();
      if (this.isSeriesFinished(series)) {
        this.currentSeriesIds = this.currentSeriesIds.filter((id) => id !== series.id);
        this.emitState();
        break;
      }
      this.emitState();
    }

    if (this.isCurrent(token) && this.currentSeriesIds.includes(series.id)) {
      this.currentSeriesIds = this.currentSeriesIds.filter((id) => id !== series.id);
      this.emitState();
    }
  }

  private createSeriesGame(
    series: ChampionshipSeriesView,
    left: { modelId: string; name: string },
    right: { modelId: string; name: string },
    gameIndex: number,
  ): ChampionshipGameView {
    const ranking = this.rankingMap();
    const leftInfo = ranking.get(left.modelId);
    const rightInfo = ranking.get(right.modelId);
    const leftIsHigher =
      leftInfo && rightInfo
        ? compareChampionshipRanking(leftInfo, rightInfo) <= 0
        : true;
    // The higher-ranked side is red on odd games; the lower-ranked side on even.
    const redSide =
      gameIndex % 2 === 1
        ? leftIsHigher
          ? left
          : right
        : leftIsHigher
          ? right
          : left;
    const blackSide = redSide.modelId === left.modelId ? right : left;

    return createGameView({
      id: `g${this.games.length + 1}`,
      pairIndex: series.slot,
      gameIndex,
      stage: series.stage,
      groupId: null,
      seriesId: series.id,
      redId: redSide.modelId,
      redName: redSide.name,
      blackId: blackSide.modelId,
      blackName: blackSide.name,
    });
  }

  private recordSeriesGame(
    series: ChampionshipSeriesView,
    game: ChampionshipGameView,
  ): void {
    series.playedGames += 1;
    if (game.status === 'failed') {
      // A failed game is a no-contest: it consumes a game but awards no point.
      series.failed += 1;
      return;
    }
    if (game.status !== 'finished' || !game.result) return;

    if (game.result.winner === null) {
      series.draws += 1;
      series.leftPoints += CHAMPIONSHIP_SERIES_DRAW_POINTS;
      series.rightPoints += CHAMPIONSHIP_SERIES_DRAW_POINTS;
      return;
    }
    const winnerId =
      game.result.winner === 'red' ? game.redModelId : game.blackModelId;
    if (winnerId === series.left?.modelId) {
      series.leftWins += 1;
      series.leftPoints += CHAMPIONSHIP_SERIES_WIN_POINTS;
    } else if (winnerId === series.right?.modelId) {
      series.rightWins += 1;
      series.rightPoints += CHAMPIONSHIP_SERIES_WIN_POINTS;
    }
  }

  /** Model id of the decisive winner of `game`, or null for draws/failures. */
  private decisiveWinnerId(game: ChampionshipGameView | undefined): string | null {
    if (!game || game.status !== 'finished' || !game.result) return null;
    if (game.result.winner === 'red') return game.redModelId;
    if (game.result.winner === 'black') return game.blackModelId;
    return null;
  }

  /**
   * Apply the six-game / three-point series rules after `lastGame` was
   * recorded:
   *
   * 1. overtime (3:3) or extra games: the next decisive game wins;
   * 2. otherwise the first side to reach three points wins immediately;
   *    if both cross the target on the same game the series enters overtime;
   * 3. at the six-game cap an undecided series is decided by group ranking
   *    (rank → points → wins → draws → seed pool, no input order). If those
   *    are exactly equal the series enters extra games with no hard cap.
   */
  private refreshSeriesOutcome(
    series: ChampionshipSeriesView,
    lastGame?: ChampionshipGameView,
  ): void {
    const left = series.left;
    const right = series.right;
    if (!left || !right) return;

    const decisiveWinner = this.decisiveWinnerId(lastGame);
    if ((series.overtime || series.extra) && decisiveWinner) {
      this.finishSeries(series, decisiveWinner, 'overtime');
      return;
    }

    if (!series.overtime && !series.extra) {
      if (
        series.leftPoints >= CHAMPIONSHIP_SERIES_POINTS_TARGET &&
        series.rightPoints >= CHAMPIONSHIP_SERIES_POINTS_TARGET
      ) {
        // Both reached the target on the same game: overtime decides.
        series.overtime = true;
      } else if (series.leftPoints >= CHAMPIONSHIP_SERIES_POINTS_TARGET) {
        this.finishSeries(series, left.modelId, 'points');
        return;
      } else if (series.rightPoints >= CHAMPIONSHIP_SERIES_POINTS_TARGET) {
        this.finishSeries(series, right.modelId, 'points');
        return;
      }
    }

    if (
      !series.extra &&
      series.playedGames >= series.maxGames
    ) {
      const ranking = this.rankingMap();
      const leftInfo = ranking.get(left.modelId);
      const rightInfo = ranking.get(right.modelId);
      const comparison =
        leftInfo && rightInfo
          ? compareChampionshipGroupRanking(leftInfo, rightInfo)
          : 0;
      if (comparison !== 0) {
        this.finishSeries(
          series,
          comparison < 0 ? left.modelId : right.modelId,
          'ranking',
        );
      } else {
        // Identical group pedigree: keep playing until a decisive game.
        series.extra = true;
      }
    }
  }

  private finishSeries(
    series: ChampionshipSeriesView,
    winnerModelId: string,
    decision: ChampionshipSeriesDecision,
  ): void {
    series.status = 'finished';
    series.winnerModelId = winnerModelId;
    series.decision = decision;
    this.refreshBracket();
  }

  private dropActiveGame(gameId: string): void {
    this.currentGameIds = this.currentGameIds.filter((id) => id !== gameId);
  }

  /**
   * Suspend the edition after a provider reports an exhausted quota. In-flight
   * games are canceled and replayed on resume; the checkpoint keeps every
   * decided game plus the runtime setups needed to continue.
   */
  private requestQuotaPause(detail: string): void {
    if (this.pauseReason) return;
    this.pauseReason = detail
      ? `${QUOTA_PAUSED_MESSAGE}（${detail}）`
      : QUOTA_PAUSED_MESSAGE;
    this.stopRequested = true;
    for (const arena of this.activeArenas.values()) {
      arena.dispose();
    }
    this.abortController?.abort();
    this.emitState();
  }

  private async runGame(game: ChampionshipGameView, token: number): Promise<void> {
    if (!this.currentGameIds.includes(game.id)) {
      this.currentGameIds.push(game.id);
    }
    game.status = 'running';
    game.startedAt = Date.now();
    this.emitState();

    let finalState: ArenaState;
    try {
      finalState = await this.playGame(game, this.abortController!.signal);
    } catch (error) {
      if (this.disposed) return;
      if (this.stopRequested || error instanceof ChampionshipAbortedError) {
        game.status = 'canceled';
        game.error = CANCELED_MESSAGE;
      } else {
        game.status = 'failed';
        game.error = FAILED_GAME_MESSAGE;
        game.failedSide = null;
        console.error(
          '[championship] game failed:',
          error instanceof Error ? error.message : error,
        );
      }
      game.finishedAt = Date.now();
      game.durationMs = Math.max(0, game.finishedAt - (game.startedAt ?? game.finishedAt));
      this.dropActiveGame(game.id);
      this.emitState();
      return;
    }

    if (!this.isCurrent(token)) {
      this.dropActiveGame(game.id);
      return;
    }

    this.lastFinishedGameId = game.id;
    this.lastFinalState = finalState;

    // An exhausted quota suspends the whole edition instead of being recorded
    // as a failed game: the key cannot recover by retrying, and the schedule
    // must be re-played from this game once the user tops up or swaps keys.
    if (finalState.phase === 'error' && finalState.error?.quota) {
      game.status = 'canceled';
      game.error = QUOTA_CANCELED_MESSAGE;
      game.failedSide = finalState.error.side;
      game.finishedAt = Date.now();
      game.durationMs = Math.max(0, game.finishedAt - (game.startedAt ?? game.finishedAt));
      this.dropActiveGame(game.id);
      this.requestQuotaPause(finalState.error.message);
      return;
    }

    applyArenaTotals(game, finalState);
    if (finalState.phase === 'finished' && finalState.result) {
      game.status = 'finished';
      game.result = { ...finalState.result };
      game.winnerModelId =
        finalState.result.winner === 'red'
          ? game.redModelId
          : finalState.result.winner === 'black'
            ? game.blackModelId
            : null;
      game.failedSide = null;
      game.error = null;
    } else {
      game.status = 'failed';
      game.winnerModelId = null;
      game.result = null;
      game.failedSide = finalState.error?.side ?? null;
      game.error = finalState.error?.message ?? '对局未正常结束';
    }
    game.finishedAt = Date.now();
    game.durationMs = Math.max(0, game.finishedAt - (game.startedAt ?? game.finishedAt));
    this.dropActiveGame(game.id);
    // Persist the decided game before archiving it. The series counters may
    // still lag here; resume rebuilds them from the game rows, so this ordering
    // cannot duplicate a knockout win after a crash.
    this.persistCheckpoint();
    this.emitState();
    this.notifyGameComplete(game, finalState);
  }

  private notifyGameComplete(
    game: ChampionshipGameView,
    finalState: ArenaState,
  ): void {
    if (!this.onGameComplete || !this.championshipId) return;
    const red = this.entrants.find((entrant) => entrant.id === game.redModelId);
    const black = this.entrants.find((entrant) => entrant.id === game.blackModelId);
    if (!red || !black) return;

    try {
      this.onGameComplete({
        championshipId: this.championshipId,
        game: cloneGame(game),
        finalState,
        red: { ...red },
        black: { ...black },
      });
    } catch (error) {
      console.error(
        '[championship] history callback failed:',
        error instanceof Error ? error.message : error,
      );
    }
  }

  private playGame(
    game: ChampionshipGameView,
    signal: AbortSignal,
  ): Promise<ArenaState> {
    const redSetup = this.runtimes.get(game.redModelId);
    const blackSetup = this.runtimes.get(game.blackModelId);
    if (!redSetup || !blackSetup) {
      return Promise.reject(new Error('模型运行配置丢失'));
    }

    const arena = new Arena({
      providerFactory: this.providerFactory,
      createInitialGame: this.createInitialGame,
    });
    this.activeArenas.set(game.id, arena);

    return new Promise<ArenaState>((resolve, reject) => {
      let settled = false;
      let unsubscribe: (() => void) | null = null;

      const cleanup = (): void => {
        signal.removeEventListener('abort', onAbort);
        unsubscribe?.();
        unsubscribe = null;
      };
      const finish = (state: ArenaState): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(state);
      };
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const onAbort = (): void => {
        arena.dispose();
        fail(new ChampionshipAbortedError());
      };

      unsubscribe = arena.onState((state) => {
        if (settled) return;
        applyArenaTotals(game, state);
        if (state.phase === 'finished' || state.phase === 'error') {
          finish(state);
          return;
        }
        this.emitState();
      });

      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return;
      }

      try {
        arena.start({
          red: redSetup,
          black: blackSetup,
          settings: this.gameSettings,
        });
      } catch (error) {
        arena.dispose();
        fail(error);
      }
    }).finally(() => {
      if (this.activeArenas.get(game.id) === arena) {
        this.activeArenas.delete(game.id);
      }
      arena.dispose();
    });
  }
}
