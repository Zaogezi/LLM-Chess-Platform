import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  ArenaState,
  GameSettings,
  ModelSetup,
  TournamentGameSnapshot,
  TournamentGameView,
  TournamentModelView,
  TournamentPhase,
  TournamentStanding,
  TournamentState,
} from '../../shared/protocol';
import { DEFAULT_THINKING_LEVEL } from '../../shared/protocol';
import { Arena } from '../arena/arena';
import type { ProviderFactory } from '../providers/index';
import { defaultProviderFactory } from '../providers/index';
import { XiangqiGame } from '../xiangqi/index';
import { computeStandings } from './standings';
import type { ValidatedTournamentStart } from './validate';

export interface TournamentGameCompletion {
  tournamentId: string;
  gamesPerPair: number;
  game: TournamentGameView;
  finalState: ArenaState;
  red: TournamentModelView;
  black: TournamentModelView;
}

export interface TournamentOptions {
  providerFactory?: ProviderFactory;
  /** Deterministic positions for tests; production starts from the standard FEN. */
  createInitialGame?: () => XiangqiGame;
  gameSettings?: GameSettings;
  /** Called after a tournament game finishes or fails, for the history archive. */
  onGameComplete?: (completion: TournamentGameCompletion) => void;
}

export class TournamentConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TournamentConflictError';
  }
}

class TournamentAbortedError extends Error {
  constructor() {
    super('评测已终止');
    this.name = 'TournamentAbortedError';
  }
}

const TOURNAMENT_GAME_SETTINGS: GameSettings = {
  moveDelayMs: 0,
  maxAttempts: 3,
};

function emptyGame(
  id: string,
  pairIndex: number,
  gameIndex: number,
  red: TournamentModelView,
  black: TournamentModelView,
): TournamentGameView {
  return {
    id,
    pairIndex,
    gameIndex,
    redModelId: red.id,
    blackModelId: black.id,
    redName: red.name,
    blackName: black.name,
    status: 'scheduled',
    plies: 0,
    winnerModelId: null,
    result: null,
    error: null,
    failedSide: null,
    startedAt: null,
    finishedAt: null,
    durationMs: 0,
    tokensIn: 0,
    tokensOut: 0,
    redTokensIn: 0,
    redTokensOut: 0,
    blackTokensIn: 0,
    blackTokensOut: 0,
  };
}

function scheduleGames(
  models: readonly TournamentModelView[],
  gamesPerPair: number,
): TournamentGameView[] {
  const games: TournamentGameView[] = [];
  let pairIndex = 0;

  for (let first = 0; first < models.length; first += 1) {
    for (let second = first + 1; second < models.length; second += 1) {
      // Colours alternate each game. For odd counts, alternate which pairing
      // gets the extra red game so the overall schedule stays as balanced as
      // possible.
      const firstStartsRed = pairIndex % 2 === 0;
      for (let gameIndex = 0; gameIndex < gamesPerPair; gameIndex += 1) {
        const firstIsRed = (gameIndex % 2 === 0) === firstStartsRed;
        const red = firstIsRed ? models[first] : models[second];
        const black = firstIsRed ? models[second] : models[first];
        games.push(
          emptyGame(
            `g${games.length + 1}`,
            pairIndex + 1,
            gameIndex + 1,
            red,
            black,
          ),
        );
      }
      pairIndex += 1;
    }
  }

  return games;
}

function cloneGame(game: TournamentGameView): TournamentGameView {
  return {
    ...game,
    result: game.result ? { ...game.result } : null,
  };
}

function applyArenaTotals(game: TournamentGameView, state: ArenaState): void {
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

/**
 * Sequential round-robin orchestrator for automated model evaluation. Each
 * game gets an independent Arena (and therefore its own key lifetime); the
 * main spectator arena is never touched. Keys are dropped as soon as the run
 * ends or is stopped.
 */
export class Tournament {
  private readonly providerFactory: ProviderFactory;
  private readonly createInitialGame: () => XiangqiGame;
  private readonly gameSettings: GameSettings;
  private readonly onGameComplete:
    | ((completion: TournamentGameCompletion) => void)
    | undefined;
  private readonly events = new EventEmitter();

  private phase: TournamentPhase = 'idle';
  private revision = 0;
  private tournamentId: string | null = null;
  private models: TournamentModelView[] = [];
  private runtimes = new Map<string, ModelSetup>();
  private games: TournamentGameView[] = [];
  private totalGames = 0;
  private gamesPerPair = 0;
  private currentGameId: string | null = null;
  private error: string | null = null;
  private startedAt: number | null = null;
  private finishedAt: number | null = null;

  private runToken = 0;
  private runPromise: Promise<void> | null = null;
  private abortController: AbortController | null = null;
  private currentArena: Arena | null = null;
  /** Latest game whose board is still kept so the spectator page can show it. */
  private lastFinishedGameId: string | null = null;
  private lastFinalState: ArenaState | null = null;
  private stopRequested = false;
  private disposed = false;

  constructor(options: TournamentOptions = {}) {
    this.providerFactory = options.providerFactory ?? defaultProviderFactory;
    this.createInitialGame = options.createInitialGame ?? (() => XiangqiGame.initial());
    this.gameSettings = options.gameSettings
      ? { ...options.gameSettings }
      : { ...TOURNAMENT_GAME_SETTINGS };
    this.onGameComplete = options.onGameComplete;
    this.events.setMaxListeners(100);
  }

  onState(listener: (state: TournamentState) => void): () => void {
    this.events.on('state', listener);
    return () => this.events.off('state', listener);
  }

  getState(): TournamentState {
    const completedGames = this.games.filter((game) => game.status === 'finished').length;
    const processedGames = this.games.filter(
      (game) =>
        game.status === 'finished' ||
        game.status === 'failed' ||
        game.status === 'canceled',
    ).length;
    const standings: TournamentStanding[] = computeStandings(this.models, this.games);

    return {
      revision: this.revision,
      phase: this.phase,
      tournamentId: this.tournamentId,
      models: this.models.map((model) => ({ ...model })),
      games: this.games.map(cloneGame),
      standings,
      totalGames: this.totalGames,
      processedGames,
      completedGames,
      currentGameId: this.currentGameId,
      gamesPerPair: this.gamesPerPair,
      error: this.error,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
    };
  }

  /**
   * One game plus its current (or latest finished) board. Returns null for an
   * unknown id. The arena is only retained for the running game and the last
   * completed game; older boards live in the history archive instead.
   */
  getGameSnapshot(gameId: string): TournamentGameSnapshot | null {
    const game = this.games.find((candidate) => candidate.id === gameId);
    if (!game) return null;

    const live =
      this.currentGameId === gameId &&
      this.currentArena !== null &&
      game.status === 'running';
    let arena: ArenaState | null = live ? this.currentArena!.getState() : null;
    if (!arena && this.lastFinishedGameId === gameId) {
      arena = this.lastFinalState;
    }

    return { game: cloneGame(game), arena, live };
  }

  start(input: ValidatedTournamentStart): TournamentState {
    if (this.disposed) {
      throw new TournamentConflictError('服务正在关闭，无法启动评测');
    }
    if (this.phase === 'running') {
      throw new TournamentConflictError('已有自动评测正在进行，请先终止当前评测');
    }

    this.runToken += 1;
    const token = this.runToken;
    this.stopRequested = false;
    this.abortController?.abort();
    this.abortController = new AbortController();

    this.models = input.models.map((entrant, index) => {
      const setup = entrant.setup;
      return {
        id: `m${index + 1}`,
        name: entrant.name,
        provider: setup.provider,
        model: setup.model,
        thinkingLevel: setup.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
        apiReasoning: Boolean(setup.apiReasoning),
        promptLevel: setup.promptLevel ?? null,
        maxThinkingTokens: setup.maxThinkingTokens ?? null,
        maxCompletionTokens: setup.maxCompletionTokens ?? null,
        requestTimeoutSeconds: setup.requestTimeoutSeconds ?? null,
        keyConfigured: Boolean(setup.apiKey),
      };
    });
    this.runtimes = new Map(
      this.models.map((model, index) => [model.id, input.models[index]!.setup]),
    );
    this.games = scheduleGames(this.models, input.gamesPerPair);
    this.totalGames = this.games.length;
    this.gamesPerPair = input.gamesPerPair;
    this.currentGameId = null;
    this.lastFinishedGameId = null;
    this.lastFinalState = null;
    this.phase = 'running';
    this.tournamentId = randomUUID();
    this.error = null;
    this.startedAt = Date.now();
    this.finishedAt = null;

    this.emitState();

    this.runPromise = this.execute(token).catch((error: unknown) => {
      if (this.disposed || token !== this.runToken) return;
      this.currentArena?.dispose();
      this.currentArena = null;
      this.markRemainingCanceled('评测内部错误，未完成的对局已取消');
      this.phase = 'error';
      this.error = '评测内部错误，请重新发起评测';
      this.currentGameId = null;
      this.finishedAt = Date.now();
      this.dropRuntimes();
      console.error(
        '[tournament] run failed:',
        error instanceof Error ? error.message : error,
      );
      this.emitState();
    });

    return this.getState();
  }

  async stop(): Promise<TournamentState> {
    if (this.phase !== 'running') {
      throw new TournamentConflictError('当前没有正在运行的自动评测');
    }

    this.stopRequested = true;
    this.abortController?.abort();
    this.currentArena?.dispose();
    await this.runPromise;
    return this.getState();
  }

  dispose(): void {
    this.disposed = true;
    this.runToken += 1;
    this.stopRequested = true;
    this.abortController?.abort();
    this.abortController = null;
    this.currentArena?.dispose();
    this.currentArena = null;
    this.lastFinalState = null;
    this.lastFinishedGameId = null;
    this.runtimes.clear();
    this.events.removeAllListeners();
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
  }

  private async execute(token: number): Promise<void> {
    for (const game of this.games) {
      if (!this.isCurrent(token) || this.stopRequested) break;
      if (game.status !== 'scheduled') continue;

      this.currentGameId = game.id;
      game.status = 'running';
      game.startedAt = Date.now();
      this.emitState();

      let finalState: ArenaState | null = null;
      try {
        finalState = await this.playGame(game, this.abortController!.signal);
      } catch (error) {
        if (this.disposed) return;
        if (this.stopRequested || error instanceof TournamentAbortedError) {
          game.status = 'canceled';
          game.error = '评测提前终止';
        } else {
          game.status = 'failed';
          game.error = '对局执行失败，已跳过该局';
          console.error(
            '[tournament] game failed:',
            error instanceof Error ? error.message : error,
          );
        }
        game.finishedAt = Date.now();
        game.durationMs = Math.max(0, game.finishedAt - (game.startedAt ?? game.finishedAt));
        this.currentGameId = null;
        this.emitState();
        if (this.stopRequested || !this.isCurrent(token)) break;
        continue;
      }

      if (!this.isCurrent(token)) return;

      this.lastFinishedGameId = game.id;
      this.lastFinalState = finalState;
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
        game.failedSide = finalState.error?.side ?? null;
        game.error = finalState.error?.message ?? '对局未正常结束';
      }
      game.finishedAt = Date.now();
      game.durationMs = Math.max(0, game.finishedAt - (game.startedAt ?? game.finishedAt));
      this.currentGameId = null;
      this.emitState();
      this.notifyGameComplete(game, finalState);
    }

    if (!this.isCurrent(token)) return;

    this.currentGameId = null;
    if (this.stopRequested) {
      this.markRemainingCanceled('评测提前终止');
      this.phase = 'stopped';
    } else {
      this.phase = 'finished';
    }
    this.finishedAt = Date.now();
    this.dropRuntimes();
    this.emitState();
  }

  private notifyGameComplete(
    game: TournamentGameView,
    finalState: ArenaState,
  ): void {
    if (!this.onGameComplete || !this.tournamentId) return;
    const red = this.models.find((model) => model.id === game.redModelId);
    const black = this.models.find((model) => model.id === game.blackModelId);
    if (!red || !black) return;

    try {
      this.onGameComplete({
        tournamentId: this.tournamentId,
        gamesPerPair: this.gamesPerPair,
        game: { ...game, result: game.result ? { ...game.result } : null },
        finalState,
        red: { ...red },
        black: { ...black },
      });
    } catch (error) {
      console.error(
        '[tournament] history callback failed:',
        error instanceof Error ? error.message : error,
      );
    }
  }

  private playGame(
    game: TournamentGameView,
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
    this.currentArena = arena;

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
        fail(new TournamentAbortedError());
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
      if (this.currentArena === arena) this.currentArena = null;
      arena.dispose();
    });
  }
}
