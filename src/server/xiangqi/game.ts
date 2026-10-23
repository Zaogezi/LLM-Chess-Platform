/**
 * The Xiangqi game state: board, turn, counters, repetition history, legal
 * moves, terminal detection and perft.
 */

import type { PieceView, Side } from '../../shared/protocol';
import {
  MAX_PLIES,
  NO_PROGRESS_PLIES,
  REPETITION_LIMIT,
  SIDE_LABELS,
  START_FEN,
} from './constants';
import { parseFen, positionKey, serializeFen } from './fen';
import { chineseNotation } from './notation';
import { generateLegalMoves, isDeadPosition, isKingInCheck } from './rules';
import { canonicalUcci, opposite, parseUcciMove, squareName } from './square';
import type { Board, EngineMove, GameOutcome } from './types';
import { IllegalMoveError } from './types';

const OUTCOME_TEXTS = {
  repetition: '三次重复局面，判和',
} as const;

export class XiangqiGame {
  private _board: Board;
  private _sideToMove: Side;
  private _halfmove: number;
  private _fullmove: number;
  private _ply: number;
  /** Occurrence count of every (placement, side-to-move) key seen so far. */
  private _history: Map<string, number> = new Map();
  private _legalCache: EngineMove[] | null = null;
  private _checkedCache: boolean | null = null;

  private constructor(board: Board, sideToMove: Side, halfmove: number, fullmove: number) {
    this._board = board;
    this._sideToMove = sideToMove;
    this._halfmove = halfmove;
    this._fullmove = fullmove;
    this._ply = 0;
  }

  /** A game in the standard starting position. */
  static initial(): XiangqiGame {
    return XiangqiGame.fromFen(START_FEN);
  }

  /** Load a game from a Xiangqi FEN. Throws `IllegalMoveError` (bad-format) on malformed input. */
  static fromFen(fen: string): XiangqiGame {
    const parsed = parseFen(fen);
    const game = new XiangqiGame(parsed.board, parsed.sideToMove, parsed.halfmove, parsed.fullmove);
    // Counters are preserved; `ply` is the number of half-moves reflected by them.
    game._ply = (parsed.fullmove - 1) * 2 + (parsed.sideToMove === 'black' ? 1 : 0);
    game._history.set(positionKey(game._board, game._sideToMove), 1);
    return game;
  }

  /** Deep copy that can be advanced without affecting the original. */
  clone(): XiangqiGame {
    const board = this._board.map((piece) => (piece ? { ...piece } : null));
    const copy = new XiangqiGame(board, this._sideToMove, this._halfmove, this._fullmove);
    copy._ply = this._ply;
    copy._history = new Map(this._history);
    return copy;
  }

  /** Fresh 90-entry copy of the board; piece IDs stay stable for the life of the game. */
  get board(): (PieceView | null)[] {
    return this._board.map((piece) =>
      piece ? { id: piece.id, type: piece.type, side: piece.side } : null,
    );
  }

  get fen(): string {
    return serializeFen(this._board, this._sideToMove, this._halfmove, this._fullmove);
  }

  get sideToMove(): Side {
    return this._sideToMove;
  }

  /** Full-move number, starts at 1 and increments after every Black move. */
  get moveNumber(): number {
    return this._fullmove;
  }

  /** Number of half-moves applied since the start of the game. */
  get ply(): number {
    return this._ply;
  }

  /** Whether the side to move is currently in check (flying general included). */
  get checked(): boolean {
    if (this._checkedCache === null) {
      this._checkedCache = isKingInCheck(this._board, this._sideToMove);
    }
    return this._checkedCache;
  }

  /** All fully legal moves, sorted by UCCI ascending. */
  legalMoves(): EngineMove[] {
    if (this._legalCache === null) {
      const rawMoves = generateLegalMoves(this._board, this._sideToMove);
      const moves = rawMoves.map((move) => this.describeMove(move.from, move.to));
      moves.sort((a, b) => (a.ucci < b.ucci ? -1 : a.ucci > b.ucci ? 1 : 0));
      this._legalCache = moves;
    }
    return this._legalCache.map((move) => ({ ...move }));
  }

  /** Normalized lookup by UCCI string (trimmed, case-insensitive). Returns null if not legal. */
  findLegalMove(ucci: string): EngineMove | null {
    const parsed = parseUcciMove(ucci);
    if (!parsed) return null;
    const found = this.legalMoves().find(
      (move) => move.from === parsed.from && move.to === parsed.to,
    );
    return found ? { ...found } : null;
  }

  /**
   * Validate and apply a move (an EngineMove object or a UCCI string). Mutates
   * the game, advances the turn and returns the applied move.
   */
  apply(move: EngineMove | string): EngineMove {
    const outcome = this.outcome();
    if (outcome) {
      throw new IllegalMoveError('game-over', `对局已结束：${outcome.text}`);
    }

    let from: number;
    let to: number;
    let declared: EngineMove | null = null;

    if (typeof move === 'string') {
      const parsed = parseUcciMove(move);
      if (!parsed) {
        throw new IllegalMoveError('bad-format', `无法解析着法 "${move}"，应为形如 h2e2 的 UCCI 坐标`);
      }
      from = parsed.from;
      to = parsed.to;
    } else {
      if (!move || typeof move !== 'object') {
        throw new IllegalMoveError('bad-format', '着法必须是 UCCI 字符串或 EngineMove 对象');
      }
      declared = move;
      if (move.side !== this._sideToMove) {
        const declaredSideLabel =
          move.side === 'red' || move.side === 'black' ? SIDE_LABELS[move.side] : '对方';
        throw new IllegalMoveError(
          'not-your-piece',
          `现在轮到${SIDE_LABELS[this._sideToMove]}走棋，不能替${declaredSideLabel}落子`,
        );
      }
      if (
        !Number.isInteger(move.from) ||
        !Number.isInteger(move.to) ||
        move.from < 0 ||
        move.from >= 90 ||
        move.to < 0 ||
        move.to >= 90
      ) {
        throw new IllegalMoveError('bad-format', '着法坐标必须是 0..89 的整数');
      }
      from = move.from;
      to = move.to;
    }

    if (from === to) {
      throw new IllegalMoveError('illegal', `起点与终点相同：${squareName(from)}`);
    }

    const piece = this._board[from];
    if (!piece) {
      throw new IllegalMoveError('no-piece', `起点 ${squareName(from)} 没有棋子`);
    }
    if (piece.side !== this._sideToMove) {
      throw new IllegalMoveError(
        'not-your-piece',
        `现在轮到${SIDE_LABELS[this._sideToMove]}走棋，${squareName(from)} 上是${SIDE_LABELS[piece.side]}棋子`,
      );
    }
    if (declared && declared.piece !== undefined && declared.piece !== piece.type) {
      throw new IllegalMoveError(
        'illegal',
        `着法信息与棋盘不符：${squareName(from)} 上实际是 ${piece.type}，不是 ${String(declared.piece)}`,
      );
    }

    const found = this.legalMoves().find((candidate) => candidate.from === from && candidate.to === to);
    if (!found) {
      throw new IllegalMoveError(
        'illegal',
        `着法 ${squareName(from)}${squareName(to)} 在当前局面不合法`,
      );
    }

    this.performMove(found);
    return { ...found };
  }

  /**
   * Terminal outcome for the current position, or null if the game continues.
   * Priority: no legal moves (checkmate/stalemate) → material dead position →
   * threefold repetition → 120 quiet plies (no capture/pawn advance) → the
   * 300-half-move hard cap.
   */
  outcome(): GameOutcome | null {
    const legal = this.legalMoves();
    if (legal.length === 0) {
      const loser = this._sideToMove;
      const winner = opposite(loser);
      if (this.checked) {
        return {
          winner,
          reason: 'checkmate',
          text: `${SIDE_LABELS[winner]}将死${SIDE_LABELS[loser]}`,
        };
      }
      // In Xiangqi a side that cannot move loses even when not in check (困毙判负).
      return {
        winner,
        reason: 'stalemate',
        text: `${SIDE_LABELS[winner]}困毙${SIDE_LABELS[loser]}`,
      };
    }
    const key = positionKey(this._board, this._sideToMove);
    if (isDeadPosition(this._board)) {
      return {
        winner: null,
        reason: 'dead-position',
        text: '死局：双方均无进攻子力，无法将死对方，判和',
      };
    }
    if ((this._history.get(key) ?? 0) >= REPETITION_LIMIT) {
      return { winner: null, reason: 'repetition', text: OUTCOME_TEXTS.repetition };
    }
    if (this._halfmove >= NO_PROGRESS_PLIES) {
      return {
        winner: null,
        reason: 'no-progress',
        text: '死局：连续 60 回合无吃子且无兵卒推进，判和',
      };
    }
    if (this._ply >= MAX_PLIES) {
      return { winner: null, reason: 'max-plies', text: `达到 ${MAX_PLIES} 手上限，判和` };
    }
    return null;
  }

  /**
   * Standard perft: number of leaf nodes at `depth` legal plies from the
   * current position. Draw rules (repetition, dead positions and move caps) are
   * intentionally ignored, as in standard perft.
   */
  perft(depth: number): number {
    if (!Number.isInteger(depth) || depth < 0) {
      throw new IllegalMoveError('bad-format', 'perft 深度必须是非负整数');
    }
    const board = this._board.slice();
    return this.perftFrom(board, this._sideToMove, depth);
  }

  private perftFrom(board: Board, side: Side, depth: number): number {
    if (depth === 0) return 1;
    const moves = generateLegalMoves(board, side);
    if (depth === 1) return moves.length;
    let total = 0;
    for (const move of moves) {
      const moved = board[move.from]!;
      const captured = board[move.to];
      board[move.to] = moved;
      board[move.from] = null;
      total += this.perftFrom(board, opposite(side), depth - 1);
      board[move.from] = moved;
      board[move.to] = captured;
    }
    return total;
  }

  private describeMove(from: number, to: number): EngineMove {
    const piece = this._board[from]!;
    const target = this._board[to];
    return {
      from,
      to,
      ucci: canonicalUcci(from, to),
      notation: chineseNotation(this._board, from, to),
      piece: piece.type,
      side: piece.side,
      captured: target ? target.type : null,
    };
  }

  private performMove(move: EngineMove): void {
    const piece = this._board[move.from]!;
    const mover = this._sideToMove;
    this._board[move.from] = null;
    this._board[move.to] = piece;

    const isPawnMove = piece.type === 'pawn';
    this._halfmove = move.captured !== null || isPawnMove ? 0 : this._halfmove + 1;
    this._sideToMove = opposite(mover);
    if (mover === 'black') this._fullmove += 1;
    this._ply += 1;

    const key = positionKey(this._board, this._sideToMove);
    this._history.set(key, (this._history.get(key) ?? 0) + 1);

    this._legalCache = null;
    this._checkedCache = null;
  }
}
