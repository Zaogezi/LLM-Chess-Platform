import type {
  MoveView,
  PieceType,
  PieceView,
  Side,
} from '../../shared/protocol';
import { START_FEN } from '../../shared/protocol';
import type { BoardViewState } from './chess';
import { otherSide, parseUcciSquare } from './chess';

const FEN_PIECES: Record<string, PieceType> = {
  k: 'king',
  a: 'advisor',
  b: 'elephant',
  e: 'elephant',
  n: 'horse',
  h: 'horse',
  r: 'rook',
  c: 'cannon',
  p: 'pawn',
};

/**
 * Parse the placement field of a Xiangqi FEN into the row-major board used by
 * the board renderer. Only the start position is needed for replays, so the
 * move counters and side-to-move are handled separately.
 */
export function boardFromFen(fen: string = START_FEN): (PieceView | null)[] {
  const placement = fen.trim().split(/\s+/)[0] ?? '';
  const ranks = placement.split('/');
  const board: (PieceView | null)[] = new Array(90).fill(null);
  const counts: Record<Side, Record<PieceType, number>> = {
    red: { king: 0, advisor: 0, elephant: 0, horse: 0, rook: 0, cannon: 0, pawn: 0 },
    black: { king: 0, advisor: 0, elephant: 0, horse: 0, rook: 0, cannon: 0, pawn: 0 },
  };

  for (let offset = 0; offset < 10 && offset < ranks.length; offset += 1) {
    const row = 9 - offset;
    let col = 0;
    for (const character of ranks[offset] ?? '') {
      if (character >= '1' && character <= '9') {
        col += Number(character);
        continue;
      }
      const type = FEN_PIECES[character.toLowerCase()];
      if (!type || col >= 9) continue;
      const side: Side = character === character.toUpperCase() ? 'red' : 'black';
      const index = row * 9 + col;
      if (index >= 0 && index < 90) {
        counts[side][type] += 1;
        board[index] = {
          id: `${side}-${type}-${counts[side][type]}`,
          type,
          side,
        };
      }
      col += 1;
    }
  }

  return board;
}

function sideToMoveFor(ply: number): Side {
  return ply % 2 === 0 ? 'red' : 'black';
}

function frameMove(move: MoveView | null): BoardViewState['lastMove'] {
  if (!move) return null;
  const ucci = move.ucci.trim().toLowerCase();
  if (!/^[a-i][0-9][a-i][0-9]$/.test(ucci)) return null;
  return { fromUcci: ucci.slice(0, 2), toUcci: ucci.slice(2, 4), side: move.side };
}

/** Apply one UCCI move to a copy of the board. Invalid moves leave it unchanged. */
export function applyUcciMove(
  board: readonly (PieceView | null)[],
  ucci: string,
): (PieceView | null)[] {
  const next = board.slice();
  const from = parseUcciSquare(ucci.slice(0, 2));
  const to = parseUcciSquare(ucci.slice(2, 4));
  if (!from || !to) return next;

  const fromIndex = from.row * 9 + from.col;
  const toIndex = to.row * 9 + to.col;
  const piece = next[fromIndex];
  if (!piece) return next;

  next[fromIndex] = null;
  next[toIndex] = piece;
  return next;
}

/**
 * Pre-compute every position of a finished game so the admin replay can step
 * forwards and backwards instantly. Frame 0 is the start position; frame N is
 * the position after N moves.
 */
export function buildReplayFrames(
  moves: readonly MoveView[],
  startFen: string = START_FEN,
): BoardViewState[] {
  let board = boardFromFen(startFen);
  const frames: BoardViewState[] = [
    {
      board,
      checked: false,
      lastMove: null,
      moves: [],
      phase: 'finished',
      ply: 0,
      turn: 'red',
      moveNumber: 1,
      result: null,
    },
  ];

  for (let index = 0; index < moves.length; index += 1) {
    const move = moves[index];
    board = applyUcciMove(board, move.ucci);
    frames.push({
      board,
      checked: false,
      lastMove: frameMove(move),
      moves: moves.slice(0, index + 1),
      phase: 'finished',
      ply: index + 1,
      turn: otherSide(move.side ?? sideToMoveFor(index + 1)),
      moveNumber: Math.floor((index + 1) / 2) + 1,
      result: null,
    });
  }

  return frames;
}
