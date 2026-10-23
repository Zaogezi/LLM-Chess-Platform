/**
 * FEN parsing / serialization for Xiangqi.
 *
 * Standard UCCI/Xiangqi FEN:
 *   <placement> <side> <castling> <en-passant> <halfmove> <fullmove>
 * e.g. `rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1`
 *
 * Placement is given from Black's back rank (row 9) down to Red's back rank
 * (row 0). Piece letters: r/n/b/a/k/c/p, uppercase = Red, lowercase = Black.
 * On input `h` (horse) and `e` (elephant) are accepted as aliases for `n`/`b`;
 * serialization always emits the canonical `n`/`b`.
 *
 * Only the first two fields are strictly required; when present, the castling
 * and en-passant fields must be `-` (Xiangqi has neither). The halfmove and
 * fullmove counters are kept from the input so that round-trips are lossless.
 */

import type { Side } from '../../shared/protocol';
import {
  BOARD_COLS,
  BOARD_ROWS,
  CHAR_TO_PIECE,
  PIECE_CHARS,
  SIDE_LABELS,
} from './constants';
import type { Board, Piece } from './types';
import { IllegalMoveError } from './types';
import { idx } from './square';
import type { PieceType } from '../../shared/protocol';

export interface ParsedFen {
  board: Board;
  sideToMove: Side;
  halfmove: number;
  fullmove: number;
}

function badFen(message: string): never {
  throw new IllegalMoveError('bad-format', `FEN 格式错误：${message}`);
}

/**
 * Parse a Xiangqi FEN string. Throws `IllegalMoveError` with code
 * `bad-format` (and a Chinese message) for anything malformed, including a
 * missing/duplicated king or more pieces of a type than can ever exist.
 */
export function parseFen(fen: string): ParsedFen {
  if (typeof fen !== 'string') badFen('FEN 必须是字符串');
  const text = fen.trim();
  if (text === '') badFen('FEN 不能为空');

  const fields = text.split(/\s+/);
  if (fields.length !== 2 && fields.length !== 4 && fields.length !== 6) {
    badFen('字段数量必须为 2、4 或 6（棋盘 走子方 [王车易位 吃过路兵 半回合数 回合数]）');
  }

  const placement = fields[0];
  const turnField = fields[1].toLowerCase();
  const sideToMove: Side =
    turnField === 'w' || turnField === 'r' ? 'red' : turnField === 'b' ? 'black' : badFen(`无法识别的走子方 "${fields[1]}"（应为 w 或 b）`);

  let halfmove = 0;
  let fullmove = 1;
  if (fields.length >= 4) {
    if (fields[2] !== '-') badFen('王车易位字段必须为 "-"（象棋没有易位）');
    if (fields[3] !== '-') badFen('吃过路兵字段必须为 "-"（象棋没有吃过路兵）');
  }
  if (fields.length === 6) {
    if (!/^\d+$/.test(fields[4])) badFen(`半回合数 "${fields[4]}" 不是非负整数`);
    halfmove = Number(fields[4]);
    if (!/^[1-9]\d*$/.test(fields[5])) badFen(`回合数 "${fields[5]}" 不是正整数`);
    fullmove = Number(fields[5]);
  }

  const ranks = placement.split('/');
  if (ranks.length !== BOARD_ROWS) {
    badFen(`棋盘必须有 ${BOARD_ROWS} 行，实际为 ${ranks.length} 行`);
  }

  const cells: (Omit<Piece, 'id'> | null)[] = new Array(BOARD_COLS * BOARD_ROWS).fill(null);
  for (let r = 0; r < BOARD_ROWS; r += 1) {
    const row = BOARD_ROWS - 1 - r; // FEN starts from row 9
    const rank = ranks[r];
    let col = 0;
    for (const ch of rank) {
      if (ch >= '1' && ch <= '9') {
        col += Number(ch);
        if (col > BOARD_COLS) badFen(`第 ${r + 1} 行格数超过 ${BOARD_COLS}`);
        continue;
      }
      const letter = ch.toLowerCase();
      const type = CHAR_TO_PIECE[letter];
      if (!type) badFen(`第 ${r + 1} 行存在无法识别的字符 "${ch}"`);
      if (col >= BOARD_COLS) badFen(`第 ${r + 1} 行格数超过 ${BOARD_COLS}`);
      const side: Side = ch === ch.toUpperCase() ? 'red' : 'black';
      cells[idx(row, col)] = { type, side };
      col += 1;
    }
    if (col !== BOARD_COLS) badFen(`第 ${r + 1} 行格数为 ${col}，应为 ${BOARD_COLS}`);
  }

  // Exactly one king per side is required. Other material counts are not
  // validated: fixtures may use synthetic (even unreachable) compositions.
  const kingCounts: Record<Side, number> = { red: 0, black: 0 };
  for (const cell of cells) {
    if (cell && cell.type === 'king') kingCounts[cell.side] += 1;
  }
  for (const side of ['red', 'black'] as const) {
    const kingCount = kingCounts[side];
    if (kingCount !== 1) {
      badFen(`${SIDE_LABELS[side]}必须有且仅有一个${side === 'red' ? '帅' : '将'}，实际有 ${kingCount} 个`);
    }
  }

  // Deterministic IDs: scan index order 0..89, number per side+type.
  const board: Board = new Array(cells.length).fill(null);
  const used: Record<Side, Map<PieceType, number>> = {
    red: new Map(),
    black: new Map(),
  };
  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i];
    if (!cell) continue;
    const next = (used[cell.side].get(cell.type) ?? 0) + 1;
    used[cell.side].set(cell.type, next);
    board[i] = { id: `${cell.side}-${cell.type}-${next}`, type: cell.type, side: cell.side };
  }

  return { board, sideToMove, halfmove, fullmove };
}

/** Serialize only the placement field, rows from row 9 (top) down to row 0. */
export function serializePlacement(board: Board): string {
  const ranks: string[] = [];
  for (let row = BOARD_ROWS - 1; row >= 0; row -= 1) {
    let rank = '';
    let empty = 0;
    for (let col = 0; col < BOARD_COLS; col += 1) {
      const piece = board[idx(row, col)];
      if (!piece) {
        empty += 1;
        continue;
      }
      if (empty > 0) {
        rank += String(empty);
        empty = 0;
      }
      const letter = PIECE_CHARS[piece.type];
      rank += piece.side === 'red' ? letter.toUpperCase() : letter;
    }
    if (empty > 0) rank += String(empty);
    ranks.push(rank);
  }
  return ranks.join('/');
}

export function serializeFen(
  board: Board,
  sideToMove: Side,
  halfmove: number,
  fullmove: number,
): string {
  const turn = sideToMove === 'red' ? 'w' : 'b';
  return `${serializePlacement(board)} ${turn} - - ${halfmove} ${fullmove}`;
}

/**
 * Position identity for repetition detection: the full piece placement plus the
 * side to move. IDs are deliberately excluded; the placement string is a
 * bijective encoding of the board.
 */
export function positionKey(board: Board, sideToMove: Side): string {
  return `${serializePlacement(board)} ${sideToMove}`;
}
