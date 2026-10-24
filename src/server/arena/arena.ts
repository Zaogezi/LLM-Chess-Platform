import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  ArenaError,
  ArenaState,
  GameResult,
  GameSettings,
  ModelSetup,
  ModelView,
  MoveView,
  Phase,
  ResultReason,
  Side,
} from '../../shared/protocol';
import { DEFAULT_SETTINGS, DEFAULT_THINKING_LEVEL } from '../../shared/protocol';
import {
  ProviderError,
  defaultProviderFactory,
  type ConversationMessage,
  type ModelProvider,
  type ProviderFactory,
  type ProviderReply,
} from '../providers/index';
import { redactSecrets } from '../providers/http';
import {
  IllegalMoveError,
  XiangqiGame,
  type EngineMove,
  type GameOutcome,
} from '../xiangqi/index';
import { otherSide, pieceName, sideName } from './labels';
import { DecisionParseError, parseDecision } from './parse';
import {
  buildCorrection,
  buildSystemPrompt,
  buildUserPrompt,
  type PromptContext,
} from './prompt';

interface SideRuntime {
  setup: ModelSetup;
  provider: ModelProvider;
}

export interface ArenaCompletion {
  state: ArenaState;
  startedAt: number;
  endedAt: number;
}

export interface ArenaOptions {
  providerFactory?: ProviderFactory;
  /**
   * Injection point for deterministic tests/scenarios. The HTTP application
   * always uses the standard starting position.
   */
  createInitialGame?: () => XiangqiGame;
  /** Called once when a game reaches a finished state, for the history archive. */
  onGameComplete?: (completion: ArenaCompletion) => void;
}

export class ArenaConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArenaConflictError';
  }
}

export interface StartInput {
  red: ModelSetup;
  black: ModelSetup;
  settings?: GameSettings;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function ucciFromIndex(index: number): string {
  const row = Math.floor(index / 9);
  const col = index % 9;
  return `${String.fromCharCode(97 + col)}${row}`;
}

/**
 * Single-match arena. All secrets live in `runtimes`; they are dropped as soon
 * as a game finishes or is reset, and never enter `getState()`.
 */
export class Arena {
  private readonly providerFactory: ProviderFactory;
  private readonly createInitialGame: () => XiangqiGame;
  private readonly onGameComplete: ((completion: ArenaCompletion) => void) | undefined;
  private readonly events = new EventEmitter();

  private phase: Phase = 'idle';
  private revision = 0;
  private matchId: string | null = null;
  private game: XiangqiGame = XiangqiGame.initial();
  private moves: MoveView[] = [];
  private result: GameResult | null = null;
  private errorState: ArenaError | null = null;
  private lastMove: ArenaState['lastMove'] = null;
  private settings: GameSettings = { ...DEFAULT_SETTINGS };
  private models: Record<Side, ModelView | null> = { red: null, black: null };
  private runtimes: Record<Side, SideRuntime | null> = { red: null, black: null };

  private turnSeq = 0;
  private turnActive = false;
  private turnController: AbortController | null = null;
  private gameStartedAt: number | null = null;
  private disposed = false;

  constructor(options: ArenaOptions = {}) {
    this.providerFactory = options.providerFactory ?? defaultProviderFactory;
    this.createInitialGame = options.createInitialGame ?? (() => XiangqiGame.initial());
    this.onGameComplete = options.onGameComplete;
    this.events.setMaxListeners(100);
  }

  onState(listener: (state: ArenaState) => void): () => void {
    this.events.on('state', listener);
    return () => this.events.off('state', listener);
  }

  getState(): ArenaState {
    return {
      revision: this.revision,
      phase: this.phase,
      matchId: this.matchId,
      fen: this.game.fen,
      board: this.game.board,
      turn: this.game.sideToMove,
      moveNumber: this.game.moveNumber,
      ply: this.game.ply,
      checked: this.game.checked,
      lastMove: this.lastMove ? { ...this.lastMove } : null,
      moves: this.moves.map((move) => ({ ...move })),
      models: {
        red: this.models.red ? { ...this.models.red } : null,
        black: this.models.black ? { ...this.models.black } : null,
      },
      result: this.result ? { ...this.result } : null,
      error: this.errorState ? { ...this.errorState } : null,
      settings: { ...this.settings },
    };
  }

  start(input: StartInput): ArenaState {
    if (this.phase !== 'idle' && this.phase !== 'finished') {
      throw new ArenaConflictError('当前对局尚未结束，请先暂停后重置，或继续对局');
    }

    const runtimes: Record<Side, SideRuntime> = {
      red: {
        setup: input.red,
        provider: this.providerFactory(input.red.provider),
      },
      black: {
        setup: input.black,
        provider: this.providerFactory(input.black.provider),
      },
    };

    this.turnSeq += 1;
    this.turnActive = false;
    this.turnController?.abort();
    this.turnController = null;

    this.phase = 'running';
    this.game = this.createInitialGame();
    this.moves = [];
    this.result = null;
    this.errorState = null;
    this.lastMove = null;
    this.matchId = randomUUID();
    this.gameStartedAt = Date.now();
    this.settings = input.settings ? { ...input.settings } : { ...DEFAULT_SETTINGS };
    this.runtimes = runtimes;
    this.models = {
      red: this.createPublicModel(input.red),
      black: this.createPublicModel(input.black),
    };

    this.emitState();
    this.startTurn();
    return this.getState();
  }

  pause(): ArenaState {
    if (this.phase !== 'running') {
      throw new ArenaConflictError('当前对局不在进行中');
    }
    this.phase = 'paused';
    this.turnSeq += 1;
    this.turnActive = false;
    this.turnController?.abort();
    this.turnController = null;
    this.setThinking(false);
    this.emitState();
    return this.getState();
  }

  resume(): ArenaState {
    if (this.phase !== 'paused') {
      throw new ArenaConflictError('只有暂停中的对局可以继续');
    }
    this.phase = 'running';
    this.errorState = null;
    this.emitState();
    this.startTurn();
    return this.getState();
  }

  retry(): ArenaState {
    if (this.phase !== 'error') {
      throw new ArenaConflictError('只有出错的对局可以重试本回合');
    }
    this.phase = 'running';
    this.errorState = null;
    this.turnActive = false;
    this.turnController = null;
    this.emitState();
    this.startTurn();
    return this.getState();
  }

  reset(): ArenaState {
    this.turnSeq += 1;
    this.turnActive = false;
    this.turnController?.abort();
    this.turnController = null;

    this.phase = 'idle';
    this.matchId = null;
    this.gameStartedAt = null;
    this.game = this.createInitialGame();
    this.moves = [];
    this.result = null;
    this.errorState = null;
    this.lastMove = null;
    this.models = { red: null, black: null };
    this.runtimes = { red: null, black: null };

    this.emitState();
    return this.getState();
  }

  dispose(): void {
    this.disposed = true;
    this.turnSeq += 1;
    this.turnActive = false;
    this.turnController?.abort();
    this.turnController = null;
    this.runtimes = { red: null, black: null };
    this.events.removeAllListeners();
  }

  private createPublicModel(setup: ModelSetup): ModelView {
    return {
      provider: setup.provider,
      model: setup.model,
      displayName: setup.displayName?.trim() || setup.model,
      thinkingLevel: setup.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
      requestTimeoutSeconds: setup.requestTimeoutSeconds ?? null,
      apiReasoning: Boolean(setup.apiReasoning),
      keyConfigured: Boolean(setup.apiKey),
      thinking: false,
      thinkingSince: null,
      lastLatencyMs: null,
      reason: null,
      totalTokensIn: 0,
      totalTokensOut: 0,
      attempts: 0,
      lastError: null,
    };
  }

  private emitState(): void {
    this.revision += 1;
    this.events.emit('state', this.getState());
  }

  private isCurrent(seq: number): boolean {
    return this.phase === 'running' && this.turnSeq === seq && !this.disposed;
  }

  private setThinking(thinking: boolean): void {
    for (const side of ['red', 'black'] as const) {
      const view = this.models[side];
      if (!view) continue;
      view.thinking = thinking && this.game.sideToMove === side;
      if (!view.thinking) view.thinkingSince = null;
    }
  }

  private startTurn(): void {
    if (this.disposed || this.phase !== 'running' || this.turnActive) return;

    const side = this.game.sideToMove;
    const runtime = this.runtimes[side];
    const view = this.models[side];
    if (!runtime || !view) {
      this.failTurn(side, '模型运行配置丢失，请重置对局');
      return;
    }

    const existingOutcome = this.game.outcome();
    if (existingOutcome) {
      this.finishGame(existingOutcome);
      return;
    }

    this.turnActive = true;
    this.turnSeq += 1;
    const seq = this.turnSeq;
    const controller = new AbortController();
    this.turnController = controller;

    view.thinking = true;
    view.thinkingSince = Date.now();
    view.attempts = 0;
    view.lastError = null;
    this.emitState();

    void this.runTurn(seq, side, controller.signal)
      .catch((error: unknown) => {
        if (!this.isCurrent(seq)) return;
        this.failTurn(
          side,
          `对局内部错误：${error instanceof Error ? error.message : '未知错误'}`,
        );
      })
      .finally(() => {
        if (this.turnSeq === seq) {
          this.turnActive = false;
          this.turnController = null;
        }
      });
  }

  private async runTurn(seq: number, side: Side, signal: AbortSignal): Promise<void> {
    const runtime = this.runtimes[side];
    const view = this.models[side];
    if (!runtime || !view) return;

    const legalMoves = this.game.legalMoves();
    if (legalMoves.length === 0) {
      const outcome = this.game.outcome();
      if (outcome) this.finishGame(outcome);
      return;
    }

    const context: PromptContext = {
      side,
      fen: this.game.fen,
      board: this.game.board,
      moveNumber: this.game.moveNumber,
      ply: this.game.ply,
      checked: this.game.checked,
      legalMoves,
      recentMoves: this.moves.slice(-20).map((move) => ({
        side: move.side,
        ucci: move.ucci,
        notation: move.notation,
      })),
    };

    const thinkingLevel = runtime.setup.thinkingLevel ?? DEFAULT_THINKING_LEVEL;
    const system = buildSystemPrompt(side, thinkingLevel);
    const messages: ConversationMessage[] = [
      { role: 'user', content: buildUserPrompt(context, thinkingLevel) },
    ];

    for (let attempt = 1; attempt <= this.settings.maxAttempts; attempt += 1) {
      if (!this.isCurrent(seq)) return;

      view.thinking = true;
      view.thinkingSince ??= Date.now();
      view.attempts = attempt;
      view.lastError = null;
      this.emitState();

      const startedAt = Date.now();
      let reply: ProviderReply;
      try {
        reply = await runtime.provider.complete(runtime.setup, { system, messages }, signal);
      } catch (error) {
        if (signal.aborted || !this.isCurrent(seq)) return;
        const message = this.describeError(error, runtime.setup);
        view.lastError = message;

        // A model that exceeds the per-step wait limit loses immediately: no
        // retry and no error state, so tournaments count a normal win/loss.
        if (error instanceof ProviderError && error.timeout) {
          this.forfeitTurn(side, message, 'timeout');
          return;
        }

        // An exhausted quota is not the game's result: surface it so the
        // scheduler can suspend the competition until the key is usable again.
        if (error instanceof ProviderError && error.quotaExceeded) {
          this.failTurn(side, message, true);
          return;
        }

        const retryable = error instanceof ProviderError ? error.retryable : false;

        if (retryable && attempt < this.settings.maxAttempts) {
          this.emitState();
          await sleep(550 * attempt, signal);
          if (!this.isCurrent(seq)) return;
          continue;
        }

        this.failTurn(side, message);
        return;
      }

      if (!this.isCurrent(seq)) return;

      view.totalTokensIn += reply.tokensIn;
      view.totalTokensOut += reply.tokensOut;

      let decision: ReturnType<typeof parseDecision>;
      try {
        decision = parseDecision(reply.text);
      } catch (error) {
        const problem =
          error instanceof DecisionParseError ? error.message : '响应无法解析为合法着法';
        view.lastError = problem;

        if (attempt < this.settings.maxAttempts) {
          messages.push({
            role: 'assistant',
            content: truncate(reply.text.trim(), 1200) || '（空响应）',
          });
          messages.push({ role: 'user', content: buildCorrection(problem, legalMoves, thinkingLevel) });
          this.emitState();
          await sleep(150, signal);
          if (!this.isCurrent(seq)) return;
          continue;
        }

        this.forfeitTurn(
          side,
          `连续 ${this.settings.maxAttempts} 次未给出可解析的着法：${problem}`,
        );
        return;
      }

      const engineMove = this.game.findLegalMove(decision.move);
      if (!engineMove) {
        const problem = `着法 ${decision.move} 不在当前合法着法列表中`;
        view.lastError = problem;

        if (attempt < this.settings.maxAttempts) {
          messages.push({
            role: 'assistant',
            content: truncate(reply.text.trim(), 1200) || '（空响应）',
          });
          messages.push({ role: 'user', content: buildCorrection(problem, legalMoves, thinkingLevel) });
          this.emitState();
          await sleep(150, signal);
          if (!this.isCurrent(seq)) return;
          continue;
        }

        this.forfeitTurn(
          side,
          `连续 ${this.settings.maxAttempts} 次未给出合法着法：${problem}`,
        );
        return;
      }

      let applied: EngineMove;
      try {
        applied = this.game.apply(engineMove.ucci);
      } catch (error) {
        if (error instanceof IllegalMoveError) {
          view.lastError = error.message;
          if (attempt < this.settings.maxAttempts) {
            messages.push({
              role: 'assistant',
              content: truncate(reply.text.trim(), 1200) || '（空响应）',
            });
            messages.push({
              role: 'user',
              content: buildCorrection(error.message, legalMoves, thinkingLevel),
            });
            this.emitState();
            await sleep(150, signal);
            if (!this.isCurrent(seq)) return;
            continue;
          }
          this.failTurn(side, `着法执行失败：${error.message}`);
          return;
        }
        throw error;
      }

      const latencyMs = Math.max(0, Date.now() - startedAt);
      view.thinking = false;
      view.thinkingSince = null;
      view.lastLatencyMs = latencyMs;
      view.reason = decision.reason;
      view.lastError = null;
      view.attempts = attempt;

      this.moves.push({
        ply: this.game.ply,
        side,
        ucci: applied.ucci,
        notation: applied.notation,
        pieceLabel: pieceName(side, applied.piece),
        capturedLabel: applied.captured
          ? pieceName(otherSide(side), applied.captured)
          : null,
        reason: decision.reason,
        latencyMs,
        tokensIn: reply.tokensIn,
        tokensOut: reply.tokensOut,
        at: Date.now(),
      });
      this.lastMove = {
        fromUcci: ucciFromIndex(applied.from),
        toUcci: ucciFromIndex(applied.to),
        side,
      };

      const outcome = this.game.outcome();
      if (outcome) {
        this.finishGame(outcome);
        return;
      }

      this.emitState();
      await sleep(this.settings.moveDelayMs, signal);
      if (!this.isCurrent(seq) || this.phase !== 'running') return;

      this.turnActive = false;
      this.startTurn();
      return;
    }
  }

  private describeError(error: unknown, setup: ModelSetup): string {
    const message =
      error instanceof Error ? error.message : '模型请求失败，原因未知';
    const safe = redactSecrets(message, [setup.apiKey]) || '模型请求失败';
    const unsupportedHint =
      setup.apiReasoning &&
      error instanceof ProviderError &&
      (error.status === 400 || error.status === 422)
        ? '（该方已开启 API 推理参数；若模型不支持 reasoning/thinking 参数，请重置后关闭该开关。）'
        : '';
    return `${safe}${unsupportedHint}`;
  }

  private failTurn(side: Side, message: string, quota = false): void {
    if (this.phase === 'idle' || this.phase === 'finished') return;

    this.phase = 'error';
    this.errorState = quota ? { side, message, quota: true } : { side, message };
    const view = this.models[side];
    if (view) {
      view.thinking = false;
      view.thinkingSince = null;
      view.lastError = message;
    }
    this.setThinking(false);
    this.emitState();
  }

  private finishGame(outcome: GameOutcome): void {
    this.completeGame({
      winner: outcome.winner,
      reason: outcome.reason,
      text: outcome.text || `${sideName(outcome.winner ?? 'red')}胜`,
    });
  }

  /**
   * Adjudicate a direct loss when the side to move never produced a legal
   * move, or when its request exceeded the per-step timeout. The opponent wins
   * immediately and the game is archived as finished, so tournament and
   * championship tables count it as a normal win/loss instead of a no-contest.
   */
  private forfeitTurn(side: Side, message: string, reason: ResultReason = 'forfeit'): void {
    if (this.phase !== 'running') return;
    const view = this.models[side];
    if (view) {
      view.thinking = false;
      view.thinkingSince = null;
      view.lastError = message;
    }
    this.completeGame({
      winner: otherSide(side),
      reason,
      text: `${sideName(side)}${message}，判负`,
    });
  }

  private completeGame(result: GameResult): void {
    if (this.phase === 'finished') return;

    // Invalidate any scheduled continuation and stop any in-flight work before
    // publishing the terminal snapshot. No model request may start after this.
    this.turnSeq += 1;
    this.turnActive = false;
    this.turnController?.abort();
    this.turnController = null;

    this.phase = 'finished';
    this.errorState = null;
    this.result = { ...result };
    this.setThinking(false);
    // The game is over: drop model setups and provider closures (and their keys).
    this.runtimes = { red: null, black: null };
    this.emitState();

    if (this.onGameComplete) {
      const endedAt = Date.now();
      try {
        this.onGameComplete({
          state: this.getState(),
          startedAt: this.gameStartedAt ?? endedAt,
          endedAt,
        });
      } catch (error) {
        console.error(
          '[arena] history callback failed:',
          error instanceof Error ? error.message : error,
        );
      }
    }
  }
}
