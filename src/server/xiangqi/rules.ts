/**
 * Move generation and attack detection for Xiangqi.
 *
 * The board is a plain 90-entry array; generation produces pseudo-legal moves
 * which are then filtered by making each move and testing whether the mover's
 * king is attacked. King safety includes the flying-general rule (the two kings
 * may never face each other on an open file).
 *
 * Enemy king capture is never generated: a legal game ends at checkmate or
 * stalemate, so capturing the king can never occur.
 */

import type { PieceType, Side } from '../../shared/protocol';
import { BOARD_COLS, BOARD_SIZE } from './constants';
import { idx, inBounds, opposite } from './square';
import type { Board, Piece, RawMove } from './types';

const ORTHO_DIRS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/**
 * Only these pieces can ever attack the enemy king and participate in mate.
 * Advisors and elephants are confined to their own side of the board and can
 * never reach the opposing palace, so two sides reduced to kings + guards have
 * a dead position regardless of piece placement.
 */
const ATTACKING_PIECE_TYPES: ReadonlySet<PieceType> = new Set([
  'rook',
  'cannon',
  'horse',
  'pawn',
]);

export function hasAttackingMaterial(board: Board, side: Side): boolean {
  return board.some(
    (piece) => piece !== null && piece.side === side && ATTACKING_PIECE_TYPES.has(piece.type),
  );
}

/**
 * Conservative material dead-position test: neither side has a rook, cannon,
 * horse or pawn. There is no checkmate possible with only kings/guards, so the
 * game can never produce a winner.
 */
export function isDeadPosition(board: Board): boolean {
  return !hasAttackingMaterial(board, 'red') && !hasAttackingMaterial(board, 'black');
}

const HORSE_STEPS: ReadonlyArray<readonly [number, number, number, number]> = [
  // dr, dc, leg dr, leg dc
  [-2, -1, -1, 0],
  [-2, 1, -1, 0],
  [2, -1, 1, 0],
  [2, 1, 1, 0],
  [-1, -2, 0, -1],
  [1, -2, 0, -1],
  [-1, 2, 0, 1],
  [1, 2, 0, 1],
];

const ELEPHANT_STEPS: ReadonlyArray<readonly [number, number]> = [
  [-2, -2],
  [-2, 2],
  [2, -2],
  [2, 2],
];

const ADVISOR_STEPS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

/** Horse offsets (from the attacked square to the horse) used for check detection. */
const HORSE_ATTACK_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-2, -1],
  [-2, 1],
  [2, -1],
  [2, 1],
  [-1, -2],
  [1, -2],
  [-1, 2],
  [1, 2],
];

function inPalace(side: Side, row: number, col: number): boolean {
  if (col < 3 || col > 5) return false;
  return side === 'red' ? row >= 0 && row <= 2 : row >= 7 && row <= 9;
}

/** Elephants may never cross the river: Red is limited to rows 0-4, Black to 5-9. */
function onOwnSide(side: Side, row: number): boolean {
  return side === 'red' ? row <= 4 : row >= 5;
}

function pawnCrossedRiver(side: Side, row: number): boolean {
  return side === 'red' ? row >= 5 : row <= 4;
}

/** Find the board index of `side`'s king, or -1 if absent (invalid position). */
export function findKing(board: Board, side: Side): number {
  for (let i = 0; i < BOARD_SIZE; i += 1) {
    const piece = board[i];
    if (piece && piece.type === 'king' && piece.side === side) return i;
  }
  return -1;
}

/**
 * Add a simple (non-sliding) destination: allowed if empty or holding an enemy
 * non-king piece. Returns true when the destination square was empty.
 */
function pushStep(board: Board, out: RawMove[], from: number, row: number, col: number, side: Side): boolean {
  if (!inBounds(row, col)) return false;
  const target = board[idx(row, col)];
  if (!target) {
    out.push({ from, to: idx(row, col) });
    return true;
  }
  if (target.side !== side && target.type !== 'king') {
    out.push({ from, to: idx(row, col) });
  }
  return false;
}

function genRook(board: Board, side: Side, from: number, row: number, col: number, out: RawMove[]): void {
  for (const [dr, dc] of ORTHO_DIRS) {
    let nr = row + dr;
    let nc = col + dc;
    while (inBounds(nr, nc)) {
      const target = board[idx(nr, nc)];
      if (!target) {
        out.push({ from, to: idx(nr, nc) });
      } else {
        if (target.side !== side && target.type !== 'king') out.push({ from, to: idx(nr, nc) });
        break;
      }
      nr += dr;
      nc += dc;
    }
  }
}

function genCannon(board: Board, side: Side, from: number, row: number, col: number, out: RawMove[]): void {
  for (const [dr, dc] of ORTHO_DIRS) {
    let nr = row + dr;
    let nc = col + dc;
    let screenSeen = false;
    while (inBounds(nr, nc)) {
      const target = board[idx(nr, nc)];
      if (!screenSeen) {
        // Quiet moves slide like a rook up to (not through) the first piece.
        if (!target) out.push({ from, to: idx(nr, nc) });
        else screenSeen = true;
      } else if (target) {
        // A capture needs exactly one intervening piece (the screen).
        if (target.side !== side && target.type !== 'king') out.push({ from, to: idx(nr, nc) });
        break;
      }
      nr += dr;
      nc += dc;
    }
  }
}

function genHorse(board: Board, side: Side, from: number, row: number, col: number, out: RawMove[]): void {
  for (const [dr, dc, legDr, legDc] of HORSE_STEPS) {
    const legRow = row + legDr;
    const legCol = col + legDc;
    if (!inBounds(legRow, legCol)) continue;
    if (board[idx(legRow, legCol)]) continue; // leg blocked
    pushStep(board, out, from, row + dr, col + dc, side);
  }
}

function genElephant(board: Board, side: Side, from: number, row: number, col: number, out: RawMove[]): void {
  for (const [dr, dc] of ELEPHANT_STEPS) {
    const destRow = row + dr;
    const destCol = col + dc;
    if (!inBounds(destRow, destCol)) continue;
    if (!onOwnSide(side, destRow)) continue; // the river can never be crossed
    const eyeRow = row + dr / 2;
    const eyeCol = col + dc / 2;
    if (board[idx(eyeRow, eyeCol)]) continue; // elephant eye blocked
    pushStep(board, out, from, destRow, destCol, side);
  }
}

function genAdvisor(board: Board, side: Side, from: number, row: number, col: number, out: RawMove[]): void {
  for (const [dr, dc] of ADVISOR_STEPS) {
    const destRow = row + dr;
    const destCol = col + dc;
    if (!inPalace(side, destRow, destCol)) continue;
    pushStep(board, out, from, destRow, destCol, side);
  }
}

function genKing(board: Board, side: Side, from: number, row: number, col: number, out: RawMove[]): void {
  for (const [dr, dc] of ORTHO_DIRS) {
    const destRow = row + dr;
    const destCol = col + dc;
    if (!inPalace(side, destRow, destCol)) continue;
    pushStep(board, out, from, destRow, destCol, side);
  }
}

function genPawn(board: Board, side: Side, from: number, row: number, col: number, out: RawMove[]): void {
  const forwardRow = row + (side === 'red' ? 1 : -1);
  pushStep(board, out, from, forwardRow, col, side);
  if (pawnCrossedRiver(side, row)) {
    pushStep(board, out, from, row, col - 1, side);
    pushStep(board, out, from, row, col + 1, side);
  }
}

/** Generate pseudo-legal moves for `side` (king safety not yet filtered). */
export function generatePseudoMoves(board: Board, side: Side): RawMove[] {
  const out: RawMove[] = [];
  for (let from = 0; from < BOARD_SIZE; from += 1) {
    const piece = board[from];
    if (!piece || piece.side !== side) continue;
    const row = Math.floor(from / BOARD_COLS);
    const col = from % BOARD_COLS;
    switch (piece.type) {
      case 'rook':
        genRook(board, side, from, row, col, out);
        break;
      case 'cannon':
        genCannon(board, side, from, row, col, out);
        break;
      case 'horse':
        genHorse(board, side, from, row, col, out);
        break;
      case 'elephant':
        genElephant(board, side, from, row, col, out);
        break;
      case 'advisor':
        genAdvisor(board, side, from, row, col, out);
        break;
      case 'king':
        genKing(board, side, from, row, col, out);
        break;
      case 'pawn':
        genPawn(board, side, from, row, col, out);
        break;
      default:
        break;
    }
  }
  return out;
}

/**
 * Is `square` (normally a king square) attacked by any piece of `bySide`?
 * Includes the flying-general rule for king squares on an open file.
 */
export function isSquareAttackedBy(board: Board, square: number, bySide: Side): boolean {
  const row = Math.floor(square / BOARD_COLS);
  const col = square % BOARD_COLS;

  // Rooks, cannons and the flying general along the four orthogonal rays.
  for (const [dr, dc] of ORTHO_DIRS) {
    let nr = row + dr;
    let nc = col + dc;
    let screened = false;
    while (inBounds(nr, nc)) {
      const target = board[idx(nr, nc)];
      if (target) {
        if (!screened) {
          screened = true;
          if (target.side === bySide) {
            if (target.type === 'rook') return true;
            if (target.type === 'king') {
              // Flying general applies on the file; adjacent kings are also illegal.
              if (dc === 0 || Math.abs(nr - row) + Math.abs(nc - col) === 1) return true;
            }
          }
          // An enemy cannon as first piece is only a screen: keep scanning.
        } else {
          if (target.side === bySide && target.type === 'cannon') return true;
          break;
        }
      }
      nr += dr;
      nc += dc;
    }
  }

  // Horses, with the leg block.
  for (const [dr, dc] of HORSE_ATTACK_OFFSETS) {
    const horseRow = row + dr;
    const horseCol = col + dc;
    if (!inBounds(horseRow, horseCol)) continue;
    const horse = board[idx(horseRow, horseCol)];
    if (!horse || horse.side !== bySide || horse.type !== 'horse') continue;
    let legRow: number;
    let legCol: number;
    if (Math.abs(dr) === 2) {
      legRow = row + dr - Math.sign(dr);
      legCol = col + dc;
    } else {
      legRow = row + dr;
      legCol = col + dc - Math.sign(dc);
    }
    if (!board[idx(legRow, legCol)]) return true;
  }

  // Pawns: forward attacks always, sideways attacks only after crossing the river.
  const pawnRow = row + (bySide === 'red' ? -1 : 1);
  if (inBounds(pawnRow, col)) {
    const pawn = board[idx(pawnRow, col)];
    if (pawn && pawn.side === bySide && pawn.type === 'pawn') return true;
  }
  const sidewaysRows = bySide === 'red' ? row >= 5 : row <= 4;
  if (sidewaysRows) {
    for (const dc of [-1, 1]) {
      const pawnCol = col + dc;
      if (!inBounds(row, pawnCol)) continue;
      const pawn = board[idx(row, pawnCol)];
      if (pawn && pawn.side === bySide && pawn.type === 'pawn') return true;
    }
  }

  // Advisors and elephants can never legally reach the enemy king, but the
  // geometry is checked for robustness against hand-written FEN positions.
  for (const [dr, dc] of ADVISOR_STEPS) {
    if (!inBounds(row + dr, col + dc)) continue;
    const advisor = board[idx(row + dr, col + dc)];
    if (advisor && advisor.side === bySide && advisor.type === 'advisor') return true;
  }
  for (const [dr, dc] of ELEPHANT_STEPS) {
    const elephantRow = row + dr;
    const elephantCol = col + dc;
    if (!inBounds(elephantRow, elephantCol)) continue;
    const elephant = board[idx(elephantRow, elephantCol)];
    if (!elephant || elephant.side !== bySide || elephant.type !== 'elephant') continue;
    if (!board[idx(row + dr / 2, col + dc / 2)]) return true;
  }

  return false;
}

/** Is `side`'s own king currently in check (including flying general)? */
export function isKingInCheck(board: Board, side: Side): boolean {
  const kingIndex = findKing(board, side);
  if (kingIndex < 0) return true; // malformed position: treat as unsafe
  return isSquareAttackedBy(board, kingIndex, opposite(side));
}

/** Returns true if the side's king is attacked after a hypothetical move. */
export function generateLegalMoves(board: Board, side: Side): RawMove[] {
  const pseudo = generatePseudoMoves(board, side);
  const legal: RawMove[] = [];
  for (const move of pseudo) {
    const moved = board[move.from] as Piece;
    const captured = board[move.to];
    board[move.to] = moved;
    board[move.from] = null;
    const safe = !isKingInCheck(board, side);
    board[move.from] = moved;
    board[move.to] = captured;
    if (safe) legal.push(move);
  }
  return legal;
}
