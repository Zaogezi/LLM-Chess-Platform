/**
 * Board geometry, piece encodings and game constants for the Xiangqi engine.
 *
 * Coordinates: the internal board is a flat 90-entry array.
 *   index = row * 9 + col
 *   row 0 = Red home rank (bottom), row 9 = Black home rank (top)
 *   col 0 = file a (left when Red is at bottom), col 8 = file i
 *
 * UCCI square names are `<file><rank>`: `a0` is Red's bottom-left rook square,
 * `e9` is Black's king square.
 */

import type { PieceType } from '../../shared/protocol';

export const BOARD_ROWS = 10;
export const BOARD_COLS = 9;
export const BOARD_SIZE = BOARD_ROWS * BOARD_COLS;

export const FILES = 'abcdefghi';
export const RANKS = '0123456789';

/** Standard starting position (also exported from the shared protocol). */
export const START_FEN =
  'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

/** A game is drawn when this many half-moves have been played. */
export const MAX_PLIES = 300;

/**
 * Draw when this many half-moves pass without a capture or pawn advance
 * (60 full moves). This complements the hard move cap: even a non-repeating
 * shuffle cannot keep a game alive indefinitely.
 */
export const NO_PROGRESS_PLIES = 120;

/** Threefold repetition of (position + side to move) is a draw. */
export const REPETITION_LIMIT = 3;

/** Canonical FEN letter for each piece type (lowercase = black, uppercase = red). */
export const PIECE_CHARS: Record<PieceType, string> = {
  rook: 'r',
  horse: 'n',
  elephant: 'b',
  advisor: 'a',
  king: 'k',
  cannon: 'c',
  pawn: 'p',
};

/** Accepted FEN letters on input. `h`/`e` are aliases for horse/elephant. */
export const CHAR_TO_PIECE: Record<string, PieceType> = {
  r: 'rook',
  n: 'horse',
  h: 'horse',
  b: 'elephant',
  e: 'elephant',
  a: 'advisor',
  k: 'king',
  c: 'cannon',
  p: 'pawn',
};

/** Chinese labels used in outcome text. */
export const SIDE_LABELS: Record<'red' | 'black', string> = {
  red: '红方',
  black: '黑方',
};
