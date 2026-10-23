/**
 * Public and internal types for the Xiangqi engine.
 */

import type { PieceType, Side } from '../../shared/protocol';

/** A fully resolved legal move as returned by the public API. */
export interface EngineMove {
  from: number;
  to: number;
  ucci: string;
  notation: string;
  piece: PieceType;
  side: Side;
  captured: PieceType | null;
}

/** Terminal outcome of a game. `winner` is null for draws. */
export interface GameOutcome {
  winner: Side | null;
  reason:
    | 'checkmate'
    | 'stalemate'
    | 'repetition'
    | 'dead-position'
    | 'no-progress'
    | 'max-plies';
  text: string;
}

export type IllegalMoveCode =
  | 'bad-format'
  | 'no-piece'
  | 'not-your-piece'
  | 'illegal'
  | 'game-over';

/**
 * Error thrown for illegal moves (including malformed coordinates) and for
 * malformed FEN strings (code `bad-format`). Messages are user-facing Chinese.
 */
export class IllegalMoveError extends Error {
  readonly code: IllegalMoveCode;

  constructor(code: IllegalMoveCode, message: string) {
    super(message);
    this.name = 'IllegalMoveError';
    this.code = code;
  }
}

/** Internal board cell. IDs are deterministic strings such as `red-rook-1`. */
export interface Piece {
  id: string;
  type: PieceType;
  side: Side;
}

export type Cell = Piece | null;
export type Board = Cell[];

/** A move in raw board indices (pre-notation). */
export interface RawMove {
  from: number;
  to: number;
}
