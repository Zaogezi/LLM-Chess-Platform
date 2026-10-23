import type {
  GameResult,
  MoveView,
  Phase,
  PieceType,
  PieceView,
  Side,
} from '../../shared/protocol';

export const SIDE_LABEL: Record<Side, string> = {
  red: '红方',
  black: '黑方',
};

export const SIDE_DUTY: Record<Side, string> = {
  red: '执先',
  black: '执后',
};

export const SIDE_SEAL: Record<Side, string> = {
  red: '红',
  black: '黑',
};

export const PIECE_GLYPH: Record<Side, Record<PieceType, string>> = {
  red: {
    king: '帅',
    advisor: '仕',
    elephant: '相',
    horse: '马',
    rook: '车',
    cannon: '炮',
    pawn: '兵',
  },
  black: {
    king: '将',
    advisor: '士',
    elephant: '象',
    horse: '马',
    rook: '车',
    cannon: '炮',
    pawn: '卒',
  },
};

export const INITIAL_PIECE_COUNTS: Record<PieceType, number> = {
  king: 1,
  advisor: 2,
  elephant: 2,
  horse: 2,
  rook: 2,
  cannon: 2,
  pawn: 5,
};

const CAPTURE_ORDER: readonly PieceType[] = [
  'rook',
  'cannon',
  'horse',
  'elephant',
  'advisor',
  'pawn',
  'king',
];

/**
 * Everything the board renderer needs. `ArenaState` is a superset, and replay
 * frames implement the same shape so one board component serves both.
 */
export interface BoardViewState {
  board: (PieceView | null)[];
  checked: boolean;
  lastMove: { fromUcci: string; toUcci: string; side: Side } | null;
  moves: MoveView[];
  phase: Phase;
  ply: number;
  turn: Side;
  moveNumber: number;
  result: GameResult | null;
}

export const BOARD_LAYOUT = {
  cols: 9,
  rows: 10,
  cell: 64,
  marginX: 44,
  marginY: 44,
  width: 600,
  height: 664,
} as const;

export function otherSide(side: Side): Side {
  return side === 'red' ? 'black' : 'red';
}

export function indexToRowCol(index: number): { row: number; col: number } {
  return { row: Math.floor(index / 9), col: index % 9 };
}

export function squareToPercent(row: number, col: number): { left: string; top: string } {
  const left = ((BOARD_LAYOUT.marginX + col * BOARD_LAYOUT.cell) / BOARD_LAYOUT.width) * 100;
  const top =
    ((BOARD_LAYOUT.marginY + (BOARD_LAYOUT.rows - 1 - row) * BOARD_LAYOUT.cell) /
      BOARD_LAYOUT.height) *
    100;
  return { left: `${left.toFixed(4)}%`, top: `${top.toFixed(4)}%` };
}

export function parseUcciSquare(square: string): { row: number; col: number } | null {
  const match = /^([a-i])([0-9])$/.exec(square);
  if (!match) {
    return null;
  }
  return { col: match[1].charCodeAt(0) - 97, row: Number(match[2]) };
}

export function findKingIndex(
  board: readonly (PieceView | null)[],
  side: Side,
): number | null {
  for (let index = 0; index < board.length; index += 1) {
    const piece = board[index];
    if (piece && piece.side === side && piece.type === 'king') {
      return index;
    }
  }
  return null;
}

export interface CapturedGroup {
  type: PieceType;
  count: number;
  glyph: string;
}

/** Pieces of `capturedSide` that have disappeared from the board. */
export function capturedPieces(
  board: readonly (PieceView | null)[],
  capturedSide: Side,
): CapturedGroup[] {
  const onBoard: Record<PieceType, number> = {
    king: 0,
    advisor: 0,
    elephant: 0,
    horse: 0,
    rook: 0,
    cannon: 0,
    pawn: 0,
  };

  for (const piece of board) {
    if (piece && piece.side === capturedSide) {
      onBoard[piece.type] += 1;
    }
  }

  const groups: CapturedGroup[] = [];
  for (const type of CAPTURE_ORDER) {
    const count = Math.max(0, INITIAL_PIECE_COUNTS[type] - onBoard[type]);
    if (count > 0) {
      groups.push({ type, count, glyph: PIECE_GLYPH[capturedSide][type] });
    }
  }
  return groups;
}

export function describeArena(state: BoardViewState): string {
  const last = state.moves.length > 0 ? state.moves[state.moves.length - 1] : null;
  const parts: string[] = [
    '中国象棋棋盘',
    `第 ${state.moveNumber} 回合，共 ${state.ply} 手`,
    `轮到${SIDE_LABEL[state.turn]}行棋`,
  ];

  if (last) {
    parts.push(`最后一手，${SIDE_LABEL[last.side]}${last.notation}`);
  } else {
    parts.push('尚未落子');
  }

  if (state.checked) {
    parts.push(`${SIDE_LABEL[state.turn]}正被将军`);
  }

  if (state.result) {
    parts.push(state.result.text);
  }

  return `${parts.join('，')}。`;
}
