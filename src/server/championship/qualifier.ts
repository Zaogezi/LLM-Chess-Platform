import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  ArenaState,
  ChampionshipGameView,
  GameSettings,
  ModelSetup,
  QualifierEntrantView,
  QualifierGameSnapshot,
  QualifierGroupId,
  QualifierGroupView,
  QualifierPhase,
  QualifierState,
} from '../../shared/protocol';
import {
  CHAMPIONSHIP_QUALIFIER_ADVANCE_PER_GROUP,
  CHAMPIONSHIP_QUALIFIER_GROUPS,
  CHAMPIONSHIP_QUALIFIER_GROUP_GAMES,
  CHAMPIONSHIP_QUALIFIER_GROUP_GAMES_PER_GROUP,
  DEFAULT_THINKING_LEVEL,
} from '../../shared/protocol';
import { Arena } from '../arena/arena';
import type { ProviderFactory } from '../providers/index';
import { defaultProviderFactory } from '../providers/index';
import { XiangqiGame } from '../xiangqi/index';
import {
  QualifierCheckpointStore,
  type QualifierCheckpoint,
  type QualifierCheckpointPhase,
} from './qualifierCheckpoint';
import {
  buildQualifierGames,
  QUALIFIER_ROUND_COUNT,
  qualifierRoundOf,
  type QualifierGroupSchedule,
} from './qualifierSchedule';
import {
  computeGroupStandings,
  qualifiedModelIds,
  type GroupStandingMember,
} from './standings';
import type { ValidatedQualifierStart } from './qualifierValidate';

export interface QualifierGameCompletion {
  qualifierId: string;
  game: ChampionshipGameView;
  finalState: ArenaState;
  red: QualifierEntrantView;
  black: QualifierEntrantView;
}

export interface QualifierOptions {
  providerFactory?: ProviderFactory;
  /** Deterministic positions for tests; production starts from the standard FEN. */
  createInitialGame?: () => XiangqiGame;
  gameSettings?: GameSettings;
  /** Called after a qualifying game finishes or fails, for the history archive. */
  onGameComplete?: (completion: QualifierGameCompletion) => void;
  /**
   * Resumable checkpoint persistence. Defaults to an in-memory store; the
   * production server injects a store backed by `data/qualifier.json`.
   */
  checkpointStore?: QualifierCheckpointStore;
}

export class QualifierConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QualifierConflictError';
  }
}

class QualifierAbortedError extends Error {
  constructor() {
    super('入围赛已终止');
    this.name = 'QualifierAbortedError';
  }
}

const QUALIFIER_GAME_SETTINGS: GameSettings = {
  moveDelayMs: 0,
  maxAttempts: 3,
};

const CANCELED_MESSAGE = '入围赛提前终止';
const FAILED_GAME_MESSAGE = '对局执行失败，已跳过该局';
/** The suspended game is replayed after the quota problem is fixed. */
const QUOTA_CANCELED_MESSAGE = '模型 API 额度不足，恢复后重赛';
const QUOTA_PAUSED_MESSAGE =
  '模型 API 额度不足，入围赛已暂停。请为相关模型充值或更换 API Key 后点击「继续入围赛」恢复比赛';
const INTERNAL_ERROR_MESSAGE = '入围赛内部错误，可继续入围赛或重新发起';

function isProcessedGame(game: ChampionshipGameView): boolean {
  return (
    game.status === 'finished' ||
    game.status === 'failed' ||
    game.status === 'canceled'
  );
}

/** A group is only complete when every game reached a verdict (not canceled). */
function isDecidedGame(game: ChampionshipGameView): boolean {
  return game.status === 'finished' || game.status === 'failed';
}

function cloneGame(game: ChampionshipGameView): ChampionshipGameView {
  return {
    ...game,
    result: game.result ? { ...game.result } : null,
  };
}

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

function emptyGroupMembers(): Record<QualifierGroupId, string[]> {
  return { A: [], B: [] };
}

/**
 * Qualifying round orchestrator: ten models split into two groups of five,
 * single round-robin in each group (20 games). The top two of every group fill
 * the fourth seed pool of the main 16-entrant championship; the main draw and
 * championship remain separate, independently resumable runs.
 *
 * Every game gets its own Arena; API keys live only in the private runtime map
 * and are dropped at finish, stop or error. A checkpoint lets a stopped or
 * power-cut qualifying round continue without replaying decided games.
 */
export class Qualifier {
  private readonly providerFactory: ProviderFactory;
  private readonly createInitialGame: () => XiangqiGame;
  private readonly gameSettings: GameSettings;
  private readonly onGameComplete:
    | ((completion: QualifierGameCompletion) => void)
    | undefined;
  private readonly checkpointStore: QualifierCheckpointStore;
  private readonly events = new EventEmitter();

  private phase: QualifierPhase = 'idle';
  private revision = 0;
  private qualifierId: string | null = null;
  private entrants: QualifierEntrantView[] = [];
  private memberMeta = new Map<string, GroupStandingMember>();
  private groupMembers: Record<QualifierGroupId, string[]> = emptyGroupMembers();
  private runtimes = new Map<string, ModelSetup>();
  private games: ChampionshipGameView[] = [];
  private currentGameIds: string[] = [];
  private concurrency = 1;
  private error: string | null = null;
  private startedAt: number | null = null;
  private finishedAt: number | null = null;
  private checkpointSavedAt: number | null = null;

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

  constructor(options: QualifierOptions = {}) {
    this.providerFactory = options.providerFactory ?? defaultProviderFactory;
    this.createInitialGame = options.createInitialGame ?? (() => XiangqiGame.initial());
    this.gameSettings = options.gameSettings
      ? { ...options.gameSettings }
      : { ...QUALIFIER_GAME_SETTINGS };
    this.onGameComplete = options.onGameComplete;
    this.checkpointStore =
      options.checkpointStore ?? new QualifierCheckpointStore({ filePath: null });
    this.events.setMaxListeners(100);
    this.restoreCheckpointOnBoot();
  }

  onState(listener: (state: QualifierState) => void): () => void {
    this.events.on('state', listener);
    return () => this.events.off('state', listener);
  }

  getState(): QualifierState {
    const games = this.games.filter((game) => game.stage === 'qualifier');
    const configured = this.entrants.length > 0;
    const groups = configured
      ? CHAMPIONSHIP_QUALIFIER_GROUPS.map((groupId) => this.buildGroupView(groupId))
      : [];
    const allComplete =
      groups.length === CHAMPIONSHIP_QUALIFIER_GROUPS.length &&
      groups.every((group) => group.complete);
    const qualified: string[] = [];
    if (allComplete) {
      const groupA = groups.find((group) => group.id === 'A')?.qualifiedModelIds ?? [];
      const groupB = groups.find((group) => group.id === 'B')?.qualifiedModelIds ?? [];
      // Group winners first, then the runners-up: A1, B1, A2, B2.
      for (const rank of [0, 1]) {
        const left = groupA[rank];
        const right = groupB[rank];
        if (left) qualified.push(left);
        if (right) qualified.push(right);
      }
    }

    return {
      revision: this.revision,
      phase: this.phase,
      qualifierId: this.qualifierId,
      entrants: this.entrants.map((entrant) => ({ ...entrant })),
      groups,
      games: this.games.map(cloneGame),
      groupGamesTotal: CHAMPIONSHIP_QUALIFIER_GROUP_GAMES,
      groupGamesProcessed: games.filter(isProcessedGame).length,
      processedGames: this.games.filter(isProcessedGame).length,
      completedGames: this.games.filter((game) => game.status === 'finished').length,
      currentGameIds: [...this.currentGameIds],
      concurrency: this.concurrency,
      qualifiedModelIds: qualified,
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
  getGameSnapshot(gameId: string): QualifierGameSnapshot | null {
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

  start(input: ValidatedQualifierStart): QualifierState {
    if (this.disposed) {
      throw new QualifierConflictError('服务正在关闭，无法启动入围赛');
    }
    if (this.phase === 'running') {
      throw new QualifierConflictError('已有入围赛正在进行，请先终止当前入围赛');
    }

    const indexByName = new Map(
      input.entrants.map((entrant, index) => [
        entrant.name.toLocaleLowerCase(),
        index,
      ]),
    );
    const groupIdByEntrant = new Map<string, QualifierGroupId>();
    const groupMembers = emptyGroupMembers();
    for (const group of input.groups) {
      const ids: string[] = [];
      for (const name of group.entrantNames) {
        const index = indexByName.get(name.toLocaleLowerCase());
        if (index === undefined) {
          throw new Error(`入围赛分组包含未知参赛模型：${name}`);
        }
        const id = `m${index + 1}`;
        ids.push(id);
        groupIdByEntrant.set(id, group.id);
      }
      groupMembers[group.id] = ids;
    }

    const entrantViews: QualifierEntrantView[] = [];
    const memberMeta = new Map<string, GroupStandingMember>();
    const runtimes = new Map<string, ModelSetup>();
    input.entrants.forEach((entrant, index) => {
      const id = `m${index + 1}`;
      const groupId = groupIdByEntrant.get(id);
      if (!groupId) {
        throw new Error(`参赛模型 ${entrant.name} 未分配到任何入围赛分组`);
      }
      entrantViews.push({
        id,
        name: entrant.name,
        provider: entrant.setup.provider,
        model: entrant.setup.model,
        thinkingLevel: entrant.setup.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
        apiReasoning: Boolean(entrant.setup.apiReasoning),
        keyConfigured: Boolean(entrant.setup.apiKey),
        groupId,
      });
      memberMeta.set(id, {
        id,
        name: entrant.name,
        // Qualifying entrants all compete for seed pool 4; seat order breaks ties.
        seedPool: 4,
        inputIndex: index,
      });
      runtimes.set(id, entrant.setup);
    });

    const schedules: QualifierGroupSchedule[] = CHAMPIONSHIP_QUALIFIER_GROUPS.map(
      (groupId) => ({
        id: groupId,
        members: groupMembers[groupId].map((entrantId) => {
          const member = memberMeta.get(entrantId);
          if (!member) throw new Error(`参赛模型 ${entrantId} 缺少分组信息`);
          return { id: member.id, name: member.name };
        }),
      }),
    );

    this.runToken += 1;
    const token = this.runToken;
    this.stopRequested = false;
    this.abortController?.abort();
    this.abortController = new AbortController();

    this.entrants = entrantViews;
    this.memberMeta = memberMeta;
    this.groupMembers = groupMembers;
    this.runtimes = runtimes;
    this.games = buildQualifierGames(schedules);
    this.phase = 'running';
    this.qualifierId = randomUUID();
    this.error = null;
    this.pauseReason = null;
    this.startedAt = Date.now();
    this.finishedAt = null;
    this.concurrency = input.concurrency;
    this.currentGameIds = [];
    this.lastFinishedGameId = null;
    this.lastFinalState = null;
    this.checkpointSavedAt = null;

    this.persistCheckpoint();
    this.emitState();
    this.launch(token);

    return this.getState();
  }

  /**
   * Continue a stopped/error/interrupted run from its last checkpoint. The
   * in-flight game (if any) was never archived, so it is replayed from move 1;
   * every completed qualifying game keeps its result.
   */
  resume(): QualifierState {
    if (this.disposed) {
      throw new QualifierConflictError('服务正在关闭，无法继续入围赛');
    }
    if (
      this.phase !== 'stopped' &&
      this.phase !== 'error' &&
      this.phase !== 'paused' &&
      this.phase !== 'interrupted'
    ) {
      throw new QualifierConflictError('当前没有可继续的入围赛');
    }
    if (!this.qualifierId || this.entrants.length === 0) {
      throw new QualifierConflictError('没有可恢复的入围赛断点');
    }

    if (this.runtimes.size === 0) {
      const saved = this.checkpointStore.load();
      if (!saved) {
        throw new QualifierConflictError('入围赛断点存档不可用，请重新发起入围赛');
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
    this.lastFinishedGameId = null;
    this.lastFinalState = null;

    this.persistCheckpoint();
    this.emitState();
    this.launch(token);
    return this.getState();
  }

  async stop(): Promise<QualifierState> {
    if (this.phase !== 'running') {
      throw new QualifierConflictError('当前没有正在运行的入围赛');
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
    this.markRemainingCanceled('入围赛内部错误，未完成的对局已取消');
    this.phase = 'error';
    this.error = INTERNAL_ERROR_MESSAGE;
    this.currentGameIds = [];
    this.finishedAt = Date.now();
    this.persistCheckpoint();
    this.dropRuntimes();
    console.error(
      '[qualifier] run failed:',
      error instanceof Error ? error.message : error,
    );
    this.emitState();
  }

  private persistCheckpoint(): void {
    const phase = this.phase;
    if (!this.qualifierId || this.entrants.length === 0 || phase === 'idle') {
      return;
    }
    if (this.runtimes.size !== this.entrants.length) {
      console.error('[qualifier] skipped checkpoint: runtime setups are unavailable');
      return;
    }

    const savedAt = Date.now();
    const entrants: QualifierCheckpoint['entrants'] = [];
    for (const entrant of this.entrants) {
      const setup = this.runtimes.get(entrant.id);
      if (!setup) {
        console.error('[qualifier] skipped checkpoint: missing runtime setup');
        return;
      }
      entrants.push({
        id: entrant.id,
        name: entrant.name,
        groupId: entrant.groupId,
        setup: { ...setup, displayName: entrant.name },
      });
    }

    const checkpoint: QualifierCheckpoint = {
      version: 1,
      savedAt,
      qualifierId: this.qualifierId,
      phase: phase as QualifierCheckpointPhase,
      startedAt: this.startedAt ?? savedAt,
      finishedAt: this.finishedAt,
      error: this.error,
      entrants,
      games: this.games.map(cloneGame),
      concurrency: this.concurrency,
    };

    if (this.checkpointStore.save(checkpoint)) {
      this.checkpointSavedAt = savedAt;
    }
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
        '[qualifier] failed to restore checkpoint:',
        error instanceof Error ? error.message : error,
      );
      this.entrants = [];
      this.memberMeta.clear();
      this.groupMembers = emptyGroupMembers();
      this.runtimes.clear();
      this.games = [];
      this.qualifierId = null;
      this.phase = 'idle';
      this.startedAt = null;
      this.finishedAt = null;
      this.error = null;
      this.checkpointSavedAt = null;
    }
  }

  private applyCheckpoint(
    checkpoint: QualifierCheckpoint,
    phase: QualifierCheckpointPhase,
  ): void {
    const entrants: QualifierEntrantView[] = checkpoint.entrants.map((entrant) => ({
      id: entrant.id,
      name: entrant.name,
      provider: entrant.setup.provider,
      model: entrant.setup.model,
      thinkingLevel: entrant.setup.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
      apiReasoning: Boolean(entrant.setup.apiReasoning),
      keyConfigured: Boolean(entrant.setup.apiKey),
      groupId: entrant.groupId,
    }));
    const memberMeta = new Map<string, GroupStandingMember>();
    const groupMembers = emptyGroupMembers();
    checkpoint.entrants.forEach((entrant, index) => {
      memberMeta.set(entrant.id, {
        id: entrant.id,
        name: entrant.name,
        seedPool: 4,
        inputIndex: index,
      });
      groupMembers[entrant.groupId].push(entrant.id);
    });

    this.entrants = entrants;
    this.memberMeta = memberMeta;
    this.groupMembers = groupMembers;
    // Keep secrets out of memory until the user actually resumes.
    this.runtimes = new Map();
    this.games = checkpoint.games.map(cloneGame);
    this.qualifierId = checkpoint.qualifierId;
    this.startedAt = checkpoint.startedAt;
    this.finishedAt = checkpoint.finishedAt;
    this.error = checkpoint.error;
    this.checkpointSavedAt = checkpoint.savedAt;
    this.concurrency = checkpoint.concurrency ?? 1;
    this.currentGameIds = [];
    this.phase = phase;
  }

  private restoreRuntimes(checkpoint: QualifierCheckpoint): void {
    if (checkpoint.entrants.length !== this.entrants.length) {
      throw new QualifierConflictError('断点存档与当前入围赛不匹配，请重新发起入围赛');
    }
    const knownIds = new Set(this.entrants.map((entrant) => entrant.id));
    const runtimes = new Map<string, ModelSetup>();
    for (const entrant of checkpoint.entrants) {
      if (!knownIds.has(entrant.id)) {
        throw new QualifierConflictError('断点存档与当前入围赛不匹配，请重新发起入围赛');
      }
      runtimes.set(entrant.id, { ...entrant.setup });
    }
    if (runtimes.size !== this.entrants.length) {
      throw new QualifierConflictError('断点存档缺少模型配置，请重新发起入围赛');
    }
    this.runtimes = runtimes;
  }

  /**
   * Rebuild a consistent playable state from a checkpoint: unfinished games go
   * back to `scheduled` so they are replayed; decided games are kept.
   */
  private normalizeForResume(): void {
    for (const game of this.games) {
      if (game.status !== 'finished' && game.status !== 'failed') {
        resetGameForResume(game);
      }
    }
    this.currentGameIds = [];
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

  private buildGroupView(groupId: QualifierGroupId): QualifierGroupView {
    const games = this.games.filter(
      (game) => game.stage === 'qualifier' && game.groupId === groupId,
    );
    const members = this.groupMembers[groupId]
      .map((id) => this.memberMeta.get(id))
      .filter((member): member is GroupStandingMember => Boolean(member));
    const standings = computeGroupStandings(members, games);
    const complete =
      games.length === CHAMPIONSHIP_QUALIFIER_GROUP_GAMES_PER_GROUP &&
      games.every(isDecidedGame);

    return {
      id: groupId,
      entrantIds: [...this.groupMembers[groupId]],
      standings,
      complete,
      qualifiedModelIds: complete
        ? qualifiedModelIds(standings, CHAMPIONSHIP_QUALIFIER_ADVANCE_PER_GROUP)
        : [],
    };
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

  /**
   * Run up to `this.concurrency` independent games. Games inside a wave never
   * share an entrant (two games per group, one bye each).
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
   * Six-way wave scheduling: round 1…5 of both groups contains four games that
   * use eight different models, so they may run at the same time.
   */
  private async runQualifierStage(token: number): Promise<void> {
    const qualifierGames = this.games.filter((game) => game.stage === 'qualifier');
    const runOne = async (game: ChampionshipGameView): Promise<void> => {
      if (game.status !== 'scheduled') return;
      await this.runGame(game, token);
      if (!this.isCurrent(token)) return;
      this.persistCheckpoint();
    };

    for (let round = 1; round <= QUALIFIER_ROUND_COUNT; round += 1) {
      if (!this.isCurrent(token) || this.stopRequested) return;
      const wave = qualifierGames.filter(
        (game) => game.status === 'scheduled' && qualifierRoundOf(game) === round,
      );
      if (wave.length === 0) continue;
      await this.runBounded(wave, token, runOne);
    }
  }

  private async execute(token: number): Promise<void> {
    await this.runQualifierStage(token);

    if (!this.isCurrent(token)) return;

    this.currentGameIds = [];

    if (this.stopRequested) {
      this.markRemainingCanceled(CANCELED_MESSAGE);
      if (this.pauseReason) {
        // Suspended by a quota error: keep the checkpoint so the user can top
        // up the key and press 继续入围赛. The interrupted game is replayed.
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
      this.dropRuntimes();
      this.emitState();
      return;
    }

    const state = this.getState();
    if (state.qualifiedModelIds.length === 0) {
      throw new Error('入围赛未能在两个小组中产生晋级模型');
    }

    this.phase = 'finished';
    this.finishedAt = Date.now();
    this.persistFinishedCheckpoint();
    this.dropRuntimes();
    this.emitState();
  }

  /**
   * Persist the completed qualifying table so the main-event draw still works
   * after an app restart. Runtime setups are redacted because a finished round
   * never resumes: the local file must not retain API keys.
   */
  private persistFinishedCheckpoint(): void {
    const runtimes = this.runtimes;
    this.runtimes = new Map<string, ModelSetup>(
      [...runtimes].map(([id, setup]) => [id, { ...setup, apiKey: '' }]),
    );
    try {
      this.persistCheckpoint();
    } finally {
      this.runtimes = runtimes;
    }
  }

  private dropActiveGame(gameId: string): void {
    this.currentGameIds = this.currentGameIds.filter((id) => id !== gameId);
  }

  /**
   * Suspend the qualifying round after a provider reports an exhausted quota.
   * In-flight games are canceled and replayed on resume; the checkpoint keeps
   * every decided game plus the runtime setups needed to continue.
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
      if (this.stopRequested || error instanceof QualifierAbortedError) {
        game.status = 'canceled';
        game.error = CANCELED_MESSAGE;
      } else {
        game.status = 'failed';
        game.error = FAILED_GAME_MESSAGE;
        game.failedSide = null;
        console.error(
          '[qualifier] game failed:',
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

    // An exhausted quota suspends the qualifying round instead of being
    // recorded as a failed game; the interrupted game is replayed on resume.
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
    // Persist the decided game before emitting/archiving it, so a crash
    // between the history write and the next checkpoint cannot duplicate a
    // qualifying game on resume.
    this.persistCheckpoint();
    this.emitState();
    this.notifyGameComplete(game, finalState);
  }

  private notifyGameComplete(
    game: ChampionshipGameView,
    finalState: ArenaState,
  ): void {
    if (!this.onGameComplete || !this.qualifierId) return;
    const red = this.entrants.find((entrant) => entrant.id === game.redModelId);
    const black = this.entrants.find((entrant) => entrant.id === game.blackModelId);
    if (!red || !black) return;

    try {
      this.onGameComplete({
        qualifierId: this.qualifierId,
        game: cloneGame(game),
        finalState,
        red: { ...red },
        black: { ...black },
      });
    } catch (error) {
      console.error(
        '[qualifier] history callback failed:',
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
        fail(new QualifierAbortedError());
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
