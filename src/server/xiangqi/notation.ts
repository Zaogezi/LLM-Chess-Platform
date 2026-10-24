/**
 * Chinese move notation (中文记谱) for Xiangqi.
 *
 * Conventions implemented here:
 * - Red uses 帅仕相马车炮兵 and Black uses 将士象马车炮卒; both sides render
 *   every number with Chinese numerals 一..九 so the move list stays visually
 *   consistent (the traditional Black Arabic digits are intentionally not used).
 * - File numbers are counted from each side's own right:
 *     Red file number   = 9 - col
 *     Black file number = col + 1
 * - `平` is used when the rank does not change (destination file number);
 *   `进` moves toward the opponent (Red: row increases, Black: row decreases),
 *   `退` moves away from the opponent.
 * - Horse, elephant and advisor use the destination file number after
 *   `进`/`退`; rook, cannon, pawn and king use the number of ranks travelled.
 * - When two or more identical pieces of the same side share the origin file,
 *   the origin file number is omitted and 前/后 (two pieces) or 前/中/后
 *   (three pieces) is prefixed; "front" means closer to the opponent's back
 *   rank (Red: larger row, Black: smaller row).
 * - Fallback: when four or more identical pieces share a file, or when the
 *   same type has more than one file with a multi-piece group (which would make
 *   a bare 前/后 prefix ambiguous), the origin UCCI square is prefixed instead,
 *   e.g. `a4兵九进一`. This is deterministic and never ambiguous; it only ever
 *   occurs in exotic positions (only pawns can ever get a group that large).
 */

import type { PieceType, Side } from '../../shared/protocol';
import { BOARD_SIZE } from './constants';
import { colOf, rowOf, squareName } from './square';
import type { Board } from './types';
import { IllegalMoveError } from './types';

const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

const RED_GLYPHS: Record<PieceType, string> = {
  rook: '车',
  horse: '马',
  elephant: '相',
  advisor: '仕',
  king: '帅',
  cannon: '炮',
  pawn: '兵',
};

const BLACK_GLYPHS: Record<PieceType, string> = {
  rook: '车',
  horse: '马',
  elephant: '象',
  advisor: '士',
  king: '将',
  cannon: '炮',
  pawn: '卒',
};

function glyphFor(side: Side, type: PieceType): string {
  return (side === 'red' ? RED_GLYPHS : BLACK_GLYPHS)[type];
}

function fileNumber(side: Side, col: number): number {
  return side === 'red' ? 9 - col : col + 1;
}

/** Render a file/rank count with Chinese numerals for both sides. */
function renderNumber(value: number): string {
  if (value < 1 || value > 9) {
    throw new IllegalMoveError('illegal', `记谱数字 ${value} 超出范围`);
  }
  return CN_DIGITS[value];
}

/**
 * Collect the indices of all same-side, same-type pieces, grouped by origin
 * file, each group sorted front-to-back.
 */
function sameTypeGroupsByFile(board: Board, side: Side, type: PieceType): Map<number, number[]> {
  const groups = new Map<number, number[]>();
  for (let i = 0; i < BOARD_SIZE; i += 1) {
    const piece = board[i];
    if (!piece || piece.side !== side || piece.type !== type) continue;
    const col = colOf(i);
    const group = groups.get(col);
    if (group) group.push(i);
    else groups.set(col, [i]);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => (side === 'red' ? rowOf(b) - rowOf(a) : rowOf(a) - rowOf(b)));
  }
  return groups;
}

/**
 * Build the Chinese notation for a move. `board` must be the position *before*
 * the move. Throws `IllegalMoveError` if the origin square is empty.
 */
export function chineseNotation(board: Board, from: number, to: number): string {
  const piece = board[from];
  if (!piece) {
    throw new IllegalMoveError('no-piece', `起点 ${squareName(from)} 没有棋子，无法生成记谱`);
  }
  const side = piece.side;
  const fromRow = rowOf(from);
  const fromCol = colOf(from);
  const toRow = rowOf(to);
  const toCol = colOf(to);
  const glyph = glyphFor(side, piece.type);
  const originFile = renderNumber(fileNumber(side, fromCol));
  const destFile = renderNumber(fileNumber(side, toCol));

  let action: string;
  if (toRow === fromRow) {
    action = `平${destFile}`;
  } else {
    const forward = side === 'red' ? toRow > fromRow : toRow < fromRow;
    const direction = forward ? '进' : '退';
    const usesDestinationFile =
      piece.type === 'horse' || piece.type === 'elephant' || piece.type === 'advisor';
    const value = usesDestinationFile ? fileNumber(side, toCol) : Math.abs(toRow - fromRow);
    action = `${direction}${renderNumber(value)}`;
  }

  const groups = sameTypeGroupsByFile(board, side, piece.type);
  const ownGroup = groups.get(fromCol) ?? [from];
  const multiGroups = [...groups.values()].filter((group) => group.length > 1);

  if (ownGroup.length === 1) {
    return `${glyph}${originFile}${action}`;
  }
  // Prefix form is only safe for groups of 2-3 when it cannot be confused with
  // another same-type group on a different file.
  if (ownGroup.length <= 3 && multiGroups.length === 1) {
    const position = ownGroup.indexOf(from);
    const prefix = ownGroup.length === 2 ? (position === 0 ? '前' : '后') : ['前', '中', '后'][position];
    return `${prefix}${glyph}${action}`;
  }
  // Deterministic coordinate-prefixed fallback.
  return `${squareName(from)}${glyph}${originFile}${action}`;
}

/** Chinese piece glyph, exported for UI/integration convenience. */
export function chinesePieceGlyph(type: PieceType, side: Side): string {
  return glyphFor(side, type);
}
